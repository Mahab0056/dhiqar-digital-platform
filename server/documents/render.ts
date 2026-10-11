import PDFDocument from 'pdfkit'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DocumentTemplate } from './templates.js'
import { clean, drawLatin, drawText, latinWidth, registerDocumentFonts, textWidth, wrapLines } from './text.js'
import { code128Png, diagonalStamp, drawQr, guilloche, microtext, rosette } from './security.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const brandDir = join(currentDir, '..', '..', 'public', 'brand')
const EMBLEM = join(brandDir, 'iraq-coat-of-arms.png')
const LOGO = join(brandDir, 'dhiqar-unified-logo.png')
const emblem = existsSync(EMBLEM) ? EMBLEM : null
const logo = existsSync(LOGO) ? LOGO : null

export type DocumentMode = 'ISSUED' | 'SAMPLE' | 'PREVIEW'

export type DocumentModel = {
  template: DocumentTemplate
  title: string
  serviceName: string
  departmentName: string
  holderName: string
  /** last four digits only — the full national ID never reaches a document */
  holderIdLast4: string | null
  reference: string | null
  district: string | null
  location: string | null
  details: Array<{ label: string; value: string }>
  conditions: string[]
  fees: { amountIqd: number; receiptNumber: string | null } | null
  signerTitle: string
  signerName: string | null
  documentNumber: string
  issuedAt: string
  expiresAt: string | null
  token: string
  manualCode: string
  appointment?: { date: string; time: string; place?: string | null } | null
  reason?: string | null
  referralTo?: string | null
  mode: DocumentMode
}

const C = {
  green: '#0B5D3B',
  greenDark: '#06402A',
  gold: '#A9823A',
  ink: '#18261F',
  muted: '#5B6C63',
  line: '#C4D3CA',
  tint: '#EEF5F0',
  mesh: '#CFE2D6',
  stamp: '#22408F',
  red: '#B3261E',
  amber: '#B26A00',
}

const A4 = { w: 595.28, h: 841.89 }
const A5L = { w: 595.28, h: 419.53 }
const CARD = { w: 242.65, h: 153.07 }

const MICRO = 'REPUBLIC OF IRAQ • DHI QAR GOVERNORATE • THI-QAR DIGITAL PLATFORM • SECURE OFFICIAL DOCUMENT'

const baghdad = (iso: string, options: Intl.DateTimeFormatOptions, locale = 'en-GB') =>
  new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Baghdad', ...options }).format(new Date(iso))
export const formatDate = (iso: string) => baghdad(iso, { day: '2-digit', month: '2-digit', year: 'numeric' })
/** Baghdad time of day, 24-hour ("14:05"). */
export const formatTime = (iso: string) =>
  baghdad(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).replace(/^24:/, '00:')
/** The approval line of every signature block: the platform, not a person, signs electronically. */
export const APPROVED_ELECTRONICALLY = 'اعتُمد إلكترونياً عبر منصة ذي قار الرقمية'
const approvalTime = (iso: string) => `في ${formatDate(iso)} الساعة ${formatTime(iso)} بتوقيت بغداد`
const hijri = (iso: string) => {
  try {
    return `${baghdad(iso, { day: 'numeric', month: 'long', year: 'numeric' }, 'ar-IQ-u-ca-islamic-umalqura-nu-latn').replace(/\s*هـ$/, '')} هـ`
  } catch {
    return ''
  }
}
const weekday = (date: string) =>
  new Intl.DateTimeFormat('ar-IQ', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))

const fill = (template: string, model: DocumentModel) =>
  template
    .replaceAll('{holder}', model.holderName)
    .replaceAll('{service}', model.serviceName.replace(/\s*\(.*?\)/g, '').trim())
    .replaceAll('{department}', model.departmentName)
    .replaceAll('{referral}', model.referralTo || 'الجهة المختصة')

const has = (model: DocumentModel, field: DocumentTemplate['fields'][number]) => model.template.fields.includes(field)

type Row = { label: string; value: string; latin?: boolean }

function rows(model: DocumentModel, options: { skipFees?: boolean } = {}) {
  const list: Row[] = [{ label: model.template.holderLabel, value: model.holderName }]
  if (has(model, 'nationalId') && model.holderIdLast4)
    list.push({ label: 'رقم البطاقة الوطنية', value: `•••• •••• ${model.holderIdLast4}`, latin: true })
  if (has(model, 'service')) list.push({ label: 'الخدمة', value: model.serviceName })
  if (has(model, 'referral') && model.referralTo) list.push({ label: 'الجهة المحال إليها', value: model.referralTo })
  if (has(model, 'reference') && model.reference)
    list.push({ label: 'رقم المعاملة', value: model.reference, latin: true })
  if (has(model, 'district') && model.district) list.push({ label: 'القضاء / الناحية', value: model.district })
  if (has(model, 'location') && model.location) list.push({ label: 'العنوان / الموقع', value: model.location })
  if (has(model, 'details')) for (const item of model.details.slice(0, 4)) list.push(item)
  if (!options.skipFees && has(model, 'fees') && model.fees && model.fees.amountIqd > 0)
    list.push({
      label: 'الرسم المستوفى',
      value: `${model.fees.amountIqd.toLocaleString('en-US')} دينار${model.fees.receiptNumber ? ` — وصل قبض رقم ${model.fees.receiptNumber}` : ''}`,
    })
  return list.filter(item => clean(item.value).length > 0)
}

// ---------------------------------------------------------------- shared pieces

function letterhead(
  pdf: PDFKit.PDFDocument,
  model: DocumentModel,
  page: { w: number },
  y: number,
  margin: number,
  left: 'logo' | 'numbers'
) {
  const right = page.w - margin
  const blockW = 205
  drawText(pdf, 'جمهورية العراق', right - blockW, y, { width: blockW, style: 'title', size: 12.5, color: C.ink })
  drawText(pdf, 'محافظة ذي قار', right - blockW, y + 22, { width: blockW, style: 'title', size: 11, color: C.green })
  drawText(pdf, model.departmentName, right - blockW, y + 42, {
    width: blockW,
    style: 'semibold',
    size: 9.5,
    color: C.ink,
    maxLines: 2,
    leading: 1.5,
  })
  if (emblem) pdf.image(emblem, page.w / 2 - 31, y - 4, { fit: [62, 72], align: 'center', valign: 'center' })
  if (left === 'logo') {
    if (logo) pdf.image(logo, margin - 6, y - 10, { fit: [78, 78] })
    return
  }
  const labelW = 54
  const lines: Array<[string, string, boolean]> = [
    ['العدد', model.documentNumber, true],
    ['التاريخ', formatDate(model.issuedAt), true],
    ['الموافق', hijri(model.issuedAt), false],
  ]
  lines.forEach(([label, value, latin], index) => {
    const rowY = y + 4 + index * 19
    drawText(pdf, `${label}:`, margin + 150, rowY, { width: labelW, style: 'semibold', size: 9, color: C.muted })
    if (latin)
      drawLatin(pdf, value, margin, rowY + 1, {
        size: 9.5,
        style: 'semibold',
        color: C.ink,
        width: 148,
        align: 'right',
      })
    else drawText(pdf, value, margin, rowY, { width: 148, size: 9, color: C.ink })
  })
}

