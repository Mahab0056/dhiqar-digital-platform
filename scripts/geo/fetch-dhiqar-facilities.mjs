#!/usr/bin/env node
// Offline build step: every public facility OpenStreetMap knows inside Dhi Qar (schools, hospitals and
// health centres, police, courts, civil defence, post offices, municipalities, government offices,
// universities, libraries, sports/youth centres), with real building footprints where they are mapped.
//
//   node scripts/geo/fetch-dhiqar-facilities.mjs            (re-uses the cached Overpass answers)
//   node scripts/geo/fetch-dhiqar-facilities.mjs --refresh  (asks Overpass again)
//
// Writes public/geo/facilities/index.json (counts per district and type, sub-districts) and one
// public/geo/facilities/<district>.geojson per district, lazy-loaded by the maps. Nothing is invented:
// a facility without a mapped building gets a small, clearly generic stand-in footprint (`g: 1`). Only an
// outline the size of one building is extruded; a compound drawn as one outline becomes the facility's
// grounds (`k: 'g'`) with the buildings mapped inside it. A place mapped twice (outline and point, or two
// points) is counted and drawn once.
// Data © OpenStreetMap contributors, ODbL 1.0 (credited in public/geo/ATTRIBUTION.txt and on the map).
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  arabicName,
  buildingsInsideQuery,
  cachedOverpass,
  centroid,
  contains,
  DHIQAR_AREA,
  distanceTo,
  hash,
  inGeometry,
  isBuildingOutline,
  longestEdgeAngle,
  rectangle,
  ringArea,
  ringOf,
  ringsOverlap,
  ROOT,
  round,
  sameName,
  thinRing,
} from './osm-utils.mjs'

const OUT_DIR = join(ROOT, 'public', 'geo', 'facilities')
const DISTRICTS = join(ROOT, 'public', 'geo', 'dhiqar-districts.geojson')
const DEPARTMENTS = join(ROOT, 'public', 'geo', 'department-buildings.geojson')

/** facility types: OSM tags → key, stand-in footprint (m) and typical height (m) */
const TYPES = [
  { key: 'hospital', test: t => t.amenity === 'hospital' || t.healthcare === 'hospital', size: [48, 30], h: 18 },
  {
    key: 'clinic',
    test: t => t.amenity === 'clinic' || t.healthcare === 'clinic' || t.healthcare === 'centre',
    size: [24, 16],
    h: 5.5,
  },
  { key: 'university', test: t => t.amenity === 'university', size: [50, 26], h: 15 },
  { key: 'college', test: t => t.amenity === 'college', size: [40, 22], h: 12 },
  { key: 'school', test: t => t.amenity === 'school', size: [36, 18], h: 7.5 },
  { key: 'kindergarten', test: t => t.amenity === 'kindergarten', size: [22, 14], h: 4.5 },
  { key: 'police', test: t => t.amenity === 'police', size: [28, 18], h: 8 },
  { key: 'court', test: t => t.amenity === 'courthouse', size: [32, 22], h: 12 },
  { key: 'fire', test: t => t.amenity === 'fire_station', size: [30, 18], h: 8 },
  { key: 'townhall', test: t => t.amenity === 'townhall', size: [32, 20], h: 10 },
  { key: 'post', test: t => t.amenity === 'post_office', size: [22, 14], h: 7 },
  { key: 'utility', test: t => t.office === 'water_utility' || t.office === 'energy_supplier', size: [26, 16], h: 8 },
  { key: 'government', test: t => t.office === 'government', size: [28, 18], h: 10 },
  { key: 'library', test: t => t.amenity === 'library', size: [22, 14], h: 7 },
  { key: 'community', test: t => t.amenity === 'community_centre', size: [24, 16], h: 6.5 },
  { key: 'sports', test: t => t.leisure === 'sports_centre' || t.leisure === 'stadium', size: [36, 24], h: 9 },
]

