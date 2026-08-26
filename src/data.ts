import type { DashboardStats, ServiceItem } from './types'
import { serviceDefinitions } from './service-forms'
import {
  Building2,
  BriefcaseBusiness,
  Droplets,
  GraduationCap,
  HeartPulse,
  Landmark,
  Leaf,
  MapPinned,
  Route,
  ShieldCheck,
  Stethoscope,
  Zap,
} from 'lucide-react'

export const categoryIcons = {
  'السكن والأراضي': Landmark,
  'البناء والبلديات': Building2,
  'المحلات والأعمال': BriefcaseBusiness,
  'الماء والمجاري': Droplets,
  الكهرباء: Zap,
  'الطرق والنظافة': Route,
  الصحة: Stethoscope,
  'التربية والتعليم': GraduationCap,
  الزراعة: Leaf,
  الاستثمار: MapPinned,
  'الوثائق الحكومية': ShieldCheck,
  'الرعاية والعمل': HeartPulse,
}

export const services: ServiceItem[] = serviceDefinitions.map(service => ({
  key: service.key,
  title: service.title,
  department: service.department,
  category: service.category,
  description: service.description,
  estimatedTime: service.estimatedTime,
  fee: service.fee,
  requirements: service.requirements,
}))

export const defaultStats: DashboardStats = {
  todayApplications: 0,
  completed: 0,
  overdue: 0,
  activeCitizens: 0,
  activeEmployees: 0,
  departmentsOnline: 0,
  financialCollection: 0,
  complaints: 0,
  avgProcessingHours: 0,
  automationRate: 0,
  series: Array.from({ length: 7 }, (_, index) => ({ day: `-${6 - index}`, applications: 0, completed: 0 })),
  departments: [],
  registry: { verified: 0, awaitingCoordinates: 0 },
}

export const statusLabels = {
  SUBMITTED: 'تم التقديم',
  UNDER_REVIEW: 'قيد التدقيق',
  ACTION_REQUIRED: 'مطلوب إجراء',
  PAYMENT_REQUIRED: 'بانتظار الدفع',
  APPROVED: 'مكتملة',
  REJECTED: 'مرفوضة',
} as const

export const formatIQD = (amount: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount) + ' د.ع'
