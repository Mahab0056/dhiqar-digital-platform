// Final pass — identity: a reviewer's approval registers the card exactly like the automatic one (both keyed hashes,
// never the number), so a manually-approved card is caught as a duplicate later; and an approval that would put one
// card on a second verified account is blocked with a clear Arabic message.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf, iraqiTd1 } from './helpers'

configureTestEnv()

// the OCR engine is replaced: runIdentityVerification and the legacy re-read of a stored back photo both see this card
const engines = vi.hoisted(() => ({ card: null as null | import('../server/mrz.ts').Td1, reads: 0 }))
vi.mock('../server/local-identity-ocr.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../server/local-identity-ocr.ts')>()),
  readMrzLocally: async () => {
    engines.reads++
    return { td1: engines.card, rawText: '', status: engines.card ? 'ok' : 'unreadable', attempts: 1, engine: 'ok' }
  },
}))
vi.mock('../server/face-match.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../server/face-match.ts')>()),
  faceMatchAvailable: () => false,
}))

let app: Express
let reviewer = ''
let mod: typeof import('../server/identity-verification.ts')
let mrz: typeof import('../server/mrz.ts')
let media: typeof import('../server/media.ts')
let db: typeof import('../server/db.ts').db

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  mod = await import('../server/identity-verification.ts')
  mrz = await import('../server/mrz.ts')
  media = await import('../server/media.ts')
  ;({ db } = await import('../server/db.ts'))
  // the bootstrap super admin (a reviewer role) rotates its password before deciding anything
  const login = await request(app)
    .post('/api/auth/staff/login')
    .send({ username: 'admin', password: 'Bootstrap-Admin-Pass-2026!' })
  expect(login.status).toBe(200)
  reviewer = cookieOf(login)
  const rotated = await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', reviewer)
    .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Admin-Rotated-Pass-2026!' })
  expect(rotated.status).toBe(200)
})

const card = (number: string) => {
  const td1 = mrz.parseTd1(
    iraqiTd1({ number, birth: '900101', sex: 'M', expiry: '300101', surname: 'YASEEN', given: 'MAHAB ALI' })
  )
  expect(td1?.valid, number).toBe(true)
  expect(td1?.documentNumber).toBe(number)
  return td1!
}

let sequence = 0
const citizen = (status = 'MANUAL_REVIEW') => {
  const now = new Date().toISOString()
  return Number(
    db
      .prepare(
        `INSERT INTO citizens (full_name, national_id_masked, phone_masked, verification_status, district, created_at, updated_at) VALUES ('مهاب علي ياسين', 'x', ?, ?, 'الناصرية', ?, ?)`
      )
      .run(`9647******${String(++sequence).padStart(3, '0')}`, status, now, now).lastInsertRowid
  )
}

/**
 * A pending review the way the automatic step leaves one it sent to a person: the zone with the number masked, and
 * (unless `legacy`) the card's keyed hashes beside it.
 */
const pendingReview = (
  citizenId: number,
  number: string | null,
  options: { legacy?: boolean; valid?: boolean; backPhoto?: Buffer } = {}
) => {
  const now = new Date().toISOString()
  const id = `idv_final_${++sequence}`
  const td1 = number ? card(number) : null
  const zone = td1
    ? JSON.stringify({ ...td1, valid: options.valid ?? true, documentNumber: `*****${td1.documentNumber.slice(-4)}` })
    : null
  const hashes = td1 && !options.legacy ? mod.cardHashes(td1.documentNumber) : null
  const back = options.backPhoto
    ? media.storeEncryptedMedia({
        citizenId,
        purpose: 'IDENTITY_DOCUMENT_BACK',
        originalName: 'back.jpg',
        mimeType: 'image/jpeg',
        buffer: options.backPhoto,
        retentionPolicy: 'RETAINED_WITH_CONSENT',
        retentionConsentAt: now,
      })
    : null
  db.prepare(
    `INSERT INTO identity_reviews (id, citizen_id, status, national_id_masked, id_back_media_id, mrz_data, card_hash, card_fold_hash, auto_decision, consent_at, submitted_at, retention_until, created_at, updated_at)
     VALUES (?, ?, 'PENDING_REVIEW', 'x', ?, ?, ?, ?, 'HUMAN_REVIEW', ?, ?, ?, ?, ?)`
  ).run(id, citizenId, back?.id ?? null, zone, hashes?.exact ?? null, hashes?.fold ?? null, now, now, now, now, now)
  return id
}

