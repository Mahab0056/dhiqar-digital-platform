// Round 3 — identity: the duplicate-card check also compares the card number folded over OCR look-alikes
// (S/8, G/6, L/1, U/0), so a misread that passed the check digits by luck cannot open a second account for one card.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { configureTestEnv, iraqiTd1 } from './helpers'

configureTestEnv()

// the OCR / face / head-pose engines are replaced so runIdentityVerification can be driven end to end
const engines = vi.hoisted(() => ({ card: null as null | import('../server/mrz.ts').Td1 }))
vi.mock('../server/local-identity-ocr.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../server/local-identity-ocr.ts')>()),
  readMrzLocally: async () => ({ td1: engines.card, rawText: '', status: 'ok', attempts: 1 }),
}))
vi.mock('../server/face-match.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/face-match.ts')>()
  const face = (nose: [number, number]) => ({
    face: {
      box: [0, 0, 100, 100] as [number, number, number, number],
      score: 0.9,
      kps: [[30, 40], [70, 40], nose, [35, 75], [65, 75]] as Array<[number, number]>,
    },
    faces: 1,
  })
  return {
    ...actual,
    faceMatchAvailable: () => true,
    verifyFaceAgainstDocument: async () => ({
      status: 'MATCH' as const,
      similarity: 0.6,
      score: 92,
      framesAnalysed: 7,
      framesWithFace: 7,
      frameConsistency: 0.8,
      documentFaces: 1,
      provider: 'insightface-buffalo_sc-onnx' as const,
      thresholds: { match: 0.42, uncertain: 0.28 },
      liveness: actual.assessLiveness([face([40, 55]), face([50, 55]), face([60, 55])], 0.8),
    }),
  }
})
vi.mock('../server/active-liveness.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../server/active-liveness.ts')>()
  return {
    ...actual,
    verifyActiveLiveness: async (input: {
      expected: import('../server/active-liveness.ts').LivenessStep[]
      timeline: import('../server/active-liveness.ts').LivenessTimelineEntry[]
    }) => actual.judgeActiveLiveness(input.expected, input.timeline, [0.02, 0.3, -0.28, -0.04]),
  }
})

let mod: typeof import('../server/identity-verification.ts')
let mrz: typeof import('../server/mrz.ts')
let db: typeof import('../server/db.ts').db

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  createPlatformServer({ serveStatic: false })
  mod = await import('../server/identity-verification.ts')
  mrz = await import('../server/mrz.ts')
  ;({ db } = await import('../server/db.ts'))
})

const POSSIBLE = 'احتمال تكرار البطاقة'
const EXACT = 'هذه البطاقة مسجلة على حساب آخر'

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
      .run(`9647******${String(++sequence).padStart(2, '0')}`, status, now, now).lastInsertRowid
  )
}
const review = (citizenId: number) => {
  const now = new Date().toISOString()
  const id = `idv_r3dup_${++sequence}`
  db.prepare(
    `INSERT INTO identity_reviews (id, citizen_id, status, national_id_masked, consent_at, submitted_at, retention_until, created_at, updated_at) VALUES (?, ?, 'PENDING_REVIEW', 'x', ?, ?, ?, ?, ?)`
  ).run(id, citizenId, now, now, now, now, now)
  return id
}
const statusOf = (citizenId: number) =>
  (
    db.prepare('SELECT verification_status FROM citizens WHERE id = ?').get(citizenId) as {
      verification_status: string
    }
  ).verification_status
const reviewRow = (id: string) =>
  db.prepare('SELECT status, auto_decision, auto_decision_reasons FROM identity_reviews WHERE id = ?').get(id) as {
    status: string
    auto_decision: string | null
    auto_decision_reasons: string | null
  }
/** admits a citizen with this card the way the automatic step does */
const admit = (number: string) => {
  const id = citizen()
  mod.applyAutomaticDecision({
    reviewId: review(id),
    citizenId: id,
    td1: card(number),
    decision: { approve: true, reasons: [] },
  })
  expect(statusOf(id)).toBe('VERIFIED')
  return id
}

