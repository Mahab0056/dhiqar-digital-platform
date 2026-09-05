import type express from 'express'
import { param } from '../http/params.js'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { upload, validateUploadedFile } from '../http/upload.js'
import { type SessionData, requireSession, currentCitizen } from '../auth/session.js'
import { ensureDepartmentRecord } from '../seed.js'
import { notifyCitizen, employeeWorkQueueRealtime } from '../realtime.js'
import { addAudit, db } from '../db.js'
import { storeEncryptedMedia } from '../media.js'
import { createIssuedDocument } from '../issued-documents.js'
import { getServiceDefinition } from '../../src/service-forms.js'

const serviceRequestDocumentDetails = (row: Record<string, unknown>) => {
  const fieldLabels = new Map(
    (getServiceDefinition(String(row.service_id))?.fields || []).map(field => [field.key, field.label])
  )
  const sensitiveKeys = /phone|mobile|email|national|identity|passport|license|licence|address|location|lat|lng/i
  return Object.entries(JSON.parse(String(row.form_data || '{}')) as Record<string, unknown>)
    .filter(([key, value]) => !sensitiveKeys.test(key) && String(value || '').trim().length > 0)
    .slice(0, 4)
    .map(([key, value]) => ({ label: fieldLabels.get(key) || key, value: String(value) }))
}

const serviceRequestAttachments = (requestId: number) =>
  (
    db
      .prepare(
        `SELECT srm.id, srm.media_id, srm.label, mo.original_name, mo.mime_type, mo.size_bytes, mo.deleted_at
  FROM service_request_media srm JOIN media_objects mo ON mo.id = srm.media_id WHERE srm.service_request_id = ? ORDER BY srm.created_at ASC`
      )
      .all(requestId) as Array<Record<string, unknown>>
  ).map(item => ({
    id: String(item.id),
    mediaId: String(item.media_id),
    label: String(item.label),
    originalName: String(item.original_name),
    mimeType: String(item.mime_type),
    sizeBytes: Number(item.size_bytes),
    available: !item.deleted_at,
  }))

const serializeServiceRequestForEmployee = (row: Record<string, unknown>) => ({
  id: Number(row.id),
  reference: String(row.reference),
  serviceKey: String(row.service_id),
  departmentId: String(row.department_id),
  serviceName: String(row.service_name),
  department: String(row.department_name),
  citizenName: String(row.citizen_name),
  status: String(row.status),
  formData: JSON.parse(String(row.form_data || '{}')),
  currentAction: String(row.current_action),
  decisionNote: row.decision_note ? String(row.decision_note) : null,
  requiredDocument: row.required_document ? String(row.required_document) : null,
  attachments: serviceRequestAttachments(Number(row.id)),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
})

