import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'wouter'
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type LngLatBoundsLike,
  type MapLayerMouseEvent,
} from 'maplibre-gl'
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon, Position } from 'geojson'
import { ArrowRight, ExternalLink, MapPin, ShieldAlert, X } from 'lucide-react'
import {
  brandStyle,
  DARK,
  easeInCubic,
  easeOutBack,
  fetchBaseStyle,
  hexagon,
  LIGHT,
  MAP_LOCALE,
  mix,
  prefersReducedMotion,
  skyFor,
  themePaint,
  type Palette,
  type StyleLayer,
} from './maplibre-base'
import { DISTRICT_FACTS, districtKey } from './dhiqar-district-facts'
import {
  DRILL_COLUMN_INSET,
  DRILL_SHEET_MAX_WIDTH,
  drillColumnWidth,
  openWork,
  summarizeDistricts,
  type DistrictProps,
  type DistrictSummary,
  type OpsDepartment,
  type OpsState,
} from './district-data'
import {
  addBuildingLayers,
  addFacadeImages,
  addFacilityLayers,
  setFacadeTheme,
  addLandmarkLayers,
  badgeExpression,
  FACILITY_INTERACTIVE_LAYERS,
  FACILITY_TYPES,
  facadeOf,
  groupColor,
  hideBasemapBuildings,
  iconForCategory,
  installBadgeFactory,
  landmarkKeys,
  loadDepartmentFootprints,
  OSM_ATTRIBUTION,
  osmUrl,
  standInSquare,
  type DepartmentFootprints,
  type FacilityInfo,
  type FacilityLayerHandle,
} from './realistic-buildings'
import { departmentShape } from './building-shape'
import { ShapeNote } from './ShapeNote'

export type { OpsDepartment, OpsState }
export type Basemap = 'dark' | 'light' | 'satellite'

/** imperative controls the GIS shell's own buttons drive */
export type DrillMapApi = {
  zoomIn: () => void
  zoomOut: () => void
  fitGovernorate: () => void
  focusDepartment: (id: string) => void
}

type Props = {
  /** every department (district roll-ups count unmapped ones too) */
  departments: OpsDepartment[]
  /** the departments that pass the shell's search / sector filter */
  visibleIds: ReadonlySet<string>
  stateOf: (department: OpsDepartment) => OpsState
  basemap: Basemap
  showDistricts: boolean
  showLandmarks: boolean
  selectedId: string | null
  onSelectDepartment: (id: string | null) => void
  /** the district drilled into: the host owns it (its toolbar picker and profile panel drive the map) */
  drill: string | null
  onDrillChange: (name: string | null) => void
  /** operations room: workload and staffing; governor: performance KPIs */
  variant: 'operations' | 'governor'
  onReady?: (api: DrillMapApi) => void
  onCursor?: (point: { lat: number; lng: number } | null) => void
  onUnavailable: () => void
  /** the host's district profile is folded to its title bar: a drill frames the district over the whole map */
  panelCollapsed?: boolean
}

type DistrictFeature = Feature<Polygon | MultiPolygon, DistrictProps>

const GEO_URL = '/geo/dhiqar-districts.geojson'
const GOVERNORATE: LngLatBoundsLike = [
  [45.62, 30.52],
  [47.15, 32.02],
]
const UR: [number, number] = [46.1031, 30.9627]
const HOME = { pitch: 48, bearing: -14 }

// slab heights in metres (exaggerated — the governorate is ~150 km across)
const SLAB = 3500
const LIFT = 9000
const HOVER = 2600
const STATE_COLORS: Record<OpsState, string> = { idle: '#2fc489', busy: '#f2b24c', alert: '#ff5d6c' }
/** from here in, real buildings replace the department pillars */
const BUILDING_MIN_ZOOM = 12.6
const PILLAR_MAX_ZOOM = 13.2
const FACILITY_MIN_ZOOM = 13.2
const BUILDING_SCALE = 1.2
/** at or below this map width the cards are a bottom sheet (CSS: map3d-drill.css, @container drillmap) */
const CARD_SHEET_MAX_WIDTH = 640

const fmt = (value: number) => value.toLocaleString('en-US')

function ringsOf(geometry: Polygon | MultiPolygon): Position[][] {
  return geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.coordinates.map(polygon => polygon[0])
}

function boundsOf(geometry: Polygon | MultiPolygon): [[number, number], [number, number]] {
  let [minX, minY, maxX, maxY] = [180, 90, -180, -90]
  for (const ring of ringsOf(geometry))
    for (const [x, y] of ring) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  return [
    [minX, minY],
    [maxX, maxY],
  ]
}

/** a point well inside the polygon (largest ring's vertex average, nudged to the bbox centre if it falls outside) */
function labelPoint(geometry: Polygon | MultiPolygon): [number, number] {
  const ring = ringsOf(geometry).sort((a, b) => b.length - a.length)[0]
  const inside = (x: number, y: number) => {
    let hit = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
    }
    return hit
  }
  const avg: [number, number] = [
    ring.reduce((sum, p) => sum + p[0], 0) / ring.length,
    ring.reduce((sum, p) => sum + p[1], 0) / ring.length,
  ]
  if (inside(...avg)) return avg
  const [[x0, y0], [x1, y1]] = boundsOf(geometry)
  const centre: [number, number] = [(x0 + x1) / 2, (y0 + y1) / 2]
  return inside(...centre) ? centre : [ring[0][0], ring[0][1]]
}

type DistrictRow = DistrictSummary & {
  feature: DistrictFeature
  bounds: [[number, number], [number, number]]
  label: [number, number]
}

type Tween = { from: number; to: number; start: number; duration: number; ease: (t: number) => number }

