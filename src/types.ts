export type ApplicationStatus =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'ACTION_REQUIRED'
  | 'PAYMENT_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'

export type VerificationStatus =
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
  attachments: Array<{ id: string; mediaId: string; label: string; originalName: string; mimeType: string; sizeBytes: number; available: boolean }>
  createdAt: string
  updatedAt: string
  events: ApplicationEvent[]
}

export interface CitizenServiceRequest {
  id: number
  reference: string
  serviceKey: string
  departmentId: string
  status: string
  formData: Record<string, string>
  currentAction: string
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
