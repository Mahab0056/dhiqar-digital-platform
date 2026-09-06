import { addAudit, db } from './db.js'
import { employeeWorkQueueRealtime } from './realtime.js'
import { faceMatchAvailable, verifyFaceAgainstDocument, type FaceVerification } from './face-match.js'

/**
 * Automated identity checks that run right after a citizen submits ID photos + face video:
 *   1. face on the document ↔ faces in the video (on-server ArcFace, see face-match.ts)
 *   2. name typed by the citizen ↔ name read from the document (OCR / MRZ), Arabic-aware fuzzy compare
 * Results are stored on identity_reviews and shown to the reviewer; the final decision stays human.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS identity_verification_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    face_status TEXT,
    face_similarity REAL,
    name_status TEXT,
    name_score REAL,
    error TEXT
  );
`)
const ensureColumn = (table: string, column: string, definition: string) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some(item => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}
ensureColumn('identity_reviews', 'face_match_details', 'TEXT')
ensureColumn('identity_reviews', 'name_match_status', "TEXT NOT NULL DEFAULT 'PENDING'")
ensureColumn('identity_reviews', 'name_match_score', 'REAL')
ensureColumn('identity_reviews', 'name_match_details', 'TEXT')
ensureColumn('identity_reviews', 'auto_assessment', "TEXT NOT NULL DEFAULT 'PENDING'")

// ---- name matching --------------------------------------------------------------------------
const arabicNormalize = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ئ/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** Very rough Arabic → Latin transliteration so an Arabic name can be compared with an MRZ / Latin field. */
const translit: Record<string, string> = {
  ا: 'a',
  ب: 'b',
  ت: 't',
  ث: 'th',
  ج: 'j',
  ح: 'h',
  خ: 'kh',
  د: 'd',
  ذ: 'th',
  ر: 'r',
  ز: 'z',
  س: 's',
  ش: 'sh',
  ص: 's',
  ض: 'd',
  ط: 't',
  ظ: 'dh',
  ع: 'a',
  غ: 'gh',
  ف: 'f',
  ق: 'q',
  ك: 'k',
  ل: 'l',
  م: 'm',
  ن: 'n',
  ه: 'h',
  و: 'w',
  ي: 'y',
  ء: '',
}
/** Consonant skeleton: Arabic has no short vowels and MRZ spelling varies, so both sides drop vowels. */
const skeleton = (latin: string) =>
  latin
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1')
    .replace(/(?!^)[aeiouy]/g, '')
    .replace(/(.)\1+/g, '$1')

const toLatin = (value: string) =>
  skeleton(
    arabicNormalize(value)
      .replace(/^ال/, '')
      .split('')
      .map(char => (translit[char] !== undefined ? translit[char] : char))
      .join('')
  )

const bigrams = (value: string) => {
  const set = new Set<string>()
  for (let index = 0; index < value.length - 1; index++) set.add(value.slice(index, index + 2))
  return set
}
const dice = (left: string, right: string) => {
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.length < 3 || right.length < 3)
    return left[0] === right[0] && Math.abs(left.length - right.length) <= 1 ? 0.7 : 0
  const a = bigrams(left)
  const b = bigrams(right)
  let shared = 0
  for (const gram of a) if (b.has(gram)) shared++
  return (2 * shared) / (a.size + b.size || 1)
}

const isArabic = (value: string) => /[؀-ۿ]/.test(value)

export type NameMatch = {
  status: 'MATCH' | 'PARTIAL' | 'NO_MATCH' | 'NO_NAME_ON_DOCUMENT'
  /** 0–100 */
  score: number | null
  typed: string
  extracted: string | null
  method: 'ARABIC' | 'TRANSLITERATED' | 'NONE'
  matchedTokens: string[]
}

/** Token-level comparison: each typed name part looks for its best counterpart on the document. */
export function compareNames(typed: string, extracted: string | null | undefined): NameMatch {
  const clean = extracted?.trim() || ''
  if (!clean)
    return { status: 'NO_NAME_ON_DOCUMENT', score: null, typed, extracted: null, method: 'NONE', matchedTokens: [] }
  const typedTokens = arabicNormalize(typed)
    .split(' ')
    .filter(token => token.length > 1)
  let extractedTokens: string[]
  let method: NameMatch['method']
  let typedCompare: string[]
  if (isArabic(clean)) {
    method = 'ARABIC'
    extractedTokens = arabicNormalize(clean)
      .split(' ')
      .filter(token => token.length > 1)
    typedCompare = typedTokens
  } else {
    method = 'TRANSLITERATED'
    extractedTokens = clean
      .toLowerCase()
      .replace(/[^a-z\s<]/g, ' ')
      .replace(/</g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 1 && token !== 'al' && token !== 'el')
      .map(skeleton)
      .filter(Boolean)
    typedCompare = typedTokens.map(toLatin).filter(Boolean)
  }
  if (!typedCompare.length || !extractedTokens.length)
    return { status: 'NO_NAME_ON_DOCUMENT', score: null, typed, extracted: clean, method, matchedTokens: [] }
  const matched: string[] = []
  let total = 0
  for (const token of typedCompare) {
    let best = 0
    let bestToken = ''
    for (const candidate of extractedTokens) {
      const similarity = dice(token, candidate)
      if (similarity > best) {
        best = similarity
        bestToken = candidate
      }
    }
    if (best >= 0.6) matched.push(bestToken)
    total += best
  }
  // the first two parts (given name + father) carry the most weight in Iraqi naming
  const weights = typedCompare.map((_, index) => (index < 2 ? 1.5 : 1))
  let weighted = 0
  typedCompare.forEach((token, index) => {
    let best = 0
    for (const candidate of extractedTokens) best = Math.max(best, dice(token, candidate))
    weighted += best * weights[index]
  })
  const score = Math.round((weighted / weights.reduce((sum, value) => sum + value, 0)) * 100)
  void total
  const status: NameMatch['status'] =
    score >= (method === 'ARABIC' ? 75 : 62) ? 'MATCH' : score >= 45 ? 'PARTIAL' : 'NO_MATCH'
  return { status, score, typed, extracted: clean, method, matchedTokens: matched }
}

