// Final pass «public-pages»:
//  1. a department's public page (and the public department API behind it) shows citizens clean public data only —
//     never the registry's research notes («نقطة OSM way/… (mapcarta …)», «تحقق 2026-10-07») or raw source links;
//     staff endpoints keep the notes. Where a map is shown, a plain «مصدر الموقع: OpenStreetMap» credit remains;
//  2. every Leaflet (2D) map starts its attribution line with a plain «Leaflet» link, not Leaflet's default flag.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Router } from 'wouter'
import request from 'supertest'
import type { Express } from 'express'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import registry from '../server/registry/dhiqar-departments.json' with { type: 'json' }
import { LEAFLET_ATTRIBUTION_PREFIX, plainLeafletPrefix } from '../src/components/maps/leaflet-attribution'
import type { DepartmentSummary } from '../src/types'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()

// Leaflet needs a DOM at import time: the page renders through stand-ins that record what the map was given
const leaflet = vi.hoisted(() => ({ refs: [] as unknown[] }))
vi.mock('react-leaflet', async () => {
  const { createElement: h } = await import('react')
  return {
    MapContainer: (props: { ref?: unknown; children?: unknown }) => {
      leaflet.refs.push(props.ref)
      return h('div', { 'data-leaflet-map': '' }, props.children as never)
    },
    TileLayer: () => null,
    CircleMarker: () => null,
  }
})

type RegistryEntry = Omit<DepartmentSummary, 'digitalServices'>
const entries = registry as RegistryEntry[]
const governorate = entries.find(entry => entry.id === 'dhiqar-governorate')!

const root = new URL('../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const unescape = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
const text = (html: string) =>
  unescape(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

let app: Express
let admin = ''

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  const login = await request(app)
    .post('/api/auth/staff/login')
    .send({ username: 'admin', password: 'Bootstrap-Admin-Pass-2026!' })
  expect(login.status).toBe(200)
  admin = cookieOf(login)
  const rotated = await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', admin)
    .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Admin-Rotated-Pass-2026!' })
  expect(rotated.status).toBe(200)
})

describe('the public department API never sends the registry research notes', () => {
  it('the registry does carry research notes (the reason for this guard)', () => {
    expect(governorate.notes).toMatch(/OSM way\/437260120/)
    expect(entries.filter(entry => entry.notes).length).toBeGreaterThan(50)
  })

  it('/api/departments lists every department with `notes: null`, and no note text anywhere in the payload', async () => {
    const response = await request(app).get('/api/departments')
    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(entries.length)
    for (const item of response.body.items) expect(item.notes, item.id).toBeNull()
    for (const entry of entries) if (entry.notes) expect(response.text, entry.id).not.toContain(entry.notes)
  })

  it('the directory search and filters still work on the stripped payload', async () => {
    const response = await request(app).get('/api/departments').query({ q: 'ديوان محافظة' })
    expect(response.status).toBe(200)
    expect(response.body.items.map((item: { id: string }) => item.id)).toContain('dhiqar-governorate')
    for (const item of response.body.items) expect(item.notes).toBeNull()
  })

  it('/api/departments/:id keeps the public contact data and drops the notes', async () => {
    const response = await request(app).get('/api/departments/dhiqar-governorate')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      id: governorate.id,
      name: governorate.name,
      address: governorate.address,
      phone: governorate.phone,
      website: governorate.website,
      lat: governorate.lat,
      lng: governorate.lng,
      services: governorate.services,
      notes: null,
    })
    expect(response.text).not.toContain('mapcarta W437260120')
  })

  it('staff still get the notes on the department dashboard', async () => {
    const response = await request(app).get('/api/departments/dhiqar-governorate/dashboard').set('Cookie', admin)
    expect(response.status).toBe(200)
    expect(response.body.department.notes).toBe(governorate.notes)
  })
})

