// Rendering of issued documents: number order with Arabic-Indic digits, nothing dropped by the fixed-height layout,
// and the A5 highlight box chosen from what the template prints (no «المبلغ المستوفى 0»).
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import PDFDocument from 'pdfkit'
import { configureTestEnv } from './helpers'

configureTestEnv()

type Model = Awaited<ReturnType<(typeof import('../server/documents/samples.ts'))['sampleModel']>>
let sampleModel: (typeof import('../server/documents/samples.ts'))['sampleModel']
let renderDocumentPdf: (typeof import('../server/documents/render.ts'))['renderDocumentPdf']
let drawText: (typeof import('../server/documents/text.ts'))['drawText']
let registerDocumentFonts: (typeof import('../server/documents/text.ts'))['registerDocumentFonts']

type Proto = { text: (this: PDFKit.PDFDocument, value: string, ...rest: unknown[]) => PDFKit.PDFDocument }
const proto = PDFDocument.prototype as unknown as Proto
const originalText = proto.text
let fragments: string[] = []

beforeAll(async () => {
  ;({ sampleModel } = await import('../server/documents/samples.ts'))
  ;({ renderDocumentPdf } = await import('../server/documents/render.ts'))
  ;({ drawText, registerDocumentFonts } = await import('../server/documents/text.ts'))
  // every string pdfkit is asked to draw (one call per font segment / run)
  proto.text = function (value: string, ...rest: unknown[]) {
    fragments.push(String(value))
    return originalText.call(this, value, ...rest)
  }
})
afterEach(() => {
  fragments = []
})

async function render(model: Model) {
  fragments = []
  const pdf = await renderDocumentPdf(model)
  return { pdf, pages: (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || []).length, text: fragments }
}
const drawn = (text: string[], marker: string) => text.some(fragment => fragment.includes(marker))

describe('Arabic-Indic digits', () => {
  /** Glyphs of one drawText call, left to right as they appear on the page. */
  function visualGlyphs(value: string) {
    const pdf = new PDFDocument({ size: 'A4', margin: 0 })
    registerDocumentFonts(pdf)
    const calls: Array<{ x: number; glyphs: string }> = []
    const own = pdf as unknown as {
      text: (value: string, x: number, y: number, options?: { features?: string[] }) => unknown
      _font: { layout: (text: string, features?: string[]) => { glyphs: Array<{ codePoints: number[] }> } }
    }
    const draw = own.text.bind(pdf)
    own.text = (text, x, y, options) => {
      const laid = own._font.layout(text, options?.features)
      calls.push({ x, glyphs: laid.glyphs.map(glyph => String.fromCodePoint(...glyph.codePoints)).join('') })
      return draw(text, x, y, options)
    }
    drawText(pdf, value, 40, 40, { width: 420 })
    pdf.end()
    return calls
      .sort((a, b) => a.x - b.x)
      .map(call => call.glyphs)
      .join('|')
  }

  it('prints plot numbers and addresses in their real order', () => {
    const plot = visualGlyphs('رقم القطعة ١٤٥٢ / م ٢٧')
    expect(plot).toContain('1452')
    expect(plot).toContain('27')
    expect(plot).not.toMatch(/2541|٢٥٤١|72\|/)
    const address = visualGlyphs('محلة ١٢٣ زقاق ٤٥')
    expect(address).toContain('123')
    expect(address).toContain('45')
    expect(address).not.toMatch(/321|٣٢١/)
    // Persian digits too
    expect(visualGlyphs('دار رقم ۱۲۳')).toContain('123')
  })
})

