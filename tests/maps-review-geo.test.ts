// Regression tests for the 3D maps' OpenStreetMap data (scripts/geo/*.mjs → public/geo/**):
// whole compounds must not be extruded as solid buildings, and a place mapped twice must be counted and
// drawn once.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isBuildingOutline,
  isCompoundOutline,
  rectangle,
  rectangularity,
  ringArea,
  ringsOverlap,
  sameName,
} from '../scripts/geo/osm-utils.mjs'

type Ring = [number, number][]
type GeoFeature = {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] } | { type: 'Polygon'; coordinates: Ring[] }
  properties: Record<string, unknown>
}

const GEO = join(__dirname, '..', 'public', 'geo')
const read = (file: string) => JSON.parse(readFileSync(join(GEO, file), 'utf8'))
const index = read('facilities/index.json') as {
  totals: Record<string, number>
  districts: Record<string, { file: string; total: number; counts: Record<string, number> }>
}
const districtFeatures = Object.fromEntries(
  Object.entries(index.districts).map(([name, d]) => [name, read(`facilities/${d.file}`).features as GeoFeature[]])
) as Record<string, GeoFeature[]>
const facilityFeatures = Object.values(districtFeatures).flat()
const departmentFeatures = read('department-buildings.geojson').features as GeoFeature[]

const ringOf = (feature: GeoFeature) => (feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0] : [])
const facilityBuildings = facilityFeatures.filter(feature => feature.properties.k === 'b')
const pointOf = (id: string) =>
  facilityFeatures.find(feature => feature.geometry.type === 'Point' && feature.properties.f === id)

describe('osm-utils: one building or a whole compound', () => {
  const ref = { lng: 46.24, lat: 31.05 }
  const rect = (w: number, d: number) => rectangle(ref.lng, ref.lat, w, d, 0.3) as Ring

  it('measures how rectangular an outline is', () => {
    expect(rectangularity(rect(60, 40))).toBeCloseTo(1, 2)
    // an L-shaped wing: three quarters of its bounding rectangle
    const m = 1 / 111_320
    const k = 1 / (111_320 * Math.cos((ref.lat * Math.PI) / 180))
    const l: Ring = [
      [0, 0],
      [80, 0],
      [80, 40],
      [40, 40],
      [40, 80],
      [0, 80],
      [0, 0],
    ].map(([x, y]) => [ref.lng + x * k, ref.lat + y * m])
    expect(rectangularity(l)).toBeCloseTo(0.75, 1)
    expect(ringArea(l)).toBeGreaterThan(4_700)
    // a detailed, irregular outline over the plot threshold is still a building…
    expect(isCompoundOutline(l)).toBe(false)
    expect(isBuildingOutline({ building: 'office' }, l)).toBe(true)
  })

  it('treats a plain rectangle above 2,500 m² and anything above 10,000 m² as a compound', () => {
    expect(isCompoundOutline(rect(40, 30))).toBe(false)
    expect(isCompoundOutline(rect(60, 59))).toBe(true) // 3,540 m² walled plot traced as building=yes
    expect(isCompoundOutline(rect(146, 75))).toBe(true)
    expect(isBuildingOutline({ building: 'yes' }, rect(40, 30))).toBe(true)
    expect(isBuildingOutline({ building: 'yes' }, rect(60, 59))).toBe(false)
  })

  it('never extrudes an outline without building=*', () => {
    expect(isBuildingOutline({ amenity: 'school' }, rect(30, 20))).toBe(false)
    expect(isBuildingOutline({ office: 'government' }, rect(30, 20))).toBe(false)
    expect(isBuildingOutline({ building: 'no', amenity: 'school' }, rect(30, 20))).toBe(false)
  })

  it('folds Arabic spelling variants when comparing names', () => {
    expect(sameName('مديرية الجنسية في ذي قار', 'مديرية الجنسيه في ذي قار')).toBe(true)
    expect(sameName('مدرسة الحجاز', 'مدرسة الحجاز الابتدائية')).toBe(true)
    expect(sameName('مدرسة الياقوت', 'مدرسة الافاق')).toBe(false)
    expect(sameName('', 'مدرسة')).toBe(false)
  })

  it('detects overlapping footprints', () => {
    const a = rectangle(46.24, 31.05, 30, 20, 0) as Ring
    expect(ringsOverlap(a, rectangle(46.2401, 31.05, 30, 20, 0.5) as Ring)).toBe(true)
    expect(ringsOverlap(a, rectangle(46.24, 31.05, 10, 8, 0) as Ring)).toBe(true) // inside
    expect(ringsOverlap(a, rectangle(46.2408, 31.05, 30, 20, 0) as Ring)).toBe(false) // ~75 m away
  })
})

