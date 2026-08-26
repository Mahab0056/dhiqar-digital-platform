import express from 'express'
import cors from 'cors'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  addAudit,
  addEvent,
  db,
  ensureDemoCitizen,
  getApplicationByReference,
  getApplicationByVerificationId,
  getApplications,
  getCitizen,
  resetDemo,
} from './db.js'
import { createOtpChallenge, processOtpDeliveryWebhook, verifyOtpChallenge } from './otp.js'

const app = express()
const port = Number(process.env.PORT || 8787)
const currentDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(currentDir, '..')
const distDir = join(projectRoot, 'dist')

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(cors({ origin: true, credentials: false }))
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Dhi Qar Digital Demo API', time: new Date().toISOString() })
})

app.get('/api/citizen/demo', (_req, res) => {
  addAudit({ actor: 'مهاب علي ياسين', role: 'CITIZEN', action: 'PROFILE_VIEW', entityType: 'Citizen', entityId: 'demo-citizen', metadata: { masked: true } })
  res.json(getCitizen())
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
    const message = error instanceof Error ? error.message : 'تعذر إرسال رمز التحقق.'
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
    const message = error instanceof Error ? error.message : 'تعذر التحقق من الرمز.'
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

app.post('/api/onboarding/complete-identity', (req, res) => {
  const payload = z.object({ fullName: z.string().min(3), consent: z.literal(true), livenessPassed: z.boolean() }).parse(req.body)
  const citizenId = ensureDemoCitizen()
  const timestamp = new Date().toISOString()
  const result = payload.livenessPassed ? 'VERIFIED' : 'MANUAL_REVIEW'
  db.prepare('UPDATE citizens SET full_name = ?, verification_status = ?, consent_at = ?, updated_at = ? WHERE id = ?')
    .run(payload.fullName, result, timestamp, timestamp, citizenId)
  addAudit({ actor: payload.fullName, role: 'CITIZEN', action: 'IDENTITY_VERIFICATION_COMPLETED', entityType: 'CitizenIdentity', entityId: String(citizenId), newValue: { status: result }, metadata: { demo: true, biometricMediaPersisted: false } })
  res.json(getCitizen())
})

app.get('/api/applications', (_req, res) => res.json(getApplications()))

app.get('/api/applications/:reference', (req, res) => {
  const item = getApplicationByReference(req.params.reference)
  if (!item) return res.status(404).json({ message: 'المعاملة غير موجودة.' })
  addAudit({ actor: 'مستخدم مصرح', role: 'PORTAL_USER', action: 'APPLICATION_VIEW', entityType: 'Application', entityId: req.params.reference, metadata: { maskedCitizenData: true } })
  res.json(item)
})

app.post('/api/applications', (req, res) => {
  const payload = z.object({
    serviceKey: z.string().min(2),
    serviceName: z.string().min(2),
    department: z.string().min(2),
    businessName: z.string().min(2),
    activityType: z.string().min(2),
    address: z.string().min(4),
    district: z.string().min(2),
    ownershipType: z.enum(['rent', 'owned']),
    coordinates: z.object({ lat: z.number(), lng: z.number() }),
    fee: z.number().nonnegative(),
    attachments: z.array(z.string()).default([]),
  }).parse(req.body)
  const citizen = getCitizen() as { id: number; fullName: string }
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
  addEvent(applicationId, { type: 'APPLICATION_CREATED', title: 'تم التقديم', description: 'استلمت المنصة طلبك وحفظت البيانات والمرفقات التجريبية.', actor: 'المواطن' })
  addEvent(applicationId, { type: 'ROUTED', title: 'تم التوجيه إلى الدائرة', description: `تم توجيه الطلب آلياً إلى ${payload.department}.`, actor: 'محرك سير العمل' })
  addAudit({ actor: citizen.fullName, role: 'CITIZEN', action: 'APPLICATION_CREATED', entityType: 'Application', entityId: reference, newValue: { service: payload.serviceKey, district: payload.district }, metadata: { attachments: payload.attachments, demo: true } })
  res.status(201).json(getApplicationByReference(reference))
})

app.post('/api/applications/:reference/request-document', (req, res) => {
  const payload = z.object({ documentName: z.string().min(2) }).parse(req.body)
  const item = getApplicationByReference(req.params.reference)
  if (!item) return res.status(404).json({ message: 'المعاملة غير موجودة.' })
  const timestamp = new Date().toISOString()
  db.prepare(`UPDATE applications SET status = 'ACTION_REQUIRED', current_action = ?, required_document = ?, updated_at = ? WHERE reference = ?`)
    .run(`يرجى رفع ${payload.documentName} لإكمال التدقيق.`, payload.documentName, timestamp, req.params.reference)
  addEvent(item.id as number, { type: 'INFORMATION_REQUESTED', title: 'طلب معلومات إضافية', description: `طلب الموظف رفع ${payload.documentName}.`, actor: 'موظفة التدقيق — سارة كاظم' })
  addAudit({ actor: 'سارة كاظم حسن', role: 'EMPLOYEE', action: 'DOCUMENT_REQUESTED', entityType: 'Application', entityId: req.params.reference, previousValue: { status: item.status }, newValue: { status: 'ACTION_REQUIRED', document: payload.documentName } })
  res.json(getApplicationByReference(req.params.reference))
})

app.post('/api/applications/:reference/upload-document', (req, res) => {
  const payload = z.object({ documentName: z.string().min(2) }).parse(req.body)
  const item = getApplicationByReference(req.params.reference)
  if (!item) return res.status(404).json({ message: 'المعاملة غير موجودة.' })
  const timestamp = new Date().toISOString()
  db.prepare(`UPDATE applications SET status = 'UNDER_REVIEW', current_action = 'لا يوجد إجراء مطلوب منك. تم استلام المستند وأعيدت المعاملة للموظف المختص.', required_document = NULL, updated_at = ? WHERE reference = ?`)
    .run(timestamp, req.params.reference)
  addEvent(item.id as number, { type: 'DOCUMENT_UPLOADED', title: 'تم استكمال المعلومات', description: `رفع المواطن ${payload.documentName} وأعيدت المعاملة إلى التدقيق.`, actor: 'المواطن' })
  addAudit({ actor: item.citizenName as string, role: 'CITIZEN', action: 'MISSING_DOCUMENT_UPLOADED', entityType: 'Application', entityId: req.params.reference, previousValue: { status: item.status }, newValue: { status: 'UNDER_REVIEW', document: payload.documentName }, metadata: { malwareScan: 'PASSED_DEMO' } })
  res.json(getApplicationByReference(req.params.reference))
})

app.post('/api/applications/:reference/approve', (req, res) => {
  const item = getApplicationByReference(req.params.reference)
  if (!item) return res.status(404).json({ message: 'المعاملة غير موجودة.' })
  if (item.status === 'ACTION_REQUIRED') return res.status(409).json({ message: 'لا يمكن الموافقة قبل استكمال المستند المطلوب.' })
  if (item.status === 'APPROVED') return res.json(item)
  const timestamp = new Date().toISOString()
  const documentNumber = `LIC-${new Date().getFullYear()}-${String(item.id).padStart(5, '0')}`
  const verificationId = `TQD-${randomUUID().replaceAll('-', '').slice(0, 18).toUpperCase()}`
  db.exec('BEGIN')
  try {
    db.prepare(`UPDATE applications SET status = 'APPROVED', current_action = 'اكتملت المعاملة. يمكنك تحميل الوثيقة والتحقق منها عبر QR.', payment_status = ?, document_number = ?, verification_id = ?, updated_at = ? WHERE reference = ?`)
      .run((item.fee as number) > 0 ? 'PAID' : 'NOT_REQUIRED', documentNumber, verificationId, timestamp, req.params.reference)
    if ((item.fee as number) > 0) {
      db.prepare('INSERT INTO payments (application_id, amount, status, receipt_number, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(item.id, item.fee, 'PAID', `RCT-${String(item.id).padStart(6, '0')}`, timestamp)
    }
    addEvent(item.id as number, { type: 'APPROVED', title: 'تمت الموافقة', description: 'اعتمد الموظف المختص الطلب ضمن السيناريو التجريبي.', actor: 'موظفة التدقيق — سارة كاظم' })
    addEvent(item.id as number, { type: 'DOCUMENT_ISSUED', title: 'تم إصدار الوثيقة', description: `أُنشئت الوثيقة ${documentNumber} ومعرّف التحقق الرقمي.`, actor: 'نظام الوثائق الرقمية' })
    addAudit({ actor: 'سارة كاظم حسن', role: 'EMPLOYEE', action: 'APPLICATION_APPROVED', entityType: 'Application', entityId: req.params.reference, previousValue: { status: item.status }, newValue: { status: 'APPROVED', documentNumber }, metadata: { paymentRecorded: (item.fee as number) > 0, qrVerification: true } })
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

const departments = [
  { id: 1, name: 'ديوان محافظة ذي قار', type: 'حكومة محلية', district: 'الناصرية', lat: 31.0439, lng: 46.2573, status: 'ONLINE', transactions: 1240, automation: 92 },
  { id: 2, name: 'بلدية الناصرية', type: 'بلدية', district: 'الناصرية', lat: 31.0471, lng: 46.2621, status: 'ONLINE', transactions: 2860, automation: 86 },
  { id: 3, name: 'مديرية ماء ذي قار', type: 'خدمات', district: 'الناصرية', lat: 31.0398, lng: 46.2515, status: 'ONLINE', transactions: 1350, automation: 71 },
  { id: 4, name: 'بلدية الشطرة', type: 'بلدية', district: 'الشطرة', lat: 31.4091, lng: 46.1727, status: 'ONLINE', transactions: 875, automation: 68 },
  { id: 5, name: 'بلدية سوق الشيوخ', type: 'بلدية', district: 'سوق الشيوخ', lat: 30.8907, lng: 46.4549, status: 'DEGRADED', transactions: 634, automation: 59 },
  { id: 6, name: 'بلدية الرفاعي', type: 'بلدية', district: 'الرفاعي', lat: 31.7094, lng: 46.1053, status: 'ONLINE', transactions: 510, automation: 64 },
] as const

app.get('/api/dashboard/stats', (_req, res) => {
  const dynamic = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS completed FROM applications`).get() as { total: number; completed: number | null }
  const payments = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS collected FROM payments WHERE status = 'PAID'`).get() as { collected: number }
  res.json({
    todayApplications: 1247 + dynamic.total,
    completed: 986 + (dynamic.completed || 0),
    overdue: 42,
    activeCitizens: 128540,
    activeEmployees: 1842,
    departmentsOnline: 31,
    financialCollection: 128750000 + payments.collected,
    complaints: 264,
    avgProcessingHours: 31.4,
    automationRate: 78,
    series: [
      { day: 'السبت', applications: 820, completed: 690 },
      { day: 'الأحد', applications: 1140, completed: 915 },
      { day: 'الاثنين', applications: 1280, completed: 980 },
      { day: 'الثلاثاء', applications: 1050, completed: 940 },
      { day: 'الأربعاء', applications: 1380, completed: 1040 },
      { day: 'الخميس', applications: 1247 + dynamic.total, completed: 986 + (dynamic.completed || 0) },
    ],
    departments,
  })
})

app.post('/api/demo/reset', (_req, res) => {
  resetDemo()
  addAudit({ actor: 'Demo Operator', role: 'SUPER_ADMIN_DEMO', action: 'DEMO_RESET', entityType: 'System', entityId: 'demo', metadata: { syntheticOnly: true } })
  res.json({ success: true })
})

if (existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }))
  app.get('/{*path}', (_req, res) => res.sendFile(join(distDir, 'index.html')))
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) return res.status(400).json({ message: 'البيانات المدخلة غير مكتملة أو غير صحيحة.', details: error.issues })
  console.error(error)
  res.status(500).json({ message: 'حدث خطأ داخلي في النسخة التجريبية.' })
})

app.listen(port, '0.0.0.0', () => {
  console.log(`Dhi Qar Digital Demo API listening on http://0.0.0.0:${port}`)
})
