import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

/**
 * Arabic text for pdfkit. pdfkit shapes Arabic through fontkit (a whole Arabic segment drawn in one call comes out
 * joined and in visual order) but has no bidi algorithm and no font fallback. This module adds both:
 * - a small RTL-paragraph bidi resolver: strong Arabic (R) / strong Latin+digits (L) / neutrals take the direction
 *   of their neighbours when both agree, otherwise the paragraph's (R);
 * - per-character font routing: Arabic-block glyphs come from the Arabic subset, everything else (digits, Latin,
 *   ASCII punctuation, symbols) from the matching Latin subset of the same family, sharing one baseline;
 * - its own line breaking (pdfkit's LineWrapper re-measures words without shaping and breaks RTL lines);
 * - Arabic-Indic digits typed by citizens/staff are printed as ASCII digits (see latinDigits).
 */

const currentDir = dirname(fileURLToPath(import.meta.url))
const fontDir = join(currentDir, 'fonts')
const legacyArabic = join(currentDir, '..', 'assets', 'NotoSansArabic-Regular.ttf')

export type TextStyle = 'regular' | 'semibold' | 'bold' | 'title'

const FONT_FILES: Record<TextStyle, { arabic: string; latin: string }> = {
  regular: {
    arabic: 'ibm-plex-sans-arabic-arabic-400-normal.woff',
    latin: 'ibm-plex-sans-arabic-latin-400-normal.woff',
  },
  semibold: {
    arabic: 'ibm-plex-sans-arabic-arabic-600-normal.woff',
    latin: 'ibm-plex-sans-arabic-latin-600-normal.woff',
  },
  bold: { arabic: 'ibm-plex-sans-arabic-arabic-700-normal.woff', latin: 'ibm-plex-sans-arabic-latin-700-normal.woff' },
  // Not Noto Kufi: it draws ق/ف, ح/ج (and other dotted pairs) as one dotless base glyph plus separate dot glyphs, and
  // a PDF maps each glyph to one text in its ToUnicode table — so the text layer of every title read «ف رار رف ض» for
  // «قرار رفض» and «محاف ظ ة ذ ي ف ار» for «محافظة ذي قار» (search, copy-paste, screen readers, archive indexing).
  // IBM Plex Sans Arabic has a glyph of its own for each letter form; ligatures (لا، تر …) map to their letters.
  title: { arabic: 'ibm-plex-sans-arabic-arabic-700-normal.woff', latin: 'ibm-plex-sans-arabic-latin-700-normal.woff' },
}

/**
 * WOFF 1.0 → plain sfnt (TTF/OTF), decompressed once with native zlib. fontkit reads a WOFF by re-inflating a table
 * (with a pure-JS inflater) every time it is accessed — for the glyph table that is once per glyph measured or
 * embedded — which made each render block the event loop for seconds. The glyph data is identical either way.
 */
export function woffToSfnt(woff: Buffer): Buffer {
  if (woff.length < 44 || woff.toString('latin1', 0, 4) !== 'wOFF') return woff
  const flavor = woff.readUInt32BE(4)
  const numTables = woff.readUInt16BE(12)
  const tables: Array<{ tag: number; checksum: number; data: Buffer }> = []
  for (let index = 0; index < numTables; index += 1) {
    const entry = 44 + index * 20
    const tag = woff.readUInt32BE(entry)
    const offset = woff.readUInt32BE(entry + 4)
    const compLength = woff.readUInt32BE(entry + 8)
    const origLength = woff.readUInt32BE(entry + 12)
    const checksum = woff.readUInt32BE(entry + 16)
    const raw = woff.subarray(offset, offset + compLength)
    const data = compLength < origLength ? inflateSync(raw) : Buffer.from(raw)
    if (data.length !== origLength) throw new Error('Corrupt WOFF table.')
    tables.push({ tag, checksum, data })
  }
  tables.sort((a, b) => a.tag - b.tag)
  const pad4 = (size: number) => (size + 3) & ~3
  const headerSize = 12 + numTables * 16
  const out = Buffer.alloc(headerSize + tables.reduce((sum, table) => sum + pad4(table.data.length), 0))
  const selector = Math.floor(Math.log2(Math.max(1, numTables)))
  const searchRange = 2 ** selector * 16
  out.writeUInt32BE(flavor, 0)
  out.writeUInt16BE(numTables, 4)
  out.writeUInt16BE(searchRange, 6)
  out.writeUInt16BE(selector, 8)
  out.writeUInt16BE(numTables * 16 - searchRange, 10)
  let offset = headerSize
  tables.forEach((table, index) => {
    const record = 12 + index * 16
    out.writeUInt32BE(table.tag, record)
    out.writeUInt32BE(table.checksum, record + 4)
    out.writeUInt32BE(offset, record + 8)
    out.writeUInt32BE(table.data.length, record + 12)
    table.data.copy(out, offset)
    offset += pad4(table.data.length)
  })
  return out
}

