import type { DepartmentSummary } from '../../types'

/** A department with verified coordinates — the only kind any departments map draws. */
export type LocatedDepartment = DepartmentSummary & { lat: number; lng: number }

export const isLocated = (item: DepartmentSummary): item is LocatedDepartment =>
  typeof item.lat === 'number' && typeof item.lng === 'number'

/**
 * The registry has ~28 fine-grained categories; the map colours them by six sector families so the
 * legend stays readable. Unknown categories fall into "ثقافة ومجتمع وغيرها".
 */
export const SECTOR_FAMILIES = [
  {
    key: 'local',
    label: 'إدارة محلية وبلديات',
    color: '#14a873',
    categories: ['حكومة محلية', 'بلديات', 'إسكان وتخطيط عمراني', 'تخطيط وإحصاء', 'استثمار'],
  },
  {
    key: 'security',
    label: 'أمن وعدل ووثائق',
    color: '#4a86ec',
    categories: ['أمن وشرطة', 'قضاء', 'أحوال مدنية وجوازات', 'تسجيل عقاري'],
  },
  {
    key: 'utilities',
    label: 'خدمات وبنى تحتية',
    color: '#17b3c4',
    categories: ['ماء', 'مجاري', 'كهرباء', 'طرق وجسور', 'نفط وطاقة', 'اتصالات وبريد', 'موارد مائية', 'بيئة'],
  },
  {
    key: 'education',
    label: 'تعليم وصحة',
    color: '#e2a93b',
    categories: ['تعليم عالي', 'تربية وتعليم', 'صحة'],
  },
  {
    key: 'economy',
    label: 'اقتصاد ورعاية',
    color: '#de6b45',
    categories: ['ضرائب ومالية', 'تقاعد', 'حماية اجتماعية وعمل', 'زراعة'],
  },
  {
    key: 'culture',
    label: 'ثقافة ومجتمع وغيرها',
    color: '#9a6ce6',
    categories: ['آثار وسياحة', 'أوقاف', 'شباب ورياضة', 'أخرى'],
  },
] as const

export type SectorKey = (typeof SECTOR_FAMILIES)[number]['key']

export const sectorOf = (category: string) =>
  SECTOR_FAMILIES.find(family => (family.categories as readonly string[]).includes(category)) ??
  SECTOR_FAMILIES[SECTOR_FAMILIES.length - 1]

/** Directions to a point (opens the visitor's own maps app / Google Maps). */
export const directionsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`

/** Nasiriyah, the governorate centre. */
export const NASIRIYAH: [number, number] = [46.2465, 31.0455]
