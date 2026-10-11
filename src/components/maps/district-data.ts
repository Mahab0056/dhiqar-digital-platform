import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import type { DashboardStats } from '../../types'
import { DISTRICT_FACTS, districtKey } from './dhiqar-district-facts'
import { loadFacilityIndex, type FacilityIndex } from './facility-catalog'

// Data behind the district profile (district-profile.tsx): roll-ups per district and the lazily fetched facility
// index and registry service counts. No MapLibre import — the flat (no-WebGL) fallback uses it too.

export type OpsDepartment = DashboardStats['departments'][number]
export type OpsState = 'idle' | 'busy' | 'alert'
/** properties of public/geo/dhiqar-districts.geojson */
export type DistrictProps = { kind: 'district' | 'governorate'; name: string; areaKm2?: number; formerParent?: string }

/** below this map width the profile is a bottom sheet instead of a side panel (CSS: map3d-drill.css) */
export const DRILL_SHEET_MAX_WIDTH = 700

/**
 * Width of the side column the district profile — or the department / facility card that replaces it — takes on
 * a wide map: 38% of the map, between 288 and 340px (CSS: `.drill-panel` and `.map3d-card.drill-card`), so a
 * 1440px desktop keeps well over half of its 800px map in view. The cameras keep their target clear of it.
 */
export function drillColumnWidth(mapWidth: number) {
  return Math.min(Math.max(288, Math.min(340, mapWidth * 0.38)), mapWidth - 28)
}
/** the column's inline-start inset (CSS: 14px) */
export const DRILL_COLUMN_INSET = 14

export const openWork = (department: OpsDepartment) => department.underReview + department.actionRequired
export type DistrictSummary = {
  name: string
  areaKm2?: number
  formerParent?: string
  departments: OpsDepartment[]
  /** departments with official coordinates (drawn on the map) */
  mapped: number
  open: number
  overdue: number
  feedback: number
  completed: number
  transactions: number
  alerts: number
}

/** each district of the boundary file with its departments rolled up, most populous first */
export function summarizeDistricts<F extends { properties: DistrictProps }>(
  features: readonly F[],
  departments: readonly OpsDepartment[],
  stateOf: (department: OpsDepartment) => OpsState
): (DistrictSummary & { feature: F })[] {
  return features
    .filter(feature => feature.properties.kind === 'district')
    .map(feature => {
      const { name, areaKm2, formerParent } = feature.properties
      const own = departments.filter(item => districtKey(item.district) === name)
      return {
        feature,
        name,
        areaKm2,
        formerParent,
        departments: own,
        mapped: own.filter(item => typeof item.lat === 'number' && typeof item.lng === 'number').length,
        open: own.reduce((sum, item) => sum + openWork(item), 0),
        overdue: own.reduce((sum, item) => sum + (item.overdue || 0), 0),
        feedback: own.reduce((sum, item) => sum + item.openFeedback, 0),
        completed: own.reduce((sum, item) => sum + item.completed, 0),
        transactions: own.reduce((sum, item) => sum + item.transactions, 0),
        alerts: own.filter(item => stateOf(item) === 'alert').length,
      }
    })
    .sort((a, b) => (DISTRICT_FACTS[b.name]?.population || 0) - (DISTRICT_FACTS[a.name]?.population || 0))
}

/** the OSM facility index (cached for the session by loadFacilityIndex), once something asks for it */
export function useFacilityIndex(enabled: boolean) {
  const [index, setIndex] = useState<FacilityIndex | null>(null)
  useEffect(() => {
    if (!enabled || index) return
    let alive = true
    void loadFacilityIndex().then(data => alive && setIndex(data))
    return () => {
      alive = false
    }
  }, [enabled, index])
  return index
}

/** services listed per department in the public registry (department id → count), fetched on first use */
export function useListedServices(enabled: boolean) {
  const [services, setServices] = useState<Map<string, number> | null>(null)
  useEffect(() => {
    if (!enabled || services) return
    let alive = true
    api
      .listDepartments()
      .then(data => alive && setServices(new Map(data.items.map(item => [item.id, item.services.length]))))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [enabled, services])
  return services
}

export const DRILL_PANEL_COLLAPSED_KEY = 'dq.gis.drill-panel-collapsed'

/**
 * Whether the district profile is folded down to its title bar. The choice outlives a district change, closing
 * the profile and a reload (stored per browser; a blocked or private storage keeps it for the session only).
 */
export function useDrillPanelCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(DRILL_PANEL_COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(DRILL_PANEL_COLLAPSED_KEY, collapsed ? '1' : '0')
    } catch {
      // storage unavailable: the in-memory state still holds for this visit
    }
  }, [collapsed])
  const toggle = useCallback(() => setCollapsed(value => !value), [])
  return [collapsed, toggle]
}
