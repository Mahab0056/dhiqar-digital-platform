import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson'
import { mix } from './maplibre-base'
import {
  fetchJson,
  FACILITY_TYPES,
  groupColor,
  loadFacilityIndex,
  type FacilityGroup,
  type FacilityIndex,
  type FacilityInfo,
  type FacilityType,
} from './facility-catalog'

// Real buildings for the 3D maps: OpenStreetMap footprints (built offline by scripts/geo/*.mjs),
// extruded with a façade texture, a parapet cap, a soft ground shadow and a floating category badge.
// Data © OpenStreetMap contributors (ODbL) — credited in every map's attribution control.

// the facility catalogue (types, groups, index loader) has no MapLibre dependency, so the flat 2D map's district
// profile can use it without pulling the 3D chunk; the 3D maps keep importing it from here
export {
  FACILITIES_INDEX_URL,
  FACILITY_GROUPS,
  FACILITY_TYPES,
  facilityColor,
  groupColor,
  groupCounts,
  loadFacilityIndex,
  type FacilityGroup,
  type FacilityIndex,
  type FacilityInfo,
  type FacilityType,
} from './facility-catalog'

export const BUILDINGS_URL = '/geo/department-buildings.geojson'
export const OSM_ATTRIBUTION =
  'المباني والمرافق © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> (ODbL)'

/** Esri World Imagery — keyless; already allowed by the CSP for the operations map */
export const SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
export const SATELLITE_ATTRIBUTION = 'صور فضائية © Esri, Maxar, Earthstar Geographics'

// ---- icons (lucide-style 24×24 stroke paths, drawn with Path2D so badges render synchronously) -----

export const ICONS = {
  hospital: 'M12 7v10 M7 12h10 M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
  heart:
    'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z M3.5 12h5l1.5-2.5 2.5 5 2-3.5h6',
  book: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
  smile: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20 M8 14s1.5 2 4 2 4-2 4-2 M9 9h.01 M15 9h.01',
  cap: 'M22 10 12 5 2 10l10 5 10-5z M6 12v5c3 3 9 3 12 0v-5 M22 10v6',
  shield:
    'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
  flame:
    'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z',
  scale:
    'M16 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z M2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z M7 21h10 M12 3v18 M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2',
  landmark: 'M3 22h18 M6 18v-7 M10 18v-7 M14 18v-7 M18 18v-7 M12 2l8 5H4z',
  building:
    'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2 M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2 M10 6h4 M10 10h4 M10 14h4 M10 18h4',
  droplet: 'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6',
  library: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  trophy:
    'M6 9H4.5a2.5 2.5 0 0 1 0-5H6 M18 9h1.5a2.5 2.5 0 0 0 0-5H18 M4 22h16 M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22 M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22 M18 2H6v7a6 6 0 0 0 12 0V2Z',
  idcard:
    'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M8 8a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M14 9h4 M14 13h4 M5 16c.6-1.5 1.8-2 3-2s2.4.5 3 2',
  banknote: 'M2 6h20v12H2z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6 M6 12h.01 M18 12h.01',
  fuel: 'M3 22h12 M4 9h10 M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18 M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.83a2 2 0 0 0-.59-1.42L18 5',
  road: 'M4 22 8 2 M20 22 16 2 M12 4v2 M12 10v3 M12 17v3',
  leaf: 'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
  home: 'M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15',
  briefcase:
    'M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2',
  steps: 'M3 21h18 M5 21v-4h14v4 M7 17v-4h10v4 M9 13V9h6v4 M11 9V6h2v3',
  radio:
    'M4.9 19.1C1 15.2 1 8.8 4.9 4.9 M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5 M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5 M19.1 4.9C23 8.8 23 15.1 19.1 19 M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4',
  plane: 'M2 16l20-6-2-3-7 2-5-6H6l3 7-5 1.5-2-2H1z M3 21h18',
} as const
export type IconKey = keyof typeof ICONS

