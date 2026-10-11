// Round-2 critic gaps: the text layer of issued PDFs, revoked documents on the citizen's side, and the sticky app
// top bar that let scrolled content show through.
import { readFileSync, readdirSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Router } from 'wouter'
import PDFDocument from 'pdfkit'
import request from 'supertest'
import type { Express } from 'express'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// ---- a minimal PDF text extractor --------------------------------------------------------------------------------
// It reads the text layer the way PDF viewers do (pdf.js, PDFium): each glyph is mapped through its font's ToUnicode
// table, glyphs come in the order they are drawn (visual, left to right), and a right-to-left run is reversed back
// into logical order — a ligature's letters (لا، تر …) kept in their logical order inside the glyph.

type PdfObject = { dict: string; stream: Buffer | null }

function pdfObjects(pdf: Buffer) {
  const source = pdf.toString('latin1')
  const objects = new Map<string, PdfObject>()
  const header = /(\d+) 0 obj\n/g
  let match: RegExpExecArray | null
  while ((match = header.exec(source))) {
    const start = match.index + match[0].length
    const streamAt = source.indexOf('\nstream\n', start)
    const endAt = source.indexOf('\nendobj', start)
    if (streamAt >= 0 && streamAt < endAt) {
      const dict = source.slice(start, streamAt)
      const length = Number(/\/Length (\d+)/.exec(dict)?.[1])
      const bytes = pdf.subarray(streamAt + 8, streamAt + 8 + length)
      objects.set(match[1], { dict, stream: /\/FlateDecode/.test(dict) ? inflateSync(bytes) : bytes })
      header.lastIndex = streamAt + 8 + length
    } else {
      objects.set(match[1], { dict: source.slice(start, endAt), stream: null })
      header.lastIndex = endAt
    }
  }
  return objects
}

/** UTF-16BE hex (whitespace inside the brackets is allowed: pdfkit writes a ligature as <0646 064a>) */
const utf16 = (hex: string) =>
  String.fromCharCode(...(hex.replace(/\s+/g, '').match(/.{4}/g) ?? []).map(unit => parseInt(unit, 16)))

function toUnicode(cmap: string) {
  const map = new Map<number, string>()
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const entry of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(\[[^\]]*\]|<[0-9a-f\s]*>)/gi)) {
      const from = parseInt(entry[1], 16)
      const to = parseInt(entry[2], 16)
      if (entry[3].startsWith('['))
        [...entry[3].matchAll(/<([0-9a-f\s]*)>/gi)].forEach((item, index) => map.set(from + index, utf16(item[1])))
      else {
        const base = parseInt(entry[3].slice(1, -1).replace(/\s+/g, ''), 16)
        for (let code = from; code <= to; code++) map.set(code, String.fromCharCode(base + code - from))
      }
    }
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const entry of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f\s]*)>/gi))
      map.set(parseInt(entry[1], 16), utf16(entry[2]))
  return map
}

const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/

/** One string per text object (one per pdfkit text() call), in logical order. */
function extractText(pdf: Buffer) {
  const objects = pdfObjects(pdf)
  const ref = (dict: string, key: string) => new RegExp(`/${key} (\\d+) 0 R`).exec(dict)?.[1]
  const out: Array<{ text: string; rtl: boolean }> = []
  for (const page of objects.values()) {
    if (!/\/Type \/Page\b(?!s)/.test(page.dict)) continue
    const resources = objects.get(ref(page.dict, 'Resources') ?? '')?.dict ?? ''
    const fonts = new Map<string, Map<number, string>>()
    for (const [, name, id] of /\/Font <<([^>]*)>>/.exec(resources)?.[1].matchAll(/\/(\w+) (\d+) 0 R/g) ?? []) {
      const cmap = objects.get(ref(objects.get(id)?.dict ?? '', 'ToUnicode') ?? '')?.stream
      if (cmap) fonts.set(name, toUnicode(cmap.toString('latin1')))
    }
    const content = objects.get(ref(page.dict, 'Contents') ?? '')?.stream?.toString('latin1') ?? ''
    for (const block of content.matchAll(/(?:^|\n)BT\n([\s\S]*?)\nET(?=\n|$)/g)) {
      let font: Map<number, string> | undefined
      const glyphs: string[] = []
      for (const op of block[1].matchAll(/\/(\w+) [\d.]+ Tf|\[([^\]]*)\] TJ|<([0-9a-f]*)> Tj/gi)) {
        if (op[1]) font = fonts.get(op[1])
        const hex = op[2] !== undefined ? [...op[2].matchAll(/<([0-9a-f]*)>/gi)].map(item => item[1]).join('') : op[3]
        for (const code of hex?.match(/.{4}/g) ?? []) glyphs.push(font?.get(parseInt(code, 16)) ?? '\uFFFD')
      }
      const rtl = glyphs.some(glyph => RTL.test(glyph))
      out.push({ text: rtl ? [...glyphs].reverse().join('') : glyphs.join(''), rtl })
    }
  }
  return out
}

