#!/usr/bin/env node
// Offline build step: matches every department that has verified coordinates to its real building
// footprint in OpenStreetMap and writes public/geo/department-buildings.geojson.
//
//   node scripts/geo/fetch-department-footprints.mjs            (re-uses the cached Overpass answer)
//   node scripts/geo/fetch-department-footprints.mjs --refresh  (asks Overpass again)
//
// One batched Overpass request: buildings and office/amenity outlines `around` each department, plus the
// exact OSM elements cited in each department's sourceUrl; then one more for the buildings inside the
// compounds the departments stand in. Only an outline the size of one building is extruded: a walled
// compound or an office plot becomes the department's site, with its largest building (or a modest,
// clearly approximate stand-in) on it. Data © OpenStreetMap contributors, ODbL 1.0 (credited in
// public/geo/ATTRIBUTION.txt and on the map).
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  arabicName,
  buildingsInsideQuery,
  cachedOverpass,
  centroid,
  contains,
  distanceTo,
  hash,
  isBuildingOutline,
  isCompoundOutline,
  longestEdgeAngle,
  rectangle,
  ringArea,
  ringOf,
  ROOT,
  round,
  scaleRing,
} from './osm-utils.mjs'

const REGISTRY = join(ROOT, 'server', 'registry', 'dhiqar-departments.json')
const OUT = join(ROOT, 'public', 'geo', 'department-buildings.geojson')
const RADIUS_M = 80
const UR = { lat: 30.9627, lng: 46.1031 }

// ---- heights -------------------------------------------------------------------------------------
const CATEGORY_HEIGHT = {
  'حكومة محلية': 15,
  بلديات: 10,
  صحة: 20,
  'تربية وتعليم': 12,
  'تعليم عالي': 14,
  قضاء: 12,
  'أمن وشرطة': 11,
  'أحوال مدنية وجوازات': 10,
  'ضرائب ومالية': 12,
  تقاعد: 10,
  'نفط وطاقة': 14,
  'آثار وسياحة': 9,
  'اتصالات وبريد': 12,
  'موارد مائية': 11,
}
export function heightFrom(tags, fallback, id) {
  const tagged = parseFloat(String(tags.height ?? '').replace(/[^\d.]/g, ''))
  if (tagged > 2 && tagged < 120) return { height: round(tagged, 1), levels: null, source: 'osm-height' }
  const levels = parseInt(String(tags['building:levels'] ?? ''), 10)
  if (levels > 0 && levels < 40) return { height: round(levels * 3.2 + 1.2, 1), levels, source: 'osm-levels' }
  // type default with a small, stable per-building variation (±1.5 m)
  return { height: fallback + ((hash(id) % 7) - 3) * 0.5, levels: null, source: 'default' }
}

// ---- department ↔ OSM element hints --------------------------------------------------------------
/** OSM element cited by a department's sourceUrl (openstreetmap.org, mapcarta W/N, nominatim details) */
function cited(url) {
  let m = /openstreetmap\.org\/(way|node|relation)\/(\d+)/.exec(url)
  if (m) return { type: m[1], id: Number(m[2]) }
  m = /mapcarta\.com\/([WNR])(\d+)/.exec(url)
  if (m) return { type: { W: 'way', N: 'node', R: 'relation' }[m[1]], id: Number(m[2]) }
  m = /osmtype=([WNR])&osmid=(\d+)/.exec(decodeURIComponent(url))
  if (m) return { type: { W: 'way', N: 'node', R: 'relation' }[m[1]], id: Number(m[2]) }
  return null
}

const GOV_TAG =
  /government|townhall|courthouse|police|fire_station|hospital|clinic|university|college|school|post_office|museum|public|civic/i
const COMMERCIAL = /مول|mall|سوق|مطعم|فندق|hotel|restaurant|cafe|مقهى|shop/i
const STOP_WORDS = new Set([
  'محافظة',
  'قضاء',
  'فرع',
  'دائرة',
  'مديرية',
  'العامة',
  'الناصرية',
  'قار',
  'الهيئة',
  'العامة',
  'مكتب',
])
const nameTokens = name =>
  name
    .replace(/[()–\-/،.]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word))

