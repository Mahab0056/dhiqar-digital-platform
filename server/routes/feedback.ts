import type express from 'express'
import { safeMessage } from '../http/error-handler.js'
import { param } from '../http/params.js'
import { z } from 'zod'
import { upload, validateUploadedFile } from '../http/upload.js'
import { type SessionData, requireSession, currentCitizen } from '../auth/session.js'
import { employeeWorkQueueRealtime, notifyCitizen } from '../realtime.js'
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
import { departmentById, departmentRegistry } from '../department-registry.js'

/**
 * A complaint filed with «لا أعرف الدائرة» used to be stored without a department and was then invisible to every
 * department queue. It now lands at the governorate office (ديوان المحافظة) for triage, and staff re-route it.
 */
export const FEEDBACK_TRIAGE_DEPARTMENT_ID = 'dhiqar-governorate'

export function registerFeedbackRoutes(app: express.Express) {
  // older rows filed without a department go to the triage queue too (idempotent; departments are seeded first)
  if (departmentById.has(FEEDBACK_TRIAGE_DEPARTMENT_ID))
    db.prepare('UPDATE citizen_feedback SET department_id = ? WHERE department_id IS NULL').run(
      FEEDBACK_TRIAGE_DEPARTMENT_ID
    )

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
      const files = (req.files || []) as Express.Multer.File[]
      // validate every attachment before writing anything, so a bad file never leaves a half-saved complaint
      const mimeTypes = files.map(file => validateUploadedFile(file, ['image', 'pdf']))
      const feedback = createFeedback({
        citizenId: citizen.id,
        ...parsed,
        departmentId: parsed.departmentId || FEEDBACK_TRIAGE_DEPARTMENT_ID,
      })
      for (const [index, file] of files.entries()) {
        const mimeType = mimeTypes[index]
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
        newValue: { category: parsed.category, departmentId: result.departmentId, attachmentCount: files.length },
        metadata: { hasLocation: parsed.lat !== undefined, triage: !parsed.departmentId },
      })
      employeeWorkQueueRealtime.publish({
        entity: 'FEEDBACK',
        action: 'CREATED',
        reference: result.reference,
        departmentId: result.departmentId || null,
      })
      res.status(201).json(result)
    } catch (error) {
      const message =
        error instanceof z.ZodError
          ? 'تحقق من نوع الطلب والعنوان والوصف والموقع قبل الإرسال.'
          : safeMessage(error, 'تعذر تسجيل الطلب.')
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

  /** Department staff see only complaints routed to their department; super admin sees all. */
  const feedbackScope = (session: SessionData) =>
    session.role === 'SUPER_ADMIN' ? undefined : session.departmentId ? { departmentId: session.departmentId } : null

  app.get('/api/admin/feedback', requireSession('EMPLOYEE', 'SUPER_ADMIN'), (_req, res) => {
    const scope = feedbackScope(res.locals.session as SessionData)
    if (scope === null) return res.json([])
    res.json(getFeedbackForAdmin(scope))
  })

  app.patch('/api/admin/feedback/:reference', requireSession('EMPLOYEE', 'SUPER_ADMIN'), (req, res) => {
    const feedback = getFeedbackByReference(param(req, 'reference'))
    if (!feedback) return res.status(404).json({ message: 'الطلب غير موجود.' })
    const scope = feedbackScope(res.locals.session as SessionData)
    if (scope === null || (scope && feedback.departmentId !== scope.departmentId))
      return res.status(403).json({ message: 'هذه الشكوى تخص دائرة أخرى.' })
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
    employeeWorkQueueRealtime.publish({
      entity: 'FEEDBACK',
      action: 'UPDATED',
      reference: feedback.reference,
      departmentId: feedback.departmentId || null,
    })
    res.json(updated)
  })
  /** Re-route a complaint to another department (triage from the governorate office, or a wrong pick by the citizen). */
  app.patch('/api/admin/feedback/:reference/department', requireSession('EMPLOYEE', 'SUPER_ADMIN'), (req, res) => {
    const feedback = getFeedbackByReference(param(req, 'reference'))
    if (!feedback) return res.status(404).json({ message: 'الطلب غير موجود.' })
    const session = res.locals.session as SessionData
    const scope = feedbackScope(session)
    if (scope === null || (scope && feedback.departmentId !== scope.departmentId))
      return res.status(403).json({ message: 'هذه الشكوى تخص دائرة أخرى.' })
    const parsed = z
      .object({
        departmentId: z.string().trim().min(2).max(100),
        reason: z.string().trim().min(6).max(500),
      })
      .safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: 'اختر الدائرة واكتب سبب الإحالة قبل الحفظ.' })
    const target = departmentById.get(parsed.data.departmentId)
    if (!target) return res.status(400).json({ message: 'الدائرة المحددة غير موجودة في سجل المنصة.' })
    if (target.id === feedback.departmentId)
      return res.status(409).json({ message: 'الشكوى موجودة أصلاً لدى هذه الدائرة.' })
    if (['RESOLVED', 'CLOSED'].includes(feedback.status))
      return res.status(409).json({ message: 'لا يمكن إحالة طلب مغلق.' })
    const timestamp = new Date().toISOString()
    const currentAction = `أُحيل الطلب إلى ${target.name} للمتابعة.`
    db.exec('BEGIN')
    try {
      db.prepare('UPDATE citizen_feedback SET department_id = ?, current_action = ?, updated_at = ? WHERE id = ?').run(
        target.id,
        currentAction,
        timestamp,
        feedback.id
      )
      db.prepare(
        'INSERT INTO feedback_events (feedback_id, status, title, description, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        feedback.id,
        feedback.status,
        `إحالة إلى ${target.name}`,
        `${currentAction} السبب: ${parsed.data.reason}`,
        session.actor,
        timestamp
      )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'FEEDBACK_REROUTED',
      entityType: 'CitizenFeedback',
      entityId: feedback.reference,
      previousValue: { departmentId: feedback.departmentId },
      newValue: { departmentId: target.id },
      metadata: { reason: parsed.data.reason },
    })
    notifyCitizen({
      citizenId: feedback.citizenId,
      type: 'FEEDBACK_UPDATED',
      title: feedback.kind === 'COMPLAINT' ? 'إحالة الشكوى' : 'إحالة المقترح',
      message: `${feedback.reference} — ${currentAction}`,
      link: `/citizen/feedback/${feedback.reference}`,
    })
    for (const departmentId of [feedback.departmentId, target.id])
      employeeWorkQueueRealtime.publish({
        entity: 'FEEDBACK',
        action: 'TRANSFERRED',
        reference: feedback.reference,
        departmentId: departmentId || null,
      })
    res.json(getFeedbackByReference(feedback.reference))
  })
}
