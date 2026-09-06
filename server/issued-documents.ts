import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { db, nextReference } from './db.js'
import { storeEncryptedMedia } from './media.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const arabicFontPath = join(currentDir, 'assets', 'NotoSansArabic-Regular.ttf')
const iraqEmblemPath = join(currentDir, '..', 'public', 'brand', 'iraq-coat-of-arms.png')
const dhiqarLogoPath = join(currentDir, '..', 'public', 'brand', 'dhiqar-unified-logo.png')

export type IssuedDocumentSource = {
  sourceKind: 'APPLICATION' | 'SERVICE_REQUEST'
  applicationReference?: string
  serviceRequestReference?: string
  citizenId: number
  citizenName: string
  serviceName: string
  departmentName: string
  documentTitle: string
  issuedBy: string
  issuedAt: string
  details: Array<{ label: string; value: string }>
  preferredDocumentNumber?: string | null
  preferredVerificationId?: string | null
}

export type IssuedDocumentRecord = {
  id: string
  documentNumber: string
  verificationId: string
  pdfMediaId: string
  documentTitle: string
  serviceName: string
  departmentName: string
  issuedAt: string
  status: 'ACTIVE' | 'REVOKED'
}

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || 'http://localhost:5173').replace(/\/$/, '')
}

function sanitizePdfText(value: string, max = 220) {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

const ARABIC = /[\u0600-\u06FF]/
const ARABIC_CHAR = /[\u0600-\u06FF\s]/
const arabicFontAvailable = () => existsSync(arabicFontPath)

type Run = { arabic: boolean; text: string }

/** Splits a logical string into Arabic and non-Arabic runs (digits, Latin, symbols keep Helvetica). */
function runsOf(text: string): Run[] {
  const runs: Run[] = []
  const chars = [...text]
  chars.forEach((char, index) => {
    const last = runs[runs.length - 1]
    let arabic = ARABIC_CHAR.test(char)
    // punctuation glued to the previous token stays with it ("الإصدار:" / "12:07")
    if (last && /[:.,;!?،؛]/.test(char)) arabic = last.arabic
    if (/\s/.test(char)) {
      // whitespace between two Latin/number tokens keeps them in one LTR run ("06/09/2026 11:53");
      // any other whitespace belongs to the Arabic side so gaps survive around Latin runs
      const next = chars.slice(index + 1).find(item => !/\s/.test(item))
      arabic = !(last && !last.arabic && next !== undefined && !ARABIC_CHAR.test(next))
    }
    if (last && last.arabic === arabic) last.text += char
    else runs.push({ arabic, text: char })
  })
  // mirror brackets that end up inside an RTL line
  return runs.map(run =>
    run.arabic ? run : { ...run, text: run.text.replace(/[()]/g, char => (char === '(' ? ')' : '(')) }
  )
}

function runWidth(pdf: PDFKit.PDFDocument, run: Run) {
  pdf.font(run.arabic ? 'Arabic' : 'Helvetica')
  return pdf.widthOfString(run.text, run.arabic ? { features: ['rtla'] } : {})
}

/**
 * pdfkit shapes Arabic letters (fontkit) but has no bidi: multi-word Arabic prints backwards and Latin/digits
 * inside Arabic get reversed. This lays every line out by hand: logical line breaking, then runs placed
 * right-to-left, Arabic runs written with the `rtla` feature and everything else in Helvetica.
 */
function writeText(
  pdf: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  options: { width: number; align?: 'right' | 'center' | 'left'; lineGap?: number; maxLines?: number }
) {
  const clean = sanitizePdfText(text, 400)
  if (!ARABIC.test(clean) || !arabicFontAvailable()) {
    pdf.text(clean, x, y, { width: options.width, align: options.align || 'right', lineGap: options.lineGap, lineBreak: false })
    return
  }
  const fontSize = (pdf as unknown as { _fontSize: number })._fontSize
  const color = (pdf as unknown as { _fillColor?: unknown[] })._fillColor
  const measure = (value: string) => runsOf(value).reduce((sum, run) => sum + runWidth(pdf, run), 0)
  const words = clean.split(' ')
  const lines: string[] = []
  let current: string[] = []
  for (const word of words) {
    const candidate = [...current, word].join(' ')
    if (current.length && measure(candidate) > options.width) {
      lines.push(current.join(' '))
      current = [word]
    } else current.push(word)
  }
  if (current.length) lines.push(current.join(' '))
  const maxLines = options.maxLines || 6
  const shown = lines.slice(0, maxLines)
  pdf.font('Arabic')
  const lineHeight = pdf.currentLineHeight(true) + (options.lineGap || 0)
  // fonts have different ascenders: shift Helvetica runs so they share the Arabic baseline
  const ascender = () => (pdf as unknown as { _font: { ascender: number } })._font.ascender
  const arabicAscender = ascender()
  pdf.font('Helvetica')
  const latinShift = ((arabicAscender - ascender()) / 1000) * fontSize
  pdf.font('Arabic')
  shown.forEach((line, index) => {
    const value = index === shown.length - 1 && lines.length > maxLines ? `${line}…` : line
    const runs = runsOf(value).map(run => ({ ...run, width: runWidth(pdf, run) }))
    const total = runs.reduce((sum, run) => sum + run.width, 0)
    let cursor =
      options.align === 'center' ? x + options.width / 2 + total / 2 : options.align === 'left' ? x + total : x + options.width
    const lineY = y + index * lineHeight
    for (const run of runs) {
      cursor -= run.width
      pdf.font(run.arabic ? 'Arabic' : 'Helvetica').fontSize(fontSize)
      if (Array.isArray(color)) pdf.fillColor(color[0] as string)
      // no `width` here on purpose: with a width pdfkit routes the text through its LineWrapper, which
      // re-measures words without the rtla feature and can split a "too wide" Arabic word into LTR chunks
      pdf.text(run.text, cursor, run.arabic ? lineY : lineY + latinShift, {
        lineBreak: false,
        ...(run.arabic ? { features: ['rtla'] } : {}),
      })
    }
  })
  pdf.font('Arabic').fontSize(fontSize)
}

function uniqueDocumentNumber(prefix: string) {
  const year = new Date().getFullYear()
  const count = nextReference('issued_documents', 'SELECT COUNT(*) AS value FROM issued_documents')
  return `${prefix}-${year}-${String(count).padStart(6, '0')}`
}

function toBuffer(document: PDFKit.PDFDocument) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    document.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    document.on('end', () => resolve(Buffer.concat(chunks)))
    document.on('error', reject)
  })
}