function scoreOf(tags, department) {
  const text = [tags.name, tags['name:ar'], tags['name:en'], tags.official_name].filter(Boolean).join(' ')
  let names = 0
  for (const token of nameTokens(department.name)) if (text.includes(token)) names += 2
  let kind = 0
  for (const key of ['amenity', 'office', 'government', 'building', 'healthcare'])
    if (tags[key] && GOV_TAG.test(String(tags[key]))) kind += 1
  const commercial = COMMERCIAL.test(text) || Boolean(tags.shop)
  /** carries a name that clearly belongs to something else */
  const otherName = Boolean(text) && names === 0
  return { score: names + kind, names, commercial, otherName }
}

/**
 * An outline usable as the department's building: tagged building=* and the size of one building. An
 * office/amenity outline without building=*, or a whole walled compound drawn as one "building", is the
 * department's site (drawn as a plot), never extruded as a solid block.
 */
const isFootprint = (tags, ring, area = ringArea(ring)) => area >= 25 && isBuildingOutline(tags, ring, area)

/** tags of an office's compound / grounds */
const SITE_TAGS =
  /government|townhall|courthouse|police|fire_station|hospital|clinic|university|college|school|community_centre|post_office/
/** an outline that is a department's compound: a public office/amenity plot, or a building-tagged compound */
const isSiteOutline = b =>
  b.area < 150_000 &&
  (b.tags.building
    ? isCompoundOutline(b.ring, b.area)
    : SITE_TAGS.test(`${b.tags.office ?? ''} ${b.tags.amenity ?? ''}`))

function buildQuery(departments) {
  const around = departments
    .map(
      d =>
        `  way(around:${RADIUS_M},${d.lat},${d.lng})[building];\n  relation(around:${RADIUS_M},${d.lat},${d.lng})[building];\n  way(around:${RADIUS_M},${d.lat},${d.lng})[~"^(office|amenity)$"~"."];`
    )
    .join('\n')
  const ids = { way: [], node: [], relation: [] }
  for (const d of departments) {
    const ref = cited(d.sourceUrl)
    if (ref) ids[ref.type].push(ref.id)
  }
  const exact = Object.entries(ids)
    .filter(([, list]) => list.length)
    .map(([type, list]) => `  ${type}(id:${[...new Set(list)].join(',')});`)
    .join('\n')
  return `[out:json][timeout:240];
(
${around}
${exact}
  way(around:250,${UR.lat},${UR.lng})[building];
);
out tags geom;`
}

// ---- main -----------------------------------------------------------------------------------------
const registry = JSON.parse(await readFile(REGISTRY, 'utf8'))
const departments = registry.filter(d => typeof d.lat === 'number' && typeof d.lng === 'number')
const data = await cachedOverpass('department-buildings-v2', buildQuery(departments))

const elements = data.elements ?? []
const byKey = new Map(elements.map(e => [`${e.type}/${e.id}`, e]))
const outlineOf = e => {
  const ring = e.type === 'node' ? null : ringOf(e)
  return ring ? { key: `${e.type}/${e.id}`, tags: e.tags ?? {}, ring, area: ringArea(ring) } : null
}
const outlines = elements.map(outlineOf).filter(b => b && b.area >= 25)
const citedOf = department => {
  const ref = cited(department.sourceUrl)
  const element = ref ? byKey.get(`${ref.type}/${ref.id}`) : null
  return element ? outlineOf(element) : null
}

/**
 * The compound a department stands in: the outline its registry entry cites when that is not a single
 * building, otherwise the smallest public plot / building-tagged compound that holds its point.
 */
