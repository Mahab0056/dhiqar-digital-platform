import type express from 'express'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import QRCode from 'qrcode'
import { z } from 'zod'
import { addAudit } from '../db.js'
import { loginLimiter } from '../http/rate-limit.js'
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
  clearFailedStaffAttempts,
  confirmTotpEnrollment,
  disableTotp,
  getStaffByEmail,
  getStaffById,
  recordStaffLogin,
  staffSignInBlock,
  verifyStaffTotp,
} from '../auth/staff.js'
import { verifyPassword } from '../auth/password.js'
import { otpauthUrl } from '../auth/totp.js'
import {
  GOOGLE_CALLBACK_PATH,
  GOOGLE_STATE_COOKIE,
  GoogleAuthError,
  beginGoogleLogin,
  consumeGoogleState,
  emailDomainAllowed,
  exchangeGoogleCode,
  googleConfig,
  googleConfigured,
  verifyGoogleIdToken,
} from '../auth/google.js'
import {
  EMAIL_CODE_RESEND_SECONDS,
  EMAIL_CODE_TTL_SECONDS,
  emailLoginAvailable,
  requestStaffEmailCode,
  verifyStaffEmailCode,
} from '../auth/email-login.js'
import { allowedOrigins, isLocalPreviewOrigin, productionOrigin, secureHostedRuntime } from '../config.js'
import { db } from '../db.js'

const MFA_CHALLENGE_TTL_SECONDS = 5 * 60
const MFA_ISSUER = 'Thi Qar Digital'

function signChallenge(staffId: string, expiresAt: number, method = 'PASSWORD') {
  const payload = Buffer.from(JSON.stringify({ staffId, expiresAt, method, nonce: randomUUID() })).toString('base64url')
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
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    staffId: string
    expiresAt: number
    method?: string
  }
  if (!data.staffId || data.expiresAt < Date.now()) return null
  const method = ['PASSWORD', 'GOOGLE', 'EMAIL_CODE'].includes(data.method || '') ? data.method! : 'PASSWORD'
  return { ...data, method }
}

const mfaChallenge = (staffId: string, method: string) => {
  const expiresAt = Date.now() + MFA_CHALLENGE_TTL_SECONDS * 1000
  return {
    mfaRequired: true as const,
    challengeToken: signChallenge(staffId, expiresAt, method),
    expiresInSeconds: MFA_CHALLENGE_TTL_SECONDS,
  }
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
    isDepartmentManager: session.isDepartmentManager,
    mustChangePassword: session.mustChangePassword,
    mfaEnabled: session.mfaEnabled,
  }
}

