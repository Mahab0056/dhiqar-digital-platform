// Who signs an official document, and the documents issued by the steps of a request (not only its approval):
// the reasoned rejection decision, the referral letter to the competent department and the fee receipt — each with a
// signed QR code, visible to the citizen and revocable. Plus the super admin's «طلبات مفتوحة» count.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import PDFDocument from 'pdfkit'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()
// online payments off (as in production today): official fees are paid at the department counter
process.env.PAYMENT_PROVIDER = 'none'

let app: Express
let admin = ''
let citizen = ''
let govClerk = ''
let govManager = ''
let healthClerk = ''

const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)])
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])
const db = async () => (await import('../server/db.ts')).db
type Row = Record<string, string>

// every string pdfkit is asked to draw while a request is handled (one call per font run)
type Proto = { text: (this: PDFKit.PDFDocument, value: string, ...rest: unknown[]) => PDFKit.PDFDocument }
const proto = PDFDocument.prototype as unknown as Proto
const originalText = proto.text
let fragments: string[] = []
const drawn = (marker: string) => fragments.some(fragment => fragment.includes(marker))
afterEach(() => {
  fragments = []
})

const APPROVED_LINE = 'اعتُمد إلكترونياً عبر منصة ذي قار الرقمية'

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
  if (manager)
    await request(app)
      .patch(`/api/super-admin/staff/${created.body.account.id}`)
      .set('Cookie', admin)
      .send({ isDepartmentManager: true })
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

async function submitBirthCertificate() {
  let req = request(app)
    .post('/api/service-requests')
    .set('Cookie', citizen)
    .field('serviceKey', 'health-birth-certificate')
    .field(
      'data',
      JSON.stringify({
        newbornName: 'علي حسين',
        birthDate: '2026-08-01',
        birthPlace: 'مستشفى الحبوبي',
        requestType: 'شهادة ولادة',
        district: 'الناصرية',
        phone: '07801234567',
      })
    )
    .field('faceConsent', 'true')
    .field('documentConsent', 'true')
  for (const key of ['hospital-birth-report', 'father-id', 'mother-id', 'marriage-contract', 'residence-card'])
    req = req.attach(`doc__${key}`, jpeg, { filename: `${key}.jpg`, contentType: 'image/jpeg' })
  const response = await req.attach('faceVideo', webm, { filename: 'face.webm', contentType: 'video/webm' })
  expect(response.status).toBe(201)
  return response.body.reference as string
}

async function verifyDocuments(reference: string, cookie: string) {
  const view = await request(app).get(`/api/employee/service-requests/${reference}`).set('Cookie', cookie)
  for (const item of view.body.checklist as Array<{ key: string; mediaId: string | null; status: string }>) {
    if (!item.mediaId || item.status === 'VERIFIED') continue
    await request(app)
      .patch(`/api/employee/service-requests/${reference}/documents/${item.key}`)
      .set('Cookie', cookie)
      .send({ status: 'VERIFIED' })
  }
}

async function decide(reference: string, cookie: string, body: Record<string, unknown>) {
  await verifyDocuments(reference, cookie)
  fragments = []
  return request(app).patch(`/api/employee/service-requests/${reference}`).set('Cookie', cookie).send(body)
}

const approvalDocument = async (reference: string) =>
  (await db()).prepare('SELECT * FROM issued_documents WHERE service_request_reference = ?').get(reference) as
    Row | undefined
const eventDocuments = async (reference: string, event: string) =>
  (await db())
    .prepare('SELECT * FROM issued_documents WHERE related_reference = ? AND issue_event = ? ORDER BY issued_at')
    .all(reference, event) as Row[]
const verify = (code: string) => request(app).get(`/api/verify/${encodeURIComponent(code)}`)

beforeAll(async () => {
  const { resetPaymentProviderCache } = await import('../server/payments/providers.ts')
  resetPaymentProviderCache()
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  admin = await staffLogin('admin', 'Bootstrap-Admin-Pass-2026!')
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', admin)
    .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Admin-Rotated-Pass-2026!' })
  admin = await staffLogin('admin', 'Admin-Rotated-Pass-2026!')
  const requested = await request(app).post('/api/onboarding/request-otp').send({ phone: '07801239377' })
  const verified = await request(app)
    .post('/api/onboarding/verify-phone')
    .send({ phone: '07801239377', challengeId: requested.body.challengeId, otp: '246810' })
  citizen = cookieOf(verified)
  ;(await db())
    .prepare(`UPDATE citizens SET verification_status = 'VERIFIED_MANUAL', national_id_masked = '199012345678 4821'`)
    .run()
  govClerk = await createStaff('ev.gov.clerk', 'dhiqar-governorate')
  govManager = await createStaff('ev.gov.manager', 'dhiqar-governorate', true)
  healthClerk = await createStaff('ev.health.clerk', 'dhiqar-health')
  proto.text = function (value: string, ...rest: unknown[]) {
    fragments.push(String(value))
    return originalText.call(this, value, ...rest)
  }
}, 120_000)

