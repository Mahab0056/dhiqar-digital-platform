import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()

let app: Express
let admin = ''
let employee = ''
let reviewer = ''
let citizen = ''

async function staffLogin(username: string, password: string) {
  const response = await request(app).post('/api/auth/staff/login').send({ username, password })
  expect(response.status).toBe(200)
  return cookieOf(response)
}

async function createStaff(role: string, username: string, departmentId?: string) {
  const created = await request(app)
    .post('/api/super-admin/staff')
    .set('Cookie', admin)
    .send({ username, fullName: `Test ${username}`, role, departmentId: departmentId ?? null })
  expect(created.status).toBe(201)
  const cookie = await staffLogin(username, created.body.temporaryPassword)
  const changed = await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', cookie)
    .send({ currentPassword: created.body.temporaryPassword, newPassword: `Rotated-${username}-2026!` })
  expect(changed.status).toBe(200)
  return cookie
}

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  // bootstrap admin must rotate the bootstrap password before using the platform
  const first = await staffLogin('admin', 'Bootstrap-Admin-Pass-2026!')
  const blocked = await request(app).get('/api/super-admin/staff').set('Cookie', first)
  expect(blocked.status).toBe(403)
  const rotated = await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', first)
    .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Admin-Rotated-Pass-2026!' })
  expect(rotated.status).toBe(200)
  admin = first
})

describe('health & public', () => {
  it('serves health', async () => {
    const response = await request(app).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body.status).toBe('ok')
  })
  it('lists government services publicly', async () => {
    const response = await request(app).get('/api/government-services')
    expect(response.status).toBe(200)
    expect(Array.isArray(response.body)).toBe(true)
  })
  it('rejects protected routes without a session', async () => {
    expect((await request(app).get('/api/applications')).status).toBe(401)
    expect((await request(app).get('/api/super-admin/overview')).status).toBe(401)
    expect((await request(app).get('/api/citizen/demo')).status).toBe(401)
  })
})

describe('staff accounts & sessions', () => {
  it('creates staff accounts with temporary passwords and enforces rotation', async () => {
    employee = await createStaff('EMPLOYEE', 'emp.one', 'dhiqar-municipalities')
    reviewer = await createStaff('IDENTITY_REVIEWER', 'rev.one')
    const session = await request(app).get('/api/auth/session').set('Cookie', employee)
    expect(session.body.role).toBe('EMPLOYEE')
    expect(session.body.username).toBe('emp.one')
    expect(session.body.mustChangePassword).toBe(false)
  })
  it('rejects weak passwords', async () => {
    const response = await request(app)
      .post('/api/auth/staff/change-password')
      .set('Cookie', employee)
      .send({ currentPassword: 'Rotated-emp.one-2026!', newPassword: 'password123' })
    expect(response.status).toBe(400)
  })
  it('locks the account after repeated failures', async () => {
    for (let i = 0; i < 5; i++)
      await request(app).post('/api/auth/staff/login').send({ username: 'rev.one', password: 'nope' })
    const locked = await request(app)
      .post('/api/auth/staff/login')
      .send({ username: 'rev.one', password: 'Rotated-rev.one-2026!' })
    expect(locked.status).toBe(401)
    expect(locked.body.message).toContain('قفل')
  })
  it('enforces RBAC on super-admin routes', async () => {
    const response = await request(app).get('/api/super-admin/staff').set('Cookie', employee)
    expect(response.status).toBe(401)
  })
  it('revokes sessions on logout', async () => {
    const cookie = await staffLogin('emp.one', 'Rotated-emp.one-2026!')
    expect((await request(app).get('/api/applications').set('Cookie', cookie)).status).toBe(200)
    await request(app).post('/api/auth/logout').set('Cookie', cookie)
    expect((await request(app).get('/api/applications').set('Cookie', cookie)).status).toBe(401)
  })
  it('disabling an account kills its sessions', async () => {
    const cookie = await createStaff('EMPLOYEE', 'emp.two')
    const list = await request(app).get('/api/super-admin/staff').set('Cookie', admin)
    const account = list.body.accounts.find((item: { username: string }) => item.username === 'emp.two')
    const disabled = await request(app)
      .post(`/api/super-admin/staff/${account.id}/status`)
      .set('Cookie', admin)
      .send({ status: 'DISABLED' })
    expect(disabled.status).toBe(200)
    expect((await request(app).get('/api/applications').set('Cookie', cookie)).status).toBe(401)
    const login = await request(app)
      .post('/api/auth/staff/login')
      .send({ username: 'emp.two', password: 'Rotated-emp.two-2026!' })
    expect(login.status).toBe(401)
  })
  it('cannot disable the last super admin', async () => {
    const list = await request(app).get('/api/super-admin/staff').set('Cookie', admin)
    const me = list.body.accounts.find((item: { username: string }) => item.username === 'admin')
    const response = await request(app)
      .post(`/api/super-admin/staff/${me.id}/status`)
      .set('Cookie', admin)
      .send({ status: 'DISABLED' })
    expect(response.status).toBe(409)
  })
})