describe('issued PDFs: the text layer reads back as the Arabic that was printed', () => {
  type Proto = { text: (this: PDFKit.PDFDocument, value: string, ...rest: unknown[]) => PDFKit.PDFDocument }
  const proto = PDFDocument.prototype as unknown as Proto
  const originalText = proto.text
  let drawn: string[] = []
  let sampleModel: (typeof import('../server/documents/samples.ts'))['sampleModel']
  let renderDocumentPdf: (typeof import('../server/documents/render.ts'))['renderDocumentPdf']
  let documentTemplates: (typeof import('../server/documents/templates.ts'))['documentTemplates']

  beforeAll(async () => {
    ;({ sampleModel } = await import('../server/documents/samples.ts'))
    ;({ renderDocumentPdf } = await import('../server/documents/render.ts'))
    ;({ documentTemplates } = await import('../server/documents/templates.ts'))
    proto.text = function (value: string, ...rest: unknown[]) {
      drawn.push(String(value))
      return originalText.call(this, value, ...rest)
    }
  })
  afterEach(() => {
    drawn = []
  })

  async function textOf(templateId: string) {
    drawn = []
    const pdf = await renderDocumentPdf(sampleModel(templateId, { mode: 'ISSUED' }))
    return { items: extractText(pdf), drawn: new Set(drawn) }
  }

  it('the finding: the rejection decision reads «قرار رفض» and «محافظة ذي قار» (title font), body words in order', async () => {
    const { items } = await textOf('rejection-decision')
    const text = items.map(item => item.text).join('\n')
    // Noto Kufi drew ق/ف and ح/ج on one shared base glyph: «ف رار رف ض», «محاف ظ ة ذ ي ف ار»
    expect(text).toContain('قرار رفض')
    expect(text).toContain('محافظة ذي قار')
    expect(text).toContain('جمهورية العراق')
    expect(text).not.toMatch(/فرار|ذي فار/)
    // ligatures and joined letters come back in order
    expect(text).toContain('الشروط والملاحظات')
    expect(text).toContain('عبر المنصة')
    expect(text).toContain('إلكتروني')
  })

  it('the referral letter reads «كتاب إحالة»', async () => {
    const text = (await textOf('referral-letter')).items.map(item => item.text).join('\n')
    expect(text).toContain('كتاب إحالة')
    expect(text).toContain('محافظة ذي قار')
  })

  it('every Arabic text run of every template reads back as drawn (letters and their order)', async () => {
    // harakat are compared apart: a mark inside a ligature («شَر» drawn as one glyph plus its fatha) can only be
    // placed before or after the ligature's letters by any glyph-level text layer
    const letters = (value: string) => value.replace(/[\u064B-\u065F\u0670]/g, '')
    for (const template of documentTemplates) {
      const { items, drawn: strings } = await textOf(template.id)
      const printed = new Set([...strings].map(letters))
      const arabic = items.filter(item => item.rtl)
      expect(arabic.length, template.id).toBeGreaterThan(5)
      for (const item of arabic)
        expect(printed.has(letters(item.text)), `${template.id}: «${item.text}» is not a run that was printed`).toBe(
          true
        )
    }
  }, 120_000)
})

// ---- revoked documents on the citizen's side -----------------------------------------------------------------------

