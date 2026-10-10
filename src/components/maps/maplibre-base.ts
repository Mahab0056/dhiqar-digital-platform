import {
  setWorkerUrl,
  type ExpressionSpecification,
  type LayerSpecification,
  type SkySpecification,
  type StyleSpecification,
} from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Polygon } from 'geojson'

// Shared MapLibre groundwork for the platform's 3D maps: the branded OpenFreeMap style, palettes,
// Arabic labels and small geometry/animation helpers. Only imported by lazily loaded map chunks.

// the worker ships as its own same-origin file (no blob: workers, no CDN)
setWorkerUrl(workerUrl)

/** Free, keyless vector tiles (OpenMapTiles schema, includes building heights). */
export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

/** Fetches the keyless base style (with a timeout) — any failure means "use the 2D fallback". */
export async function fetchBaseStyle(signal: AbortSignal): Promise<StyleSpecification> {
  const timeout = new AbortController()
  const timer = window.setTimeout(() => timeout.abort(), 12_000)
  signal.addEventListener('abort', () => timeout.abort())
  try {
    const response = await fetch(STYLE_URL, { signal: timeout.signal })
    if (!response.ok) throw new Error(`style ${response.status}`)
    return (await response.json()) as StyleSpecification
  } finally {
    window.clearTimeout(timer)
  }
}

/** Arabic labels for MapLibre's own controls and gesture hints. */
export const MAP_LOCALE = {
  'NavigationControl.ZoomIn': 'تكبير',
  'NavigationControl.ZoomOut': 'تصغير',
  'NavigationControl.ResetBearing': 'اسحب لتدوير الخريطة، وانقر للعودة إلى الشمال',
  'FullscreenControl.Enter': 'ملء الشاشة',
  'FullscreenControl.Exit': 'الخروج من ملء الشاشة',
  'AttributionControl.ToggleAttribution': 'إظهار مصادر الخريطة',
  'CooperativeGesturesHandler.WindowsHelpText': 'استخدم Ctrl مع عجلة الفأرة لتكبير الخريطة',
  'CooperativeGesturesHandler.MacHelpText': 'استخدم ⌘ مع عجلة الفأرة لتكبير الخريطة',
  'CooperativeGesturesHandler.MobileHelpText': 'استخدم إصبعين لتحريك الخريطة',
}

export type Palette = Record<
  | 'land'
  | 'sand'
  | 'green'
  | 'residential'
  | 'landuse'
  | 'wetland'
  | 'water'
  | 'waterLine'
  | 'building'
  | 'buildingTop'
  | 'buildingLine'
  | 'casing'
  | 'motorway'
  | 'primary'
  | 'secondary'
  | 'minor'
  | 'path'
  | 'rail'
  | 'boundary'
  | 'text'
  | 'textMuted'
  | 'halo'
  | 'waterText'
  | 'sky'
  | 'horizon'
  | 'fog'
  | 'cluster'
  | 'clusterText'
  | 'clusterStroke'
  | 'selected',
  string
>

// muted sand land, soft water, quiet roads — the departments carry the colour
export const LIGHT: Palette = {
  land: '#f2ede2',
  sand: '#ede3ca',
  green: '#dce8cf',
  residential: '#ebe3d3',
  landuse: '#e8e0cf',
  wetland: '#d6e5da',
  water: '#b3d1e3',
  waterLine: '#a1c4db',
  building: '#e0d7c6',
  buildingTop: '#ebe4d6',
  buildingLine: '#d3c9b6',
  casing: '#ddd1ba',
  motorway: '#f1d9a8',
  primary: '#fbf2e0',
  secondary: '#fdf9f1',
  minor: '#ffffff',
  path: '#e3d8c4',
  rail: '#c9bca3',
  boundary: '#a48f72',
  text: '#3d382c',
  textMuted: '#6d6655',
  halo: '#f8f5ee',
  waterText: '#45718f',
  sky: '#bcd9ea',
  horizon: '#f3eee3',
  fog: '#efe8d9',
  cluster: '#0b7a55',
  clusterText: '#ffffff',
  clusterStroke: 'rgba(255,255,255,0.92)',
  selected: '#f5c451',
}

// night green and Sumerian gold — the platform's dark theme
export const DARK: Palette = {
  land: '#0c1813',
  sand: '#11211a',
  green: '#0f2419',
  residential: '#101e17',
  landuse: '#0f1c16',
  wetland: '#0d231f',
  water: '#0a2531',
  waterLine: '#123a4b',
  building: '#16271f',
  buildingTop: '#1c3127',
  buildingLine: '#21382b',
  casing: '#08110d',
  motorway: '#4b3d1f',
  primary: '#26392f',
  secondary: '#203229',
  minor: '#1b2c24',
  path: '#1b2a22',
  rail: '#2c3e34',
  boundary: '#5c6b5d',
  text: '#e6dfcc',
  textMuted: '#a49e8a',
  halo: '#07110d',
  waterText: '#6ba4be',
  sky: '#030c08',
  horizon: '#163024',
  fog: '#0a1712',
  cluster: '#d6ad58',
  clusterText: '#1a1205',
  clusterStroke: 'rgba(5,15,11,0.9)',
  selected: '#ffd36e',
}

export const isDarkTheme = () => document.documentElement.getAttribute('data-gov-theme') === 'dark'
export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

