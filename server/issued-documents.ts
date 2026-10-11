import { randomUUID } from 'node:crypto'
import { db, nextReference } from './db.js'
import { storeEncryptedMedia } from './media.js'
import { renderDocumentPdf, type DocumentMode, type DocumentModel } from './documents/render.js'
import { departmentCode } from './documents/samples.js'
import { last4Of, resolveDocumentPlan, type DocumentPlan } from './documents/store.js'
import { getTemplate } from './documents/templates.js'
import {
  activeSigningKey,
  holderDigestOf,
  newDocKey,
  recordMac,
  sameMac,
  sha256Hex,
  signDocument,
  signingKeyById,
  type SigningKey,
} from './documents/token.js'

/** Issuance refused for a reason the employee can fix (shown as is, HTTP 400). */
export class DocumentIssueError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

export type IssuedDocumentSource = {
  sourceKind: 'APPLICATION' | 'SERVICE_REQUEST'
  applicationReference?: string
  serviceRequestReference?: string
  citizenId: number
  citizenName: string
  serviceName: string
  departmentName: string
  /** fallback title when the template has none of its own (kept for older callers) */
  documentTitle: string
  issuedBy: string
  issuedAt: string
  details: Array<{ label: string; value: string }>
  preferredDocumentNumber?: string | null
  preferredVerificationId?: string | null
  /** catalog keys: pick the department's assigned template for this service */
  departmentId?: string | null
  serviceKey?: string | null
  serviceCategory?: string | null
  /** template when the service has no catalog entry or assignment (e.g. store licences) */
  fallbackTemplateId?: string
  district?: string | null
  location?: string | null
  decisionNote?: string | null
  appointment?: { date: string; time: string; place?: string | null } | null
  /** referral letter: the receiving department it is addressed to */
  referralTo?: string | null
  /** fee printed on the document; omitted = the latest fee paid on the request (a receipt passes its own payment) */
  fees?: { amountIqd: number; receiptNumber: string | null } | null
}

/**
 * Events of a request that issue their own official document, next to (never instead of) the approval document:
 * the fee receipt, the reasoned rejection decision and the referral letter to the competent department.
 */
export type DocumentEvent = 'RECEIPT' | 'REJECTION' | 'REFERRAL'
export const EVENT_TEMPLATE_IDS: Readonly<Record<DocumentEvent, string>> = {
  RECEIPT: 'receipt',
  REJECTION: 'rejection-decision',
  REFERRAL: 'referral-letter',
}

export type IssuedDocumentRecord = {
  id: string
  documentNumber: string
  verificationId: string
  pdfMediaId: string
  documentTitle: string
  serviceName: string
  departmentName: string
  issuedAt: string
  status: 'ACTIVE' | 'REVOKED'
  templateId?: string
  expiresAt?: string | null
  /** null for the approval document; otherwise the request event that issued it */
  issueEvent?: DocumentEvent | null
}

const clip = (value: string, max = 220) =>
  String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

/** Address-like and district answers of a request form (only printed by templates that show a location). */
export function placeFromForm(formData: unknown) {
  let data: Record<string, unknown> = {}
  try {
    data = typeof formData === 'string' ? (JSON.parse(formData || '{}') as Record<string, unknown>) : {}
  } catch {
    data = {}
  }
  const pick = (pattern: RegExp) =>
    Object.entries(data).find(
      ([key, value]) => pattern.test(key) && !/lat|lng|lon|coord/i.test(key) && String(value || '').trim()
    )?.[1]
  const location = pick(/address|location|street|neighbo|mahall|plot|site/i)
  const district = pick(/district|qada|nahiya|subdistrict/i)
  return {
    location: location ? clip(String(location), 160) : null,
    district: district ? clip(String(district), 80) : null,
  }
}

const addDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86_400_000).toISOString()

/** Calendar year in Baghdad: the year printed on the document (the server itself runs in UTC). */
export const baghdadYear = (at: Date = new Date()) =>
  Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Baghdad', year: 'numeric' }).format(at))

