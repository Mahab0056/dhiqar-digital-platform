import { createHmac } from 'node:crypto'
import { addAudit, db } from './db.js'
import { employeeWorkQueueRealtime, notifyCitizen } from './realtime.js'
import { faceMatchAvailable, verifyFaceAgainstDocument, type FaceVerification } from './face-match.js'
import { readMrzLocally } from './local-identity-ocr.js'
import { readDecryptedMedia } from './media.js'
import { foldDocumentNumber, iraqiCardProblems, type Td1 } from './mrz.js'
import {
  verifyActiveLiveness,
  type ActiveLiveness,
  type LivenessStep,
  type LivenessTimelineEntry,
} from './active-liveness.js'

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
// what the card's machine-readable zone said, and the automatic decision with its reasons
ensureColumn('identity_reviews', 'mrz_data', 'TEXT')
ensureColumn('identity_reviews', 'auto_decision', 'TEXT')
ensureColumn('identity_reviews', 'auto_decision_reasons', 'TEXT')
// details registered from the card once identity is confirmed (the full card number is kept only as a keyed hash)
ensureColumn('citizens', 'date_of_birth', 'TEXT')
ensureColumn('citizens', 'sex', 'TEXT')
ensureColumn('citizens', 'document_expiry', 'TEXT')
ensureColumn('citizens', 'latin_name', 'TEXT')
ensureColumn('citizens', 'national_id_hash', 'TEXT')
// the same number folded over its OCR look-alikes (S/8, G/6, L/1, U/0…), also kept only as a keyed hash: two readings
// of one card share it. Rows verified before this column existed stay NULL (the raw number was never kept, so there is
// nothing to fold) and are still matched by the exact hash.
ensureColumn('citizens', 'national_id_fold_hash', 'TEXT')
db.exec('CREATE INDEX IF NOT EXISTS idx_citizens_national_id_hash ON citizens(national_id_hash)')
db.exec('CREATE INDEX IF NOT EXISTS idx_citizens_national_id_fold_hash ON citizens(national_id_fold_hash)')
// the same two keyed hashes of the number the automatic check read, kept on the review (mrz_data masks the number) so
// a reviewer's approval registers the card exactly like an automatic one, without the number ever being stored
ensureColumn('identity_reviews', 'card_hash', 'TEXT')
ensureColumn('identity_reviews', 'card_fold_hash', 'TEXT')

const cardHash = (value: string) =>
  createHmac('sha256', process.env.MEDIA_ENCRYPTION_KEY?.trim() || 'dhiqar-local-dev')
    .update(value)
    .digest('hex')

/** Keyed hash of the card number: finds the same card on two accounts without storing the number itself. */
export const nationalIdHash = (documentNumber: string) => cardHash(`national-id:${documentNumber.toUpperCase()}`)

/**
 * Keyed hash of the card number folded over look-alikes (foldDocumentNumber): a misread that passed the check digits
 * by luck ("S12345678" for 812345678) lands on the same key as the true reading.
 */
export const nationalIdFoldHash = (documentNumber: string) =>
  cardHash(`national-id-fold:${foldDocumentNumber(documentNumber)}`)

export const DUPLICATE_CARD_REASON = 'هذه البطاقة مسجلة على حساب آخر'
export const POSSIBLE_DUPLICATE_CARD_REASON = 'احتمال تكرار البطاقة'

/** Both keyed hashes of one card number: `exact` (nationalIdHash) and `fold` (nationalIdFoldHash). */
export type CardHashes = { exact: string; fold: string }
export const cardHashes = (documentNumber: string): CardHashes => ({
  exact: nationalIdHash(documentNumber),
  fold: nationalIdFoldHash(documentNumber),
})

/** A confirmed identity, whether admitted automatically or by a reviewer. */
const VERIFIED_STATUSES = "('VERIFIED', 'VERIFIED_MANUAL')"