const S = (key: string, fallback = 0): ExpressionSpecification => ['coalesce', ['feature-state', key], fallback]
/** top of a district slab: lifted districts float, sunk ones flatten, hovered ones rise a little */
const SLAB_TOP: ExpressionSpecification = [
  '*',
  S('rise'),
  ['+', ['*', LIFT, S('lift')], ['*', SLAB, ['-', 1, ['*', 0.86, S('sink')]]], ['*', HOVER, S('hover')]],
]
const SLAB_BASE: ExpressionSpecification = ['*', S('rise'), ['*', LIFT, S('lift')]]

/**
 * Vertical exaggeration fades as the camera descends: kilometre-high slabs read well over the whole
 * governorate but would sit above the camera at street level.
 */
const zScaled = (expression: ExpressionSpecification, near = 0.05): ExpressionSpecification => [
  'interpolate',
  ['linear'],
  ['zoom'],
  8,
  expression,
  10,
  ['*', 0.55, expression],
  12,
  ['*', Math.max(near, 0.16), expression],
  14,
  ['*', near, expression],
]
/** a pillar standing on its district's (scaled) slab */
const standing = (height: ExpressionSpecification): ExpressionSpecification => [
  'interpolate',
  ['linear'],
  ['zoom'],
  8,
  ['+', S('base', SLAB), height],
  10,
  ['+', ['*', 0.55, S('base', SLAB)], ['*', 0.8, height]],
  12,
  ['+', ['*', 0.16, S('base', SLAB)], ['*', 0.45, height]],
  14,
  ['+', ['*', 0.05, S('base', SLAB)], ['*', 0.25, height]],
]

