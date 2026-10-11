import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'wouter'
import {
  AttributionControl,
  FullscreenControl,
  Map as MapLibreMap,
  NavigationControl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl'
import {
  Box,
  Building2,
  Compass,
  ExternalLink,
  Layers,
  Map as MapIcon,
  MapPin,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  Satellite,
  X,
} from 'lucide-react'
import type { FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson'
import {
  directionsUrl,
  NASIRIYAH,
  SECTOR_FAMILIES,
  sectorOf,
  type LocatedDepartment,
  type SectorKey,
} from './departments-map-model'
import {
  brandStyle,
  DARK,
  easeInCubic,
  easeOutBack,
  fetchBaseStyle,
  isDarkTheme,
  LIGHT,
  MAP_LOCALE,
  mix,
  prefersReducedMotion,
  skyFor,
  themePaint,
  type Palette,
  type StyleLayer,
} from './maplibre-base'
import {
  addBuildingLayers,
  addFacadeImages,
  addFacilityLayers,
  setFacadeTheme,
  addLandmarkLayers,
  addSatelliteLayer,
  badgeExpression,
  FACILITY_GROUPS,
  FACILITY_INTERACTIVE_LAYERS,
  FACILITY_TYPES,
  facadeOf,
  groupColor,
  groupCounts,
  hideBasemapBuildings,
  iconForCategory,
  installBadgeFactory,
  landmarkKeys,
  loadDepartmentFootprints,
  loadFacilityIndex,
  OSM_ATTRIBUTION,
  osmUrl,
  standInSquare,
  type DepartmentFootprints,
  type FacilityGroup,
  type FacilityInfo,
  type FacilityLayerHandle,
} from './realistic-buildings'
import { departmentShape } from './building-shape'
import { ShapeNote } from './ShapeNote'

const OVERVIEW = { center: [46.33, 31.24] as [number, number], zoom: 8.1, pitch: 25, bearing: 0 }
/** the government quarter on the Euphrates' north bank: diwan, council, qaimaqamiya and the directorates */
const HOME = { center: [46.2424, 31.0512] as [number, number], zoom: 15.1, pitch: 62, bearing: -28 }

/** narrow screens see less of the city: pull the camera back a little */
const fitZoom = (zoom: number, width: number) => zoom + Math.max(-1, Math.min(0, Math.log2(width / 1320) / 2))
const BUILDING_MIN_ZOOM = 12.6
const CLUSTER_MAX_ZOOM = 10.8
const FACILITY_MIN_ZOOM = 13.2
const IDLE_RESUME_MS = 10_000
const ORBIT_DEG_PER_MS = 0.0022 // ≈ 2.2° a second
/** buildings are drawn a touch taller than life so a three-storey directorate still reads at street zoom */
const HEIGHT_SCALE = 1.2

export type Basemap = 'real' | 'map'

// ---- department geometry -------------------------------------------------------------------------

type DeptProps = {
  id: string
  color: string
  sector: SectorKey
  icon: string
  name: string
  /** roof colour while hovered */
  lit: string
  h: number
  facade: number
  roof: string
  g: number
}

function featureProps(item: LocatedDepartment, footprints: DepartmentFootprints | null): DeptProps {
  const sector = sectorOf(item.category)
  const footprint = footprints?.byId.get(item.id)
  const { facade, roof } = facadeOf(item.id)
  return {
    id: item.id,
    color: sector.color,
    sector: sector.key,
    icon: iconForCategory(item.category),
    name: item.name,
    lit: mix(roof, sector.color, 0.55),
    h: (footprint?.height ?? 12) * HEIGHT_SCALE,
    facade,
    roof,
    g: footprint?.generic || !footprint ? 1 : 0,
  }
}

const buildingsOf = (
  items: LocatedDepartment[],
  footprints: DepartmentFootprints | null
): FeatureCollection<Polygon | MultiPolygon, DeptProps> => ({
  type: 'FeatureCollection',
  features: items.map(item => ({
    type: 'Feature',
    geometry: footprints?.byId.get(item.id)?.ring ?? standInSquare(item.lng, item.lat),
    properties: featureProps(item, footprints),
  })),
})

const pointsOf = (
  items: LocatedDepartment[],
  footprints: DepartmentFootprints | null
): FeatureCollection<Point, DeptProps> => ({
  type: 'FeatureCollection',
  features: items.map(item => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [item.lng, item.lat] },
    properties: featureProps(item, footprints),
  })),
})

/** centre of a district's busiest cluster, so one far-off office doesn't pull the camera into empty desert */
function denseCentre(items: LocatedDepartment[]): [number, number] {
  const km = (a: LocatedDepartment, b: LocatedDepartment) => Math.hypot((a.lng - b.lng) * 95, (a.lat - b.lat) * 111)
  const hub = items.reduce((best, item) =>
    items.filter(other => km(item, other) < 2).length > items.filter(other => km(best, other) < 2).length ? item : best
  )
  const near = items.filter(item => km(hub, item) < 1.2)
  return [near.reduce((sum, i) => sum + i.lng, 0) / near.length, near.reduce((sum, i) => sum + i.lat, 0) / near.length]
}

const GROW: ExpressionSpecification = ['coalesce', ['feature-state', 'grow'], 0]
const PULSE: ExpressionSpecification = ['coalesce', ['feature-state', 'pulse'], 0]
const SELECTED: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false]
const HOVERED: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false]

/** the building rises out of the ground as the camera descends (and when a filter brings it back) */
const buildingHeight = (extra: number): ExpressionSpecification => [
  'interpolate',
  ['linear'],
  ['zoom'],
  BUILDING_MIN_ZOOM,
  0,
  BUILDING_MIN_ZOOM + 0.9,
  ['*', GROW, ['+', ['get', 'h'], extra]],
]
const ROOF_COLOR: ExpressionSpecification = [
  'case',
  SELECTED,
  ['get', 'color'],
  HOVERED,
  ['get', 'lit'],
  ['get', 'roof'],
]