/** registry category → badge icon */
const CATEGORY_ICON: Record<string, IconKey> = {
  'حكومة محلية': 'landmark',
  بلديات: 'landmark',
  'إسكان وتخطيط عمراني': 'home',
  'تخطيط وإحصاء': 'map',
  استثمار: 'briefcase',
  'أمن وشرطة': 'shield',
  قضاء: 'scale',
  'أحوال مدنية وجوازات': 'idcard',
  'تسجيل عقاري': 'home',
  ماء: 'droplet',
  مجاري: 'droplet',
  كهرباء: 'zap',
  'طرق وجسور': 'road',
  'نفط وطاقة': 'fuel',
  'اتصالات وبريد': 'radio',
  'موارد مائية': 'droplet',
  بيئة: 'leaf',
  'تعليم عالي': 'cap',
  'تربية وتعليم': 'book',
  صحة: 'hospital',
  'ضرائب ومالية': 'banknote',
  تقاعد: 'banknote',
  'حماية اجتماعية وعمل': 'users',
  زراعة: 'leaf',
  'آثار وسياحة': 'steps',
  أوقاف: 'moon',
  'شباب ورياضة': 'trophy',
  أخرى: 'building',
}
export const iconForCategory = (category: string): IconKey => CATEGORY_ICON[category] ?? 'building'

type FacilityProps = {
  f: string
  t: FacilityType
  k?: 'b' | 'g'
  h?: number
  g?: 1
  n?: string | null
  /** the facility's OSM element (points), or the OSM building drawn (k: 'b') */
  o?: string
  dep?: string
}
type FacilityFeature = Feature<Polygon | Point, FacilityProps>
const districtFiles = new Map<string, Promise<FacilityFeature[] | null>>()
/** one district's facilities, or null when the file could not be loaded (not cached: asked again next time) */
function loadDistrictFacilities(file: string): Promise<FacilityFeature[] | null> {
  const cached = districtFiles.get(file)
  if (cached) return cached
  const request: Promise<FacilityFeature[] | null> = fetchJson<FeatureCollection<Polygon | Point, FacilityProps>>(
    `/geo/facilities/${file}`
  ).then(data => {
    if (Array.isArray(data?.features)) return data.features
    if (districtFiles.get(file) === request) districtFiles.delete(file)
    return null
  })
  districtFiles.set(file, request)
  return request
}

// ---- textures and badges ----------------------------------------------------------------------------

const FACADES = [
  { wall: '#dcc8a2', band: '#c9b088' }, // warm sand brick
  { wall: '#e7ddcb', band: '#d3c6ae' }, // pale limestone
  { wall: '#d2b07e', band: '#bc9866' }, // ochre
  { wall: '#e9e3d6', band: '#d8cfbd' }, // whitewashed render
  { wall: '#cfa982', band: '#b88f68' }, // yellow-brick of the older directorates
] as const
export const FACADE_COUNT = FACADES.length

/** a building's façade variant and roof colour, stable per id */
export function facadeOf(id: string) {
  let h = 7
  for (const ch of id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0
  const index = h % FACADES.length
  return { facade: index, roof: mix(FACADES[index].band, '#8a7350', 0.18) }
}

/**
 * Window-grid façade tile: one storey (≈3.2 m) of wall with two windows, a floor slab line and a
 * little brick grain. Night tiles light a few windows warm.
 */
function facadeImage(index: number, night: boolean) {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const { wall, band } = FACADES[index]
  ctx.fillStyle = night ? mix(wall, '#0d1813', 0.62) : wall
  ctx.fillRect(0, 0, size, size)
  // grain
  let seed = 17 + index * 101
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = `rgba(${rand() > 0.5 ? '255,255,255' : '60,40,20'},${0.04 + rand() * 0.05})`
    ctx.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 2, 1)
  }
  // floor slab
  ctx.fillStyle = night ? mix(band, '#0d1813', 0.6) : band
  ctx.fillRect(0, 0, size, 6)
  // two windows with a lintel and a sill
  for (const x of [12, 40]) {
    const lit = night && rand() > 0.45
    ctx.fillStyle = night ? (lit ? '#f4c771' : '#1b2a33') : '#62727c'
    ctx.fillRect(x, 22, 12, 24)
    if (!night) {
      const glass = ctx.createLinearGradient(x, 22, x + 12, 46)
      glass.addColorStop(0, 'rgba(205,225,236,0.6)')
      glass.addColorStop(0.55, 'rgba(130,150,162,0.12)')
      glass.addColorStop(1, 'rgba(40,55,65,0.2)')
      ctx.fillStyle = glass
      ctx.fillRect(x, 22, 12, 24)
    }
    ctx.fillStyle = night ? 'rgba(0,0,0,0.3)' : 'rgba(70,50,30,0.3)'
    ctx.fillRect(x + 5, 22, 2, 24) // mullion
    ctx.fillStyle = night ? mix(band, '#0d1813', 0.5) : band
    ctx.fillRect(x - 2, 19, 16, 3) // lintel
    ctx.fillRect(x - 2, 46, 16, 3) // sill
  }
  return ctx.getImageData(0, 0, size, size)
}

