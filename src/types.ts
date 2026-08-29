export type ApplicationStatus =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'ACTION_REQUIRED'
  | 'PAYMENT_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'

export type VerificationStatus =
  | 'PHONE_VERIFIED'
  | 'PENDING_VERIFICATION'
  | 'VERIFIED'
  | 'VERIFIED_MANUAL'
  | 'MANUAL_REVIEW'
  | 'NEEDS_RESUBMISSION'
  | 'REJECTED'
  | 'FAILED'

export interface Citizen {
  id: number
  fullName: string
  nationalIdMasked: string
  phoneMasked: string
  verificationStatus: VerificationStatus
  district: string
  documentType?: 'NATIONAL_ID' | 'PASSPORT' | 'DRIVING_LICENSE' | null
  profileMediaId?: string | null
  createdAt: string
}

export interface ApplicationEvent {
  id: number
  type: string
  title: string
  description: string
  actor: string
  createdAt: string
}

export interface AdminCitizenDirectoryItem {
  id: number
  fullName: string
  nationalIdMasked: string
  phoneMasked: string
  verificationStatus: string
  district: string
  documentType?: 'NATIONAL_ID' | 'PASSPORT' | 'DRIVING_LICENSE' | null
  createdAt: string
  updatedAt: string
  lastActivityAt: string
  applicationCount: number
  serviceRequestCount: number
}

export interface CitizenNotification {
  id: string
  type: string
  title: string
  message: string
  link?: string | null
  readAt?: string | null
  createdAt: string
}

export interface GovernmentApplication {
  id: number
  reference: string
  citizenId: number
  citizenName: string
  serviceKey: string
  serviceName: string
  department: string
  status: ApplicationStatus
  currentAction: string
  businessName: string
  activityType: string
  address: string
  district: string
  ownershipType: string
  coordinates: { lat: number; lng: number }
  fee: number
  paymentStatus: 'NOT_REQUIRED' | 'PENDING' | 'PAID'
  requiredDocument?: string | null
  documentNumber?: string | null
  verificationId?: string | null
  documentTitle?: string | null
  issuedAt?: string | null
  pdfAvailable?: boolean
  originalPdfUrl?: string | null
  attachments: Array<{ id: string; mediaId: string; label: string; originalName: string; mimeType: string; purpose?: string; sizeBytes: number; available: boolean }>
  createdAt: string
  updatedAt: string
  events: ApplicationEvent[]
}

export interface IssuedDocument {
  id: string
  sourceKind: 'APPLICATION' | 'SERVICE_REQUEST'
  applicationReference?: string | null
  serviceRequestReference?: string | null
  serviceName: string
  departmentName: string
  documentTitle: string
  documentNumber: string
  verificationId: string
  status: 'ACTIVE' | 'REVOKED'
  issuedAt: string
  pdfUrl: string
  pdfDownloadUrl: string
}

export interface CitizenServiceRequest {
  id: number
  reference: string
  serviceKey: string
  serviceName?: string
  departmentId: string
  department?: string
  status: string
  formData: Record<string, string>
  currentAction: string
  decisionNote?: string | null
  requiredDocument?: string | null
  citizenName?: string
  attachments?: Array<{ id: string; mediaId: string; label: string; originalName: string; mimeType: string; sizeBytes: number; available: boolean }>
  createdAt: string
  updatedAt: string
  appointment?: { id: string; preferredDate: string; preferredTime: string; status: string; note?: string | null } | null
}

export type FeedbackKind = 'COMPLAINT' | 'SUGGESTION'
export type FeedbackStatus = 'RECEIVED' | 'IN_REVIEW' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'

export interface CitizenFeedback {
  id: number
  reference: string
  citizenId: number
  kind: FeedbackKind
  category: string
  departmentId?: string | null
  subject: string
  description: string
  district?: string | null
  coordinates?: { lat: number; lng: number } | null
  status: FeedbackStatus
  currentAction: string
  adminNote?: string | null
  createdAt: string
  updatedAt: string
  attachments: Array<{ id: number; mediaId: string; label: string; originalName: string; mimeType: string; sizeBytes: number; available: boolean }>
  events: Array<{ id: number; status: string; title: string; description: string; actor: string; createdAt: string }>
}

