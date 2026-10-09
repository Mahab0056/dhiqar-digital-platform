import type express from 'express'
import { safeMessage } from '../http/error-handler.js'
import { param, toLatinDigits } from '../http/params.js'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { upload, uploadBudget, validateUploadedFile } from '../http/upload.js'
import { requireSession, currentCitizen, currentSession, isDeptManager, type SessionData } from '../auth/session.js'
import { computeDueAt, isOverdue, nextSlaClock, WAITING_ON_CITIZEN_STATUSES } from '../services/sla.js'
import { notifyCitizen, employeeWorkQueueRealtime } from '../realtime.js'
import { addAudit, db, nextReference } from '../db.js'
import { readDecryptedMedia, storeEncryptedMedia } from '../media.js'
import { createIssuedDocument } from '../issued-documents.js'
import { departmentById } from '../department-registry.js'
import { getCatalogService, type CatalogDocument } from '../services/catalog.js'
import { createPaymentForRequest, listPaymentsForRequest } from '../payments/intents.js'
import { paymentProvider } from '../payments/providers.js'

/** Per-request document checklist persisted on service_requests.document_checklist */
export type ChecklistItem = {
  key: string
  label: string
  description: string
  required: boolean
  accepts: Array<'image' | 'pdf'>
  status: 'MISSING' | 'UPLOADED' | 'VERIFIED' | 'REJECTED'
  mediaId: string | null
  note: string | null
  updatedAt: string | null
}

export const serviceRequestStatuses = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'ACTION_REQUIRED',
  'APPROVED',
  'REJECTED',
  'APPOINTMENT_REQUESTED',
  'PAYMENT_PENDING',
] as const

const parseChecklist = (value: unknown): ChecklistItem[] => {
  try {
    return value ? (JSON.parse(String(value)) as ChecklistItem[]) : []
  } catch {
    return []
  }
}

const buildChecklist = (documents: CatalogDocument[]): ChecklistItem[] =>
  documents.map(doc => ({
    key: doc.key,
    label: doc.label,
    description: doc.description || '',
    required: doc.required,
    accepts: doc.accepts?.length ? doc.accepts : ['image', 'pdf'],
    status: 'MISSING',
    mediaId: null,
    note: null,
    updatedAt: null,
  }))

const serviceRequestDocumentDetails = (row: Record<string, unknown>) => {
  const fieldLabels = new Map(
    (getCatalogService(String(row.service_id))?.fields || []).map(field => [field.key, field.label])
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
        `SELECT srm.id, srm.media_id, srm.label, srm.document_key, mo.original_name, mo.mime_type, mo.size_bytes, mo.deleted_at
  FROM service_request_media srm JOIN media_objects mo ON mo.id = srm.media_id WHERE srm.service_request_id = ? ORDER BY srm.created_at ASC`
      )
      .all(requestId) as Array<Record<string, unknown>>
  ).map(item => ({
    id: String(item.id),
    mediaId: String(item.media_id),
    label: String(item.label),
    documentKey: item.document_key ? String(item.document_key) : null,
    originalName: String(item.original_name),
    mimeType: String(item.mime_type),
    sizeBytes: Number(item.size_bytes),
    available: !item.deleted_at,
  }))

const fullRowSql = `SELECT sr.*, sc.name AS service_name, sc.channel AS service_channel, d.name AS department_name, c.full_name AS citizen_name, c.phone_masked AS citizen_phone,
    sa.full_name AS assigned_staff_name, od.name AS origin_department_name
  FROM service_requests sr JOIN service_catalog sc ON sc.id = sr.service_id JOIN departments d ON d.id = sr.department_id JOIN citizens c ON c.id = sr.citizen_id
  LEFT JOIN staff_accounts sa ON sa.id = sr.assigned_staff_id LEFT JOIN departments od ON od.id = sr.origin_department_id`

export type ServiceRequestTransferView = {
  id: string
  reference: string
  fromDepartmentId: string
  fromDepartmentName: string
  toDepartmentId: string
  toDepartmentName: string
  reason: string
  requestedBy: string
  createdAt: string
}

const transferSelect = `SELECT t.*, sr.reference, fd.name AS from_department_name, td.name AS to_department_name
  FROM service_request_transfers t JOIN service_requests sr ON sr.id = t.service_request_id
  LEFT JOIN departments fd ON fd.id = t.from_department_id LEFT JOIN departments td ON td.id = t.to_department_id`

const mapTransfer = (row: Record<string, unknown>): ServiceRequestTransferView => ({
  id: String(row.id),
  reference: String(row.reference),
  fromDepartmentId: String(row.from_department_id),
  fromDepartmentName: String(row.from_department_name || row.from_department_id),
  toDepartmentId: String(row.to_department_id),
  toDepartmentName: String(row.to_department_name || row.to_department_id),
  reason: String(row.reason),
  requestedBy: String(row.requested_by),
  createdAt: String(row.created_at),
})

/** Referral history for many requests in one query (the list view must not do one query per row). */
function transfersByRequest(ids: number[]) {
  const byRequest = new Map<number, ServiceRequestTransferView[]>()
  if (!ids.length) return byRequest
  const rows = db
    .prepare(
      `${transferSelect} WHERE t.service_request_id IN (${ids.map(() => '?').join(', ')}) ORDER BY t.created_at ASC`
    )
    .all(...ids) as Array<Record<string, unknown>>
  for (const row of rows) {
    const id = Number(row.service_request_id)
    const list = byRequest.get(id) || []
    list.push(mapTransfer(row))
    byRequest.set(id, list)
  }
  return byRequest
}

const loadRequest = (reference: string) =>
  db.prepare(`${fullRowSql} WHERE sr.reference = ?`).get(reference) as Record<string, unknown> | undefined

