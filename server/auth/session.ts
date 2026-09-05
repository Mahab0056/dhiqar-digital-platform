import type express from 'express'
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { db, getCitizenById } from '../db.js'
import { isProduction, secureHostedRuntime } from '../config.js'
import { getStaffById, type StaffAccount } from './staff.js'

export type SessionRole = 'CITIZEN' | 'EMPLOYEE' | 'IDENTITY_REVIEWER' | 'OPERATIONS' | 'SUPER_ADMIN'
export type SessionData = {
  /** session id */
  sid: string
  /** stable subject: citizen id for citizens, staff account id for staff */
  sub: string
  role: SessionRole
  /** unix seconds */
  exp: number
  staffId: string | null
  citizenId: number | null
  /** human readable actor for audit entries */
  actor: string
  username: string | null
  departmentId: string | null
  mustChangePassword: boolean
  mfaEnabled: boolean
}

export const sessionCookieName = 'dhiqar_session'
export const staffSessionTtlSeconds = 12 * 60 * 60
export const citizenSessionTtlSeconds = 7 * 24 * 60 * 60
export const staffIdleTimeoutSeconds = 60 * 60
export const staffRoles: SessionRole[] = ['EMPLOYEE', 'IDENTITY_REVIEWER', 'OPERATIONS', 'SUPER_ADMIN']

export function secureStringEquals(expected?: string | null, received?: string | null) {
  if (!expected || !received) return false
  const left = Buffer.from(expected.trim())
  const right = Buffer.from(received.trim())
  return left.length === right.length && timingSafeEqual(left, right)
}

export function sessionSecret() {
  const value = process.env.SESSION_SECRET?.trim()
  if (value) return value
  if (isProduction) throw new Error('SESSION_SECRET must be configured in production.')
  return 'local-development-session-secret-change-me'
}

function sign(value: string) {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url')
}

function cookieToken(sid: string) {
  return `${sid}.${sign(sid)}`
}

function sidFromCookie(req: Pick<IncomingMessage, 'headers'>) {
  const cookie = req.headers.cookie
    ?.split(';')
    .map(item => item.trim())
    .find(item => item.startsWith(`${sessionCookieName}=`))
  const token = cookie?.slice(sessionCookieName.length + 1)
  if (!token) return null
  const [sid, signature] = token.split('.')
  if (!sid || !signature || !secureStringEquals(sign(sid), signature)) return null
  return sid
}

const hashIp = (ip?: string) => (ip ? createHash('sha256').update(`ip:${ip}`).digest('hex').slice(0, 32) : null)

type SessionRow = {
  id: string
  role: SessionRole
  subject: string
  staff_id: string | null
  citizen_id: number | null
  last_seen_at: string
  expires_at: string
  revoked_at: string | null
}

function buildSessionData(row: SessionRow, staff: StaffAccount | null): SessionData {
  return {
    sid: row.id,
    sub: row.subject,
    role: row.role,
    exp: Math.floor(Date.parse(row.expires_at) / 1000),
    staffId: row.staff_id,
    citizenId: row.citizen_id,
    actor: staff ? `${staff.fullName} (${staff.username})` : `citizen:${row.subject}`,
    username: staff?.username ?? null,
    departmentId: staff?.departmentId ?? null,
    mustChangePassword: staff?.mustChangePassword ?? false,
    mfaEnabled: staff?.totpEnabled ?? false,
  }
}

/** Resolves the session from the cookie. Returns null when missing, expired, revoked, idle too long, or the account is disabled. */
export function readSession(req: Pick<IncomingMessage, 'headers'>): SessionData | null {
  try {
    const sid = sidFromCookie(req)
    if (!sid) return null
    const row = db
      .prepare(
        `SELECT id, role, subject, staff_id, citizen_id, last_seen_at, expires_at, revoked_at FROM auth_sessions WHERE id = ?`
      )
      .get(sid) as SessionRow | undefined
    if (!row || row.revoked_at) return null
    const nowMs = Date.now()
    if (Date.parse(row.expires_at) <= nowMs) return null
    let staff: StaffAccount | null = null
    if (row.staff_id) {
      if (nowMs - Date.parse(row.last_seen_at) > staffIdleTimeoutSeconds * 1000) {
        revokeSession(sid, 'IDLE_TIMEOUT')
        return null
      }
      staff = getStaffById(row.staff_id)
      if (!staff || staff.status !== 'ACTIVE' || staff.role !== row.role) return null
    }
    return buildSessionData(row, staff)
  } catch {
    return null
  }
}

export function touchPresence(session: SessionData) {
  const timestamp = new Date().toISOString()
  db.prepare(
    `INSERT INTO live_presence (session_id, role, session_subject, last_seen_at, created_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, role = excluded.role, session_subject = excluded.session_subject`
  ).run(session.sid, session.role, session.sub, timestamp, timestamp)
  db.prepare(`UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?`).run(timestamp, session.sid)
}

function cookieAttributes(maxAge: number) {
  const secure = secureHostedRuntime ? '; Secure' : ''
  return `Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAge}`
}

