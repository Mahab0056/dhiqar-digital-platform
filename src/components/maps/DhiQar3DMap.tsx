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
import { Box, Compass, Layers, MapPin, Navigation, Pause, Play, RotateCcw, X } from 'lucide-react'
import type { FeatureCollection, Point, Polygon } from 'geojson'
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
  hexagon as hexagonOf,
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

const OVERVIEW = { center: [46.33, 31.24] as [number, number], zoom: 8.1, pitch: 25, bearing: 0 }
const HOME = { center: NASIRIYAH, zoom: 13.35, pitch: 58, bearing: -28 }

/** narrow screens see less of the city: pull the camera back a little */
const fitZoom = (zoom: number, width: number) => zoom + Math.max(-1, Math.min(0, Math.log2(width / 1320) / 2))
const PILLAR_MIN_ZOOM = 10.3
const CLUSTER_MAX_ZOOM = 10.8
const IDLE_RESUME_MS = 10_000
const ORBIT_DEG_PER_MS = 0.0022 // ≈ 2.2° a second

// ---- department geometry -------------------------------------------------------------------------

const HEX_RADIUS_M = 92
const hexagon = (lng: number, lat: number) => hexagonOf(lng, lat, HEX_RADIUS_M)

const weightOf = (item: LocatedDepartment) => item.services.length + (item.digitalServices ?? 0)
/** pillar height in metres: taller for departments that offer more services */
const heightOf = (item: LocatedDepartment) => 220 + Math.min(weightOf(item), 12) * 62

type DeptProps = { id: string; color: string; lit: string; cap: string; h: number; sector: SectorKey }

function featureProps(item: LocatedDepartment): DeptProps {
  const sector = sectorOf(item.category)
  return {
    id: item.id,
    lit: mix(sector.color, '#ffffff', 0.3),
    color: sector.color,
    cap: mix(sector.color, '#ffffff', 0.55),
    h: heightOf(item),
    sector: sector.key,
  }
}

const pillarsOf = (items: LocatedDepartment[]): FeatureCollection<Polygon, DeptProps> => ({
  type: 'FeatureCollection',
  features: items.map(item => ({
    type: 'Feature',
    geometry: hexagon(item.lng, item.lat),
    properties: featureProps(item),
  })),
})

const pointsOf = (items: LocatedDepartment[]): FeatureCollection<Point, DeptProps> => ({
  type: 'FeatureCollection',
  features: items.map(item => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [item.lng, item.lat] },
    properties: featureProps(item),
  })),
})

/** centre of a district's busiest cluster, so one far-off office doesn't pull the camera into empty desert */
function denseCentre(items: LocatedDepartment[]): [number, number] {
  const km = (a: LocatedDepartment, b: LocatedDepartment) => Math.hypot((a.lng - b.lng) * 95, (a.lat - b.lat) * 111)
  const hub = items.reduce((best, item) =>
    items.filter(other => km(item, other) < 2).length > items.filter(other => km(best, other) < 2).length ? item : best
  )
  const near = items.filter(item => km(hub, item) < 3)
  return [near.reduce((sum, i) => sum + i.lng, 0) / near.length, near.reduce((sum, i) => sum + i.lat, 0) / near.length]
}

const GROW: ExpressionSpecification = ['coalesce', ['feature-state', 'grow'], 0]
const PULSE: ExpressionSpecification = ['coalesce', ['feature-state', 'pulse'], 0]

/** Pillar heights shrink as the camera gets close so they never swallow the street view. */
const pillarHeight = (extra = 0): ExpressionSpecification => {
  const at = (scale: number): ExpressionSpecification => ['*', GROW, ['+', ['*', ['get', 'h'], scale], extra]]
  return ['interpolate', ['linear'], ['zoom'], 11.5, at(1), 13.4, at(0.7), 15, at(0.42), 17, at(0.22)]
}

type Tween = { from: number; to: number; start: number; duration: number; ease: (t: number) => number }

type Tooltip = { x: number; y: number; item: LocatedDepartment }

type Props = {
  departments: LocatedDepartment[]
  visibleIds: ReadonlySet<string>
  /** the style or WebGL failed — the caller swaps in the flat map */
  onUnavailable: () => void
}

