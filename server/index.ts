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
  createFeedback,
  attachFeedbackMedia,
  getFeedbackByReference,
  getFeedbackForAdmin,
  getFeedbackForCitizen,
  updateFeedbackStatus,
  db,
  getCitizenById,
  getOrCreateCitizen,
  getCitizenNotifications,
  getApplicationByReference,
  getApplicationByVerificationId,
  getApplications,
  getApplicationsForCitizen,
  markAllNotificationsRead,
  markNotificationRead,
  resetDemo,
} from './db.js'
import { createOtpChallenge, processOtpDeliveryWebhook, verifyOtpChallenge } from './otp.js'
import { deleteEncryptedMedia, readDecryptedMedia, storeEncryptedMedia } from './media.js'
import { departmentRegistry, registrySummary } from './department-registry.js'
import { getServiceDefinition } from '../src/service-forms.js'
import { screenIdentitySubmission } from './identity-screening.js'
import { getGovernmentService, getGovernmentServiceDirectoryStats, listGovernmentServiceVersions, listGovernmentServices, setGovernmentServicePublication, upsertGovernmentService, type GovernmentServiceRecordInput } from './government-service-directory.js'
import { seedVerifiedGovernmentServices } from './government-service-seed.js'

const app = express()
seedVerifiedGovernmentServices()
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

type SessionRole = 'CITIZEN' | 'EMPLOYEE' | 'IDENTITY_REVIEWER' | 'OPERATIONS' | 'SUPER_ADMIN'
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