describe('revoked documents: the citizen gets «تحقق», never a clean PDF', () => {
  it('the archive row of a revoked document offers verification only (no «معاينة PDF» / «تنزيل PDF»)', async () => {
    const { CitizenPdfActions } = await import('../src/components/citizen/CitizenPdfActions.tsx')
    const render = (status: string) =>
      renderToStaticMarkup(
        createElement(
          Router,
          { ssrPath: '/citizen' },
          createElement(CitizenPdfActions, {
            document: {
              status,
              pdfUrl: '/api/citizen/issued-documents/7/pdf',
              pdfDownloadUrl: '/api/citizen/issued-documents/7/pdf?download=1',
              verificationId: 'TQD1.ABC',
            },
            compact: true,
          })
        )
      )
    const active = render('ACTIVE')
    expect(active).toContain('معاينة PDF')
    expect(active).toContain('تنزيل PDF')
    expect(active).toContain('/verify/TQD1.ABC')
    const revoked = render('REVOKED')
    expect(revoked).not.toContain('معاينة PDF')
    expect(revoked).not.toContain('تنزيل PDF')
    expect(revoked).not.toContain('/pdf')
    expect(revoked).toContain('تحقق')
    expect(revoked).toContain('/verify/TQD1.ABC')
    // the request page uses the same actions (it used to inline its own preview/download links)
    const page = read('src/pages/citizen/ServiceRequestPage.tsx')
    expect(page).toContain('<CitizenPdfActions document={document} compact />')
    expect(page).not.toMatch(/href=\{document\.pdfUrl\}/)
  })

  let app: Express
  let admin = ''
  let citizen = ''
  let clerk = ''
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)])
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])
  const db = async () => (await import('../server/db.ts')).db

  async function staffLogin(username: string, password: string) {
    const response = await request(app).post('/api/auth/staff/login').send({ username, password })
    expect(response.status).toBe(200)
    return cookieOf(response)
  }

  async function issue() {
    const service = (await request(app).get('/api/services/gov-low-cost-housing')).body as {
      fields: Array<{ key: string; type: string; options?: string[]; maxLength?: number }>
      requiredDocuments: Array<{ key: string }>
    }
    const value = (field: { type: string; options?: string[]; maxLength?: number }) =>
      field.options?.length
        ? field.options[0]
        : field.type === 'tel'
          ? '07701234567'
          : field.type === 'email'
            ? 'qa@example.com'
            : field.type === 'number'
              ? '4'
              : field.type === 'date'
                ? new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
                : field.type === 'time'
                  ? '10:30'
                  : 'بيانات اختبار'.slice(0, field.maxLength || 160)
    let submit = request(app)
      .post('/api/service-requests')
      .set('Cookie', citizen)
      .field('serviceKey', 'gov-low-cost-housing')
      .field('data', JSON.stringify(Object.fromEntries(service.fields.map(field => [field.key, value(field)]))))
      .field('faceConsent', 'true')
      .field('documentConsent', 'true')
    for (const doc of service.requiredDocuments)
      submit = submit.attach(`doc__${doc.key}`, pdf, { filename: `${doc.key}.pdf`, contentType: 'application/pdf' })
    const submitted = await submit.attach('faceVideo', webm, { filename: 'face.webm', contentType: 'video/webm' })
    expect(submitted.status).toBe(201)
    const reference = submitted.body.reference as string
    const view = await request(app).get(`/api/employee/service-requests/${reference}`).set('Cookie', clerk)
    for (const item of view.body.checklist as Array<{ key: string; mediaId: string | null; status: string }>) {
      if (!item.mediaId || item.status === 'VERIFIED') continue
      await request(app)
        .patch(`/api/employee/service-requests/${reference}/documents/${item.key}`)
        .set('Cookie', clerk)
        .send({ status: 'VERIFIED' })
    }
    const decided = await request(app)
      .patch(`/api/employee/service-requests/${reference}`)
      .set('Cookie', clerk)
      .send({ status: 'APPROVED', decisionNote: 'يُراجع المواطن لاستلام الأصل.' })
    expect(decided.status).toBe(200)
    const row = (await db())
      .prepare('SELECT id FROM issued_documents WHERE service_request_reference = ?')
      .get(reference) as { id: number | string }
    return String(row.id)
  }

  beforeAll(async () => {
    const { createPlatformServer } = await import('../server/create-server.ts')
    app = createPlatformServer({ serveStatic: false }).app
    admin = await staffLogin('admin', 'Bootstrap-Admin-Pass-2026!')
    await request(app)
      .post('/api/auth/staff/change-password')
      .set('Cookie', admin)
      .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Admin-Rotated-Pass-2026!' })
    admin = await staffLogin('admin', 'Admin-Rotated-Pass-2026!')
    const otp = await request(app).post('/api/onboarding/request-otp').send({ phone: '07801239377' })
    const verified = await request(app)
      .post('/api/onboarding/verify-phone')
      .send({ phone: '07801239377', challengeId: otp.body.challengeId, otp: '246810' })
    citizen = cookieOf(verified)
    ;(await db())
      .prepare(`UPDATE citizens SET verification_status = 'VERIFIED_MANUAL', national_id_masked = '199012345678 4821'`)
      .run()
    const created = await request(app).post('/api/super-admin/staff').set('Cookie', admin).send({
      username: 'gaps.gov.clerk',
      fullName: 'Test clerk',
      role: 'EMPLOYEE',
      departmentId: 'dhiqar-governorate',
    })
    expect(created.status).toBe(201)
    const first = await staffLogin('gaps.gov.clerk', created.body.temporaryPassword)
    await request(app)
      .post('/api/auth/staff/change-password')
      .set('Cookie', first)
      .send({ currentPassword: created.body.temporaryPassword, newPassword: 'Rotated-gaps-clerk-2026!' })
    clerk = await staffLogin('gaps.gov.clerk', 'Rotated-gaps-clerk-2026!')
  }, 120_000)

  it('the citizen PDF route refuses a revoked document (preview and download), audits it, and still serves active ones', async () => {
    const active = await issue()
    const revokedId = await issue()
    const revoke = await request(app)
      .post(`/api/employee/issued-documents/${revokedId}/revoke`)
      .set('Cookie', clerk)
      .send({ reason: 'صدرت بالخطأ' })
    expect(revoke.status).toBe(200)

    for (const suffix of ['', '?download=1']) {
      const refused = await request(app)
        .get(`/api/citizen/issued-documents/${revokedId}/pdf${suffix}`)
        .set('Cookie', citizen)
      expect(refused.status).toBe(410)
      expect(refused.body.code).toBe('DOCUMENT_REVOKED')
      expect(String(refused.headers['content-type'])).not.toContain('application/pdf')
      expect(String(refused.text)).not.toContain('%PDF')
    }
    const audited = (await db())
      .prepare(
        `SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'REVOKED_DOCUMENT_PDF_REFUSED' AND entity_id = ?`
      )
      .get(revokedId) as { count: number }
    expect(audited.count).toBe(2)

    const served = await request(app).get(`/api/citizen/issued-documents/${active}/pdf`).set('Cookie', citizen)
    expect(served.status).toBe(200)
    expect(served.headers['content-type']).toContain('application/pdf')

    // the archive still lists it — as revoked — so the dashboard can show it under «وثائق ملغاة»
    const mine = await request(app).get('/api/citizen/issued-documents').set('Cookie', citizen)
    const listed = (mine.body as Array<{ id: string; status: string }>).find(item => item.id === revokedId)
    expect(listed?.status).toBe('REVOKED')
  }, 120_000)
})

