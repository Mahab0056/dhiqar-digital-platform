import registryData from './data/dhiqar-departments.json' with { type: 'json' }

export type DepartmentRegistryItem = {
  id: string
  name: string
  nameEn: string | null
  category: string
  parentMinistry: string | null
  district: string
  address: string | null
  phone: string | null
  website: string | null
  facebook: string | null
  sourceUrl: string
  dataStatus: 'VERIFIED_SOURCE' | 'NEEDS_VERIFICATION'
  gisStatus: 'AWAITING_OFFICIAL_COORDINATES' | 'COORDINATES_VERIFIED'
  lat: number | null
  lng: number | null
  services: string[]
  notes: string | null
}

/**
 * Registry of Dhi Qar government entities. Sources are recorded per item (sourceUrl) and in
 * docs/research/dhiqar-departments-sources.md. No coordinate is shown as official unless it came
 * from OSM/official data (gisStatus = COORDINATES_VERIFIED); phones are never invented.
 */
export const departmentRegistry: DepartmentRegistryItem[] = registryData as DepartmentRegistryItem[]

export const departmentById = new Map(departmentRegistry.map(item => [item.id, item]))

export const departmentCategories = [...new Set(departmentRegistry.map(item => item.category))]

export const registrySummary = {
  total: departmentRegistry.length,
  verified: departmentRegistry.filter(item => item.dataStatus === 'VERIFIED_SOURCE').length,
  needsVerification: departmentRegistry.filter(item => item.dataStatus === 'NEEDS_VERIFICATION').length,
  awaitingCoordinates: departmentRegistry.filter(item => item.gisStatus === 'AWAITING_OFFICIAL_COORDINATES').length,
  gisComplete: departmentRegistry.filter(item => item.gisStatus === 'COORDINATES_VERIFIED').length,
  categories: departmentCategories.length,
}