describe('MFA (TOTP)', () => {
  it('enrolls, requires code on login, blocks replay', async () => {
    const { totpCode } = await import('../server/auth/totp.ts')
    const cookie = await createStaff('OPERATIONS', 'ops.one')
    const setup = await request(app).post('/api/auth/staff/mfa/setup').set('Cookie', cookie)
    expect(setup.status).toBe(200)
    const secret = setup.body.secret as string
    const confirm = await request(app)
      .post('/api/auth/staff/mfa/confirm')
      .set('Cookie', cookie)
      .send({ code: totpCode(secret) })
    expect(confirm.status).toBe(200)

    const login = await request(app)
      .post('/api/auth/staff/login')
      .send({ username: 'ops.one', password: 'Rotated-ops.one-2026!' })
    expect(login.body.mfaRequired).toBe(true)
    // same time-step code was consumed during enrollment -> replay rejected
    const replay = await request(app)
      .post('/api/auth/staff/mfa')
      .send({ challengeToken: login.body.challengeToken, code: totpCode(secret) })
    expect(replay.status).toBe(401)
    const future = await request(app)
      .post('/api/auth/staff/mfa')
      .send({ challengeToken: login.body.challengeToken, code: totpCode(secret, Date.now() + 30_000) })
    expect(future.status).toBe(200)
    expect(future.body.role).toBe('OPERATIONS')
  })
})

describe('citizen onboarding (OTP dev mode)', () => {
  it('creates a citizen session via OTP', async () => {
    const requested = await request(app).post('/api/onboarding/request-otp').send({ phone: '07801234567' })
    expect(requested.status).toBe(201)
    const verified = await request(app)
      .post('/api/onboarding/verify-phone')
      .send({ phone: '07801234567', challengeId: requested.body.challengeId, otp: '246810' })
    expect(verified.status).toBe(200)
    citizen = cookieOf(verified)
    const profile = await request(app).get('/api/citizen/demo').set('Cookie', citizen)
    expect(profile.status).toBe(200)
  })
  it('rejects a wrong OTP', async () => {
    const requested = await request(app).post('/api/onboarding/request-otp').send({ phone: '07809876543' })
    const verified = await request(app)
      .post('/api/onboarding/verify-phone')
      .send({ phone: '07809876543', challengeId: requested.body.challengeId, otp: '000000' })
    expect(verified.status).toBe(400)
  })
})

