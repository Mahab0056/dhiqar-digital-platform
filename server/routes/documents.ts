import type express from 'express'
import { z } from 'zod'
import { departmentById, departmentRegistry } from '../department-registry.js'
import { param } from '../http/params.js'
import { type SessionData, requireSession, currentCitizen, isDeptManager } from '../auth/session.js'
import { addAudit, addEvent, db, getApplicationByVerificationId } from '../db.js'
import { readDecryptedMedia } from '../media.js'
import { notifyCitizen } from '../realtime.js'
import {
  getIssuedDocumentByDocKey,
  getIssuedDocumentByVerificationId,
  getIssuedDocumentForCitizen,
  getIssuedDocumentForEmployee,
  issuedRecordIntact,
  listIssuedDocumentsForCitizen,
  listIssuedDocumentsForEmployee,
  placeFromForm,
  renderIssuancePreview,
  revokeIssuedDocument,
} from '../issued-documents.js'
import { getCatalogService, listCatalogServices, type CatalogService } from '../services/catalog.js'
import { citizenRequestLink, serviceIssuesDocument } from './service-requests.js'
import { renderDocumentPdf } from '../documents/render.js'
import { sampleModel } from '../documents/samples.js'
import {
  deleteAssignment,
  departmentNameOf,
  maskHolderName,
  resolveDocumentPlan,
  saveAssignment,
} from '../documents/store.js'
import {
  documentTemplates,
  isIssuableTemplate,
  templateById,
  templateCategoryLabels,
  templateFamilyLabels,
  templateFieldLabels,
} from '../documents/templates.js'
import { canonicalDigest, parseVerificationCode, sha256Hex, verifyParsedCode } from '../documents/token.js'
import {
  documentKindLabels,
  documentKindOf,
  validityLabels,
  verificationStatusOf,
  type DocumentValidity,
} from '../documents/verify-labels.js'

/** PDFs served to our own pages may be framed by them (helmet's global CSP forbids framing everything else). */
function pdfHeaders(res: express.Response, filename: string, download = false, cache = 'private, no-store') {
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}"`)
  res.setHeader('Cache-Control', cache)
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'")
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
}

function sendIssuedPdf(res: express.Response, row: Record<string, unknown>, download = false) {
  const media = readDecryptedMedia(String(row.pdf_media_id))
  if (!media || media.mimeType !== 'application/pdf')
    return res.status(404).json({ message: 'ملف PDF الأصلي غير متاح في الأرشيف.' })
  // the archived bytes must still be the ones issued (their SHA-256 is part of the sealed record)
  if (row.pdf_sha256 && sha256Hex(media.buffer) !== String(row.pdf_sha256))
    return res.status(409).json({ message: 'ملف PDF المؤرشف لا يطابق بصمة الوثيقة الصادرة. راجع الجهة المصدرة.' })
  pdfHeaders(res, `${String(row.document_number).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`, download)
  return res.send(media.buffer)
}

const STAFF = ['EMPLOYEE', 'SUPER_ADMIN'] as const

/** Department a staff session may read: super admin any (or the requested one), employees only their own. */
function readableDepartment(session: SessionData, requested?: string | null) {
  if (session.role === 'SUPER_ADMIN') return requested && departmentById.has(requested) ? requested : null
  return session.departmentId && (!requested || requested === session.departmentId) ? session.departmentId : null
}
const canEditDepartment = (session: SessionData, departmentId: string) =>
  session.role === 'SUPER_ADMIN' || isDeptManager(session, departmentId)

const templateView = (id: string) => {
  const template = templateById.get(id)
  if (!template) return null
  return {
    id: template.id,
    title: template.title,
    titleEn: template.titleEn,
    category: template.category,
    categoryLabel: templateCategoryLabels[template.category],
    family: template.family,
    familyLabel: templateFamilyLabels[template.family],
    description: template.description,
    fields: template.fields.map(field => ({ key: field, label: templateFieldLabels[field] })),
    defaultValidityDays: template.defaultValidityDays,
    defaultSignerTitle: template.defaultSignerTitle,
    defaultConditions: template.defaultConditions,
    thumbnailUrl: `/document-templates/${template.id}.webp`,
    sampleUrl: `/api/documents/templates/${template.id}/sample.pdf`,
    /** false: shown in the gallery only, never issued on approval nor assignable */
    issuable: isIssuableTemplate(template),
    /** assignable only to services that require the citizen's attendance (issued with the appointment) */
    requiresAppointment: Boolean(template.requiresAppointment),
  }
}

