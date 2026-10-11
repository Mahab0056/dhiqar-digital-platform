// Regression tests for the district drill-down of the operations room and the governor dashboard
// (src/components/maps/district-profile.tsx + district-data.ts, DistrictDrillMap, operations/DhiQarMap,
// map3d-drill.css):
// one district count everywhere, approximate areas labelled as such, a district profile that also exists in the
// flat (no-WebGL) fallback, and a panel that never sits under the legend or the toolbar.
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Router } from 'wouter'
import { describe, expect, it } from 'vitest'
import {
  DISTRICT_FACTS,
  districtKey,
  districtsWithDepartments,
  GOVERNORATE_AREA,
  OFFICIAL_DISTRICT_COUNT,
} from '../src/components/maps/dhiqar-district-facts'
import { summarizeDistricts, type DistrictProps, type OpsDepartment } from '../src/components/maps/district-data'
import { DistrictPicker, DistrictProfilePanel } from '../src/components/maps/district-profile'
import type { FacilityIndex } from '../src/components/maps/facility-catalog'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

const boundaries = JSON.parse(read('public/geo/dhiqar-districts.geojson')) as {
  features: { properties: DistrictProps }[]
}
const registry = JSON.parse(read('server/registry/dhiqar-departments.json')) as { district: string }[]

const department = (id: string, district: string, extra: Partial<OpsDepartment> = {}): OpsDepartment =>
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
    ...extra,
  }) as OpsDepartment

describe('district count: the 15 official districts, and the «on the platform» figure said as such', () => {
  it('counts the 15 census districts, and the boundary layer draws exactly those', () => {
    expect(OFFICIAL_DISTRICT_COUNT).toBe(15)
    const drawn = boundaries.features.filter(f => f.properties.kind === 'district').map(f => f.properties.name)
    expect(new Set(drawn)).toEqual(new Set(Object.keys(DISTRICT_FACTS)))
  })

  it('counts the districts that have registry departments separately (14 today: none in كرمة بني سعد yet)', () => {
    expect(districtsWithDepartments(registry)).toBe(14)
    // sub-district and spelling variants fold into their district instead of inflating the count
    expect(districtsWithDepartments([{ district: 'أور' }, { district: 'الناصرية' }, { district: 'سوق الشيخ' }])).toBe(2)
    expect(districtsWithDepartments([{ district: 'غير معروف' }])).toBe(0)
  })

  it('shows 15 on the homepage hero and names the platform figure explicitly', () => {
    const landing = read('src/components/home/Landing.tsx')
    expect(landing).not.toContain('قضاء ضمن المنصة')
    expect(landing).toMatch(/value: OFFICIAL_DISTRICT_COUNT/)
    expect(landing).toContain('بها دوائر على المنصة')
    const portal = read('src/components/home/Portal.tsx')
    expect(portal).not.toMatch(/departments\.districts\.length\} قضاءً/)
    expect(portal).toContain('من أقضية المحافظة الـ${OFFICIAL_DISTRICT_COUNT}')
  })

  it('shows the official count in the GIS «أقضية» counter (not the loaded boundary count, which starts at 0)', () => {
    const host = read('src/components/operations/DhiQarMap.tsx')
    expect(host).toMatch(/<dt>أقضية<\/dt>\s*<dd>\{OFFICIAL_DISTRICT_COUNT/)
    expect(host).toContain('بها دوائر على المنصة')
    expect(host).not.toMatch(/districts\?\.features\.length \|\| 0/)
  })

  it('rolls the flat map up by the 15-district boundaries (النصر and البطحاء are districts, not sub-districts)', () => {
    const host = stripComments(read('src/components/operations/DhiQarMap.tsx'))
    expect(host).not.toContain('DISTRICT_PARENT')
    expect(host).toContain('districtKey(department.district)')
    expect(districtKey('النصر')).toBe('النصر')
    expect(districtKey('البطحاء')).toBe('البطحاء')
    expect(districtKey('أور')).toBe('الناصرية')
  })
})

