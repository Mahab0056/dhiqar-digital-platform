import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const defaultDatabasePath = join(currentDir, '..', 'data', 'dhiqar-demo.sqlite')
const railwayVolumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim()
const databasePath = process.env.DATABASE_PATH?.trim()
  || (railwayVolumePath ? join(railwayVolumePath, 'dhiqar-demo.sqlite') : defaultDatabasePath)
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

  CREATE TABLE IF NOT EXISTS otp_challenges (
    id TEXT PRIMARY KEY,
    phone_hash TEXT NOT NULL,
    phone_masked TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    sms_id TEXT,
    delivery_status TEXT NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    expires_at TEXT NOT NULL,
    verified_at TEXT,
    created_ip_hash TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS media_objects (
    id TEXT PRIMARY KEY,
    citizen_id INTEGER NOT NULL,
    purpose TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    encrypted INTEGER NOT NULL DEFAULT 1,
    expires_at TEXT NOT NULL,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (citizen_id) REFERENCES citizens(id)
  );

  CREATE TABLE IF NOT EXISTS application_media (
    id TEXT PRIMARY KEY,
    application_id INTEGER NOT NULL,
    media_id TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
    FOREIGN KEY (media_id) REFERENCES media_objects(id)
  );

  CREATE TABLE IF NOT EXISTS identity_reviews (
    id TEXT PRIMARY KEY,
    citizen_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    national_id_masked TEXT,
    id_front_media_id TEXT,
    id_back_media_id TEXT,
    face_video_media_id TEXT,
    consent_at TEXT NOT NULL,
    submitted_at TEXT,
    reviewed_at TEXT,
    reviewed_by TEXT,
    review_notes TEXT,
    retention_until TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (citizen_id) REFERENCES citizens(id),
    FOREIGN KEY (id_front_media_id) REFERENCES media_objects(id),
    FOREIGN KEY (id_back_media_id) REFERENCES media_objects(id),
    FOREIGN KEY (face_video_media_id) REFERENCES media_objects(id)
  );

  CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    district TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    website TEXT,
    lat REAL,
    lng REAL,
    operational_status TEXT NOT NULL DEFAULT 'UNKNOWN',
    data_status TEXT NOT NULL DEFAULT 'NEEDS_VERIFICATION',
    source_url TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS service_catalog (
    id TEXT PRIMARY KEY,
    department_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    fee_iqd INTEGER NOT NULL DEFAULT 0,
    fee_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
    estimated_duration TEXT,
    form_schema TEXT NOT NULL,
    required_documents TEXT NOT NULL,
    payment_mode TEXT NOT NULL DEFAULT 'SANDBOX',
    active INTEGER NOT NULL DEFAULT 1,
    source_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (department_id) REFERENCES departments(id)
  );

  CREATE TABLE IF NOT EXISTS service_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    citizen_id INTEGER NOT NULL,
    service_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    status TEXT NOT NULL,
    form_data TEXT NOT NULL,
    identity_review_id TEXT,
    payment_intent_id TEXT,
    current_action TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (citizen_id) REFERENCES citizens(id),
    FOREIGN KEY (service_id) REFERENCES service_catalog(id),
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (identity_review_id) REFERENCES identity_reviews(id)
  );

  CREATE TABLE IF NOT EXISTS payment_intents (
    id TEXT PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    citizen_id INTEGER NOT NULL,
    service_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    amount_iqd INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'CREATED',
    mode TEXT NOT NULL DEFAULT 'SANDBOX',
    provider TEXT,
    provider_reference TEXT,
    receipt_number TEXT,
    paid_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (citizen_id) REFERENCES citizens(id),
    FOREIGN KEY (service_id) REFERENCES service_catalog(id),
    FOREIGN KEY (department_id) REFERENCES departments(id)
  );

  CREATE TABLE IF NOT EXISTS news_articles (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    image_url TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_url TEXT NOT NULL UNIQUE,
    published_at TEXT NOT NULL,
    image_credit TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS public_notices (
    id TEXT PRIMARY KEY,
    notice_type TEXT NOT NULL,
    title TEXT NOT NULL,
    department_id TEXT,
    description TEXT NOT NULL,
    reference_number TEXT,
    publish_at TEXT NOT NULL,
    close_at TEXT,
    document_url TEXT,
    source_url TEXT,
    data_status TEXT NOT NULL DEFAULT 'NEEDS_VERIFICATION',
    created_at TEXT NOT NULL,
    FOREIGN KEY (department_id) REFERENCES departments(id)
  );

  CREATE TABLE IF NOT EXISTS department_revenue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id TEXT NOT NULL,
    amount_iqd INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    source_reference TEXT,
    recorded_at TEXT NOT NULL,
    is_synthetic INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (department_id) REFERENCES departments(id)
  );

  CREATE INDEX IF NOT EXISTS idx_otp_phone_hash ON otp_challenges(phone_hash, created_at);
  CREATE INDEX IF NOT EXISTS idx_media_citizen ON media_objects(citizen_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_application_media_application ON application_media(application_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_identity_status ON identity_reviews(status, submitted_at);
  CREATE INDEX IF NOT EXISTS idx_service_requests_citizen ON service_requests(citizen_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_service_requests_department ON service_requests(department_id, status);
  CREATE INDEX IF NOT EXISTS idx_news_published ON news_articles(published_at DESC);
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
  const attachments = db.prepare(`
    SELECT am.id, am.label, mo.id AS media_id, mo.original_name, mo.mime_type, mo.size_bytes, mo.deleted_at
    FROM application_media am JOIN media_objects mo ON mo.id = am.media_id
    WHERE am.application_id = ? ORDER BY am.created_at ASC
  `).all(row.id) as Array<Record<string, unknown>>
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
    attachments: attachments.map(item => ({ id: item.id, mediaId: item.media_id, label: item.label, originalName: item.original_name, mimeType: item.mime_type, sizeBytes: item.size_bytes, available: !item.deleted_at })),
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