const sampleCache = new Map<string, Buffer>()

/**
 * Template-editor previews by their inputs. Sample data is deterministic, so the same inputs always give the same
 * PDF: the editor re-requesting a state it already showed (undo, retyping) — or several staff previewing the same
 * assignment — costs no new render, and concurrent identical requests share one render. Bounded (LRU).
 */
const previewCache = new Map<string, Promise<Buffer>>()
const PREVIEW_CACHE_MAX = 32
function cachedPreview(key: string, render: () => Promise<Buffer>) {
  const hit = previewCache.get(key)
  if (hit) {
    previewCache.delete(key)
    previewCache.set(key, hit)
    return hit
  }
  const pending = render()
  pending.catch(() => previewCache.delete(key))
  previewCache.set(key, pending)
  while (previewCache.size > PREVIEW_CACHE_MAX) previewCache.delete(previewCache.keys().next().value as string)
  return pending
}

const needsAttendance = (service: Pick<CatalogService, 'channel'>) => service.channel === 'APPOINTMENT_REQUIRED'

/** Why a template cannot be assigned to this service (null = it can). */
function assignmentProblem(templateId: string, service: Pick<CatalogService, 'channel'>) {
  const template = templateById.get(templateId)
  if (!template) return 'نوع الوثيقة غير معروف.'
  if (!isIssuableTemplate(template))
    return `«${template.title}» لا يصدر عند الموافقة على الطلب، فلا يمكن تعيينه وثيقةً للخدمة.`
  if (template.requiresAppointment && !needsAttendance(service))
    return `«${template.title}» يتطلب موعد حضور، وهذه الخدمة لا تتطلب حضور المواطن.`
  return null
}

const assignmentSchema = z.object({
  templateId: z.string().refine(value => templateById.has(value), 'نوع الوثيقة غير معروف.'),
  customTitle: z.string().trim().max(90).nullish(),
  customConditions: z.array(z.string().trim().min(3).max(300)).max(6).nullish(),
  validityDays: z.number().int().min(0).max(3650).nullish(),
  signerTitle: z.string().trim().max(80).nullish(),
  /** optional named signer printed under the title (null/"" clears it; omitted keeps the saved one) */
  signerName: z.string().trim().max(80).nullish(),
})

/**
 * The request/application a document belongs to: its own source reference for an approval document, the linked
 * request (related_reference) for an event document (receipt, rejection decision, referral letter).
 */
const sourceReferences = (row: Record<string, unknown>) => {
  const related = row.related_reference ? String(row.related_reference) : null
  const event = row.issue_event ? String(row.issue_event) : null
  return {
    applicationReference: row.application_reference
      ? String(row.application_reference)
      : event && row.source_kind === 'APPLICATION'
        ? related
        : null,
    serviceRequestReference: row.service_request_reference
      ? String(row.service_request_reference)
      : event && row.source_kind === 'SERVICE_REQUEST'
        ? related
        : null,
    /** null = issued on approval; RECEIPT | REJECTION | REFERRAL = issued by that event of the request */
    issueEvent: event,
  }
}

/**
 * Verification answer: only what a verifier needs; never the national ID beyond its last four digits. The status
 * is neutral (validity + the document's kind): a rejection decision or a referral letter is never «APPROVED».
 */