function doubleRule(pdf: PDFKit.PDFDocument, x1: number, x2: number, y: number) {
  pdf.moveTo(x1, y).lineTo(x2, y).lineWidth(1.4).strokeColor(C.green).stroke()
  pdf
    .moveTo(x1, y + 3)
    .lineTo(x2, y + 3)
    .lineWidth(0.5)
    .strokeColor(C.gold)
    .stroke()
}

function ornament(pdf: PDFKit.PDFDocument, cx: number, y: number, half = 80) {
  pdf
    .moveTo(cx - half, y)
    .lineTo(cx - 9, y)
    .lineWidth(0.7)
    .strokeColor(C.gold)
    .stroke()
  pdf
    .moveTo(cx + 9, y)
    .lineTo(cx + half, y)
    .stroke()
  pdf.polygon([cx, y - 4], [cx + 5, y], [cx, y + 4], [cx - 5, y]).fill(C.gold)
}

// ---------------------------------------------------------------- data table + conditions (measured, never dropped)

type Numbered = { n: number; text: string }
type TableStyle = { labelW: number; size: number; minRow: number }
type FlowStyle = { table: TableStyle; list: number; gap: number; heading: string }
type Flow = { rows: Row[]; conditions: Numbered[] }

/** Values are clipped upstream (≤ 300 chars), so these caps are never reached in practice. */
const MAX_VALUE_LINES = 6
const MAX_CONDITION_LINES = 5
/** Reasons of a rejection decision: room for the longest note accepted (1,500 characters) on the first page. */
const MAX_REASON_LINES = 18
/** Type scales tried, largest first, before the remainder moves to a continuation page. */
const SCALES = [1, 0.93, 0.86, 0.8]
const MORE_NOTE_H = 16
const CARD_ITEM_LINES = 6

const numbered = (items: string[]): Numbered[] => items.map((text, index) => ({ n: index + 1, text }))
const latinRow = (row: Row) => Boolean(row.latin) && !/[؀-ۿ]/.test(row.value)

function measureRow(pdf: PDFKit.PDFDocument, row: Row, width: number, style: TableStyle) {
  const textW = width - style.labelW - 20
  const lines = latinRow(row)
    ? 1
    : Math.min(MAX_VALUE_LINES, Math.max(1, wrapLines(pdf, row.value, 'regular', style.size, textW).length))
  return { lines, height: Math.max(style.minRow, lines * style.size * 1.6 + 9) }
}

function measureCondition(pdf: PDFKit.PDFDocument, text: string, width: number, size: number) {
  const lines = Math.min(MAX_CONDITION_LINES, Math.max(1, wrapLines(pdf, text, 'regular', size, width - 22).length))
  return { lines, height: size * 1.6 * lines + 3 }
}

const headingHeight = (size: number) => size * 2.4

/** Draws rows top-down until `maxY`; the rows that do not fit are returned, never skipped. */
function table(
  pdf: PDFKit.PDFDocument,
  list: Row[],
  x: number,
  y: number,
  width: number,
  options: TableStyle,
  maxY: number
): { y: number; rest: Row[] } {
  let cursor = y
  const valueW = width - options.labelW
  for (const [index, row] of list.entries()) {
    const { lines, height } = measureRow(pdf, row, width, options)
    if (cursor + height > maxY) return { y: cursor, rest: list.slice(index) }
    pdf.save()
    pdf.rect(x, cursor, valueW, height).fillOpacity(0.88).fill('#FFFFFF')
    pdf.restore()
    pdf.rect(x + valueW, cursor, options.labelW, height).fill(C.tint)
    pdf.rect(x, cursor, width, height).lineWidth(0.5).strokeColor(C.line).stroke()
    pdf
      .moveTo(x + valueW, cursor)
      .lineTo(x + valueW, cursor + height)
      .stroke()
    const textTop = (h: number) => cursor + (height - h) / 2
    drawText(pdf, row.label, x + valueW + 8, textTop(options.size * 1.6), {
      width: options.labelW - 16,
      style: 'semibold',
      size: options.size - 0.5,
      color: C.greenDark,
      maxLines: 1,
    })
    if (latinRow(row))
      drawLatin(pdf, row.value, x + 10, textTop(options.size * 1.25) + 1, {
        size: options.size,
        style: 'semibold',
        color: C.ink,
        width: valueW - 20,
        align: 'right',
      })
    else
      drawText(pdf, row.value, x + 10, textTop(lines * options.size * 1.6), {
        width: valueW - 20,
        size: options.size,
        color: C.ink,
        maxLines: lines,
        leading: 1.6,
      })
    cursor += height
  }
  return { y: cursor, rest: [] }
}

/** Numbered conditions until `maxY` (numbers kept across pages); the ones that do not fit are returned. */
function conditionList(
  pdf: PDFKit.PDFDocument,
  items: Numbered[],
  heading: string,
  x: number,
  y: number,
  width: number,
  size: number,
  maxY: number
): { y: number; rest: Numbered[] } {
  if (!items.length) return { y, rest: [] }
  if (y + headingHeight(size) + measureCondition(pdf, items[0].text, width, size).height > maxY)
    return { y, rest: items }
  pdf.rect(x + width - 4, y + 4, 4, 12).fill(C.gold)
  drawText(pdf, heading, x, y, { width: width - 10, style: 'bold', size: size + 1.5, color: C.green, maxLines: 1 })
  let cursor = y + headingHeight(size)
  for (const [index, item] of items.entries()) {
    const { lines, height } = measureCondition(pdf, item.text, width, size)
    if (cursor + height > maxY) return { y: cursor, rest: items.slice(index) }
    const cx = x + width - 7
    pdf.circle(cx, cursor + size * 0.85, 6).fill(C.green)
    drawLatin(pdf, String(item.n), cx - 6, cursor + size * 0.85 - 3.6, {
      size: 7,
      style: 'bold',
      color: '#FFFFFF',
      width: 12,
      align: 'center',
    })
    drawText(pdf, item.text, x, cursor, { width: width - 22, size, color: C.ink, maxLines: lines, leading: 1.6 })
    cursor += height
  }
  return { y: cursor, rest: [] }
}

const scaledStyle = (style: FlowStyle, scale: number): FlowStyle => ({
  ...style,
  table: { labelW: style.table.labelW, size: style.table.size * scale, minRow: style.table.minRow * scale },
  list: style.list * scale,
  gap: style.gap * scale,
})

function flowHeight(pdf: PDFKit.PDFDocument, content: Flow, width: number, style: FlowStyle) {
  const tableH = content.rows.reduce((sum, row) => sum + measureRow(pdf, row, width, style.table).height, 0)
  if (!content.conditions.length) return tableH
  return (
    tableH +
    style.gap +
    headingHeight(style.list) +
    content.conditions.reduce((sum, item) => sum + measureCondition(pdf, item.text, width, style.list).height, 0)
  )
}

/**
 * The data table then the conditions inside [y, maxY]: the type shrinks step by step until everything fits. What
 * still does not fit at the smallest step is announced at the bottom and returned for continuation pages
 * (`continuationPages`), so no row or condition is ever left out of an issued document.
 */
