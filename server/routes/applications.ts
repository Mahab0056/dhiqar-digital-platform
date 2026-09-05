import type express from 'express'
import { param } from '../http/params.js'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { upload, validateUploadedFile } from '../http/upload.js'
import { type SessionData, requireSession, currentCitizen, currentSession } from '../auth/session.js'
import { notifyCitizen, employeeWorkQueueRealtime } from '../realtime.js'
import { addAudit, addEvent, db, getApplicationByReference, getApplications } from '../db.js'
import { storeEncryptedMedia } from '../media.js'
import { createIssuedDocument } from '../issued-documents.js'

export function registerApplicationsRoutes(app: express.Express) {
  app.get(
    '/api/employee/work-queue-summary',
    requireSession('EMPLOYEE', 'IDENTITY_REVIEWER', 'SUPER_ADMIN'),
    (_req, res) => {
      const applications = Number(
        (
          db
            .prepare(`SELECT COUNT(*) AS count FROM applications WHERE status IN ('UNDER_REVIEW', 'SUBMITTED')`)
            .get() as { count: number }
        ).count
      )
      const serviceRequests = Number(
        (
          db
            .prepare(
              `SELECT COUNT(*) AS count FROM service_requests WHERE status IN ('SUBMITTED', 'UNDER_REVIEW', 'REQUESTED', 'APPOINTMENT_REQUESTED')`
            )
            .get() as { count: number }
        ).count
      )
      const identityReviews = Number(
        (
          db.prepare(`SELECT COUNT(*) AS count FROM identity_reviews WHERE status = 'PENDING_REVIEW'`).get() as {
            count: number
          }
        ).count
      )
      res.json({
        applications,
        serviceRequests,
        identityReviews,
        total: applications + serviceRequests + identityReviews,
        generatedAt: new Date().toISOString(),
      })
    }
  )

  app.get('/api/applications', requireSession('EMPLOYEE', 'SUPER_ADMIN'), (_req, res) => res.json(getApplications()))

  app.get('/api/applications/:reference', requireSession('CITIZEN', 'EMPLOYEE', 'SUPER_ADMIN'), (req, res) => {
    const item = getApplicationByReference(param(req, 'reference'))
    if (!item) return res.status(404).json({ message: 'المعاملة غير موجودة.' })
    const session = res.locals.session as SessionData
    if (session.role === 'CITIZEN') {
      const citizen = currentCitizen(res)
      if (!citizen) return
      if (Number(item.citizenId) !== citizen.id) return res.status(404).json({ message: 'المعاملة غير موجودة.' })
      addAudit({
        actor: citizen.fullName,
        role: 'CITIZEN',
        action: 'APPLICATION_VIEW',
        entityType: 'Application',
        entityId: param(req, 'reference'),
        metadata: { maskedCitizenData: true },
      })
    } else {
      addAudit({
        actor: session.sub,
        role: session.role,
        action: 'APPLICATION_VIEW',
        entityType: 'Application',
        entityId: param(req, 'reference'),
        metadata: { maskedCitizenData: true },
      })
    }
    res.json(item)
  })

  app.post(
    '/api/applications',
    requireSession('CITIZEN'),
    upload.fields([
      { name: 'propertyDocument', maxCount: 1 },
      { name: 'storefrontPhoto', maxCount: 1 },
      { name: 'faceVideo', maxCount: 1 },
    ]),
    (req, res) => {
      const payload = z
        .object({
          serviceKey: z.string().min(2),
          serviceName: z.string().min(2),
          department: z.string().min(2),
          businessName: z.string().min(2),
          activityType: z.string().min(2),
          address: z.string().min(4),
          district: z.string().min(2),
          ownershipType: z.enum(['rent', 'owned']),
          coordinates: z.preprocess(
            value => {
              if (typeof value !== 'string') return value
              try {
                return JSON.parse(value)
              } catch {
                return value
              }
            },
            z.object({ lat: z.coerce.number(), lng: z.coerce.number() })
          ),
          fee: z.coerce.number().nonnegative(),
          faceConsent: z.literal('true'),
          attachments: z.array(z.string()).default([]),
        })
        .parse(req.body)
      const citizen = currentCitizen(res)
      if (!citizen) return
      if (!['VERIFIED', 'VERIFIED_MANUAL'].includes(citizen.verificationStatus))
        return res.status(409).json({ message: 'أكمل مراجعة الهوية أولاً قبل تقديم خدمة جديدة.' })
      const files = req.files as Record<string, Express.Multer.File[]> | undefined
      const propertyDocument = files?.propertyDocument?.[0]
      const storefrontPhoto = files?.storefrontPhoto?.[0]
      const faceVideo = files?.faceVideo?.[0]
      const requiredPropertyDocument = payload.ownershipType === 'rent' ? 'عقد الإيجار' : 'سند الملكية'
      if (payload.serviceKey === 'store-license' && (!propertyDocument || !storefrontPhoto))
        return res
          .status(400)
          .json({ message: `يرجى تصوير أو رفع ${requiredPropertyDocument} وصورة واجهة المحل قبل إرسال الطلب.` })
      if (!faceVideo) return res.status(400).json({ message: 'صوّر فيديو توثيق الوجه القصير قبل إرسال الطلب.' })
      if (propertyDocument) validateUploadedFile(propertyDocument, ['image', 'pdf'])
      if (storefrontPhoto) validateUploadedFile(storefrontPhoto, ['image'])
      validateUploadedFile(faceVideo, ['video'])
      const timestamp = new Date().toISOString()
      const serial = String(
        (db.prepare('SELECT COUNT(*) AS count FROM applications').get() as { count: number }).count + 1
      ).padStart(4, '0')
      const reference = `TQD-2026-${serial}`
      const result = db
        .prepare(
          `
      INSERT INTO applications (
        reference, citizen_id, citizen_name, service_key, service_name, department, status,
        current_action, business_name, activity_type, address, district, ownership_type,
        lat, lng, fee, payment_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
        )
        .run(
          reference,
          citizen.id,
          citizen.fullName,
          payload.serviceKey,
          payload.serviceName,
          payload.department,
          'SUBMITTED',
          'لا يوجد إجراء مطلوب منك. المعاملة لدى الموظف المختص.',
          payload.businessName,
          payload.activityType,
          payload.address,
          payload.district,
          payload.ownershipType,
          payload.coordinates.lat,
          payload.coordinates.lng,
          payload.fee,
          payload.fee > 0 ? 'PENDING' : 'NOT_REQUIRED',
          timestamp,
          timestamp
        )
      const applicationId = Number(result.lastInsertRowid)
      const protectedFiles: Array<{
        file: Express.Multer.File
        purpose: 'APPLICATION_DOCUMENT' | 'STOREFRONT_PHOTO' | 'FACE_VIDEO'
        label: string
      }> = []
      if (propertyDocument)
        protectedFiles.push({
          file: propertyDocument,
          purpose: 'APPLICATION_DOCUMENT',
          label: requiredPropertyDocument,
        })
      if (storefrontPhoto)
        protectedFiles.push({ file: storefrontPhoto, purpose: 'STOREFRONT_PHOTO', label: 'صورة واجهة المحل' })
      protectedFiles.push({ file: faceVideo, purpose: 'FACE_VIDEO', label: 'فيديو توثيق الوجه قبل الإرسال' })
      for (const item of protectedFiles) {
        const media = storeEncryptedMedia({
          citizenId: citizen.id,
          purpose: item.purpose,
          originalName: item.file.originalname || item.label,
          mimeType: item.file.mimetype,
          buffer: item.file.buffer,
          retentionHours: 24 * 30,
        })
        db.prepare(
          'INSERT INTO application_media (id, application_id, media_id, label, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(`appmedia_${randomUUID().replaceAll('-', '')}`, applicationId, media.id, item.label, timestamp)
      }
      addEvent(applicationId, {
        type: 'APPLICATION_CREATED',
        title: 'تم التقديم',
        description: 'استلمت المنصة الطلب والمرفقات المشفرة وسجلته للتدقيق.',
        actor: 'المواطن',
      })
      addEvent(applicationId, {
        type: 'ROUTED',
        title: 'تم التوجيه إلى الدائرة',
        description: `تم توجيه الطلب آلياً إلى ${payload.department}.`,
        actor: 'محرك سير العمل',
      })
      notifyCitizen({
        citizenId: citizen.id,
        type: 'APPLICATION_CREATED',
        title: 'تم تسجيل المعاملة',
        message: `سُجل طلب ${payload.serviceName} بالرقم ${reference} ووُجه إلى ${payload.department}.`,
        link: `/citizen/application/${reference}`,
      })
      employeeWorkQueueRealtime.publish({ entity: 'APPLICATION', action: 'CREATED', reference })
      addAudit({
        actor: citizen.fullName,
        role: 'CITIZEN',
        action: 'APPLICATION_CREATED',
        entityType: 'Application',
        entityId: reference,
        newValue: { service: payload.serviceKey, district: payload.district },
        metadata: {
          protectedAttachments: protectedFiles.map(file => file.label),
          retentionDays: 30,
          faceConsent: true,
        },
      })
      res.status(201).json(getApplicationByReference(reference))
    }
  )

  app.post('/api/applications/:reference/request-document', requireSession('EMPLOYEE', 'SUPER_ADMIN'), (req, res) => {
    const session = currentSession(res)
    const payload = z.object({ documentName: z.string().min(2) }).parse(req.body)
    const item = getApplicationByReference(param(req, 'reference'))
    if (!item) return res.status(404).json({ message: 'المعاملة غير موجودة.' })
    const timestamp = new Date().toISOString()
    db.prepare(
      `UPDATE applications SET status = 'ACTION_REQUIRED', current_action = ?, required_document = ?, updated_at = ? WHERE reference = ?`
    ).run(`يرجى رفع ${payload.documentName} لإكمال التدقيق.`, payload.documentName, timestamp, param(req, 'reference'))
    addEvent(item.id as number, {
      type: 'INFORMATION_REQUESTED',
      title: 'طلب معلومات إضافية',
      description: `طلب الموظف رفع ${payload.documentName}.`,
      actor: session.actor,
    })
    notifyCitizen({
      citizenId: Number(item.citizenId),
      type: 'ACTION_REQUIRED',
      title: 'مطلوب مستند إضافي',
      message: `ارفع ${payload.documentName} لإكمال تدقيق المعاملة ${param(req, 'reference')}.`,
      link: `/citizen/application/${param(req, 'reference')}`,
    })
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'DOCUMENT_REQUESTED',
      entityType: 'Application',
      entityId: param(req, 'reference'),
      previousValue: { status: item.status },
      newValue: { status: 'ACTION_REQUIRED', document: payload.documentName },
    })
    res.json(getApplicationByReference(param(req, 'reference')))
  })

  app.post(
    '/api/applications/:reference/upload-document',
    requireSession('CITIZEN'),
    upload.single('document'),
    (req, res) => {
      const payload = z
        .object({
          documentName: z.string().min(2),
          documentPurpose: z.enum(['APPLICATION_DOCUMENT', 'FACE_VIDEO']).default('APPLICATION_DOCUMENT'),
        })
        .parse(req.body)
      const citizen = currentCitizen(res)
      if (!citizen) return
      const item = getApplicationByReference(param(req, 'reference'))
      if (!item || Number(item.citizenId) !== citizen.id)
        return res.status(404).json({ message: 'المعاملة غير موجودة.' })
      if (!req.file) return res.status(400).json({ message: `صوّر أو ارفع ${payload.documentName} قبل الإرسال.` })
      if (payload.documentPurpose === 'FACE_VIDEO') validateUploadedFile(req.file, ['video'])
      else validateUploadedFile(req.file, ['image', 'pdf'])
      const timestamp = new Date().toISOString()
      const media = storeEncryptedMedia({
        citizenId: citizen.id,
        purpose: payload.documentPurpose,
        originalName: req.file.originalname || payload.documentName,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
        retentionHours: 24 * 30,
      })
      db.prepare(
        'INSERT INTO application_media (id, application_id, media_id, label, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(
        `appmedia_${randomUUID().replaceAll('-', '')}`,
        item.id as number,
        media.id,
        payload.documentName,
        timestamp
      )
      db.prepare(
        `UPDATE applications SET status = 'UNDER_REVIEW', current_action = 'لا يوجد إجراء مطلوب منك. تم استلام المستند وأعيدت المعاملة للموظف المختص.', required_document = NULL, updated_at = ? WHERE reference = ?`
      ).run(timestamp, param(req, 'reference'))
      addEvent(item.id as number, {
        type: 'DOCUMENT_UPLOADED',
        title: 'تم استكمال المعلومات',
        description: `رفع المواطن ${payload.documentName} بشكل مشفر وأعيدت المعاملة إلى التدقيق.`,
        actor: 'المواطن',
      })
      notifyCitizen({
        citizenId: Number(item.citizenId),
        type: 'DOCUMENT_RECEIVED',
        title: 'تم استلام المستند',
        message: `استلمت المنصة ${payload.documentName} وأعادت المعاملة إلى الموظف المختص.`,
        link: `/citizen/application/${param(req, 'reference')}`,
      })
      employeeWorkQueueRealtime.publish({
        entity: 'APPLICATION',
        action: 'UPDATED',
        reference: param(req, 'reference'),
      })
      addAudit({
        actor: citizen.fullName,
        role: 'CITIZEN',
        action: 'MISSING_DOCUMENT_UPLOADED',
        entityType: 'Application',
        entityId: param(req, 'reference'),
        previousValue: { status: item.status },
        newValue: { status: 'UNDER_REVIEW', document: payload.documentName },
        metadata: { protectedMediaId: media.id, retentionDays: 30 },
      })
      res.json(getApplicationByReference(param(req, 'reference')))
    }
  )

  app.post('/api/applications/:reference/approve', requireSession('EMPLOYEE', 'SUPER_ADMIN'), async (req, res) => {
    const session = currentSession(res)
    const item = getApplicationByReference(param(req, 'reference'))
    if (!item) return res.status(404).json({ message: 'المعاملة غير موجودة.' })
    if (item.status === 'ACTION_REQUIRED')
      return res.status(409).json({ message: 'لا يمكن الموافقة قبل استكمال المستند المطلوب.' })
    if (item.status === 'APPROVED') return res.json(item)
    const faceVideo = db
      .prepare(
        `SELECT mo.id FROM application_media am JOIN media_objects mo ON mo.id = am.media_id WHERE am.application_id = ? AND mo.purpose = 'FACE_VIDEO' AND mo.deleted_at IS NULL LIMIT 1`
      )
      .get(item.id as number)
    if (!faceVideo)
      return res.status(409).json({
        message: 'لا يمكن اعتماد المعاملة قبل استكمال فيديو توثيق الوجه. استخدم «طلب استكمال التوثيق» لإشعار المواطن.',
      })
    const timestamp = new Date().toISOString()
    if ((item.fee as number) > 0) {
      db.prepare(
        `UPDATE applications SET status = 'PAYMENT_REQUIRED', current_action = 'تمت الموافقة الإدارية. بانتظار تهيئة بوابة الدفع المعتمدة لإكمال سداد الرسم وإصدار الوثيقة.', payment_status = 'PENDING', updated_at = ? WHERE reference = ?`
      ).run(timestamp, param(req, 'reference'))
      addEvent(item.id as number, {
        type: 'PAYMENT_REQUIRED',
        title: 'بانتظار الدفع',
        description: `رسم الخدمة ${item.fee} د.ع. لا يُسجل دفع ولا تصدر وثيقة حتى عودة بوابة الدفع المعتمدة.`,
        actor: 'محرك سير العمل',
      })
      notifyCitizen({
        citizenId: Number(item.citizenId),
        type: 'PAYMENT_REQUIRED',
        title: 'المعاملة بانتظار الدفع',
        message: `تمت الموافقة الإدارية على ${param(req, 'reference')}. سيُفتح الدفع عند ربط بوابة الدفع المعتمدة.`,
        link: `/citizen/application/${param(req, 'reference')}`,
      })
      addAudit({
        actor: session.actor,
        role: session.role,
        action: 'PAYMENT_REQUIRED',
        entityType: 'Application',
        entityId: param(req, 'reference'),
        previousValue: { status: item.status },
        newValue: { status: 'PAYMENT_REQUIRED' },
        metadata: { fee: item.fee, providerConfigured: false },
      })
      return res.json(getApplicationByReference(param(req, 'reference')))
    }
    const issuedDocument = await createIssuedDocument({
      sourceKind: 'APPLICATION',
      applicationReference: String(item.reference),
      citizenId: Number(item.citizenId),
      citizenName: String(item.citizenName),
      serviceName: String(item.serviceName),
      departmentName: String(item.department),
      documentTitle: `إجازة ممارسة نشاط تجاري — ${String(item.businessName)}`,
      issuedBy: session.actor,
      issuedAt: timestamp,
      preferredDocumentNumber: `LIC-${new Date().getFullYear()}-${String(item.id).padStart(5, '0')}`,
      details: [
        { label: 'اسم المحل', value: String(item.businessName || '') },
        { label: 'نوع النشاط', value: String(item.activityType || '') },
        { label: 'القضاء', value: String(item.district || '') },
        { label: 'نوع الإشغال', value: String(item.ownershipType || '') },
      ],
    })
    const documentNumber = issuedDocument.documentNumber
    const verificationId = issuedDocument.verificationId
    db.exec('BEGIN')
    try {
      db.prepare(
        `UPDATE applications SET status = 'APPROVED', current_action = 'اكتملت المعاملة. يمكنك تحميل الوثيقة والتحقق منها عبر QR.', payment_status = 'NOT_REQUIRED', document_number = ?, verification_id = ?, updated_at = ? WHERE reference = ?`
      ).run(documentNumber, verificationId, timestamp, param(req, 'reference'))
      addEvent(item.id as number, {
        type: 'APPROVED',
        title: 'تمت الموافقة',
        description: 'اعتمد الموظف المختص الطلب.',
        actor: session.actor,
      })
      addEvent(item.id as number, {
        type: 'DOCUMENT_ISSUED',
        title: 'تم إصدار الوثيقة المؤرشفة',
        description: `أُنشئت الوثيقة ${documentNumber} ومعرّف التحقق الرقمي وحُفظ PDF الأصلي مشفراً في الأرشيف.`,
        actor: 'نظام الوثائق الرقمية',
      })
      notifyCitizen({
        citizenId: Number(item.citizenId),
        type: 'DOCUMENT_ISSUED',
        title: 'وثيقتك جاهزة للعرض والتنزيل',
        message: `صدرت الوثيقة ${documentNumber}. افتح المعاملة لمعاينة PDF أو تنزيله أو التحقق منه عبر QR.`,
        link: `/citizen/application/${param(req, 'reference')}`,
      })
      addAudit({
        actor: session.actor,
        role: session.role,
        action: 'APPLICATION_APPROVED_DOCUMENT_ISSUED',
        entityType: 'Application',
        entityId: param(req, 'reference'),
        previousValue: { status: item.status },
        newValue: { status: 'APPROVED', documentNumber, verificationId },
        metadata: { paymentRecorded: false, qrVerification: true, issuedDocumentId: issuedDocument.id },
      })
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    res.json(getApplicationByReference(param(req, 'reference')))
  })
}