function verificationView(row: Record<string, unknown>, code: string, signatureValid: boolean) {
  const expired = row.expires_at ? Date.parse(String(row.expires_at)) < Date.now() : false
  const revoked = row.status !== 'ACTIVE'
  const template = row.template_id ? templateById.get(String(row.template_id)) : undefined
  const source = sourceReferences(row)
  const validity: DocumentValidity = revoked ? 'REVOKED' : expired ? 'EXPIRED' : 'VALID'
  const kind = documentKindOf(source.issueEvent, template?.id)
  return {
    reference: source.applicationReference || source.serviceRequestReference,
    citizenName: maskHolderName(String(row.citizen_name || '')),
    holderIdLast4: row.holder_id_last4 ? String(row.holder_id_last4) : null,
    serviceName: row.service_name,
    department: row.department_name,
    documentTitle: row.document_title,
    templateId: template?.id || null,
    templateTitle: template?.title || null,
    /** APPROVAL | RECEIPT | REJECTION | REFERRAL — what the document records */
    documentKind: kind,
    /** «وثيقة معتمدة» only for an approval document; otherwise «قرار رفض» / «كتاب إحالة» / «وصل استلام» */
    documentKindLabel: documentKindLabels[kind],
    documentNumber: row.document_number,
    verificationId: code,
    status: verificationStatusOf(kind, validity),
    validity,
    /** «سارية» / «منتهية» / «ملغاة» */
    validityLabel: validityLabels[validity],
    issuedAt: row.issued_at,
    expiresAt: row.expires_at || null,
    revokedAt: revoked ? row.revoked_at || row.updated_at : null,
    revokedReason: revoked ? row.revoked_reason || null : null,
    updatedAt: row.updated_at,
    signatureValid,
    pdfSha256: row.pdf_sha256 || null,
    originalPdfUrl: revoked ? null : `/api/verify/${encodeURIComponent(code)}/original-pdf`,
    pdfAvailable: !revoked,
  }
}

/**
 * A revocation reaches the holder: an in-app + push notification, and the status line of the request/application
 * they follow (plus the application timeline), so a revoked licence never keeps reading as valid on their side.
 * An event document (receipt, rejection decision, referral letter) is announced by notification only: its request
 * goes on (or stays decided), so its status line is left as the department wrote it.
 */
function announceRevocation(row: Record<string, unknown>, reason: string, actor: string) {
  // passive, so it reads right for every issuer («ديوان…», «مديرية…», «مستشفى…») whatever its grammatical gender
  const text = `أُلغيت الوثيقة ${String(row.document_number)} (${String(row.document_title)}) من قِبل ${String(row.department_name)} ولم تعد نافذة — السبب: ${reason}`
  const timestamp = new Date().toISOString()
  let link: string | undefined
  const source = sourceReferences(row)
  if (source.issueEvent) {
    if (source.serviceRequestReference) link = citizenRequestLink(source.serviceRequestReference)
    else if (source.applicationReference)
      link = `/citizen/application/${encodeURIComponent(source.applicationReference)}`
  } else if (row.source_kind === 'APPLICATION' && row.application_reference) {
    const reference = String(row.application_reference)
    link = `/citizen/application/${encodeURIComponent(reference)}`
    const application = db.prepare('SELECT id FROM applications WHERE reference = ?').get(reference) as
      { id: number } | undefined
    if (application) {
      db.prepare('UPDATE applications SET current_action = ?, updated_at = ? WHERE id = ?').run(
        `${text}.`,
        timestamp,
        application.id
      )
      addEvent(Number(application.id), {
        type: 'DOCUMENT_REVOKED',
        title: 'أُلغيت الوثيقة الصادرة',
        description: `${text}.`,
        actor,
      })
    }
  } else if (row.service_request_reference) {
    const reference = String(row.service_request_reference)
    link = citizenRequestLink(reference)
    db.prepare('UPDATE service_requests SET current_action = ?, updated_at = ? WHERE reference = ?').run(
      `${text}.`,
      timestamp,
      reference
    )
  }
  notifyCitizen({
    citizenId: Number(row.citizen_id),
    type: 'DOCUMENT_REVOKED',
    title: 'أُلغيت وثيقة صادرة لك',
    message: `${text}. لا تعتمد عليها بعد الآن.`,
    link,
  })
}

type Resolved = { row: Record<string, unknown>; signed: boolean } | { invalid: true } | null

/** Finds the issued document behind a QR token / manual code / legacy id; signed codes must match their HMAC. */
function resolveCode(code: string): Resolved {
  const parsed = parseVerificationCode(code)
  if (parsed.kind === 'invalid') return { invalid: true }
  if (parsed.kind === 'token' || parsed.kind === 'manual') {
    const row = getIssuedDocumentByDocKey(parsed.docKey)
    if (!row) return parsed.kind === 'manual' ? legacy(code) : { invalid: true }
    const digest = canonicalDigest({
      docKey: String(row.doc_key),
      documentNumber: String(row.document_number),
      templateId: String(row.template_id || ''),
      departmentId: String(row.department_id || ''),
      issuedAt: String(row.issued_at),
      expiresAt: row.expires_at ? String(row.expires_at) : null,
      holderDigest: String(row.holder_digest || ''),
    })
    const keyId = row.signing_key_id ? String(row.signing_key_id) : null
    // the code must match its signature AND the stored record must be exactly as issued (record HMAC)
    return verifyParsedCode(parsed, String(row.doc_key), digest, keyId) && issuedRecordIntact(row)
      ? { row, signed: true }
      : { invalid: true }
  }
  return legacy(parsed.value)
}
function legacy(value: string): Resolved {
  const row = getIssuedDocumentByVerificationId(value)
  // documents issued with a signed code can only be verified through that code
  if (!row || row.doc_key) return null
  return { row, signed: false }
}

