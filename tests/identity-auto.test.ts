// Automatic identity decision: the unified card's zone + live face match + liveness admit the citizen on their own.
import { beforeAll, describe, expect, it } from 'vitest'
import { configureTestEnv, iraqiTd1 } from './helpers'

configureTestEnv()

let mod: typeof import('../server/identity-verification.ts')
let parseTd1: typeof import('../server/mrz.ts').parseTd1
let assessLiveness: typeof import('../server/face-match.ts').assessLiveness

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  createPlatformServer({ serveStatic: false })
  mod = await import('../server/identity-verification.ts')
  ;({ parseTd1 } = await import('../server/mrz.ts'))
  ;({ assessLiveness } = await import('../server/face-match.ts'))
})

const card = () =>
  parseTd1(
    iraqiTd1({
      number: 'A12345678',
      birth: '900101',
      sex: 'M',
      expiry: '300101',
      surname: 'YASEEN',
      given: 'MAHAB ALI',
    })
  )
const face = (nose: [number, number]) => ({
  box: [0, 0, 100, 100] as [number, number, number, number],
  score: 0.9,
  kps: [[30, 40], [70, 40], nose, [35, 75], [65, 75]] as Array<[number, number]>,
})
// the nose moves from one eye's side to the other: a real head turn
const turning = [face([40, 55]), face([50, 55]), face([60, 55])].map(item => ({ face: item, faces: 1 }))
const matchingFace = (overrides: Record<string, unknown> = {}) => ({
  status: 'MATCH' as const,
  similarity: 0.6,
  score: 92,
  framesAnalysed: 7,
  framesWithFace: 7,
  frameConsistency: 0.8,
  documentFaces: 1,
  provider: 'insightface-buffalo_sc-onnx' as const,
  thresholds: { match: 0.42, uncertain: 0.28 },
  liveness: assessLiveness(turning, 0.8),
  ...overrides,
})

describe('liveness from the face video', () => {
  it('a head turn with one face passes; a still face, two faces or a picture do not', () => {
    expect(assessLiveness(turning, 0.8).passed).toBe(true)
    const still = [face([50, 55]), face([50, 55]), face([50, 55])].map(item => ({ face: item, faces: 1 }))
    expect(assessLiveness(still, 0.8).reasons).toContain('لم يُلاحظ تحريك الرأس يميناً ويساراً')
    expect(
      assessLiveness(
        turning.map(item => ({ ...item, faces: 2 })),
        0.8
      ).reasons
    ).toContain('ظهر أكثر من وجه في الفيديو')
    expect(assessLiveness(turning, 0.97).reasons).toContain('الفيديو شبه ثابت كأنه صورة')
  })
})

describe('automatic decision', () => {
  it('approves only when face, liveness, card and name all agree', () => {
    const name = mod.compareNames('مهاب علي ياسين', 'MAHAB ALI YASEEN')
    expect(mod.decideAutomatically({ face: matchingFace(), name, td1: card(), duplicateAccount: false })).toEqual({
      approve: true,
      reasons: [],
    })
  })

  it('every failing check keeps the citizen out and says why', () => {
    const name = mod.compareNames('مهاب علي ياسين', 'MAHAB ALI YASEEN')
    const weak = mod.decideAutomatically({
      face: matchingFace({ status: 'UNCERTAIN', similarity: 0.35 }),
      name,
      td1: card(),
      duplicateAccount: false,
    })
    expect(weak.approve).toBe(false)
    expect(weak.reasons).toContain('الوجه في الفيديو لا يطابق صورة البطاقة بدرجة كافية')
    const noCard = mod.decideAutomatically({ face: matchingFace(), name, td1: null, duplicateAccount: false })
    expect(noCard.reasons).toContain('لم تُقرأ المنطقة المقروءة آلياً في ظهر البطاقة')
    const otherName = mod.compareNames('زينب حسن كاظم', 'MAHAB ALI YASEEN')
    expect(
      mod.decideAutomatically({ face: matchingFace(), name: otherName, td1: card(), duplicateAccount: false }).reasons
    ).toContain('الاسم المكتوب لا يطابق الاسم في البطاقة')
    expect(
      mod.decideAutomatically({ face: matchingFace(), name, td1: card(), duplicateAccount: true }).reasons
    ).toContain('هذه البطاقة مسجلة على حساب آخر')
  })

  it('an approval verifies the citizen and registers the card details; a reviewer who decided first wins', async () => {
    const { db } = await import('../server/db.ts')
    const now = new Date().toISOString()
    const citizen = Number(
      db
        .prepare(
          `INSERT INTO citizens (full_name, national_id_masked, phone_masked, verification_status, district, created_at, updated_at) VALUES ('مهاب علي ياسين', 'x', '9647******01', 'MANUAL_REVIEW', 'الناصرية', ?, ?)`
        )
        .run(now, now).lastInsertRowid
    )
    const insertReview = (id: string, status: string) =>
      db
        .prepare(
          `INSERT INTO identity_reviews (id, citizen_id, status, national_id_masked, consent_at, submitted_at, retention_until, created_at, updated_at) VALUES (?, ?, ?, 'x', ?, ?, ?, ?, ?)`
        )
        .run(id, citizen, status, now, now, now, now, now)
    insertReview('idv_auto_1', 'PENDING_REVIEW')
    mod.applyAutomaticDecision({
      reviewId: 'idv_auto_1',
      citizenId: citizen,
      td1: card(),
      decision: { approve: true, reasons: [] },
    })
    const row = db
      .prepare(
        'SELECT verification_status, date_of_birth, sex, document_expiry, latin_name, national_id_hash FROM citizens WHERE id = ?'
      )
      .get(citizen) as Record<string, string>
    expect(row.verification_status).toBe('VERIFIED')
    expect(row.date_of_birth).toBe('1990-01-01')
    expect(row.sex).toBe('ذكر')
    expect(row.document_expiry).toBe('2030-01-01')
    expect(row.latin_name).toBe('MAHAB ALI YASEEN')
    expect(row.national_id_hash).toBe(mod.nationalIdHash('A12345678'))
    // a person already rejected this one: the automatic step must not overturn it
    db.prepare(`UPDATE citizens SET verification_status = 'REJECTED' WHERE id = ?`).run(citizen)
    insertReview('idv_auto_2', 'REJECTED')
    mod.applyAutomaticDecision({
      reviewId: 'idv_auto_2',
      citizenId: citizen,
      td1: card(),
      decision: { approve: true, reasons: [] },
    })
    const after = db.prepare('SELECT verification_status FROM citizens WHERE id = ?').get(citizen) as {
      verification_status: string
    }
    expect(after.verification_status).toBe('REJECTED')
  })
})