const decide = (reviewId: string, decision: 'APPROVED' | 'REJECTED' | 'NEEDS_RESUBMISSION' = 'APPROVED') =>
  request(app)
    .post(`/api/admin/identity-reviews/${reviewId}/decision`)
    .set('Cookie', reviewer)
    .send({ decision, notes: '' })

const citizenRow = (id: number) =>
  db
    .prepare(
      'SELECT verification_status, national_id_masked, national_id_hash, national_id_fold_hash, date_of_birth, sex, document_expiry, latin_name, document_type FROM citizens WHERE id = ?'
    )
    .get(id) as {
    verification_status: string
    national_id_masked: string
    national_id_hash: string | null
    national_id_fold_hash: string | null
    date_of_birth: string | null
    sex: string | null
    document_expiry: string | null
    latin_name: string | null
    document_type: string | null
  }
const reviewStatus = (id: string) =>
  (db.prepare('SELECT status FROM identity_reviews WHERE id = ?').get(id) as { status: string }).status
const lastAudit = (action: string, entityId: string) =>
  db
    .prepare('SELECT metadata FROM audit_logs WHERE action = ? AND entity_id = ? ORDER BY id DESC LIMIT 1')
    .get(action, entityId) as { metadata: string } | undefined

/** approves a citizen holding this card through the reviewer, as a manual approval */
const approveManually = async (number: string) => {
  const id = citizen()
  const reviewId = pendingReview(id, number)
  const response = await decide(reviewId)
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  expect(citizenRow(id).verification_status).toBe('VERIFIED_MANUAL')
  return id
}

describe('the automatic step keeps the card’s keyed hashes on the review, never the number', () => {
  it('a review sent to a person carries card_hash / card_fold_hash next to the masked zone', async () => {
    engines.card = card('C24681357')
    const id = citizen()
    const now = new Date().toISOString()
    const reviewId = `idv_final_run_${++sequence}`
    db.prepare(
      `INSERT INTO identity_reviews (id, citizen_id, status, national_id_masked, consent_at, submitted_at, retention_until, created_at, updated_at) VALUES (?, ?, 'PENDING_REVIEW', 'x', ?, ?, ?, ?, ?)`
    ).run(reviewId, id, now, now, now, now, now)
    // no head-movement challenge and no face engine: the automatic step hands the request to a reviewer
    await mod.runIdentityVerification({
      reviewId,
      citizenId: id,
      liveness: null,
      documentImage: Buffer.from('front'),
      documentBack: Buffer.from('back'),
      faceVideo: Buffer.from('video'),
      typedName: 'مهاب علي ياسين',
      extractedName: null,
    })
    const row = db.prepare('SELECT * FROM identity_reviews WHERE id = ?').get(reviewId) as Record<string, unknown>
    expect(row.status).toBe('PENDING_REVIEW')
    expect(row.auto_decision).toBe('HUMAN_REVIEW')
    expect(row.card_hash).toBe(mod.nationalIdHash('C24681357'))
    expect(row.card_fold_hash).toBe(mod.nationalIdFoldHash('C24681357'))
    expect(JSON.parse(String(row.mrz_data)).documentNumber).toBe('*****1357')
    // the full number is nowhere on the review
    expect(JSON.stringify(row)).not.toContain('C24681357')

    // …and the reviewer's approval registers the card from it
    const approved = await decide(reviewId)
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
    const registered = citizenRow(id)
    expect(registered.verification_status).toBe('VERIFIED_MANUAL')
    expect(registered.national_id_hash).toBe(mod.nationalIdHash('C24681357'))
    expect(registered.national_id_fold_hash).toBe(mod.nationalIdFoldHash('C24681357'))
  })
})