export function registerDocumentsRoutes(app: express.Express) {
  app.get('/api/citizen/issued-documents', requireSession('CITIZEN'), (_req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    res.json(
      listIssuedDocumentsForCitizen(citizen.id).map(row => ({
        id: String(row.id),
        sourceKind: String(row.source_kind),
        ...sourceReferences(row),
        serviceName: String(row.service_name),
        departmentName: String(row.department_name),
        documentTitle: String(row.document_title),
        documentNumber: String(row.document_number),
        verificationId: String(row.verification_id),
        status: String(row.status),
        issuedAt: String(row.issued_at),
        expiresAt: row.expires_at ? String(row.expires_at) : null,
        revokedAt: row.status === 'REVOKED' && row.revoked_at ? String(row.revoked_at) : null,
        revokedReason: row.status === 'REVOKED' && row.revoked_reason ? String(row.revoked_reason) : null,
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
    // A revoked document's archived PDF carries no revocation mark: handed out, it reads as valid. Like the public
    // original-pdf link (gone once revoked), the citizen's copy stops being served; /verify shows it as «ملغاة».
    if (row.status !== 'ACTIVE') {
      addAudit({
        actor: citizen.fullName,
        role: 'CITIZEN',
        action: 'REVOKED_DOCUMENT_PDF_REFUSED',
        entityType: 'IssuedDocument',
        entityId: String(row.id),
      })
      return res.status(410).json({
        code: 'DOCUMENT_REVOKED',
        message:
          'أُلغيت هذه الوثيقة ولم تعد نافذة، فلا تُتاح نسختها للمعاينة أو التنزيل. تحقق من حالتها عبر صفحة التحقق.',
      })
    }
    addAudit({
      actor: citizen.fullName,
      role: 'CITIZEN',
      action: 'ISSUED_DOCUMENT_OPENED',
      entityType: 'IssuedDocument',
      entityId: String(row.id),
    })
    return sendIssuedPdf(res, row, req.query.download === '1')
  })

  const issuedScope = (session: SessionData) => {
    if (session.role === 'SUPER_ADMIN') return undefined
    const name = session.departmentId ? departmentById.get(session.departmentId)?.name : undefined
    return name ? { departmentName: name, departmentId: session.departmentId } : null
  }

  // one page of the register (?q= searches all of it server-side; ?limit=&offset= page through it)
  app.get('/api/employee/issued-documents', requireSession(...STAFF), (req, res) => {
    const scope = issuedScope(res.locals.session as SessionData)
    if (scope === null) return res.json([])
    const query = req.query as Record<string, unknown>
    res.json(
      listIssuedDocumentsForEmployee(scope, {
        query: typeof query.q === 'string' ? query.q : null,
        limit: Number(query.limit) || null,
        offset: Number(query.offset) || null,
      }).map(row => ({
        id: String(row.id),
        sourceKind: String(row.source_kind),
        ...sourceReferences(row),
        serviceName: String(row.service_name),
        departmentName: String(row.department_name),
        documentTitle: String(row.document_title),
        documentNumber: String(row.document_number),
        verificationId: String(row.verification_id),
        status: String(row.status),
        issuedAt: String(row.issued_at),
        templateId: row.template_id ? String(row.template_id) : null,
        expiresAt: row.expires_at ? String(row.expires_at) : null,
        revokedAt: row.revoked_at ? String(row.revoked_at) : null,
        revokedReason: row.revoked_reason ? String(row.revoked_reason) : null,
        citizenName: String(row.citizen_name || ''),
        pdfUrl: `/api/employee/issued-documents/${String(row.id)}/pdf`,
      }))
    )
  })

  app.get('/api/employee/issued-documents/:id/pdf', requireSession(...STAFF), (req, res) => {
    const session = res.locals.session as SessionData
    const scope = issuedScope(session)
    const row = scope === null ? undefined : getIssuedDocumentForEmployee(param(req, 'id'), scope)
    if (!row) return res.status(404).json({ message: 'الوثيقة المؤرشفة غير موجودة.' })
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'ISSUED_DOCUMENT_OPENED',
      entityType: 'IssuedDocument',
      entityId: String(row.id),
    })
    return sendIssuedPdf(res, row)
  })

  // revocation: staff of the issuing department (or the super admin), with a reason, audited
  app.post('/api/employee/issued-documents/:id/revoke', requireSession(...STAFF), (req, res) => {
    const session = res.locals.session as SessionData
    const scope = issuedScope(session)
    const row = scope === null ? undefined : getIssuedDocumentForEmployee(param(req, 'id'), scope)
    if (!row) return res.status(404).json({ message: 'الوثيقة غير موجودة ضمن دائرتك.' })
    const reason = String((req.body as { reason?: unknown })?.reason || '').trim()
    if (reason.length < 5) return res.status(400).json({ message: 'اكتب سبب الإلغاء (5 أحرف على الأقل).' })
    if (row.status !== 'ACTIVE') return res.status(409).json({ message: 'الوثيقة ملغاة مسبقاً.' })
    if (!revokeIssuedDocument(String(row.id), { reason, actor: session.actor }))
      return res.status(409).json({ message: 'الوثيقة ملغاة مسبقاً.' })
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'ISSUED_DOCUMENT_REVOKED',
      entityType: 'IssuedDocument',
      entityId: String(row.id),
      previousValue: { status: row.status },
      newValue: { status: 'REVOKED', reason },
      metadata: { documentNumber: row.document_number },
    })
    announceRevocation(row, reason, session.actor)
    return res.json({ id: String(row.id), status: 'REVOKED', revokedReason: reason })
  })

  // ---------------------------------------------------------------- templates & assignments
  app.get('/api/documents/templates', requireSession(...STAFF), (_req, res) => {
    res.json({
      templates: documentTemplates.map(item => templateView(item.id)),
      categories: Object.entries(templateCategoryLabels).map(([id, label]) => ({ id, label })),
    })
  })

  app.get('/api/documents/templates/:id/sample.pdf', requireSession(...STAFF), async (req, res) => {
    const id = param(req, 'id')
    if (!templateById.has(id)) return res.status(404).json({ message: 'نوع الوثيقة غير موجود.' })
    let pdf = sampleCache.get(id)
    if (!pdf) {
      pdf = await renderDocumentPdf(sampleModel(id))
      sampleCache.set(id, pdf)
    }
    pdfHeaders(res, `sample-${id}.pdf`, false, 'private, max-age=600')
    return res.send(pdf)
  })

  /** Instant preview of an assignment being edited (sample data, watermarked). */
  app.get('/api/documents/preview.pdf', requireSession(...STAFF), async (req, res) => {
    const query = req.query as Record<string, string | undefined>
    const templateId = String(query.templateId || '')
    if (!templateById.has(templateId)) return res.status(404).json({ message: 'نوع الوثيقة غير موجود.' })
    const departmentId = query.departmentId && departmentById.has(query.departmentId) ? query.departmentId : null
    const service = query.serviceKey ? getCatalogService(String(query.serviceKey)) : null
    const validity =
      query.validityDays === undefined || query.validityDays === '' ? undefined : Number(query.validityDays)
    const conditions = String(query.conditions || '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length >= 3)
      .slice(0, 6)
    const overrides = {
      departmentId,
      departmentName: departmentId ? departmentNameOf(departmentId) : null,
      serviceName: service?.title || null,
      title: query.title?.slice(0, 90) || null,
      conditions,
      validityDays: validity === undefined || Number.isNaN(validity) ? undefined : validity > 0 ? validity : null,
      signerTitle: query.signerTitle?.slice(0, 80) || null,
      signerName: query.signerName?.slice(0, 80) || null,
    }
    const pdf = await cachedPreview(JSON.stringify([templateId, overrides]), () =>
      renderDocumentPdf(sampleModel(templateId, overrides))
    )
    pdfHeaders(res, `preview-${templateId}.pdf`)
    return res.send(pdf)
  })

  app.get('/api/documents/departments', requireSession(...STAFF), (_req, res) => {
    const session = res.locals.session as SessionData
    const list =
      session.role === 'SUPER_ADMIN'
        ? departmentRegistry
        : departmentRegistry.filter(item => item.id === session.departmentId)
    res.json(list.map(item => ({ id: item.id, name: item.name, canEdit: canEditDepartment(session, item.id) })))
  })

  app.get('/api/documents/assignments', requireSession(...STAFF), (req, res) => {
    const session = res.locals.session as SessionData
    const departmentId = readableDepartment(session, String(req.query.departmentId || '') || null)
    if (!departmentId) return res.status(403).json({ message: 'لا تملك صلاحية الاطلاع على نماذج هذه الدائرة.' })
    const services = listCatalogServices({ departmentId, activeOnly: false }).map(service => {
      const plan = resolveDocumentPlan({
        departmentId,
        serviceKey: service.key,
        serviceTitle: service.title,
        category: service.category,
      })
      return {
        serviceKey: service.key,
        title: service.title,
        category: service.category,
        issuesDocument: serviceIssuesDocument(service),
        needsAttendance: needsAttendance(service),
        defaultTemplateId: plan.defaultTemplateId,
        templateId: plan.template.id,
        documentTitle: plan.title,
        overridden: plan.overridden,
        customTitle: plan.assignment?.customTitle || null,
        customConditions: plan.assignment?.customConditions || null,
        validityDays: plan.assignment ? plan.assignment.validityDays : null,
        effectiveValidityDays: plan.validityDays,
        signerTitle: plan.assignment?.signerTitle || null,
        effectiveSignerTitle: plan.signerTitle,
        /** printed under the title only when set; documents never carry the approving employee's name */
        signerName: plan.signerName,
        updatedBy: plan.assignment?.updatedBy || null,
        updatedAt: plan.assignment?.updatedAt || null,
      }
    })
    res.json({
      department: { id: departmentId, name: departmentNameOf(departmentId, departmentId) },
      canEdit: canEditDepartment(session, departmentId),
      services,
    })
  })

  const editableService = (req: express.Request, res: express.Response) => {
    const session = res.locals.session as SessionData
    const departmentId = param(req, 'departmentId')
    if (!departmentById.has(departmentId)) {
      res.status(404).json({ message: 'الدائرة غير موجودة.' })
      return null
    }
    if (!canEditDepartment(session, departmentId)) {
      res.status(403).json({ message: 'تعيين نماذج الوثائق متاح لمدير الدائرة أو مدير النظام فقط.' })
      return null
    }
    const service = getCatalogService(param(req, 'serviceKey'))
    if (!service || service.departmentId !== departmentId) {
      res.status(404).json({ message: 'الخدمة لا تتبع هذه الدائرة.' })
      return null
    }
    return { session, departmentId, service }
  }

  app.post('/api/documents/assignments/:departmentId/:serviceKey', requireSession(...STAFF), (req, res) => {
    const target = editableService(req, res)
    if (!target) return
    const parsed = assignmentSchema.safeParse(req.body)
    if (!parsed.success)
      return res.status(400).json({ message: parsed.error.issues[0]?.message || 'بيانات النموذج غير صالحة.' })
    const problem = assignmentProblem(parsed.data.templateId, target.service)
    if (problem) return res.status(400).json({ message: problem, code: 'TEMPLATE_NOT_ASSIGNABLE' })
    const before = resolveDocumentPlan({
      departmentId: target.departmentId,
      serviceKey: target.service.key,
      serviceTitle: target.service.title,
      category: target.service.category,
    })
    const saved = saveAssignment({
      departmentId: target.departmentId,
      serviceKey: target.service.key,
      templateId: parsed.data.templateId,
      customTitle: parsed.data.customTitle || null,
      customConditions: parsed.data.customConditions?.filter(Boolean) || null,
      validityDays: parsed.data.validityDays ?? null,
      signerTitle: parsed.data.signerTitle || null,
      // an editor that does not send the field (older UI) keeps the named signer already configured
      signerName:
        parsed.data.signerName === undefined ? before.assignment?.signerName || null : parsed.data.signerName || null,
      updatedBy: target.session.actor,
    })
    addAudit({
      actor: target.session.actor,
      role: target.session.role,
      action: 'DOCUMENT_TEMPLATE_ASSIGNED',
      entityType: 'DocumentTemplateAssignment',
      entityId: `${target.departmentId}:${target.service.key}`,
      previousValue: { templateId: before.template.id, overridden: before.overridden, assignment: before.assignment },
      newValue: saved,
    })
    return res.json(saved)
  })

  app.delete('/api/documents/assignments/:departmentId/:serviceKey', requireSession(...STAFF), (req, res) => {
    const target = editableService(req, res)
    if (!target) return
    const removed = deleteAssignment(target.departmentId, target.service.key)
    if (removed)
      addAudit({
        actor: target.session.actor,
        role: target.session.role,
        action: 'DOCUMENT_TEMPLATE_RESET',
        entityType: 'DocumentTemplateAssignment',
        entityId: `${target.departmentId}:${target.service.key}`,
      })
    return res.json({ reset: removed })
  })

  // ---------------------------------------------------------------- pre-issue preview of a pending request
  const requestForStaff = (req: express.Request, res: express.Response) => {
    const session = res.locals.session as SessionData
    const row = db
      .prepare(
        `SELECT sr.*, sc.name AS service_name, d.name AS department_name, c.full_name AS citizen_name
         FROM service_requests sr JOIN service_catalog sc ON sc.id = sr.service_id JOIN departments d ON d.id = sr.department_id
         JOIN citizens c ON c.id = sr.citizen_id WHERE sr.reference = ?`
      )
      .get(param(req, 'reference')) as Record<string, unknown> | undefined
    if (!row || (session.role !== 'SUPER_ADMIN' && session.departmentId !== row.department_id)) {
      res.status(404).json({ message: 'الطلب غير موجود ضمن دائرتك.' })
      return null
    }
    return { session, row, service: getCatalogService(String(row.service_id)) }
  }

  /**
   * The appointment an approval would print right now: the slot already confirmed, or — for attendance services —
   * the one the citizen requested (approving confirms it). A new date typed at approval replaces it.
   */
  const pendingAppointment = (row: Record<string, unknown>) => {
    const appointment = db
      .prepare(
        `SELECT preferred_date, preferred_time, status, confirmation_note FROM appointments WHERE service_request_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(Number(row.id)) as Record<string, unknown> | undefined
    if (!appointment) return null
    const status = String(appointment.status)
    if (status !== 'CONFIRMED' && !(status === 'REQUESTED' && row.service_channel === 'APPOINTMENT_REQUIRED'))
      return null
    return {
      date: String(appointment.preferred_date),
      time: String(appointment.preferred_time),
      place: appointment.confirmation_note ? String(appointment.confirmation_note) : null,
    }
  }

  const previewSource = (
    row: Record<string, unknown>,
    session: SessionData,
    service: ReturnType<typeof getCatalogService>
  ) => {
    const labels = new Map((service?.fields || []).map(field => [field.key, field.label]))
    const sensitive = /phone|mobile|email|national|identity|passport|license|licence|address|location|lat|lng/i
    let form: Record<string, unknown> = {}
    try {
      form = JSON.parse(String(row.form_data || '{}')) as Record<string, unknown>
    } catch {
      form = {}
    }
    return {
      sourceKind: 'SERVICE_REQUEST' as const,
      serviceRequestReference: String(row.reference),
      citizenId: Number(row.citizen_id),
      citizenName: String(row.citizen_name),
      serviceName: String(row.service_name),
      departmentName: String(row.department_name),
      documentTitle: String(row.service_name),
      issuedBy: session.actor,
      issuedAt: new Date().toISOString(),
      details: Object.entries(form)
        .filter(([key, value]) => !sensitive.test(key) && String(value || '').trim())
        .slice(0, 4)
        .map(([key, value]) => ({ label: labels.get(key) || key, value: String(value) })),
      departmentId: String(row.department_id),
      serviceKey: String(row.service_id),
      serviceCategory: service?.category,
      appointment: pendingAppointment(row),
      ...placeFromForm(row.form_data),
    }
  }

  app.get('/api/documents/requests/:reference/plan', requireSession(...STAFF), (req, res) => {
    const target = requestForStaff(req, res)
    if (!target) return
    const plan = resolveDocumentPlan({
      departmentId: String(target.row.department_id),
      serviceKey: String(target.row.service_id),
      serviceTitle: String(target.row.service_name),
      category: target.service?.category,
    })
    return res.json({
      issuesDocument: serviceIssuesDocument(target.service),
      template: templateView(plan.template.id),
      documentTitle: plan.title,
      validityDays: plan.validityDays,
      signerTitle: plan.signerTitle,
      signerName: plan.signerName,
      overridden: plan.overridden,
      /** the template prints the attendance appointment: approval needs one (a date typed now, or the booked one) */
      appointmentRequired: Boolean(plan.template.requiresAppointment),
      appointment: pendingAppointment(target.row),
      previewUrl: `/api/documents/requests/${encodeURIComponent(String(target.row.reference))}/preview.pdf`,
    })
  })

  app.get('/api/documents/requests/:reference/preview.pdf', requireSession(...STAFF), async (req, res) => {
    const target = requestForStaff(req, res)
    if (!target) return
    const { pdf } = await renderIssuancePreview(previewSource(target.row, target.session, target.service))
    addAudit({
      actor: target.session.actor,
      role: target.session.role,
      action: 'DOCUMENT_PREVIEW_OPENED',
      entityType: 'ServiceRequest',
      entityId: String(target.row.reference),
    })
    pdfHeaders(res, `preview-${String(target.row.reference).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`)
    return res.send(pdf)
  })

  // ---------------------------------------------------------------- public verification (signed codes)
  app.get('/api/verify/:verificationId/original-pdf', (req, res) => {
    const code = param(req, 'verificationId')
    const found = resolveCode(code)
    if (!found || 'invalid' in found || found.row.status !== 'ACTIVE')
      return res.status(404).json({ message: 'لا يوجد ملف PDF فعال بهذا الرمز.' })
    addAudit({
      actor: 'Public Verification',
      role: 'PUBLIC',
      action: 'ISSUED_DOCUMENT_ORIGINAL_OPENED',
      entityType: 'IssuedDocument',
      entityId: String(found.row.id),
      metadata: { signed: found.signed },
    })
    return sendIssuedPdf(res, found.row)
  })

  app.get('/api/verify/:verificationId', (req, res) => {
    const code = param(req, 'verificationId')
    const found = resolveCode(code)
    if (found && 'invalid' in found) {
      addAudit({
        actor: 'Public Verification',
        role: 'PUBLIC',
        action: 'DOCUMENT_VERIFICATION_FAILED',
        entityType: 'IssuedDocument',
        entityId: code.slice(0, 64),
        metadata: { reason: 'INVALID_SIGNATURE_OR_FORMAT' },
      })
      return res.status(404).json({
        code: 'INVALID_CODE',
        message: 'رمز التحقق غير صالح أو تم التلاعب به. لا تعتمد هذه الوثيقة.',
      })
    }
    if (found) {
      const view = verificationView(found.row, code, found.signed)
      addAudit({
        actor: 'Public Verification',
        role: 'PUBLIC',
        action: view.status === 'REVOKED' ? 'DOCUMENT_VERIFICATION_REVOKED' : 'ISSUED_DOCUMENT_VERIFIED',
        entityType: 'IssuedDocument',
        entityId: String(found.row.id),
        metadata: { exposedFields: 'document-minimum', signed: found.signed, validity: view.validity },
      })
      return res.json(view)
    }
    const item = getApplicationByVerificationId(code)
    if (!item) return res.status(404).json({ message: 'لم يتم العثور على وثيقة صادرة بهذا المعرّف.' })
    addAudit({
      actor: 'Public Verification',
      role: 'PUBLIC',
      action: 'DOCUMENT_VERIFIED',
      entityType: 'Document',
      entityId: code,
      metadata: { exposedFields: 'minimal', archivedPdf: false },
    })
    // legacy approvals (before the issued-documents archive): expose only what a verifier needs
    return res.json({
      reference: item.reference,
      citizenName: maskHolderName(String(item.citizenName || '')),
      serviceName: item.serviceName,
      department: item.department,
      documentTitle: item.serviceName,
      documentKind: 'APPROVAL',
      documentKindLabel: documentKindLabels.APPROVAL,
      documentNumber: item.documentNumber,
      verificationId: item.verificationId,
      status: item.status === 'APPROVED' ? 'APPROVED' : 'REVOKED',
      validity: item.status === 'APPROVED' ? 'VALID' : 'REVOKED',
      validityLabel: validityLabels[item.status === 'APPROVED' ? 'VALID' : 'REVOKED'],
      issuedAt: item.decidedAt || item.updatedAt,
      updatedAt: item.updatedAt,
      signatureValid: false,
      pdfAvailable: false,
      originalPdfUrl: null,
    })
  })
}