/** registers the day and night façade tiles (names: dq-facade-<i>, dq-facade-night-<i>) */
export function addFacadeImages(map: MapLibreMap) {
  for (let i = 0; i < FACADES.length; i++)
    for (const night of [false, true]) {
      const name = `dq-facade-${night ? 'night-' : ''}${i}`
      if (!map.hasImage(name)) map.addImage(name, facadeImage(i, night), { pixelRatio: 6 })
    }
}

/** façade pattern by variant (stand-ins too: an approximate block still reads as an office building) */
const facadePattern = (night: boolean): ExpressionSpecification => [
  'concat',
  night ? 'dq-facade-night-' : 'dq-facade-',
  ['to-string', ['coalesce', ['get', 'facade'], 0]],
]

/** switches every building layer between day façades and night ones with a few lit windows */
export function setFacadeTheme(map: MapLibreMap, night: boolean) {
  for (const layer of map.getStyle().layers)
    if (layer.id.startsWith('dq-') && layer.id.endsWith('-walls'))
      map.setPaintProperty(layer.id, 'fill-extrusion-pattern', facadePattern(night))
}

/**
 * Badge images are generated on demand from their name: `dq-badge:<icon>:<hex colour>:<kind>` where
 * kind is `dept` (pin with a mint "on the platform" ring), `fac` (small round badge) or `sel`.
 */
export const badgeName = (icon: IconKey, color: string, kind: 'dept' | 'fac') =>
  `dq-badge:${icon}:${color.slice(1)}:${kind}`

export function badgeExpression(kind: 'dept' | 'fac'): ExpressionSpecification {
  return ['concat', 'dq-badge:', ['get', 'icon'], ':', ['slice', ['get', 'color'], 1], `:${kind}`]
}

