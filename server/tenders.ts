import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import { normalizeArabic } from './news/text.js'

/**
 * Official tenders (مناقصات) and auctions (مزايدات) published by the governorate's departments.
 * The open/closed state is derived from the closing date, so nothing has to run at the deadline.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS tenders (
    id TEXT PRIMARY KEY,
    reference TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    department_id TEXT,
    entity_name TEXT NOT NULL,
    district TEXT,
    description TEXT NOT NULL DEFAULT '',
    estimated_cost_iqd INTEGER,
    bid_bond TEXT,
    published_at TEXT NOT NULL,
    closing_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'ACTIVE',
    state_note TEXT,
    document_url TEXT,
    source_url TEXT,
    created_by TEXT NOT NULL,
    updated_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tenders_closing ON tenders(closing_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tenders_department ON tenders(department_id);
`)

export type TenderType = 'TENDER' | 'AUCTION'
export type TenderStatus = 'OPEN' | 'CLOSED' | 'CANCELLED' | 'AWARDED'
/** Stored lifecycle; OPEN/CLOSED are derived from closing_at while ACTIVE. */
export type TenderState = 'ACTIVE' | 'CLOSED' | 'CANCELLED' | 'AWARDED'

export type Tender = {
  id: string
  reference: string
  title: string
  type: TenderType
  departmentId: string | null
  entityName: string
  district: string | null
  description: string
  estimatedCostIqd: number | null
  bidBond: string | null
  publishedAt: string
  closingAt: string
  status: TenderStatus
  stateNote: string | null
  documentUrl: string | null
  sourceUrl: string | null
  createdAt: string
  updatedAt: string
}

export function tenderStatus(state: string, closingAt: string, now = Date.now()): TenderStatus {
  if (state === 'CANCELLED' || state === 'AWARDED' || state === 'CLOSED') return state
  return Date.parse(closingAt) <= now ? 'CLOSED' : 'OPEN'
}

type Row = Record<string, unknown>
const text = (value: unknown) => (value === null || value === undefined || value === '' ? null : String(value))

