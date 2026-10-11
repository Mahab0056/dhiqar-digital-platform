// Official document templates: signed opaque QR codes, per-service template assignment (manager / super admin),
// issuance with the assigned template, public verification without personal data, and revocation.
import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()

let app: Express
let admin = ''
let citizen = ''
let govClerk = ''
let govManager = ''
let waterManager = ''
const staffIds: Record<string, string> = {}

const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)])
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])
const db = async () => (await import('../server/db.ts')).db

async function staffLogin(username: string, password: string) {
  const response = await request(app).post('/api/auth/staff/login').send({ username, password })
  expect(response.status).toBe(200)
  return cookieOf(response)
}

async function createStaff(username: string, departmentId: string, manager = false) {
  const created = await request(app)
    .post('/api/super-admin/staff')
    .set('Cookie', admin)
    .send({ username, fullName: `Test ${username}`, role: 'EMPLOYEE', departmentId })
  expect(created.status).toBe(201)
  staffIds[username] = created.body.account.id
  if (manager)
    expect(
      (
        await request(app)
          .patch(`/api/super-admin/staff/${created.body.account.id}`)
          .set('Cookie', admin)
          .send({ isDepartmentManager: true })
      ).status
    ).toBe(200)
  const cookie = await staffLogin(username, created.body.temporaryPassword)
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', cookie)
    .send({ currentPassword: created.body.temporaryPassword, newPassword: `Rotated-${username}-2026!` })
  return staffLogin(username, `Rotated-${username}-2026!`)
}

function fillField(field: { type: string; options?: string[]; maxLength?: number }) {
  if (field.options?.length) return field.options[0]
  if (field.type === 'tel') return '07701234567'
  if (field.type === 'email') return 'qa@example.com'
  if (field.type === 'number') return '4'
  if (field.type === 'date') return new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
  if (field.type === 'time') return '10:30'
  return 'بيانات اختبار'.slice(0, field.maxLength || 160)
}

async function submitGovRequest() {
  const service = (await request(app).get('/api/services/gov-low-cost-housing')).body as {
    fields: Array<{ key: string; type: string; options?: string[]; maxLength?: number }>
    requiredDocuments: Array<{ key: string }>
  }
  let req = request(app)
    .post('/api/service-requests')
    .set('Cookie', citizen)
    .field('serviceKey', 'gov-low-cost-housing')
    .field('data', JSON.stringify(Object.fromEntries(service.fields.map(field => [field.key, fillField(field)]))))
    .field('faceConsent', 'true')
    .field('documentConsent', 'true')
  for (const doc of service.requiredDocuments)
    req = req.attach(`doc__${doc.key}`, pdf, { filename: `${doc.key}.pdf`, contentType: 'application/pdf' })
  const response = await req.attach('faceVideo', webm, { filename: 'face.webm', contentType: 'video/webm' })
  expect(response.status).toBe(201)
  return response.body.reference as string
}

async function approve(cookie: string, reference: string) {
  const view = await request(app).get(`/api/employee/service-requests/${reference}`).set('Cookie', cookie)
  expect(view.status).toBe(200)
  for (const item of view.body.checklist as Array<{ key: string; mediaId: string | null }>) {
    if (!item.mediaId) continue
    await request(app)
      .patch(`/api/employee/service-requests/${reference}/documents/${item.key}`)
      .set('Cookie', cookie)
      .send({ status: 'VERIFIED' })
  }
  const decided = await request(app)
    .patch(`/api/employee/service-requests/${reference}`)
    .set('Cookie', cookie)
    .send({ status: 'APPROVED', decisionNote: 'يُراجع المواطن لاستلام الأصل.' })
  expect(decided.status).toBe(200)
  return (await db()).prepare('SELECT * FROM issued_documents WHERE service_request_reference = ?').get(reference) as
    Record<string, string> | undefined
}

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  admin = await staffLogin('admin', 'Bootstrap-Admin-Pass-2026!')
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', admin)
    .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Admin-Rotated-Pass-2026!' })
  admin = await staffLogin('admin', 'Admin-Rotated-Pass-2026!')
  const requested = await request(app).post('/api/onboarding/request-otp').send({ phone: '07801239301' })
  const verified = await request(app)
    .post('/api/onboarding/verify-phone')
    .send({ phone: '07801239301', challengeId: requested.body.challengeId, otp: '246810' })
  citizen = cookieOf(verified)
  ;(await db())
    .prepare(`UPDATE citizens SET verification_status = 'VERIFIED_MANUAL', national_id_masked = '199012345678 4821'`)
    .run()
  govClerk = await createStaff('doc.gov.clerk', 'dhiqar-governorate')
  govManager = await createStaff('doc.gov.manager', 'dhiqar-governorate', true)
  waterManager = await createStaff('doc.water.manager', 'dhiqar-water', true)
})