describe('who signs an issued document', () => {
  it('prints the signing authority, its department and the platform approval — never the approving employee', async () => {
    const reference = await submitGovRequest()
    const approved = await decide(reference, govClerk, { status: 'APPROVED' })
    expect(approved.status).toBe(200)
    const row = (await approvalDocument(reference)) as Row
    const { getTemplate } = await import('../server/documents/templates.ts')
    expect(drawn(getTemplate(row.template_id).defaultSignerTitle)).toBe(true)
    expect(drawn(row.department_name)).toBe(true)
    expect(drawn(APPROVED_LINE)).toBe(true)
    expect(drawn('بتوقيت بغداد')).toBe(true)
    // the regression: "Test ev.gov.clerk (ev.gov.clerk)" was printed as the signer
    expect(drawn('ev.gov.clerk')).toBe(false)
    expect(drawn('Test ev')).toBe(false)
    // …while the internal record and the audit log still say who approved
    expect(row.issued_by).toContain('ev.gov.clerk')
    const audit = (await db())
      .prepare(
        `SELECT actor FROM audit_logs WHERE action = 'SERVICE_REQUEST_APPROVED_DOCUMENT_ISSUED' AND entity_id = ?`
      )
      .get(reference) as { actor: string }
    expect(audit.actor).toContain('ev.gov.clerk')
  })

  it('prints a named signer only when the department configured one in the assignment', async () => {
    const list = await request(app)
      .get('/api/documents/assignments?departmentId=dhiqar-governorate')
      .set('Cookie', govManager)
    const service = (list.body.services as Array<{ serviceKey: string; templateId: string; signerName: unknown }>).find(
      item => item.serviceKey === 'gov-low-cost-housing'
    )!
    expect(service.signerName).toBeNull()
    const path = '/api/documents/assignments/dhiqar-governorate/gov-low-cost-housing'
    const saved = await request(app)
      .post(path)
      .set('Cookie', govManager)
      .send({ templateId: service.templateId, signerTitle: 'مدير قسم الإسكان', signerName: 'م. سالم كاظم الموسوي' })
    expect(saved.status).toBe(200)
    expect(saved.body.signerName).toBe('م. سالم كاظم الموسوي')
    // an editor that does not send the field keeps it; null clears it
    const kept = await request(app)
      .post(path)
      .set('Cookie', govManager)
      .send({ templateId: service.templateId, signerTitle: 'مدير قسم الإسكان' })
    expect(kept.body.signerName).toBe('م. سالم كاظم الموسوي')
    const plan = await request(app)
      .get(`/api/documents/assignments?departmentId=dhiqar-governorate`)
      .set('Cookie', govClerk)
    expect(
      (plan.body.services as Array<{ serviceKey: string; signerName: string }>).find(
        item => item.serviceKey === 'gov-low-cost-housing'
      )?.signerName
    ).toBe('م. سالم كاظم الموسوي')

    const reference = await submitGovRequest()
    expect((await decide(reference, govClerk, { status: 'APPROVED' })).status).toBe(200)
    expect(drawn('مدير قسم الإسكان')).toBe(true)
    expect(drawn('سالم كاظم الموسوي')).toBe(true)
    expect(drawn(APPROVED_LINE)).toBe(true)
    expect(drawn('ev.gov.clerk')).toBe(false)

    const cleared = await request(app)
      .post(path)
      .set('Cookie', govManager)
      .send({ templateId: service.templateId, signerTitle: 'مدير قسم الإسكان', signerName: null })
    expect(cleared.body.signerName).toBeNull()
  })
})