async function renderIssuedDocumentPdf(input: IssuedDocumentSource, documentNumber: string, verificationId: string) {
  const pdf = new PDFDocument({
    size: 'A4',
    margin: 42,
    info: { Title: input.documentTitle, Author: 'ذي قار الرقمية', Subject: `Verification ${verificationId}` },
  })
  const bufferPromise = toBuffer(pdf)
  if (existsSync(arabicFontPath)) pdf.registerFont('Arabic', readFileSync(arabicFontPath))
  pdf.font(existsSync(arabicFontPath) ? 'Arabic' : 'Helvetica')
  const green = '#0A5137'
  const navy = '#173A50'
  const gold = '#BB8A35'
  pdf.rect(0, 0, 595, 18).fill(green)
  pdf.rect(0, 18, 595, 2).fill(gold)
  if (existsSync(iraqEmblemPath)) pdf.image(iraqEmblemPath, 48, 38, { fit: [43, 55] })
  if (existsSync(dhiqarLogoPath)) pdf.image(dhiqarLogoPath, 496, 43, { fit: [48, 48] })
  pdf.fillColor(navy).fontSize(14)
  writeText(pdf, 'جمهورية العراق', 110, 43, { align: 'right', width: 370 })
  pdf.fontSize(11).fillColor(green)
  writeText(pdf, 'محافظة ذي قار — المنصة الرقمية للخدمات', 110, 64, { align: 'right', width: 370 })
  pdf.fillColor('#5C6B64').fontSize(8)
  writeText(pdf, 'وثيقة إلكترونية مؤرشفة وقابلة للتحقق برمز QR', 110, 83, { align: 'right', width: 370 })
  pdf.moveTo(42, 108).lineTo(553, 108).strokeColor('#D9E6DE').lineWidth(1).stroke()
  pdf.fillColor(green).fontSize(17)
  writeText(pdf, sanitizePdfText(input.documentTitle, 100), 42, 128, { align: 'center', width: 511, maxLines: 1 })
  pdf.fillColor('#51645A').fontSize(9)
  writeText(pdf, 'إشعار اعتماد وإتمام معاملة ضمن سجل ذي قار الرقمية', 42, 154, { align: 'center', width: 511 })
  pdf.roundedRect(42, 182, 511, 55, 8).fill('#F1F7F3')
  pdf.font(existsSync(arabicFontPath) ? 'Arabic' : 'Helvetica').fillColor('#62746A').fontSize(8)
  writeText(pdf, 'رقم الوثيقة', 62, 196, { align: 'right', width: 195 })
  pdf.font('Helvetica').fillColor(green).fontSize(12).text(documentNumber, 62, 210, { align: 'right', width: 195, lineBreak: false })
  pdf.font(existsSync(arabicFontPath) ? 'Arabic' : 'Helvetica').fillColor('#62746A').fontSize(8)
  writeText(pdf, 'معرّف التحقق', 338, 196, { align: 'right', width: 195 })
  pdf.font('Helvetica').fillColor(green).fontSize(10).text(verificationId, 338, 211, { align: 'right', width: 195, lineBreak: false })
  const topDetails = [
    { label: 'صاحب الطلب', value: input.citizenName },
    { label: 'الخدمة', value: input.serviceName },
    { label: 'الدائرة المختصة', value: input.departmentName },
    { label: 'رقم المعاملة', value: input.applicationReference || input.serviceRequestReference || '—' },
    ...input.details,
  ]
    .filter(item => sanitizePdfText(item.value).length > 0)
    .slice(0, 8)
  let y = 258
  for (let index = 0; index < topDetails.length; index += 2) {
    const row = topDetails.slice(index, index + 2)
    for (let col = 0; col < 2; col += 1) {
      const item = row[col]
      if (!item) continue
      const x = col === 0 ? 42 : 304
      pdf.roundedRect(x, y, 249, 56, 6).lineWidth(0.6).strokeColor('#D7E3DB').stroke()
      pdf.font(existsSync(arabicFontPath) ? 'Arabic' : 'Helvetica').fillColor('#718178').fontSize(8)
      writeText(pdf, sanitizePdfText(item.label, 70), x + 12, y + 11, { align: 'right', width: 225, maxLines: 1 })
      const value = sanitizePdfText(item.value)
      pdf
        .font(/^[A-Za-z0-9 .:/_-]+$/.test(value) ? 'Helvetica' : existsSync(arabicFontPath) ? 'Arabic' : 'Helvetica')
        .fillColor('#173A50')
        .fontSize(10)
      writeText(pdf, value, x + 12, y + 27, { align: 'right', width: 225, maxLines: 2 })
    }
    y += 67
  }
  const qrData = await QRCode.toBuffer(`${publicBaseUrl()}/verify/${verificationId}`, {
    width: 190,
    margin: 1,
    color: { dark: green, light: '#FFFFFF' },
  })
  const footerY = Math.min(Math.max(y + 8, 500), 610)
  pdf.roundedRect(42, footerY, 511, 124, 8).fill('#F7FAF8')
  pdf.image(qrData, 64, footerY + 18, { fit: [82, 82] })
  pdf.font(existsSync(arabicFontPath) ? 'Arabic' : 'Helvetica').fillColor(green).fontSize(11)
  writeText(pdf, 'تحقق من الأصل الرقمي', 166, footerY + 28, { align: 'right', width: 350 })
  pdf.fillColor('#56685D').fontSize(9)
  writeText(pdf, 'امسح رمز QR أو أدخل معرّف التحقق في منصة ذي قار الرقمية لفتح ملف PDF الأصلي المؤرشف.', 166, footerY + 48, {
    align: 'right',
    width: 350,
    lineGap: 4,
  })
  pdf
    .font('Helvetica')
    .fillColor(navy)
    .fontSize(9)
    .text(verificationId, 166, footerY + 87, { align: 'right', width: 350, lineBreak: false })
  pdf.font(existsSync(arabicFontPath) ? 'Arabic' : 'Helvetica').fillColor('#5D6C64').fontSize(8)
  writeText(
    pdf,
    `تاريخ الإصدار: ${new Date(input.issuedAt).toLocaleString('en-GB')} • الاعتماد المسجل بواسطة: ${sanitizePdfText(input.issuedBy, 70)}`,
    42,
    750,
    { align: 'center', width: 511 }
  )
  pdf.fillColor('#6D7E74').fontSize(8)
  writeText(
    pdf,
    'هذه الوثيقة تثبت حالة الاعتماد المسجلة إلكترونياً في المنصة. تستكمل أي آثار قانونية أو تنظيمية وفق صلاحيات وتعليمات الجهة المختصة.',
    42,
    766,
    { align: 'center', width: 511 }
  )
  pdf.end()
  return bufferPromise
}