describe('signed verification codes', () => {
  it('verifies a genuine token and rejects any tampering', async () => {
    const token = await import('../server/documents/token.ts')
    const record = {
      docKey: token.newDocKey(),
      documentNumber: 'TQD-GOV-2026-000001',
      templateId: 'certificate',
      departmentId: 'dhiqar-governorate',
      issuedAt: '2026-10-10T08:00:00.000Z',
      expiresAt: null,
      holderDigest: token.holderDigestOf(1, 'علي حسين'),
    }
    const signed = token.signDocument(record)
    const digest = token.canonicalDigest(record)
    expect(signed.token).toMatch(/^TQD1\.[A-Z2-9]{16}\.[A-Za-z0-9_-]{22}$/)
    expect(token.verifyParsedCode(token.parseVerificationCode(signed.token), record.docKey, digest)).toBe(true)
    expect(token.verifyParsedCode(token.parseVerificationCode(signed.manualCode), record.docKey, digest)).toBe(true)
    // flip one signature character
    const last = signed.token.at(-1) === 'A' ? 'B' : 'A'
    const forged = `${signed.token.slice(0, -1)}${last}`
    expect(token.verifyParsedCode(token.parseVerificationCode(forged), record.docKey, digest)).toBe(false)
    // the record changed behind the code (e.g. expiry pushed in the DB)
    const moved = token.canonicalDigest({ ...record, expiresAt: '2030-01-01T00:00:00.000Z' })
    expect(token.verifyParsedCode(token.parseVerificationCode(signed.token), record.docKey, moved)).toBe(false)
    expect(token.parseVerificationCode('https://evil.example/verify/<script>').kind).toBe('invalid')
  })

  it('the QR payload carries no personal data', async () => {
    const { sampleModel } = await import('../server/documents/samples.ts')
    const model = sampleModel('shop-licence')
    for (const secret of [model.holderName, model.holderIdLast4 || '', model.reference || '', model.serviceName])
      expect(model.token).not.toContain(secret)
    expect(model.token).not.toMatch(/https?:|[؀-ۿ]|\d{8,}/)
  })

  it('every template renders a PDF', async () => {
    const { documentTemplates } = await import('../server/documents/templates.ts')
    const { renderDocumentPdf } = await import('../server/documents/render.ts')
    const { sampleModel } = await import('../server/documents/samples.ts')
    for (const template of documentTemplates) {
      const buffer = await renderDocumentPdf(sampleModel(template.id))
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
    }
  }, 60_000)
})

