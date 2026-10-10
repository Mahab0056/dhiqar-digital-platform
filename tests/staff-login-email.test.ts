// Staff sign-in with a one-time email code, plus the super admin's management of staff emails.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()

let app: Express
type Mail = { to: string; subject: string; html: string; text: string }
const outbox: Mail[] = []
let staff: typeof import('../server/auth/staff.ts')
let db: (typeof import('../server/db.ts'))['db']

const requestCode = (email: string) => request(app).post('/api/auth/staff/email/request').send({ email })
const verifyCode = (email: string, code: string) =>
  request(app).post('/api/auth/staff/email/verify').send({ email, code })
const codeIn = (mail: Mail) => mail.text.match(/\b(\d{6})\b/)![1]
/** Lifts the resend cooldown / hourly caps between steps of a test. */
const ageRequests = () =>
  db
    .prepare(`UPDATE staff_email_login_requests SET created_at = ?`)
    .run(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  staff = await import('../server/auth/staff.ts')
  db = (await import('../server/db.ts')).db
  const mailer = await import('../server/auth/mailer.ts')
  mailer.setMailTransport(async message => {
    outbox.push(message)
  })
  staff.createStaff({
    username: 'mail.worker',
    fullName: 'موظفة البريد',
    role: 'EMPLOYEE',
    email: 'worker@thi-qar.com',
  })
  staff.createStaff({ username: 'mail.ops', fullName: 'مشغل العمليات', role: 'OPERATIONS', email: 'ops@thi-qar.com' })
})

beforeEach(() => {
  outbox.length = 0
  ageRequests()
})

describe('email code sign-in', () => {
  it('is advertised by the methods endpoint', async () => {
    expect((await request(app).get('/api/auth/staff/methods')).body).toEqual({
      password: true,
      google: false,
      email: true,
    })
  })

  it('answers unknown and known addresses identically, sending mail only to the linked account', async () => {
    const unknown = await requestCode('nobody@thi-qar.com')
    const known = await requestCode('Worker@Thi-Qar.com')
    expect(unknown.status).toBe(200)
    expect(known.status).toBe(200)
    expect(unknown.body).toEqual(known.body)
    expect(outbox).toHaveLength(1)
    expect(outbox[0].to).toBe('worker@thi-qar.com')
    expect(outbox[0].html).toContain('ذي قار الرقمية')
    expect(outbox[0].html).toContain('dir="rtl"')
    expect(outbox[0].subject).not.toMatch(/\d{6}/)
  })

  it('signs in with the right code, once', async () => {
    await requestCode('worker@thi-qar.com')
    const code = codeIn(outbox[0])
    const wrong = await verifyCode('worker@thi-qar.com', code === '000000' ? '111111' : '000000')
    expect(wrong.status).toBe(401)
    const ok = await verifyCode('worker@thi-qar.com', code)
    expect(ok.status).toBe(200)
    expect(ok.body.role).toBe('EMPLOYEE')
    expect(ok.body.mustChangePassword).toBe(false)
    const session = await request(app).get('/api/auth/session').set('Cookie', cookieOf(ok))
    expect(session.body.username).toBe('mail.worker')
    // the wrong attempt was forgiven by the success
    expect(staff.getStaffByUsername('mail.worker')!.failedAttempts).toBe(0)
    // single use
    expect((await verifyCode('worker@thi-qar.com', code)).status).toBe(401)
  })

  it('throttles repeated requests for the same address', async () => {
    expect((await requestCode('ops@thi-qar.com')).status).toBe(200)
    const again = await requestCode('ops@thi-qar.com')
    expect(again.status).toBe(429)
    expect(again.body.retryAfterSeconds).toBeGreaterThan(0)
    // unknown addresses are throttled the same way
    await requestCode('ghost@thi-qar.com')
    expect((await requestCode('ghost@thi-qar.com')).status).toBe(429)
  })

  it('retires the previous code when a new one is requested', async () => {
    await requestCode('ops@thi-qar.com')
    const first = codeIn(outbox[0])
    ageRequests()
    await requestCode('ops@thi-qar.com')
    const second = codeIn(outbox[1])
    if (first !== second) expect((await verifyCode('ops@thi-qar.com', first)).status).toBe(401)
    const ok = await verifyCode('ops@thi-qar.com', second)
    expect(ok.status).toBe(200)
    expect(ok.body.role).toBe('OPERATIONS')
  })

  it('rejects expired codes', async () => {
    await requestCode('ops@thi-qar.com')
    db.prepare(`UPDATE staff_email_login_codes SET expires_at = ? WHERE consumed_at IS NULL`).run(
      new Date(Date.now() - 1000).toISOString()
    )
    expect((await verifyCode('ops@thi-qar.com', codeIn(outbox[0]))).status).toBe(401)
  })

  it('allows at most 5 attempts per code and feeds the account lockout', async () => {
    await requestCode('ops@thi-qar.com')
    const code = codeIn(outbox[0])
    const bad = code === '123456' ? '654321' : '123456'
    for (let i = 0; i < 5; i++) expect((await verifyCode('ops@thi-qar.com', bad)).status).toBe(401)
    const account = staff.getStaffByUsername('mail.ops')!
    expect(account.lockedUntil).not.toBeNull()
    // even after the lock is lifted, the exhausted code stays dead
    staff.clearFailedStaffAttempts(account.id)
    expect((await verifyCode('ops@thi-qar.com', code)).status).toBe(401)
  })

  it('sends nothing to disabled accounts but answers the same', async () => {
    const account = staff.getStaffByUsername('mail.worker')!
    staff.setStaffStatus(account.id, 'DISABLED')
    const res = await requestCode('worker@thi-qar.com')
    expect(res.status).toBe(200)
    expect(outbox).toHaveLength(0)
    staff.setStaffStatus(account.id, 'ACTIVE')
  })

  it('goes through the TOTP step when MFA is enabled', async () => {
    const { totpCode } = await import('../server/auth/totp.ts')
    const account = staff.getStaffByUsername('mail.worker')!
    const secret = staff.beginTotpEnrollment(account.id)
    staff.confirmTotpEnrollment(account.id, totpCode(secret))
    await requestCode('worker@thi-qar.com')
    const step = await verifyCode('worker@thi-qar.com', codeIn(outbox[0]))
    expect(step.status).toBe(200)
    expect(step.body.mfaRequired).toBe(true)
    expect(cookieOf(step)).not.toContain('dhiqar_session=')
    const mfa = await request(app)
      .post('/api/auth/staff/mfa')
      .send({ challengeToken: step.body.challengeToken, code: totpCode(secret, Date.now() + 30_000) })
    expect(mfa.status).toBe(200)
    expect(mfa.body.mustChangePassword).toBe(false)
    staff.disableTotp(account.id)
  })

  it('never stores or audits the code in clear', async () => {
    await requestCode('worker@thi-qar.com')
    const code = codeIn(outbox[0])
    const stored = JSON.stringify(db.prepare(`SELECT * FROM staff_email_login_codes`).all())
    const audits = JSON.stringify(db.prepare(`SELECT * FROM audit_logs WHERE action LIKE 'STAFF_EMAIL%'`).all())
    expect(stored).not.toContain(`"${code}"`)
    expect(audits).not.toContain(code)
  })

  it('is hidden in production without a mail provider', async () => {
    const mailer = await import('../server/auth/mailer.ts')
    const { emailLoginAvailable } = await import('../server/auth/email-login.ts')
    mailer.setMailTransport(null)
    process.env.NODE_ENV = 'production'
    try {
      expect(emailLoginAvailable()).toBe(false)
      process.env.RESEND_API_KEY = 're_test'
      process.env.MAIL_FROM = 'ذي قار الرقمية <no-reply@thi-qar.com>'
      expect(mailer.mailProvider()).toBe('resend')
    } finally {
      process.env.NODE_ENV = 'test'
      delete process.env.RESEND_API_KEY
      delete process.env.MAIL_FROM
      mailer.setMailTransport(async message => {
        outbox.push(message)
      })
    }
  })
})