type Tween = { from: number; to: number; start: number; duration: number; ease: (t: number) => number }

type Tooltip = { x: number; y: number; item: LocatedDepartment }

type Props = {
  departments: LocatedDepartment[]
  visibleIds: ReadonlySet<string>
  /** the style or WebGL failed — the caller swaps in the flat map */
  onUnavailable: () => void
}

/** district boxes for lazy facility loading */
type DistrictBounds = Map<string, [[number, number], [number, number]]>
async function loadDistrictBounds(): Promise<DistrictBounds> {
  const out: DistrictBounds = new Map()
  try {
    const response = await fetch('/geo/dhiqar-districts.geojson')
    const data = (await response.json()) as FeatureCollection<Polygon | MultiPolygon, { kind: string; name: string }>
    for (const feature of data.features) {
      if (feature.properties.kind !== 'district') continue
      const rings =
        feature.geometry.type === 'Polygon'
          ? [feature.geometry.coordinates[0]]
          : feature.geometry.coordinates.map(p => p[0])
      let [x0, y0, x1, y1] = [180, 90, -180, -90]
      for (const ring of rings)
        for (const [x, y] of ring) {
          x0 = Math.min(x0, x)
          y0 = Math.min(y0, y)
          x1 = Math.max(x1, x)
          y1 = Math.max(y1, y)
        }
      out.set(feature.properties.name, [
        [x0, y0],
        [x1, y1],
      ])
    }
  } catch {
    // no districts → facilities simply never load
  }
  return out
}