describe('the public department page shows clean public data only', () => {
  const render = async (entry: RegistryEntry) => {
    const { DepartmentDetails } = await import('../src/pages/public/DepartmentPublicPage.tsx')
    return renderToStaticMarkup(
      createElement(
        Router,
        { ssrPath: `/departments/${entry.id}` },
        // the notes are passed in on purpose: even a payload that still carried them must not show them
        createElement(DepartmentDetails, { item: { ...entry, digitalServices: 0 }, digitalServices: [] })
      )
    )
  }

  it('the governorate page: address, website, services and map, no research note', async () => {
    const html = await render(governorate)
    const visible = text(html)
    expect(visible).toContain(governorate.address!)
    expect(visible).toContain('thiqar.gov.iq')
    for (const service of governorate.services) expect(visible).toContain(service)
    expect(visible).toContain('مصدر الموقع: OpenStreetMap')
    expect(visible).toContain('الاتجاهات إلى الجهة')
    for (const leak of ['mapcarta', 'way/437260120', 'OSM ', 'موسومة', 'thiqar-lch.ur.gov.iq', 'مصدر البيانات'])
      expect(visible).not.toContain(leak)
    expect(html).not.toContain('tq-note is-info')
  })

  it('no department page shows its note, and every link is public contact data or navigation', async () => {
    for (const entry of entries) {
      const html = await render(entry)
      const visible = text(html)
      if (entry.notes) expect(visible, entry.id).not.toContain(entry.notes)
      const allowed = new Set(
        [
          entry.website,
          entry.facebook,
          entry.lat != null ? `https://www.openstreetmap.org/directions?to=${entry.lat}%2C${entry.lng}` : null,
        ].filter(Boolean)
      )
      for (const [, raw] of html.matchAll(/href="([^"]*)"/g)) {
        const href = unescape(raw)
        if (href.startsWith('/')) continue
        expect(allowed.has(href), `${entry.id}: unexpected link ${href}`).toBe(true)
      }
      // the OSM credit sits under the map, and only where a map is drawn
      expect(visible.includes('مصدر الموقع: OpenStreetMap'), entry.id).toBe(entry.lat != null && entry.lng != null)
    }
  })

  it('a department without coordinates says so instead of drawing a map', async () => {
    const entry = entries.find(item => item.lat == null)!
    const html = await render(entry)
    expect(html).not.toContain('data-leaflet-map')
    expect(text(html)).toContain('لم تُسجل إحداثيات رسمية لهذه الجهة بعد.')
  })
})

describe('every Leaflet map shows a plain «Leaflet» attribution prefix (no flag icon)', () => {
  it('the prefix is a plain link to leafletjs.com', () => {
    expect(LEAFLET_ATTRIBUTION_PREFIX).toBe('<a href="https://leafletjs.com">Leaflet</a>')
    expect(LEAFLET_ATTRIBUTION_PREFIX).not.toMatch(/svg|flag|🇺🇦/i)
  })

  it('plainLeafletPrefix sets it on the map attribution control, and tolerates a detached or control-less map', () => {
    const setPrefix = vi.fn()
    plainLeafletPrefix({ attributionControl: { setPrefix } })
    expect(setPrefix).toHaveBeenCalledExactlyOnceWith(LEAFLET_ATTRIBUTION_PREFIX)
    expect(() => plainLeafletPrefix(null)).not.toThrow()
    expect(() => plainLeafletPrefix({})).not.toThrow()
  })

  it('the public department page hands it to its map', async () => {
    leaflet.refs.length = 0
    const { DepartmentDetails } = await import('../src/pages/public/DepartmentPublicPage.tsx')
    renderToStaticMarkup(
      createElement(
        Router,
        { ssrPath: '/departments/dhiqar-governorate' },
        createElement(DepartmentDetails, { item: governorate, digitalServices: [] })
      )
    )
    expect(leaflet.refs).toEqual([plainLeafletPrefix])
  })

  it('every <MapContainer> in the app is created with ref={plainLeafletPrefix}, and no map bypasses it', () => {
    const sources = (dir: string): string[] =>
      readdirSync(new URL(dir, root)).flatMap(name => {
        const path = join(dir, name).replace(/\\/g, '/')
        return statSync(new URL(path, root)).isDirectory() ? sources(`${path}/`) : /\.tsx?$/.test(name) ? [path] : []
      })
    const withMaps: string[] = []
    for (const file of sources('src/')) {
      const source = stripComments(read(file))
      // a map built by hand (L.map) would skip the shared ref; no other prefix is set anywhere
      expect(source, file).not.toMatch(/\bL\.map\(|new L\.Map\(/)
      expect(source, file).not.toMatch(/\.setPrefix\((?!LEAFLET_ATTRIBUTION_PREFIX\))/)
      const containers = source.match(/<MapContainer\b[^>]*>/g) ?? []
      if (!containers.length) continue
      withMaps.push(file)
      for (const tag of containers) expect(tag, file).toContain('ref={plainLeafletPrefix}')
      expect(source, file).toMatch(/import \{ plainLeafletPrefix \} from '[^']*leaflet-attribution'/)
    }
    expect(withMaps.sort()).toEqual([
      'src/components/maps/DepartmentsLeafletMap.tsx',
      'src/components/maps/LocationPicker.tsx',
      'src/components/operations/DhiQarMap.tsx',
      'src/pages/public/DepartmentPublicPage.tsx',
    ])
  })
})
