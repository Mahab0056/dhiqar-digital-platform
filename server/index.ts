import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, timingSafeEqual } from 'node:crypto'
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
import { deleteEncryptedMedia, readDecryptedMedia, storeEncryptedMedia } from './media.js'
import { departmentRegistry, registrySummary } from './department-registry.js'

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

function hasReviewAccess(req: express.Request) {
  const expected = process.env.ADMIN_REVIEW_PASSWORD?.trim()
  const received = req.header('x-review-access-code')?.trim()
  if (!expected || !received) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(received)
  return left.length === right.length && timingSafeEqual(left, right)
}

function requireReviewAccess(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!hasReviewAccess(req)) return res.status(401).json({ message: 'رمز دخول المراجعة غير صحيح أو غير مهيأ.' })
  next()
}

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
  db.prepare('UPDATE citizens SET full_name = ?, verification_status = ?, consent_at = ?, updated_at = ? WHERE id = ?')
    .run(payload.fullName, 'MANUAL_REVIEW', timestamp, timestamp, citizenId)
  addAudit({ actor: payload.fullName, role: 'CITIZEN', action: 'IDENTITY_REVIEW_REQUESTED', entityType: 'CitizenIdentity', entityId: String(citizenId), newValue: { status: 'MANUAL_REVIEW' }, metadata: { livenessClaimed: payload.livenessPassed, mediaPersisted: false } })
  res.json(getCitizen())
})

