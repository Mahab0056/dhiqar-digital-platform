import type express from 'express'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { db, getCitizenById } from '../db.js'

export type SessionRole = 'CITIZEN' | 'EMPLOYEE' | 'IDENTITY_REVIEWER' | 'OPERATIONS' | 'SUPER_ADMIN'
export type SessionData = { sub: string; role: SessionRole; exp: number; sid?: string }
export const sessionCookieName = 'dhiqar_session'
export const sessionTtlSeconds = 12 * 60 * 60

export function secureStringEquals(expected?: string, received?: string) {
  if (!expected || !received) return false
  const left = Buffer.from(expected.trim())
  const right = Buffer.from(received.trim())
  return left.length === right.length && timingSafeEqual(left, right)
}

export function sessionSecret() {
  const value = process.env.SESSION_SECRET?.trim()
  if (value) return value
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET must be configured in production.')
  return 'local-development-session-secret-change-me'
}

export function signSession(data: SessionData) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  const signature = createHmac('sha256', sessionSecret()).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export function readSession(req: Pick<IncomingMessage, 'headers'>): SessionData | null {
  try {
    const cookie = req.headers.cookie
      ?.split(';')
      .map(item => item.trim())
      .find(item => item.startsWith(`${sessionCookieName}=`))
    const token = cookie?.slice(sessionCookieName.length + 1)
    if (!token) return null
    const [payload, signature] = token.split('.')
    if (!payload || !signature) return null
    const expected = createHmac('sha256', sessionSecret()).update(payload).digest('base64url')
    if (!secureStringEquals(expected, signature)) return null
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionData
    if (!data.exp || data.exp <= Math.floor(Date.now() / 1000)) return null
    return data
  } catch {
    return null
  }
}

export function touchPresence(session: SessionData) {
  const timestamp = new Date().toISOString()
  const sessionId = session.sid || `legacy-${session.role}-${session.sub}`
  db.prepare(
    `INSERT INTO live_presence (session_id, role, session_subject, last_seen_at, created_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, role = excluded.role, session_subject = excluded.session_subject`
  ).run(sessionId, session.role, session.sub, timestamp, timestamp)
}

export function setSession(res: express.Response, sub: string, role: SessionRole) {
  const data: SessionData = { sub, role, sid: randomUUID(), exp: Math.floor(Date.now() / 1000) + sessionTtlSeconds }
  touchPresence(data)
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.append(
    'Set-Cookie',
    `${sessionCookieName}=${signSession(data)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${sessionTtlSeconds}`
  )
}

export function clearSession(res: express.Response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.append('Set-Cookie', `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyParamsHandler = express.RequestHandler<any>

export function requireSession(...roles: SessionRole[]): AnyParamsHandler {
  return (req, res, next) => {
    const session = readSession(req)
    if (!session || !roles.includes(session.role))
      return res.status(401).json({ message: 'تحتاج جلسة دخول صالحة للوصول إلى هذا المورد.' })
    res.locals.session = session
    touchPresence(session)
    next()
  }
}

export function currentCitizen(res: express.Response) {
  const session = res.locals.session as SessionData | undefined
  const citizenId = Number(session?.sub)
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

export function hasReviewAccess(req: express.Request) {
  return secureStringEquals(process.env.ADMIN_REVIEW_PASSWORD, req.header('x-review-access-code'))
}

export const requireReviewAccess: AnyParamsHandler = (req, res, next) => {
  const session = res.locals.session as SessionData | undefined
  if (session?.role === 'SUPER_ADMIN') return next()
  if (!hasReviewAccess(req)) return res.status(401).json({ message: 'رمز دخول المراجعة غير صحيح أو غير مهيأ.' })
  next()
}
