import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { ensureDemoCitizen } from '../server/db.js'

const base = process.env.QA_BASE || 'http://127.0.0.1:8798'
const secret = process.env.SESSION_SECRET || 'identity-review-fields-session-secret-long'
const sign = (sub: string, role: string) => {
  const payload = Buffer.from(JSON.stringify({ sub, role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
    'base64url'
  )
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
const citizenId = ensureDemoCitizen()
const citizenHeaders = { cookie: `dhiqar_session=${sign(String(citizenId), 'CITIZEN')}` }
const reviewerHeaders = {
  cookie: `dhiqar_session=${sign('super-admin', 'SUPER_ADMIN')}`,
  'content-type': 'application/json',
}
const image = await readFile(new URL('./fixtures/synthetic-passport.png', import.meta.url))
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(110_000)])
const form = new FormData()
form.append('fullName', 'مواطن اختبار OCR')
form.append('documentNumber', 'P-REVIEW-123456')
form.append('documentType', 'PASSPORT')
form.append('consent', 'true')
form.append('retainMedia', 'true')
form.append('analysisConsent', 'true')
form.append('profilePhotoConsent', 'true')
form.append('locationConsent', 'true')
form.append('locationLat', '31.042')
form.append('locationLng', '46.267')
form.append('idFront', new Blob([image], { type: 'image/png' }), 'passport-data.png')
form.append('faceVideo', new Blob([webm], { type: 'video/webm' }), 'face-video-7s-review-test.webm')
const submission = await fetch(`${base}/api/onboarding/identity-review`, {
  method: 'POST',
  headers: citizenHeaders,
  body: form,
})
if (submission.status !== 201)
  throw new Error(`identity review status ${submission.status}: ${await submission.text()}`)
const created = (await submission.json()) as {
  id: string
  analysis: {
    fields: {
      fullName: string | null
      documentNumber: string | null
      dateOfBirth: string | null
      nationality: string | null
      sex: string | null
      expiryDate: string | null
    }
    faceComparison: { status: string; confidence: number | null }
  }
}
if (
  process.env.EXPECT_FACE_MATCH === 'true' &&
  (created.analysis.faceComparison.status !== 'MATCH_ASSISTED' || created.analysis.faceComparison.confidence === null)
)
  throw new Error('provider face comparison was not returned to citizen submission')
const citizenResponse = await fetch(`${base}/api/citizen/demo`, { headers: citizenHeaders })
const citizen = (await citizenResponse.json()) as Record<string, unknown>
if ('extractedFields' in citizen || 'dateOfBirth' in citizen || 'expiryDate' in citizen)
  throw new Error('protected OCR fields leaked to citizen endpoint')
const queueResponse = await fetch(`${base}/api/admin/identity-reviews`, { headers: reviewerHeaders })
if (queueResponse.status !== 200) throw new Error(`review queue status ${queueResponse.status}`)
const queue = (await queueResponse.json()) as Array<{
  id: string
  extractedFields: {
    documentTypeDetected: string | null
    fullName: string | null
    documentNumber: string | null
    dateOfBirth: string | null
    nationality: string | null
    sex: string | null
    expiryDate: string | null
  } | null
  screening: { faceMatchStatus: string; faceMatchScore: number | null }
}>
const review = queue.find(item => item.id === created.id)
if (!review?.extractedFields) throw new Error('reviewer did not receive protected OCR structure')
if (review.extractedFields.documentTypeDetected !== 'PASSPORT') throw new Error('reviewer OCR document type missing')
if (
  process.env.EXPECT_FACE_MATCH === 'true' &&
  (review.screening.faceMatchStatus !== 'MATCH_ASSISTED' || review.screening.faceMatchScore === null)
)
  throw new Error('provider face comparison was not retained for reviewer')
for (const key of ['fullName', 'documentNumber', 'dateOfBirth', 'nationality', 'sex', 'expiryDate'] as const) {
  if (review.extractedFields[key] !== created.analysis.fields[key])
    throw new Error(`reviewer OCR field mismatch: ${key}`)
}
console.log('identity_reviewer_extracted_fields_qa=pass')