export default function DistrictDrillMap(props: Props) {
  const { departments, visibleIds, stateOf, basemap, showDistricts, showLandmarks, selectedId, drill, variant } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [geo, setGeo] = useState<DistrictFeature[] | null>(null)
  const [ready, setReady] = useState(false)
  const [hover, setHover] = useState<{ x: number; y: number; name: string } | null>(null)
  const [pillarTip, setPillarTip] = useState<{ x: number; y: number; id: string } | null>(null)
  const [reduced] = useState(prefersReducedMotion)
  const [facility, setFacility] = useState<FacilityInfo | null>(null)
  const [facilityTip, setFacilityTip] = useState<{ x: number; y: number; info: FacilityInfo } | null>(null)
  const facilitiesRef = useRef<FacilityLayerHandle | null>(null)
  const printsRef = useRef<DepartmentFootprints | null>(null)
  /** the same footprints, for the department card's «real outline or approximate shape» line */
  const [prints, setPrints] = useState<DepartmentFootprints | null | undefined>(undefined)
  const cardRef = useRef<HTMLElement>(null)

  const latest = useRef(props)
  useLayoutEffect(() => {
    latest.current = props
  })

  const motion = useRef({
    tweens: new Map<string, Tween>(), // key: `${district}|${state}`
    values: new Map<string, number>(),
    hovered: null as string | null,
    loaded: false,
  })

  /** the host owns the drill-down (picker, profile panel); the map asks it to change */
  const setDrill = useCallback((name: string | null) => latest.current.onDrillChange(name), [])

  const byId = useMemo(() => new Map(departments.map(item => [String(item.id), item])), [departments])
  const byIdRef = useRef(byId)
  useLayoutEffect(() => {
    byIdRef.current = byId
  })

  const districts = useMemo(
    (): DistrictRow[] =>
      geo
        ? summarizeDistricts(geo, departments, stateOf).map(row => ({
            ...row,
            bounds: boundsOf(row.feature.geometry),
            label: labelPoint(row.feature.geometry),
          }))
        : [],
    [geo, departments, stateOf]
  )
  const districtsRef = useRef(districts)
  useLayoutEffect(() => {
    districtsRef.current = districts
  })

  // ---- animation helpers --------------------------------------------------------------------------
  const animate = useCallback(
    (district: string, key: 'rise' | 'lift' | 'sink' | 'hover', to: number, duration: number, delay = 0) => {
      const m = motion.current
      const id = `${district}|${key}`
      const from = m.values.get(id) ?? 0
      if (from === to && !m.tweens.has(id)) return
      m.tweens.set(id, {
        from,
        to,
        start: performance.now() + (reduced ? 0 : delay),
        duration: reduced ? 0 : duration,
        ease:
          to > from && key !== 'hover' ? easeOutBack : key === 'hover' ? (t: number) => 1 - (1 - t) ** 3 : easeInCubic,
      })
    },
    [reduced]
  )

  // ---- load the boundaries -----------------------------------------------------------------------
  useEffect(() => {
    let alive = true
    fetch(GEO_URL)
      .then(response => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: FeatureCollection<Polygon | MultiPolygon, DistrictProps>) => alive && setGeo(data.features))
      .catch(() => alive && latest.current.onUnavailable())
    return () => {
      alive = false
    }
  }, [])

  // ---- create the map once the boundaries are in ------------------------------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container || !geo) return
    const m = motion.current
    let map: MapLibreMap | null = null
    let raf = 0
    let cancelled = false
    const abort = new AbortController()
    const fail = () => !cancelled && latest.current.onUnavailable()
    const loadTimer = window.setTimeout(fail, 20_000)

    const start = async () => {
      let raw
      try {
        ;[raw, printsRef.current] = await Promise.all([fetchBaseStyle(abort.signal), loadDepartmentFootprints()])
      } catch {
        return fail()
      }
      if (cancelled) return
      setPrints(printsRef.current)
      const palette = paletteFor(latest.current.basemap)
      try {
        map = new MapLibreMap({
          container,
          style: brandStyle(raw, palette),
          ...(reduced
            ? { bounds: GOVERNORATE, fitBoundsOptions: { padding: 40 }, pitch: HOME.pitch, bearing: HOME.bearing }
            : { center: [46.38, 31.27] as [number, number], zoom: 6.4, pitch: 0, bearing: 0 }),
          maxPitch: 72,
          minZoom: 6,
          maxBounds: [
            [43.5, 29.2],
            [49.2, 33.4],
          ],
          attributionControl: false,
          canvasContextAttributes: { antialias: true },
          locale: { ...MAP_LOCALE, 'Map.Title': 'خريطة ذي قار التشغيلية ثلاثية الأبعاد' },
        })
      } catch {
        return fail()
      }
      mapRef.current = map
      const removeBadges = installBadgeFactory(map)
      map.once('remove', removeBadges)
      map.addControl(
        new AttributionControl({
          compact: false,
          customAttribution: `حدود الأقضية © OpenStreetMap contributors (ODbL) · ${OSM_ATTRIBUTION} · السكان: تعداد 2024`,
        }),
        'bottom-right'
      )
      map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right')
      map.addControl(new NavigationControl({ visualizePitch: true, showZoom: false }), 'bottom-right')

      map.once('load', () => {
        if (cancelled || !map) return
        window.clearTimeout(loadTimer)
        addLayers(map, geo, palette)
        addRealBuildings(map, printsRef.current)
        hideBasemapBuildings(map, landmarkKeys(printsRef.current), 'landmarks')
        facilitiesRef.current = addFacilityLayers(map, {
          minzoom: FACILITY_MIN_ZOOM,
          beforeId: 'dq-ob-shadow',
          badgesBeforeId: 'dq-obadges',
          auto: true,
          districtBounds: new Map(
            geo
              .filter(feature => feature.properties.kind === 'district')
              .map(feature => [feature.properties.name, boundsOf(feature.geometry)])
          ),
        })
        recolorBuildings(map, latest.current.basemap)
        m.loaded = true
        setReady(true)
        latest.current.onReady?.({
          zoomIn: () => map?.zoomIn(),
          zoomOut: () => map?.zoomOut(),
          // out of a district: the drill-down effect frames the governorate; already out: re-frame it now
          fitGovernorate: () =>
            latest.current.drill
              ? setDrill(null)
              : map?.fitBounds(GOVERNORATE, {
                  padding: 40,
                  pitch: HOME.pitch,
                  bearing: HOME.bearing,
                  duration: reduced ? 0 : 1400,
                }),
          focusDepartment: id => latest.current.onSelectDepartment(id),
        })
        // districts rise one after another while the camera tilts in
        districtsRef.current.forEach((row, index) => animate(row.name, 'rise', 1, 1100, 250 + index * 90))
        if (!reduced)
          map.fitBounds(GOVERNORATE, { padding: 40, pitch: HOME.pitch, bearing: HOME.bearing, duration: 3200 })
      })

      map.on('mousemove', event => latest.current.onCursor?.({ lat: event.lngLat.lat, lng: event.lngLat.lng }))
      map.on('mouseout', () => latest.current.onCursor?.(null))

      const tick = (now: number) => {
        raf = requestAnimationFrame(tick)
        if (!map || !m.loaded || m.tweens.size === 0) return
        const touched = new Set<string>()
        for (const [id, tween] of m.tweens) {
          const t = tween.duration ? Math.min(1, Math.max(0, (now - tween.start) / tween.duration)) : 1
          if (now < tween.start && tween.duration) continue
          const value = tween.from + (tween.to - tween.from) * tween.ease(t)
          m.values.set(id, value)
          const [district, key] = id.split('|')
          map.setFeatureState({ source: 'dq-districts', id: district }, { [key]: value })
          touched.add(district)
          if (t >= 1) m.tweens.delete(id)
        }
        // pillars and towers ride on top of their district's slab
        for (const district of touched) {
          const v = (key: string) => m.values.get(`${district}|${key}`) ?? 0
          const top = v('rise') * (LIFT * v('lift') + SLAB * (1 - 0.86 * v('sink')) + HOVER * v('hover'))
          map.setFeatureState({ source: 'dq-towers', id: district }, { base: top, rise: v('rise'), sink: v('sink') })
          for (const row of districtsRef.current)
            if (row.name === district)
              for (const item of row.departments)
                map.setFeatureState({ source: 'dq-pillars', id: String(item.id) }, { base: top, rise: v('rise') })
        }
      }
      raf = requestAnimationFrame(tick)
    }
    void start()
    return () => {
      cancelled = true
      abort.abort()
      window.clearTimeout(loadTimer)
      cancelAnimationFrame(raf)
      facilitiesRef.current?.remove()
      facilitiesRef.current = null
      map?.remove()
      mapRef.current = null
      m.loaded = false
    }
  }, [geo, animate, reduced, setDrill])

  // ---- data: towers per district, pillars per department ----------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const towers: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: districts.map(row => ({
        type: 'Feature',
        geometry: hexagon(row.label[0], row.label[1], 4200),
        properties: {
          id: row.name,
          h: 3000 + Math.min(row.departments.length, 30) * 700,
          color: STATE_COLORS[row.alerts ? 'alert' : row.open ? 'busy' : 'idle'],
          label: `${row.name}\n${fmt(row.departments.length)} جهة`,
        },
      })),
    }
    const labels: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: districts.map(row => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: row.label },
        properties: {
          id: row.name,
          label: row.name,
          sub: DISTRICT_FACTS[row.name] ? `${fmt(DISTRICT_FACTS[row.name].population)} نسمة` : '',
        },
      })),
    }
    ;(map.getSource('dq-towers') as GeoJSONSource).setData(towers)
    ;(map.getSource('dq-labels') as GeoJSONSource).setData(labels)
    const m = motion.current
    for (const row of districts) {
      const v = (key: string) => m.values.get(`${row.name}|${key}`) ?? 0
      const top = v('rise') * (LIFT * v('lift') + SLAB * (1 - 0.86 * v('sink')) + HOVER * v('hover'))
      map.setFeatureState({ source: 'dq-towers', id: row.name }, { base: top, rise: v('rise'), sink: v('sink') })
    }
  }, [ready, districts])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const located = departments.filter(
      (item): item is OpsDepartment & { lat: number; lng: number } =>
        typeof item.lat === 'number' && typeof item.lng === 'number' && visibleIds.has(String(item.id))
    )
    ;(map.getSource('dq-pillars') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: located.map(item => ({
        type: 'Feature',
        geometry: hexagon(item.lng, item.lat, 420),
        properties: {
          id: String(item.id),
          h: 1400 + Math.min(openWork(item), 20) * 320,
          color: STATE_COLORS[stateOf(item)],
          district: districtKey(item.district),
        },
      })),
    })
    // real buildings (zoomed in): the department's OSM footprint, roof tinted by its state
    const prints = printsRef.current
    const realProps = (item: (typeof located)[number]) => {
      const id = String(item.id)
      const color = STATE_COLORS[stateOf(item)]
      const footprint = prints?.byId.get(id)
      const { facade, roof } = facadeOf(id)
      return {
        id,
        color,
        facade,
        roof: mix(roof, color, 0.5),
        h: (footprint?.height ?? 12) * BUILDING_SCALE,
        g: footprint && !footprint.generic ? 0 : 1,
        icon: iconForCategory(item.type),
        name: item.name,
      }
    }
    ;(map.getSource('dq-obuild') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: located.map(item => ({
        type: 'Feature',
        geometry: prints?.byId.get(String(item.id))?.ring ?? standInSquare(item.lng, item.lat),
        properties: realProps(item),
      })),
    })
    // the basemap's generic copy of each building drawn here stays out of the way
    hideBasemapBuildings(
      map,
      located.map(item => prints?.byId.get(String(item.id))?.osm),
      'departments'
    )
    ;(map.getSource('dq-opoints') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: located.map(item => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [item.lng, item.lat] },
        properties: realProps(item),
      })),
    })
    // newly drawn pillars start on their district's current slab
    const m = motion.current
    for (const item of located) {
      const district = districtKey(item.district)
      // a district missing from the boundary file never animates, so its pillars just stand
      const known = districts.some(row => row.name === district)
      const v = (key: string) => m.values.get(`${district}|${key}`) ?? (key === 'rise' && !known ? 1 : 0)
      const top = v('rise') * (LIFT * v('lift') + SLAB * (1 - 0.86 * v('sink')) + HOVER * v('hover'))
      map.setFeatureState({ source: 'dq-pillars', id: String(item.id) }, { base: top, rise: v('rise') })
    }
  }, [ready, departments, visibleIds, stateOf, districts])

  // ---- basemap / layer toggles --------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const palette = paletteFor(basemap)
    recolorBase(map, palette)
    map.setLayoutProperty('dq-satellite', 'visibility', basemap === 'satellite' ? 'visible' : 'none')
    for (const id of ['dq-slabs', 'dq-labels-layer'])
      map.setLayoutProperty(id, 'visibility', showDistricts ? 'visible' : 'none')
    map.setPaintProperty('dq-mask', 'fill-opacity', basemap === 'light' ? 0.34 : 0.55)
    recolorBuildings(map, basemap)
  }, [ready, basemap, showDistricts])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !showLandmarks) return
    const element = document.createElement('div')
    element.innerHTML =
      '<span class="gis-landmark" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21v-4h14v4"/><path d="M7 17v-4h10v4"/><path d="M9 13V9h6v4"/><path d="M11 9V6h2v3"/></svg></span>'
    element.title = 'زقورة أور — ضمن موقع «أهوار جنوب العراق» على قائمة التراث العالمي لليونسكو (2016)'
    const marker = new Marker({ element }).setLngLat(UR).addTo(map)
    return () => {
      marker.remove()
    }
  }, [ready, showLandmarks])

  const flownRef = useRef<string | null>(null)

  // ---- drill-down: lift the chosen district, sink the rest, frame it ------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    for (const row of districts) {
      animate(row.name, 'lift', drill === row.name ? 1 : 0, drill === row.name ? 1300 : 800)
      animate(row.name, 'sink', drill && drill !== row.name ? 1 : 0, 900, drill ? 120 : 0)
    }
    // towers summarise a district; inside a drill the individual pillars take over
    map.setFilter('dq-towers-layer', drill ? ['==', ['get', 'id'], '__none__'] : null)
    map.setFilter('dq-pillars-layer', drill ? ['==', ['get', 'district'], drill] : null)
    map.setLayerZoomRange('dq-pillars-layer', drill ? 0 : 9.4, PILLAR_MAX_ZOOM)
    if (drill) void facilitiesRef.current?.loadDistricts([drill])
    map.setLayerZoomRange('dq-towers-layer', 0, drill ? 24 : 9.4)
    // data refreshes re-run this effect; only a new drill target moves the camera
    if (flownRef.current === drill) return
    flownRef.current = drill
    // a department card from another district would float over the wrong place
    const picked = latest.current.selectedId ? byIdRef.current.get(latest.current.selectedId) : undefined
    if (picked && districtKey(picked.district) !== drill) latest.current.onSelectDepartment(null)
    const row = districts.find(item => item.name === drill)
    // the profile panel is a side column on the inline-start (right) edge, or a bottom sheet on a narrow map;
    // folded to its title bar it leaves the whole map to the district
    const container = containerRef.current
    const width = container?.clientWidth || 1000
    const wide = width > DRILL_SHEET_MAX_WIDTH
    if (row) {
      const camera = map.cameraForBounds(row.bounds, {
        padding: latest.current.panelCollapsed
          ? { top: 70, bottom: 50, left: 50, right: 50 }
          : wide
            ? { top: 70, bottom: 50, left: 50, right: drillColumnWidth(width) + DRILL_COLUMN_INSET + 26 }
            : { top: 60, bottom: Math.round((container?.clientHeight || 480) * 0.5), left: 24, right: 24 },
        bearing: -24,
      })
      if (camera)
        map.flyTo({
          ...camera,
          zoom: (camera.zoom ?? 9) - 0.15,
          pitch: 56,
          bearing: -24,
          duration: reduced ? 0 : 2000,
          essential: true,
        })
    } else {
      map.fitBounds(GOVERNORATE, {
        padding: 40,
        pitch: HOME.pitch,
        bearing: HOME.bearing,
        duration: reduced ? 0 : 1800,
      })
    }
  }, [ready, drill, districts, animate, reduced])

  // ---- hover + click ------------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const m = motion.current
    const setHovered = (name: string | null) => {
      if (m.hovered === name) return
      if (m.hovered) animate(m.hovered, 'hover', 0, 260)
      m.hovered = name
      if (name) animate(name, 'hover', 1, 320)
    }
    const onSlabMove = (event: MapLayerMouseEvent) => {
      const name = event.features?.[0]?.properties?.name as string | undefined
      map.getCanvas().style.cursor = name ? 'pointer' : ''
      setHovered(name ?? null)
      setHover(name ? { x: event.point.x, y: event.point.y, name } : null)
    }
    const onSlabLeave = () => {
      map.getCanvas().style.cursor = ''
      setHovered(null)
      setHover(null)
    }
    const onSlabClick = (event: MapLayerMouseEvent) => {
      // a click on a pillar, a building or a facility is handled by its own layer
      const own = ['dq-pillars-layer', 'dq-ob-walls', 'dq-ob-roof', 'dq-obadges', ...FACILITY_INTERACTIVE_LAYERS]
      if (map.queryRenderedFeatures(event.point, { layers: own.filter(id => map.getLayer(id)) }).length) return
      const name = event.features?.[0]?.properties?.name as string | undefined
      if (name) setDrill(name)
    }
    const onPillarMove = (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id as string | undefined
      map.getCanvas().style.cursor = id ? 'pointer' : ''
      setPillarTip(id ? { x: event.point.x, y: event.point.y, id } : null)
    }
    const onPillarLeave = () => setPillarTip(null)
    const onPillarClick = (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id as string | undefined
      if (id) latest.current.onSelectDepartment(id)
    }
    const onTowerClick = (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id as string | undefined
      if (id) setDrill(id)
    }
    const buildingLayers = ['dq-ob-walls', 'dq-ob-roof', 'dq-obadges']
    const onBuildingClick = (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id as string | undefined
      if (!id) return
      setFacility(null)
      latest.current.onSelectDepartment(id)
    }
    const onFacilityMove = (event: MapLayerMouseEvent) => {
      if (map.queryRenderedFeatures(event.point, { layers: buildingLayers }).length) return
      const info = facilitiesRef.current?.info(event.features?.[0]?.properties ?? {}) ?? null
      map.getCanvas().style.cursor = info ? 'pointer' : ''
      setFacilityTip(info ? { x: event.point.x, y: event.point.y, info } : null)
    }
    const onFacilityLeave = () => setFacilityTip(null)
    const onFacilityClick = (event: MapLayerMouseEvent) => {
      if (map.queryRenderedFeatures(event.point, { layers: buildingLayers }).length) return
      const info = facilitiesRef.current?.info(event.features?.[0]?.properties ?? {}) ?? null
      if (!info) return
      latest.current.onSelectDepartment(null)
      setFacility(info)
    }
    for (const layer of buildingLayers) {
      map.on('mousemove', layer, onPillarMove)
      map.on('mouseleave', layer, onPillarLeave)
      map.on('click', layer, onBuildingClick)
    }
    for (const layer of FACILITY_INTERACTIVE_LAYERS) {
      map.on('mousemove', layer, onFacilityMove)
      map.on('mouseleave', layer, onFacilityLeave)
      map.on('click', layer, onFacilityClick)
    }
    map.on('mousemove', 'dq-slabs', onSlabMove)
    map.on('mouseleave', 'dq-slabs', onSlabLeave)
    map.on('click', 'dq-slabs', onSlabClick)
    map.on('mousemove', 'dq-pillars-layer', onPillarMove)
    map.on('mouseleave', 'dq-pillars-layer', onPillarLeave)
    map.on('click', 'dq-pillars-layer', onPillarClick)
    map.on('click', 'dq-towers-layer', onTowerClick)
    return () => {
      for (const layer of buildingLayers) {
        map.off('mousemove', layer, onPillarMove)
        map.off('mouseleave', layer, onPillarLeave)
        map.off('click', layer, onBuildingClick)
      }
      for (const layer of FACILITY_INTERACTIVE_LAYERS) {
        map.off('mousemove', layer, onFacilityMove)
        map.off('mouseleave', layer, onFacilityLeave)
        map.off('click', layer, onFacilityClick)
      }
      map.off('mousemove', 'dq-slabs', onSlabMove)
      map.off('mouseleave', 'dq-slabs', onSlabLeave)
      map.off('click', 'dq-slabs', onSlabClick)
      map.off('mousemove', 'dq-pillars-layer', onPillarMove)
      map.off('mouseleave', 'dq-pillars-layer', onPillarLeave)
      map.off('click', 'dq-pillars-layer', onPillarClick)
      map.off('click', 'dq-towers-layer', onTowerClick)
    }
  }, [ready, animate, setDrill])

  // selected department: highlight + fly (drilling into its district first)
  const selectedRef = useRef<string | null>(null)
  /** the department the camera already flew to (a data refresh must not fly there again) */
  const flownToRef = useRef<string | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.setFilter('dq-selected', ['==', ['get', 'id'], selectedId ?? ''])
    if (selectedRef.current) {
      map.setFeatureState({ source: 'dq-pillars', id: selectedRef.current }, { selected: false })
      map.setFeatureState({ source: 'dq-obuild', id: selectedRef.current }, { selected: false })
    }
    selectedRef.current = selectedId
    if (selectedId) {
      map.setFeatureState({ source: 'dq-pillars', id: selectedId }, { selected: true })
      map.setFeatureState({ source: 'dq-obuild', id: selectedId }, { selected: true })
    }
    if (flownToRef.current !== selectedId) flownToRef.current = null
    const item = selectedId ? byId.get(selectedId) : undefined
    if (!item || typeof item.lat !== 'number' || typeof item.lng !== 'number') return
    if (flownToRef.current === selectedId) return
    const district = districtKey(item.district)
    if (districtsRef.current.some(row => row.name === district)) setDrill(district)
    const { lng, lat } = { lng: item.lng, lat: item.lat }
    // the street-level flight waits for the district framing; a new selection, a deselection ("back to
    // the governorate", closing the card) or unmounting cancels it, so it never hijacks the camera later
    const timer = window.setTimeout(
      () => {
        if (latest.current.selectedId !== selectedId) return
        flownToRef.current = selectedId
        // the card takes the side column on a wide map (the building lands in the middle of what is left of it),
        // or the lower part of a narrow one
        const width = containerRef.current?.clientWidth || 1000
        mapRef.current?.flyTo({
          center: [lng, lat],
          zoom: 16.2,
          pitch: 60,
          duration: reduced ? 0 : 1600,
          essential: true,
          offset:
            width > CARD_SHEET_MAX_WIDTH
              ? [-Math.round((drillColumnWidth(width) + DRILL_COLUMN_INSET) / 2), -20]
              : [0, -120],
        })
      },
      reduced ? 0 : 2050
    )
    return () => window.clearTimeout(timer)
  }, [ready, selectedId, byId, reduced, setDrill])

  // a department picked in the profile's list: its card replaces the profile (map3d-drill.css), so keyboard focus
  // moves from the now hidden list to the card
  useEffect(() => {
    const active = document.activeElement
    if (!selectedId || !(active instanceof HTMLElement) || !active.closest('.drill-panel')) return
    const card = cardRef.current
    const target =
      card?.querySelector<HTMLElement>('.map3d-card-back') ?? card?.querySelector<HTMLElement>('.map3d-card-close')
    target?.focus()
  }, [selectedId])
  /** back from a department card to the district profile it replaced, with focus on that department's row */
  const backToProfile = (id: string) => {
    latest.current.onSelectDepartment(null)
    requestAnimationFrame(() =>
      containerRef.current
        ?.closest('.gis-stage')
        ?.querySelector<HTMLElement>(`.drill-panel [data-department="${CSS.escape(id)}"]`)
        ?.focus()
    )
  }

  const selected = selectedId ? byId.get(selectedId) : undefined
  const tipDepartment = pillarTip ? byId.get(pillarTip.id) : undefined
  const hoverRow = hover ? districts.find(row => row.name === hover.name) : undefined
  // a facility card gives way to a selected department, and to a drill into another district
  const facilityMeta =
    facility && !selected && (!drill || facility.district === drill) ? FACILITY_TYPES[facility.type] : null
  const linkedDepartment = facility?.department ? byId.get(facility.department) : undefined

  return (
    <div className={`map3d-shell is-ops${ready ? ' is-ready' : ''}`} data-basemap={basemap}>
      <div ref={containerRef} className="map3d-canvas" />
      {!ready && (
        <div className="map3d-loading" aria-live="polite">
          <span className="map3d-loading-ring" aria-hidden="true" />
          جارٍ تجهيز الخريطة ثلاثية الأبعاد…
        </div>
      )}

      {hover && hoverRow && !drill && (
        <div className="map3d-tooltip" style={{ left: hover.x, top: hover.y }} role="tooltip">
          <strong>قضاء {hoverRow.name}</strong>
          <span>
            {fmt(hoverRow.departments.length)} جهة ·{' '}
            {variant === 'governor' ? `${fmt(hoverRow.transactions)} طلب مسجل` : `${fmt(hoverRow.open)} طلب مفتوح`}
            {DISTRICT_FACTS[hoverRow.name] ? ` · ${fmt(DISTRICT_FACTS[hoverRow.name].population)} نسمة` : ''}
          </span>
        </div>
      )}
      {pillarTip && tipDepartment && (
        <div className="map3d-tooltip" style={{ left: pillarTip.x, top: pillarTip.y }} role="tooltip">
          <strong>{tipDepartment.name}</strong>
          <span>
            {fmt(openWork(tipDepartment))} مفتوحة · {fmt(tipDepartment.completed)} منجزة
          </span>
        </div>
      )}

      {facilityTip && !pillarTip && (
        <div className="map3d-tooltip" style={{ left: facilityTip.x, top: facilityTip.y }} role="tooltip">
          <strong>{facilityTip.info.name ?? FACILITY_TYPES[facilityTip.info.type].label}</strong>
          <span>{FACILITY_TYPES[facilityTip.info.type].label} · OpenStreetMap</span>
        </div>
      )}

      {facility && facilityMeta && (
        <aside
          className="map3d-card drill-card is-facility"
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
          {drill && (
            <button type="button" className="map3d-card-back" onClick={() => setFacility(null)}>
              <ArrowRight aria-hidden="true" /> ملف قضاء {drill}
            </button>
          )}
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
              <Link
                href={`/departments/${encodeURIComponent(String(linkedDepartment.id))}`}
                className="button primary small"
              >
                دائرة على المنصة
              </Link>
            </div>
          )}
        </aside>
      )}

      {selected && typeof selected.lat === 'number' && typeof selected.lng === 'number' && (
        <aside className="map3d-card drill-card" aria-label={`بطاقة ${selected.name}`} ref={cardRef}>
          <button
            type="button"
            className="map3d-card-close"
            onClick={() => backToProfile(String(selected.id))}
            aria-label="إغلاق البطاقة"
          >
            <X aria-hidden="true" />
          </button>
          {drill && (
            <button type="button" className="map3d-card-back" onClick={() => backToProfile(String(selected.id))}>
              <ArrowRight aria-hidden="true" /> ملف قضاء {drill}
            </button>
          )}
          <span className="map3d-card-sector">{selected.type}</span>
          <h3>{selected.name}</h3>
          <p>
            <MapPin aria-hidden="true" /> {selected.district}
          </p>
          {stateOf(selected) === 'alert' && (
            <p className="drill-alert">
              <ShieldAlert aria-hidden="true" /> لا يوجد موظف مفعّل لمعالجة طلبات هذه الدائرة
            </p>
          )}
          <dl>
            <div>
              <dt>مفتوحة</dt>
              <dd>{fmt(openWork(selected))}</dd>
            </div>
            <div>
              <dt>منجزة</dt>
              <dd>{fmt(selected.completed)}</dd>
            </div>
            <div>
              <dt>متأخرة</dt>
              <dd>{fmt(selected.overdue || 0)}</dd>
            </div>
            <div>
              <dt>شكاوى</dt>
              <dd>{fmt(selected.openFeedback)}</dd>
            </div>
          </dl>
          {/* said once the footprints are in (a failed file leaves every department a generated stand-in) */}
          {prints !== undefined && <ShapeNote shape={departmentShape(prints?.byId.get(String(selected.id)))} />}
          <div className="map3d-card-actions">
            <Link href={`/departments/${encodeURIComponent(String(selected.id))}`} className="button primary small">
              صفحة الدائرة
            </Link>
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="button outline small"
            >
              الاتجاهات
            </a>
          </div>
        </aside>
      )}
    </div>
  )
}