function drawBadge(icon: IconKey, color: string, kind: string) {
  const ratio = 2
  const pin = kind === 'dept'
  const d = pin ? 34 : 24
  const ring = pin ? 3 : 2
  const w = (d + 6) * ratio
  const h = (pin ? d + 14 : d + 6) * ratio
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.scale(ratio, ratio)
  const cx = (d + 6) / 2
  const cy = d / 2 + 3
  ctx.shadowColor = 'rgba(0,0,0,0.38)'
  ctx.shadowBlur = 5
  ctx.shadowOffsetY = 2
  if (pin) {
    // stem down to the building
    ctx.beginPath()
    ctx.moveTo(cx - 6, cy + d / 2 - 4)
    ctx.lineTo(cx, cy + d / 2 + 9)
    ctx.lineTo(cx + 6, cy + d / 2 - 4)
    ctx.closePath()
    ctx.fillStyle = '#7fdcb4'
    ctx.fill()
  }
  ctx.beginPath()
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2)
  ctx.fillStyle = pin ? '#7fdcb4' : '#ffffff'
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.beginPath()
  ctx.arc(cx, cy, d / 2 - ring, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  if (pin) {
    ctx.beginPath()
    ctx.arc(cx, cy, d / 2 - ring - 1.2, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 1.2
    ctx.stroke()
  }
  const glyph = pin ? 18 : 13
  ctx.save()
  ctx.translate(cx - glyph / 2, cy - glyph / 2)
  ctx.scale(glyph / 24, glyph / 24)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2.2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke(new Path2D(ICONS[icon] ?? ICONS.building))
  ctx.restore()
  return { image: ctx.getImageData(0, 0, w, h), ratio }
}

/** answers MapLibre's request for a badge image the first time a symbol needs it */
export function installBadgeFactory(map: MapLibreMap) {
  map.setMissingStyleImageResolver(id => {
    const [prefix, icon, hex, kind] = id.split(':')
    if (prefix !== 'dq-badge' || map.hasImage(id)) return
    const { image, ratio } = drawBadge(icon as IconKey, `#${hex}`, kind)
    map.addImage(id, image, { pixelRatio: ratio })
  })
  return () => {
    map.setMissingStyleImageResolver(null)
  }
}

// ---- building layers --------------------------------------------------------------------------------

type BuildingLayerOptions = {
  /** source with building polygons; properties: h, facade, roof (+ g: 1 for a generic stand-in) */
  source: string
  prefix: string
  minzoom: number
  /** extrusion height plus `extra` metres (lets the departments map animate a rise) */
  height: (extra: number) => ExpressionSpecification
  /** roof colour (feature-state aware for hover / selection) */
  roof: ExpressionSpecification | string
  filter?: FilterSpecification
  beforeId?: string
  /** ground glow under hovered / selected buildings */
  glow?: ExpressionSpecification | string
}

/** shadow, ground glow, walls and parapet for one set of buildings */
export function addBuildingLayers(map: MapLibreMap, options: BuildingLayerOptions) {
  const { source, prefix, minzoom, height, roof, filter, beforeId, glow } = options
  const fade = (opacity: number): ExpressionSpecification => [
    'interpolate',
    ['linear'],
    ['zoom'],
    minzoom,
    0,
    minzoom + 0.6,
    opacity,
  ]
  const withFilter = <T extends object>(layer: T) => (filter ? { ...layer, filter } : layer)
  // soft cast shadow (sun from the south-west) and a contact shadow along the walls
  map.addLayer(
    withFilter({
      id: `${prefix}-shadow`,
      type: 'fill' as const,
      source,
      minzoom,
      paint: {
        'fill-color': '#1d160c',
        'fill-opacity': fade(0.22),
        'fill-translate': [5, -4],
        'fill-translate-anchor': 'map' as const,
        'fill-antialias': true,
      },
    }),
    beforeId
  )
  map.addLayer(
    withFilter({
      id: `${prefix}-ao`,
      type: 'line' as const,
      source,
      minzoom,
      paint: {
        'line-color': '#140f08',
        'line-width': ['interpolate', ['exponential', 2], ['zoom'], 14, 2, 18, 14],
        'line-blur': ['interpolate', ['exponential', 2], ['zoom'], 14, 2, 18, 14],
        'line-opacity': fade(0.32),
      },
    }),
    beforeId
  )
  if (glow)
    map.addLayer(
      withFilter({
        id: `${prefix}-glow`,
        type: 'line' as const,
        source,
        minzoom,
        paint: {
          'line-color': glow,
          'line-width': ['interpolate', ['exponential', 2], ['zoom'], 14, 5, 18, 34],
          'line-blur': ['interpolate', ['exponential', 2], ['zoom'], 14, 4, 18, 26],
          'line-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            0.95,
            ['boolean', ['feature-state', 'hover'], false],
            0.7,
            0,
          ],
        },
      }),
      beforeId
    )
  map.addLayer(
    withFilter({
      id: `${prefix}-walls`,
      type: 'fill-extrusion' as const,
      source,
      minzoom,
      paint: {
        'fill-extrusion-pattern': facadePattern(false),
        'fill-extrusion-height': height(0),
        'fill-extrusion-base': ['coalesce', ['get', 'base'], 0],
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': true,
      },
    }),
    beforeId
  )
  // parapet / roof cap: a slightly darker band that also hides the textured roof
  map.addLayer(
    withFilter({
      id: `${prefix}-roof`,
      type: 'fill-extrusion' as const,
      source,
      minzoom,
      paint: {
        'fill-extrusion-color': roof,
        'fill-extrusion-base': height(0),
        'fill-extrusion-height': height(0.9),
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': false,
      },
    }),
    beforeId
  )
}

