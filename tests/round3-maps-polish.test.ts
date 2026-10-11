// Round 3 «maps-polish» regression tests:
//  1. the operations-room district profile can be folded away (and stays folded), a department / facility card takes
//     the profile's column instead of stacking a second panel over the 3D map, at least ~55% of the 1440×900 map
//     stays in view, and neither covers the scale bar;
//  2. a card never passes a generated stand-in block off as the real building (`g: 1` / `matchQuality: 'generic'`);
//  3. every Leaflet map credits OpenStreetMap and loads OSM tiles from the single tile.openstreetmap.org host.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Router } from 'wouter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { departmentShape, SHAPE_NOTE } from '../src/components/maps/building-shape'
import { ShapeNote } from '../src/components/maps/ShapeNote'
import {
  DRILL_COLUMN_INSET,
  DRILL_PANEL_COLLAPSED_KEY,
  drillColumnWidth,
  summarizeDistricts,
  useDrillPanelCollapsed,
  type DistrictProps,
  type OpsDepartment,
  type OpsState,
} from '../src/components/maps/district-data'
import { DistrictProfilePanel } from '../src/components/maps/district-profile'
import { OSM_TILE_ATTRIBUTION, OSM_TILE_URL } from '../src/components/maps/osm-tiles'

// realistic-buildings only needs `mix` from the MapLibre groundwork (which loads the WebGL worker)
vi.mock('../src/components/maps/maplibre-base', () => ({ mix: (hex: string) => hex }))

const root = new URL('../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&copy;/g, '©')
    .replace(/\s+/g, ' ')
    .trim()

// ---- 1. the district profile and the cards on the 3D map -------------------------------------------------------

const department = (id: string, district: string): OpsDepartment =>
  ({
    id,
    name: `دائرة ${id}`,
    type: 'بلديات',
    district,
    lat: 31,
    lng: 46.2,
    status: 'ONLINE',
    transactions: 0,
    completed: 0,
    rejected: 0,
    underReview: 0,
    actionRequired: 0,
    openFeedback: 0,
    overdue: 0,
  }) as OpsDepartment

const boundaries = JSON.parse(read('public/geo/dhiqar-districts.geojson')) as {
  features: { properties: DistrictProps }[]
}
const idle = (): OpsState => 'idle'
const rows = summarizeDistricts(boundaries.features, [department('a', 'الناصرية')], idle)
const nasiriyah = rows.find(row => row.name === 'الناصرية')!

const renderPanel = (extra: { collapsed?: boolean; onToggleCollapsed?: () => void }) =>
  renderToStaticMarkup(
    createElement(Router, {
      ssrPath: '/operations',
      children: createElement(DistrictProfilePanel, {
        district: nasiriyah,
        districts: rows,
        facilityIndex: null,
        services: null,
        variant: 'operations',
        stateOf: idle,
        selectedId: null,
        onSelectDepartment: () => undefined,
        onBack: () => undefined,
        ...extra,
      }),
    })
  )

describe('district profile: a collapse / expand handle', () => {
  it('folds the profile down to its title bar (back button, district name, handle)', () => {
    const html = renderPanel({ collapsed: true, onToggleCollapsed: () => undefined })
    expect(html).toMatch(/class="drill-panel is-collapsed"/)
    const toggle = html.match(/<button[^>]*class="drill-toggle"[^>]*>/)?.[0] ?? ''
    expect(toggle).toContain('aria-expanded="false"')
    const controls = toggle.match(/aria-controls="([^"]+)"/)?.[1]
    expect(controls).toBeTruthy()
    // the handle controls the body, and the body is hidden — not removed — while folded
    expect(html).toMatch(new RegExp(`<div class="drill-body" id="${controls}" hidden=""`))
    expect(text(html)).toContain('قضاء الناصرية')
    expect(text(html)).toContain('إظهار ملف القضاء')
    expect(text(html)).toContain('رجوع للمحافظة')
  })

  it('shows every section when expanded, with the handle saying it folds the profile', () => {
    const html = renderPanel({ collapsed: false, onToggleCollapsed: () => undefined })
    expect(html).not.toContain('is-collapsed')
    expect(html).toMatch(/<button[^>]*class="drill-toggle"[^>]*aria-expanded="true"/)
    expect(html).not.toMatch(/class="drill-body"[^>]*hidden/)
    expect(text(html)).toContain('طيّ ملف القضاء')
    for (const heading of ['السكان والمساحة', 'الجهات في القضاء']) expect(text(html)).toContain(heading)
    // the list rows can be found again when a card hands focus back to the profile
    expect(html).toMatch(/<button[^>]*data-department="a"/)
  })

  it('is wired in the host, which keeps the choice and passes it to the 3D map and the flat fallback', () => {
    const host = read('src/components/operations/DhiQarMap.tsx')
    expect(host).toContain('const [panelCollapsed, togglePanel] = useDrillPanelCollapsed()')
    expect(host).toMatch(/collapsed=\{panelCollapsed\}\s*onToggleCollapsed=\{togglePanel\}/)
    expect(host).toContain('panelCollapsed={panelCollapsed}')
    // folded, the flat map frames the district over the whole map
    expect(host).toMatch(
      /flat\.current\.collapsed\s*\?\s*\{ paddingTopLeft: \[30, top\], paddingBottomRight: \[30, 40\] \}/
    )
    const drill = read('src/components/maps/DistrictDrillMap.tsx')
    expect(drill).toMatch(
      /padding: latest\.current\.panelCollapsed\s*\?\s*\{ top: 70, bottom: 50, left: 50, right: 50 \}/
    )
  })
})