// ---- style ------------------------------------------------------------------------------------------

const paletteFor = (basemap: Basemap): Palette => (basemap === 'light' ? LIGHT : DARK)

// population choropleth: one green-to-teal ramp, quiet for the smallest districts and brightest for the largest
// (no gold or brown: the platform's palette stays green)
const POP_RAMP_DARK = ['#123b2c', '#17523f', '#1f6b52', '#268468', '#2f9f80', '#3dbb98']
const POP_RAMP_LIGHT = ['#d4e8dc', '#b3d8c3', '#8cc6a9', '#5fae8c', '#3a9473', '#1f7a5c']

function slabColor(palette: Palette): ExpressionSpecification {
  const ramp = palette === LIGHT ? POP_RAMP_LIGHT : POP_RAMP_DARK
  const base: ExpressionSpecification = [
    'interpolate',
    ['linear'],
    ['coalesce', ['get', 'population'], 0],
    0,
    palette === LIGHT ? '#d3dbd5' : '#1a2621',
    50_000,
    ramp[0],
    90_000,
    ramp[1],
    125_000,
    ramp[2],
    200_000,
    ramp[3],
    290_000,
    ramp[4],
    780_000,
    ramp[5],
  ]
  return [
    'interpolate',
    ['linear'],
    S('sink'),
    0,
    ['interpolate', ['linear'], S('hover'), 0, base, 1, palette === LIGHT ? '#9fe0c0' : '#8fe3c4'],
    1,
    palette === LIGHT ? '#c4ccc6' : '#0d1713',
  ]
}

