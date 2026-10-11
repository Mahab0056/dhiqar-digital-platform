// Shared helpers for the offline OpenStreetMap build scripts in scripts/geo/.
// Data © OpenStreetMap contributors, ODbL 1.0.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CACHE_DIR = join(ROOT, 'node_modules', '.cache', 'dq-geo')

/** OSM area id of the Dhi Qar governorate (relation 3244380) */
export const DHIQAR_AREA = 3600000000 + 3244380

// ---- geometry (local metres around a reference point) ----------------------------------------------
const M_PER_DEG = 111_320
export const toXY = (lng, lat, ref) => [
  (lng - ref.lng) * M_PER_DEG * Math.cos((ref.lat * Math.PI) / 180),
  (lat - ref.lat) * M_PER_DEG,
]
export const toLL = ([x, y], ref) => [
  ref.lng + x / (M_PER_DEG * Math.cos((ref.lat * Math.PI) / 180)),
  ref.lat + y / M_PER_DEG,
]

export const round = (value, digits = 7) => Math.round(value * 10 ** digits) / 10 ** digits
export const hash = text => [...String(text)].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7)

export const centroid = ring => {
  const pts = ring.slice(0, -1)
  return { lng: pts.reduce((s, p) => s + p[0], 0) / pts.length, lat: pts.reduce((s, p) => s + p[1], 0) / pts.length }
}

export function ringArea(ring) {
  const ref = centroid(ring)
  const pts = ring.map(([lng, lat]) => toXY(lng, lat, ref))
  let sum = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) sum += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]
  return Math.abs(sum / 2)
}

export function contains(ring, lng, lat) {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/** point in a GeoJSON Polygon / MultiPolygon (outer rings only minus holes) */
export function inGeometry(geometry, lng, lat) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return polygons.some(
    ([outer, ...holes]) => contains(outer, lng, lat) && !holes.some(hole => contains(hole, lng, lat))
  )
}

/** distance in metres from a point to a ring's boundary (0 if inside) */
export function distanceTo(ring, lng, lat) {
  if (contains(ring, lng, lat)) return 0
  const ref = { lng, lat }
  const pts = ring.map(([x, y]) => toXY(x, y, ref))
  let best = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[i + 1]
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)))
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return best
}

/** bearing (radians) of a ring's longest edge — aligns stand-in footprints with their neighbours */
export function longestEdgeAngle(ring) {
  const ref = centroid(ring)
  let best = { len: 0, angle: 0 }
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = toXY(...ring[i], ref)
    const [bx, by] = toXY(...ring[i + 1], ref)
    const len = Math.hypot(bx - ax, by - ay)
    if (len > best.len) best = { len, angle: Math.atan2(by - ay, bx - ax) }
  }
  return best.angle
}

export function rectangle(lng, lat, width, depth, angle = 0, digits = 7) {
  const ref = { lng, lat }
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const corners = [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
  ].map(([x, y]) => toLL([x * c - y * s, x * s + y * c], ref))
  return [...corners, corners[0]].map(([x, y]) => [round(x, digits), round(y, digits)])
}

/** two rings share some ground (one inside the other, or crossing edges) */
export function ringsOverlap(a, b) {
  const box = ring => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const [x, y] of ring) {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
    return [x0, y0, x1, y1]
  }
  const [ax0, ay0, ax1, ay1] = box(a)
  const [bx0, by0, bx1, by1] = box(b)
  if (ax1 < bx0 || bx1 < ax0 || ay1 < by0 || by1 < ay0) return false
  if (a.some(([x, y]) => contains(b, x, y)) || b.some(([x, y]) => contains(a, x, y))) return true
  const side = (p, q, r) => (r[0] - p[0]) * (q[1] - p[1]) - (q[0] - p[0]) * (r[1] - p[1])
  for (let i = 0; i < a.length - 1; i++)
    for (let j = 0; j < b.length - 1; j++) {
      const [p, q, r, s] = [a[i], a[i + 1], b[j], b[j + 1]]
      if (side(r, s, p) * side(r, s, q) < 0 && side(p, q, r) * side(p, q, s) < 0) return true
    }
  return false
}

/** a ring's footprint area over the area of its smallest enclosing (rotated) rectangle: 1 = a rectangle */
export function rectangularity(ring, area = ringArea(ring)) {
  const ref = centroid(ring)
  const pts = ring.map(([lng, lat]) => toXY(lng, lat, ref))
  let best = Infinity
  // the minimum-area enclosing rectangle shares a side with the convex hull, so trying every edge
  // direction of the ring (a superset of the hull's) finds it
  for (let i = 0; i < pts.length - 1; i++) {
    const angle = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0])
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const [x, y] of pts) {
      const u = x * c + y * s
      const v = -x * s + y * c
      x0 = Math.min(x0, u)
      x1 = Math.max(x1, u)
      y0 = Math.min(y0, v)
      y1 = Math.max(y1, v)
    }
    best = Math.min(best, (x1 - x0) * (y1 - y0))
  }
  return best > 0 && Number.isFinite(best) ? area / best : 0
}

// ---- one building, or a whole compound? -----------------------------------------------------------
// OSM in Dhi Qar often draws a ministry campus, a police command or a school plot as one `building=yes`
// outline along its walls. Extruded, that becomes a solid block over yards, gardens and car parks.
/** no single public building here is this large: an outline above it always encloses a compound */
export const MAX_BUILDING_M2 = 10_000
/** above this size, an outline that is (almost) a plain rectangle is a traced plot or wall, not a building */
export const PLOT_MIN_M2 = 2_500
export const PLOT_RECTANGULARITY = 0.85