// layers that add clutter without helping anyone find a government office
const DROPPED_LAYER = /^(poi_|road_one_way_arrow|highway-shield|road_shield|natural_earth|park_outline)/

export type StyleLayer = LayerSpecification & {
  'source-layer'?: string
  paint?: Record<string, unknown>
  layout?: Record<string, unknown>
}

/** Paint overrides that recolour one OpenFreeMap "liberty" layer to the platform palette. */
export function themePaint(layer: StyleLayer, p: Palette): Record<string, unknown> {
  const id = layer.id
  const src = layer['source-layer']
  switch (layer.type) {
    case 'background':
      return { 'background-color': p.land }
    case 'fill':
      if (src === 'water') return { 'fill-color': p.water }
      if (id === 'landcover_sand') return { 'fill-color': p.sand }
      if (id === 'park' || id === 'landcover_grass' || id === 'landcover_wood')
        return { 'fill-color': p.green, 'fill-outline-color': p.green }
      if (id === 'landuse_residential') return { 'fill-color': p.residential }
      if (id === 'landcover_wetland' || id === 'landcover_ice') return { 'fill-color': p.wetland }
      if (id === 'building') return { 'fill-color': p.building, 'fill-outline-color': p.buildingLine }
      if (src === 'landuse' || src === 'aeroway') return { 'fill-color': p.landuse }
      return {}
    case 'fill-extrusion':
      return id === 'building-3d' ? { 'fill-extrusion-color': p.buildingTop } : {}
    case 'line': {
      if (src === 'waterway') return { 'line-color': p.waterLine }
      if (src === 'boundary') return { 'line-color': p.boundary }
      if (src === 'aeroway') return { 'line-color': p.minor }
      if (src !== 'transportation') return {}
      if (id.includes('hatching')) return { 'line-color': p.rail }
      if (id.includes('casing')) return { 'line-color': p.casing }
      if (id.includes('rail')) return { 'line-color': p.rail }
      if (id.includes('path')) return { 'line-color': p.path }
      if (id.includes('motorway')) return { 'line-color': p.motorway }
      if (id.includes('trunk_primary')) return { 'line-color': p.primary }
      if (id.includes('secondary_tertiary')) return { 'line-color': p.secondary }
      return { 'line-color': p.minor }
    }
    case 'symbol': {
      const water = src === 'water_name' || src === 'waterway'
      const minor = src === 'transportation_name'
      return {
        'text-color': water ? p.waterText : minor ? p.textMuted : p.text,
        'text-halo-color': p.halo,
        'text-halo-width': 1.4,
        'text-halo-blur': 0.4,
      }
    }
    default:
      return {}
  }
}

export const skyFor = (p: Palette): SkySpecification => ({
  'sky-color': p.sky,
  'horizon-color': p.horizon,
  'fog-color': p.fog,
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.75,
  'fog-ground-blend': 0.55,
  'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 12, 0],
})

/** Arabic names first (name:ar), falling back to the local name. */
const ARABIC_NAME: ExpressionSpecification = ['coalesce', ['get', 'name:ar'], ['get', 'name']]

export function brandStyle(raw: StyleSpecification, palette: Palette): StyleSpecification {
  const layers = (raw.layers as StyleLayer[])
    .filter(layer => !DROPPED_LAYER.test(layer.id))
    .map(layer => {
      const next: StyleLayer = { ...layer, paint: { ...(layer.paint || {}), ...themePaint(layer, palette) } }
      if (layer.type === 'symbol' && layer.layout?.['text-field'] !== undefined) {
        next.layout = { ...layer.layout, 'text-field': ARABIC_NAME }
      }
      if (layer.id === 'building-3d') {
        // buildings grow out of the ground as the camera descends
        next.minzoom = 13
        next.paint = {
          ...next.paint,
          'fill-extrusion-opacity': 0.88,
          'fill-extrusion-height': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13,
            0,
            14.3,
            ['*', 1.25, ['coalesce', ['get', 'render_height'], 6]],
          ],
          'fill-extrusion-base': [
            'interpolate',
            ['linear'],
            ['zoom'],
            13,
            0,
            14.3,
            ['coalesce', ['get', 'render_min_height'], 0],
          ],
        }
      }
      return next as LayerSpecification
    })
  return {
    ...raw,
    layers,
    sky: skyFor(palette),
    light: { anchor: 'viewport', color: '#ffffff', intensity: 0.38, position: [1.35, 210, 40] },
  }
}

export function hexagon(lng: number, lat: number, radius: number): Polygon {
  const dLat = radius / 111_320
  const dLng = radius / (111_320 * Math.cos((lat * Math.PI) / 180))
  const ring: [number, number][] = []
  for (let i = 0; i <= 6; i++) {
    const a = ((i % 6) * Math.PI) / 3 + Math.PI / 6
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)])
  }
  return { type: 'Polygon', coordinates: [ring] }
}

export function mix(hex: string, toward: string, amount: number) {
  const parse = (value: string) => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16))
  const [a, b] = [parse(hex), parse(toward)]
  return `#${a
    .map((v, i) =>
      Math.round(v + (b[i] - v) * amount)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

export const easeOutBack = (t: number) => {
  const c = 1.45
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}
export const easeInCubic = (t: number) => t * t * t
