import { randomUUID } from 'node:crypto'
import { addAudit, db } from './db.js'

export type GovernmentServiceVerification =
  | 'VERIFIED_UR_PORTAL'
  | 'VERIFIED_MINISTRY'
  | 'VERIFIED_GOVERNMENT_AUTHORITY'
  | 'VERIFIED_MULTIPLE_OFFICIAL_SOURCES'
  | 'PARTIALLY_VERIFIED'
  | 'REQUIRES_MANUAL_VERIFICATION'
  | 'OUTDATED_SOURCE'
  | 'NEEDS_UPDATE'

export type GovernmentServicePublication = 'DRAFT' | 'APPROVED' | 'NEEDS_REVIEW' | 'DISABLED'
export type GovernmentServiceDigitalStatus =
  | 'FULLY_DIGITAL'
  | 'PARTIALLY_DIGITAL'
  | 'INFORMATION_ONLY'
  | 'PHYSICAL_ONLY'
  | 'EXTERNAL_DIGITAL_SERVICE'
  | 'INTEGRATION_REQUIRED'

export type GovernmentServiceSource = {
  sourceType: 'UR_PORTAL' | 'MINISTRY' | 'GOVERNMENT_AUTHORITY' | 'GOVERNORATE' | 'OFFICIAL_ENTITY'
  authorityName: string
  officialUrl: string
  pageTitle?: string
  dateAccessed: string
  datePublished?: string
  lastVerifiedDate?: string
  verificationStatus: GovernmentServiceVerification
  sourceNote?: string
}

export type GovernmentServiceRecordInput = {
  canonicalServiceId: string
  officialNameAr: string
  shortNameAr?: string
  citizenFriendlyName?: string
  alternativeSearchNames?: string[]
  description?: string
  category: string
  subcategory?: string
  beneficiaryTypes?: string[]
  responsibleMinistry?: string
  responsibleAuthority?: string
  responsibleDepartment?: string
  responsibleSection?: string
  administrativeLevel?: string
  availableInDhiQar?: boolean
  availableNationwide?: boolean
  dhiQarResponsibleEntity?: string
  dhiQarOffice?: string
  dhiQarLocation?: string
  dhiQarGisStatus?: 'NOT_VERIFIED' | 'VERIFIED'
  serviceType?: GovernmentServiceDigitalStatus
  applicationChannel?: string
  existingServiceKey?: string
  externalServiceUrl?: string
  integrationAvailable?: boolean
  apiAvailable?: boolean
  ssoPossible?: boolean
  requiredDocuments?: unknown[]
  requiredInformation?: unknown[]
  eligibilityConditions?: unknown[]
  feeDetails?: unknown[]
  processingTime?: string
  processingTimeStatus?: 'OFFICIAL' | 'ESTIMATED' | 'NOT_PUBLISHED'
  citizenSteps?: unknown[]
  internalWorkflow?: unknown[]
  approvalRequirements?: unknown[]
  physicalPresenceRequired?: boolean
  physicalPresenceDetails?: string
  inspectionRequired?: boolean
  inspectionDetails?: string
  appointmentRequired?: boolean
  appointmentUrl?: string
  serviceOutput?: string
  digitalDocumentAvailable?: boolean
  physicalDocumentRequired?: boolean
  qrVerificationAvailable?: boolean
  legalBasis?: unknown[]
  verificationStatus: GovernmentServiceVerification
  effectiveDate?: string
  lastVerifiedDate?: string
  sourceDate?: string
  publicationStatus: GovernmentServicePublication
  sources: GovernmentServiceSource[]
}

const timestamp = () => new Date().toISOString()
const json = (value: unknown = []) => JSON.stringify(value)
const readJson = (value: unknown) => {
  try {
    return JSON.parse(String(value || '[]'))
  } catch {
    return []
  }
}
const bool = (value?: boolean) => (value ? 1 : 0)