describe('layout never drops content', () => {
  it('the finding: a paid shop licence with 4 details and 5 conditions prints the fee row and every condition', async () => {
    const base = sampleModel('shop-licence', { mode: 'ISSUED' })
    const model: Model = {
      ...base,
      district: 'قضاء الناصرية D1X',
      location: 'الناصرية — حي الشموخ، شارع 20، محلة 211 L1X',
      details: [
        { label: 'اسم المحل', value: 'أسواق الفرات للمواد الغذائية K1X' },
        { label: 'نوع النشاط', value: 'بيع المواد الغذائية بالمفرد والجملة K2X' },
        { label: 'نوع الإشغال', value: 'إيجار K3X' },
        { label: 'المساحة', value: '120 م2 K4X' },
      ],
      fees: { amountIqd: 50000, receiptNumber: '004571' },
      conditions: [...base.template.defaultConditions, 'يُراجع صاحب الإجازة شعبة الإجازات لاستلام اللوحة C5X.'],
    }
    const { text } = await render(model)
    for (const marker of ['D1X', 'L1X', 'K1X', 'K2X', 'K3X', 'K4X', '004571', 'C5X'])
      expect(drawn(text, marker)).toBe(true)
    // the fifth condition keeps its number
    expect(drawn(text, '5')).toBe(true)
  })

  it('content that cannot fit continues on an annex page instead of disappearing', async () => {
    const long = (marker: string) =>
      `${'نص طويل لاختبار التخطيط الديناميكي للوثيقة الرسمية وعدم إسقاط أي بيانات منها '.repeat(3)}${marker}`
    for (const id of ['building-permit', 'technical-approval', 'receipt']) {
      const base = sampleModel(id, { mode: 'ISSUED' })
      const model: Model = {
        ...base,
        details: [1, 2, 3, 4].map(index => ({ label: `تفصيل ${index}`, value: long(`R${index}Z`) })),
        conditions: [1, 2, 3, 4, 5, 6].map(index => long(`N${index}Z`)),
        fees: { amountIqd: 75000, receiptNumber: '998877' },
      }
      const { text, pages } = await render(model)
      for (const marker of ['R1Z', 'R2Z', 'R3Z', 'R4Z', 'N1Z', 'N2Z', 'N3Z', 'N4Z', 'N5Z', 'N6Z'])
        expect(drawn(text, marker), `${id}: ${marker}`).toBe(true)
      // the paid fee and its receipt number, wherever the template prints fees
      if (base.template.fields.includes('fees')) expect(drawn(text, '998877'), `${id}: receipt number`).toBe(true)
      expect(pages, id).toBeGreaterThanOrEqual(2)
    }
  }, 60_000)

  it('an identification card prints every condition (extra card page when needed)', async () => {
    const base = sampleModel('id-card', { mode: 'ISSUED' })
    const conditions = [1, 2, 3, 4, 5, 6].map(
      index => `شرط مخصص طويل لبطاقة العضوية يوضح التزامات حاملها أمام الدائرة المصدرة ومدة استعمالها W${index}Z`
    )
    const { text, pages } = await render({ ...base, conditions })
    for (const index of [1, 2, 3, 4, 5, 6]) expect(drawn(text, `W${index}Z`)).toBe(true)
    expect(pages).toBeGreaterThanOrEqual(3)
  })
})

describe('A5 highlight box', () => {
  it('a receipt without a collected fee shows no «المبلغ المستوفى 0»', async () => {
    const { text } = await render({ ...sampleModel('receipt', { mode: 'ISSUED' }), fees: null })
    expect(drawn(text, 'المبلغ المستوفى')).toBe(false)
    expect(text).not.toContain('0')
    const paid = await render({
      ...sampleModel('receipt', { mode: 'ISSUED' }),
      fees: { amountIqd: 25000, receiptNumber: '123' },
    })
    expect(drawn(paid.text, 'المبلغ المستوفى')).toBe(true)
    expect(drawn(paid.text, '25,000')).toBe(true)
  })

  it('an appointment notice prints the appointment, never a fee box, and is not issued without one', async () => {
    const base = sampleModel('appointment-notice', { mode: 'ISSUED' })
    const { text } = await render({ ...base, fees: { amountIqd: 10000, receiptNumber: '55' } })
    expect(drawn(text, 'موعد الحضور')).toBe(true)
    expect(drawn(text, '09:30')).toBe(true)
    expect(drawn(text, 'المبلغ المستوفى')).toBe(false)
    // the place note is printed in full (as a row), not cut to one line
    expect(drawn(text, 'شعبة الإصدار، الشباك')).toBe(true)
    await expect(renderDocumentPdf({ ...base, appointment: null })).rejects.toThrow(/appointment/)
    const preview = await render({ ...base, appointment: null, mode: 'PREVIEW' })
    expect(drawn(preview.text, 'المبلغ المستوفى')).toBe(false)
    expect(drawn(preview.text, 'يُحدَّد عند الموافقة')).toBe(true)
  })
})