function compoundOf(department) {
  const citedOutline = citedOf(department)
  if (citedOutline && isFootprint(citedOutline.tags, citedOutline.ring, citedOutline.area)) return null
  if (citedOutline && citedOutline.area < 150_000) return citedOutline
  return (
    outlines
      .filter(b => isSiteOutline(b) && contains(b.ring, department.lng, department.lat))
      .sort((a, b) => a.area - b.area)[0] ?? null
  )
}

// the batched `around` query only reaches 80 m from each point: ask for every building inside the
// compounds as well, so a large campus still finds its own blocks
const compounds = [
  ...new Map(
    departments
      .map(compoundOf)
      .filter(Boolean)
      .map(c => [c.key, c])
  ).values(),
].filter(c => c.area < 150_000)
if (compounds.length) {
  const extra = await cachedOverpass('department-compounds', buildingsInsideQuery(compounds.map(c => c.ring)), {
    keyed: true,
  })
  for (const e of extra.elements ?? []) {
    const key = `${e.type}/${e.id}`
    if (byKey.has(key)) continue
    byKey.set(key, e)
    const outline = outlineOf(e)
    if (outline && outline.area >= 25) outlines.push(outline)
  }
}
const footprints = outlines.filter(b => isFootprint(b.tags, b.ring, b.area))
const centreIn = (ring, b) => contains(ring, centroid(b.ring).lng, centroid(b.ring).lat)

const used = new Map() // footprint key → first department that claimed it
const features = []
const stats = {}

for (const department of departments) {
  const { lng, lat } = department
  const near = footprints
    .map(b => ({ ...b, distance: distanceTo(b.ring, lng, lat), ...scoreOf(b.tags, department) }))
    .filter(b => b.distance <= 60)

  let match = null
  let quality = 'generic'
  const citedOutline = citedOf(department)
  const compound = compoundOf(department)
  /** the largest building inside the compound */
  const largestIn = ring =>
    footprints
      .filter(b => centreIn(ring, b) && !scoreOf(b.tags, department).commercial)
      .map(b => ({ ...b, distance: distanceTo(b.ring, lng, lat) }))
      .sort((a, b) => b.area - a.area)[0] ?? null

  // 1. the exact OSM outline the registry cites, when it is one building
  if (citedOutline && isFootprint(citedOutline.tags, citedOutline.ring, citedOutline.area)) {
    match = { ...citedOutline, distance: 0 }
    quality = 'osm-cited'
  }
  // 1b. the cited element is a compound: its largest building
  if (!match && citedOutline && compound) {
    match = largestIn(compound.ring)
    if (match) quality = 'osm-site'
  }
  // 2. a building that holds the point (and isn't a mall or a shop)
  if (!match) {
    const inside = near
      .filter(b => b.distance === 0 && !b.commercial)
      .sort((a, b) => b.score - a.score || a.area - b.area)
    if (inside.length) {
      match = inside[0]
      quality = 'osm-contains'
    }
  }
  // 3. a nearby outline whose name matches the department
  if (!match) {
    const tagged = near
      .filter(b => b.names >= 2 && b.distance <= 45)
      .sort((a, b) => b.score - a.score || a.distance - b.distance)
    if (tagged.length) {
      match = tagged[0]
      quality = 'osm-tagged'
    }
  }
  // 3b. the point stands in a compound: its largest building
  if (!match && compound) {
    match = largestIn(compound.ring)
    if (match) quality = 'osm-site'
  }
  // 4. the nearest unnamed building (the coordinate usually sits on the entrance or the street in front)
  if (!match) {
    const nearest = near
      .filter(b => b.distance <= 20 && !b.otherName && !b.commercial)
      .sort((a, b) => a.distance - b.distance)
    if (nearest.length) {
      match = nearest[0]
      quality = 'osm-nearest'
    }
  }

  let ring
  let tags = {}
  if (match) {
    ring = match.ring
    tags = match.tags ?? {}
  } else {
    // a modest stand-in, aligned with its compound or the closest mapped building
    const neighbour = footprints
      .map(b => ({ ...b, distance: distanceTo(b.ring, lng, lat) }))
      .sort((a, b) => a.distance - b.distance)[0]
    const angle = compound
      ? longestEdgeAngle(compound.ring)
      : neighbour && neighbour.distance < 150
        ? longestEdgeAngle(neighbour.ring)
        : 0
    const size = 24 + (hash(department.id) % 9)
    ring = rectangle(lng, lat, size, size * 0.66, angle)
  }

  // the compound / grounds the office stands in (drawn as a tinted plot under the building)
  const site =
    compound && compound.area > ringArea(ring) * 1.3
      ? compound
      : outlines
          .filter(b => isSiteOutline(b) && contains(b.ring, lng, lat) && b.area > ringArea(ring) * 1.3)
          .sort((a, b) => a.area - b.area)[0]
  if (site)
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [site.ring] },
      properties: { id: department.id, kind: 'site', osm: site.key, areaM2: Math.round(site.area) },
    })

  const shared = match ? used.get(match.key) : undefined
  if (match && !shared) used.set(match.key, department.id)
  const {
    height,
    levels,
    source: heightSource,
  } = heightFrom(tags, CATEGORY_HEIGHT[department.category] ?? 12, department.id)
  stats[quality] = (stats[quality] || 0) + 1
  features.push({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      id: department.id,
      kind: 'building',
      name: department.name,
      category: department.category,
      matchQuality: quality,
      osm: match?.key ?? null,
      osmName: arabicName(tags),
      site: site?.key ?? null,
      sharedWith: shared ?? null,
      distanceM: match ? Math.round(match.distance) : null,
      areaM2: Math.round(ringArea(ring)),
      height,
      levels,
      heightSource,
      anchor: [round(lng), round(lat)],
    },
  })
}

