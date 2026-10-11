// Cross-cutting fixes of the documents feature: renderer cost, preview caching, unique serial codes per issuing
// authority, and the UI regressions found at runtime (off-screen dialog, dark mode, voice without speech support,
// launcher clearance, district drill layout).
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PDFDocument from 'pdfkit'
import request from 'supertest'
import type { Express } from 'express'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const fontPath = (file: string) => new URL(`../server/documents/fonts/${file}`, import.meta.url)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('document fonts: WOFF unpacked once', () => {
  it('turns a WOFF into the identical sfnt (flavor, tables, checksums)', async () => {
    const { woffToSfnt } = await import('../server/documents/text.ts')
    for (const file of ['ibm-plex-sans-arabic-arabic-700-normal.woff', 'noto-kufi-arabic-latin-700-normal.woff']) {
      const woff = readFileSync(fontPath(file))
      const sfnt = woffToSfnt(woff)
      expect(woff.toString('latin1', 0, 4)).toBe('wOFF')
      expect(sfnt.readUInt32BE(0)).toBe(woff.readUInt32BE(4))
      const count = sfnt.readUInt16BE(4)
      expect(count).toBe(woff.readUInt16BE(12))
      let previous = -1
      for (let index = 0; index < count; index += 1) {
        const record = 12 + index * 16
        const tag = sfnt.readUInt32BE(record)
        const checksum = sfnt.readUInt32BE(record + 4)
        const offset = sfnt.readUInt32BE(record + 8)
        const length = sfnt.readUInt32BE(record + 12)
        expect(tag).toBeGreaterThan(previous)
        previous = tag
        expect(offset % 4).toBe(0)
        if (sfnt.toString('latin1', record, record + 4) === 'head') continue
        let sum = 0
        for (let at = offset; at < offset + length; at += 4) {
          const word = Buffer.alloc(4)
          sfnt.copy(word, 0, at, Math.min(at + 4, offset + length))
          sum = (sum + word.readUInt32BE(0)) >>> 0
        }
        expect(sum).toBe(checksum)
      }
      // same glyph metrics through pdfkit/fontkit
      const doc = new PDFDocument({ autoFirstPage: false })
      doc.registerFont('woff', woff)
      doc.registerFont('sfnt', sfnt)
      for (const text of ['بلدية الناصرية', 'TQD-NM-2026-000184', 'إجازة فتح محل 25,000']) {
        const width = doc.font('woff').fontSize(12).widthOfString(text)
        expect(doc.font('sfnt').fontSize(12).widthOfString(text)).toBeCloseTo(width, 6)
      }
    }
  })

  it('renders with sfnt buffers, never a WOFF that fontkit re-inflates per glyph', async () => {
    const { renderDocumentPdf } = await import('../server/documents/render.ts')
    const { sampleModel } = await import('../server/documents/samples.ts')
    const spy = vi.spyOn(PDFDocument.prototype, 'registerFont')
    const pdf = await renderDocumentPdf(sampleModel('shop-licence'))
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    const buffers = spy.mock.calls.map(call => call[1]).filter(src => Buffer.isBuffer(src)) as Buffer[]
    expect(buffers.length).toBeGreaterThan(0)
    for (const buffer of buffers) expect(buffer.toString('latin1', 0, 4)).not.toBe('wOFF')
  })
})

describe('document numbers: one code per issuing authority', () => {
  it('gives every registry department its own serial code, without falling back to a numeric suffix', async () => {
    const { departmentRegistry } = await import('../server/department-registry.ts')
    const { departmentCode, derivedDepartmentCode } = await import('../server/documents/samples.ts')
    const seen = new Map<string, string>()
    const derived = new Map<string, string>()
    for (const item of departmentRegistry) {
      const code = departmentCode(item.id)
      expect(code).toMatch(/^[A-Z]{2,5}\d*$/)
      expect(seen.get(code), `${code}: ${seen.get(code)} and ${item.id}`).toBeUndefined()
      seen.set(code, item.id)
      const base = derivedDepartmentCode(item.id)
      // a collision here means a new department needs an entry in DEPARTMENT_CODE_OVERRIDES
      expect(derived.get(base), `${base}: ${derived.get(base)} and ${item.id}`).toBeUndefined()
      derived.set(base, item.id)
    }
    expect(departmentCode('dhi-qar-provincial-council')).not.toBe(departmentCode('dhi-qar-police-command'))
    expect(departmentCode('shia-endowment-dhi-qar')).not.toBe(departmentCode('sunni-endowment-dhi-qar'))
    expect(new Set(['nasiriyah-municipality', 'nasr-municipality', 'nasiriyah-museum'].map(departmentCode)).size).toBe(
      3
    )
    expect(departmentCode('dhiqar-health')).toBe('HEA')
    expect(departmentCode('dhiqar-governorate')).toBe('GOV')
  })

  it('numbers two authorities that used to share a code from separate counters', async () => {
    const { nextDocumentSerial } = await import('../server/issued-documents.ts')
    const at = new Date('2026-06-01T09:00:00Z')
    const council = nextDocumentSerial('dhi-qar-provincial-council', at)
    const police = nextDocumentSerial('dhi-qar-police-command', at)
    expect(council).toMatch(/^TQD-PC-2026-\d{6}$/)
    expect(police).toMatch(/^TQD-POL-2026-\d{6}$/)
    expect(police.endsWith('-000001')).toBe(true)
  })
})