describe('reasoned rejection decision', () => {
  let reference = ''
  let row: Row

  it('a rejection issues «قرار رفض مسبّب» with the reason, never an approval document', async () => {
    reference = await submitGovRequest()
    const reason = 'REASON-MARKER المتقدم غير مشمول بفئات الاستحقاق المحددة في التعليمات'
    const rejected = await decide(reference, govClerk, { status: 'REJECTED', decisionNote: reason })
    expect(rejected.status).toBe(200)
    expect(rejected.body.status).toBe('REJECTED')
    expect(await approvalDocument(reference)).toBeUndefined()
    const rows = await eventDocuments(reference, 'REJECTION')
    expect(rows).toHaveLength(1)
    row = rows[0]
    expect(row.template_id).toBe('rejection-decision')
    expect(row.document_title).toBe('قرار رفض مسبّب')
    expect(row.department_id).toBe('dhiqar-governorate')
    expect(row.event_key).toBe(`SR:${reference}:REJECTION`)
    expect(row.verification_id).toMatch(/^TQD1\./)
    expect(drawn('REASON-MARKER')).toBe(true)
    expect(drawn(APPROVED_LINE)).toBe(true)
    expect(drawn('ev.gov.clerk')).toBe(false)
    expect(rejected.body.currentAction).toContain(row.document_number)
  })

  it('the citizen sees and downloads it (request page, archive, notification) and it verifies', async () => {
    const archive = await request(app).get('/api/citizen/issued-documents').set('Cookie', citizen)
    const listed = (archive.body as Array<Record<string, unknown>>).find(item => item.id === row.id)
    expect(listed).toMatchObject({ serviceRequestReference: reference, issueEvent: 'REJECTION', status: 'ACTIVE' })
    const detail = await request(app).get(`/api/citizen/service-requests/${reference}`).set('Cookie', citizen)
    expect(detail.body.issuedDocuments).toEqual([])
    expect(detail.body.eventDocuments).toEqual([
      expect.objectContaining({ id: row.id, issueEvent: 'REJECTION', documentNumber: row.document_number }),
    ])
    const file = await request(app).get(`/api/citizen/issued-documents/${row.id}/pdf`).set('Cookie', citizen)
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toContain('application/pdf')
    const notifications = await request(app).get('/api/citizen/notifications').set('Cookie', citizen)
    expect(
      (notifications.body.items as Array<{ message: string }>).some(
        item => item.message.includes(reference) && item.message.includes(row.document_number)
      )
    ).toBe(true)
    const checked = await verify(row.verification_id)
    expect(checked.status).toBe(200)
    expect(checked.body).toMatchObject({
      reference,
      templateId: 'rejection-decision',
      validity: 'VALID',
      signatureValid: true,
    })
  })

  it('is issued once per rejection and its record is sealed like any other', async () => {
    const { createEventDocument } = await import('../server/issued-documents.ts')
    const again = await createEventDocument(
      {
        sourceKind: 'SERVICE_REQUEST',
        serviceRequestReference: reference,
        citizenId: Number(row.citizen_id),
        citizenName: 'x',
        serviceName: 'x',
        departmentName: 'x',
        documentTitle: 'x',
        issuedBy: 'x',
        issuedAt: new Date().toISOString(),
        details: [],
        decisionNote: 'سبب آخر',
      },
      'REJECTION',
      `SR:${reference}:REJECTION`
    )
    expect(again.id).toBe(row.id)
    expect(await eventDocuments(reference, 'REJECTION')).toHaveLength(1)
    // moving an event document onto another request breaks its seal
    const database = await db()
    database.prepare('UPDATE issued_documents SET related_reference = ? WHERE id = ?').run('SR-2026-999999', row.id)
    expect((await verify(row.verification_id)).body.code).toBe('INVALID_CODE')
    database.prepare('UPDATE issued_documents SET related_reference = ? WHERE id = ?').run(reference, row.id)
    expect((await verify(row.verification_id)).body.validity).toBe('VALID')
  })

  it('is revocable by the issuing department; the request keeps its decision line', async () => {
    const revoked = await request(app)
      .post(`/api/employee/issued-documents/${row.id}/revoke`)
      .set('Cookie', govClerk)
      .send({ reason: 'أُعيد النظر في القرار' })
    expect(revoked.status).toBe(200)
    expect((await verify(row.verification_id)).body.validity).toBe('REVOKED')
    const request_ = (await db())
      .prepare('SELECT status, current_action FROM service_requests WHERE reference = ?')
      .get(reference) as Row
    expect(request_.status).toBe('REJECTED')
    expect(request_.current_action).toContain('رُفض الطلب')
  })
})

