import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const defaultDatabasePath = join(currentDir, '..', 'data', 'dhiqar-demo.sqlite')
const databasePath = process.env.DATABASE_PATH?.trim() || defaultDatabasePath
mkdirSync(dirname(databasePath), { recursive: true })

export const db = new DatabaseSync(databasePath)
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')

db.exec(`
  CREATE TABLE IF NOT EXISTS citizens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    national_id_masked TEXT NOT NULL,
    phone_masked TEXT NOT NULL,
    verification_status TEXT NOT NULL,
    district TEXT NOT NULL,
    consent_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    citizen_id INTEGER NOT NULL,
    citizen_name TEXT NOT NULL,
    service_key TEXT NOT NULL,
    service_name TEXT NOT NULL,
    department TEXT NOT NULL,
    status TEXT NOT NULL,
    current_action TEXT NOT NULL,
    business_name TEXT NOT NULL,
    activity_type TEXT NOT NULL,
    address TEXT NOT NULL,
    district TEXT NOT NULL,
    ownership_type TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    fee INTEGER NOT NULL DEFAULT 0,
    payment_status TEXT NOT NULL DEFAULT 'PENDING',
    required_document TEXT,
    document_number TEXT,
    verification_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (citizen_id) REFERENCES citizens(id)
  );

  CREATE TABLE IF NOT EXISTS application_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL,
    receipt_number TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (application_id) REFERENCES applications(id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    role TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    previous_value TEXT,
    new_value TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
  );
`)

const now = () => new Date().toISOString()

export function ensureDemoCitizen() {
  const existing = db.prepare('SELECT id FROM citizens LIMIT 1').get() as { id: number } | undefined
  if (existing) return existing.id
  const timestamp = now()
  const result = db.prepare(`
    INSERT INTO citizens (full_name, national_id_masked, phone_masked, verification_status, district, consent_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('مهاب علي ياسين', '********** 4821', '0780***4567', 'VERIFIED', 'الناصرية', timestamp, timestamp, timestamp)
  return Number(result.lastInsertRowid)
}

export function addAudit(input: {
  actor: string
  role: string
  action: string
  entityType: string
  entityId: string
  previousValue?: unknown
  newValue?: unknown
  metadata?: unknown
}) {
  db.prepare(`
    INSERT INTO audit_logs (actor, role, action, entity_type, entity_id, previous_value, new_value, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.actor,
    input.role,
    input.action,
    input.entityType,
    input.entityId,
    input.previousValue ? JSON.stringify(input.previousValue) : null,
    input.newValue ? JSON.stringify(input.newValue) : null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    now(),
  )
}

export function addEvent(applicationId: number, input: { type: string; title: string; description: string; actor: string }) {
  db.prepare(`
    INSERT INTO application_events (application_id, type, title, description, actor, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(applicationId, input.type, input.title, input.description, input.actor, now())
}

export function getCitizen() {
  ensureDemoCitizen()
  const row = db.prepare('SELECT * FROM citizens LIMIT 1').get() as Record<string, unknown>
  return {
    id: row.id,
    fullName: row.full_name,
    nationalIdMasked: row.national_id_masked,
    phoneMasked: row.phone_masked,
    verificationStatus: row.verification_status,
    district: row.district,
    createdAt: row.created_at,
  }
}

export function getApplications() {
  const rows = db.prepare('SELECT * FROM applications ORDER BY id DESC').all() as Array<Record<string, unknown>>
  return rows.map(mapApplication)
}

export function getApplicationByReference(reference: string) {
  const row = db.prepare('SELECT * FROM applications WHERE reference = ?').get(reference) as Record<string, unknown> | undefined
  return row ? mapApplication(row) : null
}

export function getApplicationByVerificationId(verificationId: string) {
  const row = db.prepare('SELECT * FROM applications WHERE verification_id = ? AND status = ?').get(verificationId, 'APPROVED') as Record<string, unknown> | undefined
  return row ? mapApplication(row) : null
}

function mapApplication(row: Record<string, unknown>) {
  const events = db.prepare('SELECT * FROM application_events WHERE application_id = ? ORDER BY id ASC').all(row.id) as Array<Record<string, unknown>>
  return {
    id: row.id,
    reference: row.reference,
    citizenId: row.citizen_id,
    citizenName: row.citizen_name,
    serviceKey: row.service_key,
    serviceName: row.service_name,
    department: row.department,
    status: row.status,
    currentAction: row.current_action,
    businessName: row.business_name,
    activityType: row.activity_type,
    address: row.address,
    district: row.district,
    ownershipType: row.ownership_type,
    coordinates: { lat: row.lat, lng: row.lng },
    fee: row.fee,
    paymentStatus: row.payment_status,
    requiredDocument: row.required_document,
    documentNumber: row.document_number,
    verificationId: row.verification_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events: events.map(event => ({
      id: event.id,
      type: event.type,
      title: event.title,
      description: event.description,
      actor: event.actor,
      createdAt: event.created_at,
    })),
  }
}

export function resetDemo() {
  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM payments; DELETE FROM application_events; DELETE FROM applications; DELETE FROM audit_logs;')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

ensureDemoCitizen()
