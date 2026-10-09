// Identity and OTP hardening found in the 2026-10-09 audit (docs/audit/PLATFORM_QA_2026-10-09.md §11).
import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()

let app: Express

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
})

const requestOtp = (phone: string) => request(app).post('/api/onboarding/request-otp').send({ phone })
const verify = (phone: string, challengeId: string, otp = '246810') =>
  request(app).post('/api/onboarding/verify-phone').send({ phone, challengeId, otp })

describe('one-time passwords', () => {
  it('a new code retires the previous one', async () => {
    const phone = '07801239001'
    const first = await requestOtp(phone)
    const second = await requestOtp(phone)
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    const old = await verify(phone, first.body.challengeId)
    expect(old.status).toBe(400)
    const fresh = await verify(phone, second.body.challengeId)
    expect(fresh.status).toBe(200)
  })

  it('requesting several codes never counts as failed guesses', async () => {
    const phone = '07801239002'
    let last = ''
    for (let i = 0; i < 4; i++) last = (await requestOtp(phone)).body.challengeId
    expect((await verify(phone, last)).status).toBe(200)
  })

  it('wrong codes are capped per phone per day, across challenges', async () => {
    const { db } = await import('../server/db.ts')
    const phone = '07801239003'
    const { challengeId } = (await requestOtp(phone)).body
    // simulate a day of guessing spread over earlier challenges
    db.prepare('UPDATE otp_challenges SET attempts = 4 WHERE id = ?').run(challengeId)
    const row = db.prepare('SELECT phone_hash FROM otp_challenges WHERE id = ?').get(challengeId) as {
      phone_hash: string
    }
    const now = new Date().toISOString()
    for (let i = 0; i < 4; i++)
      db.prepare(
        `INSERT INTO otp_challenges (id, phone_hash, phone_masked, code_hash, delivery_status, attempts, max_attempts, expires_at, created_ip_hash, created_at)
         VALUES (?, ?, 'x', 'x', 'DEV_MODE', 5, 5, ?, 'ip', ?)`
      ).run(`otp_guess_${i}`, row.phone_hash, now, now)
    const blocked = await verify(phone, challengeId)
    expect(blocked.status).toBe(400)
    expect(blocked.body.message).toMatch(/اليومية/)
  })

  it('dev mode can never be on in a hosted deployment', async () => {
    const { otpDevMode } = await import('../server/otp.ts')
    expect(otpDevMode()).toBe(true)
    process.env.RAILWAY_ENVIRONMENT = 'production'
    try {
      expect(otpDevMode()).toBe(false)
    } finally {
      delete process.env.RAILWAY_ENVIRONMENT
    }
  })
})

describe('identity submission', () => {
  it('the retired complete-identity route cannot rename a citizen', async () => {
    const phone = '07801239004'
    const challenge = (await requestOtp(phone)).body.challengeId
    const cookie = cookieOf(await verify(phone, challenge))
    const renamed = await request(app)
      .post('/api/onboarding/complete-identity')
      .set('Cookie', cookie)
      .send({ fullName: 'اسم مختلف تماما', consent: true, livenessPassed: true })
    expect(renamed.status).toBe(410)
  })

  it('a face video uploaded from the device (camera fallback) is not rejected for its file name', async () => {
    const { screenIdentitySubmission } = await import('../server/identity-screening.ts')
    const image = { originalname: 'id.jpg', mimetype: 'image/jpeg', size: 80_000, buffer: Buffer.alloc(8) }
    const result = screenIdentitySubmission({
      idFront: image,
      idBack: image,
      faceVideo: {
        originalname: 'VID_20261009_101500.mp4',
        mimetype: 'video/mp4',
        size: 900_000,
        buffer: Buffer.alloc(8),
      },
    })
    expect(result.qualityStatus).toBe('PASSED')
    // the reviewer still sees that it did not come from the in-app camera
    expect(result.qualityChecks.find(item => item.key === 'face-video-client-duration')?.passed).toBe(false)
  })

  it('names read as OCR fragments are refused; real names pass', async () => {
    const { plausiblePersonName } = await import('../server/person-name.ts')
    expect(plausiblePersonName('ار ا وا ل لحر اه ا')).toBe(false)
    expect(plausiblePersonName('علي')).toBe(false)
    expect(plausiblePersonName('حسين علي كاظم')).toBe(true)
    expect(plausiblePersonName('عبد الله محمد الركابي')).toBe(true)
    expect(plausiblePersonName('MAHAB ALI YASEEN')).toBe(true)
  })
})
