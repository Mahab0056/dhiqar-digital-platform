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
  {
    id: 'dhiqar-governorate',
    name: 'ديوان محافظة ذي قار',
    category: 'حكومة محلية',
    district: 'الناصرية',
    sourceUrl: 'https://www.openstreetmap.org/way/437260120',
    dataStatus: 'VERIFIED_SOURCE',
    gisStatus: 'COORDINATES_VERIFIED',
    lat: 31.044903,
    lng: 46.239441,
  },
  {
    id: 'dhiqar-municipalities',
    name: 'مديرية بلديات ذي قار',
    category: 'بلديات',
    district: 'الناصرية',
    sourceUrl:
      'https://www.waze.com/ar/live-map/directions/iq/thy-qar%E2%80%8E-mhafzh/alnasryh/mdyryh-bldyat-thy-qar?to=place.ChIJAWiK0NX83T8RVyJ5vr4GCag',
    dataStatus: 'VERIFIED_SOURCE',
    gisStatus: 'COORDINATES_VERIFIED',
    lat: 31.060618,
    lng: 46.249296,
  },
  {
    id: 'dhiqar-water',
    name: 'مديرية ماء ذي قار',
    category: 'ماء',
    district: 'الناصرية',
    sourceUrl: 'https://thiqar.gov.iq/',
    dataStatus: 'VERIFIED_SOURCE',
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    lat: null,
    lng: null,
  },
  {
    id: 'dhiqar-sewerage',
    name: 'مديرية مجاري ذي قار',
    category: 'مجاري',
    district: 'الناصرية',
    sourceUrl: 'https://www.openstreetmap.org/node/4271076500',
    dataStatus: 'VERIFIED_SOURCE',
    gisStatus: 'COORDINATES_VERIFIED',
    lat: 31.0508,
    lng: 46.2431,
  },
  {
    id: 'dhiqar-electricity',
    name: 'فرع توزيع كهرباء ذي قار',
    category: 'كهرباء',
    district: 'الناصرية',
    sourceUrl: 'https://iq.geoview.info/dayrt_syant_khrba_alnasryt,13119654304n',
    dataStatus: 'VERIFIED_SOURCE',
    gisStatus: 'COORDINATES_VERIFIED',
    lat: 31.05464,
    lng: 46.25351,
  },
  {
    id: 'dhiqar-health',
    name: 'دائرة صحة ذي قار',
    category: 'صحة',
    district: 'الناصرية',
    sourceUrl: 'https://www.openstreetmap.org/way/479698844',
    dataStatus: 'VERIFIED_SOURCE',
    gisStatus: 'COORDINATES_VERIFIED',
    lat: 31.04821,
    lng: 46.24959,
  },
  {
    id: 'dhiqar-education',
    name: 'المديرية العامة للتربية في محافظة ذي قار',
    category: 'تربية',
    district: 'الناصرية',
    sourceUrl: 'https://irshad-iq.com/en/directorates/general-directorate-of-education',
    dataStatus: 'VERIFIED_SOURCE',
    gisStatus: 'COORDINATES_VERIFIED',
    lat: 31.047015,
    lng: 46.249687,
  },
  {
    id: 'dhiqar-agriculture',
    name: 'مديرية زراعة ذي قار',
    category: 'زراعة',
    district: 'الناصرية',
    sourceUrl: 'https://thiqar.gov.iq/',
    dataStatus: 'VERIFIED_SOURCE',
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    lat: null,
    lng: null,
  },
  {
    id: 'dhiqar-environment',
    name: 'مديرية بيئة ذي قار',
    category: 'بيئة',
    district: 'الناصرية',
    sourceUrl: 'https://nominatim.openstreetmap.org/ui/details.html?osmtype=N&osmid=5206209930&class=office',
    dataStatus: 'VERIFIED_SOURCE',
    gisStatus: 'COORDINATES_VERIFIED',
    lat: 31.057561,
    lng: 46.260343,
  },
  {
    id: 'dhiqar-planning',
    name: 'مديرية تخطيط ذي قار',
    category: 'تخطيط',
    district: 'الناصرية',
    sourceUrl: 'https://mop.gov.iq/archives/34615',
    dataStatus: 'VERIFIED_SOURCE',
    gisStatus: 'AWAITING_OFFICIAL_COORDINATES',
    lat: null,
    lng: null,
  },
  {
    id: 'dhiqar-investment',
    name: 'هيئة استثمار ذي قار',
    category: 'استثمار',
    district: 'الناصرية',
    sourceUrl: 'https://maps.app.goo.gl/AUAkDqpZ2JXES3ha6',
    dataStatus: 'VERIFIED_SOURCE',
    gisStatus: 'COORDINATES_VERIFIED',
    lat: 31.046691,
    lng: 46.246802,
  },
]

export const registrySummary = {
  verified: departmentRegistry.filter(item => item.dataStatus === 'VERIFIED_SOURCE').length,
  awaitingCoordinates: departmentRegistry.filter(item => item.gisStatus === 'AWAITING_OFFICIAL_COORDINATES').length,
}
