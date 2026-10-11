// Regression tests for the 3D maps' geo loaders and basemap masking (src/components/maps/realistic-buildings.ts):
// a failed fetch must not be cached for the session, and the basemap's own translucent building-3d copy of a
// building the platform extrudes itself must be filtered out.
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// realistic-buildings only needs `mix` from the MapLibre groundwork (which loads the WebGL worker)
vi.mock('../src/components/maps/maplibre-base', () => ({ mix: (hex: string) => hex }))

type Module = typeof import('../src/components/maps/realistic-buildings')
const load = async (): Promise<Module> => {
  vi.resetModules()
  return import('../src/components/maps/realistic-buildings')
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
const down = () => ({ ok: false, status: 503, json: async () => ({}) }) as Response

const index = {
  generated: '2026-10-10',
  note: '',
  totals: { court: 1 },
  districts: { الغراف: { file: 'gharraf.geojson', total: 1, counts: { court: 1 }, subdistricts: [] } },
}
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
const gharraf = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [46.0005, 31.0005] },
      properties: { f: 'way-1309078566', t: 'court', n: 'محكمة بداءة الغراف', o: 'way/1309078566' },
    },
    {
      type: 'Feature',
      geometry: square(46),
      properties: { f: 'way-1309078566', t: 'court', k: 'b', h: 12, o: 'way/1309078566' },
    },
    { type: 'Feature', geometry: square(46.01), properties: { f: 'node-1', t: 'school', k: 'b', h: 7, g: 1 } },
  ],
}