function addLayers(map: MapLibreMap, features: DistrictFeature[], palette: Palette) {
  const governorate = features.find(feature => feature.properties.kind === 'governorate')
  const districts = features
    .filter(feature => feature.properties.kind === 'district')
    .map(feature => ({
      ...feature,
      properties: { ...feature.properties, population: DISTRICT_FACTS[feature.properties.name]?.population ?? 0 },
    }))
  const firstSymbol = map.getStyle().layers.find(layer => layer.type === 'symbol')?.id

  map.addSource('dq-satellite', {
    type: 'raster',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    maxzoom: 18,
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  })
  // imagery sits over the vector land/roads but under every label
  map.addLayer(
    { id: 'dq-satellite', type: 'raster', source: 'dq-satellite', layout: { visibility: 'none' } },
    firstSymbol
  )

  // darken everything outside the governorate
  if (governorate) {
    const world: Position[] = [
      [-180, -85],
      [180, -85],
      [180, 85],
      [-180, 85],
      [-180, -85],
    ]
    map.addSource('dq-mask', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [world, ...ringsOf(governorate.geometry)] },
      },
    })
    map.addLayer(
      { id: 'dq-mask', type: 'fill', source: 'dq-mask', paint: { 'fill-color': '#020a07', 'fill-opacity': 0.55 } },
      firstSymbol
    )
    map.addSource('dq-border', { type: 'geojson', data: governorate })
    map.addLayer({
      id: 'dq-border-glow',
      type: 'line',
      source: 'dq-border',
      paint: { 'line-color': '#7fdcb4', 'line-width': 9, 'line-blur': 8, 'line-opacity': 0.45 },
    })
    map.addLayer({
      id: 'dq-border',
      type: 'line',
      source: 'dq-border',
      paint: { 'line-color': '#7fdcb4', 'line-width': 2.2, 'line-opacity': 0.95 },
    })
  }

  map.addSource('dq-districts', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: districts },
    promoteId: 'name',
  })
  map.addLayer({
    id: 'dq-slabs',
    type: 'fill-extrusion',
    source: 'dq-districts',
    paint: {
      'fill-extrusion-color': slabColor(palette),
      'fill-extrusion-base': zScaled(SLAB_BASE),
      'fill-extrusion-height': zScaled(SLAB_TOP),
      'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.86, 11, 0.6, 12.4, 0.22, 13.2, 0],
      'fill-extrusion-vertical-gradient': true,
    },
  })

  // district summary towers (governorate view)
  map.addSource('dq-towers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' })
  map.addLayer({
    id: 'dq-towers-layer',
    type: 'fill-extrusion',
    source: 'dq-towers',
    maxzoom: 9.4,
    paint: {
      'fill-extrusion-color': ['get', 'color'],
      'fill-extrusion-base': zScaled(S('base', SLAB)),
      'fill-extrusion-height': standing(['*', ['get', 'h'], S('rise', 1), ['-', 1, S('sink')]]),
      'fill-extrusion-opacity': 0.95,
    },
  })

  // department pillars (zoomed in or inside a drilled district)
  map.addSource('dq-pillars', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' })
  map.addLayer({
    id: 'dq-pillars-layer',
    type: 'fill-extrusion',
    source: 'dq-pillars',
    minzoom: 9.4,
    paint: {
      'fill-extrusion-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#ffe08a', ['get', 'color']],
      'fill-extrusion-base': zScaled(S('base', SLAB)),
      'fill-extrusion-height': standing(['*', ['get', 'h'], S('rise', 1)]),
      'fill-extrusion-opacity': 0.96,
    },
  })
  map.addLayer({
    id: 'dq-selected',
    type: 'line',
    source: 'dq-pillars',
    filter: ['==', ['get', 'id'], ''],
    paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-blur': 1 },
  })

  map.addSource('dq-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: 'dq-labels-layer',
    type: 'symbol',
    source: 'dq-labels',
    maxzoom: 10.5,
    layout: {
      'text-field': ['format', ['get', 'label'], { 'font-scale': 1 }, '\n', {}, ['get', 'sub'], { 'font-scale': 0.78 }],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 7, 11, 10, 15],
      'text-offset': [0, 1.6],
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': palette === LIGHT ? '#22301f' : '#f4ecd2',
      'text-halo-color': palette === LIGHT ? 'rgba(255,255,255,0.9)' : 'rgba(3,12,8,0.9)',
      'text-halo-width': 1.6,
    },
  })
}

