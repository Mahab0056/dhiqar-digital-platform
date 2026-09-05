import registryData from '../registry/dhiqar-services.json' with { type: 'json' }
import { db } from '../db.js'
import { departmentById, departmentRegistry } from '../department-registry.js'
import { invalidateSearchIndex } from './search.js'
import { serviceDefinitions, type ServiceFormField } from '../../src/service-forms.js'

export type CatalogDocument = {
  key: string
  label: string
  description: string
  required: boolean
  accepts: Array<'image' | 'pdf'>
}

export type CatalogField = Omit<ServiceFormField, 'type'> & { type: ServiceFormField['type'] | 'number' | 'email' }

export type ServiceChannel = 'ONLINE_SUBMISSION' | 'APPOINTMENT_REQUIRED' | 'INFORMATION_ONLY'
export type ServiceMode = 'SPECIALIZED' | 'GENERIC' | 'APPOINTMENT' | 'EXTERNAL' | 'CATALOG'

export type CatalogService = {
  key: string
  departmentId: string
  departmentName: string
  title: string
  description: string
  category: string
  applicantType: 'CITIZEN' | 'BUSINESS' | 'BOTH'
  channel: ServiceChannel
  mode: ServiceMode
  requiredDocuments: CatalogDocument[]
  fields: CatalogField[]
  feeIqd: number | null
  feeStatus: 'OFFICIAL' | 'UNVERIFIED' | 'NOT_REQUIRED'
  feeSource: string | null
  estimatedDuration: string | null
  sourceUrl: string
  sourceQuality: 'OFFICIAL' | 'RELIABLE' | 'UNVERIFIED'
  notes: string
  active: boolean
  updatedAt: string
}

type RegistryService = {
  key: string
  departmentId: string
  title: string
  description: string
  category: string
  applicantType: 'CITIZEN' | 'BUSINESS' | 'BOTH'
  channel: ServiceChannel
  requiredDocuments: CatalogDocument[]
  fields: CatalogField[]
  feeIqd: number | null
  feeSource: string | null
  estimatedDuration: string | null
  sourceUrl: string
  sourceQuality: 'OFFICIAL' | 'RELIABLE' | 'UNVERIFIED'
  notes: string
}

const registry = registryData as RegistryService[]

/** Standard identity documents used by the legacy platform forms (kept as explicit uploads). */
const legacyDocuments = (requirements: string[]): CatalogDocument[] =>
  requirements.map((label, index) => ({
    key: `req-${index + 1}`,
    label,
    description: '',
    required: true,
    accepts: ['image', 'pdf'],
  }))

/** Legacy definitions that name a national ministry are anchored to the local office that serves Thi Qar. */
const legacyDepartmentOverrides: Record<string, string> = {
  'e-passport': 'dhi-qar-passports-directorate',
  'national-id': 'nasiriyah-national-id-office',
  'driving-license': 'dhi-qar-traffic-directorate',
  'online-appointment': 'dhiqar-governorate',
}

function legacyDepartmentId(key: string, name: string) {
  const override = legacyDepartmentOverrides[key]
  if (override && departmentById.has(override)) return override
  return departmentRegistry.find(item => item.name === name)?.id ?? null
}