/** district polygons are named in Arabic; files get a Latin slug */
const SLUGS = {
  الناصرية: 'nasiriyah',
  الشطرة: 'shatrah',
  'سوق الشيوخ': 'suq-al-shuyukh',
  الرفاعي: 'rifai',
  الغراف: 'gharraf',
  'قلعة سكر': 'qalat-sukkar',
  الدواية: 'dawaya',
  الفجر: 'fajr',
  'سيد دخيل': 'sayyid-dakhil',
  الجبايش: 'chibayish',
  الفهود: 'fuhud',
  الإصلاح: 'islah',
  النصر: 'nasr',
  البطحاء: 'batha',
  'كرمة بني سعد': 'karmat-bani-saad',
}

const FACILITY_QUERY = `[out:json][timeout:300];
area(id:${DHIQAR_AREA})->.dq;
(
  nwr(area.dq)[amenity~"^(school|kindergarten|university|college|hospital|clinic|police|courthouse|fire_station|post_office|townhall|library|community_centre)$"];
  nwr(area.dq)[healthcare~"^(hospital|clinic|centre)$"];
  nwr(area.dq)[office~"^(government|water_utility|energy_supplier)$"];
  nwr(area.dq)[leisure~"^(sports_centre|stadium)$"];
)->.fac;
.fac out tags geom;
node.fac->.facn;
way.fac[!building]->.grounds;
.grounds map_to_area->.ga;
(
  way(around.facn:30)[building];
  way(area.ga)[building];
);
out tags geom;`

const ADMIN_QUERY = `[out:json][timeout:120];
area(id:${DHIQAR_AREA})->.dq;
rel(area.dq)[boundary=administrative][admin_level=7];
out tags center;`

// ---- inputs ---------------------------------------------------------------------------------------
const districtGeo = JSON.parse(await readFile(DISTRICTS, 'utf8')).features.filter(f => f.properties.kind === 'district')
const departmentGeo = JSON.parse(await readFile(DEPARTMENTS, 'utf8')).features.filter(
  f => f.properties.kind === 'building'
)
const facilityData = await cachedOverpass('dhiqar-facilities', FACILITY_QUERY)
const adminData = await cachedOverpass('dhiqar-subdistricts', ADMIN_QUERY)

function districtOf(lng, lat) {
  const hit = districtGeo.find(f => inGeometry(f.geometry, lng, lat))
  if (hit) return hit.properties.name
  // the simplified boundaries can miss a point on the governorate's edge: take the closest district
  let best = { name: null, d: Infinity }
  for (const f of districtGeo) {
    const rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map(p => p[0])
    for (const ring of rings) {
      const d = distanceTo(ring, lng, lat)
      if (d < best.d) best = { name: f.properties.name, d }
    }
  }
  return best.d < 8000 ? best.name : null
}