function flow(
  pdf: PDFKit.PDFDocument,
  content: Flow,
  x: number,
  y: number,
  width: number,
  base: FlowStyle,
  maxY: number
): { y: number; rest: Flow } {
  const fitting = SCALES.map(scale => scaledStyle(base, scale)).find(
    style => y + flowHeight(pdf, content, width, style) <= maxY
  )
  const style = fitting || scaledStyle(base, SCALES[SCALES.length - 1])
  const limit = fitting ? maxY : maxY - MORE_NOTE_H
  const drawn = table(pdf, content.rows, x, y, width, style.table, limit)
  let cursor = drawn.y
  let conditions = content.conditions
  if (!drawn.rest.length && conditions.length) {
    const list = conditionList(pdf, conditions, base.heading, x, cursor + style.gap, width, style.list, limit)
    if (list.rest.length < conditions.length) cursor = list.y
    conditions = list.rest
  }
  const rest = { rows: drawn.rest, conditions }
  if (rest.rows.length || rest.conditions.length) {
    drawText(pdf, 'يتبع — بقية البيانات والشروط في ملحق هذه الوثيقة (الصفحة التالية).', x, limit + 2, {
      width,
      style: 'semibold',
      size: 8,
      color: C.amber,
      align: 'center',
      maxLines: 1,
    })
    cursor = limit + MORE_NOTE_H
  }
  return { y: cursor, rest }
}

/** Continuation pages ("ملحق") for whatever did not fit on the first page; same document number and footer. */
function continuationPages(
  pdf: PDFKit.PDFDocument,
  model: DocumentModel,
  page: { w: number; h: number },
  content: Flow,
  base: FlowStyle
) {
  let remaining = content
  let pageNo = 2
  while (remaining.rows.length || remaining.conditions.length) {
    pdf.addPage({ size: [page.w, page.h], margin: 0 })
    const compact = page.h < 500
    const m = compact ? 28 : 40
    const cw = page.w - m * 2
    pdf.rect(0, 0, page.w, page.h).fill('#FFFFFF')
    const outer = compact ? 9 : 13
    pdf
      .rect(outer, outer, page.w - outer * 2, page.h - outer * 2)
      .lineWidth(compact ? 1.8 : 2.6)
      .strokeColor(C.green)
      .stroke()
    pdf
      .rect(outer + 5, outer + 5, page.w - (outer + 5) * 2, page.h - (outer + 5) * 2)
      .lineWidth(0.6)
      .strokeColor(C.gold)
      .stroke()
    let y = compact ? 24 : 34
    drawText(pdf, 'جمهورية العراق — محافظة ذي قار', page.w - m - 280, y, {
      width: 280,
      style: 'title',
      size: compact ? 9.5 : 11,
      color: C.ink,
      maxLines: 1,
    })
    drawText(pdf, model.departmentName, page.w - m - 280, y + (compact ? 17 : 21), {
      width: 280,
      style: 'semibold',
      size: compact ? 8 : 9,
      color: C.ink,
      maxLines: 1,
    })
    drawLatin(pdf, model.documentNumber, m, y + 2, {
      size: compact ? 9 : 10,
      style: 'bold',
      color: C.green,
      width: 200,
      align: 'left',
    })
    drawText(pdf, `الصفحة ${pageNo}`, m, y + (compact ? 17 : 21), {
      width: 200,
      size: 8,
      color: C.muted,
      align: 'left',
      maxLines: 1,
    })
    y += compact ? 40 : 50
    doubleRule(pdf, m, page.w - m, y)
    y += 10
    drawText(pdf, `ملحق — ${model.title}`, m, y, {
      width: cw,
      style: 'title',
      size: compact ? 12.5 : 15,
      color: C.green,
      align: 'center',
      maxLines: 1,
    })
    y += compact ? 24 : 30
    y += drawText(
      pdf,
      `هذا الملحق جزء من الوثيقة رقم ${model.documentNumber} ولا يُعتدّ به منفصلاً عنها، ويُتحقق منها برمز التحقق المطبوع في صفحتها الأولى.`,
      m,
      y,
      { width: cw, size: compact ? 7.8 : 9, color: C.muted, align: 'center', maxLines: 2, leading: 1.5 }
    )
    y += 6
    const bottom = page.h - (compact ? 40 : 60)
    const drawn = table(pdf, remaining.rows, m, y, cw, base.table, bottom)
    let conditions = remaining.conditions
    if (!drawn.rest.length && conditions.length)
      conditions = conditionList(pdf, conditions, base.heading, m, drawn.y + base.gap, cw, base.list, bottom).rest
    microtext(pdf, m, page.h - (compact ? 33 : 48), cw, `${MICRO} • ${model.documentNumber}`, {
      color: C.green,
      size: compact ? 2.2 : undefined,
    })
    footerNote(pdf, m, page.h - (compact ? 29 : 42), cw, compact ? 6 : 7)
    modeOverlay(pdf, model, page, compact ? 0.62 : 1)
    if (drawn.rest.length === remaining.rows.length && conditions.length === remaining.conditions.length)
      // one entry taller than a whole page: refuse to issue rather than drop it (values are clipped, so unreachable)
      throw new Error('Document content does not fit on a continuation page.')
    remaining = { rows: drawn.rest, conditions }
    pageNo += 1
  }
}

/** Round electronic seal: rings, dotted band, emblem and short straight lines (no imitation of handwriting). */
function seal(pdf: PDFKit.PDFDocument, cx: number, cy: number, r: number, department: string) {
  const inner = r * 0.72
  pdf.save()
  pdf.rotate(-10, { origin: [cx, cy] })
  pdf.opacity(0.85)
  pdf.circle(cx, cy, r).lineWidth(1.8).strokeColor(C.stamp).stroke()
  pdf
    .circle(cx, cy, r - 3.5)
    .lineWidth(0.5)
    .stroke()
  pdf.circle(cx, cy, inner).lineWidth(0.8).stroke()
  // band between the rings: dots and four small diamonds
  for (let i = 0; i < 40; i += 1) {
    const angle = (i / 40) * Math.PI * 2
    const band = (r - 3.5 + inner) / 2
    if (i % 10 === 0) {
      const px = cx + Math.cos(angle) * band
      const py = cy + Math.sin(angle) * band
      pdf.polygon([px, py - 3], [px + 3, py], [px, py + 3], [px - 3, py]).fill(C.stamp)
    } else pdf.circle(cx + Math.cos(angle) * band, cy + Math.sin(angle) * band, 0.75).fill(C.stamp)
  }
  if (emblem) {
    pdf.opacity(0.3)
    pdf.image(emblem, cx - inner * 0.42, cy - inner * 0.5, {
      fit: [inner * 0.84, inner],
      align: 'center',
      valign: 'center',
    })
    pdf.opacity(0.88)
  }
  const w = inner * 1.7
  drawText(pdf, 'محافظة ذي قار', cx - w / 2, cy - inner * 0.78, {
    width: w,
    style: 'title',
    size: inner * 0.21,
    color: C.stamp,
    align: 'center',
    maxLines: 1,
  })
  drawText(pdf, department, cx - w / 2, cy - inner * 0.28, {
    width: w,
    style: 'bold',
    size: inner * 0.15,
    color: C.stamp,
    align: 'center',
    maxLines: 2,
    leading: 1.35,
  })
  drawText(pdf, 'ختم إلكتروني', cx - w / 2, cy + inner * 0.38, {
    width: w,
    style: 'bold',
    size: inner * 0.17,
    color: C.stamp,
    align: 'center',
    maxLines: 1,
  })
  pdf.restore()
}

