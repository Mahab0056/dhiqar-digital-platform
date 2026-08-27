import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import multer from 'multer'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  addAudit,
  addEvent,
  createNotification,
  db,
  ensureDemoCitizen,
  getCitizenNotifications,
  getApplicationByReference,
  getApplicationByVerificationId,
  getApplications,
  getApplicationsForCitizen,
  getCitizen,
  markAllNotificationsRead,
  markNotificationRead,
  resetDemo,
} from './db.js'
import { createOtpChallenge, processOtpDeliveryWebhook, verifyOtpChallenge } from './otp.js'
import { deleteEncryptedMedia, readDecryptedMedia, storeEncryptedMedia } from './media.js'
import { departmentRegistry, registrySummary } from './department-registry.js'
import { getServiceDefinition } from '../src/service-forms.js'
import { screenIdentitySubmission } from './identity-screening.js'

const app = express()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 3 },
  fileFilter: (_req, file, callback) => {
    const permitted = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/webm', 'video/mp4', 'video/quicktime', 'application/pdf'])
    if (!permitted.has(file.mimetype)) return callback(new Error('صيغة الملف غير مدعومة.'))
    callback(null, true)
  },
})
const port = Number(process.env.PORT || 8787)

function detectedMime(buffer: Buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf'
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4'
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm'
  return null
}

function validateUploadedFile(file: Express.Multer.File, allowed: Array<'image' | 'video' | 'pdf'>) {
  const actual = detectedMime(file.buffer)
  const accepted = actual && ((allowed.includes('image') && actual.startsWith('image/')) || (allowed.includes('video') && actual.startsWith('video/')) || (allowed.includes('pdf') && actual === 'application/pdf'))
  if (!accepted) throw new Error(`محتوى الملف ${file.originalname || 'المرفق'} لا يطابق صيغة آمنة ومسموحة.`)
  if (file.mimetype === 'application/pdf' && actual !== 'application/pdf') throw new Error('توقيع ملف PDF غير صحيح.')
  return actual
}

type SessionRole = 'CITIZEN' | 'EMPLOYEE' | 'IDENTITY_REVIEWER'
type SessionData = { sub: string; role: SessionRole; exp: number }
const sessionCookieName = 'dhiqar_session'
const sessionTtlSeconds = 12 * 60 * 60

function secureStringEquals(expected?: string, received?: string) {
  if (!expected || !received) return false
  const left = Buffer.from(expected.trim())
  const right = Buffer.from(received.trim())
  return left.length === right.length && timingSafeEqual(left, right)
}

function sessionSecret() {
  const value = process.env.SESSION_SECRET?.trim()
  if (value) return value
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET must be configured in production.')
  return 'local-development-session-secret-change-me'
}