const latestAppointment = (serviceRequestId: number) => {
  const appointment = db
    .prepare(
      `SELECT id, preferred_date, preferred_time, status, confirmation_note FROM appointments WHERE service_request_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(serviceRequestId) as Record<string, unknown> | undefined
  return appointment
    ? {
        id: String(appointment.id),
        preferredDate: String(appointment.preferred_date),
        preferredTime: String(appointment.preferred_time),
        status: String(appointment.status),
        note: appointment.confirmation_note ? String(appointment.confirmation_note) : null,
      }
    : null
}

const serializeServiceRequestForEmployee = (
  row: Record<string, unknown>,
  transfers: ServiceRequestTransferView[] = transfersByRequest([Number(row.id)]).get(Number(row.id)) || []
) => {
  const service = getCatalogService(String(row.service_id))
  const fieldLabels = new Map((service?.fields || []).map(field => [field.key, field.label]))
  const formData = JSON.parse(String(row.form_data || '{}')) as Record<string, string>
  return {
    id: Number(row.id),
    reference: String(row.reference),
    serviceKey: String(row.service_id),
    departmentId: String(row.department_id),
    serviceName: String(row.service_name),
    department: String(row.department_name),
    citizenName: String(row.citizen_name),
    citizenPhone: row.citizen_phone ? String(row.citizen_phone) : null,
    status: String(row.status),
    formData,
    formEntries: Object.entries(formData).map(([key, value]) => ({ key, label: fieldLabels.get(key) || key, value })),
    currentAction: String(row.current_action),
    decisionNote: row.decision_note ? String(row.decision_note) : null,
    requiredDocument: row.required_document ? String(row.required_document) : null,
    decidedBy: row.decided_by ? String(row.decided_by) : null,
    decidedAt: row.decided_at ? String(row.decided_at) : null,
    checklist: parseChecklist(row.document_checklist),
    attachments: serviceRequestAttachments(Number(row.id)),
    payments: listPaymentsForRequest(Number(row.id)),
    paymentStatus: String(row.payment_status || 'NOT_REQUIRED'),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    // the employee must see the date the citizen asked for before confirming one
    appointment: latestAppointment(Number(row.id)),
    assignedStaffId: row.assigned_staff_id ? String(row.assigned_staff_id) : null,
    assignedStaffName: row.assigned_staff_name ? String(row.assigned_staff_name) : null,
    assignedAt: row.assigned_at ? String(row.assigned_at) : null,
    originDepartmentId: row.origin_department_id ? String(row.origin_department_id) : null,
    originDepartmentName: row.origin_department_name ? String(row.origin_department_name) : null,
    transfers,
    dueAt: row.due_at ? String(row.due_at) : null,
    overdue: isOverdue({ status: String(row.status), due_at: row.due_at }),
    // waiting on the citizen: the department's clock is stopped until the request comes back
    slaPaused: (WAITING_ON_CITIZEN_STATUSES as readonly string[]).includes(String(row.status)),
  }
}

const serializeServiceRequestForCitizen = (row: Record<string, unknown>) => {
  return {
    id: Number(row.id),
    reference: String(row.reference),
    serviceKey: String(row.service_id),
    serviceName: String(row.service_name),
    departmentId: String(row.department_id),
    departmentName: String(row.department_name),
    department: String(row.department_name),
    status: String(row.status),
    formData: JSON.parse(String(row.form_data || '{}')) as Record<string, string>,
    currentAction: String(row.current_action),
    decisionNote: row.decision_note ? String(row.decision_note) : null,
    requiredDocument: row.required_document ? String(row.required_document) : null,
    decidedAt: row.decided_at ? String(row.decided_at) : null,
    checklist: parseChecklist(row.document_checklist),
    attachments: serviceRequestAttachments(Number(row.id)),
    payments: listPaymentsForRequest(Number(row.id)),
    paymentStatus: String(row.payment_status || 'NOT_REQUIRED'),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    appointment: latestAppointment(Number(row.id)),
  }
}

/** Department staff only see their own department's queue; operations/super admin see everything. */
function departmentScope(session: SessionData): { sql: string; values: string[] } | null {
  if (session.role === 'SUPER_ADMIN' || session.role === 'OPERATIONS') return { sql: '', values: [] }
  if (!session.departmentId) return null
  return { sql: 'AND sr.department_id = ?', values: [session.departmentId] }
}

/** References whose approval (PDF issuance) is being written right now — single API replica, see docs/DATABASE.md. */
const approvalsInFlight = new Set<string>()

function canActOn(session: SessionData, row: Record<string, unknown>) {
  if (session.role === 'SUPER_ADMIN') return true
  return Boolean(session.departmentId) && session.departmentId === String(row.department_id)
}

const isClosed = (row: Record<string, unknown>) => ['APPROVED', 'REJECTED'].includes(String(row.status))

/**
 * A request claimed by one employee is theirs to work: a colleague gets a clear 409 instead of overwriting the
 * assignee's review. The department manager and the super admin can still step in. Unassigned requests stay open
 * to every employee of the department (the behaviour before assignment existed).
 */
function assignmentConflict(session: SessionData, row: Record<string, unknown>) {
  const assignee = row.assigned_staff_id ? String(row.assigned_staff_id) : null
  if (!assignee || assignee === session.staffId) return null
  if (session.role === 'SUPER_ADMIN' || isDeptManager(session, String(row.department_id))) return null
  return `هذا الطلب مُسند إلى ${row.assigned_staff_name ? String(row.assigned_staff_name) : 'موظف آخر'}. اطلب منه تحريره، أو من مدير الدائرة إعادة إسناده.`
}

const publishRequest = (
  row: Record<string, unknown>,
  action: 'UPDATED' | 'ASSIGNED' | 'TRANSFERRED',
  departmentId = String(row.department_id)
) => {
  const fresh = loadRequest(String(row.reference))
  employeeWorkQueueRealtime.publish({
    entity: 'SERVICE_REQUEST',
    action,
    reference: String(row.reference),
    departmentId,
    assignedStaffId: fresh?.assigned_staff_id ? String(fresh.assigned_staff_id) : null,
  })
}

export function registerServiceRequestsRoutes(app: express.Express) {
  // ---- citizen: my requests ------------------------------------------------------------
  app.get('/api/citizen/service-requests', requireSession('CITIZEN'), (_req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    const rows = db
      .prepare(`${fullRowSql} WHERE sr.citizen_id = ? ORDER BY sr.created_at DESC`)
      .all(citizen.id) as Array<Record<string, unknown>>
    res.json(rows.map(serializeServiceRequestForCitizen))
  })

  // ---- citizen: submit ------------------------------------------------------------------
  app.post('/api/service-requests', requireSession('CITIZEN'), uploadBudget(60), upload.any(), (req, res) => {
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
        serviceKey: z.string().min(2).max(120),
        data: z.record(z.string(), z.unknown()),
        faceConsent: z.literal('true'),
        documentConsent: z.literal('true').optional(),
        clientRequestId: z
          .string()
          .regex(/^[A-Za-z0-9-]{8,80}$/)
          .optional(),
      })
      .parse({ ...req.body, data: rawData })
    // idempotency: a double click, a second tab or a retried upload with the same form key returns the first request
    if (payload.clientRequestId) {
      const sessionCitizen = currentCitizen(res)
      if (!sessionCitizen) return
      const existing = db
        .prepare(`${fullRowSql} WHERE sr.citizen_id = ? AND sr.client_request_id = ?`)
        .get(sessionCitizen.id, payload.clientRequestId) as Record<string, unknown> | undefined
      if (existing) {
        const view = serializeServiceRequestForCitizen(existing)
        const pending = view.payments.find(item => item.status !== 'PAID')
        return res.status(200).json({
          id: view.id,
          reference: view.reference,
          serviceKey: view.serviceKey,
          serviceName: view.serviceName,
          department: view.departmentName,
          status: view.status,
          currentAction: view.currentAction,
          checklist: view.checklist,
          payment: pending ? { reference: pending.reference, amountIqd: pending.amountIqd, mode: pending.mode } : null,
          appointment: view.appointment,
          createdAt: view.createdAt,
          duplicate: true,
        })
      }
    }
    const service = getCatalogService(payload.serviceKey)
    if (!service || service.mode === 'SPECIALIZED' || service.mode === 'EXTERNAL')
      return res.status(404).json({ message: 'هذه الخدمة لا تُقدَّم عبر الاستمارة الإلكترونية.' })
    if (!service.active)
      return res
        .status(409)
        .json({ message: 'أوقفت الدائرة استقبال الطلبات لهذه الخدمة مؤقتاً. راجع الدائرة المختصة أو حاول لاحقاً.' })
    if (service.channel === 'INFORMATION_ONLY')
      return res.status(409).json({ message: 'هذه الخدمة معلوماتية فقط ولا تستقبل طلبات إلكترونية.' })
    const citizen = currentCitizen(res)
    if (!citizen) return
    if (!['VERIFIED', 'VERIFIED_MANUAL'].includes(citizen.verificationStatus))
      return res.status(409).json({ message: 'أكمل توثيق هويتك قبل إرسال طلب جديد.' })

    const files = (req.files as Express.Multer.File[] | undefined) || []
    const faceVideo = files.find(file => file.fieldname === 'faceVideo')
    if (!faceVideo) return res.status(400).json({ message: 'صوّر فيديو توثيق الوجه القصير قبل إرسال الطلب.' })
    validateUploadedFile(faceVideo, ['video'])

    // ---- fields
    const cleanData: Record<string, string> = {}
    for (const field of service.fields) {
      let value = String(payload.data[field.key] ?? '').trim()
      if (['tel', 'number', 'date', 'time'].includes(field.type)) value = toLatinDigits(value)
      if (!value && field.key === 'fullName') value = citizen.fullName
      if (field.required && !value) return res.status(400).json({ message: `الحقل «${field.label}» مطلوب.` })
      if (field.maxLength && value.length > field.maxLength)
        return res.status(400).json({ message: `الحقل «${field.label}» أطول من الحد المسموح.` })
      if (value && field.options && !field.options.includes(value))
        return res.status(400).json({ message: `القيمة المختارة في «${field.label}» غير مسموحة.` })
      if (value && field.type === 'tel' && !/^(\+?964|0)?7\d{9}$/.test(value.replace(/[\s-]/g, '')))
        return res.status(400).json({ message: `رقم الهاتف في «${field.label}» غير صحيح (07XXXXXXXXX).` })
      if (value && field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        return res.status(400).json({ message: `البريد الإلكتروني في «${field.label}» غير صحيح.` })
      if (value && field.type === 'number' && Number.isNaN(Number(value)))
        return res.status(400).json({ message: `الحقل «${field.label}» يجب أن يكون رقماً.` })
      if (value && field.type === 'date' && Number.isNaN(Date.parse(value)))
        return res.status(400).json({ message: `التاريخ في «${field.label}» غير صحيح.` })
      if (value) cleanData[field.key] = value
    }
    if (JSON.stringify(cleanData).length > 20000)
      return res.status(413).json({ message: 'حجم بيانات الاستمارة أكبر من المسموح.' })

    // ---- documents: every required document must be attached (image/pdf) ----------------
    const checklist = buildChecklist(service.requiredDocuments)
    const documentFiles = new Map<string, Express.Multer.File>()
    for (const file of files) {
      const match = file.fieldname.match(/^doc__([a-z0-9-]+)$/)
      if (match) documentFiles.set(match[1], file)
    }
    for (const item of checklist) {
      const file = documentFiles.get(item.key)
      if (!file) {
        if (item.required) return res.status(400).json({ message: `المستمسك «${item.label}» مطلوب لإكمال الطلب.` })
        continue
      }
      const kinds: Array<'image' | 'pdf'> = item.accepts
      try {
        validateUploadedFile(file, kinds)
      } catch {
        return res.status(400).json({ message: `ملف «${item.label}» يجب أن يكون صورة واضحة أو PDF.` })
      }
    }
    if (checklist.length && !payload.documentConsent)
      return res.status(400).json({ message: 'أكّد أن المستمسكات المرفوعة أصلية وصحيحة قبل الإرسال.' })

    // ---- department routing --------------------------------------------------------------
    let departmentId = service.departmentId
    if (service.key === 'online-appointment' && cleanData.department) {
      const chosen = [...departmentById.values()].find(item => item.name === cleanData.department)
      if (chosen) departmentId = chosen.id
    }
    if (
      service.key === 'water-complaint' &&
      cleanData.problemType?.includes('مجار') &&
      departmentById.has('dhiqar-sewerage')
    )
      departmentId = 'dhiqar-sewerage'
    const department = departmentById.get(departmentId)
    if (!department) return res.status(409).json({ message: 'الدائرة المختصة غير موجودة في سجل الجهات.' })

    const isAppointment = service.mode === 'APPOINTMENT' || service.channel === 'APPOINTMENT_REQUIRED'
    if (service.mode === 'APPOINTMENT') {
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
    const serial = String(nextReference('service_requests', 'SELECT COUNT(*) AS value FROM service_requests')).padStart(
      5,
      '0'
    )
    const reference = `TQS-${new Date().getFullYear()}-${serial}`
    // Official fee + working gateway → the request waits for payment before it reaches the department.
    const officialFee = service.feeStatus === 'OFFICIAL' && (service.feeIqd || 0) > 0
    const feeDue = officialFee && Boolean(paymentProvider())
    // official fee but no gateway → the fee is never waived: it is flagged to be paid at the office
    const payAtOffice = officialFee && !feeDue
    const currentAction = feeDue
      ? `بانتظار سداد رسم الخدمة (${(service.feeIqd || 0).toLocaleString('en-US')} د.ع). يُحال الطلب إلى الدائرة فور تأكيد الدفع.`
      : payAtOffice
        ? `أُرسل الطلب إلى الدائرة المختصة. رسم الخدمة ${(service.feeIqd || 0).toLocaleString('en-US')} د.ع يُسدد في الدائرة عند إكمال الإجراء (الدفع الإلكتروني غير مفعّل بعد).`
        : service.mode === 'APPOINTMENT'
          ? 'أُرسل طلب الموعد إلى الدائرة وبانتظار التأكيد.'
          : service.channel === 'APPOINTMENT_REQUIRED'
            ? 'أُرسل الطلب والمستمسكات للتدقيق الأولي؛ ستحدد الدائرة موعد الحضور لإكمال الإجراء.'
            : 'أُرسل الطلب والمستمسكات إلى الدائرة المختصة للتدقيق.'
    const initialStatus = feeDue
      ? 'PAYMENT_PENDING'
      : service.mode === 'APPOINTMENT'
        ? 'APPOINTMENT_REQUESTED'
        : 'SUBMITTED'

    db.exec('BEGIN')
    let serviceRequestId = 0
    let faceMediaId = ''
    try {
      const result = db
        .prepare(
          `INSERT INTO service_requests (reference, citizen_id, service_id, department_id, status, form_data, current_action, document_checklist, payment_status, client_request_id, due_at, waiting_since, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          reference,
          citizen.id,
          service.key,
          department.id,
          initialStatus,
          JSON.stringify(cleanData),
          currentAction,
          '[]',
          feeDue ? 'PENDING' : payAtOffice ? 'PAY_AT_OFFICE' : 'NOT_REQUIRED',
          payload.clientRequestId || null,
          computeDueAt(timestamp, service),
          // a fee due online means the request starts out waiting on the citizen: the SLA clock is paused until paid
          feeDue ? timestamp : null,
          timestamp,
          timestamp
        )
      serviceRequestId = Number(result.lastInsertRowid)
      const faceMedia = storeEncryptedMedia({
        citizenId: citizen.id,
        purpose: 'FACE_VIDEO',
        originalName: faceVideo.originalname || 'service-face-video',
        mimeType: faceVideo.mimetype,
        buffer: faceVideo.buffer,
        retentionHours: 24 * 30,
      })
      faceMediaId = faceMedia.id
      const insertMedia = db.prepare(
        'INSERT INTO service_request_media (id, service_request_id, media_id, label, document_key, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      insertMedia.run(
        `srm_${randomUUID().replaceAll('-', '')}`,
        serviceRequestId,
        faceMedia.id,
        'فيديو توثيق الوجه قبل الإرسال',
        'face-video',
        timestamp
      )
      for (const item of checklist) {
        const file = documentFiles.get(item.key)
        if (!file) continue
        const media = storeEncryptedMedia({
          citizenId: citizen.id,
          purpose: 'SERVICE_REQUEST_DOCUMENT',
          originalName: file.originalname || item.key,
          mimeType: file.mimetype,
          buffer: file.buffer,
          retentionHours: 24 * 90,
        })
        insertMedia.run(
          `srm_${randomUUID().replaceAll('-', '')}`,
          serviceRequestId,
          media.id,
          item.label,
          item.key,
          timestamp
        )
        item.status = 'UPLOADED'
        item.mediaId = media.id
        item.updatedAt = timestamp
      }
      db.prepare('UPDATE service_requests SET document_checklist = ? WHERE id = ?').run(
        JSON.stringify(checklist),
        serviceRequestId
      )
      if (service.mode === 'APPOINTMENT') {
        db.prepare(
          `INSERT INTO appointments (id, reference, citizen_id, service_request_id, department, purpose, preferred_date, preferred_time, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?)`
        ).run(
          `apt_${randomUUID().replaceAll('-', '')}`,
          `APT-${reference.slice(4)}`,
          citizen.id,
          serviceRequestId,
          department.name,
          cleanData.purpose || service.title,
          cleanData.preferredDate,
          cleanData.preferredTime,
          timestamp,
          timestamp
        )
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    const payment = feeDue
      ? createPaymentForRequest({
          serviceRequestId,
          citizenId: citizen.id,
          serviceId: service.key,
          departmentId: department.id,
          amountIqd: service.feeIqd || 0,
          description: `رسم ${service.title}`,
          requestedBy: 'catalog-fee',
        })
      : null
    notifyCitizen({
      citizenId: citizen.id,
      type: feeDue ? 'PAYMENT_REQUIRED' : isAppointment ? 'APPOINTMENT_REQUESTED' : 'SERVICE_REQUEST_CREATED',
      title: feeDue
        ? 'سدّد رسم الخدمة لإكمال طلبك'
        : service.mode === 'APPOINTMENT'
          ? 'تم إرسال طلب الموعد'
          : 'تم تسجيل طلبك',
      message: `${service.title} — ${reference}. ${currentAction}`,
      link: payment ? `/citizen/pay/${payment.reference}` : '/citizen#my-requests',
    })
    if (!feeDue)
      employeeWorkQueueRealtime.publish({
        entity: 'SERVICE_REQUEST',
        action: 'CREATED',
        reference,
        departmentId: department.id,
      })
    addAudit({
      actor: citizen.fullName,
      role: 'CITIZEN',
      action: service.mode === 'APPOINTMENT' ? 'APPOINTMENT_REQUESTED' : 'SERVICE_REQUEST_CREATED',
      entityType: 'ServiceRequest',
      entityId: reference,
      newValue: {
        service: service.key,
        department: department.id,
        documents: checklist.filter(item => item.mediaId).map(item => item.key),
      },
      metadata: {
        storedFields: Object.keys(cleanData),
        protectedFaceVideoId: faceMediaId,
        faceConsent: true,
        feeIqd: officialFee ? service.feeIqd : 0,
        feeCollection: feeDue ? 'ONLINE' : payAtOffice ? 'PAY_AT_OFFICE' : 'NONE',
      },
    })
    res.status(201).json({
      id: serviceRequestId,
      reference,
      serviceKey: service.key,
      serviceName: service.title,
      department: department.name,
      status: initialStatus,
      currentAction,
      checklist,
      payment: payment ? { reference: payment.reference, amountIqd: payment.amountIqd, mode: payment.mode } : null,
      createdAt: timestamp,
    })
  })

  // ---- citizen: (re)upload a checklist document -------------------------------------------
  app.post(
    '/api/citizen/service-requests/:reference/upload-document',
    requireSession('CITIZEN'),
    upload.single('document'),
    (req, res) => {
      try {
        const citizen = currentCitizen(res)
        if (!citizen) return
        const row = db
          .prepare(`${fullRowSql} WHERE sr.reference = ? AND sr.citizen_id = ?`)
          .get(param(req, 'reference'), citizen.id) as Record<string, unknown> | undefined
        if (!row) return res.status(404).json({ message: 'طلب الخدمة غير موجود ضمن حسابك.' })
        if (['APPROVED', 'REJECTED'].includes(String(row.status)) || approvalsInFlight.has(String(row.reference)))
          return res.status(409).json({ message: 'هذا الطلب مغلق ولا يمكن تعديل مستمسكاته.' })
        if (!req.file) return res.status(400).json({ message: 'اختر صورة أو ملف PDF واضحاً قبل الرفع.' })
        const checklist = parseChecklist(row.document_checklist)
        const documentKey = String(req.body.documentKey || '').trim()
        let item = checklist.find(entry => entry.key === documentKey)
        if (!item) {
          // free-form document requested by the employee (legacy path) — only while a document is actually requested
          if (!row.required_document && String(row.status) !== 'ACTION_REQUIRED')
            return res.status(409).json({ message: 'لا يوجد مستمسك مطلوب منك حالياً لهذا الطلب.' })
          if (checklist.filter(entry => entry.key.startsWith('extra-')).length >= 6)
            return res.status(409).json({ message: 'وصلت الحد الأقصى للمستمسكات الإضافية لهذا الطلب.' })
          const label = String(req.body.documentName || row.required_document || 'المستند المطلوب')
            .trim()
            .slice(0, 160)
          item = {
            key: `extra-${checklist.length + 1}`,
            label,
            description: '',
            required: true,
            accepts: ['image', 'pdf'],
            status: 'MISSING',
            mediaId: null,
            note: null,
            updatedAt: null,
          }
          checklist.push(item)
        }
        const mimeType = validateUploadedFile(req.file, item.accepts)
        const media = storeEncryptedMedia({
          citizenId: citizen.id,
          purpose: 'SERVICE_REQUEST_DOCUMENT',
          originalName: req.file.originalname || item.key,
          mimeType,
          buffer: req.file.buffer,
          retentionHours: 24 * 90,
        })
        const timestamp = new Date().toISOString()
        db.prepare(
          'INSERT INTO service_request_media (id, service_request_id, media_id, label, document_key, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(`srm_${randomUUID().replaceAll('-', '')}`, Number(row.id), media.id, item.label, item.key, timestamp)
        item.status = 'UPLOADED'
        item.mediaId = media.id
        item.note = null
        item.updatedAt = timestamp
        const stillMissing = checklist.filter(
          entry => entry.required && entry.status !== 'UPLOADED' && entry.status !== 'VERIFIED'
        )
        // a request waiting for payment keeps waiting for payment; uploads never bypass the fee
        const paymentPending = String(row.status) === 'PAYMENT_PENDING'
        const nextStatus = paymentPending ? 'PAYMENT_PENDING' : stillMissing.length ? 'ACTION_REQUIRED' : 'UNDER_REVIEW'
        const currentAction = paymentPending
          ? String(row.current_action || 'بانتظار سداد الرسم لإحالة الطلب إلى الدائرة.')
          : stillMissing.length
            ? `بقي رفع: ${stillMissing.map(entry => entry.label).join('، ')}.`
            : 'اكتملت المستمسكات وأُعيد الطلب إلى الموظف للتدقيق.'
        // back from the citizen → the deadline moves forward by the time it waited on them
        const clock = nextSlaClock({ ...row, status: String(row.status) }, nextStatus, timestamp)
        db.prepare(
          `UPDATE service_requests SET status = ?, current_action = ?, document_checklist = ?, required_document = ?, due_at = ?, waiting_since = ?, updated_at = ? WHERE id = ?`
        ).run(
          nextStatus,
          currentAction,
          JSON.stringify(checklist),
          stillMissing.length ? stillMissing[0].label : null,
          clock.dueAt,
          clock.waitingSince,
          timestamp,
          Number(row.id)
        )
        notifyCitizen({
          citizenId: citizen.id,
          type: 'SERVICE_DOCUMENT_UPLOADED',
          title: 'تم رفع المستمسك',
          message: `${String(row.reference)} — ${currentAction}`,
          link: '/citizen#my-requests',
        })
        publishRequest(row, 'UPDATED')
        addAudit({
          actor: citizen.fullName,
          role: 'CITIZEN',
          action: 'SERVICE_REQUEST_DOCUMENT_UPLOADED',
          entityType: 'ServiceRequest',
          entityId: String(row.reference),
          newValue: { documentKey: item.key, mediaId: media.id },
        })
        res.json(serializeServiceRequestForCitizen(loadRequest(String(row.reference))!))
      } catch (error) {
        res.status(400).json({ message: safeMessage(error, 'تعذر رفع المستند المطلوب.') })
      }
    }
  )

  // ---- employee: queue (scoped to department) ----------------------------------------------
  app.get(
    '/api/employee/service-requests',
    requireSession('EMPLOYEE', 'IDENTITY_REVIEWER', 'OPERATIONS', 'SUPER_ADMIN'),
    (req, res) => {
      const session = currentSession(res)
      const scope = departmentScope(session)
      if (!scope)
        return res.json({
          items: [],
          scope: 'NONE',
          message: 'حسابك غير مرتبط بدائرة بعد. اطلب من مدير النظام ربطه بدائرتك.',
        })
      const status = String(req.query.status || '')
      const statusSql =
        status && (serviceRequestStatuses as readonly string[]).includes(status) ? 'AND sr.status = ?' : ''
      const rows = db
        .prepare(
          `${fullRowSql} WHERE 1 = 1 ${scope.sql} ${statusSql}
      ORDER BY CASE sr.status WHEN 'SUBMITTED' THEN 0 WHEN 'APPOINTMENT_REQUESTED' THEN 0 WHEN 'UNDER_REVIEW' THEN 1 WHEN 'ACTION_REQUIRED' THEN 2 ELSE 3 END, sr.updated_at DESC LIMIT 300`
        )
        .all(...scope.values, ...(statusSql ? [status] : [])) as Array<Record<string, unknown>>
      const transfers = transfersByRequest(rows.map(row => Number(row.id)))
      res.json({
        items: rows.map(row => serializeServiceRequestForEmployee(row, transfers.get(Number(row.id)) || [])),
        scope: scope.sql ? session.departmentId : 'ALL',
      })
    }
  )

  app.get(
    '/api/employee/service-requests/:reference',
    requireSession('EMPLOYEE', 'IDENTITY_REVIEWER', 'OPERATIONS', 'SUPER_ADMIN'),
    (req, res) => {
      const session = currentSession(res)
      const row = loadRequest(param(req, 'reference'))
      if (!row) return res.status(404).json({ message: 'طلب الخدمة غير موجود.' })
      if (session.role !== 'OPERATIONS' && !canActOn(session, row))
        return res.status(403).json({ message: 'هذا الطلب يخص دائرة أخرى.' })
      res.json(serializeServiceRequestForEmployee(row))
    }
  )

  // ---- employee: open one attachment of a request in their own department ---------------------
  app.get(
    '/api/employee/service-requests/:reference/media/:mediaId',
    requireSession('EMPLOYEE', 'SUPER_ADMIN'),
    (req, res) => {
      const session = currentSession(res)
      const row = loadRequest(param(req, 'reference'))
      if (!row) return res.status(404).json({ message: 'طلب الخدمة غير موجود.' })
      if (!canActOn(session, row)) return res.status(403).json({ message: 'هذا الطلب يخص دائرة أخرى.' })
      const mediaId = param(req, 'mediaId')
      const owned = db
        .prepare('SELECT 1 FROM service_request_media WHERE service_request_id = ? AND media_id = ?')
        .get(Number(row.id), mediaId)
      if (!owned) return res.status(404).json({ message: 'المرفق غير مرتبط بهذا الطلب.' })
      try {
        const media = readDecryptedMedia(mediaId)
        if (!media) return res.status(404).json({ message: 'المرفق غير متاح أو انتهت مدة الاحتفاظ.' })
        addAudit({
          actor: session.actor,
          role: session.role,
          action: 'SERVICE_DOCUMENT_VIEWED',
          entityType: 'ServiceRequest',
          entityId: String(row.reference),
          metadata: { mediaId },
        })
        res.setHeader('Content-Type', media.mimeType)
        res.setHeader('Content-Disposition', 'inline')
        res.setHeader('Cache-Control', 'private, no-store')
        res.send(media.buffer)
      } catch {
        res.status(500).json({ message: 'تعذر فتح المرفق المشفر.' })
      }
    }
  )

  // ---- employee: verify / reject one document -----------------------------------------------
  app.patch(
    '/api/employee/service-requests/:reference/documents/:documentKey',
    requireSession('EMPLOYEE', 'SUPER_ADMIN'),
    (req, res) => {
      const session = currentSession(res)
      const row = loadRequest(param(req, 'reference'))
      if (!row) return res.status(404).json({ message: 'طلب الخدمة غير موجود.' })
      if (!canActOn(session, row)) return res.status(403).json({ message: 'هذا الطلب يخص دائرة أخرى.' })
      if (['APPROVED', 'REJECTED'].includes(String(row.status)) || approvalsInFlight.has(String(row.reference)))
        return res.status(409).json({ message: 'الطلب مغلق ولا يمكن تعديل نتائج التدقيق.' })
      const conflict = assignmentConflict(session, row)
      if (conflict) return res.status(409).json({ message: conflict, code: 'ASSIGNED_TO_OTHER' })
      const payload = z
        .object({ status: z.enum(['VERIFIED', 'REJECTED']), note: z.string().trim().max(400).optional() })
        .parse(req.body)
      const checklist = parseChecklist(row.document_checklist)
      const item = checklist.find(entry => entry.key === param(req, 'documentKey'))
      if (!item) return res.status(404).json({ message: 'المستمسك غير موجود في قائمة هذا الطلب.' })
      if (!item.mediaId) return res.status(409).json({ message: 'لم يرفع المواطن هذا المستمسك بعد.' })
      if (payload.status === 'REJECTED' && !payload.note)
        return res.status(400).json({ message: 'اكتب سبب رفض المستمسك حتى يعرف المواطن ما المطلوب.' })
      const timestamp = new Date().toISOString()
      item.status = payload.status
      item.note = payload.note || null
      item.updatedAt = timestamp
      db.prepare(
        `UPDATE service_requests SET document_checklist = ?, status = CASE WHEN status = 'SUBMITTED' THEN 'UNDER_REVIEW' ELSE status END, review_started_at = COALESCE(review_started_at, ?), updated_at = ? WHERE id = ?`
      ).run(JSON.stringify(checklist), timestamp, timestamp, Number(row.id))
      addAudit({
        actor: session.actor,
        role: session.role,
        action: payload.status === 'VERIFIED' ? 'SERVICE_DOCUMENT_VERIFIED' : 'SERVICE_DOCUMENT_REJECTED',
        entityType: 'ServiceRequest',
        entityId: String(row.reference),
        newValue: { documentKey: item.key, note: item.note },
      })
      publishRequest(row, 'UPDATED')
      res.json(serializeServiceRequestForEmployee(loadRequest(String(row.reference))!))
    }
  )

  // ---- employee: decision ---------------------------------------------------------------------
  app.patch(
    '/api/employee/service-requests/:reference',
    requireSession('EMPLOYEE', 'SUPER_ADMIN'),
    async (req, res) => {
      const session = currentSession(res)
      const row = loadRequest(param(req, 'reference'))
      if (!row) return res.status(404).json({ message: 'طلب الخدمة غير موجود.' })
      if (!canActOn(session, row)) return res.status(403).json({ message: 'هذا الطلب يخص دائرة أخرى.' })
      if (['APPROVED', 'REJECTED'].includes(String(row.status)))
        return res.status(409).json({ message: 'صدر قرار نهائي سابق لهذا الطلب.' })
      if (approvalsInFlight.has(String(row.reference)))
        return res
          .status(409)
          .json({ message: 'يجري حفظ قرار الموافقة على هذا الطلب الآن. أعد تحميل الصفحة بعد لحظات.' })
      const conflict = assignmentConflict(session, row)
      if (conflict) return res.status(409).json({ message: conflict, code: 'ASSIGNED_TO_OTHER' })
      const parsed = z
        .object({
          status: z.enum(['UNDER_REVIEW', 'ACTION_REQUIRED', 'APPROVED', 'REJECTED', 'PAYMENT_REQUIRED']),
          currentAction: z.string().trim().min(6).max(500).optional(),
          decisionNote: z.string().trim().max(1500).optional(),
          requiredDocument: z.string().trim().max(160).optional(),
          appointmentDate: z.string().trim().optional(),
          appointmentNote: z.string().trim().max(300).optional(),
          amountIqd: z.number().int().min(250).max(50_000_000).optional(),
        })
        .safeParse(req.body)
      if (!parsed.success) return res.status(400).json({ message: 'تحقق من الحالة ووصف الإجراء قبل الحفظ.' })
      // while a fee is being paid the request is the citizen's move: the department may only send it back or reject it
      if (String(row.status) === 'PAYMENT_PENDING' && !['ACTION_REQUIRED', 'REJECTED'].includes(parsed.data.status))
        return res.status(409).json({
          message: 'الطلب بانتظار سداد الرسم. يمكنك إعادته للمواطن أو رفضه فقط، وسيعود إليك تلقائياً بعد السداد.',
        })
      // re-saving "under review" with nothing new would only spam the citizen with the same notification
      if (
        parsed.data.status === 'UNDER_REVIEW' &&
        String(row.status) === 'UNDER_REVIEW' &&
        !parsed.data.currentAction &&
        !parsed.data.decisionNote
      )
        return res
          .status(409)
          .json({ message: 'الطلب قيد التدقيق مسبقاً. اكتب ملاحظة أو إجراءً جديداً، أو اختر قراراً آخر.' })
      // a fee stays owed until it is PAID: a FAILED or CANCELLED attempt can be retried by the citizen, but it never
      // lets the request be approved (or a second fee be stacked on top of it)
      const pendingPayments = listPaymentsForRequest(Number(row.id)).filter(item => item.status !== 'PAID')

      // ---- fee determined by the department → citizen pays, then the request comes back ------
      if (parsed.data.status === 'PAYMENT_REQUIRED') {
        if (!parsed.data.amountIqd) return res.status(400).json({ message: 'حدد مبلغ الرسم بالدينار العراقي.' })
        if (!paymentProvider())
          return res.status(503).json({ message: 'بوابة الدفع غير مفعّلة؛ لا يمكن طلب الدفع إلكترونياً الآن.' })
        if (pendingPayments.length)
          return res.status(409).json({ message: `يوجد رسم بانتظار السداد مسبقاً (${pendingPayments[0].reference}).` })
        const timestamp = new Date().toISOString()
        const intent = createPaymentForRequest({
          serviceRequestId: Number(row.id),
          citizenId: Number(row.citizen_id),
          serviceId: String(row.service_id),
          departmentId: String(row.department_id),
          amountIqd: parsed.data.amountIqd,
          description: parsed.data.decisionNote || `رسم ${String(row.service_name)}`,
          requestedBy: session.actor,
        })
        const action = `حددت الدائرة رسم الخدمة: ${parsed.data.amountIqd.toLocaleString('en-US')} د.ع${parsed.data.decisionNote ? ` — ${parsed.data.decisionNote}` : ''}. سدّد الرسم إلكترونياً لاستكمال المعاملة.`
        const clock = nextSlaClock({ ...row, status: String(row.status) }, 'PAYMENT_PENDING', timestamp)
        db.prepare(
          `UPDATE service_requests SET status = 'PAYMENT_PENDING', current_action = ?, decision_note = ?, payment_status = 'PENDING', review_started_at = COALESCE(review_started_at, ?), due_at = ?, waiting_since = ?, updated_at = ? WHERE id = ?`
        ).run(
          action,
          parsed.data.decisionNote || null,
          timestamp,
          clock.dueAt,
          clock.waitingSince,
          timestamp,
          Number(row.id)
        )
        notifyCitizen({
          citizenId: Number(row.citizen_id),
          type: 'PAYMENT_REQUIRED',
          title: 'مطلوب سداد رسم الخدمة',
          message: `${String(row.reference)} — ${action}`,
          link: `/citizen/pay/${intent.reference}`,
        })
        addAudit({
          actor: session.actor,
          role: session.role,
          action: 'PAYMENT_REQUIRED',
          entityType: 'ServiceRequest',
          entityId: String(row.reference),
          newValue: { amountIqd: parsed.data.amountIqd, payment: intent.reference },
        })
        publishRequest(row, 'UPDATED')
        return res.json(serializeServiceRequestForEmployee(loadRequest(String(row.reference))!))
      }
      if (parsed.data.status === 'APPROVED' && pendingPayments.length)
        return res.status(409).json({
          message: `لا يمكن الموافقة قبل سداد الرسم المطلوب (${pendingPayments[0].reference}).`,
        })
      const checklist = parseChecklist(row.document_checklist)
      const rejectedDocs = checklist.filter(item => item.status === 'REJECTED')
      const missingDocs = checklist.filter(item => item.required && (item.status === 'MISSING' || !item.mediaId))
      const unverifiedDocs = checklist.filter(item => item.required && item.status !== 'VERIFIED')
      const decision = parsed.data
      if (decision.status === 'APPROVED' && unverifiedDocs.length)
        return res.status(409).json({
          message: `لا يمكن الموافقة قبل تدقيق كل المستمسكات المطلوبة: ${unverifiedDocs.map(item => item.label).join('، ')}.`,
        })
      if (decision.status === 'REJECTED' && !decision.decisionNote)
        return res.status(400).json({ message: 'اكتب سبب الرفض للمواطن قبل حفظ القرار.' })
      if (
        decision.status === 'ACTION_REQUIRED' &&
        !decision.requiredDocument &&
        !rejectedDocs.length &&
        !missingDocs.length
      )
        return res.status(400).json({ message: 'حدد المستمسك المرفوض أو الناقص، أو اكتب المطلوب من المواطن.' })

      const timestamp = new Date().toISOString()
      let issuedDocument: Awaited<ReturnType<typeof createIssuedDocument>> | null = null
      if (decision.status === 'APPROVED') {
        // PDF rendering is the only await in this handler: while it runs, every other change to this request
        // (a second approval click, another decision, a citizen upload) is refused instead of racing it
        approvalsInFlight.add(String(row.reference))
        try {
          issuedDocument = await createIssuedDocument({
            sourceKind: 'SERVICE_REQUEST',
            serviceRequestReference: String(row.reference),
            citizenId: Number(row.citizen_id),
            citizenName: String(row.citizen_name),
            serviceName: String(row.service_name),
            departmentName: String(row.department_name),
            documentTitle: `وثيقة إتمام معاملة — ${String(row.service_name)}`,
            issuedBy: session.actor,
            issuedAt: timestamp,
            details: serviceRequestDocumentDetails(row),
          })
        } finally {
          approvalsInFlight.delete(String(row.reference))
        }
      }
      const requiredList = [...rejectedDocs, ...missingDocs].map(item =>
        item.note ? `${item.label} (${item.note})` : item.label
      )
      if (decision.status === 'ACTION_REQUIRED' && decision.requiredDocument)
        requiredList.push(decision.requiredDocument)
      const defaultAction =
        decision.status === 'APPROVED'
          ? String(row.service_channel) === 'APPOINTMENT_REQUIRED'
            ? `اكتمل تدقيق المستمسكات وتمت الموافقة.${decision.appointmentDate ? ` موعد الحضور لإكمال الإجراء: ${decision.appointmentDate}${decision.appointmentNote ? ` — ${decision.appointmentNote}` : ''}.` : ''}`
            : 'اكتمل تدقيق المستمسكات وتمت الموافقة على الطلب.'
          : decision.status === 'REJECTED'
            ? `رُفض الطلب: ${decision.decisionNote}`
            : decision.status === 'ACTION_REQUIRED'
              ? `مطلوب من المواطن: ${requiredList.join('، ')}.`
              : 'الطلب قيد التدقيق لدى الدائرة.'
      const currentAction = decision.currentAction || defaultAction
      const finalAction = issuedDocument
        ? `${currentAction} صدرت الوثيقة الرقمية ${issuedDocument.documentNumber} وهي محفوظة في الأرشيف.`
        : currentAction
      const decided = decision.status === 'APPROVED' || decision.status === 'REJECTED'
      // sending it back to the citizen pauses the SLA; pulling it back into review resumes it (deadline pushed)
      const clock = nextSlaClock({ ...row, status: String(row.status) }, decision.status, timestamp)
      db.prepare(
        `UPDATE service_requests SET status = ?, current_action = ?, decision_note = ?, required_document = ?, document_checklist = ?, decided_by = ?, decided_at = ?, review_started_at = COALESCE(review_started_at, ?), due_at = ?, waiting_since = ?, updated_at = ? WHERE id = ?`
      ).run(
        decision.status,
        finalAction,
        decision.decisionNote || null,
        decision.status === 'ACTION_REQUIRED' ? requiredList.join('، ').slice(0, 160) : null,
        JSON.stringify(checklist),
        decided ? session.actor : null,
        decided ? timestamp : null,
        timestamp,
        clock.dueAt,
        clock.waitingSince,
        timestamp,
        Number(row.id)
      )
      if (decision.status === 'REJECTED')
        // a rejected request owes nothing: close any open fee so the citizen can't pay for a refused service
        db.prepare(
          `UPDATE payment_intents SET status = 'CANCELLED', updated_at = ? WHERE service_request_id = ? AND status IN ('CREATED', 'PENDING', 'FAILED')`
        ).run(timestamp, Number(row.id))
      if (decision.status === 'APPROVED' && decision.appointmentDate) {
        db.prepare(
          `UPDATE appointments SET status = 'CONFIRMED', confirmation_note = ?, updated_at = ? WHERE service_request_id = ?`
        ).run(
          `${decision.appointmentDate}${decision.appointmentNote ? ` — ${decision.appointmentNote}` : ''}`,
          timestamp,
          Number(row.id)
        )
      }
      const title =
        decision.status === 'APPROVED'
          ? issuedDocument
            ? 'اكتملت معاملتك — وثيقة PDF جاهزة'
            : 'تمت الموافقة على طلبك'
          : decision.status === 'REJECTED'
            ? 'تم رفض طلبك'
            : decision.status === 'ACTION_REQUIRED'
              ? 'مستمسكات أو معلومات مطلوبة'
              : 'طلبك قيد التدقيق'
      notifyCitizen({
        citizenId: Number(row.citizen_id),
        type: 'SERVICE_REQUEST_UPDATED',
        title,
        message: `${String(row.reference)} — ${finalAction}${decision.decisionNote && decision.status !== 'REJECTED' ? ` • ${decision.decisionNote}` : ''}${issuedDocument ? ' اضغط لتنزيل الوثيقة.' : ''}`,
        link: decision.status === 'APPROVED' ? '/citizen#issued-documents' : '/citizen#my-requests',
        pushLink: issuedDocument ? `/api/citizen/issued-documents/${issuedDocument.id}/pdf` : undefined,
      })
      publishRequest(row, 'UPDATED')
      addAudit({
        actor: session.actor,
        role: session.role,
        action: issuedDocument ? 'SERVICE_REQUEST_APPROVED_DOCUMENT_ISSUED' : `SERVICE_REQUEST_${decision.status}`,
        entityType: 'ServiceRequest',
        entityId: String(row.reference),
        previousValue: { status: row.status },
        newValue: {
          status: decision.status,
          requiredDocument: requiredList.join('، ') || null,
          documentNumber: issuedDocument?.documentNumber || null,
          verificationId: issuedDocument?.verificationId || null,
        },
      })
      res.json(serializeServiceRequestForEmployee(loadRequest(String(row.reference))!))
    }
  )

  // ---- employee: claim / release / assign ---------------------------------------------------------
  // Claiming is a single conditional UPDATE (… WHERE assigned_staff_id IS NULL), so two clerks clicking «استلام»
  // at the same moment can never both win: the loser gets a 409 naming who holds it.
  app.post('/api/employee/service-requests/:reference/claim', requireSession('EMPLOYEE'), (req, res) => {
    const session = currentSession(res)
    const row = loadRequest(param(req, 'reference'))
    if (!row) return res.status(404).json({ message: 'طلب الخدمة غير موجود.' })
    if (!canActOn(session, row)) return res.status(403).json({ message: 'هذا الطلب يخص دائرة أخرى.' })
    if (isClosed(row)) return res.status(409).json({ message: 'الطلب مغلق ولا يحتاج استلاماً.' })
    const timestamp = new Date().toISOString()
    const result = db
      .prepare(
        `UPDATE service_requests SET assigned_staff_id = ?, assigned_at = ?
         WHERE id = ? AND department_id = ? AND assigned_staff_id IS NULL AND status NOT IN ('APPROVED', 'REJECTED')`
      )
      .run(session.staffId, timestamp, Number(row.id), session.departmentId)
    const fresh = loadRequest(String(row.reference))!
    if (!result.changes) {
      // a double click by the same clerk is not a conflict
      if (fresh.assigned_staff_id && String(fresh.assigned_staff_id) === session.staffId)
        return res.json(serializeServiceRequestForEmployee(fresh))
      return res.status(409).json({
        message: fresh.assigned_staff_id
          ? `استلم ${fresh.assigned_staff_name ? String(fresh.assigned_staff_name) : 'موظف آخر'} هذا الطلب قبلك.`
          : 'تغيّرت حالة الطلب للتو. حدّث القائمة وحاول مجدداً.',
        code: 'ALREADY_ASSIGNED',
        assignedStaffId: fresh.assigned_staff_id ? String(fresh.assigned_staff_id) : null,
        assignedStaffName: fresh.assigned_staff_name ? String(fresh.assigned_staff_name) : null,
      })
    }
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'SERVICE_REQUEST_CLAIMED',
      entityType: 'ServiceRequest',
      entityId: String(row.reference),
      newValue: { assignedStaffId: session.staffId },
    })
    publishRequest(row, 'ASSIGNED')
    res.json(serializeServiceRequestForEmployee(fresh))
  })

  app.post(
    '/api/employee/service-requests/:reference/release',
    requireSession('EMPLOYEE', 'SUPER_ADMIN'),
    (req, res) => {
      const session = currentSession(res)
      const row = loadRequest(param(req, 'reference'))
      if (!row) return res.status(404).json({ message: 'طلب الخدمة غير موجود.' })
      if (!canActOn(session, row)) return res.status(403).json({ message: 'هذا الطلب يخص دائرة أخرى.' })
      const assignee = row.assigned_staff_id ? String(row.assigned_staff_id) : null
      if (!assignee) return res.status(409).json({ message: 'الطلب غير مُسند لأحد.' })
      if (
        assignee !== session.staffId &&
        session.role !== 'SUPER_ADMIN' &&
        !isDeptManager(session, String(row.department_id))
      )
        return res.status(403).json({ message: 'تحرير الطلب لمن استلمه أو لمدير الدائرة فقط.' })
      const result = db
        .prepare(
          'UPDATE service_requests SET assigned_staff_id = NULL, assigned_at = NULL WHERE id = ? AND assigned_staff_id = ?'
        )
        .run(Number(row.id), assignee)
      if (!result.changes) return res.status(409).json({ message: 'تغيّر إسناد الطلب للتو. حدّث القائمة.' })
      addAudit({
        actor: session.actor,
        role: session.role,
        action: 'SERVICE_REQUEST_RELEASED',
        entityType: 'ServiceRequest',
        entityId: String(row.reference),
        previousValue: { assignedStaffId: assignee },
        newValue: { assignedStaffId: null },
      })
      publishRequest(row, 'ASSIGNED')
      res.json(serializeServiceRequestForEmployee(loadRequest(String(row.reference))!))
    }
  )

  app.post(
    '/api/employee/service-requests/:reference/assign',
    requireSession('EMPLOYEE', 'SUPER_ADMIN'),
    (req, res) => {
      const session = currentSession(res)
      const row = loadRequest(param(req, 'reference'))
      if (!row) return res.status(404).json({ message: 'طلب الخدمة غير موجود.' })
      if (session.role !== 'SUPER_ADMIN' && !isDeptManager(session, String(row.department_id)))
        return res.status(403).json({ message: 'إسناد الطلبات من صلاحية مدير الدائرة.' })
      if (isClosed(row)) return res.status(409).json({ message: 'الطلب مغلق ولا يمكن إسناده.' })
      const payload = z.object({ staffId: z.string().trim().min(3).max(80) }).safeParse(req.body)
      if (!payload.success) return res.status(400).json({ message: 'اختر الموظف المراد إسناد الطلب إليه.' })
      const target = db
        .prepare(
          `SELECT id, full_name FROM staff_accounts WHERE id = ? AND status = 'ACTIVE' AND role = 'EMPLOYEE' AND department_id = ?`
        )
        .get(payload.data.staffId, String(row.department_id)) as { id: string; full_name: string } | undefined
      if (!target) return res.status(400).json({ message: 'اختر موظفاً فعّالاً من موظفي الدائرة نفسها.' })
      const previous = row.assigned_staff_id ? String(row.assigned_staff_id) : null
      const timestamp = new Date().toISOString()
      const result = db
        .prepare(
          `UPDATE service_requests SET assigned_staff_id = ?, assigned_at = ?
           WHERE id = ? AND department_id = ? AND status NOT IN ('APPROVED', 'REJECTED')`
        )
        .run(target.id, timestamp, Number(row.id), String(row.department_id))
      if (!result.changes) return res.status(409).json({ message: 'تغيّرت حالة الطلب للتو. حدّث القائمة.' })
      addAudit({
        actor: session.actor,
        role: session.role,
        action: 'SERVICE_REQUEST_ASSIGNED',
        entityType: 'ServiceRequest',
        entityId: String(row.reference),
        previousValue: { assignedStaffId: previous },
        newValue: { assignedStaffId: target.id, assignedStaffName: target.full_name },
      })
      publishRequest(row, 'ASSIGNED')
      res.json(serializeServiceRequestForEmployee(loadRequest(String(row.reference))!))
    }
  )

  /** Active employees a request of this department can be assigned to (the manager's assign dropdown). */
  app.get('/api/employee/department-staff', requireSession('EMPLOYEE', 'OPERATIONS', 'SUPER_ADMIN'), (req, res) => {
    const session = currentSession(res)
    const requested = String(req.query.departmentId || '').trim()
    const departmentId = session.role === 'EMPLOYEE' ? session.departmentId : requested || null
    if (session.role === 'EMPLOYEE' && requested && requested !== session.departmentId)
      return res.status(403).json({ message: 'قائمة الموظفين متاحة لدائرتك فقط.' })
    if (!departmentId) return res.json({ items: [] })
    const rows = db
      .prepare(
        `SELECT id, full_name, is_department_manager FROM staff_accounts
         WHERE department_id = ? AND role = 'EMPLOYEE' AND status = 'ACTIVE' ORDER BY full_name`
      )
      .all(departmentId) as Array<{ id: string; full_name: string; is_department_manager: number }>
    res.json({
      items: rows.map(row => ({
        id: row.id,
        fullName: row.full_name,
        isDepartmentManager: Boolean(row.is_department_manager),
      })),
    })
  })

  // ---- employee: referral to the competent department ------------------------------------------------
  app.post(
    '/api/employee/service-requests/:reference/transfer',
    requireSession('EMPLOYEE', 'SUPER_ADMIN'),
    (req, res) => {
      const session = currentSession(res)
      const row = loadRequest(param(req, 'reference'))
      if (!row) return res.status(404).json({ message: 'طلب الخدمة غير موجود.' })
      if (!canActOn(session, row)) return res.status(403).json({ message: 'هذا الطلب يخص دائرة أخرى.' })
      const payload = z
        .object({
          toDepartmentId: z.string().trim().min(2).max(120),
          reason: z.string().trim().min(10).max(500),
        })
        .safeParse(req.body)
      if (!payload.success)
        return res.status(400).json({ message: 'اختر الدائرة المختصة واكتب سبب الإحالة (10 أحرف على الأقل).' })
      if (isClosed(row)) return res.status(409).json({ message: 'الطلب مغلق ولا يمكن إحالته.' })
      if (approvalsInFlight.has(String(row.reference)))
        return res.status(409).json({ message: 'يجري حفظ قرار الموافقة على هذا الطلب الآن؛ لا يمكن إحالته.' })
      const conflict = assignmentConflict(session, row)
      if (conflict) return res.status(409).json({ message: conflict, code: 'ASSIGNED_TO_OTHER' })
      const fromDepartmentId = String(row.department_id)
      if (payload.data.toDepartmentId === fromDepartmentId)
        return res.status(400).json({ message: 'الطلب لدى هذه الدائرة أصلاً. اختر الدائرة المختصة.' })
      const target = departmentById.get(payload.data.toDepartmentId)
      const targetRecord = db.prepare('SELECT id FROM departments WHERE id = ? AND active = 1').get(target?.id || '')
      if (!target || !targetRecord)
        return res.status(404).json({ message: 'الدائرة المختارة غير موجودة في سجل الدوائر.' })
      // a fee is recorded against the department that set it (revenue, receipt, refund): moving the request while
      // it is owed would collect money for one department on a file that now belongs to another
      const openFee = listPaymentsForRequest(Number(row.id)).find(item => item.status !== 'PAID')
      if (String(row.status) === 'PAYMENT_PENDING' || openFee)
        return res.status(409).json({
          message: `لا يمكن إحالة طلب عليه رسم غير مسدد${openFee ? ` (${openFee.reference})` : ''}: الرسم مسجل باسم هذه الدائرة. انتظر السداد، أو ارفض الطلب مع توجيه المواطن للدائرة المختصة.`,
          code: 'OPEN_FEE',
        })
      const timestamp = new Date().toISOString()
      const currentAction = `أُحيل الطلب إلى ${target.name} لأنها الجهة المختصة، وسيُستكمل تدقيقه هناك.`
      db.exec('BEGIN')
      try {
        const moved = db
          .prepare(
            `UPDATE service_requests SET department_id = ?, origin_department_id = COALESCE(origin_department_id, ?),
               assigned_staff_id = NULL, assigned_at = NULL, current_action = ?, updated_at = ?
             WHERE id = ? AND department_id = ? AND status = ?`
          )
          .run(
            target.id,
            fromDepartmentId,
            currentAction,
            timestamp,
            Number(row.id),
            fromDepartmentId,
            String(row.status)
          )
        if (!moved.changes) {
          db.exec('ROLLBACK')
          return res.status(409).json({ message: 'تغيّر الطلب للتو (قرار أو إحالة أخرى). حدّث القائمة.' })
        }
        db.prepare(
          `INSERT INTO service_request_transfers (id, service_request_id, from_department_id, to_department_id, reason, requested_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          `trf_${randomUUID().replaceAll('-', '')}`,
          Number(row.id),
          fromDepartmentId,
          target.id,
          payload.data.reason,
          session.actor,
          timestamp
        )
        // an unconfirmed appointment request now belongs to the new department's calendar
        db.prepare(
          `UPDATE appointments SET department = ?, updated_at = ? WHERE service_request_id = ? AND status = 'REQUESTED'`
        ).run(target.name, timestamp, Number(row.id))
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      notifyCitizen({
        citizenId: Number(row.citizen_id),
        type: 'SERVICE_REQUEST_TRANSFERRED',
        title: 'أُحيل طلبك إلى الدائرة المختصة',
        message: `${String(row.reference)} — أُحيل طلبك إلى ${target.name} لاستكمال معالجته. يبقى رقم المعاملة نفسه وتصلك التحديثات كالمعتاد.`,
        link: '/citizen#my-requests',
      })
      addAudit({
        actor: session.actor,
        role: session.role,
        action: 'SERVICE_REQUEST_TRANSFERRED',
        entityType: 'ServiceRequest',
        entityId: String(row.reference),
        previousValue: {
          departmentId: fromDepartmentId,
          assignedStaffId: row.assigned_staff_id ? String(row.assigned_staff_id) : null,
        },
        newValue: { departmentId: target.id, reason: payload.data.reason },
      })
      // both queues change: it leaves the old department and arrives in the new one
      publishRequest(row, 'TRANSFERRED', fromDepartmentId)
      publishRequest(row, 'TRANSFERRED', target.id)
      res.json(serializeServiceRequestForEmployee(loadRequest(String(row.reference))!))
    }
  )

  /** Referral log of a department: `out` = sent by it, `in` = received by it. */
  app.get('/api/employee/transfers', requireSession('EMPLOYEE', 'OPERATIONS', 'SUPER_ADMIN'), (req, res) => {
    const session = currentSession(res)
    const direction = req.query.direction === 'in' ? 'in' : 'out'
    const departmentId =
      session.role === 'EMPLOYEE' ? session.departmentId : String(req.query.departmentId || '').trim() || null
    if (session.role === 'EMPLOYEE' && !departmentId) return res.json({ direction, items: [] })
    const column = direction === 'in' ? 't.to_department_id' : 't.from_department_id'
    const rows = db
      .prepare(
        `SELECT t.*, sr.reference, sr.status AS request_status, sc.name AS service_name,
           fd.name AS from_department_name, td.name AS to_department_name
         FROM service_request_transfers t JOIN service_requests sr ON sr.id = t.service_request_id
         JOIN service_catalog sc ON sc.id = sr.service_id
         LEFT JOIN departments fd ON fd.id = t.from_department_id LEFT JOIN departments td ON td.id = t.to_department_id
         ${departmentId ? `WHERE ${column} = ?` : ''} ORDER BY t.created_at DESC LIMIT 200`
      )
      .all(...(departmentId ? [departmentId] : [])) as Array<Record<string, unknown>>
    res.json({
      direction,
      items: rows.map(row => ({
        ...mapTransfer(row),
        serviceName: String(row.service_name),
        // the sending department keeps only the reference and current status, not the file itself
        requestStatus: String(row.request_status),
      })),
    })
  })
}