/**
 * Signature block: the signing authority (title) and its department, a named signer only when the department
 * configured one, then the platform's electronic approval with its Baghdad date and time. Never the account of the
 * employee who approved: that stays in the internal record and the audit log.
 */
function signatureBlock(pdf: PDFKit.PDFDocument, model: DocumentModel, x: number, y: number, width: number) {
  let cy = y
  cy += drawText(pdf, model.signerTitle, x, cy, {
    width,
    style: 'bold',
    size: 11,
    color: C.ink,
    align: 'center',
    maxLines: 2,
    leading: 1.4,
  })
  cy += drawText(pdf, model.departmentName, x, cy, {
    width,
    style: 'semibold',
    size: 8,
    color: C.green,
    align: 'center',
    maxLines: 2,
    leading: 1.4,
  })
  if (model.signerName)
    cy += drawText(pdf, model.signerName, x, cy + 1, {
      width,
      size: 8.5,
      color: C.ink,
      align: 'center',
      maxLines: 1,
      leading: 1.5,
    })
  cy += 5
  pdf
    .moveTo(x + 18, cy)
    .lineTo(x + width - 18, cy)
    .dash(1.5, { space: 2 })
    .lineWidth(0.6)
    .strokeColor(C.muted)
    .stroke()
    .undash()
  cy += 4
  cy += drawText(pdf, APPROVED_ELECTRONICALLY, x, cy, {
    width,
    style: 'semibold',
    size: 7.5,
    color: C.green,
    align: 'center',
    maxLines: 2,
    leading: 1.4,
  })
  drawText(pdf, approvalTime(model.issuedAt), x, cy, {
    width,
    size: 7.2,
    color: C.muted,
    align: 'center',
    maxLines: 1,
    leading: 1.4,
  })
}

/** The same block in one narrow column (A5 receipts and notices). */
function compactSignature(pdf: PDFKit.PDFDocument, model: DocumentModel, x: number, y: number, width: number) {
  let cy = y
  const line = (text: string, size: number, color: string, style: 'regular' | 'semibold' | 'bold' = 'regular') => {
    cy += drawText(pdf, text, x, cy, { width, style, size, color, align: 'center', maxLines: 1, leading: 1.38 })
  }
  line(model.signerTitle, 8.6, C.ink, 'bold')
  line(model.departmentName, 6.6, C.green, 'semibold')
  if (model.signerName) line(model.signerName, 7, C.ink)
  line(APPROVED_ELECTRONICALLY, 6.3, C.green, 'semibold')
  line(approvalTime(model.issuedAt), 6.1, C.muted)
}

async function verificationBlock(
  pdf: PDFKit.PDFDocument,
  model: DocumentModel,
  box: { x: number; y: number; w: number },
  options: { qr: number; barcodeH: number; text: number }
) {
  const qrX = box.x + box.w - options.qr
  drawQr(pdf, model.token, qrX, box.y, options.qr, { color: C.greenDark, emblem })
  const textW = box.w - options.qr - 12
  let ty = box.y + 2
  ty += drawText(pdf, 'رمز تحقق مشفّر', box.x, ty, {
    width: textW,
    style: 'bold',
    size: options.text + 1.5,
    color: C.green,
  })
  ty += drawText(pdf, 'يُقرأ هذا الرمز من خلال ماسح منصة ذي قار الرقمية فقط، ولا يحمل أي بيانات شخصية.', box.x, ty, {
    width: textW,
    size: options.text,
    color: C.ink,
    maxLines: 3,
    leading: 1.5,
  })
  ty += 2
  drawLatin(pdf, 'www.thi-qar.com/verify', box.x, ty, {
    size: options.text,
    style: 'semibold',
    color: C.green,
    width: textW,
    align: 'right',
  })
  const barY = box.y + options.qr + 6
  const png = await code128Png(model.manualCode.replaceAll('-', ''))
  pdf.image(png, box.x, barY, { width: box.w, height: options.barcodeH })
  drawLatin(pdf, model.manualCode, box.x, barY + options.barcodeH + 2.5, {
    size: options.text,
    style: 'semibold',
    color: C.ink,
    width: box.w,
    align: 'center',
    characterSpacing: 1.2,
  })
}

function modeOverlay(pdf: PDFKit.PDFDocument, model: DocumentModel, page: { w: number; h: number }, scale = 1) {
  if (model.mode === 'ISSUED') return
  const sample = model.mode === 'SAMPLE'
  const label = sample ? 'نموذج — غير صالح للاستخدام' : 'مسودة معاينة — لم تصدر بعد'
  const color = sample ? C.red : C.amber
  pdf.save()
  pdf.fillOpacity(0.15)
  diagonalStamp(pdf, page, (x, y, width) => {
    drawText(pdf, label, x, y, { width, style: 'title', size: 38 * scale, color, align: 'center', maxLines: 1 })
  })
  pdf.restore()
  if (scale < 0.5) return
  pdf.save()
  const tagW = 150 * scale
  const tagH = 22 * scale
  pdf.roundedRect(page.w / 2 - tagW / 2, 4 * scale, tagW, tagH, 4 * scale).fill(color)
  drawText(
    pdf,
    sample ? 'نموذج للعرض — SPECIMEN' : 'معاينة قبل الإصدار — PREVIEW',
    page.w / 2 - tagW / 2,
    4 * scale + tagH * 0.12,
    {
      width: tagW,
      style: 'bold',
      size: 8.5 * scale,
      color: '#FFFFFF',
      align: 'center',
      maxLines: 1,
    }
  )
  pdf.restore()
}

function faintEmblem(pdf: PDFKit.PDFDocument, cx: number, cy: number, w: number, h: number, opacity = 0.05) {
  if (!emblem) return
  pdf.save()
  pdf.opacity(opacity)
  pdf.image(emblem, cx - w / 2, cy - h / 2, { fit: [w, h], align: 'center', valign: 'center' })
  pdf.restore()
}

function footerNote(pdf: PDFKit.PDFDocument, x: number, y: number, width: number, size = 7) {
  drawText(
    pdf,
    'وثيقة إلكترونية صادرة من منصة ذي قار الرقمية • أي حك أو تعديل أو نسخ يبطلها • التحقق من صحتها حصراً عبر المنصة',
    x,
    y,
    { width, size, color: C.muted, align: 'center', maxLines: 1 }
  )
}

// ---------------------------------------------------------------- families

