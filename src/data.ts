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
  todayApplications: 1247,
  completed: 986,
  overdue: 42,
  activeCitizens: 128540,
  activeEmployees: 1842,
  departmentsOnline: 31,
  financialCollection: 128750000,
  complaints: 264,
  avgProcessingHours: 31.4,
  automationRate: 78,
  series: [
    { day: 'السبت', applications: 820, completed: 690 },
    { day: 'الأحد', applications: 1140, completed: 915 },
    { day: 'الاثنين', applications: 1280, completed: 980 },
    { day: 'الثلاثاء', applications: 1050, completed: 940 },
    { day: 'الأربعاء', applications: 1380, completed: 1040 },
    { day: 'الخميس', applications: 1247, completed: 986 },
  ],
  departments: [
    { id: 1, name: 'ديوان محافظة ذي قار', type: 'حكومة محلية', district: 'الناصرية', lat: 31.0439, lng: 46.2573, status: 'ONLINE', transactions: 1240, automation: 92 },
    { id: 2, name: 'بلدية الناصرية', type: 'بلدية', district: 'الناصرية', lat: 31.0471, lng: 46.2621, status: 'ONLINE', transactions: 2860, automation: 86 },
    { id: 3, name: 'مديرية ماء ذي قار', type: 'خدمات', district: 'الناصرية', lat: 31.0398, lng: 46.2515, status: 'ONLINE', transactions: 1350, automation: 71 },
    { id: 4, name: 'بلدية الشطرة', type: 'بلدية', district: 'الشطرة', lat: 31.4091, lng: 46.1727, status: 'ONLINE', transactions: 875, automation: 68 },
    { id: 5, name: 'بلدية سوق الشيوخ', type: 'بلدية', district: 'سوق الشيوخ', lat: 30.8907, lng: 46.4549, status: 'DEGRADED', transactions: 634, automation: 59 },
    { id: 6, name: 'بلدية الرفاعي', type: 'بلدية', district: 'الرفاعي', lat: 31.7094, lng: 46.1053, status: 'ONLINE', transactions: 510, automation: 64 },
  ],
}

export const statusLabels = {
  SUBMITTED: 'تم التقديم',
  UNDER_REVIEW: 'قيد التدقيق',
  ACTION_REQUIRED: 'مطلوب إجراء',
  APPROVED: 'مكتملة',
  REJECTED: 'مرفوضة',
} as const

export const formatIQD = (amount: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount) + ' د.ع'