/**
 * Is this card already on another account? `exact`: the same number (any status). `possible`: not the same number,
 * but one that folds to the same key on another verified citizen (automatic or manual) — the same card read
 * differently, or (rarely) a different card a person must tell apart. Either keeps the request away from automatic
 * approval.
 */
export function findCardDuplicates(documentNumber: string, citizenId: number) {
  return findCardDuplicatesByHash(cardHashes(documentNumber), citizenId)
}

/** findCardDuplicates for hashes already computed (a review keeps the hashes, never the number). */
export function findCardDuplicatesByHash(hashes: CardHashes, citizenId: number) {
  const exact = Boolean(
    db.prepare('SELECT id FROM citizens WHERE national_id_hash = ? AND id != ? LIMIT 1').get(hashes.exact, citizenId)
  )
  const possible =
    !exact &&
    Boolean(
      db
        .prepare(
          `SELECT id FROM citizens WHERE national_id_fold_hash = ? AND id != ? AND verification_status IN ${VERIFIED_STATUSES} LIMIT 1`
        )
        .get(hashes.fold, citizenId)
    )
  return { exact, possible }
}

/**
 * Another verified citizen (automatic or manual) already holds this card: 'EXACT' (the same number) or 'LOOK_ALIKE'
 * (a reading that folds to the same key). A reviewer's approval is blocked on either — one card, one account.
 */
export function verifiedCardHolder(hashes: CardHashes, citizenId: number): 'EXACT' | 'LOOK_ALIKE' | null {
  const holds = (column: 'national_id_hash' | 'national_id_fold_hash', hash: string) =>
    Boolean(
      db
        .prepare(
          `SELECT id FROM citizens WHERE ${column} = ? AND id != ? AND verification_status IN ${VERIFIED_STATUSES} LIMIT 1`
        )
        .get(hash, citizenId)
    )
  if (holds('national_id_hash', hashes.exact)) return 'EXACT'
  if (holds('national_id_fold_hash', hashes.fold)) return 'LOOK_ALIKE'
  return null
}

/** What a confirmed identity registers from the card: of the number only its last four digits and keyed hashes. */
export type RegisteredCard = {
  last4: string
  hashes: CardHashes
  birthDate: string | null
  sex: 'M' | 'F' | null
  expiryDate: string | null
  latinName: string
}
export const registeredCardFromTd1 = (td1: Td1): RegisteredCard => ({
  last4: td1.documentNumber.slice(-4),
  hashes: cardHashes(td1.documentNumber),
  birthDate: td1.birthDate,
  sex: td1.sex,
  expiryDate: td1.expiryDate,
  latinName: `${td1.givenNames} ${td1.surname}`.trim(),
})

/** Writes the card's details on the citizen (both approval paths; the caller sets the verification status). */
export function registerCard(citizenId: number, card: RegisteredCard, timestamp: string) {
  db.prepare(
    `UPDATE citizens SET national_id_masked = ?, national_id_hash = ?, national_id_fold_hash = ?,
       date_of_birth = ?, sex = ?, document_expiry = ?, latin_name = ?, document_type = 'NATIONAL_ID', updated_at = ? WHERE id = ?`
  ).run(
    `*****${card.last4}`,
    card.hashes.exact,
    card.hashes.fold,
    card.birthDate,
    card.sex === 'M' ? 'ذكر' : card.sex === 'F' ? 'أنثى' : null,
    card.expiryDate,
    card.latinName,
    timestamp,
    citizenId
  )
}

const asText = (value: unknown) => (typeof value === 'string' && value ? value : null)

/**
 * The card a reviewer's approval registers: the review's machine-readable zone when it passed every check digit,
 * with the keyed hashes the automatic check stored next to it. Reviews read before those hashes were kept fall back to
 * reading the stored back photo again, accepted only when it is valid and ends in the same four digits. Null when
 * there is no validated zone (or it cannot be read again): the approval then registers no card, as before.
 */