async function certificate(pdf: PDFKit.PDFDocument, model: DocumentModel) {
  const { w, h } = A4
  pdf.rect(0, 0, w, h).fill('#FFFFFF')
  guilloche(pdf, { x: 20, y: 20, w: w - 40, h: h - 40 }, { color: C.mesh, spacing: 10, amplitude: 7, width: 0.25 })
  faintEmblem(pdf, w / 2, 470, 300, 350, 0.05)
  rosette(pdf, w / 2, 470, 150, { color: C.mesh, petals: 24, rings: 4, width: 0.25 })
  pdf
    .rect(13, 13, w - 26, h - 26)
    .lineWidth(2.6)
    .strokeColor(C.green)
    .stroke()
  pdf
    .rect(19, 19, w - 38, h - 38)
    .lineWidth(0.8)
    .strokeColor(C.gold)
    .stroke()
  for (const [cx, cy] of [
    [19, 19],
    [w - 19, 19],
    [19, h - 19],
    [w - 19, h - 19],
  ])
    rosette(pdf, cx, cy, 15, { color: C.gold, petals: 12, rings: 3, width: 0.35 })

  const m = 40
  const cw = w - m * 2
  letterhead(pdf, model, A4, 42, m, 'logo')
  doubleRule(pdf, m, w - m, 122)
  microtext(pdf, m, 129, cw, MICRO, { color: C.green })

  drawText(pdf, model.title, m, 140, {
    width: cw,
    style: 'title',
    size: model.title.length > 26 ? 21 : 25,
    color: C.green,
    align: 'center',
    maxLines: 1,
  })
  const enW = latinWidth(pdf, model.template.titleEn, 8.5, 'semibold', 2.4)
  drawLatin(pdf, model.template.titleEn, w / 2 - enW / 2, 187, {
    size: 8.5,
    style: 'semibold',
    color: C.gold,
    characterSpacing: 2.4,
  })
  ornament(pdf, w / 2, 204, 110)

  // serial strip
  const sy = 214
  const cells: Array<[string, string]> = [
    [model.template.numberLabel, model.documentNumber],
    ['تاريخ الإصدار', formatDate(model.issuedAt)],
    ['نافذة لغاية', model.expiresAt ? formatDate(model.expiresAt) : 'غير محددة المدة'],
  ]
  const cellW = cw / 3
  cells.forEach(([label, value], index) => {
    const x = w - m - cellW * (index + 1)
    pdf.save()
    pdf.rect(x, sy, cellW, 40).fillOpacity(0.92).fill('#FFFFFF')
    pdf.restore()
    pdf.rect(x, sy, cellW, 40).lineWidth(0.6).strokeColor(C.line).stroke()
    drawText(pdf, label, x, sy + 4, { width: cellW, size: 7.5, color: C.muted, align: 'center', maxLines: 1 })
    if (/[؀-ۿ]/.test(value))
      drawText(pdf, value, x, sy + 18, {
        width: cellW,
        style: 'semibold',
        size: 10.5,
        color: C.ink,
        align: 'center',
        maxLines: 1,
      })
    else
      drawLatin(pdf, value, x, sy + 21, {
        size: 11,
        style: 'bold',
        color: index === 0 ? C.green : C.ink,
        width: cellW,
        align: 'center',
      })
  })

  let y = sy + 48
  y += drawText(pdf, fill(model.template.preamble, model), m, y, {
    width: cw,
    size: 10.5,
    color: C.ink,
    justify: true,
    leading: 1.8,
    maxLines: 5,
  })
  y += 8
  const base: FlowStyle = {
    table: { labelW: 150, size: 9.6, minRow: 21 },
    list: 9,
    gap: 8,
    heading: 'الشروط والتعليمات',
  }
  const content: Flow = { rows: rows(model), conditions: has(model, 'conditions') ? numbered(model.conditions) : [] }
  const laid = flow(pdf, content, m, y, cw, base, 657)

  // bottom: seal + signature on the left, verification on the right
  seal(pdf, 92, 718, 42, model.departmentName)
  signatureBlock(pdf, model, 140, 668, 160)
  await verificationBlock(pdf, model, { x: 318, y: 660, w: w - m - 318 }, { qr: 86, barcodeH: 19, text: 7.6 })
  microtext(pdf, 28, 790, w - 56, `${MICRO} • ${model.documentNumber}`, { color: C.green })
  footerNote(pdf, 28, 797, w - 56)
  modeOverlay(pdf, model, A4)
  continuationPages(pdf, model, A4, laid.rest, base)
}