const fontCache = new Map<string, Buffer | null>()
const fontBuffer = (file: string) => {
  if (!fontCache.has(file)) {
    const path = join(fontDir, file)
    fontCache.set(file, existsSync(path) ? woffToSfnt(readFileSync(path)) : null)
  }
  return fontCache.get(file) || null
}

let legacyArabicBuffer: Buffer | null | undefined
const fallbackArabic = () => {
  if (legacyArabicBuffer === undefined)
    legacyArabicBuffer = existsSync(legacyArabic) ? readFileSync(legacyArabic) : null
  return legacyArabicBuffer
}

const arName = (style: TextStyle) => `doc-ar-${style}`
const laName = (style: TextStyle) => `doc-la-${style}`

/** Registers the document families on a fresh PDFDocument (falls back to Noto Sans Arabic + Helvetica). */
export function registerDocumentFonts(pdf: PDFKit.PDFDocument) {
  for (const style of Object.keys(FONT_FILES) as TextStyle[]) {
    const files = FONT_FILES[style]
    const arabic = fontBuffer(files.arabic) || fallbackArabic()
    if (arabic) pdf.registerFont(arName(style), arabic)
    else pdf.registerFont(arName(style), style === 'regular' ? 'Helvetica' : 'Helvetica-Bold')
    const latin = fontBuffer(files.latin)
    if (latin) pdf.registerFont(laName(style), latin)
    else pdf.registerFont(laName(style), style === 'regular' ? 'Helvetica' : 'Helvetica-Bold')
  }
  pdf.font(laName('regular'))
}

const ARABIC_BLOCK = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/
const ARABIC_DIGIT = /[٠-٩۰-۹]/
const LATIN_STRONG = /[A-Za-z0-9À-ɏ]/
const MIRROR: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
  '«': '»',
  '»': '«',
}

type Dir = 'R' | 'L'
type Segment = { text: string; arabicFont: boolean }
type Run = { dir: Dir; text: string }

const strongOf = (char: string): Dir | null =>
  ARABIC_BLOCK.test(char) && !ARABIC_DIGIT.test(char) && !/[،؛؟٫٬]/.test(char)
    ? 'R'
    : LATIN_STRONG.test(char) || ARABIC_DIGIT.test(char)
      ? 'L'
      : null

/** Resolves each character's direction for an RTL paragraph and groups them into directional runs (logical order). */
export function bidiRuns(text: string): Run[] {
  const chars = [...text]
  const strong = chars.map(strongOf)
  const resolved: Dir[] = chars.map((_, index) => {
    const own = strong[index]
    if (own) return own
    let before: Dir = 'R'
    for (let i = index - 1; i >= 0; i -= 1)
      if (strong[i]) {
        before = strong[i] as Dir
        break
      }
    let after: Dir = 'R'
    for (let i = index + 1; i < chars.length; i += 1)
      if (strong[i]) {
        after = strong[i] as Dir
        break
      }
    return before === after ? before : 'R'
  })
  const runs: Run[] = []
  chars.forEach((char, index) => {
    const last = runs[runs.length - 1]
    if (last && last.dir === resolved[index]) last.text += char
    else runs.push({ dir: resolved[index], text: char })
  })
  return runs
}

/** Splits a run into font segments: Arabic-block glyphs (with the spaces between them) vs. everything else. */
function segmentsOf(text: string): Segment[] {
  const segments: Segment[] = []
  for (const char of text) {
    const arabic = ARABIC_BLOCK.test(char) ? true : /\s/.test(char) ? null : false
    const last = segments[segments.length - 1]
    const kind = arabic === null ? (last ? last.arabicFont : true) : arabic
    if (last && last.arabicFont === kind) last.text += char
    else segments.push({ text: char, arabicFont: kind })
  }
  return segments
}

