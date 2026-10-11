import { randomBytes } from 'node:crypto'
import { db } from '../db.js'
import { departmentById } from '../department-registry.js'
import {
  documentTitleFor,
  getTemplate,
  inferTemplateId,
  isIssuableTemplate,
  templateById,
  type DocumentTemplate,
} from './templates.js'
import { registerPinnedSigningKey, signingKeyId, type SigningKey } from './token.js'

/** Schema owned by the documents module (created next to db.ts's tables, idempotent). */
const ensureColumn = (table: string, column: string, definition: string) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some(item => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

db.exec(`
  CREATE TABLE IF NOT EXISTS document_template_assignments (
    department_id TEXT NOT NULL,
    service_key TEXT NOT NULL,
    template_id TEXT NOT NULL,
    custom_title TEXT,
    custom_conditions TEXT,
    validity_days INTEGER,
    signer_title TEXT,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (department_id, service_key)
  );
`)
ensureColumn('issued_documents', 'template_id', 'TEXT')
ensureColumn('issued_documents', 'department_id', 'TEXT')
ensureColumn('issued_documents', 'service_key', 'TEXT')
ensureColumn('issued_documents', 'doc_key', 'TEXT')
ensureColumn('issued_documents', 'holder_digest', 'TEXT')
ensureColumn('issued_documents', 'pdf_sha256', 'TEXT')
ensureColumn('issued_documents', 'expires_at', 'TEXT')
ensureColumn('issued_documents', 'holder_id_last4', 'TEXT')
ensureColumn('issued_documents', 'revoked_by', 'TEXT')
// id of the key that signed the QR code + server-side HMAC over the columns a verifier sees (token.ts)
ensureColumn('issued_documents', 'signing_key_id', 'TEXT')
ensureColumn('issued_documents', 'record_mac', 'TEXT')
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_issued_documents_doc_key ON issued_documents(doc_key)')
// documents issued by an event of a request rather than its approval (receipt, reasoned rejection, referral letter):
// `issue_event` says which, `event_key` makes each event issue at most one document, and `related_reference` links
// the request (service_request_reference / application_reference stay UNIQUE for the approval document)
ensureColumn('issued_documents', 'issue_event', 'TEXT')
ensureColumn('issued_documents', 'event_key', 'TEXT')
ensureColumn('issued_documents', 'related_reference', 'TEXT')
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_issued_documents_event_key ON issued_documents(event_key)')
db.exec('CREATE INDEX IF NOT EXISTS idx_issued_documents_related ON issued_documents(related_reference)')
// optional named signer printed under the signer title (never the approving employee's account)
ensureColumn('document_template_assignments', 'signer_name', 'TEXT')
db.exec(`
  CREATE TABLE IF NOT EXISTS document_signing_keys (
    id TEXT PRIMARY KEY,
    secret TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`)

/**
 * Signing key used when DOCUMENT_SIGNING_KEY is not configured: random, generated once and kept in the database, so
 * that it never changes with SESSION_SECRET or any other secret. Older pinned keys keep verifying by their id.
 */
let pinnedActive: SigningKey | null = null
const pinnedRow = (id?: string) =>
  (id
    ? db.prepare('SELECT id, secret FROM document_signing_keys WHERE id = ?').get(id)
    : db.prepare('SELECT id, secret FROM document_signing_keys ORDER BY created_at ASC, id ASC LIMIT 1').get()) as
    { id: string; secret: string } | undefined
registerPinnedSigningKey({
  active: () => {
    if (pinnedActive) return pinnedActive
    let row = pinnedRow()
    if (!row) {
      const secret = randomBytes(32).toString('hex')
      db.prepare('INSERT OR IGNORE INTO document_signing_keys (id, secret, created_at) VALUES (?, ?, ?)').run(
        signingKeyId(secret),
        secret,
        new Date().toISOString()
      )
      row = pinnedRow()
    }
    if (!row) throw new Error('Could not pin a document signing key.')
    pinnedActive = { id: String(row.id), secret: String(row.secret) }
    return pinnedActive
  },
  byId: id => {
    const row = pinnedRow(id)
    return row ? { id: String(row.id), secret: String(row.secret) } : null
  },
})

export type TemplateAssignment = {
  departmentId: string
  serviceKey: string
  templateId: string
  customTitle: string | null
  customConditions: string[] | null
  /** null = template default; 0 = no expiry */
  validityDays: number | null
  signerTitle: string | null
  /** person printed under the signer title; null = the title alone (no personal name on the document) */
  signerName: string | null
  updatedBy: string
  updatedAt: string
}

const mapAssignment = (row: Record<string, unknown>): TemplateAssignment => ({
  departmentId: String(row.department_id),
  serviceKey: String(row.service_key),
  templateId: String(row.template_id),
  customTitle: row.custom_title ? String(row.custom_title) : null,
  customConditions: row.custom_conditions ? (JSON.parse(String(row.custom_conditions)) as string[]) : null,
  validityDays: row.validity_days === null || row.validity_days === undefined ? null : Number(row.validity_days),
  signerTitle: row.signer_title ? String(row.signer_title) : null,
  signerName: row.signer_name ? String(row.signer_name) : null,
  updatedBy: String(row.updated_by),
  updatedAt: String(row.updated_at),
})

export function getAssignment(departmentId: string, serviceKey: string) {
  const row = db
    .prepare('SELECT * FROM document_template_assignments WHERE department_id = ? AND service_key = ?')
    .get(departmentId, serviceKey) as Record<string, unknown> | undefined
  return row ? mapAssignment(row) : null
}

export function listAssignments(departmentId: string) {
  return (
    db.prepare('SELECT * FROM document_template_assignments WHERE department_id = ?').all(departmentId) as Array<
      Record<string, unknown>
    >
  ).map(mapAssignment)
}

export function saveAssignment(input: Omit<TemplateAssignment, 'updatedAt'>) {
  const timestamp = new Date().toISOString()
  db.prepare(
    `INSERT INTO document_template_assignments (department_id, service_key, template_id, custom_title, custom_conditions, validity_days, signer_title, signer_name, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(department_id, service_key) DO UPDATE SET template_id = excluded.template_id, custom_title = excluded.custom_title,
       custom_conditions = excluded.custom_conditions, validity_days = excluded.validity_days, signer_title = excluded.signer_title,
       signer_name = excluded.signer_name, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(
    input.departmentId,
    input.serviceKey,
    input.templateId,
    input.customTitle,
    input.customConditions?.length ? JSON.stringify(input.customConditions) : null,
    input.validityDays,
    input.signerTitle,
    input.signerName,
    input.updatedBy,
    timestamp
  )
  return getAssignment(input.departmentId, input.serviceKey) as TemplateAssignment
}

export function deleteAssignment(departmentId: string, serviceKey: string) {
  return (
    Number(
      db
        .prepare('DELETE FROM document_template_assignments WHERE department_id = ? AND service_key = ?')
        .run(departmentId, serviceKey).changes
    ) > 0
  )
}

export type DocumentPlan = {
  template: DocumentTemplate
  defaultTemplateId: string
  title: string
  conditions: string[]
  validityDays: number | null
  signerTitle: string
  /** named signer configured by the department, printed under the title; never the approving employee */
  signerName: string | null
  overridden: boolean
  assignment: TemplateAssignment | null
}

/**
 * What a department issues for one service: its assignment when a manager/super admin set one, otherwise the
 * template inferred from the service. `fallbackTemplateId` covers sources without a catalog entry (store licences).
 * An assignment to a template that is never issued on approval (a rejection decision saved before that was refused)
 * is ignored.
 */
export function resolveDocumentPlan(input: {
  departmentId: string | null | undefined
  serviceKey: string | null | undefined
  serviceTitle: string
  category?: string | null
  fallbackTemplateId?: string
}): DocumentPlan {
  const defaultTemplateId =
    input.fallbackTemplateId ||
    inferTemplateId({ key: input.serviceKey || '', title: input.serviceTitle, category: input.category })
  const stored = input.departmentId && input.serviceKey ? getAssignment(input.departmentId, input.serviceKey) : null
  const assigned = stored ? templateById.get(stored.templateId) : undefined
  const assignment = stored && assigned && isIssuableTemplate(assigned) ? stored : null
  const template = getTemplate(assignment ? assignment.templateId : defaultTemplateId)
  const validityDays =
    assignment && assignment.validityDays !== null
      ? assignment.validityDays > 0
        ? assignment.validityDays
        : null
      : template.defaultValidityDays
  return {
    template,
    defaultTemplateId,
    title: documentTitleFor(template, input.serviceTitle, assignment?.customTitle),
    conditions: assignment?.customConditions?.length ? assignment.customConditions : template.defaultConditions,
    validityDays,
    signerTitle: assignment?.signerTitle || template.defaultSignerTitle,
    signerName: assignment?.signerName || null,
    overridden: Boolean(assignment),
    assignment,
  }
}

export const departmentNameOf = (departmentId: string | null | undefined, fallback = '') =>
  (departmentId && departmentById.get(departmentId)?.name) || fallback

/** "********** 4821" → "4821"; anything without 4 trailing digits → null. */
export function last4Of(masked: string | null | undefined) {
  const digits = String(masked || '').replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : null
}

/** "علي حسين كاظم" → "علي ح. ك." — enough for a verifier to match the holder without publishing the full name. */
export function maskHolderName(name: string | null | undefined) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return '—'
  return [parts[0], ...parts.slice(1).map(part => `${[...part][0]}.`)].join(' ')
}