/** TQD-<DEPT>-<YYYY>-<SEQ>: one counter per department code and Baghdad year (never reused). */
export function nextDocumentSerial(departmentId: string | null | undefined, at = new Date()) {
  const code = departmentCode(departmentId)
  const year = baghdadYear(at)
  const seq = nextReference(`document_serial:${code}:${year}`)
  return `TQD-${code}-${year}-${String(seq).padStart(6, '0')}`
}

/** Fee actually collected on a service request (office receipt or online payment). */
function paidFee(serviceRequestReference: string | undefined) {
  if (!serviceRequestReference) return null
  const row = db
    .prepare(
      `SELECT pi.amount_iqd, pi.receipt_number FROM payment_intents pi JOIN service_requests sr ON sr.id = pi.service_request_id
       WHERE sr.reference = ? AND pi.status = 'PAID' ORDER BY pi.paid_at DESC LIMIT 1`
    )
    .get(serviceRequestReference) as { amount_iqd: number; receipt_number: string | null } | undefined
  return row ? { amountIqd: Number(row.amount_iqd), receiptNumber: row.receipt_number || null } : null
}

/** Builds the printable model of a document (shared by issuance and the employee's pre-issue preview). */
export function buildDocumentModel(
  input: IssuedDocumentSource,
  plan: DocumentPlan,
  ids: { documentNumber: string; token: string; manualCode: string; expiresAt: string | null },
  mode: DocumentMode
): DocumentModel {
  const citizen = db.prepare('SELECT national_id_masked, district FROM citizens WHERE id = ?').get(input.citizenId) as
    { national_id_masked: string | null; district: string | null } | undefined
  // the printed conditions are the department's (template or assignment) only: the employee's approval note is a
  // message to the citizen («ملاحظة للمواطن»), shown in the request and its notification, never a legal condition
  const conditions = plan.conditions.map(item => clip(item, 300)).filter(Boolean)
  return {
    template: plan.template,
    title: plan.title,
    serviceName: clip(input.serviceName, 180),
    departmentName: clip(input.departmentName, 180),
    holderName: clip(input.citizenName, 120),
    holderIdLast4: last4Of(citizen?.national_id_masked),
    reference: input.applicationReference || input.serviceRequestReference || null,
    district: input.district || citizen?.district || null,
    location: input.location || null,
    details: input.details
      .map(item => ({ label: clip(item.label, 80), value: clip(item.value, 300) }))
      .filter(item => item.value.length > 0)
      .slice(0, 4),
    conditions,
    fees: input.fees !== undefined ? input.fees : paidFee(input.serviceRequestReference),
    // printed: the signing authority (title) and, only when the department configured one, a named signer. The
    // employee who approved (input.issuedBy) stays in the internal record and the audit log, never on the document.
    signerTitle: plan.signerTitle,
    signerName: plan.signerName ? clip(plan.signerName, 80) || null : null,
    documentNumber: ids.documentNumber,
    issuedAt: input.issuedAt,
    expiresAt: ids.expiresAt,
    token: ids.token,
    manualCode: ids.manualCode,
    appointment: input.appointment || null,
    reason: plan.template.id === 'rejection-decision' ? clip(input.decisionNote || '', 1500) || null : null,
    referralTo: plan.template.fields.includes('referral') ? clip(input.referralTo || '', 180) || null : null,
    mode,
  }
}

export function planFor(input: IssuedDocumentSource) {
  return resolveDocumentPlan({
    departmentId: input.departmentId,
    serviceKey: input.serviceKey,
    serviceTitle: input.serviceName,
    category: input.serviceCategory,
    fallbackTemplateId: input.fallbackTemplateId,
  })
}

/**
 * Plan of an event document: its own fixed template (never a service assignment, so a rejection letter is never
 * printed on an approval and an approval template never on a rejection). A rejection or a referral is signed by the
 * authority the department configured for the service (its assignment's signer); a receipt by the receiving desk.
 */
export function eventPlanFor(event: DocumentEvent, input: IssuedDocumentSource): DocumentPlan {
  const template = getTemplate(EVENT_TEMPLATE_IDS[event])
  const service = planFor(input)
  const configured = Boolean(service.assignment?.signerTitle || service.assignment?.signerName)
  const signer =
    event !== 'RECEIPT' && configured && service.template.family !== 'RECEIPT'
      ? { title: service.signerTitle, name: service.signerName }
      : { title: template.defaultSignerTitle, name: null }
  return {
    template,
    defaultTemplateId: template.id,
    title: template.title,
    conditions: template.defaultConditions,
    validityDays: template.defaultValidityDays,
    signerTitle: signer.title,
    signerName: signer.name,
    overridden: false,
    assignment: null,
  }
}