export function registerServiceRequestsRoutes(app: express.Express) {
  app.get('/api/citizen/service-requests', requireSession('CITIZEN'), (_req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    const rows = db
      .prepare(
        `SELECT sr.*, a.id AS appointment_id, a.preferred_date, a.preferred_time, a.status AS appointment_status, a.confirmation_note
      FROM service_requests sr LEFT JOIN appointments a ON a.service_request_id = sr.id
      WHERE sr.citizen_id = ? ORDER BY sr.created_at DESC`
      )
      .all(citizen.id) as Array<Record<string, unknown>>
    res.json(
      rows.map(row => ({
        id: row.id,
        reference: row.reference,
        serviceKey: row.service_id,
        departmentId: row.department_id,
        status: row.status,
        formData: JSON.parse(String(row.form_data || '{}')),
        currentAction: row.current_action,
        decisionNote: row.decision_note || null,
        requiredDocument: row.required_document || null,
        attachments: serviceRequestAttachments(Number(row.id)),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        appointment: row.appointment_id
          ? {
              id: row.appointment_id,
              preferredDate: row.preferred_date,
              preferredTime: row.preferred_time,
              status: row.appointment_status,
              note: row.confirmation_note,
            }
          : null,
      }))
    )
  })

  app.post('/api/service-requests', requireSession('CITIZEN'), upload.single('faceVideo'), (req, res) => {
    const rawData =
      typeof req.body.data === 'string'
        ? (() => {
            try {
              return JSON.parse(req.body.data)
            } catch {
              return req.body.data
            }
          })()
        : req.body.data
    const payload = z
      .object({
        serviceKey: z.string().min(2).max(80),
        data: z.record(z.string(), z.unknown()),
        faceConsent: z.literal('true'),
      })
      .parse({ ...req.body, data: rawData })
    const definition = getServiceDefinition(payload.serviceKey)
    if (!definition || !['GENERIC', 'APPOINTMENT'].includes(definition.mode))
      return res.status(404).json({ message: 'هذه الخدمة لا تُنشأ عبر استمارة محلية داخل المنصة.' })
    const catalogStatus = db.prepare('SELECT active FROM service_catalog WHERE id = ?').get(definition.key) as
      { active: number } | undefined
    if (catalogStatus && !catalogStatus.active)
      return res
        .status(409)
        .json({ message: 'أوقفت الدائرة استقبال الطلبات لهذه الخدمة مؤقتاً. راجع الدائرة المختصة أو حاول لاحقاً.' })
    const citizen = currentCitizen(res)
    if (!citizen) return
    if (!['VERIFIED', 'VERIFIED_MANUAL'].includes(citizen.verificationStatus))
      return res.status(409).json({ message: 'أكمل مراجعة الهوية قبل إرسال طلب جديد.' })
    const faceVideo = req.file
    if (!faceVideo) return res.status(400).json({ message: 'صوّر فيديو توثيق الوجه القصير قبل إرسال الطلب.' })
    validateUploadedFile(faceVideo, ['video'])

    const cleanData: Record<string, string> = {}
    for (const field of definition.fields) {
      const value = String(payload.data[field.key] ?? '').trim()
      if (field.required && !value) return res.status(400).json({ message: `الحقل «${field.label}» مطلوب.` })
      if (field.maxLength && value.length > field.maxLength)
        return res.status(400).json({ message: `الحقل «${field.label}» أطول من الحد المسموح.` })
      if (value && field.options && !field.options.includes(value))
        return res.status(400).json({ message: `القيمة المختارة في «${field.label}» غير مسموحة.` })
      if (value) cleanData[field.key] = value
    }
    if (JSON.stringify(cleanData).length > 20000)
      return res.status(413).json({ message: 'حجم بيانات الاستمارة أكبر من المسموح.' })

    let departmentName = definition.department
    if (definition.key === 'online-appointment') departmentName = cleanData.department
    if (definition.key === 'water-complaint' && cleanData.problemType?.includes('مجار'))
      departmentName = 'مديرية مجاري ذي قار'
    const department = ensureDepartmentRecord(departmentName)
    if (!department) return res.status(409).json({ message: 'الدائرة المختارة غير موجودة في سجل الجهات المتحقق.' })

    if (definition.mode === 'APPOINTMENT') {
      const preferredDate = cleanData.preferredDate
      const preferredTime = cleanData.preferredTime
      const date = new Date(`${preferredDate}T00:00:00Z`)
      const today = new Date()
      today.setUTCHours(0, 0, 0, 0)
      const max = new Date(today)
      max.setUTCDate(max.getUTCDate() + 90)
      if (Number.isNaN(date.getTime()) || date < today || date > max)
        return res.status(400).json({ message: 'اختر تاريخاً من اليوم وحتى 90 يوماً.' })
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(preferredTime))
        return res.status(400).json({ message: 'صيغة وقت الموعد غير صحيحة.' })
    }

    const timestamp = new Date().toISOString()
    db.prepare(
      `INSERT INTO service_catalog (id, department_id, name, category, description, fee_iqd, fee_status, estimated_duration, form_schema, required_documents, payment_mode, active, source_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DISABLED', 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET department_id = excluded.department_id, name = excluded.name, category = excluded.category, description = excluded.description, form_schema = excluded.form_schema, updated_at = excluded.updated_at`
    ).run(
      definition.key,
      department.id,
      definition.title,
      definition.category,
      definition.description,
      definition.fee,
      definition.fee > 0 ? 'UNVERIFIED' : 'NOT_REQUIRED',
      definition.estimatedTime,
      JSON.stringify(definition.fields),
      JSON.stringify(definition.requirements),
      department.sourceUrl,
      timestamp,
      timestamp
    )
    const serial = String(
      (db.prepare('SELECT COUNT(*) AS count FROM service_requests').get() as { count: number }).count + 1
    ).padStart(5, '0')
    const reference = `TQS-${new Date().getFullYear()}-${serial}`
    const currentAction =
      definition.mode === 'APPOINTMENT'
        ? 'أُرسل طلب الموعد إلى الدائرة وبانتظار التأكيد.'
        : 'أُرسل الطلب إلى الدائرة المختصة للتدقيق.'
    const result = db
      .prepare(
        `INSERT INTO service_requests (reference, citizen_id, service_id, department_id, status, form_data, current_action, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        reference,
        citizen.id,
        definition.key,
        department.id,
        definition.mode === 'APPOINTMENT' ? 'APPOINTMENT_REQUESTED' : 'SUBMITTED',
        JSON.stringify(cleanData),
        currentAction,
        timestamp,
        timestamp
      )
    const serviceRequestId = Number(result.lastInsertRowid)
    const faceMedia = storeEncryptedMedia({
      citizenId: citizen.id,
      purpose: 'FACE_VIDEO',
      originalName: faceVideo.originalname || 'service-face-video',
      mimeType: faceVideo.mimetype,
      buffer: faceVideo.buffer,
      retentionHours: 24 * 30,
    })
    db.prepare(
      'INSERT INTO service_request_media (id, service_request_id, media_id, label, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      `srm_${randomUUID().replaceAll('-', '')}`,
      serviceRequestId,
      faceMedia.id,
      'فيديو توثيق الوجه قبل الإرسال',
      timestamp
    )
    let appointment = null
    if (definition.mode === 'APPOINTMENT') {
      const appointmentId = `apt_${randomUUID().replaceAll('-', '')}`
      db.prepare(
        `INSERT INTO appointments (id, reference, citizen_id, service_request_id, department, purpose, preferred_date, preferred_time, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?)`
      ).run(
        appointmentId,
        `APT-${reference.slice(4)}`,
        citizen.id,
        serviceRequestId,
        department.name,
        cleanData.purpose,
        cleanData.preferredDate,
        cleanData.preferredTime,
        timestamp,
        timestamp
      )
      appointment = {
        id: appointmentId,
        preferredDate: cleanData.preferredDate,
        preferredTime: cleanData.preferredTime,
        status: 'REQUESTED',
      }
    }
    notifyCitizen({
      citizenId: citizen.id,
      type: definition.mode === 'APPOINTMENT' ? 'APPOINTMENT_REQUESTED' : 'SERVICE_REQUEST_CREATED',
      title: definition.mode === 'APPOINTMENT' ? 'تم إرسال طلب الموعد' : 'تم تسجيل طلب الخدمة',
      message: `${definition.title} — ${reference}. ${currentAction}`,
      link: '/citizen',
    })
    employeeWorkQueueRealtime.publish({ entity: 'SERVICE_REQUEST', action: 'CREATED', reference })
    addAudit({
      actor: citizen.fullName,
      role: 'CITIZEN',
      action: definition.mode === 'APPOINTMENT' ? 'APPOINTMENT_REQUESTED' : 'SERVICE_REQUEST_CREATED',
      entityType: 'ServiceRequest',
      entityId: reference,
      newValue: { service: definition.key, department: department.id },
      metadata: { storedFields: Object.keys(cleanData), protectedFaceVideoId: faceMedia.id, faceConsent: true },
    })
    res.status(201).json({
      id: serviceRequestId,
      reference,
      serviceKey: definition.key,
      serviceName: definition.title,
      department: department.name,
      status: definition.mode === 'APPOINTMENT' ? 'APPOINTMENT_REQUESTED' : 'SUBMITTED',
      currentAction,
      appointment,
      createdAt: timestamp,
    })
  })

  app.get('/api/employee/service-requests', requireSession('EMPLOYEE', 'SUPER_ADMIN'), (_req, res) => {
    const rows = db
      .prepare(
        `SELECT sr.*, sc.name AS service_name, d.name AS department_name, c.full_name AS citizen_name
      FROM service_requests sr
      JOIN service_catalog sc ON sc.id = sr.service_id
      JOIN departments d ON d.id = sr.department_id
      JOIN citizens c ON c.id = sr.citizen_id
      ORDER BY CASE sr.status WHEN 'SUBMITTED' THEN 0 WHEN 'UNDER_REVIEW' THEN 1 WHEN 'ACTION_REQUIRED' THEN 2 ELSE 3 END, sr.updated_at DESC`
      )
      .all() as Array<Record<string, unknown>>
    res.json(rows.map(serializeServiceRequestForEmployee))
  })

  app.patch(
    '/api/employee/service-requests/:reference',
    requireSession('EMPLOYEE', 'SUPER_ADMIN'),
    async (req, res) => {
      const row = db
        .prepare(
          `SELECT sr.*, sc.name AS service_name, d.name AS department_name, c.full_name AS citizen_name
      FROM service_requests sr JOIN service_catalog sc ON sc.id = sr.service_id JOIN departments d ON d.id = sr.department_id JOIN citizens c ON c.id = sr.citizen_id
      WHERE sr.reference = ?`
        )
        .get(param(req, 'reference')) as Record<string, unknown> | undefined
      if (!row) return res.status(404).json({ message: 'طلب الخدمة غير موجود.' })
      const parsed = z
        .object({
          status: z.enum(['UNDER_REVIEW', 'ACTION_REQUIRED', 'APPROVED', 'REJECTED']),
          currentAction: z.string().trim().min(6).max(500),
          decisionNote: z.string().trim().max(1500).optional(),
          requiredDocument: z.string().trim().max(160).optional(),
        })
        .safeParse(req.body)
      if (!parsed.success) return res.status(400).json({ message: 'تحقق من الحالة ووصف الإجراء قبل الحفظ.' })
      if (parsed.data.status === 'ACTION_REQUIRED' && !parsed.data.requiredDocument)
        return res.status(400).json({ message: 'اكتب اسم المستند أو النقص المطلوب من المواطن.' })
      if (parsed.data.status === 'REJECTED' && !parsed.data.decisionNote)
        return res.status(400).json({ message: 'اكتب سبب الرفض للمواطن قبل حفظ القرار.' })
      const timestamp = new Date().toISOString()
      const session = res.locals.session as SessionData
      const actor = session.actor
      let issuedDocument: Awaited<ReturnType<typeof createIssuedDocument>> | null = null
      if (parsed.data.status === 'APPROVED') {
        issuedDocument = await createIssuedDocument({
          sourceKind: 'SERVICE_REQUEST',
          serviceRequestReference: String(row.reference),
          citizenId: Number(row.citizen_id),
          citizenName: String(row.citizen_name),
          serviceName: String(row.service_name),
          departmentName: String(row.department_name),
          documentTitle: `وثيقة إتمام معاملة — ${String(row.service_name)}`,
          issuedBy: actor,
          issuedAt: timestamp,
          details: serviceRequestDocumentDetails(row),
        })
      }
      const approvedAction = issuedDocument
        ? `${parsed.data.currentAction} صدرت الوثيقة الرقمية ${issuedDocument.documentNumber} وهي محفوظة في الأرشيف.`
        : parsed.data.currentAction
      db.prepare(
        `UPDATE service_requests SET status = ?, current_action = ?, decision_note = ?, required_document = ?, updated_at = ? WHERE reference = ?`
      ).run(
        parsed.data.status,
        approvedAction,
        parsed.data.decisionNote || null,
        parsed.data.status === 'ACTION_REQUIRED' ? (parsed.data.requiredDocument ?? null) : null,
        timestamp,
        param(req, 'reference')
      )
      const title =
        parsed.data.status === 'APPROVED'
          ? 'تمت معاملة الخدمة وصدر PDF'
          : parsed.data.status === 'REJECTED'
            ? 'تم رفض طلب الخدمة'
            : parsed.data.status === 'ACTION_REQUIRED'
              ? 'مستندات أو معلومات مطلوبة'
              : 'طلب الخدمة قيد التدقيق'
      notifyCitizen({
        citizenId: Number(row.citizen_id),
        type: 'SERVICE_REQUEST_UPDATED',
        title,
        message: `${String(row.reference)} — ${approvedAction}${parsed.data.decisionNote ? ` • ${parsed.data.decisionNote}` : ''}`,
        link: '/citizen#issued-documents',
      })
      addAudit({
        actor,
        role: session.role,
        action: issuedDocument ? 'SERVICE_REQUEST_APPROVED_DOCUMENT_ISSUED' : 'SERVICE_REQUEST_STATUS_UPDATED',
        entityType: 'ServiceRequest',
        entityId: param(req, 'reference'),
        previousValue: { status: row.status },
        newValue: {
          status: parsed.data.status,
          requiredDocument: parsed.data.requiredDocument || null,
          documentNumber: issuedDocument?.documentNumber || null,
          verificationId: issuedDocument?.verificationId || null,
        },
      })
      const updated = db
        .prepare(
          `SELECT sr.*, sc.name AS service_name, d.name AS department_name, c.full_name AS citizen_name
      FROM service_requests sr JOIN service_catalog sc ON sc.id = sr.service_id JOIN departments d ON d.id = sr.department_id JOIN citizens c ON c.id = sr.citizen_id
      WHERE sr.reference = ?`
        )
        .get(param(req, 'reference')) as Record<string, unknown>
      res.json(serializeServiceRequestForEmployee(updated))
    }
  )

  app.post(
    '/api/citizen/service-requests/:reference/upload-document',
    requireSession('CITIZEN'),
    upload.single('document'),
    (req, res) => {
      try {
        const citizen = currentCitizen(res)
        if (!citizen) return
        const requestRecord = db
          .prepare(
            `SELECT sr.*, sc.name AS service_name, d.name AS department_name, c.full_name AS citizen_name
        FROM service_requests sr JOIN service_catalog sc ON sc.id = sr.service_id JOIN departments d ON d.id = sr.department_id JOIN citizens c ON c.id = sr.citizen_id
        WHERE sr.reference = ? AND sr.citizen_id = ?`
          )
          .get(param(req, 'reference'), citizen.id) as Record<string, unknown> | undefined
        if (!requestRecord) return res.status(404).json({ message: 'طلب الخدمة غير موجود ضمن حسابك.' })
        if (requestRecord.status !== 'ACTION_REQUIRED')
          return res.status(409).json({ message: 'لا يوجد مستند مطلوب لرفعه حالياً ضمن هذا الطلب.' })
        if (!req.file) return res.status(400).json({ message: 'اختر صورة أو ملف PDF واضحاً قبل الرفع.' })
        const documentName = String(req.body.documentName || requestRecord.required_document || 'المستند المطلوب')
          .trim()
          .slice(0, 160)
        const mimeType = validateUploadedFile(req.file, ['image', 'pdf'])
        const media = storeEncryptedMedia({
          citizenId: citizen.id,
          purpose: 'SERVICE_REQUEST_DOCUMENT',
          originalName: req.file.originalname || 'service-document',
          mimeType,
          buffer: req.file.buffer,
          retentionHours: 168,
        })
        db.prepare(
          'INSERT INTO service_request_media (id, service_request_id, media_id, label, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(
          `srm_${randomUUID().replaceAll('-', '')}`,
          Number(requestRecord.id),
          media.id,
          documentName,
          new Date().toISOString()
        )
        const timestamp = new Date().toISOString()
        const currentAction = 'تم رفع المستند المطلوب وإعادة الطلب إلى الموظف للتدقيق.'
        db.prepare(
          `UPDATE service_requests SET status = 'UNDER_REVIEW', current_action = ?, decision_note = NULL, required_document = NULL, updated_at = ? WHERE id = ?`
        ).run(currentAction, timestamp, Number(requestRecord.id))
        notifyCitizen({
          citizenId: citizen.id,
          type: 'SERVICE_DOCUMENT_UPLOADED',
          title: 'تم رفع المستند المطلوب',
          message: `${String(requestRecord.reference)} — ${currentAction}`,
          link: '/citizen#my-requests',
        })
        addAudit({
          actor: citizen.fullName,
          role: 'CITIZEN',
          action: 'SERVICE_REQUEST_DOCUMENT_UPLOADED',
          entityType: 'ServiceRequest',
          entityId: String(requestRecord.reference),
          newValue: { label: documentName, mediaId: media.id },
        })
        const updated = db
          .prepare(
            `SELECT sr.*, sc.name AS service_name, d.name AS department_name, c.full_name AS citizen_name
        FROM service_requests sr JOIN service_catalog sc ON sc.id = sr.service_id JOIN departments d ON d.id = sr.department_id JOIN citizens c ON c.id = sr.citizen_id WHERE sr.id = ?`
          )
          .get(Number(requestRecord.id)) as Record<string, unknown>
        res.json(serializeServiceRequestForEmployee(updated))
      } catch (error) {
        res.status(400).json({ message: error instanceof Error ? error.message : 'تعذر رفع المستند المطلوب.' })
      }
    }
  )
}