describe('application workflow', () => {
  let reference = ''
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)])
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])
  it('unverified citizen cannot submit', async () => {
    const response = await request(app)
      .post('/api/applications')
      .set('Cookie', citizen)
      .field('serviceKey', 'store-license')
      .field('serviceName', 'إجازة فتح محل')
      .field('department', 'مديرية بلديات ذي قار')
      .field('businessName', 'متجر الاختبار')
      .field('activityType', 'تجزئة')
      .field('address', 'الناصرية - شارع الحبوبي')
      .field('district', 'الناصرية')
      .field('ownershipType', 'rent')
      .field('coordinates', JSON.stringify({ lat: 31.05, lng: 46.25 }))
      .field('fee', '75000')
      .field('faceConsent', 'true')
      .attach('propertyDocument', pdf, { filename: 'lease.pdf', contentType: 'application/pdf' })
      .attach('storefrontPhoto', jpeg, { filename: 'front.jpg', contentType: 'image/jpeg' })
      .attach('faceVideo', webm, { filename: 'face.webm', contentType: 'video/webm' })
    expect(response.status).toBe(409)
  })
  it('verified citizen submits a store license application', async () => {
    const { db } = await import('../server/db.ts')
    db.prepare(`UPDATE citizens SET verification_status = 'VERIFIED_MANUAL'`).run()
    const response = await request(app)
      .post('/api/applications')
      .set('Cookie', citizen)
      .field('serviceKey', 'store-license')
      .field('serviceName', 'إجازة فتح محل')
      .field('department', 'مديرية بلديات ذي قار')
      .field('businessName', 'متجر الاختبار')
      .field('activityType', 'تجزئة')
      .field('address', 'الناصرية - شارع الحبوبي')
      .field('district', 'الناصرية')
      .field('ownershipType', 'rent')
      .field('coordinates', JSON.stringify({ lat: 31.05, lng: 46.25 }))
      .field('fee', '75000')
      .field('faceConsent', 'true')
      .attach('propertyDocument', pdf, { filename: 'lease.pdf', contentType: 'application/pdf' })
      .attach('storefrontPhoto', jpeg, { filename: 'front.jpg', contentType: 'image/jpeg' })
      .attach('faceVideo', webm, { filename: 'face.webm', contentType: 'video/webm' })
    expect([200, 201]).toContain(response.status)
    reference = response.body.reference
    expect(reference).toMatch(/^TQD-/)
  })
  it('employee requests a document and cannot approve while ACTION_REQUIRED', async () => {
    employee = await staffLogin('emp.one', 'Rotated-emp.one-2026!')
    const requested = await request(app)
      .post(`/api/applications/${reference}/request-document`)
      .set('Cookie', employee)
      .send({ documentName: 'عقد الإيجار' })
    expect(requested.status).toBe(200)
    expect(requested.body.status).toBe('ACTION_REQUIRED')
    const approve = await request(app).post(`/api/applications/${reference}/approve`).set('Cookie', employee)
    expect(approve.status).toBe(409)
  })
  it('rejects a rejection without a reason and accepts a justified one', async () => {
    const noReason = await request(app)
      .post(`/api/applications/${reference}/reject`)
      .set('Cookie', employee)
      .send({ reason: 'قصير' })
    expect(noReason.status).toBe(400)
    // citizen completes the requested document first (status back to UNDER_REVIEW is not required for rejection)
    const rejected = await request(app)
      .post(`/api/applications/${reference}/reject`)
      .set('Cookie', employee)
      .send({ reason: 'الموقع ضمن منطقة سكنية لا يُسمح فيها بالنشاط التجاري المطلوب.' })
    expect(rejected.status).toBe(200)
    expect(rejected.body.status).toBe('REJECTED')
    expect(rejected.body.rejectionReason).toContain('منطقة سكنية')
    expect(rejected.body.decidedBy).toContain('emp.one')
    const approveAfter = await request(app).post(`/api/applications/${reference}/approve`).set('Cookie', employee)
    expect(approveAfter.status).toBe(409)
    const citizenView = await request(app).get(`/api/applications/${reference}`).set('Cookie', citizen)
    expect(citizenView.status).toBe(200)
    expect(citizenView.body.status).toBe('REJECTED')
    const notifications = await request(app).get('/api/citizen/notifications').set('Cookie', citizen)
    expect(JSON.stringify(notifications.body)).toContain('رُفضت')
  })
  it('audit log records the real employee', async () => {
    const logs = await request(app).get('/api/super-admin/audit-logs?action=DOCUMENT_REQUESTED').set('Cookie', admin)
    expect(logs.status).toBe(200)
    expect(logs.body[0].actor).toContain('emp.one')
  })
  it('citizen cannot read another citizen application', async () => {
    const other = await request(app).post('/api/onboarding/request-otp').send({ phone: '07701112233' })
    const verified = await request(app)
      .post('/api/onboarding/verify-phone')
      .send({ phone: '07701112233', challengeId: other.body.challengeId, otp: '246810' })
    const response = await request(app).get(`/api/applications/${reference}`).set('Cookie', cookieOf(verified))
    expect([403, 404]).toContain(response.status)
  })
})