describe('district profile: the folded state is kept per browser', () => {
  const show = () => {
    function Probe() {
      const [collapsed] = useDrillPanelCollapsed()
      return createElement('i', null, collapsed ? 'folded' : 'open')
    }
    return renderToStaticMarkup(createElement(Probe))
  }
  afterEach(() => vi.unstubAllGlobals())

  it('starts folded when the browser remembers it folded', () => {
    const getItem = vi.fn((key: string) => (key === DRILL_PANEL_COLLAPSED_KEY ? '1' : null))
    vi.stubGlobal('window', { localStorage: { getItem, setItem: vi.fn() } })
    expect(show()).toBe('<i>folded</i>')
    expect(getItem).toHaveBeenCalledWith(DRILL_PANEL_COLLAPSED_KEY)
  })

  it('starts open on a first visit, and when storage is blocked (private mode) instead of crashing', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: vi.fn() } })
    expect(show()).toBe('<i>open</i>')
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError')
        },
      },
    })
    expect(show()).toBe('<i>open</i>')
  })

  it('writes every change back, guarded the same way', () => {
    const source = read('src/components/maps/district-data.ts')
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*try \{\s*window\.localStorage\.setItem\(DRILL_PANEL_COLLAPSED_KEY, collapsed \? '1' : '0'\)/
    )
  })
})

describe('the side column leaves most of the map in view (1440×900: the operations map is ~803×600)', () => {
  it('is 38% of the map between 288 and 340px, so over 55% of the map width stays free', () => {
    expect(drillColumnWidth(803)).toBeCloseTo(305.14, 1)
    const free = (803 - drillColumnWidth(803) - DRILL_COLUMN_INSET) / 803
    expect(free).toBeGreaterThan(0.55)
    // the governor's full-width map: the column caps at 340px
    expect(drillColumnWidth(1100)).toBe(340)
    // a small map keeps a readable column, never wider than the map
    expect(drillColumnWidth(720)).toBe(288)
    expect(drillColumnWidth(300)).toBe(272)
  })

  it('covers well under half of the map area at 1440×900, open or replaced by a card', () => {
    // measured on the local build at 1440×900: the stage is 803×600, the toolbar ends 53px down and the
    // bottom-right control stack (attribution, scale bar, compass) takes the lowest 99px
    const stage = { w: 803, h: 600 }
    const column = { w: drillColumnWidth(stage.w), h: stage.h - 53 - 10 - 99 }
    expect((column.w * column.h) / (stage.w * stage.h)).toBeLessThan(0.3)
  })

  it('matches the CSS column (panel and card) to drillColumnWidth()', () => {
    const css = stripComments(read('src/styles/ds/map3d-drill.css'))
    const column = 'width: min(clamp(288px, 38%, 340px), calc(100% - 28px));'
    const rule = (selector: string) => {
      const at = css.indexOf(`${selector} {`)
      return at < 0 ? '' : css.slice(at, css.indexOf('}', at))
    }
    expect(rule('.drill-panel')).toContain(column)
    expect(rule('.map3d-card.drill-card')).toContain(column)
    expect(rule('.drill-panel')).toContain(`inset-inline-start: ${DRILL_COLUMN_INSET}px;`)
    expect(rule('.map3d-card.drill-card')).toContain(`inset-inline-start: ${DRILL_COLUMN_INSET}px;`)
  })
})