export interface DashboardStats {
  todayApplications: number
  completed: number
  overdue: number
  activeCitizens: number
  activeEmployees: number
  departmentsOnline: number
  financialCollection: number
  complaints: number
  avgProcessingHours: number
  automationRate: number
  series: Array<{ day: string; applications: number; completed: number }>
  departments: Array<{
    id: string | number
    name: string
    type: string
    district: string
    lat: number | null
    lng: number | null
    status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN'
    transactions: number
    submitted: number
    underReview: number
    actionRequired: number
    completed: number
    rejected: number
    openFeedback: number
    workforce: {
      totalEmployees: number | null
      presentEmployees: number | null
      absentEmployees: number | null
      dataStatus: 'AWAITING_AUTHORIZED_SOURCE' | 'RECORDED_BY_SUPER_ADMIN'
      sourceName?: string | null
      sourceUrl?: string | null
      observedAt?: string | null
    }
    cameras: {
      configured: number
      enabled: number
      status: 'AWAITING_AUTHORIZATION' | 'CONFIGURED_DISABLED' | 'READY_FOR_GATEWAY'
      sourceName?: string | null
      lastCheckedAt?: string | null
    }
    automation: number
    sourceUrl?: string
    dataStatus?: 'VERIFIED_SOURCE' | 'NEEDS_VERIFICATION'
    gisStatus?: 'AWAITING_OFFICIAL_COORDINATES' | 'COORDINATES_VERIFIED'
  }>
  registry?: { verified: number; awaitingCoordinates: number }
}

export interface ServiceItem {
  key: string
  title: string
  department: string
  category: string
  description: string
  estimatedTime: string
  fee: number
  requirements: string[]
}

export type GovernmentServiceVerificationStatus = 'VERIFIED_UR_PORTAL' | 'VERIFIED_MINISTRY' | 'VERIFIED_GOVERNMENT_AUTHORITY' | 'VERIFIED_MULTIPLE_OFFICIAL_SOURCES' | 'PARTIALLY_VERIFIED' | 'REQUIRES_MANUAL_VERIFICATION' | 'OUTDATED_SOURCE' | 'NEEDS_UPDATE'
export type GovernmentServicePublicationStatus = 'DRAFT' | 'APPROVED' | 'NEEDS_REVIEW' | 'DISABLED'

export interface GovernmentServiceDirectoryEntry {
  id: string
  canonicalServiceId: string
  officialNameAr: string
  shortNameAr?: string | null
  citizenFriendlyName?: string | null
  alternativeSearchNames: string[]
  description?: string | null
  category: string
  subcategory?: string | null
  beneficiaryTypes: string[]
  responsibleMinistry?: string | null
  responsibleAuthority?: string | null
  responsibleDepartment?: string | null
  administrativeLevel: string
  availableInDhiQar?: boolean | null
  availableNationwide?: boolean | null
  dhiQarOffice?: string | null
  serviceType: string
  applicationChannel: string
  externalServiceUrl?: string | null
  existingServiceKey?: string | null
  requiredDocuments: Array<{ documentName: string; requiredOrOptional: 'REQUIRED' | 'OPTIONAL' | 'CONDITIONAL'; appliesWhen?: string | null; notes?: string | null; originalRequired?: boolean; copyRequired?: boolean; certifiedCopyRequired?: boolean; frontSideRequired?: boolean; backSideRequired?: boolean }>
  requiredInformation: string[]
  eligibilityConditions: string[]
  feeDetails: Array<{ rule: string; amount: number | null; currency?: string | null; status?: string | null }>
  processingTime?: string | null
  processingTimeStatus: string
  citizenSteps: string[]
  physicalPresenceRequired?: boolean | null
  physicalPresenceDetails?: string | null
  inspectionRequired?: boolean | null
  inspectionDetails?: string | null
  digitalDocumentAvailable?: boolean | null
  qrVerificationAvailable?: boolean | null
  serviceOutput?: string | null
  physicalDocumentRequired?: boolean | null
  legalBasis: Array<{ lawName?: string; lawNumber?: string; year?: number; article?: string; regulation?: string; officialSource?: string }>
  verificationStatus: GovernmentServiceVerificationStatus
  lastVerifiedDate?: string | null
  sourceDate?: string | null
  publicationStatus: GovernmentServicePublicationStatus
  active: boolean
  sources: Array<{ id?: string; sourceType: string; authorityName: string; officialUrl: string; pageTitle?: string | null; dateAccessed: string; datePublished?: string | null; lastVerifiedDate?: string | null; verificationStatus: GovernmentServiceVerificationStatus; sourceNote?: string | null }>
  createdAt: string
  updatedAt: string
}

export interface PlatformServiceSettings {
  id: string
  name: string
  department: string
  requiredDocuments: string[]
}

export interface DepartmentWorkbench {
  id: string
  name: string
  category: string
  district: string
  dataStatus: string
  sourceUrl: string | null
  services: Array<{ id: string; name: string; category: string; requiredDocuments: string[]; active: boolean; updatedAt: string }>
  requests: Array<{ reference: string; serviceName: string; citizenName: string; status: string; currentAction: string; createdAt: string; updatedAt: string }>
}
