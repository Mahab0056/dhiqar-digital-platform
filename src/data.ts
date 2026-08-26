import type { DashboardStats, ServiceItem } from './types'
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

export const services: ServiceItem[] = [
  {
    key: 'store-license',
    title: 'إجازة فتح محل',
    department: 'بلدية الناصرية',
    category: 'المحلات والأعمال',
    description: 'تقديم طلب إجازة لمحل تجاري جديد ومتابعة التدقيق وإصدار الوثيقة رقمياً.',
    estimatedTime: '3–5 أيام عمل',
    fee: 75000,
    requirements: ['عقد إيجار أو إثبات ملكية', 'صورة واجهة المحل', 'تحديد الموقع على الخريطة'],
  },
  {
    key: 'building-permit',
    title: 'إجازة بناء',
    department: 'مديرية بلديات ذي قار',
    category: 'البناء والبلديات',
    description: 'طلب إجازة بناء مع المخططات والكشف الموقعي وسلسلة الموافقات.',
    estimatedTime: '10–15 يوم عمل',
    fee: 150000,
    requirements: ['سند العقار', 'المخططات الهندسية', 'براءة ذمة'],
  },
  {
    key: 'water-complaint',
    title: 'بلاغ ماء أو مجارٍ',
    department: 'مديرية ماء ومجاري ذي قار',
    category: 'الماء والمجاري',
    description: 'إرسال بلاغ موقعي مصحوب بصورة وتحويله تلقائياً إلى الفريق المختص.',
    estimatedTime: '24–72 ساعة',
    fee: 0,
    requirements: ['الموقع', 'وصف المشكلة', 'صورة اختيارية'],
  },
  {
    key: 'land-request',
    title: 'متابعة طلب قطعة أرض',
    department: 'قسم الأملاك والأراضي',
    category: 'السكن والأراضي',
    description: 'الاستعلام عن الاستحقاق وتحديث مستندات طلبات تخصيص الأراضي.',
    estimatedTime: 'بحسب البرنامج',
    fee: 0,
    requirements: ['الملف العائلي', 'تأييد السكن', 'وثائق الاستحقاق'],
  },
]

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
