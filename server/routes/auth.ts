import type express from 'express'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import QRCode from 'qrcode'
import { z } from 'zod'
import { addAudit } from '../db.js'
import { sensitiveLimiter } from '../http/rate-limit.js'
import {
  clearSession,
  createSession,
  currentSession,
  listStaffSessions,
  readSession,
  requireStaff,
  revokeSession,
  revokeStaffSessions,
  sessionSecret,
  staffSessionTtlSeconds,
  type SessionData,
} from '../auth/session.js'
import {
  authenticateStaff,
  beginTotpEnrollment,
  changeStaffPassword,
  confirmTotpEnrollment,
  disableTotp,
  getStaffById,
  recordStaffLogin,
  verifyStaffTotp,
} from '../auth/staff.js'
import { verifyPassword } from '../auth/password.js'
import { otpauthUrl } from '../auth/totp.js'
import { db } from '../db.js'

const MFA_CHALLENGE_TTL_SECONDS = 5 * 60
const MFA_ISSUER = 'Thi Qar Digital'

function signChallenge(staffId: string, expiresAt: number) {
  const payload = Buffer.from(JSON.stringify({ staffId, expiresAt, nonce: randomUUID() })).toString('base64url')
  const signature = createHmac('sha256', `${sessionSecret()}:mfa-challenge`).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function readChallenge(token: string) {
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = createHmac('sha256', `${sessionSecret()}:mfa-challenge`).update(payload).digest('base64url')
  const left = Buffer.from(expected)
  const right = Buffer.from(signature)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { staffId: string; expiresAt: number }
  if (!data.staffId || data.expiresAt < Date.now()) return null
  return data
}

function sessionView(session: SessionData) {
  const staff = session.staffId ? getStaffById(session.staffId) : null
  return {
    authenticated: true as const,
    role: session.role,
    subject: session.sub,
    expiresAt: new Date(session.exp * 1000).toISOString(),
    displayName: staff?.fullName ?? null,
    username: staff?.username ?? null,
    departmentId: staff?.departmentId ?? null,
    departmentName: staff?.departmentName ?? null,
    mustChangePassword: session.mustChangePassword,
    mfaEnabled: session.mfaEnabled,
  }
}

function issueStaffSession(req: express.Request, res: express.Response, staffId: string, method: string) {
  const account = getStaffById(staffId)
  if (!account || account.status !== 'ACTIVE') return res.status(401).json({ message: 'الحساب غير متاح.' })
  const { data } = createSession(res, {
    role: account.role,
    subject: account.id,
    staffId: account.id,
    ip: req.ip,
    userAgent: req.header('user-agent'),
  })
  recordStaffLogin(account.id)
  addAudit({
    actor: data.actor,
    role: account.role,
    action: 'STAFF_SESSION_CREATED',
    entityType: 'Session',
    entityId: data.sid,
    metadata: { method, ip: req.ip, staffId: account.id },
  })
  return res.json({ ...sessionView(data), expiresInSeconds: staffSessionTtlSeconds })
}

const loginFailureMessage = (reason: 'INVALID' | 'LOCKED' | 'DISABLED', retryAfterSeconds?: number) => {
  if (reason === 'LOCKED')
    return `تم قفل الحساب مؤقتاً بعد محاولات فاشلة متكررة. حاول بعد ${Math.ceil((retryAfterSeconds || 900) / 60)} دقيقة.`
  if (reason === 'DISABLED') return 'هذا الحساب معطّل. راجع مدير النظام.'
  return 'اسم المستخدم أو كلمة المرور غير صحيحة.'
}

export function registerAuthRoutes(app: express.Express) {
  app.get('/api/auth/session', (req, res) => {
    const session = readSession(req)
    if (!session) return res.status(401).json({ message: 'لا توجد جلسة دخول فعالة.' })
    res.json(sessionView(session))
  })

  // ---- staff login (password → optional TOTP) --------------------------------
  app.post('/api/auth/staff/login', sensitiveLimiter, (req, res) => {
    const payload = z
      .object({ username: z.string().trim().min(3).max(60), password: z.string().min(1).max(200) })
      .parse(req.body)
    const result = authenticateStaff(payload.username, payload.password)
    if (!result.ok) {
      addAudit({
        actor: payload.username.toLowerCase(),
        role: 'ANONYMOUS',
        action: 'STAFF_LOGIN_FAILED',
        entityType: 'StaffAccount',
        entityId: payload.username.toLowerCase(),
        metadata: { reason: result.reason, ip: req.ip },
      })
      return res.status(401).json({ message: loginFailureMessage(result.reason, result.retryAfterSeconds) })
    }
    if (result.account.totpEnabled) {
      const expiresAt = Date.now() + MFA_CHALLENGE_TTL_SECONDS * 1000
      return res.json({
        mfaRequired: true,
        challengeToken: signChallenge(result.account.id, expiresAt),
        expiresInSeconds: MFA_CHALLENGE_TTL_SECONDS,
      })
    }
    return issueStaffSession(req, res, result.account.id, 'PASSWORD')
  })

  app.post('/api/auth/staff/mfa', sensitiveLimiter, (req, res) => {
    const payload = z
      .object({ challengeToken: z.string().min(10), code: z.string().trim().min(6).max(8) })
      .parse(req.body)
    const challenge = readChallenge(payload.challengeToken)
    if (!challenge) return res.status(401).json({ message: 'انتهت صلاحية خطوة التحقق. سجّل الدخول من جديد.' })
    if (!verifyStaffTotp(challenge.staffId, payload.code)) {
      addAudit({
        actor: challenge.staffId,
        role: 'ANONYMOUS',
        action: 'STAFF_MFA_FAILED',
        entityType: 'StaffAccount',
        entityId: challenge.staffId,
        metadata: { ip: req.ip },
      })
      return res.status(401).json({ message: 'رمز التحقق غير صحيح أو مستخدم سابقاً.' })
    }
    return issueStaffSession(req, res, challenge.staffId, 'PASSWORD+TOTP')
  })

  app.post('/api/auth/logout', (req, res) => {
    const session = readSession(req)
    clearSession(res, req)
    if (session)
      addAudit({
        actor: session.actor,
        role: session.role,
        action: 'SESSION_ENDED',
        entityType: 'Session',
        entityId: session.sid,
      })
    res.json({ success: true })
  })

  // ---- self-service security ---------------------------------------------------
  app.post('/api/auth/staff/change-password', requireStaff, sensitiveLimiter, (req, res) => {
    const session = currentSession(res)
    const payload = z
      .object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) })
      .parse(req.body)
    try {
      changeStaffPassword(session.staffId!, {
        currentPassword: payload.currentPassword,
        newPassword: payload.newPassword,
      })
    } catch (error) {
      return res.status(400).json({ message: (error as Error).message })
    }
    const revoked = revokeStaffSessions(session.staffId!, 'PASSWORD_CHANGED', session.sid)
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'STAFF_PASSWORD_CHANGED',
      entityType: 'StaffAccount',
      entityId: session.staffId!,
      metadata: { otherSessionsRevoked: revoked },
    })
    res.json({ success: true, otherSessionsRevoked: revoked })
  })

  app.post('/api/auth/staff/mfa/setup', requireStaff, sensitiveLimiter, async (_req, res) => {
    const session = currentSession(res)
    const account = getStaffById(session.staffId!)!
    if (account.totpEnabled)
      return res.status(409).json({ message: 'المصادقة الثنائية مفعّلة مسبقاً. عطّلها أولاً لإعادة الإعداد.' })
    const secret = beginTotpEnrollment(account.id)
    const url = otpauthUrl({ issuer: MFA_ISSUER, account: account.username, secret })
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 })
    res.json({ secret, otpauthUrl: url, qrDataUrl })
  })

  app.post('/api/auth/staff/mfa/confirm', requireStaff, sensitiveLimiter, (req, res) => {
    const session = currentSession(res)
    const payload = z.object({ code: z.string().trim().min(6).max(8) }).parse(req.body)
    let ok = false
    try {
      ok = confirmTotpEnrollment(session.staffId!, payload.code)
    } catch (error) {
      return res.status(400).json({ message: (error as Error).message })
    }
    if (!ok) return res.status(400).json({ message: 'الرمز غير صحيح. تأكد من وقت الجهاز ثم أعد المحاولة.' })
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'STAFF_MFA_ENABLED',
      entityType: 'StaffAccount',
      entityId: session.staffId!,
    })
    res.json({ success: true })
  })

  app.post('/api/auth/staff/mfa/disable', requireStaff, sensitiveLimiter, (req, res) => {
    const session = currentSession(res)
    const payload = z
      .object({ password: z.string().min(1).max(200), code: z.string().trim().min(6).max(8) })
      .parse(req.body)
    const row = db.prepare(`SELECT password_hash FROM staff_accounts WHERE id = ?`).get(session.staffId!) as {
      password_hash: string
    }
    if (!verifyPassword(payload.password, row.password_hash) || !verifyStaffTotp(session.staffId!, payload.code))
      return res.status(401).json({ message: 'كلمة المرور أو رمز التحقق غير صحيح.' })
    disableTotp(session.staffId!)
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'STAFF_MFA_DISABLED',
      entityType: 'StaffAccount',
      entityId: session.staffId!,
    })
    res.json({ success: true })
  })

  app.get('/api/auth/staff/sessions', requireStaff, (_req, res) => {
    const session = currentSession(res)
    res.json(
      listStaffSessions(session.staffId!).map(item => ({
        id: item.id,
        current: item.id === session.sid,
        createdAt: item.created_at,
        lastSeenAt: item.last_seen_at,
        expiresAt: item.expires_at,
        userAgent: item.user_agent,
      }))
    )
  })

  app.post('/api/auth/staff/sessions/revoke-others', requireStaff, (_req, res) => {
    const session = currentSession(res)
    const revoked = revokeStaffSessions(session.staffId!, 'USER_REVOKED_OTHERS', session.sid)
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'STAFF_SESSIONS_REVOKED',
      entityType: 'StaffAccount',
      entityId: session.staffId!,
      metadata: { revoked },
    })
    res.json({ success: true, revoked })
  })

  app.delete('/api/auth/staff/sessions/:id', requireStaff, (req, res) => {
    const session = currentSession(res)
    const target = listStaffSessions(session.staffId!).find(item => item.id === req.params.id)
    if (!target) return res.status(404).json({ message: 'الجلسة غير موجودة.' })
    revokeSession(target.id, 'USER_REVOKED')
    res.json({ success: true })
  })
}