describe('super admin manages staff emails', () => {
  let adminCookie = ''
  beforeAll(async () => {
    const login = await request(app)
      .post('/api/auth/staff/login')
      .send({ username: 'admin', password: 'Bootstrap-Admin-Pass-2026!' })
    adminCookie = cookieOf(login)
    await request(app)
      .post('/api/auth/staff/change-password')
      .set('Cookie', adminCookie)
      .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Changed-Admin-Pass-2026!' })
  })

  it('password sessions still require the temporary password change', async () => {
    const created = staff.createStaff({ username: 'temp.user', fullName: 'موظف مؤقت', role: 'EMPLOYEE' })
    const login = await request(app)
      .post('/api/auth/staff/login')
      .send({ username: 'temp.user', password: created.temporaryPassword })
    expect(login.body.mustChangePassword).toBe(true)
  })

  it('creates an account with a normalized email and rejects duplicates', async () => {
    const created = await request(app)
      .post('/api/super-admin/staff')
      .set('Cookie', adminCookie)
      .send({ username: 'new.hire', fullName: 'موظف جديد', role: 'OPERATIONS', email: '  New.Hire@Thi-Qar.com ' })
    expect(created.status).toBe(201)
    expect(created.body.account.email).toBe('new.hire@thi-qar.com')
    const duplicate = await request(app)
      .post('/api/super-admin/staff')
      .set('Cookie', adminCookie)
      .send({ username: 'other.hire', fullName: 'موظف آخر', role: 'EMPLOYEE', email: 'NEW.HIRE@thi-qar.com' })
    expect(duplicate.status).toBe(400)
    const invalid = await request(app)
      .post('/api/super-admin/staff')
      .set('Cookie', adminCookie)
      .send({ username: 'bad.mail', fullName: 'بريد خاطئ', role: 'EMPLOYEE', email: 'not-an-email' })
    expect(invalid.status).toBe(400)
  })

  it('edits, clears and protects uniqueness on update — including the admin’s own email', async () => {
    const admin = staff.getStaffByUsername('admin')!
    const own = await request(app)
      .patch(`/api/super-admin/staff/${admin.id}`)
      .set('Cookie', adminCookie)
      .send({ email: 'Admin@Thi-Qar.com' })
    expect(own.status).toBe(200)
    expect(own.body.account.email).toBe('admin@thi-qar.com')
    const worker = staff.getStaffByUsername('mail.worker')!
    const clash = await request(app)
      .patch(`/api/super-admin/staff/${worker.id}`)
      .set('Cookie', adminCookie)
      .send({ email: 'admin@thi-qar.com' })
    expect(clash.status).toBe(400)
    const cleared = await request(app)
      .patch(`/api/super-admin/staff/${worker.id}`)
      .set('Cookie', adminCookie)
      .send({ email: null })
    expect(cleared.body.account.email).toBeNull()
    const list = await request(app).get('/api/super-admin/staff').set('Cookie', adminCookie)
    expect(list.body.accounts.find((item: { username: string }) => item.username === 'admin').email).toBe(
      'admin@thi-qar.com'
    )
  })

  it('requires a super admin', async () => {
    const res = await request(app).patch('/api/super-admin/staff/whatever').send({ email: 'x@thi-qar.com' })
    expect(res.status).toBe(401)
  })
})