// ---- facilities and candidate buildings -----------------------------------------------------------
const elements = facilityData.elements ?? []
const isFacility = tags => TYPES.some(t => t.test(tags))
const facilities = []
const seen = new Set()
/** buildings a facility may stand in: building=* outlines of a single building's size */
const buildingPool = new Map()
const pool = e => {
  const key = `${e.type}/${e.id}`
  const ring = ringOf(e)
  if (!ring || buildingPool.has(key)) return
  const area = ringArea(ring)
  if (isBuildingOutline(e.tags, ring, area)) buildingPool.set(key, { key, tags: e.tags, ring, area })
}
for (const e of elements) {
  const tags = e.tags ?? {}
  const type = TYPES.find(t => t.test(tags))
  const key = `${e.type}/${e.id}`
  if (type) {
    if (seen.has(key)) continue
    seen.add(key)
    const ring = e.type === 'node' ? null : ringOf(e)
    const anchor = e.type === 'node' ? [e.lon, e.lat] : ring ? [centroid(ring).lng, centroid(ring).lat] : null
    if (!anchor) continue
    const area = ring ? ringArea(ring) : 0
    // a facility outline is its own building only when it is the size of one building; a whole compound
    // drawn as `building=yes` (walls, yards and gardens) is the facility's grounds instead
    const own = Boolean(ring) && isBuildingOutline(tags, ring, area)
    facilities.push({ key, e, tags, type, ring, area, anchor, own, name: arabicName(tags) })
  } else if (tags.building && e.type !== 'node') pool(e)
}
// the buildings standing inside facility compounds drawn as one building=* outline (the main query only
// fetched what stands inside unbuilt grounds)
const compounds = facilities.filter(f => f.ring && f.tags.building && !f.own)
if (compounds.length) {
  const answer = await cachedOverpass('dhiqar-facility-compounds', buildingsInsideQuery(compounds.map(f => f.ring)), {
    keyed: true,
  })
  for (const e of answer.elements ?? [])
    if (e.tags?.building && !isFacility(e.tags) && !seen.has(`${e.type}/${e.id}`)) pool(e)
}
const buildings = [...buildingPool.values()]
const metres = (a, b) => Math.hypot((a[0] - b[0]) * 95_400, (a[1] - b[1]) * 111_320)

// ---- one place, one facility ----------------------------------------------------------------------
// OSM often maps the same court or school twice: as an outline and as a point inside it (or as two
// points). A point merges into a same-type facility within MERGE_M whose name matches or is missing; the
// outline wins and the point lends it its name. Different names stay separate (two schools sharing one
// building on morning and evening shifts are two schools).
const MERGE_M = 30
const compatible = (a, b) => !a.name || !b.name || sameName(a.name, b.name)
const placed = []
for (const f of [...facilities].sort((a, b) => Number(!a.ring) - Number(!b.ring))) {
  if (f.ring) {
    placed.push(f)
    continue
  }
  const host = placed
    .filter(k => k.type.key === f.type.key && compatible(k, f))
    .map(k => ({ k, d: k.ring ? distanceTo(k.ring, ...f.anchor) : metres(k.anchor, f.anchor) }))
    .filter(c => c.d <= MERGE_M)
    .sort((a, b) => a.d - b.d)[0]?.k
  if (!host) {
    placed.push(f)
    continue
  }
  f.mergedInto = host
  host.merged = [...(host.merged ?? []), f.key]
  host.name ??= f.name
}

// ---- who draws which building -----------------------------------------------------------------------
const deptAnchors = departmentGeo.map(f => ({
  id: f.properties.id,
  osm: f.properties.osm,
  site: f.properties.site,
  anchor: f.properties.anchor,
}))
/** building key → its ring, for every building already drawn (by a department or a facility) */
const claimed = new Map()
for (const f of departmentGeo)
  if (f.properties.osm && f.properties.matchQuality !== 'generic')
    claimed.set(f.properties.osm, f.geometry.coordinates[0])
for (const f of facilities) if (f.own && !f.mergedInto) claimed.set(f.key, f.ring)
/** every footprint drawn so far (departments' stand-ins included): a generic stand-in never cuts through one */
const occupied = [...departmentGeo.map(f => f.geometry.coordinates[0]), ...claimed.values()]

const byDistrict = new Map(Object.keys(SLUGS).map(name => [name, []]))
const counts = new Map(Object.keys(SLUGS).map(name => [name, {}]))
const totals = {}
const stats = {
  building: 0,
  buildingsInGrounds: 0,
  standIn: 0,
  departmentLinked: 0,
  sharedBuilding: 0,
  merged: facilities.filter(f => f.mergedInto).length,
  compounds: compounds.length,
  outside: 0,
}

/** the largest unclaimed buildings standing on a facility's grounds */
const buildingsInside = (ring, key) => {
  const inside = buildings
    .filter(b => !claimed.has(b.key) && b.key !== key && contains(ring, centroid(b.ring).lng, centroid(b.ring).lat))
    .sort((a, b) => b.area - a.area)
    .slice(0, 10)
  stats.buildingsInGrounds += inside.length
  return inside
}