export async function cardForManualApproval(review: {
  mrz_data?: unknown
  card_hash?: unknown
  card_fold_hash?: unknown
  id_back_media_id?: unknown
}): Promise<RegisteredCard | null> {
  let zone: Record<string, unknown> | null = null
  try {
    zone = review.mrz_data ? (JSON.parse(String(review.mrz_data)) as Record<string, unknown>) : null
  } catch {
    zone = null
  }
  if (!zone || zone.valid !== true) return null
  const last4 = (asText(zone.documentNumber) ?? '').slice(-4)
  if (!/^[0-9A-Z]{4}$/.test(last4)) return null
  const exact = asText(review.card_hash)
  const fold = asText(review.card_fold_hash)
  if (exact && fold)
    return {
      last4,
      hashes: { exact, fold },
      birthDate: asText(zone.birthDate),
      sex: zone.sex === 'M' || zone.sex === 'F' ? zone.sex : null,
      expiryDate: asText(zone.expiryDate),
      latinName: `${asText(zone.givenNames) ?? ''} ${asText(zone.surname) ?? ''}`.trim(),
    }
  const backId = asText(review.id_back_media_id)
  if (!backId) return null
  try {
    const back = readDecryptedMedia(backId)
    if (!back) return null
    const { td1 } = await readMrzLocally(back.buffer, { budgetMs: 10_000 })
    return td1?.valid && td1.documentNumber.slice(-4) === last4 ? registeredCardFromTd1(td1) : null
  } catch {
    return null
  }
}

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

/** Average frame-to-frame similarity above this suggests a still image held to the camera. */
export const STATIC_VIDEO_CONSISTENCY = 0.93

function assess(face: FaceVerification | null, name: NameMatch): AutoAssessment {
  if (!face || face.status === 'UNAVAILABLE') return 'UNAVAILABLE'
  if (face.status === 'NO_MATCH') return 'LIKELY_MISMATCH'
  // a live face moves between frames; a printed or replayed portrait barely changes
  const staticVideo = face.frameConsistency !== null && face.frameConsistency > STATIC_VIDEO_CONSISTENCY
  if (face.status === 'MATCH' && name.status === 'MATCH' && !staticVideo) return 'READY_TO_APPROVE'
  return 'NEEDS_ATTENTION'
}

/** Face similarity required for an automatic approval (stricter than the reviewer-facing MATCH). */
export const AUTO_APPROVE_SIMILARITY = 0.45

export type AutoDecision = { approve: boolean; reasons: string[] }

/**
 * The platform admits a citizen on its own only when every check agrees: the live face matches the card portrait,
 * the video shows a live person turning their head, the card's machine-readable zone is intact, Iraqi and unexpired,
 * the typed name matches the card, and the card is not already on another account. Anything else goes to a person.
 */
