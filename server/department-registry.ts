export type DepartmentRegistryItem = {
  id: string
  name: string
  category: string
  district: string
  sourceUrl: string
  dataStatus: 'VERIFIED_SOURCE' | 'NEEDS_VERIFICATION'
  gisStatus: 'AWAITING_OFFICIAL_COORDINATES' | 'COORDINATES_VERIFIED'
  lat: number | null
  lng: number | null
}

// Sources are recorded in RESEARCH_DHIQAR_DEPARTMENTS.md. No office coordinate is added
// unless it has been supplied by the owning authority or an approved GIS source.
export const departmentRegistry: DepartmentRegistryItem[] = [
  { id: 'dhiqar-governorate', name: 'ديوان محافظة ذي قار', category: 'حكومة محلية', district: 'الناصرية', sourceUrl: 'https://thiqar.gov.iq/', dataStatus: 'VERIFIED_SOURCE', gisStatus: 'AWAITING_OFFICIAL_COORDINATES', lat: null, lng: null },
  { id: 'nasiriyah-municipality', name: 'مديرية بلدية الناصرية', category: 'بلديات', district: 'الناصرية', sourceUrl: 'https://nasiriyah-municipality.gov.iq/', dataStatus: 'VERIFIED_SOURCE', gisStatus: 'AWAITING_OFFICIAL_COORDINATES', lat: null, lng: null },
  { id: 'dhiqar-water', name: 'مديرية ماء ذي قار', category: 'ماء', district: 'الناصرية', sourceUrl: 'https://thiqar.gov.iq/', dataStatus: 'VERIFIED_SOURCE', gisStatus: 'AWAITING_OFFICIAL_COORDINATES', lat: null, lng: null },
  { id: 'dhiqar-sewerage', name: 'مديرية مجاري ذي قار', category: 'مجاري', district: 'الناصرية', sourceUrl: 'https://ur.gov.iq/index/show-eservice/51675/11018/org', dataStatus: 'VERIFIED_SOURCE', gisStatus: 'AWAITING_OFFICIAL_COORDINATES', lat: null, lng: null },
  { id: 'dhiqar-electricity', name: 'فرع توزيع كهرباء ذي قار', category: 'كهرباء', district: 'الناصرية', sourceUrl: 'https://moelc.gov.iq/', dataStatus: 'VERIFIED_SOURCE', gisStatus: 'AWAITING_OFFICIAL_COORDINATES', lat: null, lng: null },
  { id: 'dhiqar-health', name: 'دائرة صحة ذي قار', category: 'صحة', district: 'الناصرية', sourceUrl: 'https://thiqar.moh.gov.iq/', dataStatus: 'VERIFIED_SOURCE', gisStatus: 'AWAITING_OFFICIAL_COORDINATES', lat: null, lng: null },
  { id: 'dhiqar-education', name: 'المديرية العامة للتربية في محافظة ذي قار', category: 'تربية', district: 'الناصرية', sourceUrl: 'https://bs.epedu.gov.iq/', dataStatus: 'VERIFIED_SOURCE', gisStatus: 'AWAITING_OFFICIAL_COORDINATES', lat: null, lng: null },
  { id: 'dhiqar-agriculture', name: 'مديرية زراعة ذي قار', category: 'زراعة', district: 'الناصرية', sourceUrl: 'https://thiqar.gov.iq/', dataStatus: 'VERIFIED_SOURCE', gisStatus: 'AWAITING_OFFICIAL_COORDINATES', lat: null, lng: null },
  { id: 'dhiqar-environment', name: 'مديرية بيئة ذي قار', category: 'بيئة', district: 'الناصرية', sourceUrl: 'https://moen.gov.iq/ar/news165', dataStatus: 'VERIFIED_SOURCE', gisStatus: 'AWAITING_OFFICIAL_COORDINATES', lat: null, lng: null },
  { id: 'dhiqar-planning', name: 'مديرية تخطيط ذي قار', category: 'تخطيط', district: 'الناصرية', sourceUrl: 'https://mop.gov.iq/archives/34615', dataStatus: 'VERIFIED_SOURCE', gisStatus: 'AWAITING_OFFICIAL_COORDINATES', lat: null, lng: null },
  { id: 'dhiqar-investment', name: 'هيئة استثمار ذي قار', category: 'استثمار', district: 'الناصرية', sourceUrl: 'https://thiqarinvest.gov.iq/', dataStatus: 'VERIFIED_SOURCE', gisStatus: 'AWAITING_OFFICIAL_COORDINATES', lat: null, lng: null },
]

export const registrySummary = {
  verified: departmentRegistry.filter(item => item.dataStatus === 'VERIFIED_SOURCE').length,
  awaitingCoordinates: departmentRegistry.filter(item => item.gisStatus === 'AWAITING_OFFICIAL_COORDINATES').length,
}