function mapTender(row: Row, now = Date.now()): Tender {
  return {
    id: String(row.id),
    reference: String(row.reference),
    title: String(row.title),
    type: String(row.type) === 'AUCTION' ? 'AUCTION' : 'TENDER',
    departmentId: text(row.department_id),
    entityName: String(row.entity_name),
    district: text(row.district),
    description: String(row.description || ''),
    estimatedCostIqd:
      row.estimated_cost_iqd === null || row.estimated_cost_iqd === undefined ? null : Number(row.estimated_cost_iqd),
    bidBond: text(row.bid_bond),
    publishedAt: String(row.published_at),
    closingAt: String(row.closing_at),
    status: tenderStatus(String(row.state), String(row.closing_at), now),
    stateNote: text(row.state_note),
    documentUrl: text(row.document_url),
    sourceUrl: text(row.source_url),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export function getTender(id: string) {
  const row = db.prepare(`SELECT * FROM tenders WHERE id = ?`).get(id) as Row | undefined
  return row ? mapTender(row) : null
}

const STATUS_ORDER: Record<TenderStatus, number> = { OPEN: 0, AWARDED: 1, CLOSED: 2, CANCELLED: 3 }

export function listTenders(
  filters: {
    status?: TenderStatus
    type?: TenderType
    departmentId?: string
    q?: string
    limit?: number
    offset?: number
    /** public listings only show what has been published (published_at reached) */
    publishedOnly?: boolean
  } = {}
) {
  const now = Date.now()
  const where: string[] = []
  const params: string[] = []
  if (filters.type) {
    where.push('type = ?')
    params.push(filters.type)
  }
  if (filters.departmentId) {
    where.push('department_id = ?')
    params.push(filters.departmentId)
  }
  if (filters.publishedOnly) {
    where.push('published_at <= ?')
    params.push(new Date(now).toISOString())
  }
  const rows = db
    .prepare(`SELECT * FROM tenders ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`)
    .all(...params) as Row[]
  const term = filters.q ? normalizeArabic(filters.q.trim()) : ''
  const items = rows
    .map(row => mapTender(row, now))
    .filter(item => !filters.status || item.status === filters.status)
    .filter(
      item =>
        !term ||
        normalizeArabic(
          `${item.title} ${item.reference} ${item.entityName} ${item.district || ''} ${item.description}`
        ).includes(term)
    )
    // open first (closing soonest), then the rest newest first
    .sort((a, b) =>
      STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]
        ? STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        : a.status === 'OPEN'
          ? a.closingAt.localeCompare(b.closingAt)
          : b.closingAt.localeCompare(a.closingAt)
    )
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
  const offset = Math.max(filters.offset ?? 0, 0)
  const counts = { OPEN: 0, CLOSED: 0, CANCELLED: 0, AWARDED: 0 } as Record<TenderStatus, number>
  for (const item of items) counts[item.status]++
  return { total: items.length, counts, items: items.slice(offset, offset + limit) }
}

/** Entities that have published at least one tender (filter options). */
export function tenderEntities() {
  return (
    db
      .prepare(
        `SELECT COALESCE(department_id, '') AS id, entity_name AS name, COUNT(*) AS count FROM tenders
         WHERE published_at <= ? GROUP BY department_id, entity_name ORDER BY name`
      )
      .all(new Date().toISOString()) as Array<{ id: string; name: string; count: number }>
  ).map(row => ({ id: String(row.id), name: String(row.name), count: Number(row.count) }))
}

export type TenderInput = {
  reference: string
  title: string
  type: TenderType
  departmentId: string | null
  entityName: string
  district: string | null
  description: string
  estimatedCostIqd: number | null
  bidBond: string | null
  publishedAt: string
  closingAt: string
  documentUrl: string | null
  sourceUrl: string | null
}

export function createTender(input: TenderInput, actor: string) {
  const id = `tnd_${randomUUID().replaceAll('-', '').slice(0, 20)}`
  const timestamp = new Date().toISOString()
  db.prepare(
    `INSERT INTO tenders (id, reference, title, type, department_id, entity_name, district, description, estimated_cost_iqd, bid_bond,
      published_at, closing_at, state, document_url, source_url, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.reference,
    input.title,
    input.type,
    input.departmentId,
    input.entityName,
    input.district,
    input.description,
    input.estimatedCostIqd,
    input.bidBond,
    input.publishedAt,
    input.closingAt,
    input.documentUrl,
    input.sourceUrl,
    actor,
    timestamp,
    timestamp
  )
  return getTender(id)!
}

export function updateTender(id: string, input: Partial<TenderInput>, actor: string) {
  const columns: Record<keyof TenderInput, string> = {
    reference: 'reference',
    title: 'title',
    type: 'type',
    departmentId: 'department_id',
    entityName: 'entity_name',
    district: 'district',
    description: 'description',
    estimatedCostIqd: 'estimated_cost_iqd',
    bidBond: 'bid_bond',
    publishedAt: 'published_at',
    closingAt: 'closing_at',
    documentUrl: 'document_url',
    sourceUrl: 'source_url',
  }
  const sets: string[] = []
  const values: Array<string | number | null> = []
  for (const [key, column] of Object.entries(columns) as Array<[keyof TenderInput, string]>) {
    if (input[key] === undefined) continue
    sets.push(`${column} = ?`)
    values.push(input[key] as string | number | null)
  }
  sets.push('updated_by = ?', 'updated_at = ?')
  values.push(actor, new Date().toISOString())
  db.prepare(`UPDATE tenders SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
  return getTender(id)
}

export function setTenderState(id: string, state: TenderState, note: string | null, actor: string) {
  db.prepare(`UPDATE tenders SET state = ?, state_note = ?, updated_by = ?, updated_at = ? WHERE id = ?`).run(
    state,
    note,
    actor,
    new Date().toISOString(),
    id
  )
  return getTender(id)
}