// the Ziggurat of Ur: its real OSM outline, stepped into three terraces
const ziggurat = elements
  .filter(
    e =>
      e.type === 'way' &&
      (e.tags?.temple === 'ziggurat' || /ziggurat|زقورة/i.test(`${e.tags?.name} ${e.tags?.['name:en']}`))
  )
  .map(e => ({ e, ring: ringOf(e) }))
  .find(z => z.ring && ringArea(z.ring) < 20_000)
if (ziggurat) {
  const terraces = [
    // the lowest terrace slightly outgrows the OSM outline so the basemap's own block stays hidden inside
    { scale: 1.05, base: 0, height: 18 },
    { scale: 0.72, base: 18, height: 22.5 },
    { scale: 0.46, base: 22.5, height: 25.5 },
  ]
  terraces.forEach((terrace, index) =>
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [scaleRing(ziggurat.ring, terrace.scale)] },
      properties: {
        id: `landmark-ur-ziggurat-${index}`,
        kind: 'landmark',
        landmark: 'ur-ziggurat',
        name: 'زقورة أور',
        osm: `way/${ziggurat.e.id}`,
        base: terrace.base,
        height: terrace.height,
      },
    })
  )
  stats.landmark = 1
} else console.warn('ziggurat outline not found in the OSM answer')

await writeFile(
  OUT,
  JSON.stringify({
    type: 'FeatureCollection',
    attribution: '© OpenStreetMap contributors, ODbL 1.0',
    generated: new Date().toISOString().slice(0, 10),
    features,
  })
)
console.log(`wrote ${features.length} features → ${OUT}`)
console.table(stats)
console.log('sites:', features.filter(f => f.properties.kind === 'site').length)
for (const f of features.filter(f => f.properties.matchQuality))
  console.log(
    f.properties.matchQuality.padEnd(13),
    String(f.properties.osm ?? '').padEnd(18),
    `${f.properties.areaM2}m² h${f.properties.height}`.padEnd(14),
    f.properties.sharedWith ? `(shares ${f.properties.sharedWith})` : '',
    f.properties.name,
    f.properties.osmName ? `← ${f.properties.osmName}` : ''
  )
