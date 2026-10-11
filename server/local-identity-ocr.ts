import { createWorker } from 'tesseract.js'
import type { IdentityAnalysisResult, IdentityDocumentType } from './identity-document-analysis.js'
import { mrzReadStatus, parseTd1, type MrzReadStatus, type Td1 } from './mrz.js'

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
    const langPath = process.env.IDENTITY_OCR_LANG_PATH?.trim() || undefined
    workerPromise = createWorker(['ara', 'eng'], 1, {
      cachePath,
      ...(langPath ? { langPath, gzip: false } : {}),
      logger: () => undefined,
      // a worker-thread error (e.g. traineddata download failure) must never bubble up as an uncaught exception
      errorHandler: (error: unknown) => {
        console.error('[ocr] worker error', error)
        workerPromise = null
      },
    }).catch(error => {
      // allow a later retry instead of caching the failure forever
      workerPromise = null
      throw error
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
        rawText,
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
      rawText,
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

// ---- machine-readable zone (back of the unified ID card) ------------------------------------------
type OcrWorker = Awaited<ReturnType<typeof createWorker>>

/**
 * Latin-only workers restricted to the MRZ alphabet (far fewer misreads than the Arabic+English one), kept in a small
 * pool. A tesseract worker runs one job at a time, so a read leases a worker for all of its views. A read that runs
 * past its budget or fails takes its own worker down with it — the stuck job dies with the worker instead of
 * blocking every read queued behind it — and a later read starts a fresh one.
 */
type MrzWorker = { worker: OcrWorker; busy: boolean; retired: boolean }
const MRZ_POOL_SIZE = Math.max(1, Math.min(4, Number(process.env.IDENTITY_OCR_MRZ_WORKERS) || 2))
/** Loading the language data (downloading it, the first time) must not hold a request for ever. */
const MRZ_START_TIMEOUT_MS = 20_000
const mrzPool = new Set<MrzWorker>()
let mrzStarting = 0
const mrzWaiters = new Set<() => void>()

const wakeMrzWaiters = () => [...mrzWaiters].forEach(wake => wake())

async function startMrzWorker(): Promise<MrzWorker> {
  const cachePath =
    process.env.IDENTITY_OCR_CACHE_PATH?.trim() || `${process.env.RAILWAY_VOLUME_MOUNT_PATH || '/tmp'}/dhiqar-ocr-cache`
  const langPath = process.env.IDENTITY_OCR_LANG_PATH?.trim() || undefined
  let entry: MrzWorker | null = null
  const worker = await createWorker('eng', 1, {
    cachePath,
    ...(langPath ? { langPath, gzip: false } : {}),
    logger: () => undefined,
    // a worker-thread error must never bubble up as an uncaught exception; that worker is not used again
    errorHandler: (error: unknown) => {
      console.error('[ocr] mrz worker error', error)
      if (entry) retireMrzWorker(entry)
    },
  })
  try {
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
      preserve_interword_spaces: '0',
      tessedit_pageseg_mode: '6' as never,
    })
  } catch (error) {
    void worker.terminate().catch(() => undefined)
    throw error
  }
  entry = { worker, busy: true, retired: false }
  return entry
}

/** Takes this worker — and only this one — out of the pool for good and stops it, with whatever job it is stuck on. */
function retireMrzWorker(entry: MrzWorker) {
  if (entry.retired) return
  entry.retired = true
  mrzPool.delete(entry)
  void entry.worker.terminate().catch(() => undefined)
  wakeMrzWaiters()
}

function releaseMrzWorker(entry: MrzWorker) {
  if (entry.retired) return
  entry.busy = false
  wakeMrzWaiters()
}