app.post('/api/onboarding/identity-review', upload.fields([
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
    if (!idFront.mimetype.startsWith('image/') || !idBack.mimetype.startsWith('image/') || !faceVideo.mimetype.startsWith('video/')) {
      return res.status(400).json({ message: 'صيغة مرفقات الهوية أو الفيديو غير صحيحة.' })
    }

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
        face_video_media_id, consent_at, submitted_at, retention_until, created_at, updated_at
      ) VALUES (?, ?, 'PENDING_REVIEW', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(reviewId, citizenId, maskedNationalId, front.id, back.id, video.id, now.toISOString(), now.toISOString(), retentionUntil, now.toISOString(), now.toISOString())
    db.prepare('UPDATE citizens SET full_name = ?, national_id_masked = ?, verification_status = ?, consent_at = ?, updated_at = ? WHERE id = ?')
      .run(payload.fullName, maskedNationalId, 'MANUAL_REVIEW', now.toISOString(), now.toISOString(), citizenId)
    addAudit({
      actor: payload.fullName,
      role: 'CITIZEN',
      action: 'IDENTITY_MEDIA_SUBMITTED',
      entityType: 'IdentityReview',
      entityId: reviewId,
      newValue: { status: 'PENDING_REVIEW', media: [front.id, back.id, video.id] },
      metadata: { consent: true, retentionUntil, rawNationalIdStored: false },
    })
    res.status(201).json({
      id: reviewId,
      status: 'PENDING_REVIEW',
      retentionUntil,
      files: [front, back, video].map(file => ({ id: file.id, purpose: file.purpose, sizeBytes: file.sizeBytes })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'تعذر حفظ طلب مراجعة الهوية.'
    res.status(400).json({ message })
  }
})

app.get('/api/onboarding/identity-review/latest', (_req, res) => {
  const citizenId = ensureDemoCitizen()
  const review = db.prepare(`
    SELECT id, status, national_id_masked, submitted_at, reviewed_at, review_notes, retention_until
    FROM identity_reviews WHERE citizen_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(citizenId)
  res.json(review || null)
})

app.get('/api/admin/identity-reviews', requireReviewAccess, (_req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.status, r.national_id_masked, r.consent_at, r.submitted_at, r.reviewed_at, r.reviewed_by, r.review_notes, r.retention_until,
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
    media: [
      { id: row.front_id, label: 'وجه الهوية', mimeType: row.front_mime, sizeBytes: row.front_size },
      { id: row.back_id, label: 'ظهر الهوية', mimeType: row.back_mime, sizeBytes: row.back_size },
      { id: row.face_id, label: 'فيديو الوجه', mimeType: row.face_mime, sizeBytes: row.face_size },
    ].filter(item => typeof item.id === 'string'),
  })))
})

app.get('/api/admin/media/:id', requireReviewAccess, (req, res) => {
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

app.post('/api/admin/identity-reviews/:id/decision', requireReviewAccess, (req, res) => {
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

app.get('/api/applications', (_req, res) => res.json(getApplications()))

app.get('/api/applications/:reference', (req, res) => {
  const item = getApplicationByReference(req.params.reference)
  if (!item) return res.status(404).json({ message: 'المعاملة غير موجودة.' })
  addAudit({ actor: 'مستخدم مصرح', role: 'PORTAL_USER', action: 'APPLICATION_VIEW', entityType: 'Application', entityId: req.params.reference, metadata: { maskedCitizenData: true } })
  res.json(item)
})

app.post('/api/applications', upload.fields([{ name: 'propertyDocument', maxCount: 1 }, { name: 'storefrontPhoto', maxCount: 1 }]), (req, res) => {
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
  const files = req.files as Record<string, Express.Multer.File[]> | undefined
  const propertyDocument = files?.propertyDocument?.[0]
  const storefrontPhoto = files?.storefrontPhoto?.[0]
  const requiredPropertyDocument = payload.ownershipType === 'rent' ? 'عقد الإيجار' : 'سند الملكية'
  if (payload.serviceKey === 'store-license' && (!propertyDocument || !storefrontPhoto)) {
    db.prepare('DELETE FROM applications WHERE id = ?').run(applicationId)
    return res.status(400).json({ message: `يرجى تصوير أو رفع ${requiredPropertyDocument} وصورة واجهة المحل قبل إرسال الطلب.` })
  }
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
  addAudit({ actor: citizen.fullName, role: 'CITIZEN', action: 'APPLICATION_CREATED', entityType: 'Application', entityId: reference, newValue: { service: payload.serviceKey, district: payload.district }, metadata: { protectedAttachments: protectedFiles.map(file => file.label), retentionDays: 30 } })
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

app.post('/api/applications/:reference/upload-document', upload.single('document'), (req, res) => {
  const payload = z.object({ documentName: z.string().min(2) }).parse(req.body)
  const item = getApplicationByReference(req.params.reference)
  if (!item) return res.status(404).json({ message: 'المعاملة غير موجودة.' })
  if (!req.file) return res.status(400).json({ message: `صوّر أو ارفع ${payload.documentName} قبل الإرسال.` })
  const timestamp = new Date().toISOString()
  const media = storeEncryptedMedia({ citizenId: Number(item.citizenId), purpose: 'APPLICATION_DOCUMENT', originalName: req.file.originalname || payload.documentName, mimeType: req.file.mimetype, buffer: req.file.buffer, retentionHours: 24 * 30 })
  db.prepare('INSERT INTO application_media (id, application_id, media_id, label, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(`appmedia_${randomUUID().replaceAll('-', '')}`, item.id, media.id, payload.documentName, timestamp)
  db.prepare(`UPDATE applications SET status = 'UNDER_REVIEW', current_action = 'لا يوجد إجراء مطلوب منك. تم استلام المستند وأعيدت المعاملة للموظف المختص.', required_document = NULL, updated_at = ? WHERE reference = ?`)
    .run(timestamp, req.params.reference)
  addEvent(item.id as number, { type: 'DOCUMENT_UPLOADED', title: 'تم استكمال المعلومات', description: `رفع المواطن ${payload.documentName} بشكل مشفر وأعيدت المعاملة إلى التدقيق.`, actor: 'المواطن' })
  addAudit({ actor: item.citizenName as string, role: 'CITIZEN', action: 'MISSING_DOCUMENT_UPLOADED', entityType: 'Application', entityId: req.params.reference, previousValue: { status: item.status }, newValue: { status: 'UNDER_REVIEW', document: payload.documentName }, metadata: { protectedMediaId: media.id, retentionDays: 30 } })
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
  const payments = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS collected FROM payments WHERE status = 'PAID'`).get() as { collected: number }
  res.json({
    todayApplications: 1247 + dynamic.total,
    completed: 986 + (dynamic.completed || 0),
    overdue: 42,
    activeCitizens: 128540,
    activeEmployees: 1842,
    departmentsOnline: registrySummary.verified,
    financialCollection: payments.collected,
    complaints: 0,
    avgProcessingHours: 0,
    automationRate: 0,
    series: [
      { day: 'السبت', applications: 820, completed: 690 },
      { day: 'الأحد', applications: 1140, completed: 915 },
      { day: 'الاثنين', applications: 1280, completed: 980 },
      { day: 'الثلاثاء', applications: 1050, completed: 940 },
      { day: 'الأربعاء', applications: 1380, completed: 1040 },
      { day: 'الخميس', applications: 1247 + dynamic.total, completed: 986 + (dynamic.completed || 0) },
    ],
    departments: getRegistryDepartments(),
    registry: registrySummary,
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