// pass 1: every facility's real buildings (its own outline, the buildings on its grounds, the building
// that holds its point)
const placedFacilities = []
for (const f of facilities) {
  if (f.mergedInto) continue
  const { tags, type, key, ring, area, own } = f
  const [lng, lat] = f.anchor
  const district = districtOf(lng, lat)
  if (!district || !byDistrict.has(district)) {
    stats.outside++
    continue
  }
  counts.get(district)[type.key] = (counts.get(district)[type.key] || 0) + 1
  totals[type.key] = (totals[type.key] || 0) + 1

  const id = key.replace('/', '-')
  const record = { f, id, district, point: { f: id, t: type.key, n: f.name, o: key }, footprints: [], grounds: null }
  placedFacilities.push(record)

  // the same place as a platform department: the department layer draws it, the facility links to it
  const keys = [key, ...(f.merged ?? [])]
  const department = deptAnchors.find(
    d => keys.includes(d.osm) || keys.includes(d.site) || metres(d.anchor, f.anchor) < 25
  )
  if (department) {
    record.point.dep = department.id
    stats.departmentLinked++
    // the department draws its own building and plot; the other blocks on a shared campus stay
    if (ring && !own && area > 0) record.footprints.push(...buildingsInside(ring, key))
  } else if (own) {
    record.footprints.push(buildingPool.get(key) ?? { key, tags, ring, area })
  } else if (ring && area > 0) {
    // a school yard / hospital campus / walled compound: the buildings standing inside it
    record.grounds = ring
    record.footprints.push(...buildingsInside(ring, key))
  } else if ([...claimed.values()].some(r => contains(r, lng, lat))) {
    // a point inside a building another facility or a department already draws: it shares that building
    record.shared = true
  } else {
    // a mapped point: the building that holds it, or an unnamed one right beside it
    const near = buildings
      .filter(b => !claimed.has(b.key))
      .map(b => ({ ...b, d: distanceTo(b.ring, lng, lat) }))
      .filter(b => b.d === 0 || (b.d <= 12 && !b.tags.name && !b.tags.shop))
      .sort((a, b) => a.d - b.d)
    if (near.length) record.footprints.push(near[0])
  }
  for (const b of record.footprints) {
    claimed.set(b.key, b.ring)
    occupied.push(b.ring)
  }
}

// pass 2: a modest generic block for each facility with nothing mapped, unless a building (or another
// stand-in) already stands on that spot: then the facility shares it rather than cut a second block through it
for (const record of placedFacilities) {
  if (record.point.dep || record.shared || record.footprints.length) continue
  const { f, id, grounds } = record
  const [lng, lat] = f.anchor
  const [w, d] = f.type.size
  let angle
  let scale = 1
  if (grounds) {
    angle = longestEdgeAngle(grounds)
    // small enough to stand on its plot
    scale = Math.min(1, Math.sqrt((0.6 * f.area) / (w * d)))
  } else {
    // aligned with the nearest mapped building
    const neighbour = buildings.map(b => ({ ...b, d: distanceTo(b.ring, lng, lat) })).sort((a, b) => a.d - b.d)[0]
    angle = neighbour && neighbour.d < 200 ? longestEdgeAngle(neighbour.ring) : ((hash(id) % 4) * Math.PI) / 8
  }
  const block = rectangle(lng, lat, w * scale, d * scale, angle, 6)
  if (occupied.some(other => ringsOverlap(block, other))) record.shared = true
  else {
    record.footprints.push({ key: null, tags: {}, ring: block })
    record.standIn = true
    occupied.push(block)
  }
}