describe('a reviewer’s approval registers the card like the automatic one', () => {
  it('stores both hashes and the card details, with the citizen VERIFIED_MANUAL', async () => {
    const id = citizen()
    const reviewId = pendingReview(id, 'A11223344')
    const response = await decide(reviewId)
    expect(response.status).toBe(200)
    expect(response.body.status).toBe('APPROVED')
    expect(citizenRow(id)).toEqual({
      verification_status: 'VERIFIED_MANUAL',
      national_id_masked: '*****3344',
      national_id_hash: mod.nationalIdHash('A11223344'),
      national_id_fold_hash: mod.nationalIdFoldHash('A11223344'),
      date_of_birth: card('A11223344').birthDate,
      sex: 'ذكر',
      document_expiry: card('A11223344').expiryDate,
      latin_name: 'MAHAB ALI YASEEN',
      document_type: 'NATIONAL_ID',
    })
    const audit = JSON.parse(lastAudit('IDENTITY_REVIEW_DECIDED', reviewId)!.metadata)
    expect(audit.cardRegistered).toBe(true)
    expect(audit.documentLast4).toBe('3344')
  })

  it('the automatic duplicate check now sees a manually-approved card (exact and look-alike readings)', async () => {
    await approveManually('812345671')
    const other = citizen()
    expect(mod.findCardDuplicates('812345671', other)).toEqual({ exact: true, possible: false })
    // "S12345671" passes the same check digits as 812345671: the folded hash catches it on a VERIFIED_MANUAL holder
    expect(mrz.checkDigit('S12345671')).toBe(mrz.checkDigit('812345671'))
    expect(mod.findCardDuplicates('S12345671', other)).toEqual({ exact: false, possible: true })
  })

  it('an approval without a validated zone registers no card, as before', async () => {
    const noZone = citizen()
    const first = pendingReview(noZone, null)
    expect((await decide(first)).status).toBe(200)
    expect(citizenRow(noZone)).toMatchObject({
      verification_status: 'VERIFIED_MANUAL',
      national_id_hash: null,
      national_id_fold_hash: null,
    })
    const partial = citizen()
    const second = pendingReview(partial, 'D99887766', { valid: false })
    expect((await decide(second)).status).toBe(200)
    expect(citizenRow(partial)).toMatchObject({ national_id_hash: null, national_id_fold_hash: null })
    expect(JSON.parse(lastAudit('IDENTITY_REVIEW_DECIDED', second)!.metadata).cardRegistered).toBe(false)
  })
})

