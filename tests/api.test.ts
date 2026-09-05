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