/** Pre-issue preview with the request's real data, watermarked and with a code that verifies nowhere. */
export async function renderIssuancePreview(input: IssuedDocumentSource) {
  const plan = planFor(input)
  const expiresAt = plan.validityDays ? addDays(input.issuedAt, plan.validityDays) : null
  const signed = signDocument({
    docKey: newDocKey(),
    documentNumber: 'TQD-PREVIEW',
    templateId: plan.template.id,
    departmentId: 'preview',
    issuedAt: input.issuedAt,
    expiresAt,
    holderDigest: 'preview',
  })
  const model = buildDocumentModel(
    input,
    plan,
    {
      documentNumber: `TQD-${departmentCode(input.departmentId)}-${baghdadYear()}-••••••`,
      token: signed.token,
      manualCode: signed.manualCode,
      expiresAt,
    },
    'PREVIEW'
  )
  return { plan, pdf: await renderDocumentPdf(model) }
}

const recordOf = (row: Record<string, unknown>): IssuedDocumentRecord => ({
  id: String(row.id),
  documentNumber: String(row.document_number),
  verificationId: String(row.verification_id),
  pdfMediaId: String(row.pdf_media_id),
  documentTitle: String(row.document_title),
  serviceName: String(row.service_name),
  departmentName: String(row.department_name),
  issuedAt: String(row.issued_at),
  status: String(row.status) as 'ACTIVE' | 'REVOKED',
  templateId: row.template_id ? String(row.template_id) : undefined,
  expiresAt: row.expires_at ? String(row.expires_at) : null,
  issueEvent: row.issue_event ? (String(row.issue_event) as DocumentEvent) : null,
})

/**
 * Every stored column a verifier sees or is served (titles, department, status/revocation, the archived PDF's media
 * id and SHA-256…), in a fixed order. `updated_at` is left out: it is bookkeeping, not part of the document.
 */
const MAC_COLUMNS = [
  'id',
  'source_kind',
  'application_reference',
  'service_request_reference',
  'citizen_id',
  'service_name',
  'department_name',
  'document_title',
  'document_number',
  'verification_id',
  'status',
  'pdf_media_id',
  'issued_by',
  'issued_at',
  'template_id',
  'department_id',
  'service_key',
  'doc_key',
  'holder_digest',
  'pdf_sha256',
  'expires_at',
  'holder_id_last4',
  'revoked_at',
  'revoked_reason',
  'revoked_by',
  'signing_key_id',
] as const

/**
 * Columns of event documents (receipt, rejection, referral), sealed after MAC_COLUMNS whenever one is set: records
 * written before they existed keep their original seal, and setting or clearing them on any record breaks it.
 */
const EVENT_MAC_COLUMNS = ['issue_event', 'event_key', 'related_reference'] as const

const macOf = (key: SigningKey, row: Record<string, unknown>) => {
  const value = (column: string) => row[column] as string | number | null | undefined
  const fields = MAC_COLUMNS.map(value)
  if (EVENT_MAC_COLUMNS.some(column => row[column] !== null && row[column] !== undefined))
    fields.push(...EVENT_MAC_COLUMNS.map(value))
  return recordMac(key, fields)
}

/**
 * Whether a signed record is exactly as the platform wrote it: the server-side HMAC (with the key that signed the
 * document) over MAC_COLUMNS must match. Any edit made directly in the database — a swapped PDF, a changed title,
 * an un-revoked status — fails this check.
 */
export function issuedRecordIntact(row: Record<string, unknown>) {
  if (!row.record_mac) return false
  const key = signingKeyById(row.signing_key_id ? String(row.signing_key_id) : null)
  return key ? sameMac(macOf(key, row), String(row.record_mac)) : false
}