/** the outline encloses a compound (walls, yards, several blocks) rather than one building */
export function isCompoundOutline(ring, area = ringArea(ring)) {
  return area > MAX_BUILDING_M2 || (area > PLOT_MIN_M2 && rectangularity(ring, area) >= PLOT_RECTANGULARITY)
}

/** an outline that may be extruded as one building: tagged building=*, of a plausible single-building size */
export function isBuildingOutline(tags, ring, area = ringArea(ring)) {
  const building = tags?.building
  return Boolean(building) && building !== 'no' && area >= 20 && !isCompoundOutline(ring, area)
}

/**
 * Overpass query for every building standing inside the given compound outlines (by bounding box,
 * ~20 m margin: callers keep the ones whose centroid falls inside the ring).
 */
export function buildingsInsideQuery(rings) {
  const boxes = rings.map(ring => {
    const lngs = ring.map(p => p[0])
    const lats = ring.map(p => p[1])
    const pad = 0.0002
    return [Math.min(...lats) - pad, Math.min(...lngs) - pad, Math.max(...lats) + pad, Math.max(...lngs) + pad]
      .map(v => round(v, 6))
      .join(',')
  })
  return `[out:json][timeout:180];
(
${boxes.map(box => `  way(${box})[building];\n  relation(${box})[building];`).join('\n')}
);
out tags geom;`
}

/** Arabic names that are the same place: equal once spelling variants are folded, or one contains the other */
export function sameName(a, b) {
  const fold = text =>
    String(text ?? '')
      .replace(/[ً-ْـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  const [x, y] = [fold(a), fold(b)]
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

/** shrink a ring toward its centroid */
export function scaleRing(ring, factor) {
  const ref = centroid(ring)
  return ring.map(([lng, lat]) => {
    const [a, b] = toLL(
      toXY(lng, lat, ref).map(v => v * factor),
      ref
    )
    return [round(a), round(b)]
  })
}

/** drop vertices closer than `metres` to the previous kept one (keeps the ring closed) */
export function thinRing(ring, metres = 0.6, digits = 6) {
  const ref = centroid(ring)
  const out = [ring[0]]
  for (let i = 1; i < ring.length - 1; i++) {
    const [x0, y0] = toXY(...out[out.length - 1], ref)
    const [x1, y1] = toXY(...ring[i], ref)
    if (Math.hypot(x1 - x0, y1 - y0) >= metres) out.push(ring[i])
  }
  out.push(ring[0])
  return out.length >= 4 ? out.map(([x, y]) => [round(x, digits), round(y, digits)]) : null
}

/** outer ring of a way / single-outer multipolygon relation from `out geom`, as a closed [lng, lat] ring */
export function ringOf(element) {
  if (element.type === 'way' && element.geometry?.length > 3) {
    const ring = element.geometry.map(p => [round(p.lon), round(p.lat)])
    const [a, b] = [ring[0], ring[ring.length - 1]]
    return a[0] === b[0] && a[1] === b[1] ? ring : null
  }
  if (element.type === 'relation') {
    const outer = (element.members ?? []).filter(m => m.role === 'outer' && m.geometry?.length > 3)
    return outer.length === 1 ? ringOf({ type: 'way', geometry: outer[0].geometry }) : null
  }
  return null
}

/** Arabic name first (name:ar → name), with Persian letter forms normalised */
export const arabicName = tags =>
  (tags?.['name:ar'] || tags?.name || '').replace(/ک/g, 'ك').replace(/ی/g, 'ي').replace(/\s+/g, ' ').trim() || null

// ---- Overpass -------------------------------------------------------------------------------------
// public instances, tried in order (one request each, with a pause before the next)
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

async function ask(endpoint, query) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'dhiqar-digital-platform offline geo build script (cached, run rarely)',
    },
    body: new URLSearchParams({ data: query }),
  })
  const text = await response.text()
  if (!response.ok || !text.startsWith('{')) throw new Error(`Overpass ${response.status}: ${text.slice(0, 120)}`)
  const data = JSON.parse(text)
  if (data.remark && /runtime error|timed out/i.test(data.remark)) throw new Error(data.remark)
  return data
}

/**
 * Runs one Overpass query, caching the answer under node_modules/.cache (pass --refresh to re-ask).
 * `keyed` adds a hash of the query to the cache name, for queries computed from other answers.
 */
export async function cachedOverpass(name, query, { keyed = false } = {}) {
  const file = join(CACHE_DIR, `${keyed ? `${name}-${hash(query).toString(36)}` : name}.json`)
  if (!process.argv.includes('--refresh')) {
    try {
      const data = JSON.parse(await readFile(file, 'utf8'))
      console.log(`${name}: using cached Overpass answer`)
      return data
    } catch {
      // not cached yet
    }
  }
  let last
  for (const endpoint of [...ENDPOINTS, ...ENDPOINTS]) {
    try {
      console.log(`${name}: asking ${new URL(endpoint).host}…`)
      const data = await ask(endpoint, query)
      await mkdir(CACHE_DIR, { recursive: true })
      await writeFile(file, JSON.stringify(data))
      return data
    } catch (error) {
      last = error
      console.warn(`  ${String(error.message).slice(0, 100)} — trying the next instance in 20 s`)
      await new Promise(resolve => setTimeout(resolve, 20_000))
    }
  }
  throw last
}