describe('generated facility and department files', () => {
  it('extrudes no compound outline as a facility building', () => {
    const solid = facilityBuildings.filter(feature => !feature.properties.g)
    expect(solid.length).toBeGreaterThan(50)
    const compounds = solid.filter(feature => isCompoundOutline(ringOf(feature)))
    expect(compounds.map(feature => feature.properties.f)).toEqual([])
  })

  it('draws the compounds seen at the government quarter as grounds, not solid blocks', () => {
    // townhall compound (9,770 m²: hall, courtyard, garden and pool) and the sports centre (12,736 m²)
    for (const [id, outline] of [
      ['way-454868308', 'way/454868308'],
      ['way-400479847', 'way/400479847'],
      ['way-469435139', 'way/469435139'],
    ]) {
      const own = facilityFeatures.filter(feature => feature.properties.f === id)
      expect(own.some(feature => feature.properties.k === 'g')).toBe(true)
      for (const building of own.filter(feature => feature.properties.k === 'b')) {
        expect(building.properties.o).not.toBe(outline)
        expect(ringArea(ringOf(building))).toBeLessThan(2_500)
      }
    }
    // the sports centre's real hall, mapped inside its compound
    expect(
      facilityFeatures.some(
        feature => feature.properties.f === 'way-400479847' && feature.properties.o === 'way/842567141'
      )
    ).toBe(true)
  })

  it('keeps department buildings to single-building outlines', () => {
    const buildings = departmentFeatures.filter(feature => feature.properties.kind === 'building')
    for (const building of buildings.filter(feature => feature.properties.matchQuality !== 'generic'))
      expect(isCompoundOutline(ringOf(building)), String(building.properties.id)).toBe(false)
    const police = buildings.find(feature => feature.properties.id === 'dhi-qar-police-command')!
    expect(police.properties.osm).not.toBe('way/849963540') // 18,296 m² compound
    expect(police.properties.site).toBe('way/849963540')
    const qaimaqamiya = buildings.find(feature => feature.properties.id === 'nasiriyah-qaimaqamiya')!
    expect(qaimaqamiya.properties.osm).not.toBe('way/467613160') // office:government plot, no building=*
    expect(
      departmentFeatures.some(
        feature =>
          feature.properties.kind === 'site' &&
          feature.properties.id === 'nasiriyah-qaimaqamiya' &&
          feature.properties.osm === 'way/467613160'
      )
    ).toBe(true)
  })

  it('emits a place mapped twice (outline and point) once', () => {
    // the Gharraf court, the Fajr municipality and the National Card office: one facility each
    expect(pointOf('way-1309078566')).toBeTruthy()
    expect(pointOf('node-9859777217')).toBeUndefined()
    expect(pointOf('way-467389251')).toBeTruthy()
    expect(pointOf('node-4610464411')).toBeUndefined()
    // the merged outline keeps the point's name
    expect(pointOf('way-467389251')!.properties.n).toBe('مديرية بلدية الفجر')
  })

  it('never draws two facility footprints on the same ground', () => {
    const rings = facilityBuildings.map(feature => ({ id: feature.properties.f as string, ring: ringOf(feature) }))
    const clashes: string[] = []
    for (let i = 0; i < rings.length; i++)
      for (let j = i + 1; j < rings.length; j++)
        if (rings[i].id !== rings[j].id && ringsOverlap(rings[i].ring, rings[j].ring))
          clashes.push(`${rings[i].id} × ${rings[j].id}`)
    expect(clashes).toEqual([])
  })

  it('counts each facility once in the totals and the district bars', () => {
    const sum = (record: Record<string, number>) => Object.values(record).reduce((a, b) => a + b, 0)
    let points = 0
    for (const [name, district] of Object.entries(index.districts)) {
      const own = districtFeatures[name].filter(feature => feature.geometry.type === 'Point')
      expect(own.length, name).toBe(district.total)
      expect(sum(district.counts), name).toBe(district.total)
      points += own.length
    }
    expect(sum(index.totals)).toBe(points)
    const ids = facilityFeatures
      .filter(feature => feature.geometry.type === 'Point')
      .map(feature => feature.properties.f)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('names the OSM building behind every real facility footprint (to hide the basemap copy)', () => {
    for (const building of facilityBuildings)
      if (!building.properties.g) expect(String(building.properties.o)).toMatch(/^(way|relation)\/\d+$/)
  })
})

describe('generated files list', () => {
  it('has one geojson per district in the index', () => {
    const files = readdirSync(join(GEO, 'facilities')).filter(file => file.endsWith('.geojson'))
    expect(files.sort()).toEqual(
      Object.values(index.districts)
        .map(d => d.file)
        .sort()
    )
  })
})