describe('schema: the folded hash has its own indexed column', () => {
  it('citizens.national_id_fold_hash exists next to national_id_hash, with an index', () => {
    const columns = (db.prepare('PRAGMA table_info(citizens)').all() as Array<{ name: string }>).map(item => item.name)
    expect(columns).toContain('national_id_hash')
    expect(columns).toContain('national_id_fold_hash')
    const indexes = (db.prepare('PRAGMA index_list(citizens)').all() as Array<{ name: string }>).map(item => item.name)
    expect(indexes).toContain('idx_citizens_national_id_fold_hash')
  })
})

describe('folded card hash', () => {
  it('two readings of one card share the folded hash; the exact hash still tells them apart', () => {
    expect(mod.nationalIdFoldHash('S12345678')).toBe(mod.nationalIdFoldHash('812345678'))
    expect(mod.nationalIdFoldHash('G81956698')).toBe(mod.nationalIdFoldHash('681956698'))
    expect(mod.nationalIdFoldHash('NL2961463')).toBe(mod.nationalIdFoldHash('N12961463'))
    expect(mod.nationalIdFoldHash('A1203U567')).toBe(mod.nationalIdFoldHash('A12030567'))
    expect(mod.nationalIdHash('S12345678')).not.toBe(mod.nationalIdHash('812345678'))
    expect(mod.nationalIdFoldHash('A12345678')).not.toBe(mod.nationalIdFoldHash('A12345679'))
    // keyed: neither hash is the number, nor a plain digest of it
    expect(mod.nationalIdFoldHash('812345678')).toMatch(/^[0-9a-f]{64}$/)
    expect(mod.nationalIdFoldHash('812345678')).not.toContain('812345678')
  })

  it('an approval registers both hashes', () => {
    const id = admit('A23456789')
    const row = db.prepare('SELECT national_id_hash, national_id_fold_hash FROM citizens WHERE id = ?').get(id) as {
      national_id_hash: string
      national_id_fold_hash: string
    }
    expect(row.national_id_hash).toBe(mod.nationalIdHash('A23456789'))
    expect(row.national_id_fold_hash).toBe(mod.nationalIdFoldHash('A23456789'))
  })
})

describe('findCardDuplicates', () => {
  it('flags a look-alike reading of a verified card as a possible duplicate, the same number as exact', () => {
    // "S12345678" for 812345678 passes every check digit as read — the zone alone cannot tell
    expect(mrz.checkDigit('S12345678')).toBe(mrz.checkDigit('812345678'))
    const first = admit('812345678')
    const second = citizen()
    expect(mod.findCardDuplicates('S12345678', second)).toEqual({ exact: false, possible: true })
    expect(mod.findCardDuplicates('812345678', second)).toEqual({ exact: true, possible: false })
    // the card's own account is never its duplicate
    expect(mod.findCardDuplicates('S12345678', first)).toEqual({ exact: false, possible: false })
    // a different card is not a duplicate
    expect(mod.findCardDuplicates('812345679', second)).toEqual({ exact: false, possible: false })
  })

  it('a look-alike counts only against a VERIFIED citizen; the exact number counts on any account', () => {
    const first = admit('G81956698')
    const second = citizen()
    expect(mod.findCardDuplicates('681956698', second).possible).toBe(true)
    db.prepare(`UPDATE citizens SET verification_status = 'REJECTED' WHERE id = ?`).run(first)
    expect(mod.findCardDuplicates('681956698', second)).toEqual({ exact: false, possible: false })
    expect(mod.findCardDuplicates('G81956698', second)).toEqual({ exact: true, possible: false })
  })

  it('accounts verified before the column existed are still matched by the exact number', () => {
    const legacy = citizen('VERIFIED')
    db.prepare('UPDATE citizens SET national_id_hash = ?, national_id_fold_hash = NULL WHERE id = ?').run(
      mod.nationalIdHash('B76543210'),
      legacy
    )
    expect(mod.findCardDuplicates('B76543210', citizen())).toEqual({ exact: true, possible: false })
  })
})