function mapService(row: Record<string, unknown>, sources: GovernmentServiceSource[] = []) {
  return {
    id: String(row.id),
    canonicalServiceId: String(row.canonical_service_id),
    officialNameAr: String(row.official_name_ar),
    shortNameAr: row.short_name_ar ? String(row.short_name_ar) : null,
    citizenFriendlyName: row.citizen_friendly_name ? String(row.citizen_friendly_name) : null,
    alternativeSearchNames: readJson(row.alternative_search_names),
    description: row.description ? String(row.description) : null,
    category: String(row.category),
    subcategory: row.subcategory ? String(row.subcategory) : null,
    beneficiaryTypes: readJson(row.beneficiary_types),
    responsibleMinistry: row.responsible_ministry ? String(row.responsible_ministry) : null,
    responsibleAuthority: row.responsible_authority ? String(row.responsible_authority) : null,
    responsibleDepartment: row.responsible_department ? String(row.responsible_department) : null,
    responsibleSection: row.responsible_section ? String(row.responsible_section) : null,
    administrativeLevel: String(row.administrative_level),
    availableInDhiQar: Boolean(row.available_in_dhi_qar),
    availableNationwide: Boolean(row.available_nationwide),
    dhiQarResponsibleEntity: row.dhi_qar_responsible_entity ? String(row.dhi_qar_responsible_entity) : null,
    dhiQarOffice: row.dhi_qar_office ? String(row.dhi_qar_office) : null,
    dhiQarLocation: row.dhi_qar_location ? String(row.dhi_qar_location) : null,
    dhiQarGisStatus: String(row.dhi_qar_gis_status),
    serviceType: String(row.service_type),
    applicationChannel: String(row.application_channel),
    existingServiceKey: row.existing_service_key ? String(row.existing_service_key) : null,
    externalServiceUrl: row.external_service_url ? String(row.external_service_url) : null,
    integrationAvailable: Boolean(row.integration_available),
    apiAvailable: Boolean(row.api_available),
    ssoPossible: Boolean(row.sso_possible),
    requiredDocuments: readJson(row.required_documents),
    requiredInformation: readJson(row.required_information),
    eligibilityConditions: readJson(row.eligibility_conditions),
    feeDetails: readJson(row.fee_details),
    processingTime: row.processing_time ? String(row.processing_time) : null,
    processingTimeStatus: String(row.processing_time_status),
    citizenSteps: readJson(row.citizen_steps),
    internalWorkflow: readJson(row.internal_workflow),
    approvalRequirements: readJson(row.approval_requirements),
    physicalPresenceRequired: Boolean(row.physical_presence_required),
    physicalPresenceDetails: row.physical_presence_details ? String(row.physical_presence_details) : null,
    inspectionRequired: Boolean(row.inspection_required),
    inspectionDetails: row.inspection_details ? String(row.inspection_details) : null,
    appointmentRequired: Boolean(row.appointment_required),
    appointmentUrl: row.appointment_url ? String(row.appointment_url) : null,
    serviceOutput: row.service_output ? String(row.service_output) : null,
    digitalDocumentAvailable: Boolean(row.digital_document_available),
    physicalDocumentRequired: Boolean(row.physical_document_required),
    qrVerificationAvailable: Boolean(row.qr_verification_available),
    legalBasis: readJson(row.legal_basis),
    verificationStatus: String(row.verification_status) as GovernmentServiceVerification,
    effectiveDate: row.effective_date ? String(row.effective_date) : null,
    lastVerifiedDate: row.last_verified_date ? String(row.last_verified_date) : null,
    sourceDate: row.source_date ? String(row.source_date) : null,
    publicationStatus: String(row.publication_status) as GovernmentServicePublication,
    active: Boolean(row.active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    sources,
  }
}

function getSources(serviceId: string): GovernmentServiceSource[] {
  const rows = db
    .prepare(
      'SELECT * FROM government_service_sources WHERE service_id = ? ORDER BY last_verified_date DESC, date_accessed DESC'
    )
    .all(serviceId) as Array<Record<string, unknown>>
  return rows.map(row => ({
    sourceType: String(row.source_type) as GovernmentServiceSource['sourceType'],
    authorityName: String(row.authority_name),
    officialUrl: String(row.official_url),
    pageTitle: row.page_title ? String(row.page_title) : undefined,
    dateAccessed: String(row.date_accessed),
    datePublished: row.date_published ? String(row.date_published) : undefined,
    lastVerifiedDate: row.last_verified_date ? String(row.last_verified_date) : undefined,
    verificationStatus: String(row.verification_status) as GovernmentServiceVerification,
    sourceNote: row.source_note ? String(row.source_note) : undefined,
  }))
}

export function getGovernmentService(id: string, includeSources = true) {
  const row = db
    .prepare('SELECT * FROM government_service_directory WHERE id = ? OR canonical_service_id = ?')
    .get(id, id) as Record<string, unknown> | undefined
  return row ? mapService(row, includeSources ? getSources(String(row.id)) : []) : null
}

export function listGovernmentServices(
  input: { query?: string; publicationStatus?: GovernmentServicePublication; dhiQarOnly?: boolean; limit?: number } = {}
) {
  const clauses = ['active = 1']
  const values: Array<string | number> = []
  if (input.publicationStatus) {
    clauses.push('publication_status = ?')
    values.push(input.publicationStatus)
  }
  if (input.dhiQarOnly) clauses.push('available_in_dhi_qar = 1')
  const query = input.query?.trim().toLowerCase()
  if (query) {
    clauses.push(
      "LOWER(official_name_ar || ' ' || COALESCE(short_name_ar, '') || ' ' || COALESCE(citizen_friendly_name, '') || ' ' || alternative_search_names || ' ' || category || ' ' || COALESCE(responsible_authority, '')) LIKE ?"
    )
    values.push(`%${query}%`)
  }
  values.push(Math.max(1, Math.min(input.limit || 100, 500)))
  const rows = db
    .prepare(
      `SELECT * FROM government_service_directory WHERE ${clauses.join(' AND ')} ORDER BY category, official_name_ar LIMIT ?`
    )
    .all(...values) as Array<Record<string, unknown>>
  return rows.map(row => mapService(row, getSources(String(row.id))))
}

export function upsertGovernmentService(input: GovernmentServiceRecordInput, actor = 'SYSTEM_IMPORT') {
  const existing = db
    .prepare('SELECT * FROM government_service_directory WHERE canonical_service_id = ?')
    .get(input.canonicalServiceId) as Record<string, unknown> | undefined
  const id = existing ? String(existing.id) : `govsvc_${randomUUID().replaceAll('-', '')}`
  const changedAt = timestamp()
  const previous = existing ? mapService(existing, []) : null
  db.prepare(
    `INSERT INTO government_service_directory (
    id, canonical_service_id, official_name_ar, short_name_ar, citizen_friendly_name, alternative_search_names, description, category, subcategory, beneficiary_types,
    responsible_ministry, responsible_authority, responsible_department, responsible_section, administrative_level, available_in_dhi_qar, available_nationwide,
    dhi_qar_responsible_entity, dhi_qar_office, dhi_qar_location, dhi_qar_gis_status, service_type, application_channel, existing_service_key, external_service_url,
    integration_available, api_available, sso_possible, required_documents, required_information, eligibility_conditions, fee_details, processing_time, processing_time_status,
    citizen_steps, internal_workflow, approval_requirements, physical_presence_required, physical_presence_details, inspection_required, inspection_details, appointment_required,
    appointment_url, service_output, digital_document_available, physical_document_required, qr_verification_available, legal_basis, verification_status, effective_date,
    last_verified_date, source_date, publication_status, active, created_at, updated_at
  ) VALUES (${Array(56).fill('?').join(', ')})
  ON CONFLICT(canonical_service_id) DO UPDATE SET
    official_name_ar=excluded.official_name_ar, short_name_ar=excluded.short_name_ar, citizen_friendly_name=excluded.citizen_friendly_name, alternative_search_names=excluded.alternative_search_names,
    description=excluded.description, category=excluded.category, subcategory=excluded.subcategory, beneficiary_types=excluded.beneficiary_types, responsible_ministry=excluded.responsible_ministry,
    responsible_authority=excluded.responsible_authority, responsible_department=excluded.responsible_department, responsible_section=excluded.responsible_section, administrative_level=excluded.administrative_level,
    available_in_dhi_qar=excluded.available_in_dhi_qar, available_nationwide=excluded.available_nationwide, dhi_qar_responsible_entity=excluded.dhi_qar_responsible_entity,
    dhi_qar_office=excluded.dhi_qar_office, dhi_qar_location=excluded.dhi_qar_location, dhi_qar_gis_status=excluded.dhi_qar_gis_status, service_type=excluded.service_type,
    application_channel=excluded.application_channel, existing_service_key=excluded.existing_service_key, external_service_url=excluded.external_service_url, integration_available=excluded.integration_available,
    api_available=excluded.api_available, sso_possible=excluded.sso_possible, required_documents=excluded.required_documents, required_information=excluded.required_information,
    eligibility_conditions=excluded.eligibility_conditions, fee_details=excluded.fee_details, processing_time=excluded.processing_time, processing_time_status=excluded.processing_time_status,
    citizen_steps=excluded.citizen_steps, internal_workflow=excluded.internal_workflow, approval_requirements=excluded.approval_requirements, physical_presence_required=excluded.physical_presence_required,
    physical_presence_details=excluded.physical_presence_details, inspection_required=excluded.inspection_required, inspection_details=excluded.inspection_details, appointment_required=excluded.appointment_required,
    appointment_url=excluded.appointment_url, service_output=excluded.service_output, digital_document_available=excluded.digital_document_available, physical_document_required=excluded.physical_document_required,
    qr_verification_available=excluded.qr_verification_available, legal_basis=excluded.legal_basis, verification_status=excluded.verification_status, effective_date=excluded.effective_date,
    last_verified_date=excluded.last_verified_date, source_date=excluded.source_date, publication_status=excluded.publication_status, active=excluded.active, updated_at=excluded.updated_at`
  ).run(
    id,
    input.canonicalServiceId,
    input.officialNameAr,
    input.shortNameAr || null,
    input.citizenFriendlyName || null,
    json(input.alternativeSearchNames),
    input.description || null,
    input.category,
    input.subcategory || null,
    json(input.beneficiaryTypes),
    input.responsibleMinistry || null,
    input.responsibleAuthority || null,
    input.responsibleDepartment || null,
    input.responsibleSection || null,
    input.administrativeLevel || 'OTHER_GOVERNMENT_ENTITY',
    bool(input.availableInDhiQar),
    bool(input.availableNationwide),
    input.dhiQarResponsibleEntity || null,
    input.dhiQarOffice || null,
    input.dhiQarLocation || null,
    input.dhiQarGisStatus || 'NOT_VERIFIED',
    input.serviceType || 'INFORMATION_ONLY',
    input.applicationChannel || 'INFORMATION_ONLY',
    input.existingServiceKey || null,
    input.externalServiceUrl || null,
    bool(input.integrationAvailable),
    bool(input.apiAvailable),
    bool(input.ssoPossible),
    json(input.requiredDocuments),
    json(input.requiredInformation),
    json(input.eligibilityConditions),
    json(input.feeDetails),
    input.processingTime || null,
    input.processingTimeStatus || 'NOT_PUBLISHED',
    json(input.citizenSteps),
    json(input.internalWorkflow),
    json(input.approvalRequirements),
    bool(input.physicalPresenceRequired),
    input.physicalPresenceDetails || null,
    bool(input.inspectionRequired),
    input.inspectionDetails || null,
    bool(input.appointmentRequired),
    input.appointmentUrl || null,
    input.serviceOutput || null,
    bool(input.digitalDocumentAvailable),
    bool(input.physicalDocumentRequired),
    bool(input.qrVerificationAvailable),
    json(input.legalBasis),
    input.verificationStatus,
    input.effectiveDate || null,
    input.lastVerifiedDate || null,
    input.sourceDate || null,
    input.publicationStatus,
    input.publicationStatus === 'DISABLED' ? 0 : 1,
    existing ? String(existing.created_at) : changedAt,
    changedAt
  )
  for (const source of input.sources)
    db.prepare(
      `INSERT INTO government_service_sources (id, service_id, source_type, authority_name, official_url, page_title, date_accessed, date_published, last_verified_date, verification_status, source_note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(service_id, official_url) DO UPDATE SET page_title=excluded.page_title, date_accessed=excluded.date_accessed, date_published=excluded.date_published, last_verified_date=excluded.last_verified_date, verification_status=excluded.verification_status, source_note=excluded.source_note`
    ).run(
      `govsrc_${randomUUID().replaceAll('-', '')}`,
      id,
      source.sourceType,
      source.authorityName,
      source.officialUrl,
      source.pageTitle || null,
      source.dateAccessed,
      source.datePublished || null,
      source.lastVerifiedDate || null,
      source.verificationStatus,
      source.sourceNote || null,
      changedAt
    )
  const result = getGovernmentService(id)!
  db.prepare(
    'INSERT INTO government_service_versions (id, service_id, change_type, changed_by, changed_at, previous_value, new_value, reason, source_url, approval_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    `govver_${randomUUID().replaceAll('-', '')}`,
    id,
    existing ? 'UPDATE' : 'CREATE',
    actor,
    changedAt,
    previous ? JSON.stringify(previous) : null,
    JSON.stringify(result),
    existing ? 'تحديث سجل خدمة من مصدر رسمي.' : 'إنشاء سجل خدمة من مصدر رسمي.',
    input.sources[0]?.officialUrl || null,
    input.publicationStatus
  )
  addAudit({
    actor,
    role: 'SUPER_ADMIN',
    action: existing ? 'UPDATE_GOVERNMENT_SERVICE' : 'CREATE_GOVERNMENT_SERVICE',
    entityType: 'government_service_directory',
    entityId: id,
    previousValue: previous,
    newValue: result,
    metadata: { verificationStatus: input.verificationStatus, publicationStatus: input.publicationStatus },
  })
  return result
}

export function listGovernmentServiceVersions(serviceId: string) {
  return db
    .prepare(
      'SELECT id, change_type, changed_by, changed_at, reason, source_url, approval_status FROM government_service_versions WHERE service_id = ? ORDER BY changed_at DESC'
    )
    .all(serviceId)
}

export function getGovernmentServiceDirectoryStats() {
  const rows = db
    .prepare(
      `SELECT publication_status, verification_status, service_type, COUNT(*) AS total FROM government_service_directory GROUP BY publication_status, verification_status, service_type`
    )
    .all() as Array<Record<string, unknown>>
  return {
    total: rows.reduce((sum, row) => sum + Number(row.total), 0),
    groups: rows.map(row => ({
      publicationStatus: String(row.publication_status),
      verificationStatus: String(row.verification_status),
      serviceType: String(row.service_type),
      total: Number(row.total),
    })),
  }
}

export function setGovernmentServicePublication(input: {
  id: string
  publicationStatus: GovernmentServicePublication
  reason?: string
  actor: string
}) {
  const before = getGovernmentService(input.id)
  if (!before) return null
  const changedAt = timestamp()
  db.prepare(
    'UPDATE government_service_directory SET publication_status = ?, active = ?, updated_at = ? WHERE id = ?'
  ).run(input.publicationStatus, input.publicationStatus === 'DISABLED' ? 0 : 1, changedAt, before.id)
  const after = getGovernmentService(before.id)!
  db.prepare(
    'INSERT INTO government_service_versions (id, service_id, change_type, changed_by, changed_at, previous_value, new_value, reason, source_url, approval_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    `govver_${randomUUID().replaceAll('-', '')}`,
    before.id,
    'PUBLICATION_STATUS_CHANGED',
    input.actor,
    changedAt,
    JSON.stringify(before),
    JSON.stringify(after),
    input.reason || null,
    before.sources[0]?.officialUrl || null,
    input.publicationStatus
  )
  addAudit({
    actor: input.actor,
    role: 'SUPER_ADMIN',
    action: 'SET_GOVERNMENT_SERVICE_PUBLICATION',
    entityType: 'government_service_directory',
    entityId: before.id,
    previousValue: { publicationStatus: before.publicationStatus },
    newValue: { publicationStatus: after.publicationStatus },
    metadata: { reason: input.reason || null },
  })
  return after
}