export function createSession(
  res: express.Response,
  input: {
    role: SessionRole
    subject: string
    staffId?: string | null
    citizenId?: number | null
    ip?: string
    userAgent?: string
  }
) {
  const sid = randomUUID()
  const ttl = input.role === 'CITIZEN' ? citizenSessionTtlSeconds : staffSessionTtlSeconds
  const timestamp = new Date()
  const expiresAt = new Date(timestamp.getTime() + ttl * 1000)
  db.prepare(
    `INSERT INTO auth_sessions (id, role, subject, staff_id, citizen_id, ip_hash, user_agent, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sid,
    input.role,
    input.subject,
    input.staffId || null,
    input.citizenId ?? null,
    hashIp(input.ip),
    input.userAgent?.slice(0, 300) || null,
    timestamp.toISOString(),
    timestamp.toISOString(),
    expiresAt.toISOString()
  )
  res.append('Set-Cookie', `${sessionCookieName}=${cookieToken(sid)}; ${cookieAttributes(ttl)}`)
  const staff = input.staffId ? getStaffById(input.staffId) : null
  const data = buildSessionData(
    {
      id: sid,
      role: input.role,
      subject: input.subject,
      staff_id: input.staffId || null,
      citizen_id: input.citizenId ?? null,
      last_seen_at: timestamp.toISOString(),
      expires_at: expiresAt.toISOString(),
      revoked_at: null,
    },
    staff
  )
  touchPresence(data)
  return { data, ttl }
}

/** Backwards-compatible helper used by the citizen onboarding flow. */
export function setSession(res: express.Response, sub: string, role: SessionRole, req?: express.Request) {
  return createSession(res, {
    role,
    subject: sub,
    citizenId: role === 'CITIZEN' ? Number(sub) : null,
    ip: req?.ip,
    userAgent: req?.header('user-agent'),
  })
}

export function clearSession(res: express.Response, req?: Pick<IncomingMessage, 'headers'>) {
  if (req) {
    const sid = sidFromCookie(req)
    if (sid) revokeSession(sid, 'LOGOUT')
  }
  res.append('Set-Cookie', `${sessionCookieName}=; ${cookieAttributes(0)}`)
}

export function revokeSession(sid: string, reason: string) {
  db.prepare(`UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL`).run(
    new Date().toISOString(),
    reason,
    sid
  )
  db.prepare(`DELETE FROM live_presence WHERE session_id = ?`).run(sid)
}

export function revokeStaffSessions(staffId: string, reason: string, exceptSid?: string) {
  const timestamp = new Date().toISOString()
  const result = db
    .prepare(
      `UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ? WHERE staff_id = ? AND revoked_at IS NULL AND id != ?`
    )
    .run(timestamp, reason, staffId, exceptSid || '')
  db.prepare(
    `DELETE FROM live_presence WHERE session_id IN (SELECT id FROM auth_sessions WHERE staff_id = ? AND revoked_at IS NOT NULL)`
  ).run(staffId)
  return Number(result.changes)
}

export function listStaffSessions(staffId: string) {
  return db
    .prepare(
      `SELECT id, created_at, last_seen_at, expires_at, user_agent FROM auth_sessions WHERE staff_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC`
    )
    .all(staffId, new Date().toISOString()) as Array<{
    id: string
    created_at: string
    last_seen_at: string
    expires_at: string
    user_agent: string | null
  }>
}

export function purgeExpiredSessions() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  db.prepare(`DELETE FROM auth_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`).run(
    cutoff,
    cutoff
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyParamsHandler = express.RequestHandler<any>

/** Requires an active session with one of the given roles. Staff with a pending forced password change may only hit auth routes. */
export function requireSession(...roles: SessionRole[]): AnyParamsHandler {
  return (req, res, next) => {
    const session = readSession(req)
    if (!session || !roles.includes(session.role))
      return res.status(401).json({ message: 'تحتاج جلسة دخول صالحة للوصول إلى هذا المورد.' })
    if (session.mustChangePassword && !req.path.startsWith('/api/auth/'))
      return res
        .status(403)
        .json({ message: 'يجب تغيير كلمة المرور المؤقتة قبل استخدام المنصة.', code: 'PASSWORD_CHANGE_REQUIRED' })
    res.locals.session = session
    touchPresence(session)
    next()
  }
}

export const requireStaff = requireSession(...staffRoles)

export function currentSession(res: express.Response) {
  return res.locals.session as SessionData
}

export function currentCitizen(res: express.Response) {
  const session = res.locals.session as SessionData | undefined
  const citizenId = Number(session?.citizenId ?? session?.sub)
  if (session?.role !== 'CITIZEN' || !Number.isSafeInteger(citizenId) || citizenId < 1) {
    res.status(401).json({ message: 'جلسة المواطن غير صالحة.' })
    return null
  }
  const citizen = getCitizenById(citizenId)
  if (!citizen) {
    res.status(401).json({ message: 'تعذر العثور على حساب المواطن المرتبط بهذه الجلسة.' })
    return null
  }
  return citizen
}

/** Identity-review actions require the reviewer role (or super admin). Replaces the old shared X-Review-Access-Code header. */
export const requireReviewAccess: AnyParamsHandler = (_req, res, next) => {
  const session = res.locals.session as SessionData | undefined
  if (session?.role === 'SUPER_ADMIN' || session?.role === 'IDENTITY_REVIEWER') return next()
  res.status(403).json({ message: 'هذا الإجراء يتطلب صلاحية مراجع الهوية.' })
}