async function letter(pdf: PDFKit.PDFDocument, model: DocumentModel) {
  const { w, h } = A4
  pdf.rect(0, 0, w, h).fill('#FFFFFF')
  guilloche(
    pdf,
    { x: 0, y: 0, w, h: 10 },
    { color: '#2E7D57', spacing: 4, amplitude: 2.5, wavelength: 30, width: 0.35 }
  )
  pdf.rect(0, 10, w, 2).fill(C.gold)
  faintEmblem(pdf, w / 2, 450, 320, 370, 0.045)
  const m = 46
  const cw = w - m * 2
  letterhead(pdf, model, A4, 30, m, 'numbers')
  doubleRule(pdf, m, w - m, 112)
  microtext(pdf, m, 119, cw, MICRO, { color: C.green })

  let y = 132
  if (model.template.addressee) {
    y += drawText(pdf, fill(model.template.addressee, model), m, y, {
      width: cw,
      style: 'bold',
      size: 12,
      color: C.ink,
      maxLines: 1,
    })
    y += 2
  }
  const subject = `م / ${model.title}`
  const subjectW = Math.min(cw, textWidth(pdf, subject, 'title', 13))
  drawText(pdf, subject, m, y, { width: cw, style: 'title', size: 13, color: C.green, align: 'center', maxLines: 1 })
  pdf
    .moveTo(w / 2 - subjectW / 2, y + 25)
    .lineTo(w / 2 + subjectW / 2, y + 25)
    .lineWidth(0.8)
    .strokeColor(C.green)
    .stroke()
  y += 34
  y += drawText(pdf, 'تحية طيبة...', m, y, { width: cw, size: 10.5, color: C.ink })
  y += drawText(pdf, fill(model.template.preamble, model), m, y, {
    width: cw,
    size: 10.5,
    color: C.ink,
    justify: true,
    leading: 1.85,
    maxLines: 6,
  })
  y += 8
  if (has(model, 'reason') && model.reason) {
    // the reasons are the decision itself: measured and printed in full (a 1,500-character note fits; the rows
    // below continue on an annex page when they no longer do)
    const reasonSize = model.reason.length > 900 ? 9 : 10
    const reasonLines = Math.min(MAX_REASON_LINES, wrapLines(pdf, model.reason, 'regular', reasonSize, cw - 24).length)
    const reasonH = reasonLines * reasonSize * 1.6 + 30
    pdf.rect(m, y, cw, reasonH).fill('#FBEFEE')
    pdf.rect(w - m - 4, y, 4, reasonH).fill(C.red)
    drawText(pdf, 'أسباب القرار:', m + 12, y + 6, { width: cw - 24, style: 'bold', size: 10, color: C.red })
    drawText(pdf, model.reason, m + 12, y + 22, {
      width: cw - 24,
      size: reasonSize,
      color: C.ink,
      maxLines: reasonLines,
      leading: 1.6,
    })
    y += reasonH + 10
  }
  const base: FlowStyle = {
    table: { labelW: 140, size: 9.5, minRow: 23 },
    list: 9,
    gap: 10,
    heading: 'الشروط والملاحظات',
  }
  const laid = flow(
    pdf,
    { rows: rows(model), conditions: has(model, 'conditions') ? numbered(model.conditions) : [] },
    m,
    y,
    cw,
    base,
    588
  )
  y = laid.y
  if (model.template.closing) {
    y += 4
    y = Math.min(y, 592)
    y += drawText(pdf, model.template.closing, m, y, { width: cw, size: 10.5, color: C.ink })
  }

  const sigY = Math.min(612, Math.max(y + 26, 470))
  seal(pdf, m + 52, sigY + 50, 40, model.departmentName)
  signatureBlock(pdf, model, m + 96, sigY, 170)
  drawText(pdf, 'صورة عنه إلى:', w - m - 200, sigY + 4, { width: 200, style: 'bold', size: 9, color: C.ink })
  drawText(pdf, `- الأضبارة الإلكترونية للمعاملة ${model.reference || ''}`.trim(), w - m - 200, sigY + 22, {
    width: 200,
    size: 8.5,
    color: C.ink,
    maxLines: 1,
  })
  drawText(pdf, '- الصادرة / الأرشيف الإلكتروني', w - m - 200, sigY + 38, { width: 200, size: 8.5, color: C.ink })

  // verification strip
  const by = 712
  pdf.roundedRect(m, by, cw, 88, 6).fill('#F4F8F5')
  pdf.roundedRect(m, by, cw, 88, 6).lineWidth(0.6).strokeColor(C.line).stroke()
  const qr = 74
  drawQr(pdf, model.token, w - m - qr - 7, by + 7, qr, { color: C.greenDark, emblem })
  const tx = w / 2 - 20
  const tw = w - m - qr - 18 - tx
  let ty = by + 9
  ty += drawText(pdf, 'رمز تحقق مشفّر — للقراءة عبر المنصة فقط', tx, ty, {
    width: tw,
    style: 'bold',
    size: 9,
    color: C.green,
    maxLines: 1,
  })
  ty += drawText(
    pdf,
    'افتح www.thi-qar.com/verify وامسح الرمز بالكاميرا أو أدخل رمز التحقق اليدوي. لا يحمل الرمز أي بيانات شخصية.',
    tx,
    ty,
    {
      width: tw,
      size: 7.6,
      color: C.ink,
      maxLines: 3,
      leading: 1.5,
    }
  )
  const png = await code128Png(model.manualCode.replaceAll('-', ''))
  drawText(pdf, 'رمز التحقق اليدوي', m + 12, by + 9, { width: tx - m - 30, size: 7.5, color: C.muted, align: 'center' })
  pdf.image(png, m + 14, by + 26, { width: tx - m - 34, height: 30 })
  drawLatin(pdf, model.manualCode, m + 12, by + 62, {
    size: 9,
    style: 'bold',
    color: C.ink,
    width: tx - m - 30,
    align: 'center',
    characterSpacing: 1.3,
  })
  microtext(pdf, m, 806, cw, `${MICRO} • ${model.documentNumber}`, { color: C.green })
  footerNote(pdf, m, 812, cw)
  pdf.rect(0, h - 8, w, 8).fill(C.green)
  pdf.rect(0, h - 10, w, 2).fill(C.gold)
  modeOverlay(pdf, model, A4)
  continuationPages(pdf, model, A4, laid.rest, base)
}