/** the Ziggurat of Ur: stepped mud-brick terraces from its real OSM outline */
export function addLandmarkLayers(map: MapLibreMap, data: FeatureCollection) {
  map.addSource('dq-landmarks', { type: 'geojson', data })
  map.addLayer({
    id: 'dq-landmarks-shadow',
    type: 'fill',
    source: 'dq-landmarks',
    minzoom: 12,
    filter: ['==', ['get', 'base'], 0],
    paint: { 'fill-color': '#1d160c', 'fill-opacity': 0.25, 'fill-translate': [9, -7], 'fill-translate-anchor': 'map' },
  })
  map.addLayer({
    id: 'dq-landmarks',
    type: 'fill-extrusion',
    source: 'dq-landmarks',
    minzoom: 12,
    paint: {
      'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'base'], 0, '#c29f6c', 22, '#dcc193'],
      'fill-extrusion-base': ['get', 'base'],
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-vertical-gradient': true,
    },
  })
  // its name floats over the top terrace
  map.addLayer({
    id: 'dq-landmarks-label',
    type: 'symbol',
    source: 'dq-landmarks',
    minzoom: 12,
    filter: ['==', ['get', 'base'], 0],
    layout: {
      'icon-image': badgeName('steps', '#b07d3c', 'fac'),
      'icon-anchor': 'bottom',
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 13,
      'text-anchor': 'top',
      'text-offset': [0, 0.3],
      'icon-allow-overlap': true,
    },
    paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(40,26,8,0.85)', 'text-halo-width': 1.6 },
  })
}

// ---- facilities layer (lazy per district) ------------------------------------------------------------

export type FacilityLayerHandle = {
  /** show only these groups (all when empty / undefined) */
  setGroups: (groups: ReadonlySet<FacilityGroup> | null) => void
  /** load the given district files now (e.g. on drill-down) */
  loadDistricts: (names: string[]) => Promise<void>
  /** the facility under a map point, if any */
  info: (props: Record<string, unknown>) => FacilityInfo | null
  remove: () => void
}

type FacilityLayerOptions = {
  minzoom: number
  beforeId?: string
  /** facility badges sit under the department badges so the platform's own offices win collisions */
  badgesBeforeId?: string
  /** districts → files come from the index; `auto` loads whatever district the camera looks at */
  auto: boolean
  districtBounds?: Map<string, [[number, number], [number, number]]>
}