function signSession(data: SessionData) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  const signature = createHmac('sha256', sessionSecret()).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function readSession(req: express.Request): SessionData | null {
  try {
    const cookie = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${sessionCookieName}=`))
    const token = cookie?.slice(sessionCookieName.length + 1)
    if (!token) return null
    const [payload, signature] = token.split('.')
    if (!payload || !signature) return null
    const expected = createHmac('sha256', sessionSecret()).update(payload).digest('base64url')
    if (!secureStringEquals(expected, signature)) return null
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionData
    if (!data.exp || data.exp <= Math.floor(Date.now() / 1000)) return null
    return data
  } catch { return null }
}

function setSession(res: express.Response, sub: string, role: SessionRole) {
  const data: SessionData = { sub, role, exp: Math.floor(Date.now() / 1000) + sessionTtlSeconds }
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.append('Set-Cookie', `${sessionCookieName}=${signSession(data)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${sessionTtlSeconds}`)
}

function clearSession(res: express.Response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.append('Set-Cookie', `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`)
}

function requireSession(...roles: SessionRole[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const session = readSession(req)
    if (!session || !roles.includes(session.role)) return res.status(401).json({ message: 'تحتاج جلسة دخول صالحة للوصول إلى هذا المورد.' })
    res.locals.session = session
    next()
  }
}

function hasReviewAccess(req: express.Request) {
  return secureStringEquals(process.env.ADMIN_REVIEW_PASSWORD, req.header('x-review-access-code'))
}

function requireReviewAccess(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!hasReviewAccess(req)) return res.status(401).json({ message: 'رمز دخول المراجعة غير صحيح أو غير مهيأ.' })
  next()
}

function ensureDepartmentRecord(name: string) {
  const item = departmentRegistry.find(entry => entry.name === name)
  if (!item) return null
  const timestamp = new Date().toISOString()
  db.prepare(`INSERT INTO departments (id, name, category, district, website, lat, lng, data_status, source_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category, district = excluded.district, website = excluded.website, lat = excluded.lat, lng = excluded.lng, data_status = excluded.data_status, source_url = excluded.source_url, updated_at = excluded.updated_at`)
    .run(item.id, item.name, item.category, item.district, item.sourceUrl, item.lat, item.lng, item.dataStatus, item.sourceUrl, timestamp, timestamp)
  return item
}

const currentDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(currentDir, '..')
const distDir = join(projectRoot, 'dist')

app.disable('x-powered-by')
app.set('trust proxy', 1)

const productionOrigin = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') || 'https://dhiqar-digital-platform-production.up.railway.app'
const secureHostedRuntime = process.env.RAILWAY_ENVIRONMENT === 'production' || (process.env.NODE_ENV === 'production' && process.env.LOCAL_HTTP_PREVIEW !== 'true')
const allowedOrigins = new Set([productionOrigin, 'http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174'])
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'طلبات كثيرة. انتظر دقيقة ثم أعد المحاولة.' } })
const sensitiveLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'تجاوزت الحد المؤقت لهذه العملية الحساسة. حاول لاحقاً.' } })

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: secureHostedRuntime ? [] : null,
    },
  },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}))
app.use(cors({
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Review-Access-Code', 'X-CSRF-Token'],
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true)
    callback(new Error('Origin غير مصرح.'))
  },
}))
app.use((req, res, next) => { const requestId = randomUUID(); res.locals.requestId = requestId; res.setHeader('X-Request-Id', requestId); next() })
app.use('/api', apiLimiter)
app.use(['/api/onboarding', '/api/admin', '/api/applications'], (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, private')
  res.setHeader('Pragma', 'no-cache')
  next()
})
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false, limit: '64kb' }))
app.use(['/api/onboarding/request-otp', '/api/onboarding/verify-phone', '/api/onboarding/identity-review', '/api/admin'], sensitiveLimiter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Dhi Qar Digital API', time: new Date().toISOString() })
})

app.get('/api/auth/session', (req, res) => {
  const session = readSession(req)
  if (!session) return res.status(401).json({ message: 'لا توجد جلسة دخول فعالة.' })
  res.json({ authenticated: true, role: session.role, subject: session.sub, expiresAt: new Date(session.exp * 1000).toISOString() })
})

app.post('/api/auth/employee', sensitiveLimiter, (req, res) => {
  const payload = z.object({ accessCode: z.string().min(8).max(200) }).parse(req.body)
  if (!secureStringEquals(process.env.ADMIN_REVIEW_PASSWORD, payload.accessCode)) return res.status(401).json({ message: 'بيانات دخول الموظف غير صحيحة.' })
  setSession(res, 'employee-reviewer', 'EMPLOYEE')
  addAudit({ actor: 'موظف مصرح', role: 'EMPLOYEE', action: 'EMPLOYEE_SESSION_CREATED', entityType: 'Session', entityId: randomUUID(), metadata: { ip: req.ip } })
  res.json({ authenticated: true, role: 'EMPLOYEE', expiresInSeconds: sessionTtlSeconds })
})

app.post('/api/auth/logout', (req, res) => {
  const session = readSession(req)
  clearSession(res)
  if (session) addAudit({ actor: session.sub, role: session.role, action: 'SESSION_ENDED', entityType: 'Session', entityId: session.sub })
  res.json({ success: true })
})

app.get('/api/citizen/demo', requireSession('CITIZEN'), (_req, res) => {
  addAudit({ actor: 'مستخدم مواطن', role: 'CITIZEN', action: 'PROFILE_VIEW', entityType: 'Citizen', entityId: 'current-citizen', metadata: { masked: true } })
  res.json(getCitizen())
})

app.get('/api/citizen/applications', requireSession('CITIZEN'), (_req, res) => {
  const citizenId = ensureDemoCitizen()
  res.json(getApplicationsForCitizen(citizenId))
})

app.get('/api/citizen/notifications', requireSession('CITIZEN'), (_req, res) => {
  const citizenId = ensureDemoCitizen()
  res.json(getCitizenNotifications(citizenId))
})

app.patch('/api/citizen/notifications/:id/read', requireSession('CITIZEN'), (req, res) => {
  const citizenId = ensureDemoCitizen()
  if (!markNotificationRead(citizenId, req.params.id)) return res.status(404).json({ message: 'الإشعار غير موجود.' })
  res.json(getCitizenNotifications(citizenId))
})

app.post('/api/citizen/notifications/read-all', requireSession('CITIZEN'), (_req, res) => {
  const citizenId = ensureDemoCitizen()
  const updated = markAllNotificationsRead(citizenId)
  addAudit({ actor: 'مستخدم مواطن', role: 'CITIZEN', action: 'NOTIFICATIONS_MARKED_READ', entityType: 'Notification', entityId: 'all', metadata: { updated } })
  res.json(getCitizenNotifications(citizenId))
})

app.get('/api/citizen/service-requests', requireSession('CITIZEN'), (_req, res) => {
  const citizenId = ensureDemoCitizen()
  const rows = db.prepare(`SELECT sr.*, a.id AS appointment_id, a.preferred_date, a.preferred_time, a.status AS appointment_status, a.confirmation_note
    FROM service_requests sr LEFT JOIN appointments a ON a.service_request_id = sr.id
    WHERE sr.citizen_id = ? ORDER BY sr.created_at DESC`).all(citizenId) as Array<Record<string, unknown>>
  res.json(rows.map(row => ({
    id: row.id, reference: row.reference, serviceKey: row.service_id, departmentId: row.department_id, status: row.status,
    formData: JSON.parse(String(row.form_data || '{}')), currentAction: row.current_action, createdAt: row.created_at, updatedAt: row.updated_at,
    appointment: row.appointment_id ? { id: row.appointment_id, preferredDate: row.preferred_date, preferredTime: row.preferred_time, status: row.appointment_status, note: row.confirmation_note } : null,
  })))
})

app.post('/api/service-requests', requireSession('CITIZEN'), (req, res) => {
  const payload = z.object({ serviceKey: z.string().min(2).max(80), data: z.record(z.string(), z.unknown()) }).parse(req.body)
  const definition = getServiceDefinition(payload.serviceKey)
  if (!definition || definition.mode === 'SPECIALIZED') return res.status(404).json({ message: 'الخدمة غير متاحة عبر محرك الاستمارات العام.' })
  const citizen = getCitizen() as { id: number; fullName: string; verificationStatus: string }
  if (!['VERIFIED', 'VERIFIED_MANUAL'].includes(citizen.verificationStatus)) return res.status(409).json({ message: 'أكمل مراجعة الهوية قبل إرسال طلب جديد.' })

  const cleanData: Record<string, string> = {}
  for (const field of definition.fields) {
    const value = String(payload.data[field.key] ?? '').trim()
    if (field.required && !value) return res.status(400).json({ message: `الحقل «${field.label}» مطلوب.` })
    if (field.maxLength && value.length > field.maxLength) return res.status(400).json({ message: `الحقل «${field.label}» أطول من الحد المسموح.` })
    if (value && field.options && !field.options.includes(value)) return res.status(400).json({ message: `القيمة المختارة في «${field.label}» غير مسموحة.` })
    if (value) cleanData[field.key] = value
  }
  if (JSON.stringify(cleanData).length > 20000) return res.status(413).json({ message: 'حجم بيانات الاستمارة أكبر من المسموح.' })

  let departmentName = definition.department
  if (definition.key === 'online-appointment') departmentName = cleanData.department
  if (definition.key === 'water-complaint' && cleanData.problemType?.includes('مجار')) departmentName = 'مديرية مجاري ذي قار'
  const department = ensureDepartmentRecord(departmentName)
  if (!department) return res.status(409).json({ message: 'الدائرة المختارة غير موجودة في سجل الجهات المتحقق.' })

  if (definition.mode === 'APPOINTMENT') {
    const preferredDate = cleanData.preferredDate
    const preferredTime = cleanData.preferredTime
    const date = new Date(`${preferredDate}T00:00:00Z`)
    const today = new Date(); today.setUTCHours(0, 0, 0, 0)
    const max = new Date(today); max.setUTCDate(max.getUTCDate() + 90)
    if (Number.isNaN(date.getTime()) || date < today || date > max) return res.status(400).json({ message: 'اختر تاريخاً من اليوم وحتى 90 يوماً.' })
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(preferredTime)) return res.status(400).json({ message: 'صيغة وقت الموعد غير صحيحة.' })
  }

  const timestamp = new Date().toISOString()
  db.prepare(`INSERT INTO service_catalog (id, department_id, name, category, description, fee_iqd, fee_status, estimated_duration, form_schema, required_documents, payment_mode, active, source_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DISABLED', 1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET department_id = excluded.department_id, name = excluded.name, category = excluded.category, description = excluded.description, form_schema = excluded.form_schema, required_documents = excluded.required_documents, updated_at = excluded.updated_at`)
    .run(definition.key, department.id, definition.title, definition.category, definition.description, definition.fee, definition.fee > 0 ? 'UNVERIFIED' : 'NOT_REQUIRED', definition.estimatedTime, JSON.stringify(definition.fields), JSON.stringify(definition.requirements), department.sourceUrl, timestamp, timestamp)
  const serial = String((db.prepare('SELECT COUNT(*) AS count FROM service_requests').get() as { count: number }).count + 1).padStart(5, '0')
  const reference = `TQS-${new Date().getFullYear()}-${serial}`
  const currentAction = definition.mode === 'APPOINTMENT' ? 'أُرسل طلب الموعد إلى الدائرة وبانتظار التأكيد.' : 'أُرسل الطلب إلى الدائرة المختصة للتدقيق.'
  const result = db.prepare(`INSERT INTO service_requests (reference, citizen_id, service_id, department_id, status, form_data, current_action, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(reference, citizen.id, definition.key, department.id, definition.mode === 'APPOINTMENT' ? 'APPOINTMENT_REQUESTED' : 'SUBMITTED', JSON.stringify(cleanData), currentAction, timestamp, timestamp)
  const serviceRequestId = Number(result.lastInsertRowid)
  let appointment = null
  if (definition.mode === 'APPOINTMENT') {
    const appointmentId = `apt_${randomUUID().replaceAll('-', '')}`
    db.prepare(`INSERT INTO appointments (id, reference, citizen_id, service_request_id, department, purpose, preferred_date, preferred_time, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?)`)
      .run(appointmentId, `APT-${reference.slice(4)}`, citizen.id, serviceRequestId, department.name, cleanData.purpose, cleanData.preferredDate, cleanData.preferredTime, timestamp, timestamp)
    appointment = { id: appointmentId, preferredDate: cleanData.preferredDate, preferredTime: cleanData.preferredTime, status: 'REQUESTED' }
  }
  createNotification({ citizenId: citizen.id, type: definition.mode === 'APPOINTMENT' ? 'APPOINTMENT_REQUESTED' : 'SERVICE_REQUEST_CREATED', title: definition.mode === 'APPOINTMENT' ? 'تم إرسال طلب الموعد' : 'تم تسجيل طلب الخدمة', message: `${definition.title} — ${reference}. ${currentAction}`, link: '/citizen' })
  addAudit({ actor: citizen.fullName, role: 'CITIZEN', action: definition.mode === 'APPOINTMENT' ? 'APPOINTMENT_REQUESTED' : 'SERVICE_REQUEST_CREATED', entityType: 'ServiceRequest', entityId: reference, newValue: { service: definition.key, department: department.id }, metadata: { storedFields: Object.keys(cleanData) } })
  res.status(201).json({ id: serviceRequestId, reference, serviceKey: definition.key, serviceName: definition.title, department: department.name, status: definition.mode === 'APPOINTMENT' ? 'APPOINTMENT_REQUESTED' : 'SUBMITTED', currentAction, appointment, createdAt: timestamp })
})

app.post('/api/onboarding/request-otp', async (req, res) => {
  try {
    const payload = z.object({ phone: z.string().min(10).max(20) }).parse(req.body)
    const challenge = await createOtpChallenge({ phone: payload.phone, requesterIp: req.ip || req.socket.remoteAddress || 'unknown' })
    addAudit({
      actor: 'مواطن',
      role: 'CITIZEN',
      action: 'PHONE_OTP_REQUESTED',
      entityType: 'PhoneVerification',
      entityId: challenge.challengeId,
      metadata: { phoneMasked: challenge.phoneMasked, provider: 'OTPIQ' },
    })
    res.status(201).json(challenge)
  } catch (error) {
    const message = error instanceof z.ZodError ? 'أدخل رقم هاتف عراقي صحيحاً بصيغة 07XXXXXXXXX.' : error instanceof Error ? error.message : 'تعذر إرسال رمز التحقق.'
    res.status(400).json({ message })
  }
})

app.post('/api/onboarding/verify-phone', (req, res) => {
  try {
    const payload = z.object({
      phone: z.string().min(10).max(20),
      challengeId: z.string().startsWith('otp_'),
      otp: z.string().regex(/^\d{6}$/),
    }).parse(req.body)
    const result = verifyOtpChallenge(payload)
    setSession(res, result.phoneMasked, 'CITIZEN')
    addAudit({
      actor: 'مواطن',
      role: 'CITIZEN',
      action: 'PHONE_OTP_VERIFIED',
      entityType: 'PhoneVerification',
      entityId: payload.challengeId,
      metadata: { phoneMasked: result.phoneMasked, provider: 'OTPIQ' },
    })
    res.json(result)
  } catch (error) {
    const message = error instanceof z.ZodError ? 'أدخل رقم الهاتف ومعرّف الطلب ورمز التحقق المكوّن من 6 أرقام بصورة صحيحة.' : error instanceof Error ? error.message : 'تعذر التحقق من الرمز.'
    res.status(400).json({ message })
  }
})

app.post('/api/webhooks/otpiq', (req, res) => {
  try {
    const result = processOtpDeliveryWebhook({
      secret: req.header('x-otpiq-webhook-secret'),
      payload: req.body,
    })
    res.json(result)
  } catch {
    res.status(401).json({ message: 'Webhook غير مصرح.' })
  }
})

app.post('/api/onboarding/complete-identity', requireSession('CITIZEN'), (req, res) => {
  const payload = z.object({ fullName: z.string().min(3), consent: z.literal(true), livenessPassed: z.boolean() }).parse(req.body)
  const citizenId = ensureDemoCitizen()
  const timestamp = new Date().toISOString()
  db.prepare('UPDATE citizens SET full_name = ?, verification_status = ?, consent_at = ?, updated_at = ? WHERE id = ?')
    .run(payload.fullName, 'MANUAL_REVIEW', timestamp, timestamp, citizenId)
  addAudit({ actor: payload.fullName, role: 'CITIZEN', action: 'IDENTITY_REVIEW_REQUESTED', entityType: 'CitizenIdentity', entityId: String(citizenId), newValue: { status: 'MANUAL_REVIEW' }, metadata: { livenessClaimed: payload.livenessPassed, mediaPersisted: false } })
  res.json(getCitizen())
})

app.post('/api/onboarding/identity-review', requireSession('CITIZEN'), upload.fields([
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
  { name: 'faceVideo', maxCount: 1 },
]), (req, res) => {
  try {
    const payload = z.object({
      fullName: z.string().min(3).max(120),
      nationalId: z.string().min(4).max(30),
      consent: z.literal('true'),
    }).parse(req.body)
    const files = req.files as Record<string, Express.Multer.File[]> | undefined
    const idFront = files?.idFront?.[0]
    const idBack = files?.idBack?.[0]
    const faceVideo = files?.faceVideo?.[0]
    if (!idFront || !idBack || !faceVideo) return res.status(400).json({ message: 'صوّر الوجهين للهوية وفيديو الوجه القصير لإرسال طلب المراجعة.' })
    validateUploadedFile(idFront, ['image'])
    validateUploadedFile(idBack, ['image'])
    validateUploadedFile(faceVideo, ['video'])
    const screening = screenIdentitySubmission({ idFront, idBack, faceVideo })
    if (screening.qualityStatus === 'NEEDS_RECAPTURE') return res.status(422).json({ message: 'فحص الجودة الآلي طلب إعادة التصوير قبل حفظ بيانات الهوية.', screening })

    const citizenId = ensureDemoCitizen()
    const now = new Date()
    const retentionUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const front = storeEncryptedMedia({ citizenId, purpose: 'NATIONAL_ID_FRONT', originalName: idFront.originalname || 'national-id-front', mimeType: idFront.mimetype, buffer: idFront.buffer, retentionHours: 168 })
    const back = storeEncryptedMedia({ citizenId, purpose: 'NATIONAL_ID_BACK', originalName: idBack.originalname || 'national-id-back', mimeType: idBack.mimetype, buffer: idBack.buffer, retentionHours: 168 })
    const video = storeEncryptedMedia({ citizenId, purpose: 'FACE_VIDEO', originalName: faceVideo.originalname || 'face-video', mimeType: faceVideo.mimetype, buffer: faceVideo.buffer, retentionHours: 168 })
    const reviewId = `idv_${randomUUID().replaceAll('-', '')}`
    const maskedNationalId = `********${payload.nationalId.replace(/\s/g, '').slice(-4)}`

    db.prepare(`
      INSERT INTO identity_reviews (
        id, citizen_id, status, national_id_masked, id_front_media_id, id_back_media_id,
        face_video_media_id, quality_status, quality_score, quality_checks, face_match_status, face_match_score, face_match_provider,
        consent_at, submitted_at, retention_until, created_at, updated_at
      ) VALUES (?, ?, 'PENDING_REVIEW', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(reviewId, citizenId, maskedNationalId, front.id, back.id, video.id, screening.qualityStatus, screening.qualityScore, JSON.stringify(screening.qualityChecks), screening.faceMatchStatus, screening.faceMatchScore, screening.faceMatchProvider, now.toISOString(), now.toISOString(), retentionUntil, now.toISOString(), now.toISOString())
    db.prepare('UPDATE citizens SET full_name = ?, national_id_masked = ?, verification_status = ?, consent_at = ?, updated_at = ? WHERE id = ?')
      .run(payload.fullName, maskedNationalId, 'MANUAL_REVIEW', now.toISOString(), now.toISOString(), citizenId)
    createNotification({ citizenId, type: 'IDENTITY_REVIEW', title: 'تم استلام طلب توثيق الهوية', message: 'وصلت صور الهوية وفيديو الوجه إلى قائمة المراجعة. ستصلك نتيجة القرار هنا.', link: '/citizen' })
    addAudit({
      actor: payload.fullName,
      role: 'CITIZEN',
      action: 'IDENTITY_MEDIA_SUBMITTED',
      entityType: 'IdentityReview',
      entityId: reviewId,
      newValue: { status: 'PENDING_REVIEW', media: [front.id, back.id, video.id] },
      metadata: { consent: true, retentionUntil, rawNationalIdStored: false, qualityScore: screening.qualityScore, faceMatchStatus: screening.faceMatchStatus },
    })
    res.status(201).json({
      id: reviewId,
      status: 'PENDING_REVIEW',
      retentionUntil,
      files: [front, back, video].map(file => ({ id: file.id, purpose: file.purpose, sizeBytes: file.sizeBytes })),
      screening,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'تعذر حفظ طلب مراجعة الهوية.'
    res.status(400).json({ message })
  }
})

app.get('/api/onboarding/identity-review/latest', requireSession('CITIZEN'), (_req, res) => {
  const citizenId = ensureDemoCitizen()
  const review = db.prepare(`
    SELECT id, status, national_id_masked, submitted_at, reviewed_at, review_notes, retention_until, quality_status, quality_score, quality_checks, face_match_status, face_match_score, face_match_provider
    FROM identity_reviews WHERE citizen_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(citizenId)
  res.json(review || null)
})

app.get('/api/admin/identity-reviews', requireSession('EMPLOYEE', 'IDENTITY_REVIEWER'), requireReviewAccess, (_req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.status, r.national_id_masked, r.consent_at, r.submitted_at, r.reviewed_at, r.reviewed_by, r.review_notes, r.retention_until,
           r.quality_status, r.quality_score, r.quality_checks, r.face_match_status, r.face_match_score, r.face_match_provider,
           c.full_name, c.phone_masked,
           front.id AS front_id, front.mime_type AS front_mime, front.size_bytes AS front_size,
           back.id AS back_id, back.mime_type AS back_mime, back.size_bytes AS back_size,
           face.id AS face_id, face.mime_type AS face_mime, face.size_bytes AS face_size
    FROM identity_reviews r
    JOIN citizens c ON c.id = r.citizen_id
    LEFT JOIN media_objects front ON front.id = r.id_front_media_id
    LEFT JOIN media_objects back ON back.id = r.id_back_media_id
    LEFT JOIN media_objects face ON face.id = r.face_video_media_id
    ORDER BY CASE r.status WHEN 'PENDING_REVIEW' THEN 0 ELSE 1 END, r.submitted_at DESC
  `).all() as Array<Record<string, unknown>>
  addAudit({ actor: 'Identity Reviewer', role: 'IDENTITY_REVIEWER', action: 'IDENTITY_REVIEW_QUEUE_VIEWED', entityType: 'IdentityReviewQueue', entityId: 'all', metadata: { count: rows.length } })
  res.json(rows.map(row => ({
    id: row.id,
    status: row.status,
    citizenName: row.full_name,
    phoneMasked: row.phone_masked,
    nationalIdMasked: row.national_id_masked,
    consentAt: row.consent_at,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    notes: row.review_notes,
    retentionUntil: row.retention_until,
    screening: {
      qualityStatus: row.quality_status,
      qualityScore: row.quality_score,
      qualityChecks: row.quality_checks ? JSON.parse(String(row.quality_checks)) : [],
      faceMatchStatus: row.face_match_status,
      faceMatchScore: row.face_match_score,
      faceMatchProvider: row.face_match_provider,
    },
    media: [
      { id: row.front_id, label: 'وجه الهوية', mimeType: row.front_mime, sizeBytes: row.front_size },
      { id: row.back_id, label: 'ظهر الهوية', mimeType: row.back_mime, sizeBytes: row.back_size },
      { id: row.face_id, label: 'فيديو الوجه', mimeType: row.face_mime, sizeBytes: row.face_size },
    ].filter(item => typeof item.id === 'string'),
  })))
})

app.get('/api/admin/media/:id', requireSession('EMPLOYEE', 'IDENTITY_REVIEWER'), requireReviewAccess, (req, res) => {
  try {
    const media = readDecryptedMedia(req.params.id)
    if (!media) return res.status(404).json({ message: 'الوسيط غير متاح أو انتهت مدة الاحتفاظ.' })
    addAudit({ actor: 'Identity Reviewer', role: 'IDENTITY_REVIEWER', action: 'IDENTITY_MEDIA_VIEWED', entityType: 'MediaObject', entityId: req.params.id, metadata: { purpose: 'identity-review' } })
    res.setHeader('Content-Type', media.mimeType)
    res.setHeader('Content-Disposition', 'inline')
    res.setHeader('Cache-Control', 'private, no-store')
    res.send(media.buffer)
  } catch {
    res.status(500).json({ message: 'تعذر فتح الوسيط المشفر.' })
  }
})

app.post('/api/admin/identity-reviews/:id/decision', requireSession('EMPLOYEE', 'IDENTITY_REVIEWER'), requireReviewAccess, (req, res) => {
  try {
    const payload = z.object({ decision: z.enum(['APPROVED', 'REJECTED', 'NEEDS_RESUBMISSION']), notes: z.string().max(1000).default('') }).parse(req.body)
    const review = db.prepare('SELECT * FROM identity_reviews WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!review) return res.status(404).json({ message: 'طلب المراجعة غير موجود.' })
    if (review.status !== 'PENDING_REVIEW') return res.status(409).json({ message: 'تم اتخاذ قرار سابق لهذا الطلب.' })
    const timestamp = new Date().toISOString()
    db.exec('BEGIN')
    try {
      db.prepare(`UPDATE identity_reviews SET status = ?, reviewed_at = ?, reviewed_by = ?, review_notes = ?, updated_at = ? WHERE id = ?`)
        .run(payload.decision, timestamp, 'موظف مراجعة الهوية', payload.notes, timestamp, req.params.id)
      const citizenStatus = payload.decision === 'APPROVED' ? 'VERIFIED_MANUAL' : payload.decision
      db.prepare('UPDATE citizens SET verification_status = ?, updated_at = ? WHERE id = ?').run(citizenStatus, timestamp, review.citizen_id)
      createNotification({ citizenId: Number(review.citizen_id), type: 'IDENTITY_DECISION', title: payload.decision === 'APPROVED' ? 'تم اعتماد مراجعة الهوية' : payload.decision === 'NEEDS_RESUBMISSION' ? 'مطلوب إعادة رفع الهوية' : 'تعذر اعتماد مراجعة الهوية', message: payload.notes || (payload.decision === 'APPROVED' ? 'اكتملت المراجعة البشرية ويمكنك متابعة الخدمات المتاحة.' : 'راجع الملاحظة وأعد تقديم البيانات المطلوبة.'), link: '/citizen' })
      addAudit({ actor: 'موظف مراجعة الهوية', role: 'IDENTITY_REVIEWER', action: 'IDENTITY_REVIEW_DECIDED', entityType: 'IdentityReview', entityId: req.params.id, previousValue: { status: review.status }, newValue: { status: payload.decision }, metadata: { notesLength: payload.notes.length } })
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    for (const mediaId of [review.id_front_media_id, review.id_back_media_id, review.face_video_media_id]) {
      if (typeof mediaId === 'string') deleteEncryptedMedia(mediaId)
    }
    res.json({ id: req.params.id, status: payload.decision, reviewedAt: timestamp, mediaPurged: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'تعذر حفظ قرار المراجعة.'
    res.status(400).json({ message })
  }
})

app.get('/api/applications', requireSession('EMPLOYEE'), (_req, res) => res.json(getApplications()))

app.get('/api/applications/:reference', requireSession('CITIZEN', 'EMPLOYEE'), (req, res) => {
  const item = getApplicationByReference(req.params.reference)
  if (!item) return res.status(404).json({ message: 'المعاملة غير موجودة.' })
  addAudit({ actor: 'مستخدم مصرح', role: 'PORTAL_USER', action: 'APPLICATION_VIEW', entityType: 'Application', entityId: req.params.reference, metadata: { maskedCitizenData: true } })
  res.json(item)
})

app.post('/api/applications', requireSession('CITIZEN'), upload.fields([{ name: 'propertyDocument', maxCount: 1 }, { name: 'storefrontPhoto', maxCount: 1 }]), (req, res) => {
  const payload = z.object({
    serviceKey: z.string().min(2),
    serviceName: z.string().min(2),
    department: z.string().min(2),
    businessName: z.string().min(2),
    activityType: z.string().min(2),
    address: z.string().min(4),
    district: z.string().min(2),
    ownershipType: z.enum(['rent', 'owned']),
    coordinates: z.preprocess(value => {
      if (typeof value !== 'string') return value
      try { return JSON.parse(value) } catch { return value }
    }, z.object({ lat: z.coerce.number(), lng: z.coerce.number() })),
    fee: z.coerce.number().nonnegative(),
    attachments: z.array(z.string()).default([]),
  }).parse(req.body)
  const citizen = getCitizen() as { id: number; fullName: string; verificationStatus: string }
  if (!['VERIFIED', 'VERIFIED_MANUAL'].includes(citizen.verificationStatus)) return res.status(409).json({ message: 'أكمل مراجعة الهوية أولاً قبل تقديم خدمة جديدة.' })
  const files = req.files as Record<string, Express.Multer.File[]> | undefined
  const propertyDocument = files?.propertyDocument?.[0]
  const storefrontPhoto = files?.storefrontPhoto?.[0]
  const requiredPropertyDocument = payload.ownershipType === 'rent' ? 'عقد الإيجار' : 'سند الملكية'
  if (payload.serviceKey === 'store-license' && (!propertyDocument || !storefrontPhoto)) return res.status(400).json({ message: `يرجى تصوير أو رفع ${requiredPropertyDocument} وصورة واجهة المحل قبل إرسال الطلب.` })
  if (propertyDocument) validateUploadedFile(propertyDocument, ['image', 'pdf'])
  if (storefrontPhoto) validateUploadedFile(storefrontPhoto, ['image'])
  const timestamp = new Date().toISOString()
  const serial = String((db.prepare('SELECT COUNT(*) AS count FROM applications').get() as { count: number }).count + 1).padStart(4, '0')
  const reference = `TQD-2026-${serial}`
  const result = db.prepare(`
    INSERT INTO applications (
      reference, citizen_id, citizen_name, service_key, service_name, department, status,
      current_action, business_name, activity_type, address, district, ownership_type,
      lat, lng, fee, payment_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reference, citizen.id, citizen.fullName, payload.serviceKey, payload.serviceName, payload.department,
    'SUBMITTED', 'لا يوجد إجراء مطلوب منك. المعاملة لدى الموظف المختص.', payload.businessName,
    payload.activityType, payload.address, payload.district, payload.ownershipType,
    payload.coordinates.lat, payload.coordinates.lng, payload.fee,
    payload.fee > 0 ? 'PENDING' : 'NOT_REQUIRED', timestamp, timestamp,
  )
  const applicationId = Number(result.lastInsertRowid)
  const protectedFiles: Array<{ file: Express.Multer.File; purpose: 'APPLICATION_DOCUMENT' | 'STOREFRONT_PHOTO'; label: string }> = []
  if (propertyDocument) protectedFiles.push({ file: propertyDocument, purpose: 'APPLICATION_DOCUMENT', label: requiredPropertyDocument })
  if (storefrontPhoto) protectedFiles.push({ file: storefrontPhoto, purpose: 'STOREFRONT_PHOTO', label: 'صورة واجهة المحل' })
  for (const item of protectedFiles) {
    const media = storeEncryptedMedia({ citizenId: citizen.id, purpose: item.purpose, originalName: item.file.originalname || item.label, mimeType: item.file.mimetype, buffer: item.file.buffer, retentionHours: 24 * 30 })
    db.prepare('INSERT INTO application_media (id, application_id, media_id, label, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(`appmedia_${randomUUID().replaceAll('-', '')}`, applicationId, media.id, item.label, timestamp)
  }
  addEvent(applicationId, { type: 'APPLICATION_CREATED', title: 'تم التقديم', description: 'استلمت المنصة الطلب والمرفقات المشفرة وسجلته للتدقيق.', actor: 'المواطن' })
  addEvent(applicationId, { type: 'ROUTED', title: 'تم التوجيه إلى الدائرة', description: `تم توجيه الطلب آلياً إلى ${payload.department}.`, actor: 'محرك سير العمل' })
  createNotification({ citizenId: citizen.id, type: 'APPLICATION_CREATED', title: 'تم تسجيل المعاملة', message: `سُجل طلب ${payload.serviceName} بالرقم ${reference} ووُجه إلى ${payload.department}.`, link: `/citizen/application/${reference}` })
  addAudit({ actor: citizen.fullName, role: 'CITIZEN', action: 'APPLICATION_CREATED', entityType: 'Application', entityId: reference, newValue: { service: payload.serviceKey, district: payload.district }, metadata: { protectedAttachments: protectedFiles.map(file => file.label), retentionDays: 30 } })
  res.status(201).json(getApplicationByReference(reference))
})

app.post('/api/applications/:reference/request-document', requireSession('EMPLOYEE'), (req, res) => {
  const payload = z.object({ documentName: z.string().min(2) }).parse(req.body)
  const item = getApplicationByReference(req.params.reference)
  if (!item) return res.status(404).json({ message: 'المعاملة غير موجودة.' })
  const timestamp = new Date().toISOString()
  db.prepare(`UPDATE applications SET status = 'ACTION_REQUIRED', current_action = ?, required_document = ?, updated_at = ? WHERE reference = ?`)
    .run(`يرجى رفع ${payload.documentName} لإكمال التدقيق.`, payload.documentName, timestamp, req.params.reference)
  addEvent(item.id as number, { type: 'INFORMATION_REQUESTED', title: 'طلب معلومات إضافية', description: `طلب الموظف رفع ${payload.documentName}.`, actor: 'موظفة التدقيق — سارة كاظم' })
  createNotification({ citizenId: Number(item.citizenId), type: 'ACTION_REQUIRED', title: 'مطلوب مستند إضافي', message: `ارفع ${payload.documentName} لإكمال تدقيق المعاملة ${req.params.reference}.`, link: `/citizen/application/${req.params.reference}` })
  addAudit({ actor: 'سارة كاظم حسن', role: 'EMPLOYEE', action: 'DOCUMENT_REQUESTED', entityType: 'Application', entityId: req.params.reference, previousValue: { status: item.status }, newValue: { status: 'ACTION_REQUIRED', document: payload.documentName } })
  res.json(getApplicationByReference(req.params.reference))
})

app.post('/api/applications/:reference/upload-document', requireSession('CITIZEN'), upload.single('document'), (req, res) => {
  const payload = z.object({ documentName: z.string().min(2) }).parse(req.body)
  const item = getApplicationByReference(req.params.reference)
  if (!item) return res.status(404).json({ message: 'المعاملة غير موجودة.' })
  if (!req.file) return res.status(400).json({ message: `صوّر أو ارفع ${payload.documentName} قبل الإرسال.` })
  validateUploadedFile(req.file, ['image', 'pdf'])
  const timestamp = new Date().toISOString()
  const media = storeEncryptedMedia({ citizenId: Number(item.citizenId), purpose: 'APPLICATION_DOCUMENT', originalName: req.file.originalname || payload.documentName, mimeType: req.file.mimetype, buffer: req.file.buffer, retentionHours: 24 * 30 })
  db.prepare('INSERT INTO application_media (id, application_id, media_id, label, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(`appmedia_${randomUUID().replaceAll('-', '')}`, item.id, media.id, payload.documentName, timestamp)
  db.prepare(`UPDATE applications SET status = 'UNDER_REVIEW', current_action = 'لا يوجد إجراء مطلوب منك. تم استلام المستند وأعيدت المعاملة للموظف المختص.', required_document = NULL, updated_at = ? WHERE reference = ?`)
    .run(timestamp, req.params.reference)
  addEvent(item.id as number, { type: 'DOCUMENT_UPLOADED', title: 'تم استكمال المعلومات', description: `رفع المواطن ${payload.documentName} بشكل مشفر وأعيدت المعاملة إلى التدقيق.`, actor: 'المواطن' })
  createNotification({ citizenId: Number(item.citizenId), type: 'DOCUMENT_RECEIVED', title: 'تم استلام المستند', message: `استلمت المنصة ${payload.documentName} وأعادت المعاملة إلى الموظف المختص.`, link: `/citizen/application/${req.params.reference}` })
  addAudit({ actor: item.citizenName as string, role: 'CITIZEN', action: 'MISSING_DOCUMENT_UPLOADED', entityType: 'Application', entityId: req.params.reference, previousValue: { status: item.status }, newValue: { status: 'UNDER_REVIEW', document: payload.documentName }, metadata: { protectedMediaId: media.id, retentionDays: 30 } })
  res.json(getApplicationByReference(req.params.reference))
})

app.post('/api/applications/:reference/approve', requireSession('EMPLOYEE'), (req, res) => {
  const item = getApplicationByReference(req.params.reference)
  if (!item) return res.status(404).json({ message: 'المعاملة غير موجودة.' })
  if (item.status === 'ACTION_REQUIRED') return res.status(409).json({ message: 'لا يمكن الموافقة قبل استكمال المستند المطلوب.' })
  if (item.status === 'APPROVED') return res.json(item)
  const timestamp = new Date().toISOString()
  if ((item.fee as number) > 0) {
    db.prepare(`UPDATE applications SET status = 'PAYMENT_REQUIRED', current_action = 'تمت الموافقة الإدارية. بانتظار تهيئة بوابة الدفع المعتمدة لإكمال سداد الرسم وإصدار الوثيقة.', payment_status = 'PENDING', updated_at = ? WHERE reference = ?`)
      .run(timestamp, req.params.reference)
    addEvent(item.id as number, { type: 'PAYMENT_REQUIRED', title: 'بانتظار الدفع', description: `رسم الخدمة ${item.fee} د.ع. لا يُسجل دفع ولا تصدر وثيقة حتى عودة بوابة الدفع المعتمدة.`, actor: 'محرك سير العمل' })
    createNotification({ citizenId: Number(item.citizenId), type: 'PAYMENT_REQUIRED', title: 'المعاملة بانتظار الدفع', message: `تمت الموافقة الإدارية على ${req.params.reference}. سيُفتح الدفع عند ربط بوابة الدفع المعتمدة.`, link: `/citizen/application/${req.params.reference}` })
    addAudit({ actor: 'سارة كاظم حسن', role: 'EMPLOYEE', action: 'PAYMENT_REQUIRED', entityType: 'Application', entityId: req.params.reference, previousValue: { status: item.status }, newValue: { status: 'PAYMENT_REQUIRED' }, metadata: { fee: item.fee, providerConfigured: false } })
    return res.json(getApplicationByReference(req.params.reference))
  }
  const documentNumber = `LIC-${new Date().getFullYear()}-${String(item.id).padStart(5, '0')}`
  const verificationId = `TQD-${randomUUID().replaceAll('-', '').slice(0, 18).toUpperCase()}`
  db.exec('BEGIN')
  try {
    db.prepare(`UPDATE applications SET status = 'APPROVED', current_action = 'اكتملت المعاملة. يمكنك تحميل الوثيقة والتحقق منها عبر QR.', payment_status = 'NOT_REQUIRED', document_number = ?, verification_id = ?, updated_at = ? WHERE reference = ?`)
      .run(documentNumber, verificationId, timestamp, req.params.reference)
    addEvent(item.id as number, { type: 'APPROVED', title: 'تمت الموافقة', description: 'اعتمد الموظف المختص الطلب.', actor: 'موظفة التدقيق — سارة كاظم' })
    addEvent(item.id as number, { type: 'DOCUMENT_ISSUED', title: 'تم إصدار الوثيقة', description: `أُنشئت الوثيقة ${documentNumber} ومعرّف التحقق الرقمي.`, actor: 'نظام الوثائق الرقمية' })
    createNotification({ citizenId: Number(item.citizenId), type: 'DOCUMENT_ISSUED', title: 'اكتملت المعاملة', message: `صدرت الوثيقة ${documentNumber}. يمكنك تحميلها والتحقق منها عبر QR.`, link: `/citizen/application/${req.params.reference}` })
    addAudit({ actor: 'سارة كاظم حسن', role: 'EMPLOYEE', action: 'APPLICATION_APPROVED', entityType: 'Application', entityId: req.params.reference, previousValue: { status: item.status }, newValue: { status: 'APPROVED', documentNumber }, metadata: { paymentRecorded: false, qrVerification: true } })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  res.json(getApplicationByReference(req.params.reference))
})

app.get('/api/verify/:verificationId', (req, res) => {
  const item = getApplicationByVerificationId(req.params.verificationId)
  if (!item) return res.status(404).json({ message: 'لم يتم العثور على وثيقة صادرة بهذا المعرّف.' })
  addAudit({ actor: 'Public Verification', role: 'PUBLIC', action: 'DOCUMENT_VERIFIED', entityType: 'Document', entityId: req.params.verificationId, metadata: { exposedFields: 'minimal' } })
  res.json(item)
})

function getRegistryDepartments() {
  const activityRows = db.prepare('SELECT department, COUNT(*) AS transactions FROM applications GROUP BY department').all() as Array<{ department: string; transactions: number }>
  const activityByDepartment = new Map(activityRows.map(row => [row.department, row.transactions]))
  return departmentRegistry.map(item => ({
    id: item.id,
    name: item.name,
    type: item.category,
    district: item.district,
    lat: item.lat,
    lng: item.lng,
    status: item.gisStatus === 'COORDINATES_VERIFIED' ? 'ONLINE' : 'UNKNOWN',
    transactions: activityByDepartment.get(item.name) || 0,
    automation: 0,
    sourceUrl: item.sourceUrl,
    dataStatus: item.dataStatus,
    gisStatus: item.gisStatus,
  }))
}

app.get('/api/dashboard/stats', (_req, res) => {
  const dynamic = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS completed FROM applications`).get() as { total: number; completed: number | null }
  const citizenCount = db.prepare('SELECT COUNT(*) AS total FROM citizens').get() as { total: number }
  const payments = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS collected FROM payments WHERE status = 'SETTLED'`).get() as { collected: number }
  const dateRows = db.prepare(`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS applications, SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS completed FROM applications GROUP BY substr(created_at, 1, 10)`).all() as Array<{ day: string; applications: number; completed: number | null }>
  const byDay = new Map(dateRows.map(row => [row.day, row]))
  const series = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setUTCDate(date.getUTCDate() - (6 - index))
    const key = date.toISOString().slice(0, 10); const row = byDay.get(key)
    return { day: key.slice(5).split('-').reverse().join('/'), applications: row?.applications || 0, completed: row?.completed || 0 }
  })
  res.json({
    todayApplications: dynamic.total,
    completed: dynamic.completed || 0,
    overdue: 0,
    activeCitizens: citizenCount.total,
    activeEmployees: 0,
    departmentsOnline: registrySummary.verified,
    financialCollection: payments.collected,
    complaints: 0,
    avgProcessingHours: 0,
    automationRate: 0,
    series,
    departments: getRegistryDepartments(),
    registry: registrySummary,
  })
})

app.post('/api/system/reset-test-data', requireSession('EMPLOYEE'), (_req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ message: 'المسار غير متاح.' })
  resetDemo()
  addAudit({ actor: 'Local Operator', role: 'EMPLOYEE', action: 'LOCAL_TEST_DATA_RESET', entityType: 'System', entityId: 'local-test-data', metadata: { localOnly: true } })
  res.json({ success: true })
})

if (existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }))
  app.get('/{*path}', (_req, res) => res.sendFile(join(distDir, 'index.html')))
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = String(res.locals.requestId || randomUUID())
  if (error instanceof z.ZodError) return res.status(400).json({ message: 'البيانات المدخلة غير مكتملة أو غير صحيحة.', requestId })
  if (error instanceof multer.MulterError) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ message: 'تعذر قبول الملف بسبب الحجم أو العدد.', requestId })
  if (error instanceof Error && error.message.includes('Origin غير مصرح')) return res.status(403).json({ message: 'المصدر غير مصرح.', requestId })
  console.error(`[${requestId}]`, error)
  res.status(500).json({ message: 'حدث خطأ داخلي. تم تسجيل مرجع الخطأ للمتابعة.', requestId })
})

app.listen(port, '0.0.0.0', () => {
  console.log(`Dhi Qar Digital API listening on http://0.0.0.0:${port}`)
})