/** Opens a staff session (cookie + audit). Returns null when the account is gone or disabled. */
function startStaffSession(req: express.Request, res: express.Response, staffId: string, method: string) {
  const account = getStaffById(staffId)
  if (!account || account.status !== 'ACTIVE') return null
  const { data } = createSession(res, {
    role: account.role,
    subject: account.id,
    staffId: account.id,
    ip: req.ip,
    userAgent: req.header('user-agent'),
    authMethod: method,
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
  return data
}

function issueStaffSession(req: express.Request, res: express.Response, staffId: string, method: string) {
  const data = startStaffSession(req, res, staffId, method)
  if (!data) return res.status(401).json({ message: 'الحساب غير متاح.' })
  return res.json({ ...sessionView(data), expiresInSeconds: staffSessionTtlSeconds })
}

// ---- Google / email helpers -------------------------------------------------------------------------------------
const staffHomeForRole = (role: string) =>
  role === 'SUPER_ADMIN' ? '/super-admin' : role === 'OPERATIONS' ? '/operations' : '/employee'

const nextPrefixes: Record<string, string[]> = {
  SUPER_ADMIN: ['/'],
  OPERATIONS: ['/operations', '/governor', '/staff'],
  EMPLOYEE: ['/employee', '/staff', '/department'],
  IDENTITY_REVIEWER: ['/employee', '/staff', '/department'],
}

/** Same rules as the login page: a same-site path the role may open. */
const safeNext = (next: string | null | undefined, role?: string) => {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\') || next.length > 300) return null
  if (!role) return next
  return (nextPrefixes[role] || []).some(prefix => next.startsWith(prefix)) ? next : null
}

/** Redirect URI on the host the user started from (thi-qar.com or www), so the state cookie comes back. */
function googleRedirectUri(req: express.Request) {
  const origin = `${req.protocol}://${req.get('host')}`
  const trusted = allowedOrigins.has(origin) || isLocalPreviewOrigin(origin)
  return `${trusted ? origin : productionOrigin}${GOOGLE_CALLBACK_PATH}`
}

const stateCookie = (value: string, maxAge: number) =>
  `${GOOGLE_STATE_COOKIE}=${value}; Path=/api/auth/staff/google; HttpOnly; SameSite=Lax${secureHostedRuntime ? '; Secure' : ''}; Max-Age=${maxAge}`

const readCookie = (req: express.Request, name: string) =>
  req.headers.cookie
    ?.split(';')
    .map(item => item.trim())
    .find(item => item.startsWith(`${name}=`))
    ?.slice(name.length + 1)

const loginPageUrl = (params: { error?: string; next?: string | null; mfa?: string }) => {
  const query = new URLSearchParams()
  if (params.error) query.set('error', params.error)
  if (params.next) query.set('next', params.next)
  const search = query.toString()
  // the MFA challenge rides in the fragment so it never reaches server logs or Referer headers
  return `/staff/login${search ? `?${search}` : ''}${params.mfa ? `#mfa=${encodeURIComponent(params.mfa)}` : ''}`
}

const emailCodeFailureMessage = 'الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً إذا تكرر الخطأ.'
const emailPattern = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/

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
  app.post('/api/auth/staff/login', loginLimiter, (req, res) => {
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
    if (result.account.totpEnabled) return res.json(mfaChallenge(result.account.id, 'PASSWORD'))
    return issueStaffSession(req, res, result.account.id, 'PASSWORD')
  })

  // ---- which sign-in methods this deployment offers ----------------------------------------------------------
  app.get('/api/auth/staff/methods', (_req, res) => {
    res.json({ password: true, google: googleConfigured(), email: emailLoginAvailable() })
  })

  // ---- Google (OIDC code flow + PKCE) -------------------------------------------------------------------------
  app.get('/api/auth/staff/google/start', loginLimiter, (req, res) => {
    if (!googleConfigured()) return res.redirect(303, loginPageUrl({ error: 'google_unavailable' }))
    const next = safeNext(typeof req.query.next === 'string' ? req.query.next : null)
    const { url, state, stateTtlSeconds } = beginGoogleLogin({ redirectUri: googleRedirectUri(req), next })
    res.append('Set-Cookie', stateCookie(state, stateTtlSeconds))
    res.redirect(303, url)
  })

  app.get(GOOGLE_CALLBACK_PATH, loginLimiter, async (req, res) => {
    res.append('Set-Cookie', stateCookie('', 0))
    const query = (key: string) => (typeof req.query[key] === 'string' ? (req.query[key] as string) : undefined)
    const fail = (code: string, reason: string, extra: Record<string, unknown> = {}, next?: string | null) => {
      addAudit({
        actor: typeof extra.email === 'string' ? extra.email : 'google',
        role: 'ANONYMOUS',
        action: 'STAFF_GOOGLE_LOGIN_FAILED',
        entityType: 'StaffAccount',
        entityId: typeof extra.staffId === 'string' ? extra.staffId : 'google',
        metadata: { reason, ip: req.ip, ...extra },
      })
      return res.redirect(303, loginPageUrl({ error: code, next }))
    }
    const config = googleConfig()
    if (!config) return fail('google_unavailable', 'NOT_CONFIGURED')
    const state = consumeGoogleState(query('state'), readCookie(req, GOOGLE_STATE_COOKIE))
    const providerError = query('error')
    if (providerError)
      return fail(
        providerError === 'access_denied' ? 'google_cancelled' : 'google_failed',
        `PROVIDER_${providerError.slice(0, 40).toUpperCase()}`,
        {},
        state?.next
      )
    if (!state) return fail('google_expired', 'STATE_INVALID')
    const code = query('code')
    if (!code) return fail('google_failed', 'NO_CODE', {}, state.next)

    let identity: Awaited<ReturnType<typeof verifyGoogleIdToken>>
    try {
      const idToken = await exchangeGoogleCode({
        code,
        codeVerifier: state.codeVerifier,
        redirectUri: state.redirectUri,
      })
      identity = await verifyGoogleIdToken(idToken, { clientId: config.clientId, nonce: state.nonce })
    } catch (error) {
      const known = error instanceof GoogleAuthError
      if (!known) console.error('[auth] google sign-in error', error)
      return fail(
        known && error.code === 'EMAIL_UNVERIFIED' ? 'google_unverified' : 'google_failed',
        known ? error.code : 'UNEXPECTED',
        {},
        state.next
      )
    }
    if (!emailDomainAllowed(identity.email, config.allowedDomains))
      return fail('google_domain', 'DOMAIN_NOT_ALLOWED', { email: identity.email }, state.next)
    const account = getStaffByEmail(identity.email)
    if (!account) return fail('google_no_account', 'NO_LINKED_ACCOUNT', { email: identity.email }, state.next)
    const block = staffSignInBlock(account)
    if (block)
      return fail(
        block.reason === 'DISABLED' ? 'account_disabled' : 'account_locked',
        block.reason,
        { email: identity.email, staffId: account.id },
        state.next
      )
    clearFailedStaffAttempts(account.id)
    const next = safeNext(state.next, account.role)
    if (account.totpEnabled) {
      addAudit({
        actor: account.username,
        role: 'ANONYMOUS',
        action: 'STAFF_GOOGLE_LOGIN_MFA_PENDING',
        entityType: 'StaffAccount',
        entityId: account.id,
        metadata: { ip: req.ip, googleSub: identity.sub },
      })
      return res.redirect(303, loginPageUrl({ next, mfa: mfaChallenge(account.id, 'GOOGLE').challengeToken }))
    }
    const session = startStaffSession(req, res, account.id, 'GOOGLE')
    if (!session) return fail('account_disabled', 'DISABLED', { staffId: account.id })
    addAudit({
      actor: session.actor,
      role: account.role,
      action: 'STAFF_GOOGLE_LOGIN_SUCCEEDED',
      entityType: 'StaffAccount',
      entityId: account.id,
      metadata: { ip: req.ip, googleSub: identity.sub },
    })
    return res.redirect(303, next || staffHomeForRole(account.role))
  })

  // ---- one-time code by email ------------------------------------------------------------------------------
  app.post('/api/auth/staff/email/request', loginLimiter, (req, res) => {
    if (!emailLoginAvailable()) return res.status(404).json({ message: 'الدخول برمز البريد الإلكتروني غير مفعّل.' })
    const payload = z.object({ email: z.string().trim().min(3).max(254) }).parse(req.body)
    if (!emailPattern.test(payload.email)) return res.status(400).json({ message: 'اكتب بريداً إلكترونياً صحيحاً.' })
    const result = requestStaffEmailCode({ email: payload.email, ip: req.ip })
    if (result.status === 'rate_limited') {
      const wait =
        result.retryAfterSeconds >= 60
          ? `${Math.ceil(result.retryAfterSeconds / 60)} دقيقة`
          : `${result.retryAfterSeconds} ثانية`
      res.setHeader('Retry-After', String(result.retryAfterSeconds))
      return res.status(429).json({
        message: `طلبت رموزاً كثيرة. انتظر ${wait} ثم أعد المحاولة.`,
        retryAfterSeconds: result.retryAfterSeconds,
      })
    }
    res.json({
      success: true,
      message: 'إذا كان هذا البريد مرتبطاً بحساب موظف فعّال فستصلك رسالة فيها رمز الدخول خلال دقيقة.',
      resendAfterSeconds: EMAIL_CODE_RESEND_SECONDS,
      expiresInSeconds: EMAIL_CODE_TTL_SECONDS,
    })
  })

  app.post('/api/auth/staff/email/verify', loginLimiter, (req, res) => {
    if (!emailLoginAvailable()) return res.status(404).json({ message: 'الدخول برمز البريد الإلكتروني غير مفعّل.' })
    const payload = z
      .object({ email: z.string().trim().min(3).max(254), code: z.string().trim().min(6).max(12) })
      .parse(req.body)
    const result = verifyStaffEmailCode(payload)
    if (!result.ok) {
      addAudit({
        actor: (result.staffId && getStaffById(result.staffId)?.username) || 'email',
        role: 'ANONYMOUS',
        action: 'STAFF_EMAIL_LOGIN_FAILED',
        entityType: 'StaffAccount',
        entityId: result.staffId || 'unknown',
        metadata: { reason: result.reason, ip: req.ip },
      })
      const message =
        result.reason === 'INVALID'
          ? emailCodeFailureMessage
          : loginFailureMessage(result.reason, result.retryAfterSeconds)
      return res.status(401).json({ message })
    }
    const account = getStaffById(result.staffId)!
    if (account.totpEnabled) return res.json(mfaChallenge(account.id, 'EMAIL_CODE'))
    return issueStaffSession(req, res, account.id, 'EMAIL_CODE')
  })

  app.post('/api/auth/staff/mfa', loginLimiter, (req, res) => {
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
    return issueStaffSession(req, res, challenge.staffId, `${challenge.method}+TOTP`)
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
  app.post('/api/auth/staff/change-password', requireStaff, loginLimiter, (req, res) => {
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

  app.post('/api/auth/staff/mfa/setup', requireStaff, loginLimiter, async (_req, res) => {
    const session = currentSession(res)
    const account = getStaffById(session.staffId!)!
    if (account.totpEnabled)
      return res.status(409).json({ message: 'المصادقة الثنائية مفعّلة مسبقاً. عطّلها أولاً لإعادة الإعداد.' })
    const secret = beginTotpEnrollment(account.id)
    const url = otpauthUrl({ issuer: MFA_ISSUER, account: account.username, secret })
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 })
    res.json({ secret, otpauthUrl: url, qrDataUrl })
  })

  app.post('/api/auth/staff/mfa/confirm', requireStaff, loginLimiter, (req, res) => {
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

  app.post('/api/auth/staff/mfa/disable', requireStaff, loginLimiter, (req, res) => {
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