type Measured = { dir: Dir; width: number; segments: Array<Segment & { width: number; raw: string }> }

/**
 * Arabic segments must be laid out as one run: without explicit features pdfkit splits on spaces and concatenates
 * the words left-to-right (the classic "reversed words" bug). With any feature list it shapes the whole run.
 */
const shaping = (arabicFont: boolean) => (arabicFont ? { features: ['rtla'] as PDFKit.Mixins.OpenTypeFeatures[] } : {})

const fontState = (pdf: PDFKit.PDFDocument) => pdf as unknown as { _font: { ascender: number } }

function measureRuns(pdf: PDFKit.PDFDocument, text: string, style: TextStyle, size: number): Measured[] {
  return bidiRuns(text).map(run => {
    const segments = segmentsOf(run.text).map(segment => {
      const shown = run.dir === 'R' && !segment.arabicFont ? mirrorReverse(segment.text) : segment.text
      pdf.font(segment.arabicFont ? arName(style) : laName(style)).fontSize(size)
      return {
        ...segment,
        raw: segment.text,
        text: shown,
        width: pdf.widthOfString(shown, shaping(segment.arabicFont)),
      }
    })
    return { dir: run.dir, segments, width: segments.reduce((sum, item) => sum + item.width, 0) }
  })
}

/** A neutral (non-Arabic-font) chunk inside an RTL run is drawn reversed with mirrored brackets. */
function mirrorReverse(text: string) {
  return [...text]
    .reverse()
    .map(char => MIRROR[char] || char)
    .join('')
}

export function textWidth(pdf: PDFKit.PDFDocument, text: string, style: TextStyle, size: number) {
  return measureRuns(pdf, clean(text), style, size).reduce((sum, run) => sum + run.width, 0)
}

/**
 * Arabic-Indic (٠-٩) and Persian (۰-۹) digits as ASCII digits. They live in the Arabic block, so they would be drawn
 * with the Arabic face and its right-to-left shaping, which reverses every number ("١٤٥٢" printed as "٢٥٤١").
 * Every other number on the documents (dates, serials, fees) is printed in Latin digits too.
 */
export function latinDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
}