/**
 * Issues the official PDF of an approved request with the department's assigned template, an opaque signed QR
 * token (TQD1.<docKey>.<hmac>) and a SHA-256 of the exact bytes archived. Idempotent per source reference.
 */
export async function createIssuedDocument(input: IssuedDocumentSource): Promise<IssuedDocumentRecord> {
  const referenceColumn = input.sourceKind === 'APPLICATION' ? 'application_reference' : 'service_request_reference'
  const reference = input.sourceKind === 'APPLICATION' ? input.applicationReference : input.serviceRequestReference
  if (!reference) throw new Error('Document source reference is required.')
  const existing = db.prepare(`SELECT * FROM issued_documents WHERE ${referenceColumn} = ?`).get(reference) as
    Record<string, unknown> | undefined
  if (existing) return recordOf(existing)

  const plan = planFor(input)
  if (plan.template.requiresAppointment && !input.appointment)
    throw new DocumentIssueError(
      `الوثيقة المعيّنة لهذه الخدمة «${plan.template.title}»: حدد تاريخ ووقت موعد الحضور قبل الموافقة.`,
      'APPOINTMENT_REQUIRED'
    )
  return issueDocument(input, plan, null)
}

/** Event documents being rendered, by event key: a concurrent call for the same event shares the first one. */
const eventsInFlight = new Map<string, Promise<IssuedDocumentRecord>>()

const eventRecord = (eventKey: string) => {
  const row = db.prepare('SELECT * FROM issued_documents WHERE event_key = ?').get(eventKey) as
    Record<string, unknown> | undefined
  return row ? recordOf(row) : null
}

/**
 * Issues the document of a request event (see DocumentEvent) with the same signed QR token, encrypted archive and
 * record seal as an approval document. Idempotent per `eventKey` (one receipt per payment, one decision per
 * rejection, one letter per referral): calling it again returns the document already issued.
 */
export async function createEventDocument(
  input: IssuedDocumentSource,
  event: DocumentEvent,
  eventKey: string
): Promise<IssuedDocumentRecord> {
  const pending = eventsInFlight.get(eventKey)
  if (pending) return pending
  const run = (async () => {
    const existing = eventRecord(eventKey)
    if (existing) return existing
    if (!(input.sourceKind === 'APPLICATION' ? input.applicationReference : input.serviceRequestReference))
      throw new Error('Document source reference is required.')
    if (event === 'REJECTION' && !clip(input.decisionNote || ''))
      throw new DocumentIssueError('اكتب سبب الرفض: يُطبع في قرار الرفض المسبّب.', 'REASON_REQUIRED')
    if (event === 'REFERRAL' && !clip(input.referralTo || ''))
      throw new DocumentIssueError('حدد الدائرة المحال إليها: يُوجَّه إليها كتاب الإحالة.', 'REFERRAL_REQUIRED')
    return issueDocument(input, eventPlanFor(event, input), { event, eventKey })
  })()
  eventsInFlight.set(eventKey, run)
  try {
    return await run
  } finally {
    eventsInFlight.delete(eventKey)
  }
}