async function receipt(pdf: PDFKit.PDFDocument, model: DocumentModel) {
  const { w, h } = A5L
  pdf.rect(0, 0, w, h).fill('#FFFFFF')
  guilloche(
    pdf,
    { x: 14, y: 14, w: w - 28, h: h - 28 },
    { color: C.mesh, spacing: 9, amplitude: 5, wavelength: 52, width: 0.22 }
  )
  faintEmblem(pdf, w / 2, 245, 180, 210, 0.05)
  pdf
    .rect(9, 9, w - 18, h - 18)
    .lineWidth(1.8)
    .strokeColor(C.green)
    .stroke()
  pdf
    .rect(14, 14, w - 28, h - 28)
    .lineWidth(0.6)
    .strokeColor(C.gold)
    .stroke()
  const m = 28
  const right = w - m
  drawText(pdf, 'جمهورية العراق', right - 190, 24, { width: 190, style: 'title', size: 10.5, color: C.ink })
  drawText(pdf, 'محافظة ذي قار', right - 190, 42, { width: 190, style: 'title', size: 9.5, color: C.green })
  drawText(pdf, model.departmentName, right - 190, 59, {
    width: 190,
    style: 'semibold',
    size: 8,
    color: C.ink,
    maxLines: 1,
  })
  if (emblem) pdf.image(emblem, w / 2 - 22, 20, { fit: [44, 52], align: 'center' })
  if (logo) pdf.image(logo, m - 6, 14, { fit: [64, 64] })
  doubleRule(pdf, m, right, 80)
  drawText(pdf, model.title, m, 88, {
    width: w - m * 2,
    style: 'title',
    size: 17,
    color: C.green,
    align: 'center',
    maxLines: 1,
  })
  const enW = latinWidth(pdf, model.template.titleEn, 7, 'semibold', 2)
  drawLatin(pdf, model.template.titleEn, w / 2 - enW / 2, 117, {
    size: 7,
    style: 'semibold',
    color: C.gold,
    characterSpacing: 2,
  })

  // number + date line
  drawText(pdf, `${model.template.numberLabel}:`, right - 70, 131, {
    width: 70,
    style: 'semibold',
    size: 8.5,
    color: C.muted,
  })
  drawLatin(pdf, model.documentNumber, right - 270, 132, {
    size: 10,
    style: 'bold',
    color: C.green,
    width: 196,
    align: 'right',
  })
  drawText(pdf, 'التاريخ:', m + 100, 131, { width: 50, style: 'semibold', size: 8.5, color: C.muted })
  drawLatin(pdf, formatDate(model.issuedAt), m, 132, {
    size: 10,
    style: 'bold',
    color: C.ink,
    width: 96,
    align: 'right',
  })

  // highlight box, chosen by what the template prints: the appointment of an appointment notice, the fee actually
  // collected on a receipt. Without that data there is no box (never an empty date or «0 دينار»).
  const box: 'appointment' | 'awaiting-appointment' | 'fees' | null =
    has(model, 'appointment') && model.appointment
      ? 'appointment'
      : model.template.requiresAppointment
        ? 'awaiting-appointment'
        : has(model, 'fees') && model.fees && model.fees.amountIqd > 0
          ? 'fees'
          : null
  if (box === 'awaiting-appointment' && model.mode === 'ISSUED')
    throw new Error('An appointment notice cannot be issued without an appointment.')
  const boxW = 150
  const tableX = box ? m + boxW + 12 : m
  const list = rows(model, { skipFees: box === 'fees' })
  if (box === 'appointment' && model.appointment?.place)
    list.push({ label: 'مكان / ملاحظة الموعد', value: model.appointment.place })
  const base: FlowStyle = {
    table: { labelW: box ? 112 : 130, size: 8.5, minRow: 20 },
    list: 7.8,
    gap: 6,
    heading: 'تعليمات',
  }
  const laid = flow(
    pdf,
    { rows: list, conditions: has(model, 'conditions') ? numbered(model.conditions) : [] },
    tableX,
    154,
    right - tableX,
    base,
    330
  )

  if (box) {
    pdf.roundedRect(m, 154, boxW, 120, 6).fill(C.tint)
    pdf.roundedRect(m, 154, boxW, 120, 6).lineWidth(0.8).strokeColor(C.green).stroke()
  }
  if (box === 'awaiting-appointment') {
    // preview / sample only (issuance requires the appointment, see above)
    drawText(pdf, 'موعد الحضور', m, 170, { width: boxW, style: 'bold', size: 10, color: C.green, align: 'center' })
    drawText(pdf, 'يُحدَّد عند الموافقة على الطلب', m + 8, 200, {
      width: boxW - 16,
      style: 'semibold',
      size: 9,
      color: C.amber,
      align: 'center',
      maxLines: 2,
      leading: 1.5,
    })
  } else if (box === 'appointment' && model.appointment) {
    drawText(pdf, 'موعد الحضور', m, 162, { width: boxW, style: 'bold', size: 10, color: C.green, align: 'center' })
    drawText(pdf, weekday(model.appointment.date), m, 182, {
      width: boxW,
      style: 'semibold',
      size: 11,
      color: C.ink,
      align: 'center',
    })
    drawLatin(pdf, formatDate(`${model.appointment.date}T09:00:00Z`), m, 207, {
      size: 17,
      style: 'bold',
      color: C.ink,
      width: boxW,
      align: 'center',
    })
    drawLatin(pdf, model.appointment.time, m, 236, {
      size: 15,
      style: 'bold',
      color: C.green,
      width: boxW,
      align: 'center',
    })
  } else if (box === 'fees' && model.fees) {
    drawText(pdf, 'المبلغ المستوفى', m, 164, { width: boxW, style: 'bold', size: 10, color: C.green, align: 'center' })
    drawLatin(pdf, model.fees.amountIqd.toLocaleString('en-US'), m, 190, {
      size: 24,
      style: 'bold',
      color: C.ink,
      width: boxW,
      align: 'center',
    })
    drawText(pdf, 'دينار عراقي', m, 222, { width: boxW, size: 9, color: C.muted, align: 'center' })
    if (model.fees?.receiptNumber)
      drawText(pdf, `وصل قبض رقم ${model.fees.receiptNumber}`, m, 243, {
        width: boxW,
        style: 'semibold',
        size: 8,
        color: C.ink,
        align: 'center',
        maxLines: 1,
      })
  }

  // bottom row: barcode | signer | QR
  const by = 336
  const png = await code128Png(model.manualCode.replaceAll('-', ''))
  pdf.image(png, m, by + 4, { width: 190, height: 26 })
  drawLatin(pdf, model.manualCode, m, by + 34, {
    size: 8,
    style: 'bold',
    color: C.ink,
    width: 190,
    align: 'center',
    characterSpacing: 1,
  })
  compactSignature(pdf, model, 226, by - 3, 142)
  const qr = 62
  drawQr(pdf, model.token, right - qr, by - 6, qr, { color: C.greenDark, emblem })
  drawText(pdf, 'رمز تحقق يُقرأ عبر منصة ذي قار الرقمية فقط', 372, by, {
    width: right - qr - 380,
    style: 'semibold',
    size: 7.5,
    color: C.green,
    maxLines: 2,
    leading: 1.45,
  })
  drawLatin(pdf, 'www.thi-qar.com/verify', 372, by + 28, {
    size: 7,
    color: C.ink,
    width: right - qr - 380,
    align: 'right',
  })
  microtext(pdf, 20, h - 33, w - 40, `${MICRO} • ${model.documentNumber}`, { color: C.green, size: 2.2 })
  footerNote(pdf, 20, h - 29, w - 40, 6)
  modeOverlay(pdf, model, A5L, 0.62)
  continuationPages(pdf, model, A5L, laid.rest, { ...base, table: { ...base.table, labelW: 130 } })
}

