import type express from 'express'
import { param } from '../http/params.js'
import { z } from 'zod'
import { upload, validateUploadedFile } from '../http/upload.js'
import { type SessionData, requireSession, currentCitizen } from '../auth/session.js'
import { notifyCitizen } from '../realtime.js'
import {
  addAudit,
  createFeedback,
  attachFeedbackMedia,
  getFeedbackByReference,
  getFeedbackForAdmin,
  getFeedbackForCitizen,
  updateFeedbackStatus,
  db,
} from '../db.js'
import { readDecryptedMedia, storeEncryptedMedia } from '../media.js'
import { departmentRegistry } from '../department-registry.js'

export function registerFeedbackRoutes(app: express.Express) {
  app.get('/api/citizen/feedback', requireSession('CITIZEN'), (_req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    res.json(getFeedbackForCitizen(citizen.id))
  })

  app.get('/api/citizen/feedback/:reference', requireSession('CITIZEN'), (req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    const feedback = getFeedbackByReference(param(req, 'reference'))
    if (!feedback || feedback.citizenId !== citizen.id)
      return res.status(404).json({ message: 'الشكوى أو المقترح غير موجود ضمن حسابك.' })
    res.json(feedback)
  })

  app.post('/api/citizen/feedback', requireSession('CITIZEN'), upload.array('attachments', 3), (req, res) => {
    try {
      const citizen = currentCitizen(res)
      if (!citizen) return
      if (!['VERIFIED', 'VERIFIED_MANUAL'].includes(citizen.verificationStatus))
        return res.status(409).json({ message: 'أكمل مراجعة الهوية قبل إرسال شكوى أو مقترح.' })
      const asOptionalText = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
      const asOptionalNumber = (value: unknown) => {
        if (value === undefined || value === null || value === '') return undefined
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : value
      }
      const parsed = z
        .object({
          kind: z.enum(['COMPLAINT', 'SUGGESTION']),
          category: z.string().min(2).max(80),
          departmentId: z.preprocess(asOptionalText, z.string().min(2).max(100).optional()),
          subject: z.string().trim().min(6).max(160),
          description: z.string().trim().min(20).max(4000),
          district: z.preprocess(asOptionalText, z.string().min(2).max(80).optional()),
          lat: z.preprocess(asOptionalNumber, z.number().min(29).max(35).optional()),
          lng: z.preprocess(asOptionalNumber, z.number().min(42).max(50).optional()),
        })
        .parse(req.body)
      if ((parsed.lat === undefined) !== (parsed.lng === undefined))
        return res.status(400).json({ message: 'حدد موقعاً كاملاً أو اترك حقلي الموقع فارغين.' })
      if (parsed.departmentId && !departmentRegistry.some(item => item.id === parsed.departmentId))
        return res.status(400).json({ message: 'الدائرة المحددة غير موجودة في سجل المنصة.' })
      const feedback = createFeedback({ citizenId: citizen.id, ...parsed })
      const files = (req.files || []) as Express.Multer.File[]
      for (const [index, file] of files.entries()) {
        const mimeType = validateUploadedFile(file, ['image', 'pdf'])
        const media = storeEncryptedMedia({
          citizenId: citizen.id,
          purpose: 'FEEDBACK_ATTACHMENT',
          originalName: file.originalname || `feedback-${index + 1}`,
          mimeType,
          buffer: file.buffer,
          retentionHours: 168,
        })
        attachFeedbackMedia(feedback.id, media.id, `مرفق ${index + 1}`)
      }
      const result = getFeedbackByReference(feedback.reference)!
      notifyCitizen({
        citizenId: citizen.id,
        type: parsed.kind === 'COMPLAINT' ? 'COMPLAINT_CREATED' : 'SUGGESTION_CREATED',
        title: parsed.kind === 'COMPLAINT' ? 'تم استلام الشكوى' : 'تم استلام المقترح',
        message: `${result.reference} — ${result.currentAction}`,
        link: `/citizen/feedback/${result.reference}`,
      })
      addAudit({
        actor: citizen.fullName,
        role: 'CITIZEN',
        action: parsed.kind === 'COMPLAINT' ? 'COMPLAINT_CREATED' : 'SUGGESTION_CREATED',
        entityType: 'CitizenFeedback',
        entityId: result.reference,
        newValue: { category: parsed.category, departmentId: parsed.departmentId, attachmentCount: files.length },
        metadata: { hasLocation: parsed.lat !== undefined },
      })
      res.status(201).json(result)
    } catch (error) {
      const message =
        error instanceof z.ZodError
          ? 'تحقق من نوع الطلب والعنوان والوصف والموقع قبل الإرسال.'
          : error instanceof Error
            ? error.message
            : 'تعذر تسجيل الطلب.'
      res.status(400).json({ message })
    }
  })

  app.get('/api/citizen/feedback/:reference/media/:mediaId', requireSession('CITIZEN'), (req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    const linked = db
      .prepare(
        `SELECT 1 FROM feedback_media fm JOIN citizen_feedback cf ON cf.id = fm.feedback_id
      WHERE cf.reference = ? AND cf.citizen_id = ? AND fm.media_id = ?`
      )
      .get(param(req, 'reference'), citizen.id, param(req, 'mediaId'))
    if (!linked) return res.status(404).json({ message: 'المرفق غير موجود ضمن طلبك.' })
    const media = readDecryptedMedia(param(req, 'mediaId'))
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
    const feedback = getFeedbackByReference(param(req, 'reference'))
    if (!feedback) return res.status(404).json({ message: 'الطلب غير موجود.' })
    const parsed = z
      .object({
        status: z.enum(['IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
        currentAction: z.string().trim().min(6).max(500),
        adminNote: z.string().trim().max(1500).optional(),
      })
      .safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: 'تحقق من الحالة ووصف الإجراء قبل الحفظ.' })
    const session = res.locals.session as SessionData
    const actor = session.actor
    const updated = updateFeedbackStatus(feedback.id, { ...parsed.data, actor })
    notifyCitizen({
      citizenId: feedback.citizenId,
      type: 'FEEDBACK_UPDATED',
      title: feedback.kind === 'COMPLAINT' ? 'تحديث على الشكوى' : 'تحديث على المقترح',
      message: `${feedback.reference} — ${parsed.data.currentAction}`,
      link: `/citizen/feedback/${feedback.reference}`,
    })
    addAudit({
      actor,
      role: session.role,
      action: 'FEEDBACK_STATUS_UPDATED',
      entityType: 'CitizenFeedback',
      entityId: feedback.reference,
      previousValue: { status: feedback.status },
      newValue: { status: parsed.data.status },
    })
    res.json(updated)
  })
}
