// The instant check after each card photo (POST /api/onboarding/card-check) is forgiving: the back answers 'ok',
// 'partial' or 'unreadable' and never blocks the citizen; the front is 'bad' only when no portrait shows at all.
// OCR and face engines are mocked — no traineddata or model is loaded here.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import sharp from 'sharp'
import { checkDigit } from '../server/mrz'
import { configureTestEnv, cookieOf, iraqiTd1 } from './helpers'

const ocr = vi.hoisted(() => ({ outputs: [] as Array<string | Error>, calls: 0 }))
vi.mock('tesseract.js', () => ({
  createWorker: async () => ({
    setParameters: async () => undefined,
    terminate: async () => undefined,
    recognize: async () => {
      const next = ocr.outputs[Math.min(ocr.calls++, ocr.outputs.length - 1)] ?? ''
      if (next instanceof Error) throw next
      return { data: { text: next, confidence: 80 } }
    },
  }),
}))

const face = vi.hoisted(() => ({ available: true, found: [] as boolean[], calls: 0, fails: false }))
vi.mock('../server/face-match.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../server/face-match.ts')>()),
  faceMatchAvailable: () => face.available,
  embedLargestFace: async () => {
    const found = face.found[face.calls++] ?? false
    if (face.fails) throw new Error('model failed to load')
    return found ? { embedding: [], face: { box: [0, 0, 10, 10], score: 0.9, kps: [] }, faces: 1 } : null
  },
}))

configureTestEnv()

let app: Express
let cookie = ''
let photo: Buffer

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  const phone = '07801239311'
  const { challengeId } = (await request(app).post('/api/onboarding/request-otp').send({ phone })).body
  cookie = cookieOf(await request(app).post('/api/onboarding/verify-phone').send({ phone, challengeId, otp: '246810' }))
  // any real image will do: the OCR engine is mocked, the photo still goes through the real preprocessing
  photo = await sharp({ create: { width: 900, height: 570, channels: 3, background: '#f4f1ea' } })
    .composite([
      {
        input: await sharp({ create: { width: 800, height: 40, channels: 3, background: '#222222' } })
          .png()
          .toBuffer(),
        top: 470,
        left: 50,
      },
    ])
    .jpeg()
    .toBuffer()
})

beforeEach(() => {
  ocr.outputs = []
  ocr.calls = 0
  face.available = true
  face.found = []
  face.calls = 0
  face.fails = false
})

const check = (side: 'front' | 'back') =>
  request(app)
    .post('/api/onboarding/card-check')
    .set('Cookie', cookie)
    .field('side', side)
    .attach('image', photo, { filename: `card-${side}.jpg`, contentType: 'image/jpeg' })

const CARD = iraqiTd1({
  number: 'A12345678',
  birth: '900101',
  sex: 'M',
  expiry: '300101',
  surname: 'YASEEN',
  given: 'MAHAB ALI',
})
// what the OCR of a phone photo really returns: stray lines, spaces, «, look-alikes (O for 0, S for 5, I for 1)
const NOISY = `REPUBLIC OF IRAQ\n${CARD.replace('A12345678', 'A1234S678')
  .replace('9001', '9OO1')
  .replace('IRQ<<<', 'IRQ«<<')
  .replace('YASEEN<<', 'YASEEN <<')}\nX7 <K`