export function decideAutomatically(input: {
  face: FaceVerification | null
  name: NameMatch
  td1: Td1 | null
  duplicateAccount: boolean
  /** a look-alike reading of this card number is on another verified account (findCardDuplicates) */
  possibleDuplicate?: boolean
  /** the random head-movement challenge; undefined when the submission came without one */
  activeLiveness?: ActiveLiveness | null
}): AutoDecision {
  const reasons: string[] = []
  const { face } = input
  if (!input.activeLiveness) reasons.push('لم يُجرَ تحدي حركات الرأس')
  else if (!input.activeLiveness.passed) reasons.push(...input.activeLiveness.reasons)
  if (!face || face.status === 'UNAVAILABLE') reasons.push('محرك مطابقة الوجه غير متاح')
  else if (face.status !== 'MATCH' || (face.similarity ?? 0) < AUTO_APPROVE_SIMILARITY)
    reasons.push(
      face.status === 'NO_FACE_ON_DOCUMENT'
        ? 'لم تظهر صورة الوجه في البطاقة بوضوح'
        : face.status === 'NO_FACE_IN_VIDEO' || face.status === 'FRAMES_UNAVAILABLE'
          ? 'لم يظهر الوجه بوضوح في الفيديو'
          : 'الوجه في الفيديو لا يطابق صورة البطاقة بدرجة كافية'
    )
  if (face?.liveness && !face.liveness.passed) reasons.push(...face.liveness.reasons)
  reasons.push(...iraqiCardProblems(input.td1))
  if (input.td1 && (input.name.status === 'NO_MATCH' || input.name.status === 'NO_NAME_ON_DOCUMENT'))
    reasons.push('الاسم المكتوب لا يطابق الاسم في البطاقة')
  if (input.duplicateAccount) reasons.push(DUPLICATE_CARD_REASON)
  else if (input.possibleDuplicate) reasons.push(POSSIBLE_DUPLICATE_CARD_REASON)
  return { approve: reasons.length === 0, reasons: [...new Set(reasons)] }
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
  citizenId?: number
  liveness?: { expected: LivenessStep[]; timeline: LivenessTimelineEntry[] } | null
  documentImage: Buffer
  documentBack?: Buffer | null
  faceVideo: Buffer
  typedName: string
  extractedName: string | null
  ocrText?: string | null
}) {
  const startedAt = new Date().toISOString()
  const run = db
    .prepare(`INSERT INTO identity_verification_runs (review_id, started_at) VALUES (?, ?)`)
    .run(input.reviewId, startedAt)
  // the back of the unified card carries the machine-readable zone: the most reliable source of the citizen's details
  const mrz = input.documentBack ? await readMrzLocally(input.documentBack) : { td1: null, rawText: '' }
  const td1 = mrz.td1
  const mrzName = td1 ? `${td1.givenNames} ${td1.surname}`.trim() : null
  const extracted = mrzName || input.extractedName || (input.ocrText ? nameFromMrz(input.ocrText) : null)
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
  const activeLiveness = input.liveness
    ? await verifyActiveLiveness({ video: input.faceVideo, ...input.liveness }).catch(() => null)
    : null
  // looked up after the last await, right before deciding (applyAutomaticDecision checks again before admitting)
  const duplicates =
    td1?.documentNumber && input.citizenId
      ? findCardDuplicates(td1.documentNumber, input.citizenId)
      : { exact: false, possible: false }
  const decision = decideAutomatically({
    face,
    name,
    td1,
    duplicateAccount: duplicates.exact,
    possibleDuplicate: duplicates.possible,
    activeLiveness,
  })
  const finishedAt = new Date().toISOString()
  db.prepare(
    `UPDATE identity_reviews SET face_match_status = ?, face_match_score = ?, face_match_provider = ?, face_match_details = ?,
       name_match_status = ?, name_match_score = ?, name_match_details = ?, auto_assessment = ?, updated_at = ? WHERE id = ?`
  ).run(
    face ? face.status : error ? 'UNAVAILABLE' : 'UNAVAILABLE',
    face?.score ?? null,
    face ? face.provider : null,
    JSON.stringify(face ? { ...face, error, activeLiveness: input.liveness ? activeLiveness : undefined } : { error }),
    name.status,
    name.score,
    JSON.stringify(name),
    assessment,
    finishedAt,
    input.reviewId
  )
  const hashes = td1 ? cardHashes(td1.documentNumber) : null
  db.prepare(
    `UPDATE identity_reviews SET mrz_data = ?, card_hash = ?, card_fold_hash = ?, auto_decision = ?, auto_decision_reasons = ? WHERE id = ?`
  ).run(
    td1 ? JSON.stringify({ ...td1, documentNumber: `*****${td1.documentNumber.slice(-4)}` }) : null,
    hashes?.exact ?? null,
    hashes?.fold ?? null,
    decision.approve ? 'APPROVED' : 'HUMAN_REVIEW',
    JSON.stringify(decision.reasons),
    input.reviewId
  )
  if (input.citizenId) applyAutomaticDecision({ reviewId: input.reviewId, citizenId: input.citizenId, td1, decision })
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
      duplicateCard: duplicates.exact ? 'EXACT' : duplicates.possible ? 'LOOK_ALIKE' : null,
    },
  })
  employeeWorkQueueRealtime.publish({ entity: 'IDENTITY_REVIEW', action: 'UPDATED', reference: input.reviewId })
  return { face, name, assessment }
}