async function card(pdf: PDFKit.PDFDocument, model: DocumentModel) {
  const { w, h } = CARD
  // ---- front
  pdf.rect(0, 0, w, h).fill('#F5F9F6')
  guilloche(
    pdf,
    { x: 0, y: 30, w, h: h - 30 },
    { color: '#C9DED1', spacing: 5, amplitude: 3, wavelength: 34, width: 0.2 }
  )
  rosette(pdf, w - 46, h - 44, 34, { color: '#BFD8C8', petals: 16, rings: 3, width: 0.22 })
  pdf.rect(0, 0, w, 30).fill(C.green)
  guilloche(pdf, { x: 0, y: 0, w, h: 30 }, { color: '#1D7A52', spacing: 4, amplitude: 2, wavelength: 26, width: 0.25 })
  pdf.rect(0, 30, w, 1.6).fill(C.gold)
  if (emblem) pdf.image(emblem, 8, 3, { fit: [22, 25] })
  drawText(pdf, 'جمهورية العراق — محافظة ذي قار', 34, 3, {
    width: w - 42,
    style: 'title',
    size: 7.4,
    color: '#FFFFFF',
    maxLines: 1,
  })
  drawText(pdf, model.departmentName, 34, 16, { width: w - 42, size: 6, color: '#E3EFE7', maxLines: 1 })
  // photo placeholder
  pdf.roundedRect(10, 40, 50, 62, 3).fill('#FFFFFF')
  pdf.roundedRect(10, 40, 50, 62, 3).lineWidth(0.6).strokeColor(C.line).stroke()
  pdf.circle(35, 62, 11).fill('#A9BFB2')
  pdf.roundedRect(19, 76, 32, 26, 12).fill('#A9BFB2')
  pdf.rect(10, 96, 50, 6).fill('#FFFFFF')
  drawText(pdf, 'الصورة الشخصية', 10, 103, { width: 50, size: 4.6, color: C.muted, align: 'center', maxLines: 1 })
  drawText(pdf, model.title, 66, 35, { width: w - 76, style: 'title', size: 9.5, color: C.green, maxLines: 1 })
  const field = (label: string, value: string, x: number, y: number, width: number, latin = false) => {
    drawText(pdf, label, x, y, { width, size: 5, color: C.muted, maxLines: 1 })
    if (latin) drawLatin(pdf, value, x, y + 9, { size: 7.2, style: 'bold', color: C.ink, width, align: 'right' })
    else drawText(pdf, value, x, y + 7.5, { width, style: 'bold', size: 7.2, color: C.ink, maxLines: 1 })
  }
  field(model.template.holderLabel, model.holderName, 66, 54, w - 76)
  field(model.template.numberLabel, model.documentNumber, 66, 75, w - 76, true)
  field('تاريخ الإصدار', formatDate(model.issuedAt), 156, 96, 76, true)
  field('نافذة لغاية', model.expiresAt ? formatDate(model.expiresAt) : '—', 66, 96, 84, true)
  if (model.holderIdLast4)
    drawLatin(pdf, `ID •••• ${model.holderIdLast4}`, 10, 112, {
      size: 5.6,
      style: 'semibold',
      color: C.muted,
      width: 50,
      align: 'center',
    })
  microtext(pdf, 6, h - 17, w - 12, MICRO, { color: C.green, size: 1.9 })
  pdf.rect(0, h - 11, w, 11).fill(C.green)
  drawLatin(pdf, 'THI-QAR DIGITAL • IDENTIFICATION CARD', 0, h - 8.2, {
    size: 5,
    style: 'semibold',
    color: '#FFFFFF',
    width: w,
    align: 'center',
    characterSpacing: 1,
  })
  modeOverlay(pdf, model, CARD, 0.36)

  // ---- back
  pdf.addPage({ size: [w, h], margin: 0 })
  pdf.rect(0, 0, w, h).fill('#F5F9F6')
  guilloche(pdf, { x: 0, y: 0, w, h }, { color: '#CFE2D6', spacing: 5, amplitude: 3, wavelength: 34, width: 0.2 })
  pdf.rect(0, 0, w, 5).fill(C.green)
  pdf.rect(0, 5, w, 1.2).fill(C.gold)
  drawQr(pdf, model.token, 10, 14, 66, { color: C.greenDark, emblem })
  drawText(pdf, 'يُقرأ عبر منصة ذي قار الرقمية فقط', 6, 81, {
    width: 74,
    size: 4.6,
    color: C.green,
    align: 'center',
    maxLines: 1,
  })
  let y = 13
  y += drawText(pdf, 'شروط الاستعمال', 84, y, { width: w - 94, style: 'bold', size: 6.8, color: C.green })
  // every condition: the type shrinks to fit above the return note; anything left continues on an extra card page
  const cardItems = model.conditions.map(item => `• ${item}`)
  const itemHeights = (size: number, width: number) =>
    cardItems.map(item => Math.min(CARD_ITEM_LINES, wrapLines(pdf, item, 'regular', size, width).length) * size * 1.45)
  const cardBottom = 78
  const cardSize =
    [5.4, 5, 4.6].find(size => y + itemHeights(size, w - 94).reduce((sum, item) => sum + item, 0) <= cardBottom) ?? 4.6
  const cardHeights = itemHeights(cardSize, w - 94)
  const fitsAll = y + cardHeights.reduce((sum, item) => sum + item, 0) <= cardBottom
  let drawnItems = 0
  for (const [index, item] of cardItems.entries()) {
    if (y + cardHeights[index] > cardBottom - (fitsAll ? 0 : 7)) break
    y += drawText(pdf, item, 84, y, {
      width: w - 94,
      size: cardSize,
      color: C.ink,
      maxLines: CARD_ITEM_LINES,
      leading: 1.45,
    })
    drawnItems += 1
  }
  const cardRest = cardItems.slice(drawnItems)
  if (cardRest.length)
    y += drawText(pdf, 'يتبع في الصفحة التالية.', 84, y, {
      width: w - 94,
      style: 'semibold',
      size: 4.8,
      color: C.amber,
      maxLines: 1,
    })
  drawText(pdf, `عند العثور على البطاقة يُرجى تسليمها إلى ${model.departmentName}.`, 84, Math.max(y + 2, 70), {
    width: w - 94,
    size: 5,
    color: C.muted,
    maxLines: 2,
    leading: 1.4,
  })
  const signedY =
    95 +
    drawText(pdf, model.signerName ? `${model.signerTitle} — ${model.signerName}` : model.signerTitle, 84, 95, {
      width: w - 94,
      style: 'semibold',
      size: 5.4,
      color: C.ink,
      maxLines: 1,
      align: 'center',
      leading: 1.3,
    })
  drawText(pdf, `${APPROVED_ELECTRONICALLY} ${formatDate(model.issuedAt)}`, 84, signedY, {
    width: w - 94,
    size: 4.2,
    color: C.muted,
    maxLines: 1,
    align: 'center',
    leading: 1.3,
  })
  const png = await code128Png(model.manualCode.replaceAll('-', ''))
  pdf.image(png, 12, 110, { width: w - 24, height: 17 })
  drawLatin(pdf, model.manualCode, 0, 129, {
    size: 5.6,
    style: 'bold',
    color: C.ink,
    width: w,
    align: 'center',
    characterSpacing: 0.8,
  })
  microtext(pdf, 6, h - 15, w - 12, MICRO, { color: C.green, size: 1.9 })
  pdf.rect(0, h - 8, w, 8).fill(C.green)
  modeOverlay(pdf, model, CARD, 0.36)

  // ---- continuation (only with many long custom conditions)
  let pending = cardRest
  while (pending.length) {
    pdf.addPage({ size: [w, h], margin: 0 })
    pdf.rect(0, 0, w, h).fill('#F5F9F6')
    pdf.rect(0, 0, w, 5).fill(C.green)
    pdf.rect(0, 5, w, 1.2).fill(C.gold)
    drawLatin(pdf, model.documentNumber, 10, 13, {
      size: 5.6,
      style: 'semibold',
      color: C.ink,
      width: 110,
      align: 'left',
    })
    let cy = 11
    cy += drawText(pdf, 'تابع — شروط الاستعمال', 10, cy, {
      width: w - 20,
      style: 'bold',
      size: 6.8,
      color: C.green,
      maxLines: 1,
    })
    let drawn = 0
    for (const item of pending) {
      const height = Math.min(CARD_ITEM_LINES, wrapLines(pdf, item, 'regular', 5.4, w - 20).length) * 5.4 * 1.45
      if (cy + height > h - 20) break
      cy += drawText(pdf, item, 10, cy, {
        width: w - 20,
        size: 5.4,
        color: C.ink,
        maxLines: CARD_ITEM_LINES,
        leading: 1.45,
      })
      drawn += 1
    }
    microtext(pdf, 6, h - 15, w - 12, MICRO, { color: C.green, size: 1.9 })
    pdf.rect(0, h - 8, w, 8).fill(C.green)
    modeOverlay(pdf, model, CARD, 0.36)
    if (!drawn) throw new Error('Card condition does not fit on a page.')
    pending = pending.slice(drawn)
  }
}

function toBuffer(pdf: PDFKit.PDFDocument) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    pdf.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    pdf.on('error', reject)
  })
}

/** Renders one official document. Pure: no DB, no network — the model carries everything printed. */
export async function renderDocumentPdf(model: DocumentModel): Promise<Buffer> {
  const family = model.template.family
  const size = family === 'RECEIPT' ? [A5L.w, A5L.h] : family === 'CARD' ? [CARD.w, CARD.h] : 'A4'
  const pdf = new PDFDocument({
    size: size as PDFKit.PDFDocumentOptions['size'],
    margin: 0,
    info: {
      Title: model.title,
      Author: `محافظة ذي قار — ${model.departmentName}`,
      Subject: `${model.template.titleEn} ${model.documentNumber}`,
      Creator: 'Thi-Qar Digital Platform',
      Producer: 'TQD document service',
    },
  })
  const done = toBuffer(pdf)
  registerDocumentFonts(pdf)
  if (family === 'CERTIFICATE') await certificate(pdf, model)
  else if (family === 'LETTER') await letter(pdf, model)
  else if (family === 'RECEIPT') await receipt(pdf, model)
  else await card(pdf, model)
  pdf.end()
  return done
}