describe('one card, one verified account: a duplicate approval is blocked', () => {
  it('the same card on another verified account → 409 with an Arabic reason, nothing written', async () => {
    const holder = await approveManually('B55667788')
    const second = citizen()
    const reviewId = pendingReview(second, 'B55667788')
    const response = await decide(reviewId)
    expect(response.status).toBe(409)
    expect(response.body.duplicateCard).toBe('EXACT')
    expect(response.body.message).toContain('لا يمكن اعتماد الهوية')
    expect(response.body.message).toContain('موثقة مسبقاً على حساب مواطن آخر')
    // the request stays with the reviewer; the second account is untouched
    expect(reviewStatus(reviewId)).toBe('PENDING_REVIEW')
    expect(citizenRow(second)).toMatchObject({
      verification_status: 'MANUAL_REVIEW',
      national_id_hash: null,
      national_id_fold_hash: null,
    })
    expect(citizenRow(holder).verification_status).toBe('VERIFIED_MANUAL')
    const blocked = JSON.parse(lastAudit('IDENTITY_APPROVAL_BLOCKED_DUPLICATE_CARD', reviewId)!.metadata)
    expect(blocked).toEqual({ duplicateCard: 'EXACT', documentLast4: '7788' })
    // rejecting it (or asking for a new submission) is never blocked
    const rejected = await decide(reviewId, 'REJECTED')
    expect(rejected.status).toBe(200)
    expect(citizenRow(second).verification_status).toBe('REJECTED')
  })

  it('also against an automatically verified account', async () => {
    const holder = citizen()
    const now = new Date().toISOString()
    const autoReview = `idv_final_auto_${++sequence}`
    db.prepare(
      `INSERT INTO identity_reviews (id, citizen_id, status, national_id_masked, consent_at, submitted_at, retention_until, created_at, updated_at) VALUES (?, ?, 'PENDING_REVIEW', 'x', ?, ?, ?, ?, ?)`
    ).run(autoReview, holder, now, now, now, now, now)
    mod.applyAutomaticDecision({
      reviewId: autoReview,
      citizenId: holder,
      td1: card('E13579246'),
      decision: { approve: true, reasons: [] },
    })
    expect(citizenRow(holder).verification_status).toBe('VERIFIED')
    const reviewId = pendingReview(citizen(), 'E13579246')
    const response = await decide(reviewId, 'APPROVED')
    expect(response.status).toBe(409)
    expect(response.body.duplicateCard).toBe('EXACT')
  })

  it('a look-alike reading of a verified card → 409 «احتمال تكرار البطاقة»', async () => {
    await approveManually('G81956690')
    const reviewId = pendingReview(citizen(), '681956690')
    const response = await decide(reviewId)
    expect(response.status).toBe(409)
    expect(response.body.duplicateCard).toBe('LOOK_ALIKE')
    expect(response.body.message).toContain('لا يمكن اعتماد الهوية')
    expect(response.body.message).toContain('احتمال تكرار البطاقة')
    expect(reviewStatus(reviewId)).toBe('PENDING_REVIEW')
  })

  it('a holder that is no longer verified does not block the approval', async () => {
    const holder = await approveManually('F24680135')
    db.prepare(`UPDATE citizens SET verification_status = 'REJECTED' WHERE id = ?`).run(holder)
    const second = citizen()
    const response = await decide(pendingReview(second, 'F24680135'))
    expect(response.status).toBe(200)
    expect(citizenRow(second).national_id_hash).toBe(mod.nationalIdHash('F24680135'))
  })

  it('the card’s own account is never its duplicate (a re-submission by the same citizen)', async () => {
    const id = await approveManually('H10203040')
    db.prepare(`UPDATE citizens SET verification_status = 'MANUAL_REVIEW' WHERE id = ?`).run(id)
    expect((await decide(pendingReview(id, 'H10203040'))).status).toBe(200)
  })
})

describe('reviews read before the hashes were kept', () => {
  it('re-read the stored back photo; registered only when it is valid and ends in the same four digits', async () => {
    const id = citizen()
    const reviewId = pendingReview(id, 'J31415926', { legacy: true, backPhoto: Buffer.from('legacy-back') })
    engines.card = card('J31415926')
    const before = engines.reads
    expect((await decide(reviewId)).status).toBe(200)
    expect(engines.reads).toBe(before + 1)
    expect(citizenRow(id)).toMatchObject({
      verification_status: 'VERIFIED_MANUAL',
      national_id_hash: mod.nationalIdHash('J31415926'),
      national_id_fold_hash: mod.nationalIdFoldHash('J31415926'),
    })

    // a duplicate of it is then blocked like any other
    const duplicate = pendingReview(citizen(), 'J31415926', { legacy: true, backPhoto: Buffer.from('legacy-back-2') })
    expect((await decide(duplicate)).status).toBe(409)

    // a re-read that disagrees with the zone the reviewer saw registers nothing
    const other = citizen()
    const mismatched = pendingReview(other, 'K27182818', { legacy: true, backPhoto: Buffer.from('legacy-back-3') })
    engines.card = card('K27182811')
    expect((await decide(mismatched)).status).toBe(200)
    expect(citizenRow(other)).toMatchObject({ national_id_hash: null, national_id_fold_hash: null })
  })

  it('a review with stored hashes never re-reads the photo', async () => {
    const before = engines.reads
    const reviewId = pendingReview(citizen(), 'L16180339', { backPhoto: Buffer.from('fresh-back') })
    expect((await decide(reviewId)).status).toBe(200)
    expect(engines.reads).toBe(before)
  })
})

describe('the decision route itself', () => {
  it('a second decision on the same review is refused', async () => {
    const reviewId = pendingReview(citizen(), 'M11235813')
    expect((await decide(reviewId)).status).toBe(200)
    const again = await decide(reviewId, 'REJECTED')
    expect(again.status).toBe(409)
    expect(again.body.message).toBe('تم اتخاذ قرار سابق لهذا الطلب.')
  })
})