/** the bits of a MapLibre map the facility layer touches */
function fakeMap(withBasemapBuildings = true) {
  const layers = new Map<string, unknown>(withBasemapBuildings ? [['building-3d', {}]] : [])
  const filters = new Map<string, unknown>()
  const data: unknown[] = []
  const handlers = new Map<string, () => void>()
  const map = {
    addSource: vi.fn(),
    getSource: () => ({ setData: (value: unknown) => data.push(value) }),
    addLayer: (layer: { id: string }) => layers.set(layer.id, layer),
    getLayer: (id: string) => layers.get(id),
    setFilter: (id: string, filter: unknown) => filters.set(id, filter),
    getFilter: (id: string) => filters.get(id),
    on: (event: string, handler: () => void) => handlers.set(event, handler),
    off: vi.fn(),
    getZoom: () => 14,
    getBounds: () => ({ getWest: () => 45, getEast: () => 47, getSouth: () => 30, getNorth: () => 32 }),
  }
  return { map, filters, data }
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('geo loaders retry after a failure', () => {
  it('asks for the facility index again after a network error', async () => {
    const { loadFacilityIndex } = await load()
    fetchMock.mockRejectedValueOnce(new TypeError('network down')).mockResolvedValueOnce(ok(index))
    expect(await loadFacilityIndex()).toBeNull()
    expect((await loadFacilityIndex())?.districts.الغراف.file).toBe('gharraf.geojson')
    // and a good answer is cached
    expect((await loadFacilityIndex())?.totals.court).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('asks for the department footprints again after a 5xx', async () => {
    const { loadDepartmentFootprints } = await load()
    const buildings = JSON.parse(
      readFileSync(join(__dirname, '..', 'public', 'geo', 'department-buildings.geojson'), 'utf8')
    )
    fetchMock.mockResolvedValueOnce(down()).mockResolvedValueOnce(ok(buildings))
    expect(await loadDepartmentFootprints()).toBeNull()
    const prints = await loadDepartmentFootprints()
    expect(prints?.byId.size).toBeGreaterThan(40)
    // real outlines feed the basemap mask; a compound-only department is generic but has its site
    expect(prints?.landmarks.features.length).toBeGreaterThan(0)
    expect(prints?.byId.get('dhi-qar-police-command')).toMatchObject({ generic: true, site: true, osm: null })
    expect(prints?.byId.get('dhiqar-governorate')).toMatchObject({ generic: false, osm: 'way/437260103' })
  })

  it('loads a district whose file failed on the next camera move', async () => {
    const { addFacilityLayers } = await load()
    fetchMock
      .mockResolvedValueOnce(ok(index))
      .mockResolvedValueOnce(down()) // gharraf.geojson, first try
      .mockResolvedValueOnce(ok(gharraf))
    const { map, data } = fakeMap()
    const layer = addFacilityLayers(map as never, { minzoom: 13.2, auto: false })
    await layer.loadDistricts(['الغراف'])
    expect(data).toHaveLength(0)
    await layer.loadDistricts(['الغراف'])
    expect(data).toHaveLength(1)
    expect(layer.info({ f: 'way-1309078566' })?.name).toBe('محكمة بداءة الغراف')
    // loaded once: no more requests
    await layer.loadDistricts(['الغراف'])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('basemap building mask', () => {
  // the exact expression engine MapLibre uses for layer filters
  const styleSpec = createRequire(
    join(realpathSync(join(__dirname, '..', 'node_modules', 'maplibre-gl')), 'package.json')
  )('@maplibre/maplibre-gl-style-spec') as {
    featureFilter: (
      filter: unknown,
      key: string
    ) => { filter: (globals: { zoom: number }, feature: { type: number; id?: number; properties: object }) => boolean }
  }
  const keeps = (filter: unknown, id?: number) =>
    styleSpec.featureFilter(filter, 'layers[0].filter').filter({ zoom: 15 }, { type: 3, id, properties: {} })

  it('drops the OpenMapTiles copies of the given OSM buildings (any type suffix)', async () => {
    const { basemapBuildingFilter, osmIdOf } = await load()
    expect(osmIdOf('way/842567141')).toBe(842567141)
    expect(osmIdOf('relation/12')).toBe(12)
    expect(osmIdOf(null)).toBeNull()
    expect(osmIdOf('generic')).toBeNull()
    const filter = basemapBuildingFilter([842567141, 454868308])
    expect(keeps(filter, 8425671412)).toBe(false) // way 842567141, the sports hall (seen in queryRenderedFeatures)
    expect(keeps(filter, 4548683080)).toBe(false)
    expect(keeps(filter, 4548683092)).toBe(true) // a neighbour
    expect(keeps(filter)).toBe(true) // a feature without an id stays
    expect(basemapBuildingFilter([])).toBeNull()
    // an existing layer filter is kept
    const combined = basemapBuildingFilter([5], ['!=', ['get', 'hide_3d'], true] as never)
    expect(keeps(combined, 52)).toBe(false)
    expect(keeps(combined, 62)).toBe(true)
  })

  it('hides the basemap copies of the facility buildings it draws', async () => {
    const { addFacilityLayers } = await load()
    fetchMock.mockResolvedValueOnce(ok(index)).mockResolvedValueOnce(ok(gharraf))
    const { map, filters } = fakeMap()
    const layer = addFacilityLayers(map as never, { minzoom: 13.2, auto: false })
    await layer.loadDistricts(['الغراف'])
    const filter = filters.get('building-3d')
    expect(keeps(filter, 13090785662)).toBe(false)
    expect(keeps(filter, 13090785672)).toBe(true)
    // courts switched off in the legend: the court is not drawn, so its basemap block comes back
    layer.setGroups(new Set(['schools']))
    expect(keeps(filters.get('building-3d'), 13090785662)).toBe(true)
  })

  it('keeps each caller’s set separate (a department filtered out gets its basemap block back)', async () => {
    const { hideBasemapBuildings } = await load()
    const { map, filters } = fakeMap()
    hideBasemapBuildings(map as never, ['way/1', 'way/2', null], 'departments')
    hideBasemapBuildings(map as never, ['way/3'], 'landmarks')
    expect([12, 22, 32].map(id => keeps(filters.get('building-3d'), id))).toEqual([false, false, false])
    hideBasemapBuildings(map as never, ['way/2'], 'departments')
    expect([12, 22, 32].map(id => keeps(filters.get('building-3d'), id))).toEqual([true, false, false])
  })

  it('leaves a style without building-3d alone', async () => {
    const { hideBasemapBuildings } = await load()
    const { map, filters } = fakeMap(false)
    hideBasemapBuildings(map as never, ['way/1'])
    expect(filters.size).toBe(0)
  })
})