function currentCitizen(res: express.Response) {
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

function hasReviewAccess(req: express.Request) {
  return secureStringEquals(process.env.ADMIN_REVIEW_PASSWORD, req.header('x-review-access-code'))
}

function requireReviewAccess(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session = res.locals.session as SessionData | undefined
  if (session?.role === 'SUPER_ADMIN') return next()
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

app.get('/api/government-services', (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : undefined
  const dhiQarOnly = req.query.dhiQar === 'true'
  res.json(listGovernmentServices({ query, dhiQarOnly, publicationStatus: 'APPROVED', limit: 200 }))
})

app.get('/api/government-services/:id', (req, res) => {
  const service = getGovernmentService(req.params.id)
  if (!service || service.publicationStatus !== 'APPROVED' || !service.active) return res.status(404).json({ message: 'الخدمة غير موجودة أو غير منشورة.' })
  res.json(service)
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

app.post('/api/auth/operations', sensitiveLimiter, (req, res) => {
  const payload = z.object({ accessCode: z.string().regex(/^\d{4}$/) }).parse(req.body)
  if (!secureStringEquals(process.env.OPERATIONS_PASSWORD, payload.accessCode)) return res.status(401).json({ message: 'بيانات دخول غرفة العمليات غير صحيحة.' })
  setSession(res, 'operations-controller', 'OPERATIONS')
  addAudit({ actor: 'مشغل غرفة العمليات', role: 'OPERATIONS', action: 'OPERATIONS_SESSION_CREATED', entityType: 'Session', entityId: randomUUID(), metadata: { ip: req.ip } })
  res.json({ authenticated: true, role: 'OPERATIONS', expiresInSeconds: sessionTtlSeconds })
})

app.post('/api/auth/super-admin', sensitiveLimiter, (req, res) => {
  const payload = z.object({ accessCode: z.string().min(12).max(200) }).parse(req.body)
  if (!secureStringEquals(process.env.SUPER_ADMIN_PASSWORD, payload.accessCode)) return res.status(401).json({ message: 'بيانات دخول المدير العام غير صحيحة.' })
  setSession(res, 'super-admin', 'SUPER_ADMIN')
  addAudit({ actor: 'مدير النظام', role: 'SUPER_ADMIN', action: 'SUPER_ADMIN_SESSION_CREATED', entityType: 'Session', entityId: randomUUID(), metadata: { ip: req.ip } })
  res.json({ authenticated: true, role: 'SUPER_ADMIN', expiresInSeconds: sessionTtlSeconds })
})

app.post('/api/auth/logout', (req, res) => {
  const session = readSession(req)
  clearSession(res)
  if (session) addAudit({ actor: session.sub, role: session.role, action: 'SESSION_ENDED', entityType: 'Session', entityId: session.sub })
  res.json({ success: true })
})

app.get('/api/citizen/demo', requireSession('CITIZEN'), (_req, res) => {
  const citizen = currentCitizen(res)
  if (!citizen) return
  addAudit({ actor: citizen.fullName, role: 'CITIZEN', action: 'PROFILE_VIEW', entityType: 'Citizen', entityId: String(citizen.id), metadata: { masked: true } })
  res.json(citizen)
})

app.get('/api/citizen/applications', requireSession('CITIZEN'), (_req, res) => {
  const citizen = currentCitizen(res)
  if (!citizen) return
  res.json(getApplicationsForCitizen(citizen.id))
})

app.get('/api/citizen/notifications', requireSession('CITIZEN'), (_req, res) => {
  const citizen = currentCitizen(res)
  if (!citizen) return
  res.json(getCitizenNotifications(citizen.id))
})

app.patch('/api/citizen/notifications/:id/read', requireSession('CITIZEN'), (req, res) => {
  const citizen = currentCitizen(res)
  if (!citizen) return
  if (!markNotificationRead(citizen.id, req.params.id)) return res.status(404).json({ message: 'الإشعار غير موجود.' })
  res.json(getCitizenNotifications(citizen.id))
})

app.post('/api/citizen/notifications/read-all', requireSession('CITIZEN'), (_req, res) => {
  const citizen = currentCitizen(res)
  if (!citizen) return
  const updated = markAllNotificationsRead(citizen.id)
  addAudit({ actor: citizen.fullName, role: 'CITIZEN', action: 'NOTIFICATIONS_MARKED_READ', entityType: 'Notification', entityId: 'all', metadata: { updated } })
  res.json(getCitizenNotifications(citizen.id))
})

app.get('/api/citizen/service-requests', requireSession('CITIZEN'), (_req, res) => {
  const citizen = currentCitizen(res)
  if (!citizen) return
  const rows = db.prepare(`SELECT sr.*, a.id AS appointment_id, a.preferred_date, a.preferred_time, a.status AS appointment_status, a.confirmation_note
    FROM service_requests sr LEFT JOIN appointments a ON a.service_request_id = sr.id
    WHERE sr.citizen_id = ? ORDER BY sr.created_at DESC`).all(citizen.id) as Array<Record<string, unknown>>
  res.json(rows.map(row => ({
    id: row.id, reference: row.reference, serviceKey: row.service_id, departmentId: row.department_id, status: row.status,
    formData: JSON.parse(String(row.form_data || '{}')), currentAction: row.current_action, decisionNote: row.decision_note || null, requiredDocument: row.required_document || null, attachments: serviceRequestAttachments(Number(row.id)), createdAt: row.created_at, updatedAt: row.updated_at,
    appointment: row.appointment_id ? { id: row.appointment_id, preferredDate: row.preferred_date, preferredTime: row.preferred_time, status: row.appointment_status, note: row.confirmation_note } : null,
  })))
})

app.get('/api/citizen/feedback', requireSession('CITIZEN'), (_req, res) => {
  const citizen = currentCitizen(res)
  if (!citizen) return
  res.json(getFeedbackForCitizen(citizen.id))
})

app.get('/api/citizen/feedback/:reference', requireSession('CITIZEN'), (req, res) => {
  const citizen = currentCitizen(res)
  if (!citizen) return
  const feedback = getFeedbackByReference(req.params.reference)
  if (!feedback || feedback.citizenId !== citizen.id) return res.status(404).json({ message: 'الشكوى أو المقترح غير موجود ضمن حسابك.' })
  res.json(feedback)
})

app.post('/api/citizen/feedback', requireSession('CITIZEN'), upload.array('attachments', 3), (req, res) => {
  try {
    const citizen = currentCitizen(res)
    if (!citizen) return
    if (!['VERIFIED', 'VERIFIED_MANUAL'].includes(citizen.verificationStatus)) return res.status(409).json({ message: 'أكمل مراجعة الهوية قبل إرسال شكوى أو مقترح.' })
    const asOptionalText = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined
    const asOptionalNumber = (value: unknown) => {
      if (value === undefined || value === null || value === '') return undefined
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : value
    }
    const parsed = z.object({
      kind: z.enum(['COMPLAINT', 'SUGGESTION']),
      category: z.string().min(2).max(80),
      departmentId: z.preprocess(asOptionalText, z.string().min(2).max(100).optional()),
      subject: z.string().trim().min(6).max(160),
      description: z.string().trim().min(20).max(4000),
      district: z.preprocess(asOptionalText, z.string().min(2).max(80).optional()),
      lat: z.preprocess(asOptionalNumber, z.number().min(29).max(35).optional()),
      lng: z.preprocess(asOptionalNumber, z.number().min(42).max(50).optional()),
    }).parse(req.body)
    if ((parsed.lat === undefined) !== (parsed.lng === undefined)) return res.status(400).json({ message: 'حدد موقعاً كاملاً أو اترك حقلي الموقع فارغين.' })
    if (parsed.departmentId && !departmentRegistry.some(item => item.id === parsed.departmentId)) return res.status(400).json({ message: 'الدائرة المحددة غير موجودة في سجل المنصة.' })
    const feedback = createFeedback({ citizenId: citizen.id, ...parsed })
    const files = (req.files || []) as Express.Multer.File[]
    for (const [index, file] of files.entries()) {
      const mimeType = validateUploadedFile(file, ['image', 'pdf'])
      const media = storeEncryptedMedia({ citizenId: citizen.id, purpose: 'FEEDBACK_ATTACHMENT', originalName: file.originalname || `feedback-${index + 1}`, mimeType, buffer: file.buffer, retentionHours: 168 })
      attachFeedbackMedia(feedback.id, media.id, `مرفق ${index + 1}`)
    }
    const result = getFeedbackByReference(feedback.reference)!
    createNotification({ citizenId: citizen.id, type: parsed.kind === 'COMPLAINT' ? 'COMPLAINT_CREATED' : 'SUGGESTION_CREATED', title: parsed.kind === 'COMPLAINT' ? 'تم استلام الشكوى' : 'تم استلام المقترح', message: `${result.reference} — ${result.currentAction}`, link: `/citizen/feedback/${result.reference}` })
    addAudit({ actor: citizen.fullName, role: 'CITIZEN', action: parsed.kind === 'COMPLAINT' ? 'COMPLAINT_CREATED' : 'SUGGESTION_CREATED', entityType: 'CitizenFeedback', entityId: result.reference, newValue: { category: parsed.category, departmentId: parsed.departmentId, attachmentCount: files.length }, metadata: { hasLocation: parsed.lat !== undefined } })
    res.status(201).json(result)
  } catch (error) {
    const message = error instanceof z.ZodError ? 'تحقق من نوع الطلب والعنوان والوصف والموقع قبل الإرسال.' : error instanceof Error ? error.message : 'تعذر تسجيل الطلب.'
    res.status(400).json({ message })
  }
})

app.get('/api/citizen/feedback/:reference/media/:mediaId', requireSession('CITIZEN'), (req, res) => {
  const citizen = currentCitizen(res)
  if (!citizen) return
  const linked = db.prepare(`SELECT 1 FROM feedback_media fm JOIN citizen_feedback cf ON cf.id = fm.feedback_id
    WHERE cf.reference = ? AND cf.citizen_id = ? AND fm.media_id = ?`).get(req.params.reference, citizen.id, req.params.mediaId)
  if (!linked) return res.status(404).json({ message: 'المرفق غير موجود ضمن طلبك.' })
  const media = readDecryptedMedia(req.params.mediaId)
  if (!media) return res.status(404).json({ message: 'المرفق لم يعد متاحاً.' })
  res.setHeader('Content-Type', media.mimeType)
  res.setHeader('Content-Disposition', `inline; filename="${media.originalName.replaceAll('"', '')}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.send(media.buffer)
})

app.get('/api/admin/feedback', requireSession('EMPLOYEE', 'SUPER_ADMIN'), (_req, res) => {
  res.json(getFeedbackForAdmin())
})

app.patch('/api/admin/feedback/:reference', requireSession('EMPLOYEE', 'SUPER_ADMIN'), (req, res) => {
  const feedback = getFeedbackByReference(req.params.reference)
  if (!feedback) return res.status(404).json({ message: 'الطلب غير موجود.' })
  const parsed = z.object({
    status: z.enum(['IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
    currentAction: z.string().trim().min(6).max(500),
    adminNote: z.string().trim().max(1500).optional(),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'تحقق من الحالة ووصف الإجراء قبل الحفظ.' })
  const session = res.locals.session as SessionData
  const actor = session.role === 'SUPER_ADMIN' ? 'مدير النظام' : 'موظف مختص'
  const updated = updateFeedbackStatus(feedback.id, { ...parsed.data, actor })
  createNotification({ citizenId: feedback.citizenId, type: 'FEEDBACK_UPDATED', title: feedback.kind === 'COMPLAINT' ? 'تحديث على الشكوى' : 'تحديث على المقترح', message: `${feedback.reference} — ${parsed.data.currentAction}`, link: `/citizen/feedback/${feedback.reference}` })
  addAudit({ actor, role: session.role, action: 'FEEDBACK_STATUS_UPDATED', entityType: 'CitizenFeedback', entityId: feedback.reference, previousValue: { status: feedback.status }, newValue: { status: parsed.data.status } })
  res.json(updated)
})

app.post('/api/service-requests', requireSession('CITIZEN'), (req, res) => {
  const payload = z.object({ serviceKey: z.string().min(2).max(80), data: z.record(z.string(), z.unknown()) }).parse(req.body)
  const definition = getServiceDefinition(payload.serviceKey)
  if (!definition || !['GENERIC', 'APPOINTMENT'].includes(definition.mode)) return res.status(404).json({ message: 'هذه الخدمة لا تُنشأ عبر استمارة محلية داخل المنصة.' })
  const citizen = currentCitizen(res)
  if (!citizen) return
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

const serviceRequestAttachments = (requestId: number) => (db.prepare(`SELECT srm.id, srm.media_id, srm.label, mo.original_name, mo.mime_type, mo.size_bytes, mo.deleted_at
  FROM service_request_media srm JOIN media_objects mo ON mo.id = srm.media_id WHERE srm.service_request_id = ? ORDER BY srm.created_at ASC`).all(requestId) as Array<Record<string, unknown>>).map(item => ({
  id: String(item.id), mediaId: String(item.media_id), label: String(item.label), originalName: String(item.original_name), mimeType: String(item.mime_type), sizeBytes: Number(item.size_bytes), available: !item.deleted_at,
}))

const serializeServiceRequestForEmployee = (row: Record<string, unknown>) => ({
  id: Number(row.id), reference: String(row.reference), serviceKey: String(row.service_id), departmentId: String(row.department_id),
  serviceName: String(row.service_name), department: String(row.department_name), citizenName: String(row.citizen_name),
  status: String(row.status), formData: JSON.parse(String(row.form_data || '{}')), currentAction: String(row.current_action),
  decisionNote: row.decision_note ? String(row.decision_note) : null, requiredDocument: row.required_document ? String(row.required_document) : null,
  attachments: serviceRequestAttachments(Number(row.id)), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
})

app.get('/api/employee/service-requests', requireSession('EMPLOYEE', 'SUPER_ADMIN'), (_req, res) => {
  const rows = db.prepare(`SELECT sr.*, sc.name AS service_name, d.name AS department_name, c.full_name AS citizen_name
    FROM service_requests sr
    JOIN service_catalog sc ON sc.id = sr.service_id
    JOIN departments d ON d.id = sr.department_id
    JOIN citizens c ON c.id = sr.citizen_id
    ORDER BY CASE sr.status WHEN 'SUBMITTED' THEN 0 WHEN 'UNDER_REVIEW' THEN 1 WHEN 'ACTION_REQUIRED' THEN 2 ELSE 3 END, sr.updated_at DESC`).all() as Array<Record<string, unknown>>
  res.json(rows.map(serializeServiceRequestForEmployee))
})

app.patch('/api/employee/service-requests/:reference', requireSession('EMPLOYEE', 'SUPER_ADMIN'), (req, res) => {
  const row = db.prepare(`SELECT sr.*, sc.name AS service_name, d.name AS department_name, c.full_name AS citizen_name
    FROM service_requests sr JOIN service_catalog sc ON sc.id = sr.service_id JOIN departments d ON d.id = sr.department_id JOIN citizens c ON c.id = sr.citizen_id
    WHERE sr.reference = ?`).get(req.params.reference) as Record<string, unknown> | undefined
  if (!row) return res.status(404).json({ message: 'طلب الخدمة غير موجود.' })
  const parsed = z.object({
    status: z.enum(['UNDER_REVIEW', 'ACTION_REQUIRED', 'APPROVED', 'REJECTED']),
    currentAction: z.string().trim().min(6).max(500),
    decisionNote: z.string().trim().max(1500).optional(),
    requiredDocument: z.string().trim().max(160).optional(),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'تحقق من الحالة ووصف الإجراء قبل الحفظ.' })
  if (parsed.data.status === 'ACTION_REQUIRED' && !parsed.data.requiredDocument) return res.status(400).json({ message: 'اكتب اسم المستند أو النقص المطلوب من المواطن.' })
  if (parsed.data.status === 'REJECTED' && !parsed.data.decisionNote) return res.status(400).json({ message: 'اكتب سبب الرفض للمواطن قبل حفظ القرار.' })
  const timestamp = new Date().toISOString()
  db.prepare(`UPDATE service_requests SET status = ?, current_action = ?, decision_note = ?, required_document = ?, updated_at = ? WHERE reference = ?`)
    .run(parsed.data.status, parsed.data.currentAction, parsed.data.decisionNote || null, parsed.data.status === 'ACTION_REQUIRED' ? parsed.data.requiredDocument : null, timestamp, req.params.reference)
  const session = res.locals.session as SessionData
  const actor = session.role === 'SUPER_ADMIN' ? 'مدير النظام' : 'موظف مختص'
  const title = parsed.data.status === 'APPROVED' ? 'تمت معاملة الخدمة' : parsed.data.status === 'REJECTED' ? 'تم رفض طلب الخدمة' : parsed.data.status === 'ACTION_REQUIRED' ? 'مستندات أو معلومات مطلوبة' : 'طلب الخدمة قيد التدقيق'
  createNotification({ citizenId: Number(row.citizen_id), type: 'SERVICE_REQUEST_UPDATED', title, message: `${String(row.reference)} — ${parsed.data.currentAction}${parsed.data.decisionNote ? ` • ${parsed.data.decisionNote}` : ''}`, link: '/citizen#my-requests' })
  addAudit({ actor, role: session.role, action: 'SERVICE_REQUEST_STATUS_UPDATED', entityType: 'ServiceRequest', entityId: req.params.reference, previousValue: { status: row.status }, newValue: { status: parsed.data.status, requiredDocument: parsed.data.requiredDocument || null } })
  const updated = db.prepare(`SELECT sr.*, sc.name AS service_name, d.name AS department_name, c.full_name AS citizen_name
    FROM service_requests sr JOIN service_catalog sc ON sc.id = sr.service_id JOIN departments d ON d.id = sr.department_id JOIN citizens c ON c.id = sr.citizen_id
    WHERE sr.reference = ?`).get(req.params.reference) as Record<string, unknown>
  res.json(serializeServiceRequestForEmployee(updated))
})

app.post('/api/citizen/service-requests/:reference/upload-document', requireSession('CITIZEN'), upload.single('document'), (req, res) => {
  try {
    const citizen = currentCitizen(res)
    if (!citizen) return
    const requestRecord = db.prepare(`SELECT sr.*, sc.name AS service_name, d.name AS department_name, c.full_name AS citizen_name
      FROM service_requests sr JOIN service_catalog sc ON sc.id = sr.service_id JOIN departments d ON d.id = sr.department_id JOIN citizens c ON c.id = sr.citizen_id
      WHERE sr.reference = ? AND sr.citizen_id = ?`).get(req.params.reference, citizen.id) as Record<string, unknown> | undefined
    if (!requestRecord) return res.status(404).json({ message: 'طلب الخدمة غير موجود ضمن حسابك.' })
    if (requestRecord.status !== 'ACTION_REQUIRED') return res.status(409).json({ message: 'لا يوجد مستند مطلوب لرفعه حالياً ضمن هذا الطلب.' })
    if (!req.file) return res.status(400).json({ message: 'اختر صورة أو ملف PDF واضحاً قبل الرفع.' })
    const documentName = String(req.body.documentName || requestRecord.required_document || 'المستند المطلوب').trim().slice(0, 160)
    const mimeType = validateUploadedFile(req.file, ['image', 'pdf'])
    const media = storeEncryptedMedia({ citizenId: citizen.id, purpose: 'SERVICE_REQUEST_DOCUMENT', originalName: req.file.originalname || 'service-document', mimeType, buffer: req.file.buffer, retentionHours: 168 })
    db.prepare('INSERT INTO service_request_media (id, service_request_id, media_id, label, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(`srm_${randomUUID().replaceAll('-', '')}`, Number(requestRecord.id), media.id, documentName, new Date().toISOString())
    const timestamp = new Date().toISOString()
    const currentAction = 'تم رفع المستند المطلوب وإعادة الطلب إلى الموظف للتدقيق.'
    db.prepare(`UPDATE service_requests SET status = 'UNDER_REVIEW', current_action = ?, decision_note = NULL, required_document = NULL, updated_at = ? WHERE id = ?`)
      .run(currentAction, timestamp, Number(requestRecord.id))
    createNotification({ citizenId: citizen.id, type: 'SERVICE_DOCUMENT_UPLOADED', title: 'تم رفع المستند المطلوب', message: `${String(requestRecord.reference)} — ${currentAction}`, link: '/citizen#my-requests' })
    addAudit({ actor: citizen.fullName, role: 'CITIZEN', action: 'SERVICE_REQUEST_DOCUMENT_UPLOADED', entityType: 'ServiceRequest', entityId: String(requestRecord.reference), newValue: { label: documentName, mediaId: media.id } })
    const updated = db.prepare(`SELECT sr.*, sc.name AS service_name, d.name AS department_name, c.full_name AS citizen_name
      FROM service_requests sr JOIN service_catalog sc ON sc.id = sr.service_id JOIN departments d ON d.id = sr.department_id JOIN citizens c ON c.id = sr.citizen_id WHERE sr.id = ?`).get(Number(requestRecord.id)) as Record<string, unknown>
    res.json(serializeServiceRequestForEmployee(updated))
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'تعذر رفع المستند المطلوب.' })
  }
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
    const citizen = getOrCreateCitizen(result.accountKey, result.phoneMasked)
    setSession(res, String(citizen.id), 'CITIZEN')
    addAudit({
      actor: citizen.fullName,
      role: 'CITIZEN',
      action: 'PHONE_OTP_VERIFIED',
      entityType: 'PhoneVerification',
      entityId: payload.challengeId,
      metadata: { phoneMasked: result.phoneMasked, citizenId: citizen.id, provider: 'OTPIQ' },
    })
    res.json({ success: result.success, phoneMasked: result.phoneMasked, verifiedAt: result.verifiedAt })
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
  const citizen = currentCitizen(res)
  if (!citizen) return
  const timestamp = new Date().toISOString()
  db.prepare('UPDATE citizens SET full_name = ?, verification_status = ?, consent_at = ?, updated_at = ? WHERE id = ?')
    .run(payload.fullName, 'MANUAL_REVIEW', timestamp, timestamp, citizen.id)
  addAudit({ actor: payload.fullName, role: 'CITIZEN', action: 'IDENTITY_REVIEW_REQUESTED', entityType: 'CitizenIdentity', entityId: String(citizen.id), newValue: { status: 'MANUAL_REVIEW' }, metadata: { livenessClaimed: payload.livenessPassed, mediaPersisted: false } })
  res.json(getCitizenById(citizen.id))
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

    const citizen = currentCitizen(res)
    if (!citizen) return
    const citizenId = citizen.id
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
  const citizen = currentCitizen(res)
  if (!citizen) return
  const review = db.prepare(`
    SELECT id, status, national_id_masked, submitted_at, reviewed_at, review_notes, retention_until, quality_status, quality_score, quality_checks, face_match_status, face_match_score, face_match_provider
    FROM identity_reviews WHERE citizen_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(citizen.id)
  res.json(review || null)
})

app.get('/api/admin/identity-reviews', requireSession('EMPLOYEE', 'IDENTITY_REVIEWER', 'SUPER_ADMIN'), requireReviewAccess, (_req, res) => {
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

app.get('/api/admin/media/:id', requireSession('EMPLOYEE', 'IDENTITY_REVIEWER', 'SUPER_ADMIN'), requireReviewAccess, (req, res) => {
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

app.post('/api/admin/identity-reviews/:id/decision', requireSession('EMPLOYEE', 'IDENTITY_REVIEWER', 'SUPER_ADMIN'), requireReviewAccess, (req, res) => {
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

app.get('/api/applications', requireSession('EMPLOYEE', 'SUPER_ADMIN'), (_req, res) => res.json(getApplications()))

app.get('/api/applications/:reference', requireSession('CITIZEN', 'EMPLOYEE', 'SUPER_ADMIN'), (req, res) => {
  const item = getApplicationByReference(req.params.reference)
  if (!item) return res.status(404).json({ message: 'المعاملة غير موجودة.' })
  const session = res.locals.session as SessionData
  if (session.role === 'CITIZEN') {
    const citizen = currentCitizen(res)
    if (!citizen) return
    if (Number(item.citizenId) !== citizen.id) return res.status(404).json({ message: 'المعاملة غير موجودة.' })
    addAudit({ actor: citizen.fullName, role: 'CITIZEN', action: 'APPLICATION_VIEW', entityType: 'Application', entityId: req.params.reference, metadata: { maskedCitizenData: true } })
  } else {
    addAudit({ actor: session.sub, role: session.role, action: 'APPLICATION_VIEW', entityType: 'Application', entityId: req.params.reference, metadata: { maskedCitizenData: true } })
  }
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
  const citizen = currentCitizen(res)
  if (!citizen) return
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

app.post('/api/applications/:reference/request-document', requireSession('EMPLOYEE', 'SUPER_ADMIN'), (req, res) => {
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
  const citizen = currentCitizen(res)
  if (!citizen) return
  const item = getApplicationByReference(req.params.reference)
  if (!item || Number(item.citizenId) !== citizen.id) return res.status(404).json({ message: 'المعاملة غير موجودة.' })
  if (!req.file) return res.status(400).json({ message: `صوّر أو ارفع ${payload.documentName} قبل الإرسال.` })
  validateUploadedFile(req.file, ['image', 'pdf'])
  const timestamp = new Date().toISOString()
  const media = storeEncryptedMedia({ citizenId: citizen.id, purpose: 'APPLICATION_DOCUMENT', originalName: req.file.originalname || payload.documentName, mimeType: req.file.mimetype, buffer: req.file.buffer, retentionHours: 24 * 30 })
  db.prepare('INSERT INTO application_media (id, application_id, media_id, label, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(`appmedia_${randomUUID().replaceAll('-', '')}`, item.id, media.id, payload.documentName, timestamp)
  db.prepare(`UPDATE applications SET status = 'UNDER_REVIEW', current_action = 'لا يوجد إجراء مطلوب منك. تم استلام المستند وأعيدت المعاملة للموظف المختص.', required_document = NULL, updated_at = ? WHERE reference = ?`)
    .run(timestamp, req.params.reference)
  addEvent(item.id as number, { type: 'DOCUMENT_UPLOADED', title: 'تم استكمال المعلومات', description: `رفع المواطن ${payload.documentName} بشكل مشفر وأعيدت المعاملة إلى التدقيق.`, actor: 'المواطن' })
  createNotification({ citizenId: Number(item.citizenId), type: 'DOCUMENT_RECEIVED', title: 'تم استلام المستند', message: `استلمت المنصة ${payload.documentName} وأعادت المعاملة إلى الموظف المختص.`, link: `/citizen/application/${req.params.reference}` })
  addAudit({ actor: citizen.fullName, role: 'CITIZEN', action: 'MISSING_DOCUMENT_UPLOADED', entityType: 'Application', entityId: req.params.reference, previousValue: { status: item.status }, newValue: { status: 'UNDER_REVIEW', document: payload.documentName }, metadata: { protectedMediaId: media.id, retentionDays: 30 } })
  res.json(getApplicationByReference(req.params.reference))
})

app.post('/api/applications/:reference/approve', requireSession('EMPLOYEE', 'SUPER_ADMIN'), (req, res) => {
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
  type WorkloadRow = { departmentId: string; total: number; underReview: number; actionRequired: number; completed: number; rejected: number }
  const workload = new Map<string, WorkloadRow>()
  const register = (departmentId: string, status: string, count: number) => {
    const current = workload.get(departmentId) || { departmentId, total: 0, underReview: 0, actionRequired: 0, completed: 0, rejected: 0 }
    current.total += count
    if (status === 'UNDER_REVIEW') current.underReview += count
    if (status === 'ACTION_REQUIRED') current.actionRequired += count
    if (status === 'APPROVED') current.completed += count
    if (status === 'REJECTED') current.rejected += count
    workload.set(departmentId, current)
  }
  const registryByName = new Map(departmentRegistry.map(item => [item.name, item.id]))
  const serviceRows = db.prepare('SELECT department_id, status, COUNT(*) AS total FROM service_requests GROUP BY department_id, status').all() as Array<{ department_id: string; status: string; total: number }>
  serviceRows.forEach(row => register(String(row.department_id), String(row.status), Number(row.total)))
  const applicationRows = db.prepare('SELECT department, status, COUNT(*) AS total FROM applications GROUP BY department, status').all() as Array<{ department: string; status: string; total: number }>
  applicationRows.forEach(row => { const departmentId = registryByName.get(String(row.department)); if (departmentId) register(departmentId, String(row.status), Number(row.total)) })
  const feedbackRows = db.prepare(`SELECT department_id, COUNT(*) AS total FROM citizen_feedback
    WHERE department_id IS NOT NULL AND status NOT IN ('RESOLVED', 'CLOSED') GROUP BY department_id`).all() as Array<{ department_id: string; total: number }>
  const openFeedbackByDepartment = new Map(feedbackRows.map(row => [String(row.department_id), Number(row.total)]))
  const workforceRows = db.prepare(`SELECT s.* FROM department_workforce_snapshots s
    JOIN (SELECT department_id, MAX(observed_at) AS observed_at FROM department_workforce_snapshots GROUP BY department_id) latest
      ON latest.department_id = s.department_id AND latest.observed_at = s.observed_at`).all() as Array<Record<string, unknown>>
  const workforceByDepartment = new Map(workforceRows.map(row => [String(row.department_id), row]))
  const cameraCounts = db.prepare(`SELECT department_id, COUNT(*) AS configured, SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled
    FROM department_cameras GROUP BY department_id`).all() as Array<{ department_id: string; configured: number; enabled: number | null }>
  const cameraCountByDepartment = new Map(cameraCounts.map(row => [String(row.department_id), row]))
  const latestCameras = db.prepare(`SELECT c.* FROM department_cameras c
    JOIN (SELECT department_id, MAX(updated_at) AS updated_at FROM department_cameras GROUP BY department_id) latest
      ON latest.department_id = c.department_id AND latest.updated_at = c.updated_at`).all() as Array<Record<string, unknown>>
  const latestCameraByDepartment = new Map(latestCameras.map(row => [String(row.department_id), row]))
  return departmentRegistry.map(item => {
    const activity = workload.get(item.id) || { departmentId: item.id, total: 0, underReview: 0, actionRequired: 0, completed: 0, rejected: 0 }
    const workforce = workforceByDepartment.get(item.id)
    const cameraCount = cameraCountByDepartment.get(item.id)
    const latestCamera = latestCameraByDepartment.get(item.id)
    const cameraEnabled = Number(cameraCount?.enabled || 0)
    return {
      id: item.id,
      name: item.name,
      type: item.category,
      district: item.district,
      lat: item.lat,
      lng: item.lng,
      status: item.gisStatus === 'COORDINATES_VERIFIED' ? 'ONLINE' : 'UNKNOWN',
      transactions: activity.total,
      submitted: activity.total,
      underReview: activity.underReview,
      actionRequired: activity.actionRequired,
      completed: activity.completed,
      rejected: activity.rejected,
      openFeedback: openFeedbackByDepartment.get(item.id) || 0,
      workforce: workforce ? {
        totalEmployees: Number(workforce.total_employees), presentEmployees: Number(workforce.present_employees), absentEmployees: Number(workforce.absent_employees),
        dataStatus: 'RECORDED_BY_SUPER_ADMIN', sourceName: String(workforce.source_name), sourceUrl: workforce.source_url ? String(workforce.source_url) : null, observedAt: String(workforce.observed_at),
      } : {
        totalEmployees: null, presentEmployees: null, absentEmployees: null, dataStatus: 'AWAITING_AUTHORIZED_SOURCE', sourceName: null, sourceUrl: null, observedAt: null,
      },
      cameras: cameraCount ? {
        configured: Number(cameraCount.configured), enabled: cameraEnabled,
        status: cameraEnabled > 0 && latestCamera?.authorization_status === 'AUTHORIZED_GATEWAY' ? 'READY_FOR_GATEWAY' : 'CONFIGURED_DISABLED',
        sourceName: latestCamera?.source_name ? String(latestCamera.source_name) : null, lastCheckedAt: latestCamera?.last_checked_at ? String(latestCamera.last_checked_at) : null,
      } : {
        configured: 0, enabled: 0, status: 'AWAITING_AUTHORIZATION', sourceName: null, lastCheckedAt: null,
      },
      automation: 0,
      sourceUrl: item.sourceUrl,
      dataStatus: item.dataStatus,
      gisStatus: item.gisStatus,
    }
  })
}

app.get('/api/dashboard/stats', requireSession('EMPLOYEE', 'OPERATIONS', 'SUPER_ADMIN'), (_req, res) => {
  const departments = getRegistryDepartments()
  const dynamic = departments.reduce((total, department) => ({ total: total.total + department.transactions, completed: total.completed + department.completed }), { total: 0, completed: 0 })
  const citizenCount = db.prepare('SELECT COUNT(*) AS total FROM citizens').get() as { total: number }
  const payments = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS collected FROM payments WHERE status = 'SETTLED'`).get() as { collected: number }
  const dateRows = db.prepare(`SELECT day, COUNT(*) AS applications, SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS completed FROM (
    SELECT substr(created_at, 1, 10) AS day, status FROM applications
    UNION ALL
    SELECT substr(created_at, 1, 10) AS day, status FROM service_requests
  ) GROUP BY day`).all() as Array<{ day: string; applications: number; completed: number | null }>
  const byDay = new Map(dateRows.map(row => [row.day, row]))
  const series = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setUTCDate(date.getUTCDate() - (6 - index))
    const key = date.toISOString().slice(0, 10); const row = byDay.get(key)
    return { day: key.slice(5).split('-').reverse().join('/'), applications: row?.applications || 0, completed: row?.completed || 0 }
  })
  const complaints = departments.reduce((total, department) => total + department.openFeedback, 0)
  res.json({
    todayApplications: (byDay.get(new Date().toISOString().slice(0, 10))?.applications || 0),
    completed: dynamic.completed,
    overdue: 0,
    activeCitizens: citizenCount.total,
    activeEmployees: 0,
    departmentsOnline: registrySummary.verified,
    financialCollection: payments.collected,
    complaints,
    avgProcessingHours: 0,
    automationRate: 0,
    series,
    departments,
    registry: registrySummary,
  })
})

app.get('/api/operations/cameras', requireSession('EMPLOYEE', 'OPERATIONS', 'SUPER_ADMIN'), (_req, res) => {
  const rows = db.prepare(`SELECT id, department_id, label, stream_type, enabled, authorization_status, source_name, source_url, last_checked_at, created_at, updated_at
    FROM department_cameras ORDER BY department_id ASC, updated_at DESC`).all() as Array<Record<string, unknown>>
  res.json(rows.map(row => ({
    id: String(row.id), departmentId: String(row.department_id), label: String(row.label), streamType: String(row.stream_type), enabled: Boolean(row.enabled),
    authorizationStatus: String(row.authorization_status), sourceName: row.source_name ? String(row.source_name) : null, sourceUrl: row.source_url ? String(row.source_url) : null,
    lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  })))
})

app.post('/api/super-admin/operations/cameras', requireSession('SUPER_ADMIN'), sensitiveLimiter, (req, res) => {
  const payload = z.object({
    departmentId: z.string().min(3).max(120), label: z.string().min(3).max(160), streamType: z.enum(['HLS', 'WEBRTC']),
    gatewayUrl: z.string().url().max(2048).optional().refine(value => !value || new URL(value).protocol === 'https:', 'رابط بوابة الكاميرا يجب أن يستخدم HTTPS.'),
    enabled: z.boolean(), authorizationStatus: z.enum(['AWAITING_AUTHORIZATION', 'AUTHORIZED_GATEWAY']), sourceName: z.string().min(3).max(250).optional(), sourceUrl: z.string().url().max(2048).optional(), lastCheckedAt: z.string().datetime({ offset: true }).optional(),
  }).parse(req.body)
  const department = departmentRegistry.find(item => item.id === payload.departmentId)
  if (!department) return res.status(404).json({ message: 'الدائرة غير موجودة في السجل المعتمد.' })
  if (payload.enabled && (payload.authorizationStatus !== 'AUTHORIZED_GATEWAY' || !payload.gatewayUrl)) return res.status(400).json({ message: 'تفعيل الكاميرا يتطلب تفويضاً مسجلاً وبوابة HTTPS مصرحاً بها.' })
  ensureDepartmentRecord(department.name)
  const id = `cam_${randomUUID().replaceAll('-', '')}`
  const timestamp = new Date().toISOString()
  db.prepare(`INSERT INTO department_cameras (id, department_id, label, stream_type, gateway_url, enabled, authorization_status, source_name, source_url, last_checked_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, payload.departmentId, payload.label, payload.streamType, payload.gatewayUrl || null, payload.enabled ? 1 : 0, payload.authorizationStatus, payload.sourceName || null, payload.sourceUrl || null, payload.lastCheckedAt || null, timestamp, timestamp)
  addAudit({ actor: 'مدير النظام', role: 'SUPER_ADMIN', action: 'DEPARTMENT_CAMERA_CONFIGURED', entityType: 'DepartmentCamera', entityId: id, metadata: { departmentId: payload.departmentId, streamType: payload.streamType, enabled: payload.enabled, authorizationStatus: payload.authorizationStatus } })
  res.status(201).json({ id, departmentId: payload.departmentId, label: payload.label, configured: true })
})

app.post('/api/super-admin/operations/workforce-snapshots', requireSession('SUPER_ADMIN'), sensitiveLimiter, (req, res) => {
  const payload = z.object({
    departmentId: z.string().min(3).max(120), totalEmployees: z.number().int().min(0).max(100000), presentEmployees: z.number().int().min(0).max(100000), absentEmployees: z.number().int().min(0).max(100000),
    sourceName: z.string().min(3).max(250), sourceUrl: z.string().url().max(2048).optional(), observedAt: z.string().datetime({ offset: true }),
  }).parse(req.body)
  if (payload.presentEmployees + payload.absentEmployees > payload.totalEmployees) return res.status(400).json({ message: 'الحضور والغياب لا يمكن أن يتجاوزا عدد الموظفين الكلي.' })
  const department = departmentRegistry.find(item => item.id === payload.departmentId)
  if (!department) return res.status(404).json({ message: 'الدائرة غير موجودة في السجل المعتمد.' })
  ensureDepartmentRecord(department.name)
  const id = `wrk_${randomUUID().replaceAll('-', '')}`
  db.prepare(`INSERT INTO department_workforce_snapshots (id, department_id, total_employees, present_employees, absent_employees, source_name, source_url, authorization_status, observed_at, recorded_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'RECORDED_BY_SUPER_ADMIN', ?, 'مدير النظام', ?)`)
    .run(id, payload.departmentId, payload.totalEmployees, payload.presentEmployees, payload.absentEmployees, payload.sourceName, payload.sourceUrl || null, payload.observedAt, new Date().toISOString())
  addAudit({ actor: 'مدير النظام', role: 'SUPER_ADMIN', action: 'WORKFORCE_SNAPSHOT_RECORDED', entityType: 'DepartmentWorkforceSnapshot', entityId: id, metadata: { departmentId: payload.departmentId, observedAt: payload.observedAt, sourceName: payload.sourceName } })
  res.status(201).json({ id, departmentId: payload.departmentId, recorded: true })
})

app.get('/api/super-admin/government-services', requireSession('SUPER_ADMIN'), (req, res) => {
  const publicationStatus = typeof req.query.status === 'string' ? req.query.status as 'DRAFT' | 'APPROVED' | 'NEEDS_REVIEW' | 'DISABLED' : undefined
  res.json({ services: listGovernmentServices({ publicationStatus, limit: 500 }), stats: getGovernmentServiceDirectoryStats() })
})

app.get('/api/super-admin/government-services/:id', requireSession('SUPER_ADMIN'), (req, res) => {
  const service = getGovernmentService(req.params.id)
  if (!service) return res.status(404).json({ message: 'سجل الخدمة غير موجود.' })
  res.json({ service, versions: listGovernmentServiceVersions(service.id) })
})

app.post('/api/super-admin/government-services', requireSession('SUPER_ADMIN'), sensitiveLimiter, (req, res) => {
  const payload = z.object({
    canonicalServiceId: z.string().min(3).max(160), officialNameAr: z.string().min(3).max(500), category: z.string().min(2).max(200),
    verificationStatus: z.enum(['VERIFIED_UR_PORTAL', 'VERIFIED_MINISTRY', 'VERIFIED_GOVERNMENT_AUTHORITY', 'VERIFIED_MULTIPLE_OFFICIAL_SOURCES', 'PARTIALLY_VERIFIED', 'REQUIRES_MANUAL_VERIFICATION', 'OUTDATED_SOURCE', 'NEEDS_UPDATE']),
    publicationStatus: z.enum(['DRAFT', 'APPROVED', 'NEEDS_REVIEW', 'DISABLED']),
    sources: z.array(z.object({ sourceType: z.enum(['UR_PORTAL', 'MINISTRY', 'GOVERNMENT_AUTHORITY', 'GOVERNORATE', 'OFFICIAL_ENTITY']), authorityName: z.string().min(2).max(240), officialUrl: z.string().url().max(1000), pageTitle: z.string().max(500).optional(), dateAccessed: z.string().min(10).max(40), datePublished: z.string().max(40).optional(), lastVerifiedDate: z.string().max(40).optional(), verificationStatus: z.enum(['VERIFIED_UR_PORTAL', 'VERIFIED_MINISTRY', 'VERIFIED_GOVERNMENT_AUTHORITY', 'VERIFIED_MULTIPLE_OFFICIAL_SOURCES', 'PARTIALLY_VERIFIED', 'REQUIRES_MANUAL_VERIFICATION', 'OUTDATED_SOURCE', 'NEEDS_UPDATE']), sourceNote: z.string().max(4000).optional() })).min(1).max(20),
  }).passthrough().parse(req.body) as GovernmentServiceRecordInput
  if (payload.publicationStatus === 'APPROVED' && !payload.sources.length) return res.status(422).json({ message: 'لا يمكن نشر خدمة بلا مصدر حكومي رسمي.' })
  const service = upsertGovernmentService(payload, 'مدير النظام')
  res.status(201).json(service)
})

app.patch('/api/super-admin/government-services/:id/publication', requireSession('SUPER_ADMIN'), sensitiveLimiter, (req, res) => {
  const payload = z.object({ publicationStatus: z.enum(['DRAFT', 'APPROVED', 'NEEDS_REVIEW', 'DISABLED']), reason: z.string().max(1000).optional() }).parse(req.body)
  const service = setGovernmentServicePublication({ id: req.params.id, publicationStatus: payload.publicationStatus, reason: payload.reason, actor: 'مدير النظام' })
  if (!service) return res.status(404).json({ message: 'سجل الخدمة غير موجود.' })
  res.json(service)
})

app.get('/api/super-admin/overview', requireSession('SUPER_ADMIN'), (_req, res) => {
  const audit = db.prepare(`SELECT actor, role, action, entity_type, entity_id, created_at
    FROM audit_logs ORDER BY created_at DESC LIMIT 20`).all() as Array<Record<string, unknown>>
  const pendingIdentity = (db.prepare(`SELECT COUNT(*) AS total FROM identity_reviews WHERE status = 'PENDING_REVIEW'`).get() as { total: number }).total
  const openApplications = (db.prepare(`SELECT COUNT(*) AS total FROM applications WHERE status IN ('SUBMITTED', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'PAYMENT_REQUIRED')`).get() as { total: number }).total
  res.json({
    system: { pendingIdentity, openApplications, verifiedDepartments: registrySummary.verified, gisLocations: registrySummary.gisComplete },
    recentAudit: audit.map(row => ({ actor: row.actor, role: row.role, action: row.action, entityType: row.entity_type, entityId: row.entity_id, createdAt: row.created_at })),
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
