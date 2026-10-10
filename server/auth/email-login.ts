// Passwordless staff sign-in with a one-time 6-digit code sent to the email a super admin set on the account.
// Requests always get the same answer (no account enumeration); codes are stored as HMACs, expire after 10 minutes,
// allow 5 attempts, are single use, and a new request retires the previous code. Wrong codes feed the shared lockout.
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { addAudit, db } from '../db.js'
import { sessionSecret } from './session.js'
import {
  clearFailedStaffAttempts,
  getStaffByEmail,
  normalizeEmail,
  registerFailedStaffAttempt,
  staffSignInBlock,
} from './staff.js'
import { mailConfigured, sendMail, staffLoginCodeEmail } from './mailer.js'

export const EMAIL_CODE_TTL_SECONDS = 10 * 60
export const EMAIL_CODE_MAX_ATTEMPTS = 5
export const EMAIL_CODE_RESEND_SECONDS = 60
const PER_EMAIL_PER_HOUR = 5
const PER_IP_WINDOW_MS = 15 * 60 * 1000
const PER_IP_PER_WINDOW = 20

db.exec(`
  CREATE TABLE IF NOT EXISTS staff_email_login_codes (
    id TEXT PRIMARY KEY,
    staff_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (staff_id) REFERENCES staff_accounts(id)
  );
  CREATE INDEX IF NOT EXISTS idx_staff_email_codes_staff ON staff_email_login_codes(staff_id, consumed_at);
  CREATE TABLE IF NOT EXISTS staff_email_login_requests (
    email_hash TEXT NOT NULL,
    ip_hash TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_staff_email_requests_email ON staff_email_login_requests(email_hash, created_at);
  CREATE INDEX IF NOT EXISTS idx_staff_email_requests_ip ON staff_email_login_requests(ip_hash, created_at);
`)

export const emailLoginAvailable = () => mailConfigured()

const keyed = (purpose: string, value: string) =>
  createHmac('sha256', `${sessionSecret()}:${purpose}`).update(value).digest('hex')
const codeHash = (codeId: string, code: string) => keyed('staff-email-code', `${codeId}:${code}`)

export type EmailCodeRequestResult = { status: 'sent' } | { status: 'rate_limited'; retryAfterSeconds: number }

export function requestStaffEmailCode(input: { email: string; ip?: string }): EmailCodeRequestResult {
  const email = normalizeEmail(input.email)
  const emailHash = keyed('staff-email-key', email)
  const ipHash = input.ip ? keyed('staff-email-ip', input.ip) : null
  const nowMs = Date.now()
  const iso = (ms: number) => new Date(ms).toISOString()
  db.prepare(`DELETE FROM staff_email_login_requests WHERE created_at < ?`).run(iso(nowMs - 24 * 60 * 60 * 1000))

  // limits apply to every address alike (known or not), so they reveal nothing about accounts
  const last = db
    .prepare(`SELECT MAX(created_at) AS at FROM staff_email_login_requests WHERE email_hash = ?`)
    .get(emailHash) as { at: string | null }
  if (last.at && nowMs - Date.parse(last.at) < EMAIL_CODE_RESEND_SECONDS * 1000)
    return {
      status: 'rate_limited',
      retryAfterSeconds: Math.ceil((Date.parse(last.at) + EMAIL_CODE_RESEND_SECONDS * 1000 - nowMs) / 1000),
    }
  const perEmail = db
    .prepare(`SELECT COUNT(*) AS n FROM staff_email_login_requests WHERE email_hash = ? AND created_at > ?`)
    .get(emailHash, iso(nowMs - 60 * 60 * 1000)) as { n: number }
  if (Number(perEmail.n) >= PER_EMAIL_PER_HOUR) return { status: 'rate_limited', retryAfterSeconds: 15 * 60 }
  if (ipHash) {
    const perIp = db
      .prepare(`SELECT COUNT(*) AS n FROM staff_email_login_requests WHERE ip_hash = ? AND created_at > ?`)
      .get(ipHash, iso(nowMs - PER_IP_WINDOW_MS)) as { n: number }
    if (Number(perIp.n) >= PER_IP_PER_WINDOW) return { status: 'rate_limited', retryAfterSeconds: 15 * 60 }
  }
  db.prepare(`INSERT INTO staff_email_login_requests (email_hash, ip_hash, created_at) VALUES (?, ?, ?)`).run(
    emailHash,
    ipHash,
    iso(nowMs)
  )

  const account = getStaffByEmail(email)
  if (!account) {
    addAudit({
      actor: 'auth',
      role: 'ANONYMOUS',
      action: 'STAFF_EMAIL_CODE_UNKNOWN_EMAIL',
      entityType: 'StaffAccount',
      entityId: emailHash.slice(0, 16),
      metadata: { ip: input.ip },
    })
    return { status: 'sent' }
  }
  const block = staffSignInBlock(account)
  if (block) {
    addAudit({
      actor: account.username,
      role: 'ANONYMOUS',
      action: 'STAFF_EMAIL_CODE_BLOCKED',
      entityType: 'StaffAccount',
      entityId: account.id,
      metadata: { reason: block.reason, ip: input.ip },
    })
    return { status: 'sent' }
  }

  // one live code per account: a new request retires the previous one
  db.prepare(`UPDATE staff_email_login_codes SET consumed_at = ? WHERE staff_id = ? AND consumed_at IS NULL`).run(
    iso(nowMs),
    account.id
  )
  const codeId = randomUUID()
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  db.prepare(
    `INSERT INTO staff_email_login_codes (id, staff_id, code_hash, attempts, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?)`
  ).run(codeId, account.id, codeHash(codeId, code), iso(nowMs + EMAIL_CODE_TTL_SECONDS * 1000), iso(nowMs))
  addAudit({
    actor: account.username,
    role: 'ANONYMOUS',
    action: 'STAFF_EMAIL_CODE_SENT',
    entityType: 'StaffAccount',
    entityId: account.id,
    metadata: { ip: input.ip },
  })
  // not awaited: the response must take the same time whether or not the address belongs to an account
  void sendMail(
    staffLoginCodeEmail({
      to: email,
      fullName: account.fullName,
      code,
      expiresInMinutes: EMAIL_CODE_TTL_SECONDS / 60,
    }),
    `[staff-email-login] DEV MODE — sign-in code for ${account.username} is ${code}`
  ).catch(error => {
    console.error(`[staff-email-login] delivery failed for ${account.username}: ${(error as Error).message}`)
    addAudit({
      actor: 'auth',
      role: 'SYSTEM',
      action: 'STAFF_EMAIL_CODE_DELIVERY_FAILED',
      entityType: 'StaffAccount',
      entityId: account.id,
    })
  })
  return { status: 'sent' }
}