describe('district profile (shared by the 3D map and the flat fallback)', () => {
  const rows = summarizeDistricts(
    boundaries.features,
    [
      department('a', 'الناصرية', { underReview: 2, actionRequired: 1, overdue: 1, transactions: 10, completed: 4 }),
      department('b', 'أور', { lat: null, lng: null }),
      department('c', 'الجبايش'),
    ],
    item => (item.id === 'c' ? 'alert' : 'idle')
  )

  it('rolls departments up per district, folding sub-districts, most populous first', () => {
    expect(rows).toHaveLength(15)
    expect(rows[0].name).toBe('الناصرية')
    expect(rows[0].departments.map(item => item.id)).toEqual(['a', 'b'])
    expect(rows[0]).toMatchObject({ mapped: 1, open: 3, overdue: 1, transactions: 10, completed: 4, areaKm2: 838 })
    expect(rows.find(row => row.name === 'الجبايش')?.alerts).toBe(1)
    expect(rows.find(row => row.name === 'البطحاء')?.formerParent).toBe('الناصرية')
  })

  const index: FacilityIndex = {
    generated: '2026-10-10',
    note: '',
    totals: {},
    districts: {
      الناصرية: {
        file: 'nasiriyah.geojson',
        total: 7,
        counts: { hospital: 2, school: 5 },
        subdistricts: [{ name: 'أور', centre: false, osm: 'relation/1' }],
      },
    },
  }
  const render = (facilityIndex: FacilityIndex | null) =>
    renderToStaticMarkup(
      createElement(
        Router,
        { ssrPath: '/operations' },
        createElement(DistrictProfilePanel, {
          district: rows[0],
          districts: rows,
          facilityIndex,
          services: new Map([['a', 3]]),
          variant: 'operations',
          stateOf: () => 'idle',
          selectedId: null,
          onSelectDepartment: () => undefined,
          onBack: () => undefined,
        })
      )
    )

  it('labels areas as approximate from simplified boundaries, next to the official, sourced governorate area', () => {
    const html = render(index)
    expect(text(html)).toContain('تقريبية من حدود مبسّطة')
    expect(GOVERNORATE_AREA.km2).toBe(12_900)
    expect(GOVERNORATE_AREA.sourceUrl).toMatch(/^https:\/\/cosit\.gov\.iq\//)
    expect(text(html)).toContain('12,900 كم²')
    expect(html).toContain(`href="${GOVERNORATE_AREA.sourceUrl}"`)
    // the simplified boundaries really do not add up to the official figure — hence «approximate»
    const measured = rows.reduce((sum, row) => sum + (row.areaKm2 || 0), 0)
    expect(Math.abs(measured - GOVERNORATE_AREA.km2)).toBeGreaterThan(500)
  })

  it('renders every section: population, units, facilities, platform KPIs, departments with the colour key', () => {
    const page = text(render(index))
    for (const heading of ['السكان والمساحة', 'الوحدات الإدارية', 'المرافق العامة', 'على المنصة', 'الجهات في القضاء'])
      expect(page).toContain(heading)
    expect(page).toContain('ناحية أور')
    expect(page).toContain('7 مرفقاً مرسوماً')
    expect(page).toContain('(1 على الخريطة)')
    // the map legend collapses while a district is open: its key is repeated in the panel
    expect(page).toContain('لا طلبات مفتوحة')
    expect(page).toContain('بلا موظف مفعّل')
    // a department without official coordinates cannot be flown to
    expect(render(index)).toMatch(/<button[^>]*disabled=""[^>]*title="بانتظار إحداثيات رسمية"/)
  })

  it('says «loading», not «unavailable», while the facility index is still on its way', () => {
    expect(text(render(null))).toContain('جارٍ التحميل…')
  })

  it('offers every district in the picker, under the official count', () => {
    const html = renderToStaticMarkup(
      createElement(DistrictPicker, { value: null, districts: rows, onChange: () => {} })
    )
    expect(html.match(/<option/g)).toHaveLength(16)
    expect(text(html)).toContain('كل المحافظة (15 قضاءً)')
  })

  it('keeps the profile and its data maplibre-free, so the no-WebGL fallback never loads the 3D chunk', () => {
    for (const file of [
      'src/components/maps/district-profile.tsx',
      'src/components/maps/district-data.ts',
      'src/components/maps/facility-catalog.ts',
      'src/components/maps/dhiqar-district-facts.ts',
    ]) {
      // type-only imports are erased at build time; a value import would pull the MapLibre chunk
      const source = read(file)
      expect(source, file).not.toMatch(
        /^import (?!type )[^\n]*from '(maplibre-gl|\.\/maplibre-base|\.\/realistic-buildings|\.\/DistrictDrillMap)'/m
      )
    }
    expect(read('src/components/maps/facility-catalog.ts')).toMatch(
      /^import type \{ IconKey \} from '\.\/realistic-buildings'/
    )
    const host = read('src/components/operations/DhiQarMap.tsx')
    expect(host).not.toMatch(
      /^import (?!type)[^\n]*from '\.\.\/maps\/(DistrictDrillMap|realistic-buildings|maplibre-base)'/m
    )
    expect(host).toContain("lazy(() => import('../maps/DistrictDrillMap'))")
  })

  it('renders the picker and the panel in the host for both modes, with the 3D map driven by the host', () => {
    const host = read('src/components/operations/DhiQarMap.tsx')
    const drill = read('src/components/maps/DistrictDrillMap.tsx')
    // one picker in the toolbar, one panel in the stage — outside the `mode === '3d'` branch
    expect(host).toMatch(/className="gis-toolbar"[\s\S]*<DistrictPicker[\s\S]*<\/div>\s*\n\s*<div className="gis-zoom"/)
    expect(host).toMatch(/<div className="drill-layer">\s*<DistrictProfilePanel/)
    expect(host).toMatch(/drill=\{district\}\s*onDrillChange=\{setDistrict\}/)
    // the flat map opens a district on click and frames it clear of the panel
    expect(host).toContain('click: () => setDistrict(name)')
    expect(host).toMatch(/paddingBottomRight: \[380, 40\]/)
    expect(drill).not.toContain('className="drill-panel"')
    expect(drill).not.toContain('className="drill-picker"')
    expect(drill).not.toMatch(/useState<string \| null>\(null\)\s*\n\s*const \[hover/)
  })
})

describe('district panel layout (map3d-drill.css)', () => {
  const css = stripComments(read('src/styles/ds/map3d-drill.css'))
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`)
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at))
  }

  it('drops the leftover walnut for brand green-ink tokens', () => {
    expect(css.toLowerCase()).not.toContain('#8a5a2b')
    expect(rule('.gis-shell.is-light .drill-panel')).toMatch(/--drill-accent: var\(--green-700\)/)
  })

  it('collapses the legend while a district is open, so the panel never sits under it', () => {
    expect(css).toMatch(/\.gis-stage:has\(\.drill-panel\) \.gis-legend \{\s*display: none;/)
  })

  it('scrolls the panel inside the map: below the measured toolbar, above the measured attribution', () => {
    const panel = rule('.drill-panel')
    expect(panel).toMatch(/top: calc\(var\(--gis-toolbar-bottom, \d+px\) \+ \d+px\)/)
    expect(panel).toMatch(/bottom: max\(44px, var\(--gis-attrib-clear, 0px\)\)/)
    expect(panel).toMatch(/overflow-y: auto/)
    // above Leaflet's panes and control corners (z-index 400 / 1000), so the fallback cannot cover it
    expect(Number(rule('.drill-layer').match(/z-index: (\d+)/)?.[1])).toBeGreaterThan(1000)
  })

  it('keeps the picker in the toolbar flow (no absolute position that could overlap «المعالم»)', () => {
    expect(rule('.drill-picker')).not.toMatch(/position:\s*absolute/)
    expect(css).toMatch(/@container \(max-width: 860px\) \{\s*\.gis-zoom \{\s*top: calc\(var\(--gis-toolbar-bottom/)
  })

  it('turns the panel into a bottom sheet on a narrow map and hides the zoom column under it on phones', () => {
    expect(css).toMatch(/@container drill-layer \(max-width: 700px\) \{\s*\.drill-panel \{\s*top: auto;/)
    expect(css).toMatch(
      /\.gis-stage:has\(\.drill-panel, \.drill-card\) :is\(\.gis-zoom, \.gis-legend\) \{\s*display: none;/
    )
  })

  it('lifts the 3D attribution above the legend despite maplibre-gl.css being unlayered', () => {
    expect(css).toMatch(
      /\.maplibregl-ctrl-bottom-right, \.maplibregl-ctrl-bottom-left\) \{\s*bottom: var\(--gis-legend-clear, 52px\) !important;/
    )
  })

  it('gives the governor map a full-width row on desktop', () => {
    expect(css).toMatch(
      /@media \(min-width: 1200px\) \{\s*\.governor-grid > \.governor-map-card,\s*\.governor-grid > \.executive-alerts \{\s*grid-column: 1 \/ -1;/
    )
  })
})