describe('template editor preview', () => {
  let app: Express
  let admin = ''

  beforeAll(async () => {
    const { createPlatformServer } = await import('../server/create-server.ts')
    app = createPlatformServer({ serveStatic: false }).app
    const login = async (password: string) =>
      cookieOf(await request(app).post('/api/auth/staff/login').send({ username: 'admin', password }))
    admin = await login('Bootstrap-Admin-Pass-2026!')
    await request(app)
      .post('/api/auth/staff/change-password')
      .set('Cookie', admin)
      .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Crosscut-Admin-Pass-2026!' })
    admin = await login('Crosscut-Admin-Pass-2026!')
  })

  it('renders a state once: the editor re-requesting it (or concurrent requests) reuses the PDF', async () => {
    const renders = vi.spyOn(PDFDocument.prototype, 'end')
    const query = {
      templateId: 'shop-licence',
      departmentId: 'nasiriyah-municipality',
      conditions: 'يُعلَّق الإجازة في مكان ظاهر\nتجدد سنوياً',
      validityDays: '200',
    }
    const [first, second] = await Promise.all([
      request(app).get('/api/documents/preview.pdf').query(query).set('Cookie', admin),
      request(app).get('/api/documents/preview.pdf').query(query).set('Cookie', admin),
    ])
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(Buffer.compare(first.body, second.body)).toBe(0)
    expect(renders).toHaveBeenCalledTimes(1)
    const again = await request(app).get('/api/documents/preview.pdf').query(query).set('Cookie', admin)
    expect(Buffer.compare(again.body, first.body)).toBe(0)
    expect(renders).toHaveBeenCalledTimes(1)
    // any edit is a new state
    const edited = await request(app)
      .get('/api/documents/preview.pdf')
      .query({ ...query, validityDays: '365' })
      .set('Cookie', admin)
    expect(edited.status).toBe(200)
    expect(renders).toHaveBeenCalledTimes(2)
  })
})

describe('voice stage without any speech engine', () => {
  it('says the voice is unavailable instead of inviting a tap on the disabled mic', async () => {
    const { VoiceStage } = await import('../src/components/assistant/voice/VoiceStage.tsx')
    const noop = () => undefined
    const props = {
      orbRef: { current: null },
      stageRef: { current: null },
      phase: 'idle' as const,
      partial: '',
      message: '',
      provider: null,
      serverVoice: false,
      continuous: false,
      onContinuous: noop,
      onPressStart: noop,
      onPressEnd: noop,
      onToggle: noop,
      onSkip: noop,
      onKeyboard: noop,
      onAccept: noop,
      onDecline: noop,
    }
    const none = renderToStaticMarkup(createElement(VoiceStage, { ...props, engine: 'none' }))
    expect(none).toContain('الصوت غير مدعوم في هذا المتصفح')
    expect(none).not.toContain('اضغط على المايك وتكلّم')
    expect(none).not.toContain('نقرة وحدة وتكلّم')
    const speech = renderToStaticMarkup(createElement(VoiceStage, { ...props, engine: 'speech' }))
    expect(speech).toContain('اضغط على المايك وتكلّم')
    expect(speech).not.toContain('الصوت غير مدعوم')
  })
})

describe('runtime layout regressions', () => {
  it('leaves no transform on the workspace tab panel after its entry animation (fixed dialogs inside it)', () => {
    const staff = read('src/styles/staff.css')
    const rule = staff.match(/\.workspace-tabpanel \{([^}]*)\}/)?.[1] || ''
    const animation = rule.match(/animation:\s*([^;]+);/)?.[1] || ''
    expect(animation).toContain('page-enter')
    expect(animation).not.toMatch(/\b(both|forwards)\b/)
    // and the template dialog does not depend on it: it is portalled to <body>
    const panel = read('src/components/documents/DocumentTemplatesPanel.tsx')
    expect(panel).toMatch(/createPortal\([\s\S]*docs-dialog-backdrop[\s\S]*document\.body\s*\)/)
  })

  it('gives every light surface of the documents UI a dark-theme ground', () => {
    const css = read('src/styles/ds/documents.css').replace(/\/\*[\s\S]*?\*\//g, '')
    const dark = [...css.matchAll(/:root\[data-gov-theme='dark'\]([^{]*)\{([^}]*)\}/g)]
      .filter(([, , body]) => /background:\s*(var\(--p-surface|rgb\(111 216 171)/.test(body))
      .map(([, selector]) => selector.replace(/\s+/g, ' '))
      .join(' ')
    for (const surface of [
      '.docs-card',
      '.docs-dialog',
      '.docs-editor',
      '.docs-issued-list > li',
      '.docs-service-list button',
      '.docs-chips button',
      '.docs-chips button b',
      '.docs-fields li',
      '.docs-issue-note',
      '.docs-ok',
      '.docs-panel-head',
    ])
      expect(dark, surface).toContain(surface)
  })

  it('keeps long department names inside the district drill panel', () => {
    const css = read('src/styles/ds/map3d-drill.css')
    expect(css.match(/\.drill-list \{([^}]*)\}/)?.[1]).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    expect(css.match(/\.drill-list li \{([^}]*)\}/)?.[1]).toMatch(/min-width:\s*0/)
  })

  it('reserves room for the assistant orb at the end of phone pages', () => {
    const css = read('src/styles/ds/afandi.css')
    expect(css).toMatch(
      /body:has\(\.afd-launcher\) :is\(\.auth-foot, \.tq-footer, \.portal-content\) \{\s*padding-bottom:/
    )
  })
})
