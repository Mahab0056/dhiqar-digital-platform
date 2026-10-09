// Regression tests for the defects found in the 2026-10-09 platform QA (docs/audit/PLATFORM_QA_2026-10-09.md).
import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()

let app: Express
let admin = ''
let citizen = ''
let healthEmployee = ''

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)])
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])

async function staffLogin(username: string, password: string) {
  const response = await request(app).post('/api/auth/staff/login').send({ username, password })
  expect(response.status).toBe(200)
  return cookieOf(response)
}

async function createStaff(role: string, username: string, departmentId: string | null) {
  const created = await request(app)
    .post('/api/super-admin/staff')
    .set('Cookie', admin)
    .send({ username, fullName: `Test ${username}`, role, departmentId })
  expect(created.status).toBe(201)
  const cookie = await staffLogin(username, created.body.temporaryPassword)
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', cookie)
    .send({ currentPassword: created.body.temporaryPassword, newPassword: `Rotated-${username}-2026!` })
  return cookie
}

async function citizenSession(phone: string) {
  const requested = await request(app).post('/api/onboarding/request-otp').send({ phone })
  const verified = await request(app)
    .post('/api/onboarding/verify-phone')
    .send({ phone, challengeId: requested.body.challengeId, otp: '246810' })
  expect(verified.status).toBe(200)
  return cookieOf(verified)
}

function birthCertificate(clientRequestId?: string) {
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
  if (clientRequestId) req = req.field('clientRequestId', clientRequestId)
  for (const key of ['hospital-birth-report', 'father-id', 'mother-id', 'marriage-contract', 'residence-card'])
    req = req.attach(`doc__${key}`, jpeg, { filename: `${key}.jpg`, contentType: 'image/jpeg' })
  return req.attach('faceVideo', webm, { filename: 'face.webm', contentType: 'video/webm' })
}

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  const first = await staffLogin('admin', 'Bootstrap-Admin-Pass-2026!')
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', first)
    .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Admin-Rotated-Pass-2026!' })
  admin = first
  citizen = await citizenSession('07801230001')
  const { db } = await import('../server/db.ts')
  db.prepare(`UPDATE citizens SET verification_status = 'VERIFIED_MANUAL'`).run()
  healthEmployee = await createStaff('EMPLOYEE', 'qa.health', 'dhiqar-health')
})

describe('fresh database', () => {
  it('contains no fabricated demo citizen', async () => {
    const { db } = await import('../server/db.ts')
    const seeded = db.prepare(`SELECT COUNT(*) AS n FROM citizens WHERE account_key IS NULL`).get() as { n: number }
    expect(seeded.n).toBe(0)
  })
})

describe('service request idempotency', () => {
  it('a double submit with the same form key creates one request', async () => {
    const key = 'qa-idem-0001-abcdef'
    const { db } = await import('../server/db.ts')
    const before = (db.prepare('SELECT COUNT(*) AS n FROM service_requests').get() as { n: number }).n
    const first = await birthCertificate(key)
    const second = await birthCertificate(key)
    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    expect(second.body.duplicate).toBe(true)
    expect(second.body.reference).toBe(first.body.reference)
    expect(second.body.payment.reference).toBe(first.body.payment.reference)
    const after = (db.prepare('SELECT COUNT(*) AS n FROM service_requests').get() as { n: number }).n
    expect(after - before).toBe(1)
    // another citizen reusing the same key gets their own request, never someone else's
    const other = citizen
    citizen = await citizenSession('07801230002')
    db.prepare(`UPDATE citizens SET verification_status = 'VERIFIED_MANUAL'`).run()
    const third = await birthCertificate(key)
    expect(third.status).toBe(201)
    expect(third.body.reference).not.toBe(first.body.reference)
    citizen = other
  })
})

