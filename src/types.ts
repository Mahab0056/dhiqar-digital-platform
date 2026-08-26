export type ApplicationStatus =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'ACTION_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'

export type VerificationStatus =
  | 'PENDING_VERIFICATION'
  | 'VERIFIED'
  | 'MANUAL_REVIEW'
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
  createdAt: string
  updatedAt: string
  events: ApplicationEvent[]
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
    id: number
    name: string
    type: string
    district: string
    lat: number
    lng: number
    status: 'ONLINE' | 'DEGRADED' | 'OFFLINE'
    transactions: number
    automation: number
  }>
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