/** Upserts platform-defined services (with custom flows) and the researched registry into service_catalog. */
export function seedServiceCatalog() {
  invalidateSearchIndex()
  const timestamp = new Date().toISOString()
  const statement = db.prepare(
    `INSERT INTO service_catalog (id, department_id, name, category, description, fee_iqd, fee_status, fee_source, estimated_duration, form_schema, required_documents, document_schema, applicant_type, channel, mode, source_quality, notes, payment_mode, active, source_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DISABLED', 1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET department_id = excluded.department_id, name = excluded.name, category = excluded.category, description = excluded.description,
       fee_iqd = excluded.fee_iqd, fee_status = excluded.fee_status, fee_source = excluded.fee_source, estimated_duration = excluded.estimated_duration,
       form_schema = excluded.form_schema, required_documents = excluded.required_documents, document_schema = excluded.document_schema,
       applicant_type = excluded.applicant_type, channel = excluded.channel, mode = excluded.mode, source_quality = excluded.source_quality,
       notes = excluded.notes, source_url = excluded.source_url, updated_at = excluded.updated_at`
  )
  db.exec('BEGIN')
  try {
    for (const definition of serviceDefinitions) {
      const departmentId = legacyDepartmentId(definition.key, definition.department)
      if (!departmentId) continue
      const docs = legacyDocuments(definition.requirements)
      statement.run(
        definition.key,
        departmentId,
        definition.title,
        definition.category,
        definition.description,
        definition.fee,
        definition.fee > 0 ? 'UNVERIFIED' : 'NOT_REQUIRED',
        null,
        definition.estimatedTime,
        JSON.stringify(definition.fields),
        JSON.stringify(definition.requirements),
        JSON.stringify(docs),
        'BOTH',
        definition.mode === 'EXTERNAL'
          ? 'INFORMATION_ONLY'
          : definition.mode === 'APPOINTMENT'
            ? 'APPOINTMENT_REQUIRED'
            : 'ONLINE_SUBMISSION',
        definition.mode,
        'RELIABLE',
        definition.boundaryNote || '',
        definition.officialLinks?.[0]?.url || departmentById.get(departmentId)?.sourceUrl || '',
        timestamp,
        timestamp
      )
    }
    const legacyKeys = new Set(serviceDefinitions.map(item => item.key))
    for (const item of registry) {
      if (legacyKeys.has(item.key) || !departmentById.has(item.departmentId)) continue
      statement.run(
        item.key,
        item.departmentId,
        item.title,
        item.category,
        item.description,
        item.feeIqd ?? 0,
        item.feeIqd ? 'OFFICIAL' : 'NOT_REQUIRED',
        item.feeSource,
        item.estimatedDuration,
        JSON.stringify(item.fields),
        JSON.stringify(item.requiredDocuments.map(doc => doc.label)),
        JSON.stringify(item.requiredDocuments),
        item.applicantType,
        item.channel,
        'CATALOG',
        item.sourceQuality,
        item.notes,
        item.sourceUrl,
        timestamp,
        timestamp
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

const parseJson = <T>(value: unknown, fallback: T): T => {
  try {
    return value ? (JSON.parse(String(value)) as T) : fallback
  } catch {
    return fallback
  }
}

function mapRow(row: Record<string, unknown>): CatalogService {
  const documents = parseJson<CatalogDocument[]>(row.document_schema, [])
  return {
    key: String(row.id),
    departmentId: String(row.department_id),
    departmentName: String(row.department_name || departmentById.get(String(row.department_id))?.name || ''),
    title: String(row.name),
    description: String(row.description || ''),
    category: String(row.category),
    applicantType: (String(row.applicant_type || 'BOTH') as CatalogService['applicantType']) || 'BOTH',
    channel: (String(row.channel || 'ONLINE_SUBMISSION') as ServiceChannel) || 'ONLINE_SUBMISSION',
    mode: (String(row.mode || 'CATALOG') as ServiceMode) || 'CATALOG',
    requiredDocuments: documents,
    fields: parseJson<CatalogField[]>(row.form_schema, []),
    feeIqd: Number(row.fee_iqd || 0) > 0 ? Number(row.fee_iqd) : null,
    feeStatus: (String(row.fee_status || 'NOT_REQUIRED') as CatalogService['feeStatus']) || 'NOT_REQUIRED',
    feeSource: row.fee_source ? String(row.fee_source) : null,
    estimatedDuration: row.estimated_duration ? String(row.estimated_duration) : null,
    sourceUrl: String(row.source_url || ''),
    sourceQuality: (String(row.source_quality || 'UNVERIFIED') as CatalogService['sourceQuality']) || 'UNVERIFIED',
    notes: String(row.notes || ''),
    active: Boolean(row.active),
    updatedAt: String(row.updated_at),
  }
}

const baseSelect = `SELECT sc.*, d.name AS department_name FROM service_catalog sc JOIN departments d ON d.id = sc.department_id`

export function getCatalogService(key: string): CatalogService | null {
  const row = db.prepare(`${baseSelect} WHERE sc.id = ?`).get(key) as Record<string, unknown> | undefined
  return row ? mapRow(row) : null
}

export function listCatalogServices(
  filter: {
    query?: string
    category?: string
    departmentId?: string
    channel?: ServiceChannel
    activeOnly?: boolean
  } = {}
) {
  const where: string[] = []
  const values: Array<string | number> = []
  if (filter.category) {
    where.push('sc.category = ?')
    values.push(filter.category)
  }
  if (filter.departmentId) {
    where.push('sc.department_id = ?')
    values.push(filter.departmentId)
  }
  if (filter.channel) {
    where.push('sc.channel = ?')
    values.push(filter.channel)
  }
  if (filter.activeOnly !== false) where.push('sc.active = 1')
  const rows = db
    .prepare(`${baseSelect} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.name, sc.name`)
    .all(...values) as Array<Record<string, unknown>>
  const items = rows.map(mapRow)
  const tokens = normalizeArabic(filter.query || '')
    .split(' ')
    .filter(token => token.length > 1)
  if (!tokens.length) return items
  return items.filter(item => {
    const text = normalizeArabic(
      `${item.title} ${item.description} ${item.departmentName} ${item.category} ${item.requiredDocuments.map(doc => doc.label).join(' ')}`
    )
    return tokens.every(token => text.includes(token))
  })
}

export function catalogSummary() {
  const rows = db
    .prepare(
      `SELECT category, channel, COUNT(*) AS total FROM service_catalog WHERE active = 1 GROUP BY category, channel`
    )
    .all() as Array<{ category: string; channel: string; total: number }>
  const byCategory = new Map<string, number>()
  const byChannel = new Map<string, number>()
  for (const row of rows) {
    byCategory.set(row.category, (byCategory.get(row.category) || 0) + Number(row.total))
    byChannel.set(row.channel, (byChannel.get(row.channel) || 0) + Number(row.total))
  }
  return {
    total: rows.reduce((sum, row) => sum + Number(row.total), 0),
    categories: [...byCategory.entries()].map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total),
    channels: Object.fromEntries(byChannel),
  }
}

export function normalizeArabic(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ئ/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