describe('unpaid fees block approval', () => {
  it('a cancelled or failed payment never lets the department approve', async () => {
    const created = await birthCertificate()
    expect(created.body.status).toBe('PAYMENT_PENDING')
    const reference = created.body.reference as string
    const payment = created.body.payment.reference as string
    const cancelled = await request(app)
      .post(`/api/citizen/payments/${payment}/sandbox-confirm`)
      .set('Cookie', citizen)
      .send({ outcome: 'CANCELLED' })
    expect(cancelled.body.status).toBe('CANCELLED')
    for (const key of ['hospital-birth-report', 'father-id', 'mother-id', 'marriage-contract', 'residence-card'])
      await request(app)
        .patch(`/api/employee/service-requests/${reference}/documents/${key}`)
        .set('Cookie', healthEmployee)
        .send({ status: 'VERIFIED' })
    const approve = await request(app)
      .patch(`/api/employee/service-requests/${reference}`)
      .set('Cookie', healthEmployee)
      .send({ status: 'APPROVED' })
    expect(approve.status).toBe(409)
    const extraFee = await request(app)
      .patch(`/api/employee/service-requests/${reference}`)
      .set('Cookie', healthEmployee)
      .send({ status: 'PAYMENT_REQUIRED', amountIqd: 1000 })
    expect(extraFee.status).toBe(409)
    // the citizen retries the same intent and pays → approval goes through with one document
    const paid = await request(app)
      .post(`/api/citizen/payments/${payment}/sandbox-confirm`)
      .set('Cookie', citizen)
      .send({ outcome: 'PAID' })
    expect(paid.body.status).toBe('PAID')
    const [a, b] = await Promise.all([
      request(app)
        .patch(`/api/employee/service-requests/${reference}`)
        .set('Cookie', healthEmployee)
        .send({ status: 'APPROVED' }),
      request(app)
        .patch(`/api/employee/service-requests/${reference}`)
        .set('Cookie', healthEmployee)
        .send({ status: 'APPROVED' }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const { db } = await import('../server/db.ts')
    const issued = db
      .prepare('SELECT COUNT(*) AS n FROM issued_documents WHERE service_request_reference = ?')
      .get(reference) as { n: number }
    expect(issued.n).toBe(1)
  })
})

describe('client errors are 4xx, not 500', () => {
  it('malformed JSON is a 400', async () => {
    const response = await request(app)
      .post('/api/citizen/location')
      .set('Cookie', citizen)
      .set('Content-Type', 'application/json')
      .send('{bad json')
    expect(response.status).toBe(400)
  })
  it('a disallowed upload type is a 400', async () => {
    const response = await request(app)
      .post('/api/citizen/feedback')
      .set('Cookie', citizen)
      .field('kind', 'COMPLAINT')
      .field('category', 'خدمات')
      .field('subject', 'شكوى اختبار')
      .field('description', 'وصف شكوى اختبار طويل بما يكفي للتحقق.')
      .attach('attachments', Buffer.from('<html></html>'), { filename: 'x.html', contentType: 'text/html' })
    expect(response.status).toBe(400)
  })
  it('an attachment that fails validation leaves no half-saved complaint', async () => {
    const { db } = await import('../server/db.ts')
    const before = (db.prepare('SELECT COUNT(*) AS n FROM citizen_feedback').get() as { n: number }).n
    const response = await request(app)
      .post('/api/citizen/feedback')
      .set('Cookie', citizen)
      .field('kind', 'COMPLAINT')
      .field('category', 'خدمات')
      .field('subject', 'شكوى اختبار')
      .field('description', 'وصف شكوى اختبار طويل بما يكفي للتحقق.')
      .attach('attachments', Buffer.from('<svg/>'), { filename: 'x.png', contentType: 'image/png' })
    expect(response.status).toBe(400)
    const after = (db.prepare('SELECT COUNT(*) AS n FROM citizen_feedback').get() as { n: number }).n
    expect(after).toBe(before)
    void pdf
  })
})

describe('authorization hardening', () => {
  it('push subscriptions only accept real browser push services', async () => {
    const keys = { p256dh: 'p256dh-key-value', auth: 'auth-value' }
    for (const endpoint of [
      'http://127.0.0.1:8787/api/health',
      'https://169.254.169.254/latest/meta-data',
      'https://fcm.googleapis.com.evil.example/x',
      'https://fcm.googleapis.com:8443/x',
    ]) {
      const response = await request(app)
        .post('/api/citizen/push/subscribe')
        .set('Cookie', citizen)
        .send({ endpoint, keys })
      expect(response.status).toBe(400)
    }
    const ok = await request(app)
      .post('/api/citizen/push/subscribe')
      .set('Cookie', citizen)
      .send({ endpoint: 'https://fcm.googleapis.com/fcm/send/qa-token', keys })
    expect(ok.status).toBe(200)
  })
  it('department employees cannot read the province-wide request feed or camera registry', async () => {
    expect((await request(app).get('/api/operations/new-request-alerts').set('Cookie', healthEmployee)).status).toBe(
      401
    )
    expect((await request(app).get('/api/operations/cameras').set('Cookie', healthEmployee)).status).toBe(401)
    expect((await request(app).get('/api/operations/new-request-alerts').set('Cookie', admin)).status).toBe(200)
  })
})

describe('Arabic-Indic digits', () => {
  it('phone and OTP typed with Arabic keyboard digits are accepted', async () => {
    const requested = await request(app).post('/api/onboarding/request-otp').send({ phone: '٠٧٨٠١٢٣٠٠٠٩' })
    expect(requested.status).toBe(201)
    const verified = await request(app)
      .post('/api/onboarding/verify-phone')
      .send({ phone: '٠٧٨٠١٢٣٠٠٠٩', challengeId: requested.body.challengeId, otp: '٢٤٦٨١٠' })
    expect(verified.status).toBe(200)
    // the same number typed with Latin digits is the same account
    const latin = await citizenSession('07801230009')
    const a = await request(app).get('/api/citizen/demo').set('Cookie', cookieOf(verified))
    const b = await request(app).get('/api/citizen/demo').set('Cookie', latin)
    expect(a.body.id).toBe(b.body.id)
  })
})

describe('super admin edits of required documents', () => {
  it('reach the citizen form checklist and survive the boot-time catalog seed', async () => {
    const before = await request(app).get('/api/services/gov-complaint')
    const keep = before.body.requiredDocuments[0]
    const edited = await request(app)
      .patch('/api/super-admin/platform-services/gov-complaint')
      .set('Cookie', admin)
      .send({ requiredDocuments: [keep.label, 'كتاب تأييد من المختار'] })
    expect(edited.status).toBe(200)
    const after = await request(app).get('/api/services/gov-complaint')
    expect(after.body.requiredDocuments.map((doc: { label: string }) => doc.label)).toEqual([
      keep.label,
      'كتاب تأييد من المختار',
    ])
    expect(after.body.requiredDocuments[0].key).toBe(keep.key)
    const { seedServiceCatalog } = await import('../server/services/catalog.ts')
    seedServiceCatalog()
    const reseeded = await request(app).get('/api/services/gov-complaint')
    expect(reseeded.body.requiredDocuments.length).toBe(2)
  })
})
