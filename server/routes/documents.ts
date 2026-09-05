import type express from 'express'
import { param } from '../http/params.js'
import { type SessionData, requireSession, currentCitizen } from '../auth/session.js'
import { addAudit, getApplicationByVerificationId } from '../db.js'
import { readDecryptedMedia } from '../media.js'
import {
  getIssuedDocumentByVerificationId,
  getIssuedDocumentForCitizen,
  getIssuedDocumentForEmployee,
  listIssuedDocumentsForCitizen,
  listIssuedDocumentsForEmployee,
} from '../issued-documents.js'

function sendIssuedPdf(res: express.Response, row: Record<string, unknown>, download = false) {
  const media = readDecryptedMedia(String(row.pdf_media_id))
  if (!media || media.mimeType !== 'application/pdf')
    return res.status(404).json({ message: 'ملف PDF الأصلي غير متاح في الأرشيف.' })
  const filename = `${String(row.document_number).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  return res.send(media.buffer)
}

export function registerDocumentsRoutes(app: express.Express) {
  app.get('/api/citizen/issued-documents', requireSession('CITIZEN'), (_req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    res.json(
      listIssuedDocumentsForCitizen(citizen.id).map(row => ({
        id: String(row.id),
        sourceKind: String(row.source_kind),
        applicationReference: row.application_reference ? String(row.application_reference) : null,
        serviceRequestReference: row.service_request_reference ? String(row.service_request_reference) : null,
        serviceName: String(row.service_name),
        departmentName: String(row.department_name),
        documentTitle: String(row.document_title),
        documentNumber: String(row.document_number),
        verificationId: String(row.verification_id),
        status: String(row.status),
        issuedAt: String(row.issued_at),
        pdfUrl: `/api/citizen/issued-documents/${String(row.id)}/pdf`,
        pdfDownloadUrl: `/api/citizen/issued-documents/${String(row.id)}/pdf?download=1`,
      }))
    )
  })

  app.get('/api/citizen/issued-documents/:id/pdf', requireSession('CITIZEN'), (req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    const row = getIssuedDocumentForCitizen(param(req, 'id'), citizen.id)
    if (!row) return res.status(404).json({ message: 'الوثيقة غير موجودة ضمن حسابك.' })
    addAudit({
      actor: citizen.fullName,
      role: 'CITIZEN',
      action: 'ISSUED_DOCUMENT_OPENED',
      entityType: 'IssuedDocument',
      entityId: String(row.id),
    })
    return sendIssuedPdf(res, row, req.query.download === '1')
  })

  app.get('/api/employee/issued-documents', requireSession('EMPLOYEE', 'SUPER_ADMIN'), (_req, res) => {
    res.json(
      listIssuedDocumentsForEmployee().map(row => ({
        id: String(row.id),
        sourceKind: String(row.source_kind),
        applicationReference: row.application_reference ? String(row.application_reference) : null,
        serviceRequestReference: row.service_request_reference ? String(row.service_request_reference) : null,
        serviceName: String(row.service_name),
        departmentName: String(row.department_name),
        documentTitle: String(row.document_title),
        documentNumber: String(row.document_number),
        verificationId: String(row.verification_id),
        status: String(row.status),
        issuedAt: String(row.issued_at),
        pdfUrl: `/api/employee/issued-documents/${String(row.id)}/pdf`,
      }))
    )
  })

  app.get('/api/employee/issued-documents/:id/pdf', requireSession('EMPLOYEE', 'SUPER_ADMIN'), (req, res) => {
    const row = getIssuedDocumentForEmployee(param(req, 'id'))
    if (!row) return res.status(404).json({ message: 'الوثيقة المؤرشفة غير موجودة.' })
    const session = res.locals.session as SessionData
    addAudit({
      actor: session.role === 'SUPER_ADMIN' ? 'مدير النظام' : 'موظف مختص',
      role: session.role,
      action: 'ISSUED_DOCUMENT_OPENED',
      entityType: 'IssuedDocument',
      entityId: String(row.id),
    })
    return sendIssuedPdf(res, row)
  })

  app.get('/api/verify/:verificationId/original-pdf', (req, res) => {
    const row = getIssuedDocumentByVerificationId(param(req, 'verificationId'))
    if (!row || row.status !== 'ACTIVE') return res.status(404).json({ message: 'لا يوجد ملف PDF فعال بهذا المعرّف.' })
    addAudit({
      actor: 'Public Verification',
      role: 'PUBLIC',
      action: 'ISSUED_DOCUMENT_ORIGINAL_OPENED',
      entityType: 'IssuedDocument',
      entityId: String(row.id),
      metadata: { verificationId: param(req, 'verificationId') },
    })
    return sendIssuedPdf(res, row)
  })

  app.get('/api/verify/:verificationId', (req, res) => {
    const issued = getIssuedDocumentByVerificationId(param(req, 'verificationId'))
    if (issued && issued.status === 'ACTIVE') {
      addAudit({
        actor: 'Public Verification',
        role: 'PUBLIC',
        action: 'ISSUED_DOCUMENT_VERIFIED',
        entityType: 'IssuedDocument',
        entityId: String(issued.id),
        metadata: { exposedFields: 'document-minimum' },
      })
      return res.json({
        reference: issued.application_reference || issued.service_request_reference,
        citizenName: issued.citizen_name,
        serviceName: issued.service_name,
        department: issued.department_name,
        documentTitle: issued.document_title,
        documentNumber: issued.document_number,
        verificationId: issued.verification_id,
        status: 'APPROVED',
        issuedAt: issued.issued_at,
        updatedAt: issued.updated_at,
        originalPdfUrl: `/api/verify/${param(req, 'verificationId')}/original-pdf`,
        pdfAvailable: true,
      })
    }
    const item = getApplicationByVerificationId(param(req, 'verificationId'))
    if (!item) return res.status(404).json({ message: 'لم يتم العثور على وثيقة صادرة بهذا المعرّف.' })
    addAudit({
      actor: 'Public Verification',
      role: 'PUBLIC',
      action: 'DOCUMENT_VERIFIED',
      entityType: 'Document',
      entityId: param(req, 'verificationId'),
      metadata: { exposedFields: 'minimal', archivedPdf: false },
    })
    return res.json({ ...item, pdfAvailable: false, originalPdfUrl: null })
  })
}