describe('card check — back of the card', () => {
  it('reads a noisy zone, says so and stops at the first view that proves it', async () => {
    ocr.outputs = [NOISY]
    const response = await check('back')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      side: 'back',
      status: 'ok',
      ok: true,
      canContinue: true,
      retakeSuggested: false,
      problems: [],
      card: {
        name: 'MAHAB ALI YASEEN',
        documentLast4: '5678',
        birthDate: '1990-01-01',
        expiryDate: '2030-01-01',
        sex: 'ذكر',
        nationality: 'IRQ',
        valid: true,
        unconfirmed: [],
      },
    })
    expect(ocr.calls).toBe(1)
  })

  it('tries other views of the photo when the first one does not read', async () => {
    ocr.outputs = ['جمهورية العراق\n<<<', 'MINISTRY OF INTERIOR', NOISY]
    const response = await check('back')
    expect(response.body.status).toBe('ok')
    // the third view proves the zone and a fourth one agrees with it (a later view is never trusted alone)
    expect(ocr.calls).toBe(4)
  })

  it('lines combined from two views that no other view confirms: partial, the number named as not yet sure', async () => {
    const [l1, l2, l3] = CARD.split('\n')
    // one view misreads the birth check digit, the other the number — combined, every check holds
    ocr.outputs = [
      [l1, `${l2.slice(0, 6)}4${l2.slice(7)}`, l3].join('\n'),
      [l1.replace('A12345678', 'A12345679'), l2, l3].join('\n'),
    ]
    const response = await check('back')
    expect(response.body).toMatchObject({ status: 'partial', ok: false, canContinue: true, card: { valid: false } })
    expect(response.body.card.unconfirmed).toEqual(['documentNumber'])
    expect(response.body.message).toContain('رقم البطاقة')
  })

  it('logs what the camera measured on the photo next to what the OCR made of it', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    ocr.outputs = [CARD]
    await request(app)
      .post('/api/onboarding/card-check')
      .set('Cookie', cookie)
      .field('side', 'back')
      .attach('image', photo, { filename: 'card-back-1760000000000-s1834-still.jpg', contentType: 'image/jpeg' })
    const line = info.mock.calls.map(call => String(call[0])).find(text => text.startsWith('[card-check]'))
    info.mockRestore()
    expect(line).toMatch(/status=ok .*sharpness=1834 source=still/)
  })

  it('a zone read in part comes back as partial — data shown, unproved fields named, the citizen carries on', async () => {
    // the birth date misread digit-for-digit: no look-alike rule may explain it away
    const misread = CARD.replace('9001011', '9001081')
    ocr.outputs = [misread]
    const response = await check('back')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      status: 'partial',
      ok: false,
      canContinue: true,
      retakeSuggested: true,
      problems: [],
      card: { name: 'MAHAB ALI YASEEN', expiryDate: '2030-01-01', valid: false },
    })
    expect(response.body.card.unconfirmed).toContain('birthDate')
    expect(response.body.message).toContain('تاريخ الميلاد')
    // every view was tried before settling for partial
    expect(ocr.calls).toBeGreaterThan(1)
  })

  it('no zone at all is "unreadable" — still a 200 the citizen can continue from', async () => {
    ocr.outputs = ['', 'REPUBLIC OF IRAQ', '|||']
    const response = await check('back')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      side: 'back',
      status: 'unreadable',
      ok: false,
      canContinue: true,
      retakeSuggested: true,
      card: null,
    })
    expect(response.body.message).toMatch(/يمكنك المتابعة/)
  })

  it('an OCR engine that fails is "unavailable": no error, and the citizen is not told to retake a good photo', async () => {
    ocr.outputs = [new Error('worker crashed')]
    const response = await check('back')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      status: 'unavailable',
      ok: false,
      canContinue: true,
      retakeSuggested: false,
      card: null,
      message: 'سيُتحقق من الصورة بعد الإرسال.',
    })
    // the broken worker was replaced: the next photo reads again
    ocr.outputs = [NOISY]
    ocr.calls = 0
    expect((await check('back')).body.status).toBe('ok')
  })

  it('a proved zone of an expired or foreign card is reported, with a retake suggested', async () => {
    const expired = iraqiTd1({
      number: 'A12345678',
      birth: '900101',
      sex: 'F',
      expiry: '200101',
      surname: 'HASSAN',
      given: 'ZAINAB',
    })
    ocr.outputs = [expired]
    const response = await check('back')
    expect(response.body.status).toBe('ok')
    expect(response.body.problems).toContain('البطاقة منتهية الصلاحية')
    expect(response.body.retakeSuggested).toBe(true)
  })

  it('the unified card layout (ID + national number in the optional data) reads through look-alikes', async () => {
    const number = 'AB1234567'
    const optional1 = '199012345678<<<'
    const l1Body = `${number}${checkDigit(number)}${optional1}`
    const birth = `900101${checkDigit('900101')}`
    const expiry = `300101${checkDigit('300101')}`
    const composite = checkDigit(`${l1Body}${birth}${expiry}${'<'.repeat(11)}`)
    const zone = [
      `IDIRQ${l1Body}`,
      `${birth}M${expiry}IRQ${'<'.repeat(11)}${composite}`,
      'YASEEN<<MAHAB<ALI'.padEnd(30, '<'),
    ]
    // national number with S for 5 and O for 0, filler run one short, IRQ read as 1RQ
    ocr.outputs = [
      [
        zone[0].replace('199012345678', '199O1234S678').replace('<<<', '<<'),
        zone[1].replace('IRQ', '1RQ'),
        zone[2],
      ].join('\n'),
    ]
    const response = await check('back')
    expect(response.body.status).toBe('ok')
    expect(response.body.card.documentLast4).toBe('4567')
  })
})

describe('card check — front of the card', () => {
  it('a portrait found is "ok"', async () => {
    face.found = [true]
    const response = await check('front')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ side: 'front', status: 'ok', ok: true, faceFound: true, canContinue: true })
  })

  it('a small portrait missed in the whole photo is looked for in each side of it', async () => {
    face.found = [false, false, true]
    const response = await check('front')
    expect(response.body).toMatchObject({ status: 'ok', faceFound: true })
    expect(face.calls).toBe(3)
  })

  it('"bad" only when no portrait shows anywhere', async () => {
    face.found = [false, false, false]
    const response = await check('front')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'bad', ok: false, faceFound: false, retakeSuggested: true })
  })

  it('an engine that cannot judge (missing or failing) never fails the photo', async () => {
    face.fails = true
    expect((await check('front')).body).toMatchObject({ status: 'ok', faceFound: false, retakeSuggested: false })
    face.fails = false
    face.available = false
    expect((await check('front')).body).toMatchObject({ status: 'ok', faceFound: false })
  })
})