describe('automatic decision', () => {
  const name = () => ({
    status: 'MATCH' as const,
    score: 100,
    typed: 'مهاب علي ياسين',
    extracted: 'MAHAB ALI YASEEN',
    method: 'TRANSLITERATED' as const,
    matchedTokens: [],
  })

  it('a possible duplicate sends the request to a person with «احتمال تكرار البطاقة»', () => {
    const decision = mod.decideAutomatically({
      face: null,
      name: name(),
      td1: card('A12345678'),
      duplicateAccount: false,
      possibleDuplicate: true,
    })
    expect(decision.approve).toBe(false)
    expect(decision.reasons).toContain(POSSIBLE)
    expect(decision.reasons).not.toContain(EXACT)
    // the exact match says the stronger thing, once
    const both = mod.decideAutomatically({
      face: null,
      name: name(),
      td1: card('A12345678'),
      duplicateAccount: true,
      possibleDuplicate: true,
    })
    expect(both.reasons).toContain(EXACT)
    expect(both.reasons).not.toContain(POSSIBLE)
  })

  it('applyAutomaticDecision re-checks before admitting: a look-alike of a verified card is not approved', () => {
    admit('812345670')
    const second = citizen()
    const reviewId = review(second)
    // the decision was taken before the first account was admitted
    mod.applyAutomaticDecision({
      reviewId,
      citizenId: second,
      td1: card('S12345670'),
      decision: { approve: true, reasons: [] },
    })
    expect(statusOf(second)).toBe('MANUAL_REVIEW')
    const row = reviewRow(reviewId)
    expect(row.status).toBe('PENDING_REVIEW')
    expect(row.auto_decision).toBe('HUMAN_REVIEW')
    expect(JSON.parse(row.auto_decision_reasons!)).toEqual([POSSIBLE])
    const notice = db
      .prepare(`SELECT message FROM notifications WHERE citizen_id = ? AND type = 'IDENTITY_REVIEW'`)
      .get(second) as { message: string }
    expect(notice.message).toContain(POSSIBLE)
    const hashes = db
      .prepare('SELECT national_id_hash, national_id_fold_hash FROM citizens WHERE id = ?')
      .get(second) as {
      national_id_hash: string | null
      national_id_fold_hash: string | null
    }
    expect(hashes).toEqual({ national_id_hash: null, national_id_fold_hash: null })
  })
})

describe('runIdentityVerification end to end', () => {
  const run = async (number: string) => {
    engines.card = card(number)
    const id = citizen()
    const reviewId = review(id)
    await mod.runIdentityVerification({
      reviewId,
      citizenId: id,
      liveness: {
        expected: ['CENTER', 'LEFT', 'RIGHT', 'CENTER'],
        timeline: [
          { step: 'CENTER', startMs: 0, endMs: 1800 },
          { step: 'LEFT', startMs: 1800, endMs: 3600 },
          { step: 'RIGHT', startMs: 3600, endMs: 5400 },
          { step: 'CENTER', startMs: 5400, endMs: 7200 },
        ],
      },
      documentImage: Buffer.from('front'),
      documentBack: Buffer.from('back'),
      faceVideo: Buffer.from('video'),
      typedName: 'مهاب علي ياسين',
      extractedName: null,
    })
    return { id, reviewId }
  }

  it('a new card with every check passing is admitted automatically', async () => {
    const { id, reviewId } = await run('C24681357')
    expect(reviewRow(reviewId).auto_decision).toBe('APPROVED')
    expect(statusOf(id)).toBe('VERIFIED')
  })

  it('the same card read with a look-alike (8 → S) goes to human review instead of a second account', async () => {
    const original = await run('812340000')
    expect(statusOf(original.id)).toBe('VERIFIED')
    expect(mrz.checkDigit('S12340000')).toBe(mrz.checkDigit('812340000'))
    const misread = await run('S12340000')
    const row = reviewRow(misread.reviewId)
    expect(row.auto_decision).toBe('HUMAN_REVIEW')
    expect(JSON.parse(row.auto_decision_reasons!)).toEqual([POSSIBLE])
    expect(row.status).toBe('PENDING_REVIEW')
    expect(statusOf(misread.id)).toBe('MANUAL_REVIEW')
    const audit = db
      .prepare(
        `SELECT new_value FROM audit_logs WHERE action = 'IDENTITY_AUTO_VERIFIED' AND entity_id = ? ORDER BY rowid DESC LIMIT 1`
      )
      .get(misread.reviewId) as { new_value: string }
    expect(JSON.parse(audit.new_value).duplicateCard).toBe('LOOK_ALIKE')
  })

  it('the very same number again is still refused as an exact duplicate', async () => {
    await run('D97531864')
    const again = await run('D97531864')
    expect(JSON.parse(reviewRow(again.reviewId).auto_decision_reasons!)).toEqual([EXACT])
    expect(statusOf(again.id)).toBe('MANUAL_REVIEW')
  })
})