export function clean(value: string, max = 2000) {
  return latinDigits(String(value ?? ''))
    .replace(/[\u0000-\u001F\u007F‎‏‪-‮]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** Greedy word wrapping on shaped widths. A single word wider than the box is kept whole (rare: long codes). */
export function wrapLines(pdf: PDFKit.PDFDocument, text: string, style: TextStyle, size: number, width: number) {
  const words = clean(text).split(' ').filter(Boolean)
  const lines: string[] = []
  let current: string[] = []
  for (const word of words) {
    const candidate = [...current, word].join(' ')
    if (current.length && textWidth(pdf, candidate, style, size) > width) {
      lines.push(current.join(' '))
      current = [word]
    } else current.push(word)
  }
  if (current.length) lines.push(current.join(' '))
  return lines
}

export type DrawTextOptions = {
  width: number
  style?: TextStyle
  size?: number
  color?: string
  align?: 'right' | 'center' | 'left'
  /** line height as a multiple of the size (Arabic needs room for marks) */
  leading?: number
  maxLines?: number
  /** spread words to fill the width (all lines but the last) */
  justify?: boolean
}

/** Draws RTL/mixed text in a box whose top-left corner is (x, y). Returns the height used. */
export function drawText(pdf: PDFKit.PDFDocument, text: string, x: number, y: number, options: DrawTextOptions) {
  const style = options.style || 'regular'
  const size = options.size || 10
  const leading = options.leading || 1.65
  const value = clean(text)
  if (!value) return 0
  const all = wrapLines(pdf, value, style, size, options.width)
  const maxLines = options.maxLines || 40
  const lines = all.slice(0, maxLines)
  if (all.length > maxLines) lines[lines.length - 1] = `${lines[lines.length - 1]}…`
  pdf.font(arName(style)).fontSize(size)
  const arabicAscender = fontState(pdf)._font.ascender
  pdf.font(laName(style)).fontSize(size)
  const latinShift = ((arabicAscender - fontState(pdf)._font.ascender) / 1000) * size
  const lineHeight = size * leading
  lines.forEach((line, index) => {
    const runs = measureRuns(pdf, line, style, size)
    const natural = runs.reduce((sum, run) => sum + run.width, 0)
    const justify = options.justify && index < lines.length - 1 && natural > options.width * 0.75
    const gaps = justify ? Math.max(0, line.split(' ').length - 1) : 0
    const extra = gaps ? (options.width - natural) / gaps : 0
    const total = natural + extra * gaps
    let cursor =
      options.align === 'center'
        ? x + options.width / 2 + total / 2
        : options.align === 'left'
          ? x + total
          : x + options.width
    const lineY = y + index * lineHeight + (lineHeight - size * 1.2) / 2
    for (const run of runs) {
      if (justify && run.dir === 'R') {
        // justified RTL: place word by word so the extra space lands between words
        for (const word of splitKeepingSegments(run, (value, arabicFont) => {
          pdf.font(arabicFont ? arName(style) : laName(style)).fontSize(size)
          return pdf.widthOfString(value, shaping(arabicFont))
        })) {
          cursor -= word.width
          drawSegments(pdf, word.segments, cursor, lineY, style, size, latinShift, options.color, 'R')
          if (word.trailingSpace) cursor -= extra
        }
        continue
      }
      cursor -= run.width
      drawSegments(pdf, run.segments, cursor, lineY, style, size, latinShift, options.color, run.dir)
    }
  })
  return lines.length * lineHeight
}

function splitKeepingSegments(run: Measured, measure: (value: string, arabicFont: boolean) => number) {
  // re-split an RTL run into words (each word keeps its own font segments) so justification can add space
  const words: Array<{ width: number; segments: Measured['segments']; trailingSpace: boolean }> = []
  let current: { width: number; segments: Measured['segments']; trailingSpace: boolean } = {
    width: 0,
    segments: [],
    trailingSpace: false,
  }
  for (const segment of run.segments) {
    // split the logical text: a mirrored neutral chunk ("زوجة) إلى") must keep its bracket with the word before it
    for (const part of segment.raw.split(/( )/)) {
      if (!part) continue
      const shown = segment.arabicFont ? part : mirrorReverse(part)
      const width = measure(shown, segment.arabicFont)
      current.segments.push({ ...segment, raw: part, text: shown, width })
      current.width += width
      if (part === ' ') {
        current.trailingSpace = true
        words.push(current)
        current = { width: 0, segments: [], trailingSpace: false }
      }
    }
  }
  if (current.segments.length) words.push(current)
  return words
}

function drawSegments(
  pdf: PDFKit.PDFDocument,
  segments: Measured['segments'],
  x: number,
  y: number,
  style: TextStyle,
  size: number,
  latinShift: number,
  color: string | undefined,
  dir: Dir
) {
  // RTL: logical segments laid right-to-left; LTR: left-to-right
  let cursor = dir === 'R' ? x + segments.reduce((sum, item) => sum + item.width, 0) : x
  for (const segment of segments) {
    pdf.font(segment.arabicFont ? arName(style) : laName(style)).fontSize(size)
    if (color) pdf.fillColor(color)
    const width = pdf.widthOfString(segment.text, shaping(segment.arabicFont))
    const at = dir === 'R' ? cursor - width : cursor
    pdf.text(segment.text, at, segment.arabicFont ? y : y + latinShift, {
      lineBreak: false,
      ...shaping(segment.arabicFont),
    })
    cursor = dir === 'R' ? cursor - width : cursor + width
  }
}

/** Latin-only text (codes, serials, microtext) in the Latin face of a style. */
export function drawLatin(
  pdf: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  options: {
    size: number
    style?: TextStyle
    color?: string
    width?: number
    align?: 'left' | 'center' | 'right'
    characterSpacing?: number
  }
) {
  pdf.font(laName(options.style || 'regular')).fontSize(options.size)
  if (options.color) pdf.fillColor(options.color)
  pdf.text(latinDigits(text), x, y, {
    lineBreak: false,
    width: options.width,
    align: options.align,
    characterSpacing: options.characterSpacing,
  })
}

export function latinWidth(
  pdf: PDFKit.PDFDocument,
  text: string,
  size: number,
  style: TextStyle = 'regular',
  spacing = 0
) {
  pdf.font(laName(style)).fontSize(size)
  return pdf.widthOfString(latinDigits(text), { characterSpacing: spacing })
}