/** Renders, archives and seals one document: the approval document when `event` is null. */
async function issueDocument(
  input: IssuedDocumentSource,
  plan: DocumentPlan,
  event: { event: DocumentEvent; eventKey: string } | null
): Promise<IssuedDocumentRecord> {
  const expiresAt = plan.validityDays ? addDays(input.issuedAt, plan.validityDays) : null
  const documentNumber =
    input.preferredDocumentNumber || nextDocumentSerial(input.departmentId, new Date(input.issuedAt))
  const docKey = newDocKey()
  const holderDigest = holderDigestOf(input.citizenId, input.citizenName)
  const key = activeSigningKey()
  const signed = signDocument(
    {
      docKey,
      documentNumber,
      templateId: plan.template.id,
      departmentId: input.departmentId || '',
      issuedAt: input.issuedAt,
      expiresAt,
      holderDigest,
    },
    key
  )
  const model = buildDocumentModel(
    input,
    plan,
    { documentNumber, token: signed.token, manualCode: signed.manualCode, expiresAt },
    'ISSUED'
  )
  const pdfBuffer = await renderDocumentPdf(model)
  const media = storeEncryptedMedia({
    citizenId: input.citizenId,
    purpose: 'ISSUED_DOCUMENT',
    originalName: `${documentNumber}.pdf`,
    mimeType: 'application/pdf',
    buffer: pdfBuffer,
    retentionPolicy: 'RETAINED_WITH_CONSENT',
    retentionConsentAt: input.issuedAt,
  })
  const id = `doc_${randomUUID().replaceAll('-', '')}`
  // the exact values stored, keyed by column: the record HMAC is computed over them before the single INSERT
  const stored: Record<string, string | number | null> = {
    id,
    source_kind: input.sourceKind,
    // the approval document owns the (UNIQUE) source reference; an event document links its request through
    // related_reference, so one request carries its receipt, referral letters and decision side by side
    application_reference: event ? null : input.applicationReference || null,
    service_request_reference: event ? null : input.serviceRequestReference || null,
    citizen_id: input.citizenId,
    service_name: clip(input.serviceName, 180),
    department_name: clip(input.departmentName, 180),
    document_title: clip(plan.title || input.documentTitle, 180),
    document_number: documentNumber,
    verification_id: signed.token,
    status: 'ACTIVE',
    pdf_media_id: media.id,
    issued_by: clip(input.issuedBy, 120),
    issued_at: input.issuedAt,
    template_id: plan.template.id,
    department_id: input.departmentId || null,
    service_key: input.serviceKey || null,
    doc_key: docKey,
    holder_digest: holderDigest,
    pdf_sha256: sha256Hex(pdfBuffer),
    expires_at: expiresAt,
    holder_id_last4: model.holderIdLast4,
    revoked_at: null,
    revoked_reason: null,
    revoked_by: null,
    signing_key_id: key.id,
    issue_event: event?.event || null,
    event_key: event?.eventKey || null,
    related_reference: event
      ? (input.sourceKind === 'APPLICATION' ? input.applicationReference : input.serviceRequestReference) || null
      : null,
  }
  // the exact order of the INSERT below (created_at / updated_at are the issuance time, outside the seal)
  const columns = [
    'id',
    'source_kind',
    'application_reference',
    'service_request_reference',
    'citizen_id',
    'service_name',
    'department_name',
    'document_title',
    'document_number',
    'verification_id',
    'status',
    'pdf_media_id',
    'issued_by',
    'issued_at',
    'template_id',
    'department_id',
    'service_key',
    'doc_key',
    'holder_digest',
    'pdf_sha256',
    'expires_at',
    'holder_id_last4',
    'signing_key_id',
    'issue_event',
    'event_key',
    'related_reference',
  ]
  try {
    db.prepare(
      `INSERT INTO issued_documents (${columns.join(', ')}, created_at, updated_at, record_mac)
       VALUES (${columns.map(() => '?').join(', ')}, ?, ?, ?)`
    ).run(...columns.map(column => stored[column]), input.issuedAt, input.issuedAt, macOf(key, stored))
  } catch (error) {
    // the same event issued meanwhile by another process (UNIQUE event_key): that document stands
    const already = event ? eventRecord(event.eventKey) : null
    if (already) return already
    throw error
  }
  return recordOf(db.prepare('SELECT * FROM issued_documents WHERE id = ?').get(id) as Record<string, unknown>)
}

export function getIssuedDocumentByVerificationId(verificationId: string) {
  return db
    .prepare(
      `SELECT d.*, c.full_name AS citizen_name FROM issued_documents d JOIN citizens c ON c.id = d.citizen_id WHERE d.verification_id = ?`
    )
    .get(verificationId) as Record<string, unknown> | undefined
}

export function getIssuedDocumentByDocKey(docKey: string) {
  return db
    .prepare(
      `SELECT d.*, c.full_name AS citizen_name FROM issued_documents d JOIN citizens c ON c.id = d.citizen_id WHERE d.doc_key = ?`
    )
    .get(docKey) as Record<string, unknown> | undefined
}

export function listIssuedDocumentsForCitizen(citizenId: number) {
  return db
    .prepare(
      `SELECT id, source_kind, application_reference, service_request_reference, service_name, department_name, document_title, document_number, verification_id, status, issued_at, revoked_at, revoked_reason, template_id, expires_at,
      issue_event, related_reference
    FROM issued_documents WHERE citizen_id = ? ORDER BY issued_at DESC`
    )
    .all(citizenId) as Array<Record<string, unknown>>
}