export type EmailCodeVerifyResult =
  | { ok: true; staffId: string }
  | { ok: false; reason: 'INVALID' | 'LOCKED' | 'DISABLED'; retryAfterSeconds?: number; staffId?: string }

export function verifyStaffEmailCode(input: { email: string; code: string }): EmailCodeVerifyResult {
  const account = getStaffByEmail(input.email)
  if (!account) return { ok: false, reason: 'INVALID' }
  const block = staffSignInBlock(account)
  if (block) return { ok: false, ...block, staffId: account.id }
  const nowIso = new Date().toISOString()
  const row = db
    .prepare(
      `SELECT id, code_hash, attempts, expires_at FROM staff_email_login_codes
       WHERE staff_id = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`
    )
    .get(account.id) as { id: string; code_hash: string; attempts: number; expires_at: string } | undefined
  if (!row || row.expires_at <= nowIso || row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    if (row) db.prepare(`UPDATE staff_email_login_codes SET consumed_at = ? WHERE id = ?`).run(nowIso, row.id)
    return { ok: false, reason: 'INVALID', staffId: account.id }
  }
  const code = input.code.replace(/\D/g, '')
  const expected = Buffer.from(row.code_hash)
  const received = Buffer.from(codeHash(row.id, code))
  if (code.length !== 6 || expected.length !== received.length || !timingSafeEqual(expected, received)) {
    const attempts = row.attempts + 1
    db.prepare(`UPDATE staff_email_login_codes SET attempts = ?, consumed_at = ? WHERE id = ?`).run(
      attempts,
      attempts >= EMAIL_CODE_MAX_ATTEMPTS ? nowIso : null,
      row.id
    )
    const locked = registerFailedStaffAttempt(account.id, 'EMAIL_CODE')
    return locked
      ? { ok: false, reason: 'LOCKED', retryAfterSeconds: 15 * 60, staffId: account.id }
      : { ok: false, reason: 'INVALID', staffId: account.id }
  }
  // single use: consume atomically so two concurrent submissions cannot both succeed
  const consumed = db
    .prepare(`UPDATE staff_email_login_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`)
    .run(nowIso, row.id)
  if (!consumed.changes) return { ok: false, reason: 'INVALID', staffId: account.id }
  clearFailedStaffAttempts(account.id)
  return { ok: true, staffId: account.id }
}