/**
 * Admits the citizen when the automatic decision approves (and no person decided first); otherwise tells the citizen
 * why their request now waits for a reviewer. Card details are registered only on approval.
 */
export function applyAutomaticDecision(input: {
  reviewId: string
  citizenId: number
  td1: Td1 | null
  decision: AutoDecision
}) {
  const timestamp = new Date().toISOString()
  const current = db.prepare('SELECT status FROM identity_reviews WHERE id = ?').get(input.reviewId) as
    { status?: string } | undefined
  // a reviewer may have decided while the checks ran: their decision stands and the citizen already knows it
  if (current?.status !== 'PENDING_REVIEW') return
  let decision = input.decision
  // checked again here, synchronously up to the commit below: another account holding the same card may have been
  // admitted while this one's checks were running
  if (decision.approve && input.td1) {
    const duplicates = findCardDuplicates(input.td1.documentNumber, input.citizenId)
    if (duplicates.exact || duplicates.possible) {
      decision = {
        approve: false,
        reasons: [duplicates.exact ? DUPLICATE_CARD_REASON : POSSIBLE_DUPLICATE_CARD_REASON],
      }
      db.prepare(
        `UPDATE identity_reviews SET auto_decision = 'HUMAN_REVIEW', auto_decision_reasons = ? WHERE id = ?`
      ).run(JSON.stringify(decision.reasons), input.reviewId)
    }
  }
  if (!decision.approve) {
    notifyCitizen({
      citizenId: input.citizenId,
      type: 'IDENTITY_REVIEW',
      title: 'طلب التوثيق بانتظار مراجع الهوية',
      message: `لم يكتمل التوثيق الآلي: ${decision.reasons.join('، ')}. سيراجع موظف مختص طلبك، أو يمكنك إعادة التصوير.`,
      link: '/citizen',
    })
    return
  }
  const td1 = input.td1!
  db.exec('BEGIN')
  try {
    const claimed = db
      .prepare(
        `UPDATE identity_reviews SET status = 'APPROVED', reviewed_at = ?, reviewed_by = ?, review_notes = ?, updated_at = ? WHERE id = ? AND status = 'PENDING_REVIEW'`
      )
      .run(timestamp, 'التحقق الآلي بالذكاء الاصطناعي', 'تطابق الوجه وفحص الحياة والبطاقة', timestamp, input.reviewId)
    if (!claimed.changes) {
      db.exec('ROLLBACK')
      return
    }
    db.prepare(`UPDATE citizens SET verification_status = 'VERIFIED', updated_at = ? WHERE id = ?`).run(
      timestamp,
      input.citizenId
    )
    registerCard(input.citizenId, registeredCardFromTd1(td1), timestamp)
    addAudit({
      actor: 'التحقق الآلي بالذكاء الاصطناعي',
      role: 'SYSTEM',
      action: 'IDENTITY_AUTO_APPROVED',
      entityType: 'IdentityReview',
      entityId: input.reviewId,
      newValue: { status: 'APPROVED', citizenStatus: 'VERIFIED' },
      metadata: { mrzValid: td1.valid, documentLast4: td1.documentNumber.slice(-4) },
    })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  notifyCitizen({
    citizenId: input.citizenId,
    type: 'IDENTITY_DECISION',
    title: 'تم توثيق هويتك',
    message: 'تطابق وجهك مع صورة البطاقة الموحدة، وسُجلت بياناتك. يمكنك الآن تقديم المعاملات.',
    link: '/citizen',
  })
  employeeWorkQueueRealtime.publish({ entity: 'IDENTITY_REVIEW', action: 'UPDATED', reference: input.reviewId })
}