describe('template assignment permissions', () => {
  const assign = (cookie: string, department: string, service: string, body: Record<string, unknown>) =>
    request(app).post(`/api/documents/assignments/${department}/${service}`).set('Cookie', cookie).send(body)

  it('lists templates for staff and infers a default per service', async () => {
    const list = await request(app).get('/api/documents/templates').set('Cookie', govClerk)
    expect(list.status).toBe(200)
    expect(list.body.templates.length).toBeGreaterThanOrEqual(15)
    const mine = await request(app).get('/api/documents/assignments').set('Cookie', govClerk)
    expect(mine.status).toBe(200)
    expect(mine.body.canEdit).toBe(false)
    const housing = mine.body.services.find(
      (item: { serviceKey: string }) => item.serviceKey === 'gov-low-cost-housing'
    )
    // approving an application is not an allocation: «قرار تخصيص» is only issued when explicitly assigned
    expect(housing.templateId).toBe('completion-notice')
    // an employee cannot read another department's mapping
    expect(
      (await request(app).get('/api/documents/assignments?departmentId=dhiqar-water').set('Cookie', govClerk)).status
    ).toBe(403)
    expect((await request(app).get('/api/documents/templates').set('Cookie', citizen)).status).toBe(401)
  })

  it('a clerk cannot assign; a manager only in their own department; the super admin anywhere', async () => {
    expect(
      (await assign(govClerk, 'dhiqar-governorate', 'gov-low-cost-housing', { templateId: 'certificate' })).status
    ).toBe(403)
    expect(
      (await assign(waterManager, 'dhiqar-governorate', 'gov-low-cost-housing', { templateId: 'certificate' })).status
    ).toBe(403)
    expect(
      (await assign(govManager, 'dhiqar-governorate', 'water-tanker-request', { templateId: 'certificate' })).status
    ).toBe(404)
    expect(
      (await assign(govManager, 'dhiqar-governorate', 'gov-low-cost-housing', { templateId: 'nope' })).status
    ).toBe(400)
    const saved = await assign(govManager, 'dhiqar-governorate', 'gov-low-cost-housing', {
      templateId: 'certificate',
      customTitle: 'شهادة شمول بالسكن واطئ الكلفة',
      customConditions: ['تُبرز هذه الشهادة عند مراجعة لجنة التوزيع.'],
      validityDays: 120,
      signerTitle: 'مدير قسم الإسكان',
    })
    expect(saved.status).toBe(200)
    expect(saved.body.templateId).toBe('certificate')
    const byAdmin = await assign(admin, 'dhiqar-water', 'water-tanker-request', { templateId: 'receipt' })
    expect(byAdmin.status).toBe(200)
    const audit = (await db())
      .prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'DOCUMENT_TEMPLATE_ASSIGNED'`)
      .get() as { n: number }
    expect(audit.n).toBeGreaterThanOrEqual(2)
  })
})

describe('issuance, verification and revocation', () => {
  let row: Record<string, string>

  it('approval issues the PDF with the assigned template and a signed opaque token', async () => {
    const reference = await submitGovRequest()
    const plan = await request(app).get(`/api/documents/requests/${reference}/plan`).set('Cookie', govClerk)
    expect(plan.status).toBe(200)
    expect(plan.body.template.id).toBe('certificate')
    expect(plan.body.documentTitle).toBe('شهادة شمول بالسكن واطئ الكلفة')
    const preview = await request(app).get(plan.body.previewUrl).set('Cookie', govClerk)
    expect(preview.status).toBe(200)
    expect(preview.headers['content-type']).toContain('application/pdf')
    expect((await request(app).get(plan.body.previewUrl).set('Cookie', waterManager)).status).toBe(404)

    row = (await approve(govClerk, reference)) as Record<string, string>
    expect(row).toBeTruthy()
    expect(row.template_id).toBe('certificate')
    expect(row.document_title).toBe('شهادة شمول بالسكن واطئ الكلفة')
    expect(row.document_number).toMatch(/^TQD-GOV-\d{4}-\d{6}$/)
    expect(row.verification_id).toMatch(/^TQD1\.[A-Z2-9]{16}\.[A-Za-z0-9_-]{22}$/)
    expect(row.pdf_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(row.expires_at).toBeTruthy()
    const citizenName = ((await db()).prepare('SELECT full_name FROM citizens LIMIT 1').get() as { full_name: string })
      .full_name
    expect(row.verification_id).not.toContain(citizenName)
  })

  it('public verification validates the signature and never exposes the full national ID', async () => {
    const ok = await request(app).get(`/api/verify/${encodeURIComponent(row.verification_id)}`)
    expect(ok.status).toBe(200)
    expect(ok.body.validity).toBe('VALID')
    expect(ok.body.signatureValid).toBe(true)
    expect(ok.body.holderIdLast4).toBe('4821')
    const text = JSON.stringify(ok.body)
    expect(text).not.toContain('199012345678')
    for (const field of ['address', 'coordinates', 'citizenId', 'phone', 'nationalId', 'national_id_masked'])
      expect(ok.body).not.toHaveProperty(field)
    // tampered token → invalid, no record revealed
    const sig = row.verification_id.split('.')[2]
    const forged = row.verification_id.replace(sig, `${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`)
    const bad = await request(app).get(`/api/verify/${encodeURIComponent(forged)}`)
    expect(bad.status).toBe(404)
    expect(bad.body.code).toBe('INVALID_CODE')
    expect(bad.body).not.toHaveProperty('documentNumber')
    // the bare docKey (without the signature) is not accepted as a legacy id either
    expect((await request(app).get(`/api/verify/${row.doc_key}`)).status).toBe(404)
    const original = await request(app).get(`/api/verify/${encodeURIComponent(row.verification_id)}/original-pdf`)
    expect(original.status).toBe(200)
    const { createHash } = await import('node:crypto')
    expect(
      createHash('sha256')
        .update(original.body as Buffer)
        .digest('hex')
    ).toBe(row.pdf_sha256)
  })

  it('staff of another department cannot revoke; the issuing department can, with a reason', async () => {
    const path = `/api/employee/issued-documents/${row.id}/revoke`
    expect((await request(app).post(path).set('Cookie', waterManager).send({ reason: 'سبب تجريبي' })).status).toBe(404)
    expect((await request(app).post(path).set('Cookie', govClerk).send({ reason: '' })).status).toBe(400)
    const revoked = await request(app).post(path).set('Cookie', govClerk).send({ reason: 'صدرت بالخطأ لمعاملة مكررة' })
    expect(revoked.status).toBe(200)
    const view = await request(app).get(`/api/verify/${encodeURIComponent(row.verification_id)}`)
    expect(view.body.status).toBe('REVOKED')
    expect(view.body.validity).toBe('REVOKED')
    expect(view.body.revokedReason).toBe('صدرت بالخطأ لمعاملة مكررة')
    expect((await request(app).get(`/api/verify/${encodeURIComponent(row.verification_id)}/original-pdf`)).status).toBe(
      404
    )
    const audit = (await db())
      .prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'ISSUED_DOCUMENT_REVOKED' AND entity_id = ?`)
      .get(row.id) as { n: number }
    expect(audit.n).toBe(1)
  })
})
