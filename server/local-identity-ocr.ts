import { createWorker } from 'tesseract.js'
import type { IdentityAnalysisResult, IdentityDocumentType } from './identity-document-analysis.js'

let workerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null

function normaliseText(value: string) {
  return value
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/\s+/g, ' ')
    .trim()
}

async function getWorker() {
  if (!workerPromise) {
    const cachePath =
      process.env.IDENTITY_OCR_CACHE_PATH?.trim() ||
      `${process.env.RAILWAY_VOLUME_MOUNT_PATH || '/tmp'}/dhiqar-ocr-cache`
    workerPromise = createWorker(['ara', 'eng'], 1, {
      cachePath,
      logger: () => undefined,
    })
  }
  return workerPromise
}

function pickField(text: string, labels: string[]) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const normalized = normaliseText(line).toLowerCase()
    if (!labels.some(label => normalized.includes(label))) continue
    const afterSeparator = line
      .split(/[:：\-]/)
      .slice(1)
      .join(' ')
      .trim()
    if (afterSeparator.length >= 2) return afterSeparator.slice(0, 160)
    const afterLabel = labels
      .reduce((value, label) => value.replace(new RegExp(label, 'ig'), ''), line)
      .replace(/[\s:：\-–—|]+/g, ' ')
      .trim()
    if (afterLabel.length >= 2) return afterLabel.slice(0, 160)
    const next = lines[index + 1]?.trim() || ''
    if (next.length >= 2 && !labels.some(label => normaliseText(next).toLowerCase().includes(label)))
      return next.slice(0, 160)
  }
  return null
}

function inferFields(rawText: string, documentType: IdentityDocumentType) {
  const text = normaliseText(rawText)
  const lines = rawText
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length > 2)
  const candidateNumbers = (text.match(/(?<!\d)\d[\d\s-]{4,22}\d(?!\d)/g) || [])
    .map(value => value.replace(/[^0-9]/g, ''))
    .filter(value => value.length >= 6 && value.length <= 18)
  const nameFromLabel = pickField(rawText, ['الاسم الكامل', 'الاسم', 'name', 'surname', 'given'])
  const numberFromLabel =
    pickField(rawText, [
      'الرقم الوطني',
      'رقم الهوية',
      'رقم الجواز',
      'رقم الاجازة',
      'رقم الإجازة',
      'passport no',
      'document no',
    ])?.replace(/[^0-9A-Za-z-]/g, '') || null
  const nameFromLine =
    lines.find(line => {
      const normalized = normaliseText(line)
      const arabicCount = (normalized.match(/[ء-ي]/g) || []).length
      const hasDigit = /\d/.test(normalized)
      const generic = /(جمهورية|العراق|هوية|جواز|اجازة|الجنسية|تاريخ|وزارة|محافظة)/.test(normalized)
      return arabicCount >= 6 && !hasDigit && !generic
    }) || null
  const dateOfBirth =
    pickField(rawText, ['الميلاد', 'الولادة', 'birth', 'dob']) ||
    text.match(/(?:19|20)\d{2}[\/.\-]\d{1,2}[\/.\-]\d{1,2}/)?.[0] ||
    null
  const expiryDate = pickField(rawText, ['انتهاء', 'expiry', 'expire', 'valid until']) || null
  const nationality = /عراق|iraq|iraqi/i.test(text) ? 'عراقي' : null
  const sex = /(?:ذكر|male)\b/i.test(text) ? 'ذكر' : /(?:انثى|أنثى|female)\b/i.test(text) ? 'أنثى' : null
  return {
    fullName: (nameFromLabel || nameFromLine)?.slice(0, 160) || null,
    documentNumber: numberFromLabel || candidateNumbers.sort((a, b) => b.length - a.length)[0] || null,
    dateOfBirth: dateOfBirth?.slice(0, 40) || null,
    nationality,
    sex,
    expiryDate: expiryDate?.slice(0, 40) || null,
    documentTypeDetected: documentType,
  }
}

export async function analyzeIdentityDocumentLocally(input: {
  documentType: IdentityDocumentType
  documentImage: { buffer: Buffer; mimeType: string }
}): Promise<IdentityAnalysisResult> {
  try {
    const worker = await getWorker()
    const result = await worker.recognize(input.documentImage.buffer)
    const rawText = result.data.text || ''
    const fields = inferFields(rawText, input.documentType)
    const hasAnyField = Object.values(fields).some(value => value !== null)
    if (!hasAnyField) {
      return {
        status: 'NO_RESULT',
        reason: 'NO_DOCUMENT_RESULT',
        provider: 'محرك OCR محلي',
        confidence: null,
        fields: {
          fullName: null,
          documentNumber: null,
          dateOfBirth: null,
          nationality: null,
          sex: null,
          expiryDate: null,
        },
        documentTypeDetected: input.documentType,
        faceCrop: null,
        faceComparison: { status: 'MANUAL_REVIEW_REQUIRED', confidence: null },
      }
    }
    const confidence = Math.max(0, Math.min(1, Number(result.data.confidence || 0) / 100))
    return {
      status: 'COMPLETED',
      reason: 'COMPLETED',
      provider: 'محرك OCR محلي',
      confidence,
      fields: {
        fullName: fields.fullName,
        documentNumber: fields.documentNumber,
        dateOfBirth: fields.dateOfBirth,
        nationality: fields.nationality,
        sex: fields.sex,
        expiryDate: fields.expiryDate,
      },
      documentTypeDetected: fields.documentTypeDetected,
      faceCrop: null,
      faceComparison: { status: 'MANUAL_REVIEW_REQUIRED', confidence: null },
    }
  } catch {
    workerPromise = null
    return {
      status: 'PROVIDER_UNAVAILABLE',
      reason: 'PROVIDER_UNAVAILABLE',
      provider: 'محرك OCR محلي',
      confidence: null,
      fields: {
        fullName: null,
        documentNumber: null,
        dateOfBirth: null,
        nationality: null,
        sex: null,
        expiryDate: null,
      },
      documentTypeDetected: null,
      faceCrop: null,
      faceComparison: { status: 'MANUAL_REVIEW_REQUIRED', confidence: null },
    }
  }
}