export default function DhiQar3DMap({ departments, visibleIds, onUnavailable }: Props) {
  const shellRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const facilitiesRef = useRef<FacilityLayerHandle | null>(null)
  const [ready, setReady] = useState(false)
  const [is3D, setIs3D] = useState(true)
  const [basemap, setBasemap] = useState<Basemap>('real')
  const [touring, setTouring] = useState(false)
  const [tourCaption, setTourCaption] = useState('')
  const [reducedMotion] = useState(prefersReducedMotion)
  const [orbitOn, setOrbitOn] = useState(() => !prefersReducedMotion())
  const [hiddenSectors, setHiddenSectors] = useState<ReadonlySet<SectorKey>>(new Set())
  const [shownGroups, setShownGroups] = useState<ReadonlySet<FacilityGroup>>(
    () => new Set(FACILITY_GROUPS.map(g => g.key))
  )
  const [facilityTotals, setFacilityTotals] = useState<Map<FacilityGroup, number>>(new Map())
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const [facilityTip, setFacilityTip] = useState<{ x: number; y: number; info: FacilityInfo } | null>(null)
  const [selected, setSelected] = useState<LocatedDepartment | null>(null)
  const [facility, setFacility] = useState<FacilityInfo | null>(null)
  const [legendOpen, setLegendOpen] = useState(() => window.innerWidth > 640)
  const [facilitiesOpen, setFacilitiesOpen] = useState(false)
  const [footprints, setFootprints] = useState<DepartmentFootprints | null>(null)

  const byId = useMemo(() => new Map(departments.map(item => [item.id, item])), [departments])
  const shown = useMemo(
    () => departments.filter(item => visibleIds.has(item.id) && !hiddenSectors.has(sectorOf(item.category).key)),
    [departments, visibleIds, hiddenSectors]
  )
  const sectorCounts = useMemo(() => {
    const counts = new Map<SectorKey, number>()
    for (const item of departments)
      if (visibleIds.has(item.id))
        counts.set(sectorOf(item.category).key, (counts.get(sectorOf(item.category).key) || 0) + 1)
    return counts
  }, [departments, visibleIds])
  const realFootprints = useMemo(
    () => (footprints ? departments.filter(item => footprints.byId.get(item.id)?.generic === false).length : 0),
    [departments, footprints]
  )

  // mutable animation state shared by the render loop and the handlers
  const motion = useRef({
    reduced: prefersReducedMotion(),
    lastInteraction: 0,
    flying: false,
    orbit: !prefersReducedMotion(),
    is3D: true,
    basemap: 'real' as Basemap,
    inView: true,
    risen: false,
    loaded: false,
    grow: new Map<string, number>(),
    tweens: new Map<string, Tween>(),
    targets: new Map<string, number>(),
    hovered: null as string | null,
    hoveredFacility: null as string | null,
    selected: null as string | null,
    tourToken: 0,
  })
  const onUnavailableRef = useRef(onUnavailable)
  const shownRef = useRef(shown)
  const departmentsRef = useRef(departments)
  const footprintsRef = useRef(footprints)
  // latest props for the long-lived map callbacks (written before the data effects below run)
  useLayoutEffect(() => {
    onUnavailableRef.current = onUnavailable
    shownRef.current = shown
    departmentsRef.current = departments
    footprintsRef.current = footprints
  })

  useEffect(() => {
    let alive = true
    void loadDepartmentFootprints().then(data => alive && setFootprints(data))
    void loadFacilityIndex().then(index => {
      if (!alive || !index) return
      setFacilityTotals(groupCounts(index.totals))
    })
    return () => {
      alive = false
    }
  }, [])

  /** only standing (or moving) buildings stay in the source — a zero-height extrusion still draws its roof */
  const syncBuildings = useCallback(() => {
    const map = mapRef.current
    const m = motion.current
    if (!map || !m.loaded) return
    const standing = departmentsRef.current.filter(
      item => m.targets.get(item.id) === 1 || m.tweens.has(item.id) || (!m.risen && shownRef.current.includes(item))
    )
    ;(map.getSource('dq-buildings') as GeoJSONSource).setData(buildingsOf(standing, footprintsRef.current))
    // while our building stands, the basemap's generic copy of it stays out of the way
    hideBasemapBuildings(
      map,
      standing.map(item => footprintsRef.current?.byId.get(item.id)?.osm),
      'departments'
    )
  }, [])

  /** animate every building toward its target height (staggered rise, quick fall) */
  const retarget = useCallback(
    (visible: LocatedDepartment[], stagger = 32) => {
      const m = motion.current
      const now = performance.now()
      const want = new Set(visible.map(item => item.id))
      // rise from the city centre outward
      const rising = [...visible].sort(
        (a, b) =>
          Math.hypot(a.lng - NASIRIYAH[0], a.lat - NASIRIYAH[1]) -
          Math.hypot(b.lng - NASIRIYAH[0], b.lat - NASIRIYAH[1])
      )
      let order = 0
      for (const item of rising) {
        if (m.targets.get(item.id) === 1) continue
        m.targets.set(item.id, 1)
        m.tweens.set(item.id, {
          from: m.grow.get(item.id) ?? 0,
          to: 1,
          start: now + (m.reduced ? 0 : order++ * stagger),
          duration: m.reduced ? 0 : 1100,
          ease: easeOutBack,
        })
      }
      for (const [id, target] of m.targets) {
        if (want.has(id) || target === 0) continue
        m.targets.set(id, 0)
        m.tweens.set(id, {
          from: m.grow.get(id) ?? 1,
          to: 0,
          start: now + (m.reduced ? 0 : Math.random() * 160),
          duration: m.reduced ? 0 : 520,
          ease: easeInCubic,
        })
      }
      syncBuildings()
    },
    [syncBuildings]
  )

  const flyTo = useCallback((options: Parameters<MapLibreMap['flyTo']>[0]) => {
    const map = mapRef.current
    if (!map) return
    const m = motion.current
    if (m.reduced) {
      const { padding, ...jump } = options
      map.jumpTo(typeof padding === 'number' ? jump : (options as Parameters<MapLibreMap['jumpTo']>[0]))
      return
    }
    m.flying = true
    map.once('moveend', () => {
      m.flying = false
    })
    map.flyTo({ ...options, essential: true })
  }, [])

  // ---- create the map once ----------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const m = motion.current
    let cancelled = false
    let map: MapLibreMap | null = null
    let raf = 0
    let removeBadges = () => {}
    const abort = new AbortController()
    const fail = () => {
      if (!cancelled) onUnavailableRef.current()
    }
    const loadTimer = window.setTimeout(fail, 20_000)

    const start = async () => {
      let raw: StyleSpecification
      let bounds: DistrictBounds
      let prints: DepartmentFootprints | null
      try {
        ;[raw, bounds, prints] = await Promise.all([
          fetchBaseStyle(abort.signal),
          loadDistrictBounds(),
          loadDepartmentFootprints(),
        ])
      } catch {
        return fail()
      }
      if (cancelled) return
      footprintsRef.current = prints
      const width = container.clientWidth || 1320
      const start = m.reduced
        ? { ...HOME, zoom: fitZoom(HOME.zoom, width) }
        : { ...OVERVIEW, zoom: fitZoom(OVERVIEW.zoom, width) }
      try {
        map = new MapLibreMap({
          container,
          style: brandStyle(raw, isDarkTheme() ? DARK : LIGHT),
          center: start.center,
          zoom: start.zoom,
          pitch: start.pitch,
          bearing: start.bearing,
          maxPitch: 75,
          minZoom: 6.5,
          maxZoom: 18.6,
          maxBounds: [
            [43.8, 29.4],
            [48.8, 33.2],
          ],
          attributionControl: false,
          cooperativeGestures: true,
          canvasContextAttributes: { antialias: true },
          locale: {
            ...MAP_LOCALE,
            'Map.Title': 'خريطة ثلاثية الأبعاد لدوائر محافظة ذي قار',
          },
        })
      } catch {
        return fail()
      }
      mapRef.current = map
      removeBadges = installBadgeFactory(map)
      // buildings grow upward, so sit the focal point a little below the middle
      map.setPadding({ top: width < 640 ? 110 : 70, bottom: 0, left: 0, right: 0 })
      map.addControl(new NavigationControl({ visualizePitch: true }), 'top-left')
      map.addControl(new FullscreenControl({ container: shellRef.current ?? undefined }), 'top-left')
      map.addControl(new AttributionControl({ compact: false, customAttribution: OSM_ATTRIBUTION }), 'bottom-left')

      map.on('error', event => {
        // a broken style before first paint means no usable map; later tile hiccups are ignored
        if (!map?.loaded() && !map?.isStyleLoaded()) console.warn('3D map error', event.error)
      })

      map.once('load', () => {
        if (cancelled || !map) return
        window.clearTimeout(loadTimer)
        addDepartmentLayers(map, prints)
        hideBasemapBuildings(map, landmarkKeys(prints), 'landmarks')
        facilitiesRef.current = addFacilityLayers(map, {
          minzoom: FACILITY_MIN_ZOOM,
          beforeId: 'dq-b-shadow',
          badgesBeforeId: 'dq-badges',
          auto: true,
          districtBounds: bounds,
        })
        applyBasemap(map, m.basemap)
        m.loaded = true
        setReady(true)
        if (m.reduced) {
          m.risen = true
          retarget(shownRef.current)
        } else {
          window.setTimeout(() => {
            if (cancelled) return
            flyTo({ ...HOME, zoom: fitZoom(HOME.zoom, width), duration: 7600, curve: 1.42 })
          }, 650)
        }
      })

      // buildings rise once the camera is close enough to see them
      map.on('zoom', () => {
        if (!m.risen && map && map.getZoom() >= CLUSTER_MAX_ZOOM) {
          m.risen = true
          retarget(shownRef.current)
        }
      })

      // ---- render loop: tweens, beacon pulse, cluster ripple and idle orbit ----------------------
      let last = performance.now()
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick)
        const dt = Math.min(now - last, 64)
        last = now
        if (!map || !m.loaded || !m.inView || document.hidden) return

        let fallen = false
        for (const [id, tween] of m.tweens) {
          const t = tween.duration ? Math.min(1, Math.max(0, (now - tween.start) / tween.duration)) : 1
          const value = tween.from + (tween.to - tween.from) * tween.ease(t)
          m.grow.set(id, value)
          map.setFeatureState({ source: 'dq-buildings', id }, { grow: Math.max(0, value) })
          if (t >= 1) {
            m.tweens.delete(id)
            if (tween.to === 0) fallen = true
          }
        }
        if (fallen) syncBuildings()

        const zoom = map.getZoom()
        if (!m.reduced) {
          if (zoom >= CLUSTER_MAX_ZOOM) {
            if (zoom < 14.5) {
              let i = 0
              for (const [id, value] of m.grow) {
                const pulse = (now / 2400 + i++ * 0.137) % 1
                map.setFeatureState({ source: 'dq-points', id }, { grow: Math.min(1, Math.max(0, value)), pulse })
              }
            }
          } else {
            const p = (now / 1800) % 1
            map.setPaintProperty('dq-cluster-ring', 'circle-stroke-width', 2 + 16 * p)
            map.setPaintProperty('dq-cluster-ring', 'circle-stroke-opacity', 0.55 * (1 - p))
          }
        } else {
          for (const [id, value] of m.grow)
            map.setFeatureState({ source: 'dq-points', id }, { grow: value, pulse: 0.4 })
        }

        const idle = now - m.lastInteraction > IDLE_RESUME_MS
        if (m.orbit && m.is3D && idle && !m.flying && !m.reduced && !map.isMoving())
          map.setBearing(map.getBearing() + dt * ORBIT_DEG_PER_MS)
      }
      raf = requestAnimationFrame(tick)
    }

    // any hand on the map pauses the orbit and an in-progress tour
    const touch = () => {
      m.lastInteraction = performance.now()
      if (m.tourToken) {
        m.tourToken = 0
        setTouring(false)
        setTourCaption('')
      }
    }
    const events = ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const
    for (const name of events) container.addEventListener(name, touch, { passive: true })

    const observer = new IntersectionObserver(([entry]) => {
      m.inView = entry.isIntersecting
    })
    observer.observe(container)

    // follow the site's light/dark switch without reloading tiles
    const themeObserver = new MutationObserver(() => {
      const current = mapRef.current
      if (!current?.isStyleLoaded()) return
      applyBasemap(current, m.basemap)
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-gov-theme'] })

    void start()
    return () => {
      cancelled = true
      abort.abort()
      window.clearTimeout(loadTimer)
      cancelAnimationFrame(raf)
      observer.disconnect()
      themeObserver.disconnect()
      for (const name of events) container.removeEventListener(name, touch)
      m.tourToken = 0
      removeBadges()
      facilitiesRef.current?.remove()
      facilitiesRef.current = null
      map?.remove()
      mapRef.current = null
    }
    // the map is created once; data changes flow through the effects below
  }, [flyTo, retarget, syncBuildings])

  // ---- department data ----------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    syncBuildings()
  }, [ready, departments, footprints, syncBuildings])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    ;(map.getSource('dq-clusters') as GeoJSONSource).setData(pointsOf(shown, footprints))
    ;(map.getSource('dq-points') as GeoJSONSource).setData(pointsOf(shown, footprints))
    if (motion.current.risen) retarget(shown, 22)
    setSelected(current => (current && !shown.some(item => item.id === current.id) ? null : current))
  }, [ready, shown, footprints, retarget])

  useEffect(() => {
    if (ready) facilitiesRef.current?.setGroups(shownGroups)
  }, [ready, shownGroups])

  useEffect(() => {
    const map = mapRef.current
    motion.current.basemap = basemap
    if (ready && map) applyBasemap(map, basemap)
  }, [ready, basemap])

  // ---- hover tooltip, selection and cluster zoom ------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const m = motion.current
    const setHover = (id: string | null) => {
      if (m.hovered === id) return
      if (m.hovered) map.setFeatureState({ source: 'dq-buildings', id: m.hovered }, { hover: false })
      m.hovered = id
      if (id) map.setFeatureState({ source: 'dq-buildings', id }, { hover: true })
    }
    const setFacilityHover = (id: string | null) => {
      if (m.hoveredFacility === id) return
      if (m.hoveredFacility) map.setFeatureState({ source: 'dq-fac', id: m.hoveredFacility }, { hover: false })
      m.hoveredFacility = id
      if (id) map.setFeatureState({ source: 'dq-fac', id }, { hover: true })
    }
    const pick = (features?: MapGeoJSONFeature[]) => {
      const id = features?.[0]?.properties?.id as string | undefined
      const item = id ? byId.get(id) : undefined
      return item && ((m.grow.get(item.id) ?? 0) > 0.2 || map.getZoom() < BUILDING_MIN_ZOOM) ? item : undefined
    }
    const onMove = (event: MapLayerMouseEvent) => {
      const item = pick(event.features)
      map.getCanvas().style.cursor = item ? 'pointer' : ''
      setHover(item?.id ?? null)
      setTooltip(item ? { x: event.point.x, y: event.point.y, item } : null)
    }
    const onLeave = () => {
      map.getCanvas().style.cursor = ''
      setHover(null)
      setTooltip(null)
    }
    const onClick = (event: MapLayerMouseEvent) => {
      const item = pick(event.features)
      if (item) {
        setFacility(null)
        setSelected(item)
      }
    }
    const onCluster = async (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0]
      if (!feature) return
      const zoom = await (map.getSource('dq-clusters') as GeoJSONSource).getClusterExpansionZoom(
        feature.properties.cluster_id as number
      )
      const [lng, lat] = (feature.geometry as Point).coordinates
      flyTo({
        center: [lng, lat],
        zoom: Math.max(zoom + 0.6, CLUSTER_MAX_ZOOM + 1.6),
        pitch: m.is3D ? 55 : 0,
        duration: 1800,
      })
    }
    // public facilities (OpenStreetMap)
    const onFacilityMove = (event: MapLayerMouseEvent) => {
      if (map.queryRenderedFeatures(event.point, { layers: interactive as unknown as string[] }).length) return
      const info = facilitiesRef.current?.info(event.features?.[0]?.properties ?? {}) ?? null
      map.getCanvas().style.cursor = info ? 'pointer' : ''
      setFacilityHover(info?.id ?? null)
      setFacilityTip(info ? { x: event.point.x, y: event.point.y, info } : null)
    }
    const onFacilityLeave = () => {
      setFacilityHover(null)
      setFacilityTip(null)
    }
    const onFacilityClick = (event: MapLayerMouseEvent) => {
      if (map.queryRenderedFeatures(event.point, { layers: interactive as unknown as string[] }).length) return
      const info = facilitiesRef.current?.info(event.features?.[0]?.properties ?? {}) ?? null
      if (!info) return
      setSelected(null)
      setFacility(info)
    }
    const interactive = ['dq-b-walls', 'dq-b-roof', 'dq-badges', 'dq-single'] as const
    for (const layer of interactive) {
      map.on('mousemove', layer, onMove)
      map.on('mouseleave', layer, onLeave)
      map.on('click', layer, onClick)
    }
    for (const layer of FACILITY_INTERACTIVE_LAYERS) {
      map.on('mousemove', layer, onFacilityMove)
      map.on('mouseleave', layer, onFacilityLeave)
      map.on('click', layer, onFacilityClick)
    }
    map.on('click', 'dq-cluster', onCluster)
    return () => {
      for (const layer of interactive) {
        map.off('mousemove', layer, onMove)
        map.off('mouseleave', layer, onLeave)
        map.off('click', layer, onClick)
      }
      for (const layer of FACILITY_INTERACTIVE_LAYERS) {
        map.off('mousemove', layer, onFacilityMove)
        map.off('mouseleave', layer, onFacilityLeave)
        map.off('click', layer, onFacilityClick)
      }
      map.off('click', 'dq-cluster', onCluster)
    }
  }, [ready, byId, flyTo])

  // fly to whatever gets selected and light up its building
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const m = motion.current
    if (m.selected) map.setFeatureState({ source: 'dq-buildings', id: m.selected }, { selected: false })
    m.selected = selected?.id ?? null
    map.setFilter('dq-badge-selected', ['==', ['get', 'id'], selected?.id ?? ''])
    if (!selected) return
    map.setFeatureState({ source: 'dq-buildings', id: selected.id }, { selected: true })
    m.lastInteraction = performance.now()
    flyTo({
      center: [selected.lng, selected.lat],
      zoom: Math.max(map.getZoom(), fitZoom(16.7, map.getContainer().clientWidth)),
      // keep the building clear of the card (beside it on wide screens, above it on phones)
      offset: map.getContainer().clientWidth < 640 ? [0, -120] : [-150, 40],
      pitch: m.is3D ? 64 : 0,
      bearing: map.getBearing() - 25,
      duration: 2200,
    })
  }, [ready, selected, flyTo])

  // ---- toolbar actions ------------------------------------------------------------------------------
  const toggle3D = () => {
    const next = !is3D
    setIs3D(next)
    motion.current.is3D = next
    const map = mapRef.current
    if (!map) return
    map.easeTo({
      pitch: next ? 60 : 0,
      bearing: next ? map.getBearing() - 20 : 0,
      duration: motion.current.reduced ? 0 : 1200,
    })
  }

  const homeFor = () => ({ ...HOME, zoom: fitZoom(HOME.zoom, containerRef.current?.clientWidth || 1320) })

  const toggleOrbit = () => {
    const next = !orbitOn
    setOrbitOn(next)
    motion.current.orbit = next
    motion.current.lastInteraction = next ? 0 : performance.now()
  }

  const resetView = () => {
    setSelected(null)
    setFacility(null)
    motion.current.lastInteraction = 0
    flyTo({ ...homeFor(), pitch: motion.current.is3D ? HOME.pitch : 0, duration: 2600 })
  }

  const tourStops = useMemo(() => {
    const groups = new Map<string, LocatedDepartment[]>()
    for (const item of shown) groups.set(item.district, [...(groups.get(item.district) || []), item])
    return [...groups.entries()]
      .map(([district, items]) => ({
        district,
        count: items.length,
        center: denseCentre(items),
      }))
      .sort((a, b) => b.count - a.count)
  }, [shown])

  const runTour = async () => {
    const map = mapRef.current
    const m = motion.current
    if (!map) return
    if (m.tourToken) {
      m.tourToken = 0
      setTouring(false)
      setTourCaption('')
      return
    }
    const token = Date.now()
    m.tourToken = token
    setTouring(true)
    setSelected(null)
    setFacility(null)
    const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))
    let bearing = map.getBearing()
    for (const stop of tourStops) {
      if (m.tourToken !== token) return
      bearing += 55
      setTourCaption(
        `${stop.district} · ${stop.count.toLocaleString('en-US')} ${stop.count > 10 ? 'جهة' : stop.count > 2 ? 'جهات' : 'جهة'}`
      )
      const view = {
        center: stop.center,
        zoom: fitZoom(stop.count > 10 ? 15 : 15.8, map.getContainer().clientWidth),
        pitch: m.is3D ? 62 : 0,
        bearing,
      }
      m.flying = true
      await new Promise<void>(resolve => {
        map.once('moveend', () => resolve())
        if (m.reduced) map.jumpTo(view)
        else map.flyTo({ ...view, duration: 4600, curve: 1.5, essential: true })
      })
      m.flying = false
      m.lastInteraction = 0 // orbit gently while the stop is on screen
      await wait(3400)
    }
    if (m.tourToken !== token) return
    m.tourToken = 0
    setTouring(false)
    setTourCaption('')
    flyTo({ ...homeFor(), pitch: m.is3D ? HOME.pitch : 0, duration: 3000 })
  }

  const toggleSector = (key: SectorKey) =>
    setHiddenSectors(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const toggleGroup = (key: FacilityGroup) =>
    setShownGroups(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const selectedSector = selected ? sectorOf(selected.category) : null
  const facilityMeta = facility ? FACILITY_TYPES[facility.type] : null
  const linkedDepartment = facility?.department ? byId.get(facility.department) : undefined
  const selectedPrint = selected ? footprints?.byId.get(selected.id) : undefined

  return (
    <div
      ref={shellRef}
      className={`map3d-shell${ready ? ' is-ready' : ''}${selected || facility ? ' has-card' : ''}`}
      data-basemap={basemap}
      role="region"
      aria-label="خريطة ثلاثية الأبعاد لدوائر محافظة ذي قار"
    >
      <div ref={containerRef} className="map3d-canvas" />
      {!ready && (
        <div className="map3d-loading" aria-live="polite">
          <span className="map3d-loading-ring" aria-hidden="true" />
          جارٍ تجهيز الخريطة ثلاثية الأبعاد…
        </div>
      )}

      <div className="map3d-toolbar" role="toolbar" aria-label="أدوات الخريطة">
        <button
          type="button"
          onClick={() => setBasemap(current => (current === 'real' ? 'map' : 'real'))}
          aria-pressed={basemap === 'real'}
          title="التبديل بين الصورة الفضائية الواقعية والخريطة"
        >
          {basemap === 'real' ? <Satellite aria-hidden="true" /> : <MapIcon aria-hidden="true" />}{' '}
          {basemap === 'real' ? 'واقعي' : 'خريطة'}
        </button>
        <button type="button" onClick={toggle3D} aria-pressed={is3D} title="التبديل بين العرض المسطح والمجسم">
          <Box aria-hidden="true" /> {is3D ? '3D' : '2D'}
        </button>
        <button type="button" onClick={runTour} aria-pressed={touring} disabled={!ready || tourStops.length === 0}>
          {touring ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />} {touring ? 'إيقاف' : 'جولة'}
        </button>
        <button
          type="button"
          onClick={toggleOrbit}
          aria-pressed={orbitOn}
          title="الدوران التلقائي البطيء عند عدم الاستخدام"
          disabled={reducedMotion}
        >
          <Compass aria-hidden="true" /> دوران
        </button>
        <button
          type="button"
          onClick={resetView}
          aria-label="العودة إلى مركز الناصرية"
          title="العودة إلى مركز الناصرية"
        >
          <RotateCcw aria-hidden="true" />
        </button>
      </div>

      {tourCaption && (
        <div className="map3d-caption" aria-live="polite">
          <Navigation aria-hidden="true" /> {tourCaption}
        </div>
      )}

      <div className={`map3d-legend${legendOpen ? ' is-open' : ''}`}>
        <button
          type="button"
          className="map3d-legend-toggle"
          aria-expanded={legendOpen}
          onClick={() => setLegendOpen(open => !open)}
        >
          <Layers aria-hidden="true" /> الطبقات
        </button>
        {legendOpen && (
          <div className="map3d-legend-body">
            <p className="map3d-legend-title">
              <i className="map3d-legend-pin" aria-hidden="true" /> دوائر على المنصة
            </p>
            <ul>
              {SECTOR_FAMILIES.map(family => {
                const off = hiddenSectors.has(family.key)
                const count = sectorCounts.get(family.key) || 0
                return (
                  <li key={family.key}>
                    <button
                      type="button"
                      aria-pressed={!off}
                      onClick={() => toggleSector(family.key)}
                      style={{ '--sector': family.color } as CSSProperties}
                      disabled={count === 0}
                    >
                      <i aria-hidden="true" />
                      <span>{family.label}</span>
                      <b>{count.toLocaleString('en-US')}</b>
                    </button>
                  </li>
                )
              })}
            </ul>
            {facilityTotals.size > 0 && (
              <>
                <button
                  type="button"
                  className="map3d-legend-title is-toggle"
                  aria-expanded={facilitiesOpen}
                  onClick={() => setFacilitiesOpen(open => !open)}
                >
                  <Building2 aria-hidden="true" /> مرافق عامة (OSM)
                  <b>{[...facilityTotals.values()].reduce((sum, n) => sum + n, 0).toLocaleString('en-US')}</b>
                </button>
                <ul className="map3d-legend-facilities" hidden={!facilitiesOpen}>
                  {FACILITY_GROUPS.map(group => {
                    const count = facilityTotals.get(group.key) || 0
                    return (
                      <li key={group.key}>
                        <button
                          type="button"
                          aria-pressed={shownGroups.has(group.key)}
                          onClick={() => toggleGroup(group.key)}
                          style={{ '--sector': group.color } as CSSProperties}
                          disabled={count === 0}
                        >
                          <i aria-hidden="true" />
                          <span>{group.label}</span>
                          <b>{count.toLocaleString('en-US')}</b>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
            <p className="map3d-legend-note">
              {footprints
                ? `مخططات المباني من OpenStreetMap: ${realFootprints.toLocaleString('en-US')} من ${departments.length.toLocaleString('en-US')} دائرة بمخطط حقيقي، والباقي مبنى تقريبي.`
                : 'المباني من OpenStreetMap.'}{' '}
              تغطية المرافق غير مكتملة.
            </p>
          </div>
        )}
      </div>

      {tooltip && !selected && (
        <div className="map3d-tooltip" style={{ left: tooltip.x, top: tooltip.y }} role="tooltip">
          <strong>{tooltip.item.name}</strong>
          <span>
            {tooltip.item.district} · {tooltip.item.services.length.toLocaleString('en-US')} خدمة · على المنصة
          </span>
        </div>
      )}
      {facilityTip && !tooltip && !facility && (
        <div className="map3d-tooltip" style={{ left: facilityTip.x, top: facilityTip.y }} role="tooltip">
          <strong>{facilityTip.info.name ?? FACILITY_TYPES[facilityTip.info.type].label}</strong>
          <span>
            {FACILITY_TYPES[facilityTip.info.type].label} · {facilityTip.info.district}
          </span>
        </div>
      )}

      {selected && selectedSector && (
        <aside
          className="map3d-card"
          aria-label={`بطاقة ${selected.name}`}
          style={{ '--sector': selectedSector.color } as CSSProperties}
        >
          <button
            type="button"
            className="map3d-card-close"
            onClick={() => setSelected(null)}
            aria-label="إغلاق البطاقة"
          >
            <X aria-hidden="true" />
          </button>
          <span className="map3d-card-sector">{selected.category}</span>
          <h3>{selected.name}</h3>
          <p>
            <MapPin aria-hidden="true" /> {selected.district}
            {selected.address ? ` — ${selected.address}` : ''}
          </p>
          <dl>
            <div>
              <dt>خدمات</dt>
              <dd>{selected.services.length.toLocaleString('en-US')}</dd>
            </div>
            <div>
              <dt>خدمات رقمية</dt>
              <dd>{(selected.digitalServices ?? 0).toLocaleString('en-US')}</dd>
            </div>
          </dl>
          <ShapeNote shape={departmentShape(selectedPrint)} />
          <div className="map3d-card-actions">
            <Link href={`/departments/${selected.id}`} className="button primary small">
              صفحة الدائرة
            </Link>
            <a
              href={directionsUrl(selected.lat, selected.lng)}
              target="_blank"
              rel="noopener noreferrer"
              className="button outline small"
            >
              <Navigation aria-hidden="true" /> الاتجاهات
            </a>
          </div>
        </aside>
      )}

      {facility && facilityMeta && (
        <aside
          className="map3d-card is-facility"
          aria-label={`بطاقة ${facility.name ?? facilityMeta.label}`}
          style={{ '--sector': groupColor(facilityMeta.group) } as CSSProperties}
        >
          <button
            type="button"
            className="map3d-card-close"
            onClick={() => setFacility(null)}
            aria-label="إغلاق البطاقة"
          >
            <X aria-hidden="true" />
          </button>
          <span className="map3d-card-sector">{facilityMeta.label}</span>
          <h3>{facility.name ?? `${facilityMeta.label} (بلا اسم في الخريطة)`}</h3>
          <p>
            <MapPin aria-hidden="true" /> قضاء {facility.district}
          </p>
          <p className="map3d-card-source">
            المصدر: OpenStreetMap ·{' '}
            <a href={osmUrl(facility.osm)} target="_blank" rel="noopener noreferrer">
              عرض العنصر <ExternalLink aria-hidden="true" />
            </a>
          </p>
          {facility.shape && <ShapeNote shape={facility.shape} />}
          {linkedDepartment && (
            <div className="map3d-card-actions">
              <Link href={`/departments/${linkedDepartment.id}`} className="button primary small">
                دائرة على المنصة
              </Link>
            </div>
          )}
        </aside>
      )}
    </div>
  )
}

// ---- department layers ------------------------------------------------------------------------------

function addDepartmentLayers(map: MapLibreMap, prints: DepartmentFootprints | null) {
  const palette = isDarkTheme() ? DARK : LIGHT
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
  addFacadeImages(map)
  map.addSource('dq-buildings', { type: 'geojson', data: empty, promoteId: 'id' })
  map.addSource('dq-points', { type: 'geojson', data: empty, promoteId: 'id' })
  map.addSource('dq-sites', { type: 'geojson', data: prints?.sites ?? empty })
  map.addSource('dq-clusters', { type: 'geojson', data: empty, cluster: true, clusterRadius: 46, clusterMaxZoom: 10 })

  // imagery and plots sit under the place names
  const firstSymbol = map.getStyle().layers.find(layer => layer.type === 'symbol')?.id
  addSatelliteLayer(map, firstSymbol, false)

  // the compound each office stands in: a faint tinted plot
  map.addLayer(
    {
      id: 'dq-sites',
      type: 'fill',
      source: 'dq-sites',
      minzoom: 14,
      paint: { 'fill-color': '#7fdcb4', 'fill-opacity': 0.14, 'fill-outline-color': 'rgba(127,220,180,0.7)' },
    },
    firstSymbol
  )
  // mid zoom: a soft beacon ripple where each department stands
  map.addLayer(
    {
      id: 'dq-pulse',
      type: 'circle',
      source: 'dq-points',
      minzoom: CLUSTER_MAX_ZOOM,
      maxzoom: 14.6,
      paint: {
        'circle-pitch-alignment': 'map',
        'circle-radius': [
          'interpolate',
          ['exponential', 2],
          ['zoom'],
          11,
          ['+', 4, ['*', 14, PULSE]],
          14.6,
          ['+', 20, ['*', 90, PULSE]],
        ],
        'circle-opacity': 0,
        'circle-stroke-width': 2,
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-opacity': ['*', ['min', 1, GROW], ['-', 1, PULSE], 0.8],
      },
    },
    firstSymbol
  )

  addBuildingLayers(map, {
    source: 'dq-buildings',
    prefix: 'dq-b',
    minzoom: BUILDING_MIN_ZOOM,
    height: buildingHeight,
    roof: ROOF_COLOR,
    glow: ['get', 'color'],
    beforeId: firstSymbol,
  })
  if (prints?.landmarks.features.length) addLandmarkLayers(map, prints.landmarks)

  // the floating badge: category icon on the sector colour, mint ring = "on the platform"
  map.addLayer({
    id: 'dq-badges',
    type: 'symbol',
    source: 'dq-points',
    minzoom: CLUSTER_MAX_ZOOM,
    layout: {
      'icon-image': badgeExpression('dept'),
      'icon-size': ['interpolate', ['linear'], ['zoom'], CLUSTER_MAX_ZOOM, 0.62, 14, 0.85, 16.5, 1],
      'icon-anchor': 'bottom',
      'icon-allow-overlap': true,
      'symbol-sort-key': ['-', 0, ['get', 'h']],
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 14, 11.5, 17, 13.5],
      'text-anchor': 'bottom',
      'text-offset': [0, -3.9],
      'text-max-width': 11,
      'text-optional': true,
      'text-padding': 4,
    },
    paint: {
      'icon-opacity': ['interpolate', ['linear'], ['zoom'], CLUSTER_MAX_ZOOM, 0, CLUSTER_MAX_ZOOM + 0.3, 1],
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 13.6, 0, 14.1, 1],
      'text-color': palette.text,
      'text-halo-color': palette.halo,
      'text-halo-width': 1.6,
    },
  })
  // a larger copy of the badge marks the selected department
  map.addLayer({
    id: 'dq-badge-selected',
    type: 'symbol',
    source: 'dq-points',
    filter: ['==', ['get', 'id'], ''],
    layout: {
      'icon-image': badgeExpression('dept'),
      'icon-size': 1.35,
      'icon-anchor': 'bottom',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })

  // zoomed out: animated cluster bubbles
  const bubble: ExpressionSpecification = ['step', ['get', 'point_count'], 17, 5, 21, 15, 26, 30, 31]
  map.addLayer({
    id: 'dq-cluster-ring',
    type: 'circle',
    source: 'dq-clusters',
    maxzoom: CLUSTER_MAX_ZOOM,
    filter: ['has', 'point_count'],
    paint: {
      'circle-radius': bubble,
      'circle-opacity': 0,
      'circle-stroke-color': palette.cluster,
      'circle-stroke-width': 4,
      'circle-stroke-opacity': 0.35,
    },
  })
  map.addLayer({
    id: 'dq-cluster',
    type: 'circle',
    source: 'dq-clusters',
    maxzoom: CLUSTER_MAX_ZOOM,
    filter: ['has', 'point_count'],
    paint: {
      'circle-radius': bubble,
      'circle-color': palette.cluster,
      'circle-stroke-color': palette.clusterStroke,
      'circle-stroke-width': 3,
      'circle-opacity-transition': { duration: 400 },
    },
  })
  map.addLayer({
    id: 'dq-cluster-count',
    type: 'symbol',
    source: 'dq-clusters',
    maxzoom: CLUSTER_MAX_ZOOM,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 14,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': palette.clusterText },
  })
  map.addLayer({
    id: 'dq-single',
    type: 'circle',
    source: 'dq-clusters',
    maxzoom: CLUSTER_MAX_ZOOM,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': 7,
      'circle-color': ['get', 'color'],
      'circle-stroke-color': palette.clusterStroke,
      'circle-stroke-width': 2.5,
    },
  })
}

/**
 * Ground under the satellite imagery. The vector land, water and roads sit below the imagery, so in the
 * realistic view they only ever show where an imagery tile has not arrived yet (right after the intro
 * flight aborts the in-between zooms, or on a slow connection): there a dull earth tone reads as "still
 * loading", where the cream map palette looked like a huge flat sand slab in the pitched view.
 */
const IMAGERY_GROUND = '#857e6d'

/** the base map's own building layers, retuned for the realistic (satellite) view */
function applyBasemap(map: MapLibreMap, basemap: Basemap) {
  const real = basemap === 'real'
  const dark = isDarkTheme() && !real
  const palette: Palette = dark ? DARK : LIGHT
  for (const layer of map.getStyle().layers as StyleLayer[]) {
    if (layer.id.startsWith('dq-')) continue
    const paint = themePaint(layer, palette)
    if (real && layer.type === 'symbol') {
      paint['text-color'] = layer['source-layer'] === 'transportation_name' ? '#f1ece0' : '#ffffff'
      paint['text-halo-color'] = 'rgba(12,16,12,0.85)'
      paint['text-halo-width'] = 1.6
    }
    if (real && layer.type === 'background') paint['background-color'] = IMAGERY_GROUND
    for (const [prop, value] of Object.entries(paint))
      map.setPaintProperty(layer.id, prop as 'fill-color', value as string)
    // The generic city massing, in the platform palette on the map view. Over the imagery the real
    // buildings take over: the basemap merges same-height blocks (whole compounds drawn as building=yes
    // among them) into one feature, so its translucent copy cannot be masked building by building and
    // would show as tan slabs, ghost shells and holes around the platform's own extrusions.
    if (layer.id === 'building-3d') {
      map.setPaintProperty(layer.id, 'fill-extrusion-color', palette.buildingTop)
      map.setPaintProperty(layer.id, 'fill-extrusion-opacity', 0.88)
      map.setLayoutProperty(layer.id, 'visibility', real ? 'none' : 'visible')
    }
    // flat land, water, roads and 2D buildings: hidden under the imagery (a missing tile shows bare ground)
    if (layer.type === 'fill' || layer.type === 'line')
      map.setLayoutProperty(layer.id, 'visibility', real ? 'none' : 'visible')
  }
  map.setSky(skyFor(real ? LIGHT : palette))
  map.setLayoutProperty('dq-satellite', 'visibility', real ? 'visible' : 'none')
  setFacadeTheme(map, dark)
  // department and facility labels follow the ground they sit on
  const text = real ? '#ffffff' : palette.text
  const halo = real ? 'rgba(12,16,12,0.88)' : palette.halo
  for (const id of ['dq-badges', 'dq-fac-badges']) {
    if (!map.getLayer(id)) continue
    map.setPaintProperty(
      id,
      'text-color',
      id === 'dq-fac-badges' && !real ? mix(palette.text, palette.land, 0.15) : text
    )
    map.setPaintProperty(id, 'text-halo-color', halo)
  }
  map.setPaintProperty('dq-cluster', 'circle-color', palette.cluster)
  map.setPaintProperty('dq-cluster', 'circle-stroke-color', palette.clusterStroke)
  map.setPaintProperty('dq-cluster-ring', 'circle-stroke-color', palette.cluster)
  map.setPaintProperty('dq-cluster-count', 'text-color', palette.clusterText)
  map.setPaintProperty('dq-single', 'circle-stroke-color', palette.clusterStroke)
}
