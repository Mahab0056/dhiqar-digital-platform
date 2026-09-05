import { createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { ensureDemoCitizen, db } from '../server/db.js'
import { purgeExpiredMedia } from '../server/media.js'

const base = process.env.QA_BASE || 'http://127.0.0.1:8798'
const secret = process.env.SESSION_SECRET || 'identity-document-expansion-session-secret-long'
const sign = (sub: string, role: string) => {
  const payload = Buffer.from(JSON.stringify({ sub, role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
    'base64url'
  )
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
const citizenId = ensureDemoCitizen()
const citizenHeaders = { cookie: `dhiqar_session=${sign(String(citizenId), 'CITIZEN')}` }
const superHeaders = {
  cookie: `dhiqar_session=${sign('super-admin', 'SUPER_ADMIN')}`,
  'content-type': 'application/json',
}
const documentImage = await readFile(new URL('./fixtures/synthetic-passport.png', import.meta.url))
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(110_000)])
const form = new FormData()
form.append('fullName', 'مواطن اختبار جواز')
form.append('documentNumber', 'P-TEST-123456')
form.append('documentType', 'PASSPORT')
form.append('consent', 'true')
form.append('retainMedia', 'true')
form.append('analysisConsent', 'true')
form.append('profilePhotoConsent', 'true')
form.append('locationConsent', 'true')
form.append('locationLat', '31.042')
form.append('locationLng', '46.267')
form.append('locationAccuracyM', '18')
form.append('idFront', new Blob([documentImage], { type: 'image/png' }), 'passport-data-page.png')
form.append('faceVideo', new Blob([webm], { type: 'video/webm' }), 'face-video-7s-test.webm')

const preview = new FormData()
preview.append('documentType', 'PASSPORT')
preview.append('analysisConsent', 'true')
preview.append('document', new Blob([documentImage], { type: 'image/png' }), 'passport-data-page.png')
const previewResponse = await fetch(`${base}/api/onboarding/identity-extract-preview`, {
  method: 'POST',
  headers: citizenHeaders,
  body: preview,
})
if (previewResponse.status !== 200) throw new Error(`preview status ${previewResponse.status}`)
const previewData = (await previewResponse.json()) as {
  status: string
  provider: string | null
  fields: { fullName: string | null; documentNumber: string | null }
}
if (
  previewData.status !== 'COMPLETED' ||
  previewData.provider !== 'محرك OCR محلي' ||
  !previewData.fields.documentNumber
)
  throw new Error('لم يكتمل تحليل OCR المحلي للمستند الصناعي كما هو متوقع')

const locationResponse = await fetch(`${base}/api/citizen/location`, {
  method: 'POST',
  headers: { ...citizenHeaders, 'content-type': 'application/json' },
  body: JSON.stringify({ lat: 31.042, lng: 46.267, accuracyM: 18, consent: true }),
})
if (locationResponse.status !== 200) throw new Error(`location status ${locationResponse.status}`)

const submission = await fetch(`${base}/api/onboarding/identity-review`, {
  method: 'POST',
  headers: citizenHeaders,
  body: form,
})
if (submission.status !== 201) throw new Error(`submission status ${submission.status}: ${await submission.text()}`)
const review = (await submission.json()) as {
  id: string
  documentType: string
  files: Array<{ id: string; retentionPolicy: string }>
}
if (
  review.documentType !== 'PASSPORT' ||
  review.files.length !== 2 ||
  review.files.some(file => file.retentionPolicy !== 'RETAINED_WITH_CONSENT')
)
  throw new Error('passport flow did not retain expected media')
const deniedMedia = await fetch(`${base}/api/admin/media/${review.files[0].id}`, { headers: citizenHeaders })
if (deniedMedia.status !== 401) throw new Error(`citizen read to review media status ${deniedMedia.status}`)
const approved = await fetch(`${base}/api/admin/identity-reviews/${review.id}/decision`, {
  method: 'POST',
  headers: superHeaders,
  body: JSON.stringify({ decision: 'APPROVED', notes: 'اختبار قاعدة معزولة' }),
})
if (approved.status !== 200) throw new Error(`approval status ${approved.status}: ${await approved.text()}`)
const decision = (await approved.json()) as { mediaRetained?: boolean; mediaPurged?: boolean }
if (!decision.mediaRetained || decision.mediaPurged) throw new Error('approval did not retain media')
purgeExpiredMedia()
const mediaRows = db
  .prepare(
    'SELECT storage_path, retention_policy, deleted_at FROM media_objects WHERE citizen_id = ? ORDER BY created_at DESC LIMIT 2'
  )
  .all(citizenId) as Array<{ storage_path: string; retention_policy: string; deleted_at: string | null }>
const citizen = db
  .prepare('SELECT document_type, location_lat, location_lng FROM citizens WHERE id = ?')
  .get(citizenId) as { document_type: string; location_lat: number; location_lng: number }
if (
  mediaRows.length !== 2 ||
  mediaRows.some(
    row => row.retention_policy !== 'RETAINED_WITH_CONSENT' || row.deleted_at !== null || !existsSync(row.storage_path)
  )
)
  throw new Error('retained media was not preserved')
if (citizen.document_type !== 'PASSPORT' || citizen.location_lat !== 31.042 || citizen.location_lng !== 46.267)
  throw new Error('document type or approved location not stored')
const citizenProfileResponse = await fetch(`${base}/api/citizen/demo`, { headers: citizenHeaders })
if (citizenProfileResponse.status !== 200) throw new Error(`citizen profile status ${citizenProfileResponse.status}`)
const citizenProfile = (await citizenProfileResponse.json()) as Record<string, unknown>
if ('location' in citizenProfile || 'locationLat' in citizenProfile || 'locationLng' in citizenProfile)
  throw new Error('location leaked to citizen profile response')
const reviewerResponse = await fetch(`${base}/api/admin/identity-reviews`, { headers: superHeaders })
if (reviewerResponse.status !== 200) throw new Error(`reviewer queue status ${reviewerResponse.status}`)
const reviewerItems = (await reviewerResponse.json()) as Array<{
  id: string
  location?: { lat: number; lng: number } | null
}>
if (
  !reviewerItems.some(item => item.id === review.id && item.location?.lat === 31.042 && item.location?.lng === 46.267)
)
  throw new Error('reviewer did not receive protected location')
console.log('identity_document_expansion_qa=pass')