export default function DhiQar3DMap({ departments, visibleIds, onUnavailable }: Props) {
  const shellRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [ready, setReady] = useState(false)
  const [is3D, setIs3D] = useState(true)
  const [touring, setTouring] = useState(false)
  const [tourCaption, setTourCaption] = useState('')
  const [reducedMotion] = useState(prefersReducedMotion)
  const [orbitOn, setOrbitOn] = useState(() => !prefersReducedMotion())
  const [hiddenSectors, setHiddenSectors] = useState<ReadonlySet<SectorKey>>(new Set())
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const [selected, setSelected] = useState<LocatedDepartment | null>(null)
  const [legendOpen, setLegendOpen] = useState(() => window.innerWidth > 640)

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

  // mutable animation state shared by the render loop and the handlers
  const motion = useRef({
    reduced: prefersReducedMotion(),
    lastInteraction: 0,
    flying: false,
    orbit: !prefersReducedMotion(),
    is3D: true,
    inView: true,
    risen: false,
    loaded: false,
    grow: new Map<string, number>(),
    tweens: new Map<string, Tween>(),
    targets: new Map<string, number>(),
    hovered: null as string | null,
    selected: null as string | null,
    tourToken: 0,
  })
  const onUnavailableRef = useRef(onUnavailable)
  const shownRef = useRef(shown)
  const departmentsRef = useRef(departments)
  // latest props for the long-lived map callbacks (written before the data effects below run)
  useLayoutEffect(() => {
    onUnavailableRef.current = onUnavailable
    shownRef.current = shown
    departmentsRef.current = departments
  })

  /** only standing (or moving) pillars stay in the source — a zero-height extrusion still draws its roof */
  const syncPillars = useCallback(() => {
    const map = mapRef.current
    const m = motion.current
    if (!map || !m.loaded) return
    const standing = departmentsRef.current.filter(
      item => m.targets.get(item.id) === 1 || m.tweens.has(item.id) || (!m.risen && shownRef.current.includes(item))
    )
    ;(map.getSource('dq-pillars') as GeoJSONSource).setData(pillarsOf(standing))
  }, [])

  /** animate every pillar toward its target height (staggered rise, quick fall) */
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
      syncPillars()
    },
    [syncPillars]
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
    const abort = new AbortController()
    const fail = () => {
      if (!cancelled) onUnavailableRef.current()
    }
    const loadTimer = window.setTimeout(fail, 20_000)

    const start = async () => {
      let raw: StyleSpecification
      try {
        raw = await fetchBaseStyle(abort.signal)
      } catch {
        return fail()
      }
      if (cancelled) return
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
      // pillars grow upward, so sit the focal point a little below the middle
      map.setPadding({ top: width < 640 ? 110 : 70, bottom: 0, left: 0, right: 0 })
      map.addControl(new NavigationControl({ visualizePitch: true }), 'top-left')
      map.addControl(new FullscreenControl({ container: shellRef.current ?? undefined }), 'top-left')
      map.addControl(new AttributionControl({ compact: false }), 'bottom-left')

      map.on('error', event => {
        // a broken style before first paint means no usable map; later tile hiccups are ignored
        if (!map?.loaded() && !map?.isStyleLoaded()) console.warn('3D map error', event.error)
      })

      map.once('load', () => {
        if (cancelled || !map) return
        window.clearTimeout(loadTimer)
        addDepartmentLayers(map)
        m.loaded = true
        setReady(true)
        if (m.reduced) {
          m.risen = true
          retarget(shownRef.current)
        } else {
          window.setTimeout(() => {
            if (cancelled) return
            flyTo({ ...HOME, zoom: fitZoom(HOME.zoom, width), duration: 6800, curve: 1.3 })
          }, 650)
        }
      })

      // pillars rise once the camera is close enough to see them
      map.on('zoom', () => {
        if (!m.risen && map && map.getZoom() >= PILLAR_MIN_ZOOM) {
          m.risen = true
          retarget(shownRef.current)
        }
      })

      // ---- render loop: tweens, halo pulse, cluster ripple and idle orbit ----------------------
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
          map.setFeatureState({ source: 'dq-pillars', id }, { grow: Math.max(0, value) })
          if (t >= 1) {
            m.tweens.delete(id)
            if (tween.to === 0) fallen = true
          }
        }
        if (fallen) syncPillars()

        const zoom = map.getZoom()
        if (!m.reduced) {
          if (zoom >= PILLAR_MIN_ZOOM) {
            let i = 0
            for (const [id, value] of m.grow) {
              const pulse = (now / 2200 + i++ * 0.137) % 1
              map.setFeatureState({ source: 'dq-points', id }, { grow: Math.min(1, Math.max(0, value)), pulse })
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
      const palette = isDarkTheme() ? DARK : LIGHT
      for (const layer of current.getStyle().layers as StyleLayer[]) {
        if (layer.id.startsWith('dq-')) continue
        for (const [prop, value] of Object.entries(themePaint(layer, palette)))
          current.setPaintProperty(layer.id, prop as 'fill-color', value as string)
      }
      current.setSky(skyFor(palette))
      applyDepartmentTheme(current, palette)
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
      map?.remove()
      mapRef.current = null
    }
    // the map is created once; data changes flow through the effects below
  }, [flyTo, retarget, syncPillars])

  // ---- department data ----------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    syncPillars()
    ;(map.getSource('dq-points') as GeoJSONSource).setData(pointsOf(departments))
  }, [ready, departments, syncPillars])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    ;(map.getSource('dq-clusters') as GeoJSONSource).setData(pointsOf(shown))
    if (motion.current.risen) retarget(shown, 22)
    setSelected(current => (current && !shown.some(item => item.id === current.id) ? null : current))
  }, [ready, shown, retarget])

  // ---- hover tooltip, selection and cluster zoom ------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const m = motion.current
    const setHover = (id: string | null) => {
      if (m.hovered === id) return
      if (m.hovered) map.setFeatureState({ source: 'dq-pillars', id: m.hovered }, { hover: false })
      m.hovered = id
      if (id) map.setFeatureState({ source: 'dq-pillars', id }, { hover: true })
    }
    const pick = (features?: MapGeoJSONFeature[]) => {
      const id = features?.[0]?.properties?.id as string | undefined
      const item = id ? byId.get(id) : undefined
      return item && (m.grow.get(item.id) ?? 0) > 0.2 ? item : undefined
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
      if (item) setSelected(item)
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
        zoom: Math.max(zoom + 0.6, PILLAR_MIN_ZOOM + 1.6),
        pitch: m.is3D ? 55 : 0,
        duration: 1800,
      })
    }
    const interactive = ['dq-pillars', 'dq-single'] as const
    for (const layer of interactive) {
      map.on('mousemove', layer, onMove)
      map.on('mouseleave', layer, onLeave)
      map.on('click', layer, onClick)
    }
    map.on('click', 'dq-cluster', onCluster)
    return () => {
      for (const layer of interactive) {
        map.off('mousemove', layer, onMove)
        map.off('mouseleave', layer, onLeave)
        map.off('click', layer, onClick)
      }
      map.off('click', 'dq-cluster', onCluster)
    }
  }, [ready, byId, flyTo])

  // fly to whatever gets selected and highlight its pillar
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const m = motion.current
    if (m.selected) map.setFeatureState({ source: 'dq-pillars', id: m.selected }, { selected: false })
    m.selected = selected?.id ?? null
    map.setFilter('dq-selected', ['==', ['get', 'id'], selected?.id ?? ''])
    if (!selected) return
    map.setFeatureState({ source: 'dq-pillars', id: selected.id }, { selected: true })
    m.lastInteraction = performance.now()
    flyTo({
      center: [selected.lng, selected.lat],
      zoom: Math.max(map.getZoom(), fitZoom(14.3, map.getContainer().clientWidth)),
      // keep the pillar clear of the card (beside it on wide screens, above it on phones)
      offset: map.getContainer().clientWidth < 640 ? [0, -120] : [-150, 20],
      pitch: m.is3D ? 62 : 0,
      bearing: map.getBearing() - 25,
      duration: 2000,
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
      pitch: next ? 58 : 0,
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
        zoom: fitZoom(stop.count > 10 ? 13.2 : 13.9, map.getContainer().clientWidth),
        pitch: m.is3D ? 60 : 0,
        bearing,
      }
      m.flying = true
      await new Promise<void>(resolve => {
        map.once('moveend', () => resolve())
        if (m.reduced) map.jumpTo(view)
        else map.flyTo({ ...view, duration: 4200, curve: 1.5, essential: true })
      })
      m.flying = false
      m.lastInteraction = 0 // orbit gently while the stop is on screen
      await wait(3200)
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

  const selectedSector = selected ? sectorOf(selected.category) : null

  return (
    <div
      ref={shellRef}
      className={`map3d-shell${ready ? ' is-ready' : ''}${selected ? ' has-card' : ''}`}
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
          <Layers aria-hidden="true" /> القطاعات
        </button>
        {legendOpen && (
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
            <li className="map3d-legend-note">ارتفاع العمود = عدد الخدمات</li>
          </ul>
        )}
      </div>

      {tooltip && !selected && (
        <div className="map3d-tooltip" style={{ left: tooltip.x, top: tooltip.y }} role="tooltip">
          <strong>{tooltip.item.name}</strong>
          <span>
            {tooltip.item.district} · {tooltip.item.services.length.toLocaleString('en-US')} خدمة
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
    </div>
  )
}

// ---- department layers ------------------------------------------------------------------------------

function addDepartmentLayers(map: MapLibreMap) {
  const palette = isDarkTheme() ? DARK : LIGHT
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
  map.addSource('dq-pillars', { type: 'geojson', data: empty, promoteId: 'id' })
  map.addSource('dq-points', { type: 'geojson', data: empty, promoteId: 'id' })
  map.addSource('dq-clusters', { type: 'geojson', data: empty, cluster: true, clusterRadius: 46, clusterMaxZoom: 10 })

  // keep place names above the pillars' ground glow, but under the pillars themselves
  const firstSymbol = map.getStyle().layers.find(layer => layer.type === 'symbol')?.id

  map.addLayer(
    {
      id: 'dq-glow',
      type: 'circle',
      source: 'dq-points',
      minzoom: PILLAR_MIN_ZOOM,
      paint: {
        'circle-pitch-alignment': 'map',
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 11, 14, 16, 170],
        'circle-color': ['get', 'color'],
        'circle-blur': 1,
        'circle-opacity': ['*', 0.62, ['min', 1, GROW]],
      },
    },
    firstSymbol
  )
  map.addLayer(
    {
      id: 'dq-pulse',
      type: 'circle',
      source: 'dq-points',
      minzoom: PILLAR_MIN_ZOOM,
      paint: {
        'circle-pitch-alignment': 'map',
        'circle-radius': [
          'interpolate',
          ['exponential', 2],
          ['zoom'],
          11,
          ['+', 5, ['*', 16, PULSE]],
          16,
          ['+', 60, ['*', 190, PULSE]],
        ],
        'circle-opacity': 0,
        'circle-stroke-width': 2,
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-opacity': ['*', ['min', 1, GROW], ['-', 1, PULSE]],
      },
    },
    firstSymbol
  )
  // a bright double ring marks the selected department on the ground
  map.addLayer(
    {
      id: 'dq-selected',
      type: 'circle',
      source: 'dq-points',
      minzoom: PILLAR_MIN_ZOOM,
      filter: ['==', ['get', 'id'], ''],
      paint: {
        'circle-pitch-alignment': 'map',
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 11, 10, 16, 140],
        'circle-color': palette.selected,
        'circle-opacity': 0.16,
        'circle-stroke-width': 3,
        'circle-stroke-color': palette.selected,
        'circle-stroke-opacity': 0.95,
      },
    },
    firstSymbol
  )
  map.addLayer({
    id: 'dq-pillars',
    type: 'fill-extrusion',
    source: 'dq-pillars',
    minzoom: PILLAR_MIN_ZOOM,
    paint: {
      'fill-extrusion-color': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        ['get', 'cap'],
        ['boolean', ['feature-state', 'hover'], false],
        ['get', 'lit'],
        ['get', 'color'],
      ],
      'fill-extrusion-height': pillarHeight(),
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.93,
      'fill-extrusion-vertical-gradient': true,
    },
  })
  // a pale crown on every pillar reads as a lit beacon from a distance
  map.addLayer({
    id: 'dq-caps',
    type: 'fill-extrusion',
    source: 'dq-pillars',
    minzoom: PILLAR_MIN_ZOOM,
    paint: {
      'fill-extrusion-color': ['get', 'cap'],
      'fill-extrusion-base': pillarHeight(),
      'fill-extrusion-height': pillarHeight(28),
      'fill-extrusion-opacity': 0.93,
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

function applyDepartmentTheme(map: MapLibreMap, palette: Palette) {
  if (!map.getLayer('dq-cluster')) return
  map.setPaintProperty('dq-cluster', 'circle-color', palette.cluster)
  map.setPaintProperty('dq-cluster', 'circle-stroke-color', palette.clusterStroke)
  map.setPaintProperty('dq-cluster-ring', 'circle-stroke-color', palette.cluster)
  map.setPaintProperty('dq-cluster-count', 'text-color', palette.clusterText)
  map.setPaintProperty('dq-single', 'circle-stroke-color', palette.clusterStroke)
  map.setPaintProperty('dq-pillars', 'fill-extrusion-color', [
    'case',
    ['boolean', ['feature-state', 'selected'], false],
    palette.selected,
    ['boolean', ['feature-state', 'hover'], false],
    ['get', 'cap'],
    ['get', 'color'],
  ])
}
