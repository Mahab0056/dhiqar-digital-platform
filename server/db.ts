import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
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
    account_key TEXT,
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

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    citizen_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (citizen_id) REFERENCES citizens(id) ON DELETE CASCADE
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

  CREATE TABLE IF NOT EXISTS live_presence (
    session_id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    session_subject TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_live_presence_role_seen ON live_presence(role, last_seen_at);

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

  CREATE TABLE IF NOT EXISTS issued_documents (
    id TEXT PRIMARY KEY,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('APPLICATION', 'SERVICE_REQUEST')),
    application_reference TEXT UNIQUE,
    service_request_reference TEXT UNIQUE,
    citizen_id INTEGER NOT NULL,
    service_name TEXT NOT NULL,
    department_name TEXT NOT NULL,
    document_title TEXT NOT NULL,
    document_number TEXT NOT NULL UNIQUE,
    verification_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'REVOKED')),
    pdf_media_id TEXT NOT NULL UNIQUE,
    issued_by TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    revoked_at TEXT,
    revoked_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (citizen_id) REFERENCES citizens(id),
    FOREIGN KEY (pdf_media_id) REFERENCES media_objects(id)
  );
  CREATE INDEX IF NOT EXISTS idx_issued_documents_citizen ON issued_documents(citizen_id, issued_at DESC);
  CREATE INDEX IF NOT EXISTS idx_issued_documents_verify ON issued_documents(verification_id, status);

  CREATE TABLE IF NOT EXISTS identity_reviews (
    id TEXT PRIMARY KEY,
    citizen_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    national_id_masked TEXT,
    id_front_media_id TEXT,
    id_back_media_id TEXT,
    face_video_media_id TEXT,
    quality_status TEXT NOT NULL DEFAULT 'PENDING',
    quality_score INTEGER,
    quality_checks TEXT,
    face_match_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    face_match_score REAL,
    face_match_provider TEXT,
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

  CREATE TABLE IF NOT EXISTS department_workforce_snapshots (
    id TEXT PRIMARY KEY,
    department_id TEXT NOT NULL,
    total_employees INTEGER NOT NULL CHECK(total_employees >= 0),
    present_employees INTEGER NOT NULL CHECK(present_employees >= 0),
    absent_employees INTEGER NOT NULL CHECK(absent_employees >= 0),
    source_name TEXT NOT NULL,
    source_url TEXT,
    authorization_status TEXT NOT NULL DEFAULT 'RECORDED_BY_SUPER_ADMIN',
    observed_at TEXT NOT NULL,
    recorded_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (department_id) REFERENCES departments(id)
  );

  CREATE TABLE IF NOT EXISTS department_cameras (
    id TEXT PRIMARY KEY,
    department_id TEXT NOT NULL,
    label TEXT NOT NULL,
    stream_type TEXT NOT NULL CHECK(stream_type IN ('HLS', 'WEBRTC')),
    gateway_url TEXT,
    enabled INTEGER NOT NULL DEFAULT 0,
    authorization_status TEXT NOT NULL DEFAULT 'AWAITING_AUTHORIZATION',
    source_name TEXT,
    source_url TEXT,
    last_checked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (department_id) REFERENCES departments(id)
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

  CREATE TABLE IF NOT EXISTS service_request_media (
    id TEXT PRIMARY KEY,
    service_request_id INTEGER NOT NULL,
    media_id TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (service_request_id) REFERENCES service_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (media_id) REFERENCES media_objects(id)
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    citizen_id INTEGER NOT NULL,
    service_request_id INTEGER NOT NULL,
    department TEXT NOT NULL,
    purpose TEXT NOT NULL,
    preferred_date TEXT NOT NULL,
    preferred_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'REQUESTED',
    confirmation_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (citizen_id) REFERENCES citizens(id),
    FOREIGN KEY (service_request_id) REFERENCES service_requests(id) ON DELETE CASCADE
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

  CREATE TABLE IF NOT EXISTS citizen_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    citizen_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('COMPLAINT', 'SUGGESTION')),
    category TEXT NOT NULL,
    department_id TEXT,
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    district TEXT,
    lat REAL,
    lng REAL,
    status TEXT NOT NULL DEFAULT 'RECEIVED',
    current_action TEXT NOT NULL,
    admin_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (citizen_id) REFERENCES citizens(id),
    FOREIGN KEY (department_id) REFERENCES departments(id)
  );

  CREATE TABLE IF NOT EXISTS feedback_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feedback_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (feedback_id) REFERENCES citizen_feedback(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS feedback_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feedback_id INTEGER NOT NULL,
    media_id TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (feedback_id) REFERENCES citizen_feedback(id) ON DELETE CASCADE,
    FOREIGN KEY (media_id) REFERENCES media_objects(id)
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

  CREATE TABLE IF NOT EXISTS government_service_directory (
    id TEXT PRIMARY KEY,
    canonical_service_id TEXT NOT NULL UNIQUE,
    official_name_ar TEXT NOT NULL,
    short_name_ar TEXT,
    citizen_friendly_name TEXT,
    alternative_search_names TEXT NOT NULL DEFAULT '[]',
    description TEXT,
    category TEXT NOT NULL,
    subcategory TEXT,
    beneficiary_types TEXT NOT NULL DEFAULT '[]',
    responsible_ministry TEXT,
    responsible_authority TEXT,
    responsible_department TEXT,
    responsible_section TEXT,
    administrative_level TEXT NOT NULL DEFAULT 'OTHER_GOVERNMENT_ENTITY',
    available_in_dhi_qar INTEGER NOT NULL DEFAULT 0,
    available_nationwide INTEGER NOT NULL DEFAULT 0,
    dhi_qar_responsible_entity TEXT,
    dhi_qar_office TEXT,
    dhi_qar_location TEXT,
    dhi_qar_gis_status TEXT NOT NULL DEFAULT 'NOT_VERIFIED',
    service_type TEXT NOT NULL DEFAULT 'INFORMATION_ONLY',
    application_channel TEXT NOT NULL DEFAULT 'INFORMATION_ONLY',
    existing_service_key TEXT,
    external_service_url TEXT,
    integration_available INTEGER NOT NULL DEFAULT 0,
    api_available INTEGER NOT NULL DEFAULT 0,
    sso_possible INTEGER NOT NULL DEFAULT 0,
    required_documents TEXT NOT NULL DEFAULT '[]',
    required_information TEXT NOT NULL DEFAULT '[]',
    eligibility_conditions TEXT NOT NULL DEFAULT '[]',
    fee_details TEXT NOT NULL DEFAULT '[]',
    processing_time TEXT,
    processing_time_status TEXT NOT NULL DEFAULT 'NOT_PUBLISHED',
    citizen_steps TEXT NOT NULL DEFAULT '[]',
    internal_workflow TEXT NOT NULL DEFAULT '[]',
    approval_requirements TEXT NOT NULL DEFAULT '[]',
    physical_presence_required INTEGER NOT NULL DEFAULT 0,
    physical_presence_details TEXT,
    inspection_required INTEGER NOT NULL DEFAULT 0,
    inspection_details TEXT,
    appointment_required INTEGER NOT NULL DEFAULT 0,
    appointment_url TEXT,
    service_output TEXT,
    digital_document_available INTEGER NOT NULL DEFAULT 0,
    physical_document_required INTEGER NOT NULL DEFAULT 0,
    qr_verification_available INTEGER NOT NULL DEFAULT 0,
    legal_basis TEXT NOT NULL DEFAULT '[]',
    verification_status TEXT NOT NULL DEFAULT 'REQUIRES_MANUAL_VERIFICATION',
    effective_date TEXT,
    last_verified_date TEXT,
    source_date TEXT,
    publication_status TEXT NOT NULL DEFAULT 'DRAFT',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS government_service_sources (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    authority_name TEXT NOT NULL,
    official_url TEXT NOT NULL,
    page_title TEXT,
    date_accessed TEXT NOT NULL,
    date_published TEXT,
    last_verified_date TEXT,
    verification_status TEXT NOT NULL,
    source_note TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(service_id, official_url),
    FOREIGN KEY (service_id) REFERENCES government_service_directory(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS government_service_versions (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL,
    change_type TEXT NOT NULL,
    changed_by TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    previous_value TEXT,
    new_value TEXT,
    reason TEXT,
    source_url TEXT,
    approval_status TEXT NOT NULL DEFAULT 'DRAFT',
    FOREIGN KEY (service_id) REFERENCES government_service_directory(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_government_service_publication ON government_service_directory(publication_status, active, category);
  CREATE INDEX IF NOT EXISTS idx_government_service_dhiqar ON government_service_directory(available_in_dhi_qar, publication_status);
  CREATE INDEX IF NOT EXISTS idx_government_service_sources_service ON government_service_sources(service_id, last_verified_date DESC);
  CREATE INDEX IF NOT EXISTS idx_government_service_versions_service ON government_service_versions(service_id, changed_at DESC);

  CREATE INDEX IF NOT EXISTS idx_notifications_citizen ON notifications(citizen_id, read_at, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_otp_phone_hash ON otp_challenges(phone_hash, created_at);
  CREATE INDEX IF NOT EXISTS idx_media_citizen ON media_objects(citizen_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_application_media_application ON application_media(application_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_identity_status ON identity_reviews(status, submitted_at);
  CREATE INDEX IF NOT EXISTS idx_department_cameras_department ON department_cameras(department_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_workforce_snapshots_department ON department_workforce_snapshots(department_id, observed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_service_requests_citizen ON service_requests(citizen_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_service_requests_department ON service_requests(department_id, status);
  CREATE INDEX IF NOT EXISTS idx_service_request_media_request ON service_request_media(service_request_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_appointments_citizen ON appointments(citizen_id, status, preferred_date);
  CREATE INDEX IF NOT EXISTS idx_news_published ON news_articles(published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_feedback_citizen ON citizen_feedback(citizen_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_feedback_department ON citizen_feedback(department_id, status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_feedback_events ON feedback_events(feedback_id, created_at ASC);
`)

const ensureColumn = (table: string, column: string, definition: string) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some(item => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

ensureColumn('identity_reviews', 'quality_status', "TEXT NOT NULL DEFAULT 'PENDING'")
ensureColumn('identity_reviews', 'quality_score', 'INTEGER')
ensureColumn('identity_reviews', 'quality_checks', 'TEXT')
ensureColumn('identity_reviews', 'face_match_status', "TEXT NOT NULL DEFAULT 'NOT_CONFIGURED'")
ensureColumn('identity_reviews', 'face_match_score', 'REAL')
ensureColumn('identity_reviews', 'face_match_provider', 'TEXT')
ensureColumn('citizens', 'account_key', 'TEXT')
ensureColumn('service_requests', 'decision_note', 'TEXT')
ensureColumn('service_requests', 'required_document', 'TEXT')
ensureColumn('government_service_directory', 'existing_service_key', 'TEXT')
ensureColumn('media_objects', 'retention_policy', "TEXT NOT NULL DEFAULT 'TIME_LIMITED'")
ensureColumn('media_objects', 'retention_consent_at', 'TEXT')
ensureColumn('citizens', 'document_type', 'TEXT')
ensureColumn('citizens', 'profile_media_id', 'TEXT')
ensureColumn('citizens', 'location_lat', 'REAL')
ensureColumn('citizens', 'location_lng', 'REAL')
ensureColumn('citizens', 'location_accuracy_m', 'REAL')
ensureColumn('citizens', 'location_updated_at', 'TEXT')
ensureColumn('citizens', 'location_consent_at', 'TEXT')
ensureColumn('identity_reviews', 'document_type', "TEXT NOT NULL DEFAULT 'NATIONAL_ID'")
ensureColumn('identity_reviews', 'retention_consent_at', 'TEXT')
ensureColumn('identity_reviews', 'analysis_consent_at', 'TEXT')
ensureColumn('identity_reviews', 'analysis_status', "TEXT NOT NULL DEFAULT 'NOT_REQUESTED'")
ensureColumn('identity_reviews', 'extracted_data', 'TEXT')
ensureColumn('identity_reviews', 'extraction_provider', 'TEXT')
ensureColumn('identity_reviews', 'extraction_confidence', 'REAL')
ensureColumn('identity_reviews', 'profile_photo_media_id', 'TEXT')
ensureColumn('identity_reviews', 'location_lat', 'REAL')
ensureColumn('identity_reviews', 'location_lng', 'REAL')
ensureColumn('identity_reviews', 'location_accuracy_m', 'REAL')
ensureColumn('identity_reviews', 'location_consent_at', 'TEXT')
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_citizens_account_key ON citizens(account_key) WHERE account_key IS NOT NULL')

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

export function createNotification(input: { citizenId: number; type: string; title: string; message: string; link?: string }) {
  const id = `ntf_${randomUUID().replaceAll('-', '')}`
  db.prepare(`INSERT INTO notifications (id, citizen_id, type, title, message, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.citizenId, input.type, input.title, input.message, input.link || null, now())
  return id
}

export function getCitizenNotifications(citizenId: number, limit = 50) {
  const rows = db.prepare(`SELECT id, type, title, message, link, read_at, created_at FROM notifications WHERE citizen_id = ? ORDER BY created_at DESC LIMIT ?`).all(citizenId, limit) as Array<Record<string, unknown>>
  const unread = (db.prepare('SELECT COUNT(*) AS total FROM notifications WHERE citizen_id = ? AND read_at IS NULL').get(citizenId) as { total: number }).total
  return { unread, items: rows.map(row => ({ id: row.id, type: row.type, title: row.title, message: row.message, link: row.link, readAt: row.read_at, createdAt: row.created_at })) }
}

export function markNotificationRead(citizenId: number, notificationId: string) {
  const result = db.prepare('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND citizen_id = ?').run(now(), notificationId, citizenId)
  return result.changes > 0
}

export function markAllNotificationsRead(citizenId: number) {
  const result = db.prepare('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE citizen_id = ?').run(now(), citizenId)
  return Number(result.changes)
}

function mapCitizen(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    fullName: String(row.full_name),
    nationalIdMasked: String(row.national_id_masked),
    phoneMasked: String(row.phone_masked),
    verificationStatus: String(row.verification_status),
    district: String(row.district),
    documentType: row.document_type ? String(row.document_type) : null,
    profileMediaId: row.profile_media_id ? String(row.profile_media_id) : null,
    createdAt: String(row.created_at),
  }
}

export function getCitizenById(id: number) {
  const row = db.prepare('SELECT * FROM citizens WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? mapCitizen(row) : null
}

export function getOrCreateCitizen(accountKey: string, phoneMasked: string) {
  const existing = db.prepare('SELECT * FROM citizens WHERE account_key = ?').get(accountKey) as Record<string, unknown> | undefined
  if (existing) return mapCitizen(existing)
  const timestamp = now()
  const result = db.prepare(`
    INSERT INTO citizens (full_name, national_id_masked, phone_masked, account_key, verification_status, district, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('مواطن جديد', 'لم تُقدَّم الهوية', phoneMasked, accountKey, 'PHONE_VERIFIED', 'غير محدد', timestamp, timestamp)
  return getCitizenById(Number(result.lastInsertRowid))!
}

// يُستخدم فقط لتشغيل بيانات العرض القديمة؛ لا يُستخدم لتحديد هوية جلسة مواطن.
export function getCitizen() {
  ensureDemoCitizen()
  const row = db.prepare('SELECT * FROM citizens LIMIT 1').get() as Record<string, unknown>
  return mapCitizen(row)
}

export function getApplications() {
  const rows = db.prepare('SELECT * FROM applications ORDER BY id DESC').all() as Array<Record<string, unknown>>
  return rows.map(mapApplication)
}

export function getApplicationsForCitizen(citizenId: number) {
  const rows = db.prepare('SELECT * FROM applications WHERE citizen_id = ? ORDER BY id DESC').all(citizenId) as Array<Record<string, unknown>>
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

export type FeedbackKind = 'COMPLAINT' | 'SUGGESTION'
export type FeedbackStatus = 'RECEIVED' | 'IN_REVIEW' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'

const feedbackReference = (kind: FeedbackKind) => `${kind === 'COMPLAINT' ? 'TQD-CMP' : 'TQD-SUG'}-${new Date().getFullYear()}-${String((db.prepare('SELECT COUNT(*) AS total FROM citizen_feedback').get() as { total: number }).total + 1).padStart(5, '0')}`

function mapFeedback(row: Record<string, unknown>) {
  const events = db.prepare('SELECT id, status, title, description, actor, created_at FROM feedback_events WHERE feedback_id = ? ORDER BY id ASC').all(row.id) as Array<Record<string, unknown>>
  const attachments = db.prepare(`SELECT fm.id, fm.label, mo.id AS media_id, mo.original_name, mo.mime_type, mo.size_bytes, mo.deleted_at
    FROM feedback_media fm JOIN media_objects mo ON mo.id = fm.media_id WHERE fm.feedback_id = ? ORDER BY fm.id ASC`).all(row.id) as Array<Record<string, unknown>>
  return {
    id: Number(row.id), reference: String(row.reference), citizenId: Number(row.citizen_id), kind: String(row.kind), category: String(row.category), departmentId: row.department_id ? String(row.department_id) : null,
    subject: String(row.subject), description: String(row.description), district: row.district ? String(row.district) : null,
    coordinates: row.lat !== null && row.lng !== null ? { lat: Number(row.lat), lng: Number(row.lng) } : null,
    status: String(row.status), currentAction: String(row.current_action), adminNote: row.admin_note ? String(row.admin_note) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    attachments: attachments.map(item => ({ id: Number(item.id), mediaId: String(item.media_id), label: String(item.label), originalName: String(item.original_name), mimeType: String(item.mime_type), sizeBytes: Number(item.size_bytes), available: !item.deleted_at })),
    events: events.map(event => ({ id: Number(event.id), status: String(event.status), title: String(event.title), description: String(event.description), actor: String(event.actor), createdAt: String(event.created_at) })),
  }
}

export function createFeedback(input: { citizenId: number; kind: FeedbackKind; category: string; departmentId?: string; subject: string; description: string; district?: string; lat?: number; lng?: number }) {
  const timestamp = now()
  const reference = feedbackReference(input.kind)
  const currentAction = input.kind === 'COMPLAINT' ? 'تم استلام الشكوى وتحويلها إلى الجهة المختصة.' : 'تم استلام المقترح وإحالته للمراجعة.'
  const result = db.prepare(`INSERT INTO citizen_feedback (reference, citizen_id, kind, category, department_id, subject, description, district, lat, lng, status, current_action, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?, ?)`)
    .run(reference, input.citizenId, input.kind, input.category, input.departmentId || null, input.subject, input.description, input.district || null, input.lat ?? null, input.lng ?? null, currentAction, timestamp, timestamp)
  const id = Number(result.lastInsertRowid)
  db.prepare('INSERT INTO feedback_events (feedback_id, status, title, description, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, 'RECEIVED', input.kind === 'COMPLAINT' ? 'تم تسجيل الشكوى' : 'تم تسجيل المقترح', currentAction, 'منصة ذي قار الرقمية', timestamp)
  return getFeedbackById(id)!
}

export function attachFeedbackMedia(feedbackId: number, mediaId: string, label: string) {
  db.prepare('INSERT INTO feedback_media (feedback_id, media_id, label, created_at) VALUES (?, ?, ?, ?)').run(feedbackId, mediaId, label, now())
}

export function getFeedbackById(id: number) {
  const row = db.prepare('SELECT * FROM citizen_feedback WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? mapFeedback(row) : null
}

export function getFeedbackForCitizen(citizenId: number) {
  const rows = db.prepare('SELECT * FROM citizen_feedback WHERE citizen_id = ? ORDER BY updated_at DESC').all(citizenId) as Array<Record<string, unknown>>
  return rows.map(mapFeedback)
}

export function getFeedbackByReference(reference: string) {
  const row = db.prepare('SELECT * FROM citizen_feedback WHERE reference = ?').get(reference) as Record<string, unknown> | undefined
  return row ? mapFeedback(row) : null
}

export function getFeedbackForAdmin() {
  const rows = db.prepare('SELECT * FROM citizen_feedback ORDER BY CASE status WHEN \'RECEIVED\' THEN 0 WHEN \'IN_REVIEW\' THEN 1 WHEN \'IN_PROGRESS\' THEN 2 ELSE 3 END, updated_at DESC').all() as Array<Record<string, unknown>>
  return rows.map(mapFeedback)
}

export function updateFeedbackStatus(feedbackId: number, input: { status: FeedbackStatus; currentAction: string; adminNote?: string; actor: string }) {
  const timestamp = now()
  db.prepare('UPDATE citizen_feedback SET status = ?, current_action = ?, admin_note = ?, updated_at = ? WHERE id = ?')
    .run(input.status, input.currentAction, input.adminNote || null, timestamp, feedbackId)
  db.prepare('INSERT INTO feedback_events (feedback_id, status, title, description, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(feedbackId, input.status, `تحديث الحالة: ${input.status}`, input.currentAction, input.actor, timestamp)
  return getFeedbackById(feedbackId)
}

export function resetDemo() {
  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM payments; DELETE FROM notifications; DELETE FROM application_events; DELETE FROM applications; DELETE FROM audit_logs;')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

ensureDemoCitizen()