// ---- the sticky app top bar -----------------------------------------------------------------------------------------

describe('app top bar: opaque, so scrolled content never shows through it', () => {
  type Rule = { selector: string; body: string }
  const rules = (css: string): Rule[] => {
    const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const out: Rule[] = []
    let index = 0
    while (index < source.length) {
      const open = source.indexOf('{', index)
      if (open === -1) break
      const prelude = source.slice(index, open).trim()
      let depth = 1
      let close = open + 1
      while (close < source.length && depth > 0) {
        if (source[close] === '{') depth++
        else if (source[close] === '}') depth--
        close++
      }
      const body = source.slice(open + 1, close - 1)
      if (prelude.startsWith('@media') || prelude.startsWith('@supports')) out.push(...rules(body))
      else if (!prelude.startsWith('@')) out.push({ selector: prelude.replace(/\s+/g, ' '), body })
      index = close
    }
    return out
  }
  const decl = (body: string, property: string) =>
    body
      .match(new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;]+);`))?.[1]
      .replace(/\s+/g, ' ')
      .trim()

  it('the finding: .app-topbar paints the surface colour, with no see-through mix or backdrop blur', () => {
    const topbar = rules(read('src/styles/ds/app.css')).find(item => item.selector === '.app-topbar')
    expect(topbar).toBeDefined()
    expect(decl(topbar!.body, 'background')).toBe('var(--ds-surface)')
    expect(topbar!.body).not.toMatch(/backdrop-filter/)
    expect(decl(topbar!.body, 'position')).toBe('sticky')
  })

  it('no stylesheet makes the top bar translucent again', () => {
    const files = [
      ...readdirSync(new URL('../src/styles', import.meta.url))
        .filter(name => name.endsWith('.css'))
        .map(name => `src/styles/${name}`),
      ...readdirSync(new URL('../src/styles/ds', import.meta.url))
        .filter(name => name.endsWith('.css'))
        .map(name => `src/styles/ds/${name}`),
    ]
    for (const file of files)
      for (const item of rules(read(file)).filter(entry => /\.app-topbar(?![\w-])/.test(entry.selector))) {
        const background = `${decl(item.body, 'background') ?? ''} ${decl(item.body, 'background-color') ?? ''}`
        expect(background, `${file} ${item.selector}`).not.toMatch(
          /transparent|color-mix|rgba?\([^)]*,\s*0?\.\d|\/\s*0?\.\d/
        )
        expect(item.body, `${file} ${item.selector}`).not.toMatch(/backdrop-filter|opacity:/)
      }
  })
})