const waitForRelease = (ms: number) =>
  new Promise<void>(resolve => {
    const done = () => {
      clearTimeout(timer)
      mrzWaiters.delete(done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    mrzWaiters.add(done)
  })

/**
 * A worker for one read: an idle one, a new one while the pool has room, or the first to free up before `deadline`.
 * Null when none can be had in time or the engine does not start.
 */
async function leaseMrzWorker(deadline: number): Promise<MrzWorker | null> {
  for (;;) {
    for (const entry of mrzPool)
      if (!entry.busy && !entry.retired) {
        entry.busy = true
        return entry
      }
    if (mrzPool.size + mrzStarting < MRZ_POOL_SIZE) {
      mrzStarting++
      const starting = startMrzWorker()
        .then(entry => {
          mrzPool.add(entry)
          return entry
        })
        .catch(error => {
          console.warn('[ocr] mrz worker failed to start', error)
          return null
        })
        .finally(() => {
          mrzStarting--
        })
      let timer: ReturnType<typeof setTimeout> | undefined
      const started = await Promise.race([
        starting,
        new Promise<'late'>(resolve => {
          timer = setTimeout(() => resolve('late'), MRZ_START_TIMEOUT_MS)
        }),
      ])
      clearTimeout(timer)
      if (started !== 'late') return started
      // still starting: it serves a later read if it ever comes up
      void starting.then(late => late && releaseMrzWorker(late))
      return null
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) return null
    await waitForRelease(remaining)
  }
}

type SharpFactory = (typeof import('sharp'))['default']
/** The photo decoded once, upright and at most WORK_WIDTH wide, as raw pixels every view is cut from. */
type Upright = { data: Buffer; width: number; height: number; channels: 1 | 2 | 3 | 4 }

/** A photo of a card has no business being larger than this; a bigger one is refused before it is decoded. */
export const MAX_CARD_PHOTO_PIXELS = 50_000_000
/** The OCR never looks at more than 1800 px across: anything wider is scaled down once, before any view. */
const WORK_WIDTH = 2000

/**
 * Ways to look at a photo of the card's back, cheapest and likeliest first. The zone sits in the bottom ~35% of a
 * well-framed card; a looser frame, a tilted hand, glare or a card held upside down each need another view.
 */
const MRZ_VIEWS: Array<{ name: string; band: number; turn?: number; binarise?: boolean }> = [
  { name: 'bottom-40', band: 0.42 },
  { name: 'bottom-40-binary', band: 0.42, binarise: true },
  { name: 'bottom-55', band: 0.55 },
  { name: 'tilt+3', band: 0.55, turn: 3 },
  { name: 'tilt-3', band: 0.55, turn: -3 },
  { name: 'upside-down', band: 0.55, turn: 180 },
  { name: 'whole', band: 1 },
]

/** Wide enough for ~30 px characters: small photos are doubled, large ones capped (OCR time grows with pixels). */
const ocrWidth = (width: number) => Math.round(Math.min(1800, Math.max(width, Math.min(width * 2, 1600))))

async function decodeUpright(sharp: SharpFactory, image: Buffer): Promise<Upright> {
  const { data, info } = await sharp(image, { failOn: 'none', limitInputPixels: MAX_CARD_PHOTO_PIXELS })
    .rotate()
    .resize({ width: WORK_WIDTH, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

const fromRaw = (sharp: SharpFactory, image: Upright) =>
  sharp(image.data, { raw: { width: image.width, height: image.height, channels: image.channels } })

async function prepareView(sharp: SharpFactory, upright: Upright, view: (typeof MRZ_VIEWS)[number]) {
  let source = upright
  if (view.turn) {
    const turned = await fromRaw(sharp, upright)
      .rotate(view.turn, { background: '#ffffff' })
      .raw()
      .toBuffer({ resolveWithObject: true })
    source = { data: turned.data, width: turned.info.width, height: turned.info.height, channels: turned.info.channels }
  }
  const { width, height } = source
  const top = Math.max(0, Math.min(height - 1, Math.floor(height * (1 - view.band))))
  const gray = await fromRaw(sharp, source)
    .extract({ left: 0, top, width, height: height - top })
    .resize({ width: ocrWidth(width) })
    .grayscale()
    .normalise()
    .sharpen({ sigma: 1 })
    .png()
    .toBuffer()
  return view.binarise ? binarise(sharp, gray) : gray
}

/** Adaptive threshold: each pixel against its neighbourhood, so uneven light and glare do not wash out the zone. */
async function binarise(sharp: SharpFactory, gray: Buffer) {
  const { data, info } = await sharp(gray).extractChannel(0).raw().toBuffer({ resolveWithObject: true })
  const local = await sharp(gray)
    .extractChannel(0)
    .blur(Math.max(4, info.width / 120))
    .raw()
    .toBuffer()
  const out = Buffer.alloc(data.length)
  for (let index = 0; index < data.length; index++) out[index] = data[index] + 10 < local[index] ? 0 : 255
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 1 } })
    .png()
    .toBuffer()
}

/** A read that never outlives the budget: null when time runs out (the caller retires the worker). */
async function recognizeWithin(worker: OcrWorker, image: Buffer, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      worker.recognize(image).then(result => result.data.text || ''),
      new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export type MrzRead = {
  td1: Td1 | null
  rawText: string
  status: MrzReadStatus
  attempts: number
  /**
   * 'unavailable' when the OCR engine could not read at all (it did not start, crashed, got stuck or stayed busy):
   * then nothing is known about the photo itself
   */
  engine: 'ok' | 'unavailable'
}

/** On submission the checks run in the background and may look longer than the instant check after a photo. */
const DEFAULT_MRZ_BUDGET_MS = 6_000

/**
 * Reads the TD1 zone from a photo of the card's back. Looks at the photo several ways (bottom band, wider band,
 * binarised, slightly turned either way, upside down, whole) and stops once the zone passes every check digit — on
 * the first view alone, or confirmed by a second view after that (see parseTd1); the lines of all views read so far
 * are combined. Decoding the photo counts towards `budgetMs`, and every view after the first one only runs when it
 * can finish inside it (the worker's one-time start-up aside). Never throws.
 */
export async function readMrzLocally(image: Buffer, options: { budgetMs?: number } = {}): Promise<MrzRead> {
  const budgetMs = options.budgetMs ?? DEFAULT_MRZ_BUDGET_MS
  const started = Date.now()
  const texts: string[] = []
  let td1: Td1 | null = null
  let engine: MrzRead['engine'] = 'ok'
  const result = (): MrzRead => ({
    td1,
    rawText: texts.join('\n'),
    status: mrzReadStatus(td1),
    attempts: texts.length,
    engine,
  })
  let sharp: SharpFactory
  let upright: Upright
  try {
    sharp = (await import('sharp')).default
    upright = await decodeUpright(sharp, image)
  } catch (error) {
    // not an image, or far too large to be a photo of a card
    console.warn('[ocr] mrz photo not decoded', error instanceof Error ? error.message : error)
    return result()
  }
  const lease = await leaseMrzWorker(started + budgetMs)
  if (!lease) {
    engine = 'unavailable'
    return result()
  }
  let healthy = true
  try {
    let slowest = 0
    for (const view of MRZ_VIEWS) {
      const elapsed = Date.now() - started
      // the first view always runs; a further one only when it can finish inside the budget
      if (texts.length && elapsed + slowest > budgetMs) break
      const begun = Date.now()
      const prepared = await prepareView(sharp, upright, view)
      let text: string | null
      try {
        text = await recognizeWithin(lease.worker, prepared, Math.max(budgetMs - elapsed, 1_000))
      } catch (error) {
        console.warn('[ocr] mrz read failed', error)
        healthy = false
        break
      }
      // the job is stuck: it goes down with its worker instead of holding every read after it
      if (text === null) {
        healthy = false
        break
      }
      slowest = Math.max(slowest, Date.now() - begun)
      texts.push(text)
      td1 = parseTd1(texts) ?? td1
      if (td1?.valid) break
    }
  } catch (error) {
    // preparing a view failed: the photo, not the engine
    console.warn('[ocr] mrz view failed', error)
  } finally {
    if (healthy) releaseMrzWorker(lease)
    else retireMrzWorker(lease)
  }
  if (!healthy && !texts.length) engine = 'unavailable'
  return result()
}