/** Adds the OSM public-facilities layers; data is fetched per district as it comes into view. */
export function addFacilityLayers(map: MapLibreMap, options: FacilityLayerOptions): FacilityLayerHandle {
  const { minzoom, beforeId, badgesBeforeId, auto, districtBounds } = options
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
  map.addSource('dq-fac', { type: 'geojson', data: empty, promoteId: 'f' })
  const loaded = new Map<string, Feature<Polygon | Point, FacilityProps>[]>()
  const districtOfFeature = new Map<string, string>()
  /** each facility's point (its card data), and what its drawn building is — looked up on every hover */
  const pointOf = new Map<string, FacilityFeature>()
  const shapeOf = new Map<string, 'osm' | 'generic'>()
  let index: FacilityIndex | null = null
  let groups: ReadonlySet<FacilityGroup> | null = null
  let alive = true

  const isBuilding: FilterSpecification = ['==', ['get', 'k'], 'b']
  const groupFilter = (base: FilterSpecification): FilterSpecification => {
    if (!groups || groups.size === 0) return base
    const types = Object.entries(FACILITY_TYPES)
      .filter(([, meta]) => groups?.has(meta.group))
      .map(([type]) => type)
    return ['all', base, ['in', ['get', 't'], ['literal', types]]] as FilterSpecification
  }

  map.addLayer(
    {
      id: 'dq-fac-grounds',
      type: 'fill',
      source: 'dq-fac',
      minzoom: minzoom - 0.5,
      filter: ['==', ['get', 'k'], 'g'],
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.13, 'fill-outline-color': ['get', 'color'] },
    },
    beforeId
  )
  addBuildingLayers(map, {
    source: 'dq-fac',
    prefix: 'dq-fac',
    minzoom,
    filter: isBuilding,
    beforeId,
    height: extra => ['interpolate', ['linear'], ['zoom'], minzoom, 0, minzoom + 0.8, ['+', ['get', 'h'], extra]],
    roof: ['get', 'roof'],
    glow: ['get', 'color'],
  })
  map.addLayer(
    {
      id: 'dq-fac-badges',
      type: 'symbol',
      source: 'dq-fac',
      minzoom: minzoom + 1.9,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'dep']]],
      layout: {
        'icon-image': badgeExpression('fac'),
        'icon-size': ['interpolate', ['linear'], ['zoom'], minzoom + 1.9, 0.72, 17, 0.95],
        'icon-anchor': 'bottom',
        'icon-offset': [0, -6],
        'icon-allow-overlap': false,
        'symbol-sort-key': ['get', 'rank'],
        'text-field': ['coalesce', ['get', 'n'], ['get', 'label']],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10.5,
        'text-anchor': 'top',
        'text-offset': [0, 0.4],
        'text-max-width': 9,
        'text-optional': true,
      },
      paint: {
        'text-color': '#2b2418',
        'text-halo-color': 'rgba(255,253,247,0.92)',
        'text-halo-width': 1.4,
        'icon-opacity': ['interpolate', ['linear'], ['zoom'], minzoom + 1.9, 0, minzoom + 2.2, 1],
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 16.2, 0, 16.6, 1],
      },
    },
    map.getLayer(badgesBeforeId ?? '') ? badgesBeforeId : undefined
  )

  /** the facilities' real OSM buildings on show replace the basemap's generic copies of them */
  const maskBasemap = () => {
    if (!alive) return
    const shown = (type: FacilityType) =>
      !groups || groups.size === 0 || groups.has((FACILITY_TYPES[type] ?? FACILITY_TYPES.government).group)
    const keys = [...loaded.values()]
      .flat()
      .filter(feature => feature.properties.k === 'b' && shown(feature.properties.t))
      .map(feature => feature.properties.o)
    hideBasemapBuildings(map, keys, 'facilities')
  }

  const publish = () => {
    if (!alive) return
    const features = [...loaded.values()].flat()
    ;(map.getSource('dq-fac') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features })
    maskBasemap()
  }

  const decorate = (district: string, features: FacilityFeature[]) =>
    features.map(feature => {
      const type = FACILITY_TYPES[feature.properties.t] ? feature.properties.t : 'government'
      const meta = FACILITY_TYPES[type]
      const color = groupColor(meta.group)
      const { facade, roof } = facadeOf(feature.properties.f)
      const id = feature.properties.f
      if (feature.geometry.type === 'Point') {
        districtOfFeature.set(id, district)
        pointOf.set(id, feature)
      } else if (feature.properties.k === 'b') {
        // a campus can have several real outlines; a stand-in (`g: 1`) is only ever the facility's single block
        if (!feature.properties.g) shapeOf.set(id, 'osm')
        else if (!shapeOf.has(id)) shapeOf.set(id, 'generic')
      }
      return {
        ...feature,
        properties: {
          ...feature.properties,
          color,
          icon: meta.icon,
          label: meta.label,
          facade,
          // roofs carry a hint of the category colour so types read from above
          roof: mix(roof, color, 0.2),
          rank: ['hospital', 'university', 'court', 'townhall'].includes(type) ? 0 : type === 'school' ? 2 : 1,
        },
      }
    })

  const loadDistricts = async (names: string[]) => {
    index ??= await loadFacilityIndex()
    if (!index) return
    const wanted = names.filter(name => index?.districts[name] && !loaded.has(name))
    if (!wanted.length) return
    const results = await Promise.all(
      wanted.map(async name => [name, await loadDistrictFacilities(index!.districts[name].file)] as const)
    )
    let changed = false
    for (const [name, features] of results) {
      // a district whose file failed stays unloaded, so the next camera move asks for it again
      if (!features || loaded.has(name)) continue
      loaded.set(name, decorate(name, features) as never)
      changed = true
    }
    if (changed) publish()
  }

  const onMove = () => {
    if (!auto || !districtBounds || map.getZoom() < minzoom - 1) return
    const view = map.getBounds()
    const names = [...districtBounds.entries()]
      .filter(
        ([, [[x0, y0], [x1, y1]]]) =>
          !(x1 < view.getWest() || x0 > view.getEast() || y1 < view.getSouth() || y0 > view.getNorth())
      )
      .map(([name]) => name)
    void loadDistricts(names)
  }
  map.on('moveend', onMove)
  onMove()

  return {
    setGroups: next => {
      groups = next
      for (const id of ['dq-fac-shadow', 'dq-fac-ao', 'dq-fac-glow', 'dq-fac-walls', 'dq-fac-roof'])
        if (map.getLayer(id)) map.setFilter(id, groupFilter(isBuilding))
      map.setFilter('dq-fac-grounds', groupFilter(['==', ['get', 'k'], 'g']))
      map.setFilter(
        'dq-fac-badges',
        groupFilter(['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'dep']]] as FilterSpecification)
      )
      maskBasemap()
    },
    loadDistricts,
    info: props => {
      const id = props.f as string | undefined
      if (!id) return null
      const point = pointOf.get(id)
      if (!point) return null
      return {
        id,
        name: point.properties.n ?? null,
        type: point.properties.t,
        district: districtOfFeature.get(id) ?? '',
        osm: point.properties.o ?? '',
        department: point.properties.dep,
        shape: shapeOf.get(id) ?? null,
      }
    },
    remove: () => {
      alive = false
      map.off('moveend', onMove)
    },
  }
}

export const FACILITY_INTERACTIVE_LAYERS = ['dq-fac-walls', 'dq-fac-roof', 'dq-fac-badges'] as const

/** OSM element URL for a facility card */
export const osmUrl = (key: string) => `https://www.openstreetmap.org/${key}`

// ---- platform departments' footprints ---------------------------------------------------------------

export type DepartmentFootprint = {
  ring: Polygon
  height: number
  /** true when OSM had no single-building outline for it — a modest stand-in block */
  generic: boolean
  matchQuality: string
  /** the OSM building drawn (null for a stand-in) */
  osm: string | null
  /** OSM maps the compound the office stands in (drawn as a tinted plot) */
  site: boolean
}
export type DepartmentFootprints = {
  byId: Map<string, DepartmentFootprint>
  sites: FeatureCollection<Polygon, { id: string }>
  landmarks: FeatureCollection
}

/** the OSM outlines the landmark layers (the ziggurat's terraces) redraw */
export const landmarkKeys = (prints: DepartmentFootprints | null) => [
  ...new Set((prints?.landmarks.features ?? []).map(feature => feature.properties?.osm as string | undefined)),
]

/** reads department-buildings.geojson (built by scripts/geo/fetch-department-footprints.mjs) */
export function parseDepartmentFootprints(data: FeatureCollection<Polygon>): DepartmentFootprints {
  const byId = new Map<string, DepartmentFootprint>()
  const sites: FeatureCollection<Polygon, { id: string }> = { type: 'FeatureCollection', features: [] }
  const landmarks: FeatureCollection = { type: 'FeatureCollection', features: [] }
  const siteIds = new Set<string>()
  for (const feature of data.features) {
    const p = feature.properties ?? {}
    if (p.kind === 'site') {
      sites.features.push({ ...feature, properties: { id: String(p.id) } })
      siteIds.add(String(p.id))
    } else if (p.kind === 'landmark') {
      landmarks.features.push(feature)
    } else if (p.kind === 'building' && !byId.has(String(p.id))) {
      const generic = p.matchQuality === 'generic'
      const osm = !generic && typeof p.osm === 'string' ? p.osm : null
      byId.set(String(p.id), {
        ring: feature.geometry,
        height: Number(p.height) || 12,
        generic,
        matchQuality: String(p.matchQuality),
        osm,
        site: false,
      })
    }
  }
  for (const [id, footprint] of byId) footprint.site = siteIds.has(id)
  return { byId, sites, landmarks }
}

let footprintsPromise: Promise<DepartmentFootprints | null> | null = null
export function loadDepartmentFootprints(): Promise<DepartmentFootprints | null> {
  if (!footprintsPromise) {
    const request: Promise<DepartmentFootprints | null> = fetchJson<FeatureCollection<Polygon>>(BUILDINGS_URL).then(
      data => {
        try {
          if (Array.isArray(data?.features)) return parseDepartmentFootprints(data)
        } catch {
          // unreadable file: treated like a failed request
        }
        if (footprintsPromise === request) footprintsPromise = null
        return null
      }
    )
    footprintsPromise = request
  }
  return footprintsPromise
}

// ---- the basemap's own buildings --------------------------------------------------------------------

/** the OpenFreeMap (OpenMapTiles) extruded massing of every OSM building */
export const BASEMAP_BUILDINGS_LAYER = 'building-3d'

/** numeric OSM id from a key such as `way/123` */
export function osmIdOf(key: string | null | undefined): number | null {
  const match = /^(?:node|way|relation)\/(\d+)$/.exec(key ?? '')
  return match ? Number(match[1]) : null
}

/**
 * Filter that keeps the basemap's extruded buildings except the OSM elements in `ids`. OpenFreeMap's
 * building features carry the OSM id × 10 plus a one-digit suffix, so `floor(id / 10)` is the OSM id
 * (blocks the tiles merged into one feature carry a single member's id, so they cannot all be singled out).
 */
export function basemapBuildingFilter(
  ids: Iterable<number>,
  base: FilterSpecification | null = null
): FilterSpecification | null {
  const list = [...new Set(ids)].sort((a, b) => a - b)
  if (!list.length) return base
  const keep = [
    'match',
    ['floor', ['/', ['to-number', ['id'], 0], 10]],
    list,
    false,
    true,
  ] as unknown as FilterSpecification
  return base ? (['all', base, keep] as FilterSpecification) : keep
}

type BasemapMask = { groups: Map<string, Set<number>>; base: FilterSpecification | null; applied: string }
const basemapMasks = new WeakMap<MapLibreMap, BasemapMask>()

/**
 * Takes the buildings the platform extrudes itself out of the basemap's translucent `building-3d`
 * layer. Left in, that copy (at its own height) is depth-tested against ours and shows as a tan ghost
 * shell around a department, or as a hole in a facility's roof. Each caller owns a `group` and passes the
 * buildings it currently draws, so a building it stops drawing (filtered out) gets its basemap block back.
 */
export function hideBasemapBuildings(map: MapLibreMap, keys: Iterable<string | null | undefined>, group = 'platform') {
  if (!map.getLayer(BASEMAP_BUILDINGS_LAYER)) return
  let mask = basemapMasks.get(map)
  if (!mask) {
    const base = map.getFilter(BASEMAP_BUILDINGS_LAYER) as FilterSpecification | null | undefined
    mask = { groups: new Map(), base: base ?? null, applied: '' }
    basemapMasks.set(map, mask)
  }
  const ids = new Set<number>()
  for (const key of keys) {
    const id = osmIdOf(key)
    if (id !== null) ids.add(id)
  }
  mask.groups.set(group, ids)
  const all = new Set([...mask.groups.values()].flatMap(set => [...set]))
  const signature = [...all].sort((a, b) => a - b).join(',')
  // re-filtering re-lays out the basemap's building tiles: only when the set really changed
  if (signature === mask.applied) return
  mask.applied = signature
  map.setFilter(BASEMAP_BUILDINGS_LAYER, basemapBuildingFilter(all, mask.base))
}

/** a modest square stand-in when a department has no footprint at all */
export function standInSquare(lng: number, lat: number, metres = 24): Polygon {
  const dLat = metres / 2 / 111_320
  const dLng = metres / 2 / (111_320 * Math.cos((lat * Math.PI) / 180))
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lng - dLng, lat - dLat],
        [lng + dLng, lat - dLat],
        [lng + dLng, lat + dLat],
        [lng - dLng, lat + dLat],
        [lng - dLng, lat - dLat],
      ],
    ],
  }
}

/** satellite imagery under every label (hidden until the realistic basemap is chosen) */
export function addSatelliteLayer(map: MapLibreMap, beforeId: string | undefined, visible: boolean) {
  if (!map.getSource('dq-satellite'))
    map.addSource('dq-satellite', {
      type: 'raster',
      tiles: [SATELLITE_TILES],
      tileSize: 256,
      maxzoom: 18,
      attribution: SATELLITE_ATTRIBUTION,
    })
  map.addLayer(
    {
      id: 'dq-satellite',
      type: 'raster',
      source: 'dq-satellite',
      layout: { visibility: visible ? 'visible' : 'none' },
      paint: { 'raster-saturation': -0.08, 'raster-contrast': 0.06, 'raster-fade-duration': 250 },
    },
    beforeId
  )
}
