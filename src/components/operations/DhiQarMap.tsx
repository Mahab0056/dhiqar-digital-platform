import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import type { Feature, FeatureCollection, Geometry, Polygon } from 'geojson'
import { GeoJSON, MapContainer, Marker, Popup, ScaleControl, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { Building2, Crosshair, Layers, Landmark, Maximize2, Minimize2, Search, ShieldAlert } from 'lucide-react'
import type { DashboardStats } from '../../types'

type Department = DashboardStats['departments'][number]
type Located = Department & { lat: number; lng: number }
type Area = { kind: 'governorate' | 'district'; name: string; osmId: number }

const BASEMAPS = {
  dark: {
    label: 'ليلي',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
  },
  light: {
    label: 'خريطة',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  satellite: {
    label: 'قمر صناعي',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
  },
} as const
type BasemapKey = keyof typeof BASEMAPS

// registry districts that are sub-districts (نواحي) of a larger قضاء on the boundary layer
const DISTRICT_PARENT: Record<string, string> = { النصر: 'الرفاعي', البطحاء: 'الناصرية', أور: 'الناصرية' }
const districtOf = (name: string) => DISTRICT_PARENT[name] || name

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
function MapBridge({ onReady, onMove }: { onReady: (map: L.Map) => void; onMove: (latlng: L.LatLng | null) => void }) {
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
}: {
  departments: DashboardStats['departments']
  unstaffed?: DashboardStats['unstaffedDepartments']
}) {
  const shellRef = useRef<HTMLElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRefs = useRef(new Map<string, L.Marker>())
  const [areas, setAreas] = useState<FeatureCollection<Geometry, Area> | null>(null)
  const [basemap, setBasemap] = useState<BasemapKey>('dark')
  const [showDistricts, setShowDistricts] = useState(true)
  const [showLandmarks, setShowLandmarks] = useState(true)
  const [category, setCategory] = useState('الكل')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [cursor, setCursor] = useState<L.LatLng | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/gis/dhi-qar.geojson')
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

  const stateOf = useCallback(
    (department: Department): 'idle' | 'busy' | 'alert' =>
      unstaffedIds.has(String(department.id)) ? 'alert' : openWork(department) > 0 ? 'busy' : 'idle',
    [unstaffedIds]
  )

  // per-district roll-up for the boundary layer tooltips
  const districtStats = useMemo(() => {
    const result = new Map<string, { total: number; mapped: number; open: number }>()
    for (const department of departments) {
      const key = districtOf(department.district)
      const row = result.get(key) || { total: 0, mapped: 0, open: 0 }
      row.total += 1
      if (typeof department.lat === 'number') row.mapped += 1
      row.open += openWork(department)
      result.set(key, row)
    }
    return result
  }, [departments])

  const governorate = areas?.features.find(feature => feature.properties.kind === 'governorate') as
    | Feature<Polygon, Area>
    | undefined
  const mask = useMemo(() => {
    if (!governorate) return null
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
      geometry: { type: 'Polygon', coordinates: [world, governorate.geometry.coordinates[0]] },
    } as Feature<Polygon>
  }, [governorate])
  const districts = useMemo(
    () =>
      areas
        ? ({ ...areas, features: areas.features.filter(feature => feature.properties.kind === 'district') } as FeatureCollection<
            Geometry,
            Area
          >)
        : null,
    [areas]
  )

  const handleReady = useCallback((map: L.Map) => {
    mapRef.current = map
    // the stage gets its height from CSS after mount — measure again, then frame the governorate
    window.setTimeout(() => {
      map.invalidateSize()
      map.fitBounds(GOVERNORATE_BOUNDS, { padding: [12, 12] })
    }, 60)
  }, [])
  const districtLabels = useMemo(
    () =>
      (districts?.features || []).map(feature => {
        const ring = (feature.geometry as Polygon).coordinates[0]
        const lngs = ring.map(point => point[0])
        const lats = ring.map(point => point[1])
        return {
          name: feature.properties.name,
          center: [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2] as [number, number],
        }
      }),
    [districts]
  )
  const fitGovernorate = () => mapRef.current?.flyToBounds(GOVERNORATE_BOUNDS, { padding: [24, 24], duration: 0.9 })
  const focus = (department: Located) => {
    setSelected(String(department.id))
    mapRef.current?.flyTo([department.lat, department.lng], 15, { duration: 0.9 })
    window.setTimeout(() => markerRefs.current.get(String(department.id))?.openPopup(), 950)
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
            <dd>{(districts?.features.length || 0).toLocaleString('en-US')}</dd>
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
              <Building2 aria-hidden="true" /> {pendingCoordinates.toLocaleString('en-US')} جهة أخرى بانتظار إحداثيات رسمية
              موثّقة ولا تُرسم تخميناً.
            </p>
          )}
        </aside>

        <div className="gis-stage">
          <MapContainer
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
              maxZoom={19}
              maxNativeZoom={basemap === 'dark' ? 16 : 19}
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
                style={{ color: '#7fd8aa', weight: 1.2, opacity: 0.75, dashArray: '4 4', fillColor: '#29c27f', fillOpacity: 0.04 }}
                onEachFeature={(feature, layer) => {
                  const name = (feature.properties as Area).name
                  const row = districtStats.get(name)
                  layer.bindTooltip(
                    `<strong>قضاء ${name}</strong><span>${row ? `${row.total} جهة · ${row.open} طلب مفتوح` : 'لا توجد جهات مسجلة بعد'}</span>`,
                    { sticky: true, className: 'gis-tip', direction: 'top' }
                  )
                  layer.on({
                    mouseover: () => (layer as L.Path).setStyle({ fillOpacity: 0.16, weight: 2.2, dashArray: '' }),
                    mouseout: () => (layer as L.Path).setStyle({ fillOpacity: 0.04, weight: 1.2, dashArray: '4 4' }),
                    click: () => mapRef.current?.flyToBounds((layer as L.Polygon).getBounds(), { padding: [30, 30], duration: 0.8 }),
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
                style={{ color: '#e2c57f', weight: 2.6, opacity: 0.95, fill: false, className: 'gis-border' }}
              />
            )}
            {showLandmarks && (
              <Marker position={UR} icon={urIcon} title="زقورة أور" zIndexOffset={-500}>
                <Popup>
                  <div className="gis-popup">
                    <strong>زقورة أور</strong>
                    <span>موقع أثري سومري — ضمن موقع «أهوار جنوب العراق» على قائمة التراث العالمي لليونسكو (2016)</span>
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

          <div className="gis-toolbar" role="toolbar" aria-label="أدوات الخريطة">
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
          </div>

          <div className="gis-zoom" role="group" aria-label="التكبير">
            <button type="button" onClick={() => mapRef.current?.zoomIn()} aria-label="تكبير">
              +
            </button>
            <button type="button" onClick={() => mapRef.current?.zoomOut()} aria-label="تصغير">
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

          <div className="gis-legend">
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