/** Parses the name from a TD3 (passport) MRZ line 1 if present in OCR text. */
export function nameFromMrz(text: string): string | null {
  const line = text
    .split(/\r?\n/)
    .map(item => item.replace(/\s/g, '').toUpperCase())
    .find(item => /^P[A-Z<][A-Z]{3}[A-Z<]{20,}/.test(item))
  if (!line) return null
  const names = line.slice(5).split('<<')
  const surname = (names[0] || '').replace(/</g, ' ').trim()
  const given = (names[1] || '').replace(/</g, ' ').trim()
  const full = `${given} ${surname}`.trim()
  return full.length >= 3 ? full : null
}

// ---- orchestration ---------------------------------------------------------------------------
export type AutoAssessment = 'PENDING' | 'READY_TO_APPROVE' | 'NEEDS_ATTENTION' | 'LIKELY_MISMATCH' | 'UNAVAILABLE'

function assess(face: FaceVerification | null, name: NameMatch): AutoAssessment {
  if (!face || face.status === 'UNAVAILABLE') return 'UNAVAILABLE'
  if (face.status === 'NO_MATCH') return 'LIKELY_MISMATCH'
  if (face.status === 'MATCH' && (name.status === 'MATCH' || name.status === 'NO_NAME_ON_DOCUMENT'))
    return 'READY_TO_APPROVE'
  return 'NEEDS_ATTENTION'
}

export const faceStatusLabel: Record<string, string> = {
  MATCH: 'الوجه مطابق للهوية',
  UNCERTAIN: 'تشابه غير حاسم — راجع يدوياً',
  NO_MATCH: 'الوجه لا يطابق صورة الهوية',
  NO_FACE_ON_DOCUMENT: 'لم يُكتشف وجه في صورة الهوية',
  NO_FACE_IN_VIDEO: 'لم يُكتشف وجه في الفيديو',
  FRAMES_UNAVAILABLE: 'تعذر استخراج لقطات الفيديو',
  UNAVAILABLE: 'محرك المطابقة غير مفعّل',
  PENDING: 'جاري الفحص…',
}

/**
 * Runs the checks for one review. Safe to call in the background; errors are recorded, never thrown.
 */
export async function runIdentityVerification(input: {
  reviewId: string
  documentImage: Buffer
  faceVideo: Buffer
  typedName: string
  extractedName: string | null
  ocrText?: string | null
}) {
  const startedAt = new Date().toISOString()
  const run = db
    .prepare(`INSERT INTO identity_verification_runs (review_id, started_at) VALUES (?, ?)`)
    .run(input.reviewId, startedAt)
  const extracted = input.extractedName || (input.ocrText ? nameFromMrz(input.ocrText) : null)
  const name = compareNames(input.typedName, extracted)
  let face: FaceVerification | null = null
  let error: string | null = null
  try {
    face = faceMatchAvailable()
      ? await verifyFaceAgainstDocument({ documentImage: input.documentImage, faceVideo: input.faceVideo })
      : null
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }
  const assessment = assess(face, name)
  const finishedAt = new Date().toISOString()
  db.prepare(
    `UPDATE identity_reviews SET face_match_status = ?, face_match_score = ?, face_match_provider = ?, face_match_details = ?,
       name_match_status = ?, name_match_score = ?, name_match_details = ?, auto_assessment = ?, updated_at = ? WHERE id = ?`
  ).run(
    face ? face.status : error ? 'UNAVAILABLE' : 'UNAVAILABLE',
    face?.score ?? null,
    face ? face.provider : null,
    JSON.stringify(face ? { ...face, error } : { error }),
    name.status,
    name.score,
    JSON.stringify(name),
    assessment,
    finishedAt,
    input.reviewId
  )
  db.prepare(
    `UPDATE identity_verification_runs SET finished_at = ?, face_status = ?, face_similarity = ?, name_status = ?, name_score = ?, error = ? WHERE id = ?`
  ).run(
    finishedAt,
    face?.status || null,
    face?.similarity ?? null,
    name.status,
    name.score,
    error,
    Number(run.lastInsertRowid)
  )
  addAudit({
    actor: 'نظام التحقق الآلي',
    role: 'SYSTEM',
    action: 'IDENTITY_AUTO_VERIFIED',
    entityType: 'IdentityReview',
    entityId: input.reviewId,
    newValue: {
      face: face?.status || 'UNAVAILABLE',
      faceScore: face?.score ?? null,
      name: name.status,
      nameScore: name.score,
      assessment,
    },
  })
  employeeWorkQueueRealtime.publish({ entity: 'IDENTITY_REVIEW', action: 'UPDATED', reference: input.reviewId })
  return { face, name, assessment }
}