describe('referral letter', () => {
  it('a referral issues «كتاب إحالة» addressed to the receiving department, beside the later approval', async () => {
    const reference = await submitGovRequest()
    fragments = []
    const moved = await request(app)
      .post(`/api/employee/service-requests/${reference}/transfer`)
      .set('Cookie', govClerk)
      .send({ toDepartmentId: 'dhiqar-health', reason: 'الطلب من اختصاص دائرة الصحة' })
    expect(moved.status).toBe(200)
    const health = (
      (await db()).prepare(`SELECT name FROM departments WHERE id = 'dhiqar-health'`).get() as { name: string }
    ).name
    const [letter] = await eventDocuments(reference, 'REFERRAL')
    expect(letter).toBeTruthy()
    expect(letter.template_id).toBe('referral-letter')
    expect(letter.department_id).toBe('dhiqar-governorate')
    expect(letter.event_key).toMatch(new RegExp(`^SR:${reference}:REFERRAL:trf_[a-f0-9]{32}$`))
    expect(drawn(health)).toBe(true)
    expect(drawn('ev.gov.clerk')).toBe(false)
    // the internal reason of the referral stays off the citizen's copy
    expect(drawn('الطلب من اختصاص دائرة الصحة')).toBe(false)

    // the receiving department approves: its approval document sits next to the referral letter
    expect((await decide(reference, healthClerk, { status: 'APPROVED' })).status).toBe(200)
    const approval = (await approvalDocument(reference)) as Row
    expect(approval.department_id).toBe('dhiqar-health')
    const detail = await request(app).get(`/api/citizen/service-requests/${reference}`).set('Cookie', citizen)
    expect(detail.body.issuedDocuments).toEqual([expect.objectContaining({ id: approval.id, issueEvent: null })])
    expect(detail.body.eventDocuments).toEqual([expect.objectContaining({ id: letter.id, issueEvent: 'REFERRAL' })])
    expect((await verify(letter.verification_id)).body).toMatchObject({ reference, validity: 'VALID' })
  })
})

describe('fee receipt', () => {
  it('recording an office receipt issues «وصل استلام» for that payment, once', async () => {
    const reference = await submitBirthCertificate()
    await verifyDocuments(reference, healthClerk)
    fragments = []
    const recorded = await request(app)
      .post(`/api/employee/service-requests/${reference}/record-office-payment`)
      .set('Cookie', healthClerk)
      .send({ receiptNumber: '7781', amountIqd: 5000 })
    expect(recorded.status).toBe(200)
    const [receipt] = await eventDocuments(reference, 'RECEIPT')
    expect(receipt).toBeTruthy()
    expect(receipt.template_id).toBe('receipt')
    expect(receipt.department_id).toBe('dhiqar-health')
    expect(drawn('5,000')).toBe(true)
    expect(drawn('موظف الاستلام')).toBe(true)
    expect(drawn('ev.health.clerk')).toBe(false)
    const payment = (await db())
      .prepare(`SELECT id FROM payment_intents WHERE provider = 'office' AND receipt_number = '7781'`)
      .get() as { id: string }
    expect(receipt.event_key).toBe(`SR:${reference}:RECEIPT:${payment.id}`)
    const { issueFeeReceipt } = await import('../server/routes/service-requests.ts')
    expect((await issueFeeReceipt(reference, payment.id, 'retry'))?.id).toBe(receipt.id)
    expect(await eventDocuments(reference, 'RECEIPT')).toHaveLength(1)
    const archive = await request(app).get('/api/citizen/issued-documents').set('Cookie', citizen)
    expect((archive.body as Array<Record<string, unknown>>).find(item => item.id === receipt.id)).toMatchObject({
      serviceRequestReference: reference,
      issueEvent: 'RECEIPT',
    })
    const detail = await request(app).get(`/api/citizen/service-requests/${reference}`).set('Cookie', citizen)
    expect(detail.body.eventDocuments).toEqual([expect.objectContaining({ id: receipt.id, issueEvent: 'RECEIPT' })])
    expect((await verify(receipt.verification_id)).body.validity).toBe('VALID')
  })
})

describe('super admin overview', () => {
  it('«طلبات مفتوحة» counts open service requests, not only legacy applications', async () => {
    const count = async () =>
      (await request(app).get('/api/super-admin/overview').set('Cookie', admin)).body.system as Record<string, number>
    const before = await count()
    await submitGovRequest()
    const after = await count()
    expect(after.openServiceRequests).toBe(before.openServiceRequests + 1)
    expect(after.openApplications).toBe(before.openApplications + 1)
    const open = (
      (await db())
        .prepare(`SELECT COUNT(*) AS n FROM service_requests WHERE status NOT IN ('APPROVED', 'REJECTED', 'CANCELLED')`)
        .get() as { n: number }
    ).n
    expect(after.openServiceRequests).toBe(open)
    expect(after.openApplications).toBe(open + after.openLegacyApplications)
  })
})