describe('identity review permissions', () => {
  it('employee can list reviews but only reviewer/super admin can decide', async () => {
    const list = await request(app).get('/api/admin/identity-reviews').set('Cookie', employee)
    expect(list.status).toBe(200)
    const decision = await request(app)
      .post('/api/admin/identity-reviews/nonexistent/decision')
      .set('Cookie', employee)
      .send({ decision: 'APPROVED', notes: '' })
    expect(decision.status).toBe(403)
    const asAdmin = await request(app)
      .post('/api/admin/identity-reviews/nonexistent/decision')
      .set('Cookie', admin)
      .send({ decision: 'APPROVED', notes: '' })
    expect(asAdmin.status).toBe(404)
  })
})

describe('catalog-driven online services', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)])
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])
  const serviceKey = 'muni-dir-complaint-against-municipality'
  let reference = ''
  let otherDepartmentEmployee = ''

  it('exposes the public catalog with documents and honest fee status', async () => {
    const summary = await request(app).get('/api/services/summary')
    expect(summary.status).toBe(200)
    expect(summary.body.total).toBeGreaterThan(300)
    const service = await request(app).get(`/api/services/${serviceKey}`)
    expect(service.status).toBe(200)
    expect(service.body.departmentId).toBe('dhiqar-municipalities')
    expect(service.body.requiredDocuments.some((doc: { key: string }) => doc.key === 'national-id')).toBe(true)
    expect(['OFFICIAL', 'UNVERIFIED', 'NOT_REQUIRED']).toContain(service.body.feeStatus)
    if (service.body.feeStatus !== 'OFFICIAL') expect(service.body.feeIqd).toBeNull()
    const search = await request(app).get('/api/services?q=' + encodeURIComponent('شكوى خدمية بلدية'))
    expect(search.body.items.some((item: { key: string }) => item.key === serviceKey)).toBe(true)
    expect((await request(app).get('/api/services/does-not-exist')).status).toBe(404)
  })

  it('rejects a submission missing a required document', async () => {
    const response = await request(app)
      .post('/api/service-requests')
      .set('Cookie', citizen)
      .field('serviceKey', serviceKey)
      .field(
        'data',
        JSON.stringify({
          phone: '07801234567',
          district: 'الناصرية',
          municipality: 'الناصرية',
          details: 'تأخر رفع النفايات',
        })
      )
      .field('faceConsent', 'true')
      .field('documentConsent', 'true')
      .attach('faceVideo', webm, { filename: 'face.webm', contentType: 'video/webm' })
    expect(response.status).toBe(400)
    expect(response.body.message).toContain('مطلوب')
  })

  it('accepts a complete submission and routes it to the department queue', async () => {
    const response = await request(app)
      .post('/api/service-requests')
      .set('Cookie', citizen)
      .field('serviceKey', serviceKey)
      .field(
        'data',
        JSON.stringify({
          phone: '07801234567',
          district: 'الناصرية',
          municipality: 'الناصرية',
          details: 'تأخر رفع النفايات',
        })
      )
      .field('faceConsent', 'true')
      .field('documentConsent', 'true')
      .attach('doc__national-id', jpeg, { filename: 'id.jpg', contentType: 'image/jpeg' })
      .attach('doc__supporting-evidence', pdf, { filename: 'evidence.pdf', contentType: 'application/pdf' })
      .attach('faceVideo', webm, { filename: 'face.webm', contentType: 'video/webm' })
    expect(response.status).toBe(201)
    reference = response.body.reference
    expect(reference).toMatch(/^TQS-/)
    expect(response.body.department).toContain('بلديات')
    const mine = await request(app).get('/api/citizen/service-requests').set('Cookie', citizen)
    const item = mine.body.find((entry: { reference: string }) => entry.reference === reference)
    expect(item.formData.fullName).toBeTruthy()
    expect(item.checklist.find((doc: { key: string }) => doc.key === 'national-id').status).toBe('UPLOADED')
    expect(item.checklist.find((doc: { key: string }) => doc.key === 'transaction-ref').status).toBe('MISSING')
  })

  it('scopes the employee queue to the employee department', async () => {
    otherDepartmentEmployee = await createStaff('EMPLOYEE', 'emp.health', 'dhiqar-health')
    const own = await request(app).get('/api/employee/service-requests').set('Cookie', employee)
    expect(own.status).toBe(200)
    expect(own.body.scope).toBe('dhiqar-municipalities')
    expect(own.body.items.some((item: { reference: string }) => item.reference === reference)).toBe(true)
    const other = await request(app).get('/api/employee/service-requests').set('Cookie', otherDepartmentEmployee)
    expect(other.body.items.some((item: { reference: string }) => item.reference === reference)).toBe(false)
    const forbidden = await request(app)
      .get(`/api/employee/service-requests/${reference}`)
      .set('Cookie', otherDepartmentEmployee)
    expect(forbidden.status).toBe(403)
    const all = await request(app).get('/api/employee/service-requests').set('Cookie', admin)
    expect(all.body.scope).toBe('ALL')
  })

  it('blocks approval until every required document is verified, then issues a document', async () => {
    const early = await request(app)
      .patch(`/api/employee/service-requests/${reference}`)
      .set('Cookie', employee)
      .send({ status: 'APPROVED' })
    expect(early.status).toBe(409)
    const rejectNoNote = await request(app)
      .patch(`/api/employee/service-requests/${reference}/documents/national-id`)
      .set('Cookie', employee)
      .send({ status: 'REJECTED' })
    expect(rejectNoNote.status).toBe(400)
    const rejected = await request(app)
      .patch(`/api/employee/service-requests/${reference}/documents/national-id`)
      .set('Cookie', employee)
      .send({ status: 'REJECTED', note: 'الصورة غير واضحة' })
    expect(rejected.status).toBe(200)
    expect(rejected.body.status).toBe('UNDER_REVIEW')
    const sendBack = await request(app)
      .patch(`/api/employee/service-requests/${reference}`)
      .set('Cookie', employee)
      .send({ status: 'ACTION_REQUIRED' })
    expect(sendBack.status).toBe(200)
    expect(sendBack.body.status).toBe('ACTION_REQUIRED')
    expect(sendBack.body.currentAction).toContain('غير واضحة')
    const reupload = await request(app)
      .post(`/api/citizen/service-requests/${reference}/upload-document`)
      .set('Cookie', citizen)
      .field('documentKey', 'national-id')
      .attach('document', jpeg, { filename: 'id2.jpg', contentType: 'image/jpeg' })
    expect(reupload.status).toBe(200)
    expect(reupload.body.status).toBe('UNDER_REVIEW')
    const verified = await request(app)
      .patch(`/api/employee/service-requests/${reference}/documents/national-id`)
      .set('Cookie', employee)
      .send({ status: 'VERIFIED' })
    expect(verified.status).toBe(200)
    const media = verified.body.checklist.find((doc: { key: string }) => doc.key === 'national-id').mediaId
    const view = await request(app)
      .get(`/api/employee/service-requests/${reference}/media/${media}`)
      .set('Cookie', employee)
    expect(view.status).toBe(200)
    const viewForbidden = await request(app)
      .get(`/api/employee/service-requests/${reference}/media/${media}`)
      .set('Cookie', otherDepartmentEmployee)
    expect(viewForbidden.status).toBe(403)
    const approved = await request(app)
      .patch(`/api/employee/service-requests/${reference}`)
      .set('Cookie', employee)
      .send({ status: 'APPROVED' })
    expect(approved.status).toBe(200)
    expect(approved.body.status).toBe('APPROVED')
    expect(approved.body.decidedBy).toContain('emp.one')
    const documents = await request(app).get('/api/citizen/issued-documents').set('Cookie', citizen)
    expect(
      documents.body.some((doc: { serviceRequestReference: string }) => doc.serviceRequestReference === reference)
    ).toBe(true)
    const closed = await request(app)
      .post(`/api/citizen/service-requests/${reference}/upload-document`)
      .set('Cookie', citizen)
      .field('documentKey', 'national-id')
      .attach('document', jpeg, { filename: 'id3.jpg', contentType: 'image/jpeg' })
    expect(closed.status).toBe(409)
  })

  it('refuses information-only services and inactive services', async () => {
    const info = await request(app).get('/api/services?channel=INFORMATION_ONLY')
    const key = info.body.items[0]?.key
    expect(key).toBeTruthy()
    const response = await request(app)
      .post('/api/service-requests')
      .set('Cookie', citizen)
      .field('serviceKey', key)
      .field('data', '{}')
      .field('faceConsent', 'true')
      .attach('faceVideo', webm, { filename: 'face.webm', contentType: 'video/webm' })
    expect(response.status).toBe(409)
  })
})
