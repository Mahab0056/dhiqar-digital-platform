import type { IconKey } from './realistic-buildings'

// Public facilities (OpenStreetMap, built offline by scripts/geo/fetch-dhiqar-facilities.mjs): the catalogue of
// facility types and groups and the per-district index. No MapLibre import here — the flat (Leaflet) fallback's
// district profile reads the same index without loading the 3D map chunk.

export const FACILITIES_INDEX_URL = '/geo/facilities/index.json'

export const FACILITY_GROUPS = [
  { key: 'health', label: 'مستشفيات ومراكز صحية', color: '#e0566b' },
  { key: 'schools', label: 'مدارس ورياض أطفال', color: '#e2a93b' },
  { key: 'higher', label: 'جامعات ومعاهد', color: '#9a6ce6' },
  { key: 'security', label: 'شرطة ودفاع مدني', color: '#4a86ec' },
  { key: 'courts', label: 'محاكم', color: '#6d72d8' },
  { key: 'government', label: 'بلديات ودوائر حكومية', color: '#14a873' },
  { key: 'culture', label: 'مكتبات ومراكز شباب ورياضة', color: '#17b3c4' },
] as const
export type FacilityGroup = (typeof FACILITY_GROUPS)[number]['key']

export const FACILITY_TYPES = {
  hospital: { label: 'مستشفى', plural: 'مستشفيات', group: 'health', icon: 'hospital' },
  clinic: { label: 'مركز صحي', plural: 'مراكز صحية', group: 'health', icon: 'heart' },
  school: { label: 'مدرسة', plural: 'مدارس', group: 'schools', icon: 'book' },
  kindergarten: { label: 'روضة أطفال', plural: 'رياض أطفال', group: 'schools', icon: 'smile' },
  university: { label: 'جامعة', plural: 'جامعات', group: 'higher', icon: 'cap' },
  college: { label: 'كلية أو معهد', plural: 'كليات ومعاهد', group: 'higher', icon: 'cap' },
  police: { label: 'مركز شرطة', plural: 'مراكز شرطة', group: 'security', icon: 'shield' },
  fire: { label: 'دفاع مدني', plural: 'دفاع مدني', group: 'security', icon: 'flame' },
  court: { label: 'محكمة', plural: 'محاكم', group: 'courts', icon: 'scale' },
  townhall: { label: 'بلدية', plural: 'بلديات', group: 'government', icon: 'landmark' },
  government: { label: 'دائرة حكومية', plural: 'دوائر حكومية', group: 'government', icon: 'building' },
  utility: { label: 'دائرة ماء أو كهرباء', plural: 'ماء وكهرباء', group: 'government', icon: 'zap' },
  post: { label: 'مكتب بريد', plural: 'بريد', group: 'government', icon: 'mail' },
  library: { label: 'مكتبة', plural: 'مكتبات', group: 'culture', icon: 'library' },
  community: { label: 'مركز مجتمعي أو شبابي', plural: 'مراكز مجتمعية', group: 'culture', icon: 'users' },
  sports: { label: 'منشأة رياضية', plural: 'منشآت رياضية', group: 'culture', icon: 'trophy' },
} as const satisfies Record<string, { label: string; plural: string; group: FacilityGroup; icon: IconKey }>
export type FacilityType = keyof typeof FACILITY_TYPES

export const groupColor = (group: FacilityGroup) => FACILITY_GROUPS.find(g => g.key === group)?.color ?? '#14a873'
export const facilityColor = (type: string) =>
  groupColor((FACILITY_TYPES[type as FacilityType] ?? FACILITY_TYPES.government).group)

/** a facility as the maps' cards show it */
export type FacilityInfo = {
  id: string
  name: string | null
  type: FacilityType
  district: string
  osm: string
  department?: string
  /**
   * the building drawn for it: a real OSM outline, a generated stand-in block (`g: 1`: OSM has no outline), or
   * none of its own (it shares a building already drawn, or it is a platform department drawn by that layer)
   */
  shape: 'osm' | 'generic' | null
}

export type FacilityIndex = {
  generated: string
  note: string
  totals: Partial<Record<FacilityType, number>>
  districts: Record<
    string,
    {
      file: string
      total: number
      counts: Partial<Record<FacilityType, number>>
      subdistricts: { name: string; centre: boolean; osm: string }[]
    }
  >
}

/** a static JSON file, or null when it could not be fetched or read */
export async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url)
    return response.ok ? ((await response.json()) as T) : null
  } catch {
    return null
  }
}

// The geo files are cached for the session once they arrive; a failed request is forgotten at once, so
// the next caller (a later camera move, the next map mounted) asks again instead of living with a blank map.

let indexPromise: Promise<FacilityIndex | null> | null = null
export function loadFacilityIndex(): Promise<FacilityIndex | null> {
  if (!indexPromise) {
    const request: Promise<FacilityIndex | null> = fetchJson<FacilityIndex>(FACILITIES_INDEX_URL).then(data => {
      if (data?.districts) return data
      if (indexPromise === request) indexPromise = null
      return null
    })
    indexPromise = request
  }
  return indexPromise
}

/** groups per facility type, aggregated from a counts record */
export function groupCounts(counts: Partial<Record<FacilityType, number>> | undefined) {
  const out = new Map<FacilityGroup, number>()
  for (const [type, n] of Object.entries(counts ?? {})) {
    const group = FACILITY_TYPES[type as FacilityType]?.group
    if (group) out.set(group, (out.get(group) || 0) + (n || 0))
  }
  return out
}