export function getIssuedDocumentForCitizen(id: string, citizenId: number) {
  return db.prepare('SELECT * FROM issued_documents WHERE id = ? AND citizen_id = ?').get(id, citizenId) as
    Record<string, unknown> | undefined
}

const employeeColumns = `d.id, d.source_kind, d.application_reference, d.service_request_reference, d.service_name, d.department_name, d.document_title, d.document_number, d.verification_id, d.status, d.issued_at,
  d.template_id, d.department_id, d.expires_at, d.revoked_at, d.revoked_reason, d.revoked_by, d.issue_event, d.related_reference,
  c.full_name AS citizen_name`

export const ISSUED_PAGE_DEFAULT = 50
export const ISSUED_PAGE_MAX = 200

/**
 * One page of the issued-documents register, newest first. `query` searches the whole register server-side (number,
 * title, holder name, service, request/application reference), so older documents stay reachable at any size.
 */
export function listIssuedDocumentsForEmployee(
  scope?: { departmentName: string; departmentId?: string | null },
  options: { query?: string | null; limit?: number | null; offset?: number | null } = {}
) {
  const where: string[] = []
  const values: Array<string | number> = []
  if (scope) {
    where.push('(d.department_name = ? OR d.department_id = ?)')
    values.push(scope.departmentName, scope.departmentId || '')
  }
  const query = clip(options.query || '', 80)
  if (query) {
    const like = `%${query.replace(/[\\%_]/g, char => `\\${char}`)}%`
    const columns = [
      'd.document_number',
      'd.document_title',
      'd.service_name',
      'd.service_request_reference',
      'd.application_reference',
      'd.related_reference',
      'c.full_name',
    ]
    where.push(`(${columns.map(column => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`)
    values.push(...columns.map(() => like))
  }
  const limit = Math.min(ISSUED_PAGE_MAX, Math.max(1, Math.floor(Number(options.limit) || ISSUED_PAGE_DEFAULT)))
  const offset = Math.max(0, Math.floor(Number(options.offset) || 0))
  return db
    .prepare(
      `SELECT ${employeeColumns} FROM issued_documents d JOIN citizens c ON c.id = d.citizen_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.issued_at DESC, d.id DESC LIMIT ? OFFSET ?`
    )
    .all(...values, limit, offset) as Array<Record<string, unknown>>
}

export function getIssuedDocumentForEmployee(
  id: string,
  scope?: { departmentName: string; departmentId?: string | null }
) {
  const row = db.prepare('SELECT * FROM issued_documents WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (
    row &&
    scope &&
    String(row.department_name) !== scope.departmentName &&
    (!scope.departmentId || row.department_id !== scope.departmentId)
  )
    return undefined
  return row
}

/**
 * Marks a document REVOKED (kept in the archive; verification then answers «ملغاة») and re-seals the record HMAC
 * over the new status — only when the record was intact before, so a revocation never launders a tampered row.
 */
export function revokeIssuedDocument(id: string, input: { reason: string; actor: string }) {
  const select = db.prepare('SELECT * FROM issued_documents WHERE id = ?')
  const before = select.get(id) as Record<string, unknown> | undefined
  if (!before || before.status !== 'ACTIVE') return false
  const intact = issuedRecordIntact(before)
  const timestamp = new Date().toISOString()
  const changes = db
    .prepare(
      `UPDATE issued_documents SET status = 'REVOKED', revoked_at = ?, revoked_reason = ?, revoked_by = ?, updated_at = ? WHERE id = ? AND status = 'ACTIVE'`
    )
    .run(timestamp, clip(input.reason, 300), clip(input.actor, 120), timestamp, id).changes
  if (!Number(changes)) return false
  if (intact) {
    const after = select.get(id) as Record<string, unknown>
    const key = signingKeyById(after.signing_key_id ? String(after.signing_key_id) : null)
    if (key) db.prepare('UPDATE issued_documents SET record_mac = ? WHERE id = ?').run(macOf(key, after), id)
  }
  return true
}