function recolorBase(map: MapLibreMap, palette: Palette) {
  for (const layer of map.getStyle().layers as StyleLayer[]) {
    if (layer.id.startsWith('dq-')) continue
    for (const [prop, value] of Object.entries(themePaint(layer, palette)))
      map.setPaintProperty(layer.id, prop as 'fill-color', value as string)
  }
  map.setSky(skyFor(palette))
  map.setPaintProperty('dq-slabs', 'fill-extrusion-color', slabColor(palette))
  map.setPaintProperty('dq-labels-layer', 'text-color', palette === LIGHT ? '#22301f' : '#f4ecd2')
  map.setPaintProperty(
    'dq-labels-layer',
    'text-halo-color',
    palette === LIGHT ? 'rgba(255,255,255,0.9)' : 'rgba(3,12,8,0.9)'
  )
}

// ---- real buildings (street level) -------------------------------------------------------------------

const SELECTED: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false]

function addRealBuildings(map: MapLibreMap, prints: DepartmentFootprints | null) {
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
  addFacadeImages(map)
  map.addSource('dq-obuild', { type: 'geojson', data: empty, promoteId: 'id' })
  map.addSource('dq-opoints', { type: 'geojson', data: empty, promoteId: 'id' })
  const firstSymbol = map.getStyle().layers.find(layer => layer.type === 'symbol' && !layer.id.startsWith('dq-'))?.id
  addBuildingLayers(map, {
    source: 'dq-obuild',
    prefix: 'dq-ob',
    minzoom: BUILDING_MIN_ZOOM,
    beforeId: firstSymbol,
    height: extra => [
      'interpolate',
      ['linear'],
      ['zoom'],
      BUILDING_MIN_ZOOM,
      0,
      BUILDING_MIN_ZOOM + 0.8,
      ['+', ['get', 'h'], extra],
    ],
    roof: ['case', SELECTED, '#ffe08a', ['get', 'roof']],
    glow: ['case', SELECTED, '#ffe08a', ['get', 'color']],
  })
  if (prints?.landmarks.features.length) addLandmarkLayers(map, prints.landmarks)
  map.addLayer({
    id: 'dq-obadges',
    type: 'symbol',
    source: 'dq-opoints',
    minzoom: BUILDING_MIN_ZOOM - 0.4,
    layout: {
      'icon-image': badgeExpression('dept'),
      'icon-size': ['interpolate', ['linear'], ['zoom'], BUILDING_MIN_ZOOM - 0.4, 0.6, 16, 0.95],
      'icon-anchor': 'bottom',
      'icon-allow-overlap': true,
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 12,
      'text-anchor': 'bottom',
      'text-offset': [0, -3.7],
      'text-max-width': 11,
      'text-optional': true,
    },
    paint: {
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 14.2, 0, 14.6, 1],
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(4,14,10,0.9)',
      'text-halo-width': 1.6,
    },
  })
}

/** label colours that stay legible on the chosen basemap */
function recolorBuildings(map: MapLibreMap, basemap: Basemap) {
  const light = basemap === 'light'
  setFacadeTheme(map, basemap === 'dark')
  for (const id of ['dq-obadges', 'dq-fac-badges']) {
    if (!map.getLayer(id)) continue
    map.setPaintProperty(id, 'text-color', light ? '#22301f' : '#ffffff')
    map.setPaintProperty(id, 'text-halo-color', light ? 'rgba(255,255,255,0.92)' : 'rgba(4,14,10,0.9)')
  }
}