// ---- features -------------------------------------------------------------------------------------
for (const { f, id, district, point, footprints, grounds, standIn, shared } of placedFacilities) {
  const out = byDistrict.get(district)
  const [lng, lat] = f.anchor
  out.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [round(lng, 6), round(lat, 6)] },
    properties: point,
  })
  if (shared) stats.sharedBuilding++
  if (standIn) stats.standIn++
  if (grounds) {
    const thin = thinRing(grounds, 1.5)
    if (thin)
      out.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [thin] },
        properties: { f: id, t: f.type.key, k: 'g' },
      })
  }
  footprints.forEach((b, index) => {
    const thin = standIn ? b.ring : thinRing(b.ring, 0.5)
    if (!thin) return
    const tagged = parseFloat(String(b.tags.height ?? '').replace(/[^\d.]/g, ''))
    const levels = parseInt(String(b.tags['building:levels'] ?? ''), 10)
    // the main building gets the type height; secondary blocks on a campus are a little lower
    const fallback = f.type.h * (index === 0 ? 1 : 0.7) + ((hash(`${id}${index}`) % 5) - 2) * 0.4
    const h = tagged > 2 && tagged < 120 ? tagged : levels > 0 && levels < 40 ? levels * 3.2 + 1 : fallback
    if (!standIn) stats.building++
    out.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [thin] },
      // `o`: the OSM building drawn here, so the maps can hide the basemap's own copy of it
      properties: { f: id, t: f.type.key, k: 'b', h: round(h, 1), ...(standIn ? { g: 1 } : { o: b.key }) },
    })
  })
}

// ---- sub-districts (admin_level 7) per district ----------------------------------------------------
const subdistricts = new Map(Object.keys(SLUGS).map(name => [name, []]))
for (const rel of adminData.elements ?? []) {
  if (!rel.center) continue
  const district = districtOf(rel.center.lon, rel.center.lat)
  if (!district || !subdistricts.has(district)) continue
  const raw = arabicName(rel.tags) ?? ''
  const centre = /مركز/.test(raw)
  const name = raw
    .replace(/^ناحية\s+/, '')
    .replace(/^مركز قضاء\s+/, 'مركز قضاء ')
    .trim()
  subdistricts.get(district).push({ name, centre, osm: `relation/${rel.id}` })
}

// ---- write ---------------------------------------------------------------------------------------
await rm(OUT_DIR, { recursive: true, force: true })
await mkdir(OUT_DIR, { recursive: true })
const index = {
  attribution: '© OpenStreetMap contributors, ODbL 1.0',
  generated: new Date().toISOString().slice(0, 10),
  note: 'OpenStreetMap coverage in Dhi Qar is incomplete; counts are what is mapped, not official totals.',
  totals,
  districts: {},
}
for (const [district, features] of byDistrict) {
  const file = `${SLUGS[district]}.geojson`
  const body = JSON.stringify({ type: 'FeatureCollection', features })
  await writeFile(join(OUT_DIR, file), body)
  const subs = subdistricts.get(district).sort((a, b) => Number(b.centre) - Number(a.centre))
  index.districts[district] = {
    file,
    bytes: body.length,
    total: Object.values(counts.get(district)).reduce((s, n) => s + n, 0),
    counts: counts.get(district),
    subdistricts: subs.map(s => ({ name: s.name, centre: s.centre, osm: s.osm })),
  }
}
await writeFile(join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 1))

console.log(`facilities: ${facilities.length} in OSM answer`, stats)
console.table(totals)
console.table(
  Object.fromEntries(
    Object.entries(index.districts).map(([name, d]) => [
      name,
      { total: d.total, kb: Math.round(d.bytes / 1024), subs: d.subdistricts.map(s => s.name).join('، ') },
    ])
  )
)
if (process.argv.includes('--verbose'))
  for (const f of facilities.filter(f => f.mergedInto))
    console.log(
      'merged',
      f.type.key.padEnd(10),
      f.key.padEnd(18),
      String(arabicName(f.tags) ?? '-').padEnd(30),
      '→',
      f.mergedInto.key.padEnd(18),
      arabicName(f.mergedInto.tags) ?? '-'
    )
