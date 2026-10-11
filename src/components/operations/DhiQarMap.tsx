import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson'
import {
  GeoJSON,
  MapContainer,
  Marker,
  Popup,
  ScaleControl,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import { Building2, Crosshair, Layers, Landmark, Maximize2, Minimize2, Search, ShieldAlert } from 'lucide-react'
import type { DashboardStats } from '../../types'
import { MapBoundary, SwitchTo2D } from '../maps/map-fallback'
import { hasWebGL } from '../maps/webgl'
import type { DrillMapApi } from '../maps/DistrictDrillMap'
import { districtKey, districtsWithDepartments, OFFICIAL_DISTRICT_COUNT } from '../maps/dhiqar-district-facts'
import {
  DRILL_SHEET_MAX_WIDTH,
  summarizeDistricts,
  useDrillPanelCollapsed,
  useFacilityIndex,
  useListedServices,
  type DistrictProps,
} from '../maps/district-data'
import { DistrictPicker, DistrictProfilePanel } from '../maps/district-profile'
import { plainLeafletPrefix } from '../maps/leaflet-attribution'
import { OSM_TILE_ATTRIBUTION, OSM_TILE_MAX_ZOOM, OSM_TILE_URL } from '../maps/osm-tiles'

// the 3D drill-down map (MapLibre) loads on demand; Leaflet below stays as its fallback
const DistrictDrillMap = lazy(() => import('../maps/DistrictDrillMap'))

type Department = DashboardStats['departments'][number]
type Located = Department & { lat: number; lng: number }
type Area = DistrictProps
const DISTRICTS_URL = '/geo/dhiqar-districts.geojson'
/** the district and governorate outlines drawn over every basemap are OSM data (public/geo/ATTRIBUTION.txt) */
const BOUNDARIES_ATTRIBUTION = `<span dir="rtl">حدود الأقضية</span> ${OSM_TILE_ATTRIBUTION} (ODbL)`

const BASEMAPS = {
  dark: {
    label: 'ليلي',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: `Tiles &copy; Esri · ${BOUNDARIES_ATTRIBUTION}`,
  },
  light: {
    label: 'خريطة',
    // tiles and boundaries alike: one OSM credit
    url: OSM_TILE_URL,
    attribution: OSM_TILE_ATTRIBUTION,
  },
  satellite: {
    label: 'قمر صناعي',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: `Imagery &copy; Esri, Maxar, Earthstar Geographics · ${BOUNDARIES_ATTRIBUTION}`,
  },
} as const
type BasemapKey = keyof typeof BASEMAPS

// district outlines on the flat map: resting, hovered, and the district whose profile is open
const DISTRICT_STYLE: L.PathOptions = {
  color: '#7fd8aa',
  weight: 1.2,
  opacity: 0.75,
  dashArray: '4 4',
  fillColor: '#29c27f',
  fillOpacity: 0.04,
}
const DISTRICT_HOVER: L.PathOptions = { ...DISTRICT_STYLE, fillOpacity: 0.16, weight: 2.2, dashArray: '' }
const DISTRICT_ACTIVE: L.PathOptions = {
  color: '#7fdcb4',
  weight: 2.6,
  opacity: 1,
  dashArray: '',
  fillColor: '#7fdcb4',
  fillOpacity: 0.14,
}

// Ur — the ziggurat, part of the UNESCO "Ahwar of Southern Iraq" World Heritage property (2016)
const UR: [number, number] = [30.9627, 46.1031]
const GOVERNORATE_BOUNDS = L.latLngBounds([30.53, 45.63], [32.0, 47.14])

const openWork = (department: Department) => department.underReview + department.actionRequired

function markerIcon(state: 'idle' | 'busy' | 'alert', open: number, selected: boolean) {
  const size = state === 'idle' ? 14 : Math.min(30, 16 + Math.round(Math.sqrt(open) * 4))
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span class="gis-pin is-${state}${selected ? ' is-selected' : ''}" style="--pin:${size}px">${
      state === 'idle' ? '' : `<b>${open > 99 ? '99+' : open}</b>`
    }</span>`,
  })
}

const urIcon = L.divIcon({
  className: '',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  html: '<span class="gis-landmark" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21v-4h14v4"/><path d="M7 17v-4h10v4"/><path d="M9 13V9h6v4"/><path d="M11 9V6h2v3"/></svg></span>',
})

/** Mouse position readout + map reference for the toolbar */
function MapBridge({
  onReady,
  onMove,
}: {
  onReady: (map: L.Map) => void
  onMove: (latlng: { lat: number; lng: number } | null) => void
}) {
  const map = useMap()
  useEffect(() => {
    onReady(map)
  }, [map, onReady])
  useMapEvents({ mousemove: event => onMove(event.latlng), mouseout: () => onMove(null) })
  return null
}

export function DhiQarMap({
  departments,
  unstaffed = [],
  variant = 'operations',
}: {
  departments: DashboardStats['departments']
  unstaffed?: DashboardStats['unstaffedDepartments']
  /** what the 3D district drill-down summarises: workload (operations) or performance (governor) */
  variant?: 'operations' | 'governor'
}) {
  const shellRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)
  const syncControls = useRef<() => void>(() => undefined)
  const mapRef = useRef<L.Map | null>(null)
  const markerRefs = useRef(new Map<string, L.Marker>())
  const [areas, setAreas] = useState<FeatureCollection<Geometry, Area> | null>(null)
  const [basemap, setBasemap] = useState<BasemapKey>('dark')
  const [showDistricts, setShowDistricts] = useState(true)
  const [showLandmarks, setShowLandmarks] = useState(true)
  const [category, setCategory] = useState('الكل')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [cursor, setCursor] = useState<{ lat: number; lng: number } | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [mode, setMode] = useState<'3d' | '2d'>(() => (hasWebGL() ? '3d' : '2d'))
  /** the district whose profile is open — drives the 3D drill-down and the flat map alike */
  const [district, setDistrict] = useState<string | null>(null)
  /** the profile folded to its title bar (kept across districts and visits) */
  const [panelCollapsed, togglePanel] = useDrillPanelCollapsed()
  const drillApi = useRef<DrillMapApi | null>(null)
  const switchTo2D = useCallback(() => setMode('2d'), [])
  const facilityIndex = useFacilityIndex(district !== null)
  const services = useListedServices(district !== null)

  // the floating controls wrap to more rows on a narrow map: the profile panel and the zoom column start below
  // the toolbar, the 3D map's attribution sits above the legend (at the bottom edge while the legend is collapsed
  // for an open district), and the profile panel (and the card that replaces it) end above the whole bottom-right
  // control stack: the attribution, which wraps to 2–3 lines on a phone, and the 3D map's scale bar and compass
  // stacked on it, on the panel's side of the map
  useEffect(() => {
    const stage = stageRef.current
    const toolbar = toolbarRef.current
    const legend = legendRef.current
    if (!stage || !toolbar || !legend) return
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => sync())
    let watched: Element | null = null
    const sync = () => {
      stage.style.setProperty('--gis-toolbar-bottom', `${toolbar.offsetTop + toolbar.offsetHeight}px`)
      const clear = legend.offsetHeight ? stage.clientHeight - legend.offsetTop + 6 : 0
      stage.style.setProperty('--gis-legend-clear', `${Math.max(0, clear)}px`)
      const corner = stage.querySelector('.maplibregl-ctrl-bottom-right, .leaflet-bottom.leaflet-right')
      const cornerTop = corner?.getBoundingClientRect().top
      stage.style.setProperty(
        '--gis-attrib-clear',
        `${cornerTop ? Math.max(0, Math.ceil(stage.getBoundingClientRect().bottom - cornerTop) + 6) : 0}px`
      )
      // the attribution grows as tile sources add their credits, and the 3D map adds its controls late
      if (corner && corner !== watched && observer) {
        if (watched) observer.unobserve(watched)
        observer.observe(corner)
        watched = corner
      }
    }
    syncControls.current = sync
    sync()
    if (!observer) return
    for (const element of [toolbar, legend, stage]) observer.observe(element)
    return () => observer.disconnect()
  }, [])
  // opening a district collapses the legend and the 2D fallback brings its own attribution: measure again
  useEffect(() => syncControls.current(), [district, mode])

  useEffect(() => {
    let alive = true
    // the same 15-district boundaries as the 3D drill map (public/geo/ATTRIBUTION.txt), so the 2D layer and the
    // «أقضية» counter never disagree with the district picker
    fetch(DISTRICTS_URL)
      .then(response => (response.ok ? response.json() : null))
      .then(data => alive && data && setAreas(data))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const sync = () => {
      setFullscreen(document.fullscreenElement === shellRef.current)
      window.setTimeout(() => mapRef.current?.invalidateSize(), 120)
    }
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const unstaffedIds = useMemo(() => new Set((unstaffed || []).map(item => item.id)), [unstaffed])
  const located = useMemo(
    () =>
      departments.filter(
        (department): department is Located => typeof department.lat === 'number' && typeof department.lng === 'number'
      ),
    [departments]
  )
  const categories = useMemo(() => ['الكل', ...new Set(located.map(item => item.type))], [located])
  const visible = useMemo(() => {
    const needle = query.trim()
    return located
      .filter(item => category === 'الكل' || item.type === category)
      .filter(item => !needle || item.name.includes(needle) || item.district.includes(needle))
      .sort((a, b) => openWork(b) - openWork(a) || a.name.localeCompare(b.name, 'ar'))
  }, [located, category, query])

  const visibleIds = useMemo(() => new Set(visible.map(item => String(item.id))), [visible])

  const stateOf = useCallback(
    (department: Department): 'idle' | 'busy' | 'alert' =>
      unstaffedIds.has(String(department.id)) ? 'alert' : openWork(department) > 0 ? 'busy' : 'idle',
    [unstaffedIds]
  )

  // per-district roll-up for the boundary layer tooltips (registry spellings and sub-districts folded by districtKey)
  const districtStats = useMemo(() => {
    const result = new Map<string, { total: number; mapped: number; open: number }>()
    for (const department of departments) {
      const key = districtKey(department.district)
      const row = result.get(key) || { total: 0, mapped: 0, open: 0 }
      row.total += 1
      if (typeof department.lat === 'number') row.mapped += 1
      row.open += openWork(department)
      result.set(key, row)
    }
    return result
  }, [departments])

  const governorate = areas?.features.find(feature => feature.properties.kind === 'governorate') as
    Feature<Polygon | MultiPolygon, Area> | undefined
  const mask = useMemo(() => {
    if (!governorate) return null
    // every outer ring of the governorate is a hole in the world mask (the outline may be a MultiPolygon)
    const outlines =
      governorate.geometry.type === 'MultiPolygon'
        ? governorate.geometry.coordinates.map(polygon => polygon[0])
        : [governorate.geometry.coordinates[0]]
    const world = [
      [-180, -85],
      [180, -85],
      [180, 85],
      [-180, 85],
      [-180, -85],
    ]
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [world, ...outlines] },
    } as Feature<Polygon>
  }, [governorate])
  const districts = useMemo(
    () =>
      areas
        ? ({
            ...areas,
            features: areas.features.filter(feature => feature.properties.kind === 'district'),
          } as FeatureCollection<Geometry, Area>)
        : null,
    [areas]
  )

  const districtRows = useMemo(
    () => summarizeDistricts(areas?.features ?? [], departments, stateOf),
    [areas, departments, stateOf]
  )
  const current = districtRows.find(row => row.name === district)
  const withDepartments = useMemo(() => districtsWithDepartments(departments), [departments])

  // ---- flat map: frame the open district (clear of the profile panel) or the governorate ----------------
  const flat = useRef({ district, rows: districtRows, framed: null as string | null, collapsed: panelCollapsed })
  useLayoutEffect(() => {
    flat.current.district = district
    flat.current.rows = districtRows
    flat.current.collapsed = panelCollapsed
  })
  const frameFlat = useCallback((animate: boolean) => {
    const map = mapRef.current
    if (!map) return
    const { district: name, rows } = flat.current
    flat.current.framed = name
    const row = rows.find(item => item.name === name)
    if (!row) {
      if (animate) map.flyToBounds(GOVERNORATE_BOUNDS, { padding: [24, 24], duration: 0.9 })
      else map.fitBounds(GOVERNORATE_BOUNDS, { padding: [12, 12] })
      return
    }
    const box = map.getContainer()
    const top = (parseFloat(stageRef.current?.style.getPropertyValue('--gis-toolbar-bottom') || '') || 54) + 12
    // the panel is a column on the inline-start (right) edge, or a bottom sheet on a narrow map; folded to its
    // title bar it leaves the whole map free
    const padding: L.FitBoundsOptions = flat.current.collapsed
      ? { paddingTopLeft: [30, top], paddingBottomRight: [30, 40] }
      : box.clientWidth > DRILL_SHEET_MAX_WIDTH
        ? { paddingTopLeft: [30, top], paddingBottomRight: [380, 40] }
        : { paddingTopLeft: [20, top], paddingBottomRight: [20, Math.round(box.clientHeight * 0.5)] }
    const bounds = L.geoJSON(row.feature).getBounds()
    if (animate) map.flyToBounds(bounds, { ...padding, duration: 0.9 })
    else map.fitBounds(bounds, padding)
  }, [])
  useEffect(() => {
    if (mode === '2d' && mapRef.current && flat.current.framed !== district) frameFlat(true)
  }, [mode, district, frameFlat])

  const handleReady = useCallback(
    (map: L.Map) => {
      mapRef.current = map
      // the stage gets its height from CSS after mount — measure again, then frame the governorate (or the open
      // district, when the 3D map fell back to this one mid-drill)
      window.setTimeout(() => {
        map.invalidateSize()
        frameFlat(false)
      }, 60)
    },
    [frameFlat]
  )
  const districtStyle = useCallback(
    (feature?: Feature<Geometry, Area>) => (feature?.properties.name === district ? DISTRICT_ACTIVE : DISTRICT_STYLE),
    [district]
  )
  const districtLabels = useMemo(
    () =>
      (districts?.features || []).map(feature => {
        const ring = (feature.geometry as Polygon).coordinates[0]
        const lngs = ring.map(point => point[0])
        const lats = ring.map(point => point[1])
        return {
          name: feature.properties.name,
          center: [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2] as [
            number,
            number,
          ],
        }
      }),
    [districts]
  )
  const fitGovernorate = () => {
    if (mode === '3d') return drillApi.current?.fitGovernorate()
    if (district) setDistrict(null)
    else frameFlat(true)
  }
  const focus = (department: Located) => {
    setSelected(String(department.id))
    if (mode === '3d') return
    const map = mapRef.current
    if (!map) return
    // the flat map opens the department's district profile too (as the 3D drill-down does) without framing the
    // whole district. Beside the side column the department lands clear of it; a bottom sheet gives way to the
    // popup (map3d-drill.css), so there the department sits low enough for the popup to clear the toolbar
    const home = districtKey(department.district)
    const box = map.getContainer()
    const sheet = box.clientWidth <= DRILL_SHEET_MAX_WIDTH
    let shift: [number, number] = sheet ? [0, -Math.round(box.clientHeight * 0.26)] : [0, 0]
    if (districtRows.some(row => row.name === home)) {
      flat.current.framed = home
      setDistrict(home)
      if (!sheet) shift = [190, 0]
    }
    const target = map.unproject(map.project([department.lat, department.lng], 15).add(shift), 15)
    map.flyTo(target, 15, { duration: 0.9 })
    window.setTimeout(() => markerRefs.current.get(String(department.id))?.openPopup(), 950)
  }
  const focusById = (id: string) => {
    const department = located.find(item => String(item.id) === id)
    if (department) focus(department)
  }
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void shellRef.current?.requestFullscreen?.()
  }

  const busyCount = located.filter(item => stateOf(item) !== 'idle').length
  const alertCount = located.filter(item => stateOf(item) === 'alert').length
  const pendingCoordinates = departments.length - located.length
  const tiles = BASEMAPS[basemap]

  return (
    <section ref={shellRef} className={`gis-shell is-${basemap}`} aria-label="نظام المعلومات الجغرافية لمحافظة ذي قار">
      <header className="gis-head">
        <div>
          <span className="gis-kicker">
            <Crosshair aria-hidden="true" /> GIS · محافظة ذي قار
          </span>
          <h2>الخريطة التشغيلية الحية</h2>
        </div>
        <dl className="gis-counters">
          <div>
            <dt>جهة على الخريطة</dt>
            <dd>{located.length.toLocaleString('en-US')}</dd>
          </div>
          <div className="is-busy">
            <dt>لديها طلبات مفتوحة</dt>
            <dd>{busyCount.toLocaleString('en-US')}</dd>
          </div>
          <div className="is-alert">
            <dt>بلا موظف مفعّل</dt>
            <dd>{alertCount.toLocaleString('en-US')}</dd>
          </div>
          <div>
            <dt>أقضية</dt>
            <dd>{OFFICIAL_DISTRICT_COUNT.toLocaleString('en-US')}</dd>
            <small>{withDepartments.toLocaleString('en-US')} بها دوائر على المنصة</small>
          </div>
        </dl>
      </header>

      <div className="gis-body">
        <aside className="gis-panel" aria-label="قائمة الجهات">
          <label className="gis-search">
            <Search aria-hidden="true" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="ابحث عن دائرة أو قضاء"
              aria-label="ابحث عن دائرة أو قضاء"
            />
          </label>
          <div className="gis-chips" role="group" aria-label="تصفية حسب القطاع">
            {categories.map(item => (
              <button
                type="button"
                key={item}
                className={item === category ? 'is-active' : ''}
                aria-pressed={item === category}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <ul className="gis-list">
            {visible.map(department => {
              const state = stateOf(department)
              return (
                <li key={department.id}>
                  <button
                    type="button"
                    className={String(department.id) === selected ? 'is-selected' : ''}
                    onClick={() => focus(department)}
                  >
                    <i className={`gis-dot is-${state}`} aria-hidden="true" />
                    <span>
                      <strong>{department.name}</strong>
                      <small>
                        {department.district} · {department.type}
                      </small>
                    </span>
                    {openWork(department) > 0 && <em>{openWork(department).toLocaleString('en-US')}</em>}
                  </button>
                </li>
              )
            })}
            {!visible.length && <li className="gis-empty">لا توجد جهة مطابقة.</li>}
          </ul>
          {pendingCoordinates > 0 && (
            <p className="gis-note">
              <Building2 aria-hidden="true" /> {pendingCoordinates.toLocaleString('en-US')} جهة أخرى بانتظار إحداثيات
              رسمية موثّقة ولا تُرسم تخميناً.
            </p>
          )}
        </aside>

        <div className="gis-stage" ref={stageRef}>
          {mode === '3d' ? (
            <MapBoundary fallback={<SwitchTo2D onSwitch={switchTo2D} />}>
              <Suspense fallback={<div className="gis-map" aria-hidden="true" />}>
                <DistrictDrillMap
                  departments={departments}
                  visibleIds={visibleIds}
                  stateOf={stateOf}
                  basemap={basemap}
                  showDistricts={showDistricts}
                  showLandmarks={showLandmarks}
                  selectedId={selected}
                  onSelectDepartment={setSelected}
                  drill={district}
                  onDrillChange={setDistrict}
                  variant={variant}
                  onReady={api => {
                    drillApi.current = api
                    // its scale bar, compass and attribution exist now: the panel and the cards end above them
                    syncControls.current()
                  }}
                  panelCollapsed={panelCollapsed}
                  onCursor={setCursor}
                  onUnavailable={switchTo2D}
                />
              </Suspense>
            </MapBoundary>
          ) : (
            <MapContainer
              ref={plainLeafletPrefix}
              bounds={GOVERNORATE_BOUNDS}
              boundsOptions={{ padding: [24, 24] }}
              minZoom={7}
              zoomSnap={0.25}
              zoomDelta={0.5}
              maxZoom={18}
              scrollWheelZoom
              zoomControl={false}
              className="gis-map"
            >
              <MapBridge onReady={handleReady} onMove={setCursor} />
              <TileLayer
                key={basemap}
                url={tiles.url}
                attribution={tiles.attribution}
                maxZoom={OSM_TILE_MAX_ZOOM}
                maxNativeZoom={basemap === 'dark' ? 16 : OSM_TILE_MAX_ZOOM}
              />
              {basemap !== 'light' && (
                <TileLayer
                  key={`labels-${basemap}`}
                  url={
                    basemap === 'dark'
                      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'
                      : 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
                  }
                  maxZoom={19}
                  maxNativeZoom={basemap === 'dark' ? 16 : 19}
                />
              )}
              {mask && (
                <GeoJSON
                  key="mask"
                  data={mask}
                  interactive={false}
                  style={{ stroke: false, fillColor: '#020a07', fillOpacity: basemap === 'light' ? 0.38 : 0.55 }}
                />
              )}
              {showDistricts && districts && (
                <GeoJSON
                  key={`districts-${districtStats.size}`}
                  data={districts}
                  style={districtStyle}
                  onEachFeature={(feature, layer) => {
                    const name = (feature.properties as Area).name
                    const row = districtStats.get(name)
                    const rest = () => (name === flat.current.district ? DISTRICT_ACTIVE : DISTRICT_STYLE)
                    layer.bindTooltip(
                      `<strong>قضاء ${name}</strong><span>${row ? `${row.total} جهة · ${row.open} طلب مفتوح` : 'لا توجد جهات مسجلة بعد'}</span>`,
                      { sticky: true, className: 'gis-tip', direction: 'top' }
                    )
                    layer.on({
                      mouseover: () =>
                        (layer as L.Path).setStyle(name === flat.current.district ? rest() : DISTRICT_HOVER),
                      mouseout: () => (layer as L.Path).setStyle(rest()),
                      // opens the district profile; the framing effect flies there, clear of the panel
                      click: () => setDistrict(name),
                    })
                  }}
                />
              )}
              {showDistricts &&
                districtLabels.map(label => (
                  <Marker
                    key={`label-${label.name}`}
                    position={label.center}
                    interactive={false}
                    keyboard={false}
                    icon={L.divIcon({
                      className: '',
                      iconSize: [120, 14],
                      iconAnchor: [60, 7],
                      html: `<div class="gis-district-label">${label.name}</div>`,
                    })}
                  />
                ))}
              {governorate && (
                <GeoJSON
                  key="governorate"
                  data={governorate}
                  interactive={false}
                  style={{ color: '#7fdcb4', weight: 2.6, opacity: 0.95, fill: false, className: 'gis-border' }}
                />
              )}
              {showLandmarks && (
                <Marker position={UR} icon={urIcon} title="زقورة أور" zIndexOffset={-500}>
                  <Popup>
                    <div className="gis-popup">
                      <strong>زقورة أور</strong>
                      <span>
                        موقع أثري سومري — ضمن موقع «أهوار جنوب العراق» على قائمة التراث العالمي لليونسكو (2016)
                      </span>
                    </div>
                  </Popup>
                </Marker>
              )}
              {visible.map(department => {
                const state = stateOf(department)
                const open = openWork(department)
                return (
                  <Marker
                    key={department.id}
                    position={[department.lat, department.lng]}
                    icon={markerIcon(state, open, String(department.id) === selected)}
                    title={department.name}
                    ref={marker => {
                      if (marker) markerRefs.current.set(String(department.id), marker)
                      else markerRefs.current.delete(String(department.id))
                    }}
                    eventHandlers={{ click: () => setSelected(String(department.id)) }}
                  >
                    <Tooltip direction="top" offset={[0, -10]} className="gis-tip">
                      <strong>{department.name}</strong>
                    </Tooltip>
                    <Popup minWidth={240}>
                      <div className="gis-popup">
                        <strong>{department.name}</strong>
                        <span>
                          {department.district} — {department.type}
                        </span>
                        {state === 'alert' && (
                          <p className="gis-popup-alert">
                            <ShieldAlert aria-hidden="true" /> لا يوجد موظف مفعّل لمعالجة طلبات هذه الدائرة
                          </p>
                        )}
                        <dl>
                          <div>
                            <dt>مفتوحة</dt>
                            <dd>{open.toLocaleString('en-US')}</dd>
                          </div>
                          <div>
                            <dt>منجزة</dt>
                            <dd>{department.completed.toLocaleString('en-US')}</dd>
                          </div>
                          <div>
                            <dt>شكاوى</dt>
                            <dd>{department.openFeedback.toLocaleString('en-US')}</dd>
                          </div>
                        </dl>
                        <small dir="ltr">
                          {department.lat.toFixed(5)}, {department.lng.toFixed(5)}
                        </small>
                        <div className="gis-popup-links">
                          <a href={`/departments/${encodeURIComponent(String(department.id))}`}>صفحة الدائرة</a>
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${department.lat},${department.lng}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            الاتجاهات ↗
                          </a>
                          {department.sourceUrl && (
                            <a href={department.sourceUrl} target="_blank" rel="noreferrer">
                              المصدر ↗
                            </a>
                          )}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                )
              })}
              <ScaleControl position="bottomleft" imperial={false} />
            </MapContainer>
          )}

          <div className="gis-toolbar" role="toolbar" aria-label="أدوات الخريطة" ref={toolbarRef}>
            <div className="gis-seg" role="group" aria-label="نوع الخريطة">
              {(Object.keys(BASEMAPS) as BasemapKey[]).map(key => (
                <button
                  type="button"
                  key={key}
                  className={key === basemap ? 'is-active' : ''}
                  aria-pressed={key === basemap}
                  onClick={() => setBasemap(key)}
                >
                  {BASEMAPS[key].label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`gis-tool${showDistricts ? ' is-active' : ''}`}
              aria-pressed={showDistricts}
              onClick={() => setShowDistricts(value => !value)}
              title="حدود الأقضية"
            >
              <Layers aria-hidden="true" /> <span>الأقضية</span>
            </button>
            <button
              type="button"
              className={`gis-tool${showLandmarks ? ' is-active' : ''}`}
              aria-pressed={showLandmarks}
              onClick={() => setShowLandmarks(value => !value)}
              title="المعالم"
            >
              <Landmark aria-hidden="true" /> <span>المعالم</span>
            </button>
            {districtRows.length > 0 && (
              <DistrictPicker value={district} districts={districtRows} onChange={setDistrict} />
            )}
          </div>

          <div className="gis-zoom" role="group" aria-label="التكبير">
            <button
              type="button"
              onClick={() => (mode === '3d' ? drillApi.current?.zoomIn() : mapRef.current?.zoomIn())}
              aria-label="تكبير"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => (mode === '3d' ? drillApi.current?.zoomOut() : mapRef.current?.zoomOut())}
              aria-label="تصغير"
            >
              −
            </button>
            <button type="button" onClick={fitGovernorate} aria-label="عرض المحافظة كاملة" title="عرض المحافظة كاملة">
              <Crosshair aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'إنهاء ملء الشاشة' : 'ملء الشاشة'}
              title={fullscreen ? 'إنهاء ملء الشاشة' : 'ملء الشاشة'}
            >
              {fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </button>
          </div>

          {current && (
            <div className="drill-layer">
              <DistrictProfilePanel
                district={current}
                districts={districtRows}
                facilityIndex={facilityIndex}
                services={services}
                variant={variant}
                stateOf={stateOf}
                selectedId={selected}
                onSelectDepartment={id => (mode === '3d' ? setSelected(id) : focusById(id))}
                onBack={() => setDistrict(null)}
                collapsed={panelCollapsed}
                onToggleCollapsed={togglePanel}
              />
            </div>
          )}

          <div className="gis-legend" ref={legendRef}>
            <span>
              <i className="gis-dot is-idle" /> لا طلبات مفتوحة
            </span>
            <span>
              <i className="gis-dot is-busy" /> طلبات قيد المعالجة
            </span>
            <span>
              <i className="gis-dot is-alert" /> بلا موظف مفعّل
            </span>
            <span className="gis-coords" dir="ltr">
              {cursor ? `${cursor.lat.toFixed(4)}°N  ${cursor.lng.toFixed(4)}°E` : 'Dhi Qar · EPSG:4326'}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