describe('a card replaces the profile instead of stacking on it, and nothing covers the scale bar', () => {
  const css = stripComments(read('src/styles/ds/map3d-drill.css'))
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`)
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at))
  }

  it('puts the card in the profile column (below the toolbar, above the bottom-right controls) and scrolls it', () => {
    const card = rule('.map3d-card.drill-card')
    expect(card).toMatch(/inset-block-start: calc\(var\(--gis-toolbar-bottom, 53px\) \+ 10px\);/)
    expect(card).toMatch(/bottom: auto;/)
    expect(card).toMatch(
      /max-height: calc\(100% - var\(--gis-toolbar-bottom, 53px\) - 10px - max\(44px, var\(--gis-attrib-clear, 0px\)\)\);/
    )
    expect(card).toMatch(/overflow-y: auto;/)
  })

  it('hides the profile (keeping its scroll position) while a card has its column', () => {
    expect(css).toMatch(/\.gis-stage:has\(\.drill-card\) \.drill-panel \{\s*visibility: hidden;\s*\}/)
  })

  it('keeps the bottom-sheet card on a narrow map, above the attribution', () => {
    expect(css).toMatch(
      /@container drillmap \(max-width: 640px\) \{\s*\.map3d-card\.drill-card \{\s*inset-block-start: auto;\s*inset-inline: 8px;\s*bottom: max\(44px, var\(--gis-attrib-clear, 0px\)\);\s*width: auto;/
    )
  })

  it('folds the profile to a pill at the top of the column (a bar along the bottom of a narrow map)', () => {
    expect(rule('.drill-panel.is-collapsed')).toMatch(/bottom: auto;/)
    expect(css).toMatch(/\.drill-body\[hidden\] \{\s*display: none;/)
    expect(css).toMatch(
      /@container drill-layer \(max-width: 700px\) \{[\s\S]*?\.drill-panel\.is-collapsed \{\s*bottom: max\(44px, var\(--gis-attrib-clear, 0px\)\);/
    )
  })

  it('measures the whole bottom-right control stack (scale bar and compass included), not just the attribution', () => {
    const host = read('src/components/operations/DhiQarMap.tsx')
    expect(host).toContain("stage.querySelector('.maplibregl-ctrl-bottom-right, .leaflet-bottom.leaflet-right')")
    expect(host).not.toContain("querySelector('.maplibregl-ctrl-attrib, .leaflet-control-attribution')")
    // measured again once the 3D map has added its controls, and whenever that stack resizes
    expect(host).toMatch(/drillApi\.current = api\s*\/\/[^\n]*\n\s*syncControls\.current\(\)/)
    expect(host).toContain('observer.observe(corner)')
    // the scale bar and compass still sit in that corner, on the profile's side
    const drill = read('src/components/maps/DistrictDrillMap.tsx')
    expect(drill).toContain("map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right')")
  })

  it('lets the card hand focus back to the profile row it came from', () => {
    const drill = read('src/components/maps/DistrictDrillMap.tsx')
    expect(drill).toContain('className="map3d-card-back"')
    expect(drill).toContain('ملف قضاء {drill}')
    expect(drill).toMatch(/\.drill-panel \[data-department="\$\{CSS\.escape\(id\)\}"\]/)
  })

  it('flies a picked department into the middle of the map left free by the card column', () => {
    const drill = read('src/components/maps/DistrictDrillMap.tsx')
    expect(drill).toMatch(/\[-Math\.round\(\(drillColumnWidth\(width\) \+ DRILL_COLUMN_INSET\) \/ 2\), -20\]/)
    expect(drill).toMatch(/right: drillColumnWidth\(width\) \+ DRILL_COLUMN_INSET \+ 26/)
  })
})

describe('no gold or brown on the operations map', () => {
  /** hue in degrees and saturation of a #rrggbb colour */
  const hsl = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    const d = max - min
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
    let h = 0
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    return { h: (h * 60 + 360) % 360, s }
  }

  it('draws the population choropleth in greens and teals', () => {
    const drill = read('src/components/maps/DistrictDrillMap.tsx')
    const ramps = [...drill.matchAll(/const POP_RAMP_(?:DARK|LIGHT) = \[([^\]]+)\]/g)].flatMap(match =>
      [...match[1].matchAll(/'(#[0-9a-f]{6})'/gi)].map(color => color[1])
    )
    expect(ramps).toHaveLength(12)
    for (const color of ramps) {
      const { h, s } = hsl(color)
      // amber, gold, ochre and brown all sit between 20° and 60°
      expect(s < 0.2 || h < 20 || h > 60, color).toBe(true)
    }
  })

  it('drops the old gold accent from the map files', () => {
    for (const file of [
      'src/styles/ds/map3d-drill.css',
      'src/components/maps/DistrictDrillMap.tsx',
      'src/components/operations/DhiQarMap.tsx',
    ])
      expect(read(file).toLowerCase(), file).not.toContain('#e2c57f')
  })
})

// ---- 2. generated stand-in buildings are said as such ----------------------------------------------------------

describe('a generated building shape is said as such on every card', () => {
  it('words the note as asked, and keeps the real outline note distinct', () => {
    expect(SHAPE_NOTE.generic).toBe('شكل تقريبي — لا توجد حدود مبنى في OpenStreetMap')
    expect(SHAPE_NOTE.site.startsWith(SHAPE_NOTE.generic)).toBe(true)
    expect(SHAPE_NOTE.osm).not.toContain('تقريبي')
  })

  it('reads a department footprint: none or generic is approximate, a matched OSM outline is real', () => {
    expect(departmentShape(undefined)).toBe('generic')
    expect(departmentShape(null)).toBe('generic')
    expect(departmentShape({ generic: true, site: false })).toBe('generic')
    expect(departmentShape({ generic: true, site: true })).toBe('site')
    expect(departmentShape({ generic: false, site: false })).toBe('osm')
    expect(departmentShape({ generic: false, site: true })).toBe('osm')
  })

  it('reads the shipped department footprints the same way (most are generated stand-ins today)', async () => {
    const { parseDepartmentFootprints } = await import('../src/components/maps/realistic-buildings')
    const prints = parseDepartmentFootprints(JSON.parse(read('public/geo/department-buildings.geojson')))
    expect(departmentShape(prints.byId.get('dhiqar-governorate'))).toBe('osm')
    expect(departmentShape(prints.byId.get('dhi-qar-police-command'))).toBe('site')
    expect(departmentShape(prints.byId.get('shatrah-qaimaqamiya'))).toBe('generic')
    const shapes = [...prints.byId.values()].map(departmentShape)
    expect(shapes.filter(shape => shape !== 'osm').length).toBeGreaterThan(shapes.length / 2)
  })

  it('renders the approximate note framed, with an icon, and the real-outline note plainly', () => {
    const approx = renderToStaticMarkup(createElement(ShapeNote, { shape: 'generic' }))
    expect(approx).toMatch(/class="map3d-card-source map3d-card-shape is-approx"/)
    expect(approx).toContain('<svg')
    expect(text(approx)).toBe(SHAPE_NOTE.generic)
    const real = renderToStaticMarkup(createElement(ShapeNote, { shape: 'osm' }))
    expect(real).not.toContain('is-approx')
    expect(text(real)).toBe(SHAPE_NOTE.osm)
  })

  it('shows the note on both 3D maps: the department card and the facility card', () => {
    const drill = read('src/components/maps/DistrictDrillMap.tsx')
    expect(drill).toContain('<ShapeNote shape={departmentShape(prints?.byId.get(String(selected.id)))} />')
    expect(drill).toContain('{facility.shape && <ShapeNote shape={facility.shape} />}')
    const publicMap = read('src/components/maps/DhiQar3DMap.tsx')
    expect(publicMap).toContain('<ShapeNote shape={departmentShape(selectedPrint)} />')
    expect(publicMap).toContain('{facility.shape && <ShapeNote shape={facility.shape} />}')
    // the old wording that hid the stand-in behind «بعد» is gone
    expect(publicMap).not.toContain('لا يوجد مخطط له في OpenStreetMap بعد')
  })

  it('also styles the note in the map stylesheet', () => {
    expect(read('src/styles/ds/map3d.css')).toMatch(/\.map3d-card p\.map3d-card-shape\.is-approx \{/)
  })
})

describe('facility layer: what building each facility card describes', () => {
  const square = (x: number) => ({
    type: 'Polygon',
    coordinates: [
      [
        [x, 31],
        [x + 0.001, 31],
        [x + 0.001, 31.001],
        [x, 31.001],
        [x, 31],
      ],
    ],
  })
  const point = (x: number) => ({ type: 'Point', coordinates: [x + 0.0005, 31.0005] })
  const index = {
    generated: '2026-10-10',
    note: '',
    totals: { court: 1, school: 1, clinic: 1, police: 1 },
    districts: { الغراف: { file: 'gharraf.geojson', total: 4, counts: {}, subdistricts: [] } },
  }
  const gharraf = {
    type: 'FeatureCollection',
    features: [
      // a real OSM building
      { type: 'Feature', geometry: point(46), properties: { f: 'court-1', t: 'court', n: 'محكمة', o: 'way/1' } },
      { type: 'Feature', geometry: square(46), properties: { f: 'court-1', t: 'court', k: 'b', h: 12, o: 'way/1' } },
      // a generated stand-in block (g: 1)
      { type: 'Feature', geometry: point(46.01), properties: { f: 'school-1', t: 'school', o: 'node/2' } },
      { type: 'Feature', geometry: square(46.01), properties: { f: 'school-1', t: 'school', k: 'b', h: 7, g: 1 } },
      // a campus: real outlines win over anything else
      { type: 'Feature', geometry: point(46.02), properties: { f: 'clinic-1', t: 'clinic', o: 'way/3' } },
      {
        type: 'Feature',
        geometry: square(46.02),
        properties: { f: 'clinic-1', t: 'clinic', k: 'b', h: 9, o: 'way/4' },
      },
      { type: 'Feature', geometry: square(46.03), properties: { f: 'clinic-1', t: 'clinic', k: 'g' } },
      // no building of its own (it shares one already drawn)
      { type: 'Feature', geometry: point(46.04), properties: { f: 'police-1', t: 'police', o: 'node/5' } },
    ],
  }
  const fakeMap = () => {
    const layers = new Map<string, unknown>()
    return {
      addSource: vi.fn(),
      getSource: () => ({ setData: vi.fn() }),
      addLayer: (layer: { id: string }) => layers.set(layer.id, layer),
      getLayer: (id: string) => layers.get(id),
      setFilter: vi.fn(),
      getFilter: () => undefined,
      on: vi.fn(),
      off: vi.fn(),
      getZoom: () => 14,
      getBounds: () => ({ getWest: () => 45, getEast: () => 47, getSouth: () => 30, getNorth: () => 32 }),
    }
  }
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ok(String(url).endsWith('index.json') ? index : gharraf))
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('tells a real OSM outline from a generated block, and says nothing when the facility has none', async () => {
    const { addFacilityLayers } = await import('../src/components/maps/realistic-buildings')
    const handle = addFacilityLayers(fakeMap() as never, { minzoom: 13.2, auto: false })
    await handle.loadDistricts(['الغراف'])
    expect(handle.info({ f: 'court-1' })).toMatchObject({ name: 'محكمة', district: 'الغراف', shape: 'osm' })
    expect(handle.info({ f: 'school-1' })).toMatchObject({ type: 'school', shape: 'generic' })
    expect(handle.info({ f: 'clinic-1' })?.shape).toBe('osm')
    expect(handle.info({ f: 'police-1' })?.shape).toBeNull()
    expect(handle.info({ f: 'missing' })).toBeNull()
    handle.remove()
  })

  it('agrees with the shipped facility files: every `g: 1` block is a generated stand-in', () => {
    const files = readdirSync(new URL('public/geo/facilities/', root)).filter(name => name.endsWith('.geojson'))
    let standIns = 0
    for (const name of files) {
      const features = JSON.parse(read(`public/geo/facilities/${name}`)).features as {
        properties: { k?: string; g?: number; o?: string }
      }[]
      for (const feature of features.filter(item => item.properties.k === 'b')) {
        if (feature.properties.g) {
          standIns++
          // a stand-in has no OSM building to point at
          expect(feature.properties.o, name).toBeUndefined()
        }
      }
    }
    expect(standIns).toBeGreaterThan(0)
  })
})

// ---- 3. Leaflet maps: one OSM tile host and the OSM credit -----------------------------------------------------

describe('every Leaflet map credits OpenStreetMap and uses tile.openstreetmap.org', () => {
  const sources = (dir: string): string[] =>
    readdirSync(new URL(dir, root)).flatMap(name => {
      const path = join(dir, name).replace(/\\/g, '/')
      return statSync(new URL(path, root)).isDirectory()
        ? sources(`${path}/`)
        : /\.(tsx?|css)$/.test(name)
          ? [path]
          : []
    })

  it('uses the single, current tile host', () => {
    expect(OSM_TILE_URL).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
    for (const file of sources('src/')) {
      const source = read(file)
      expect(source, file).not.toMatch(/\{s\}\.tile\.openstreetmap\.org/)
      expect(source, file).not.toMatch(/[abc]\.tile\.openstreetmap\.org/)
    }
  })

  it('credits «© OpenStreetMap contributors» with a link to the copyright page', () => {
    expect(text(OSM_TILE_ATTRIBUTION)).toBe('© OpenStreetMap contributors')
    expect(OSM_TILE_ATTRIBUTION).toContain('href="https://www.openstreetmap.org/copyright"')
  })

  it('gives every OSM tile layer the shared URL and attribution', () => {
    for (const file of [
      'src/pages/public/DepartmentPublicPage.tsx',
      'src/components/maps/DepartmentsLeafletMap.tsx',
      'src/components/maps/LocationPicker.tsx',
    ]) {
      const source = read(file)
      const layers = source.match(/<TileLayer\b[^>]*\/>/g) ?? []
      expect(layers, file).toHaveLength(1)
      expect(layers[0], file).toContain('attribution={OSM_TILE_ATTRIBUTION}')
      expect(layers[0], file).toContain('url={OSM_TILE_URL}')
      expect(source, file).toMatch(/import \{ OSM_TILE_ATTRIBUTION, OSM_TILE_MAX_ZOOM, OSM_TILE_URL \} from '/)
    }
  })

  it('credits OpenStreetMap on every basemap of the operations map (the district outlines are OSM data)', () => {
    const host = read('src/components/operations/DhiQarMap.tsx')
    const block = host.slice(host.indexOf('const BASEMAPS = {'), host.indexOf('} as const'))
    const attributions = [...block.matchAll(/attribution: ([^\n]+),\n/g)].map(match => match[1])
    expect(attributions).toHaveLength(3)
    for (const attribution of attributions) expect(attribution).toMatch(/OSM_TILE_ATTRIBUTION|BOUNDARIES_ATTRIBUTION/)
    expect(host).toMatch(/const BOUNDARIES_ATTRIBUTION = `[^`]*\$\{OSM_TILE_ATTRIBUTION\}[^`]*`/)
    expect(block).toContain('url: OSM_TILE_URL')
    // the base layer carries the credit; it is never switched off
    expect(host).toMatch(/<TileLayer\s+key=\{basemap\}\s+url=\{tiles\.url\}\s+attribution=\{tiles\.attribution\}/)
    expect(host).not.toContain('attributionControl={false}')
  })

  it('keeps the attribution visible: no Leaflet map hides its attribution control', () => {
    for (const file of sources('src/').filter(path => path.endsWith('.css'))) {
      const css = stripComments(read(file))
      expect(css, file).not.toMatch(/\.leaflet-control-attribution[^{]*\{[^}]*display:\s*none/)
    }
    for (const file of sources('src/').filter(path => path.endsWith('.tsx')))
      expect(read(file), file).not.toMatch(/<MapContainer[^>]*attributionControl=\{false\}/)
  })
})