export async function createIssuedDocument(input: IssuedDocumentSource): Promise<IssuedDocumentRecord> {
  const referenceColumn = input.sourceKind === 'APPLICATION' ? 'application_reference' : 'service_request_reference'
  const reference = input.sourceKind === 'APPLICATION' ? input.applicationReference : input.serviceRequestReference
  if (!reference) throw new Error('Document source reference is required.')
  const existing = db
    .prepare(
      `SELECT id, document_number, verification_id, pdf_media_id, document_title, service_name, department_name, issued_at, status FROM issued_documents WHERE ${referenceColumn} = ?`
    )
    .get(reference) as Record<string, unknown> | undefined
  if (existing)
    return {
      id: String(existing.id),
      documentNumber: String(existing.document_number),
      verificationId: String(existing.verification_id),
      pdfMediaId: String(existing.pdf_media_id),
      documentTitle: String(existing.document_title),
      serviceName: String(existing.service_name),
      departmentName: String(existing.department_name),
      issuedAt: String(existing.issued_at),
      status: String(existing.status) as 'ACTIVE' | 'REVOKED',
    }
  const prefix = input.sourceKind === 'APPLICATION' ? 'TQD-LIC' : 'TQD-SVC'
  const documentNumber = input.preferredDocumentNumber || uniqueDocumentNumber(prefix)
  const verificationId =
    input.preferredVerificationId || `TQD-${randomUUID().replaceAll('-', '').slice(0, 18).toUpperCase()}`
  const pdfBuffer = await renderIssuedDocumentPdf(input, documentNumber, verificationId)
  const media = storeEncryptedMedia({
    citizenId: input.citizenId,
    purpose: 'ISSUED_DOCUMENT',
    originalName: `${documentNumber}.pdf`,
    mimeType: 'application/pdf',
    buffer: pdfBuffer,
    retentionPolicy: 'RETAINED_WITH_CONSENT',
    retentionConsentAt: input.issuedAt,
  })
  const id = `doc_${randomUUID().replaceAll('-', '')}`
  db.prepare(
    `INSERT INTO issued_documents (id, source_kind, application_reference, service_request_reference, citizen_id, service_name, department_name, document_title, document_number, verification_id, status, pdf_media_id, issued_by, issued_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.sourceKind,
    input.applicationReference || null,
    input.serviceRequestReference || null,
    input.citizenId,
    sanitizePdfText(input.serviceName, 180),
    sanitizePdfText(input.departmentName, 180),
    sanitizePdfText(input.documentTitle, 180),
    documentNumber,
    verificationId,
    media.id,
    sanitizePdfText(input.issuedBy, 120),
    input.issuedAt,
    input.issuedAt,
    input.issuedAt
  )
  return {
    id,
    documentNumber,
    verificationId,
    pdfMediaId: media.id,
    documentTitle: input.documentTitle,
    serviceName: input.serviceName,
    departmentName: input.departmentName,
    issuedAt: input.issuedAt,
    status: 'ACTIVE',
  }
}

export function getIssuedDocumentByVerificationId(verificationId: string) {
  return db
    .prepare(
      `SELECT d.*, c.full_name AS citizen_name FROM issued_documents d JOIN citizens c ON c.id = d.citizen_id WHERE d.verification_id = ?`
    )
    .get(verificationId) as Record<string, unknown> | undefined
}

export function listIssuedDocumentsForCitizen(citizenId: number) {
  return db
    .prepare(
      `SELECT id, source_kind, application_reference, service_request_reference, service_name, department_name, document_title, document_number, verification_id, status, issued_at, revoked_at, revoked_reason
    FROM issued_documents WHERE citizen_id = ? ORDER BY issued_at DESC`
    )
    .all(citizenId) as Array<Record<string, unknown>>
}

export function getIssuedDocumentForCitizen(id: string, citizenId: number) {
  return db.prepare('SELECT * FROM issued_documents WHERE id = ? AND citizen_id = ?').get(id, citizenId) as
    Record<string, unknown> | undefined
}

const employeeColumns = `id, source_kind, application_reference, service_request_reference, service_name, department_name, document_title, document_number, verification_id, status, issued_at`

export function listIssuedDocumentsForEmployee(scope?: { departmentName: string }) {
  return (
    scope
      ? db
          .prepare(`SELECT ${employeeColumns} FROM issued_documents WHERE department_name = ? ORDER BY issued_at DESC`)
          .all(scope.departmentName)
      : db.prepare(`SELECT ${employeeColumns} FROM issued_documents ORDER BY issued_at DESC`).all()
  ) as Array<Record<string, unknown>>
}

export function getIssuedDocumentForEmployee(id: string, scope?: { departmentName: string }) {
  const row = db.prepare('SELECT * FROM issued_documents WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (row && scope && String(row.department_name) !== scope.departmentName) return undefined
  return row
}
