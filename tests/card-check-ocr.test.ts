// Reading the back of the card: several views of one photo, stopping once the zone is proved, combining lines across
// views, a time budget that a slow or stuck OCR worker cannot overrun, and a small pool of workers that a stuck or
// failing job cannot block. The OCR worker is mocked like a real tesseract worker: one job at a time.
import { crc32 } from 'node:zlib'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { iraqiTd1 } from './helpers'

type Script = { delay?: number; output?: string | Error }
const ocr = vi.hoisted(() => ({
  outputs: [] as Array<string | Error>,
  calls: 0,
  delayMs: 0,
  /** per OCR image width: a delay and/or an answer of its own (tells concurrent reads apart) */
  byWidth: {} as Record<number, Script>,
  sizes: [] as Array<{ width: number; height: number }>,
  created: 0,
  terminated: [] as number[],
  failStart: false,
}))
vi.mock('tesseract.js', () => ({
  createWorker: async () => {
    if (ocr.failStart) throw new Error('traineddata missing')
    const id = ++ocr.created
    let alive = true
    let kill = () => undefined as void
    const killed = new Promise<void>(resolve => {
      kill = resolve
    })
    // a real worker runs one job at a time: a job waits for the one before it
    let queue: Promise<unknown> = Promise.resolve()
    return {
      id,
      setParameters: async () => undefined,
      terminate: async () => {
        alive = false
        ocr.terminated.push(id)
        kill()
      },
      recognize: (image: Buffer) => {
        const job = queue.then(async () => {
          if (!alive) throw new Error('worker terminated')
          const index = ocr.calls++
          const { width = 0, height = 0 } = await (await import('sharp')).default(image).metadata()
          ocr.sizes.push({ width, height })
          const script = ocr.byWidth[width] ?? {}
          const delay = script.delay ?? ocr.delayMs
          if (delay) await Promise.race([new Promise(resolve => setTimeout(resolve, delay)), killed])
          if (!alive) throw new Error('worker terminated')
          const output = script.output ?? ocr.outputs[Math.min(index, ocr.outputs.length - 1)] ?? ''
          if (output instanceof Error) throw output
          return { data: { text: output, confidence: 80 } }
        })
        queue = job.catch(() => undefined)
        return job
      },
    }
  },
}))

let readMrzLocally: typeof import('../server/local-identity-ocr.ts').readMrzLocally
let photo: Buffer
/** a second photo whose views the OCR sees 1700 px wide (the 900 px one is enlarged to 1600) */
let widePhoto: Buffer

beforeAll(async () => {
  ;({ readMrzLocally } = await import('../server/local-identity-ocr.ts'))
  photo = await sharp({ create: { width: 900, height: 570, channels: 3, background: '#efeae0' } })
    .jpeg()
    .toBuffer()
  widePhoto = await sharp({ create: { width: 1700, height: 1075, channels: 3, background: '#efeae0' } })
    .jpeg()
    .toBuffer()
})

beforeEach(() => {
  ocr.outputs = []
  ocr.calls = 0
  ocr.delayMs = 0
  ocr.byWidth = {}
  ocr.sizes = []
  ocr.terminated = []
  ocr.failStart = false
})

const CARD = iraqiTd1({
  number: 'A12345678',
  birth: '900101',
  sex: 'M',
  expiry: '300101',
  surname: 'YASEEN',
  given: 'MAHAB ALI',
})
const [L1, L2, L3] = CARD.split('\n')
/** line 2 with one check digit (6: birth, 14: expiry) misread digit-for-digit */
const wrongCheck = (at: number) => `${L2.slice(0, at)}${(Number(L2[at]) + 3) % 10}${L2.slice(at + 1)}`

describe('reading the zone from a photo of the back', () => {
  it('stops at the first view when it passes every check digit on its own', async () => {
    ocr.outputs = [CARD]
    const read = await readMrzLocally(photo, { budgetMs: 3_000 })
    expect(read).toMatchObject({ status: 'ok', attempts: 1, engine: 'ok' })
    expect(read.td1?.documentNumber).toBe('A12345678')
  })

  it('a zone first proved by a later view is read once more: a second view must agree', async () => {
    ocr.outputs = ['noise', CARD]
    const read = await readMrzLocally(photo, { budgetMs: 3_000 })
    expect(read.status).toBe('ok')
    expect(read.attempts).toBe(3)
    expect(read.td1?.documentNumber).toBe('A12345678')
  })

  it('combines lines read in different views, and trusts them once another view reads the same', async () => {
    // each view misreads one digit for another (nothing a look-alike rule may undo) — but not the same line
    ocr.outputs = [
      [L1, wrongCheck(6), L3].join('\n'),
      [L1.replace('A12345678', 'A12345679'), L2, L3].join('\n'),
      [L1, wrongCheck(14), L3].join('\n'),
    ]
    const read = await readMrzLocally(photo, { budgetMs: 3_000 })
    expect(read.status).toBe('ok')
    expect(read.attempts).toBe(3)
    expect(read.td1?.birthDate).toBe('1990-01-01')
  })

  it('lines combined from two views that no other view confirms stay partial', async () => {
    ocr.outputs = [[L1, wrongCheck(6), L3].join('\n'), [L1.replace('A12345678', 'A12345679'), L2, L3].join('\n')]
    const read = await readMrzLocally(photo, { budgetMs: 10_000 })
    expect(read.status).toBe('partial')
    expect(read.td1?.unconfirmed).toBe(true)
    expect(read.attempts).toBe(7)
  })

  it('looks at the photo several ways: bottom band, wider band, binarised, turned, upside down, whole', async () => {
    ocr.outputs = ['']
    const read = await readMrzLocally(photo, { budgetMs: 10_000 })
    expect(read.status).toBe('unreadable')
    expect(read.attempts).toBe(7)
    expect(read.engine).toBe('ok')
    // small photos are enlarged for the OCR (≈30 px characters), and the bands are cut from the bottom
    expect(Math.min(...ocr.sizes.map(size => size.width))).toBeGreaterThanOrEqual(1_600)
    expect(ocr.sizes[0].height).toBeLessThan(ocr.sizes[2].height)
  })

  it('keeps within the time budget when the OCR is slow', async () => {
    ocr.outputs = ['']
    ocr.delayMs = 250
    const started = Date.now()
    const read = await readMrzLocally(photo, { budgetMs: 700 })
    const elapsed = Date.now() - started
    expect(read.status).toBe('unreadable')
    expect(read.attempts).toBeGreaterThanOrEqual(1)
    expect(read.attempts).toBeLessThan(7)
    expect(elapsed).toBeLessThan(700 + 600)
  })

  it('a photo that is not an image reads as unreadable, never throws', async () => {
    const read = await readMrzLocally(Buffer.from('not an image at all'))
    expect(read).toMatchObject({ td1: null, status: 'unreadable', attempts: 0, engine: 'ok' })
  })
})

describe('large photos', () => {
  it('a big photo is scaled down once, before any view: the OCR never sees more than 1800 px across', async () => {
    const big = await sharp({ create: { width: 4000, height: 2600, channels: 3, background: '#efeae0' } })
      .jpeg()
      .toBuffer()
    ocr.outputs = ['']
    const read = await readMrzLocally(big, { budgetMs: 10_000 })
    expect(read.attempts).toBe(7)
    expect(Math.max(...ocr.sizes.map(size => size.width))).toBeLessThanOrEqual(1_800)
  })

  it('a picture claiming more pixels than any card photo is refused before it is decoded', async () => {
    // a PNG header for 20000 × 20000 pixels (400 MP) and nothing behind it
    const chunk = (type: string, data: Buffer) => {
      const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
      const length = Buffer.alloc(4)
      length.writeUInt32BE(data.length)
      const crc = Buffer.alloc(4)
      crc.writeUInt32BE(crc32(body))
      return Buffer.concat([length, body, crc])
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(20_000, 0)
    header.writeUInt32BE(20_000, 4)
    header.set([8, 2, 0, 0, 0], 8)
    const huge = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IEND', Buffer.alloc(0)),
    ])
    const started = Date.now()
    const read = await readMrzLocally(huge, { budgetMs: 3_000 })
    expect(read).toMatchObject({ status: 'unreadable', attempts: 0 })
    expect(ocr.calls).toBe(0)
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})

describe('the OCR workers', () => {
  it('a stuck read takes its own worker down, so the reads after it work at once', async () => {
    ocr.outputs = ['']
    ocr.delayMs = 30_000
    const started = Date.now()
    const stuck = await readMrzLocally(photo, { budgetMs: 300 })
    expect(Date.now() - started).toBeLessThan(2_000)
    // nothing was read at all: the engine could not look at the photo, which says nothing about the photo
    expect(stuck).toMatchObject({ status: 'unreadable', attempts: 0, engine: 'unavailable' })
    expect(ocr.terminated).toHaveLength(1)
    ocr.delayMs = 0
    ocr.calls = 0
    ocr.outputs = [CARD]
    for (let round = 0; round < 3; round++) {
      const read = await readMrzLocally(photo, { budgetMs: 3_000 })
      expect(read.status, `read ${round + 1} after the stuck one`).toBe('ok')
    }
  })

  it('reads at the same time each get a worker, or wait for one — none is told the photo is unclear', async () => {
    ocr.outputs = [CARD]
    // a long background read (submission) holds one worker for a while
    ocr.byWidth[1700] = { delay: 1_200, output: CARD }
    const long = readMrzLocally(widePhoto, { budgetMs: 6_000 })
    const instant = await Promise.all([1, 2, 3].map(() => readMrzLocally(photo, { budgetMs: 3_000 })))
    expect(instant.map(read => read.status)).toEqual(['ok', 'ok', 'ok'])
    expect((await long).status).toBe('ok')
    expect(ocr.terminated).toEqual([])
  })

  it('a worker that fails only takes itself down, never the worker another read is using', async () => {
    // read A fails late on its worker while read B is reading on the other one
    ocr.byWidth[1700] = { delay: 300, output: new Error('worker crashed') }
    ocr.byWidth[1600] = { delay: 600, output: CARD }
    const created = ocr.created
    const [failed, fine] = await Promise.all([
      readMrzLocally(widePhoto, { budgetMs: 3_000 }),
      readMrzLocally(photo, { budgetMs: 3_000 }),
    ])
    expect(failed).toMatchObject({ status: 'unreadable', engine: 'unavailable' })
    expect(fine.status).toBe('ok')
    expect(ocr.terminated).toHaveLength(1)
    // and the next read still has a working worker
    ocr.byWidth = {}
    ocr.outputs = [CARD]
    ocr.calls = 0
    expect((await readMrzLocally(photo, { budgetMs: 3_000 })).status).toBe('ok')
    expect(ocr.created - created).toBeLessThanOrEqual(2)
  })

  it('an engine that does not start says so, instead of calling the photo unclear', async () => {
    // the pool has room again only once its workers are retired: take them down first
    ocr.outputs = ['']
    ocr.delayMs = 30_000
    await Promise.all([readMrzLocally(photo, { budgetMs: 200 }), readMrzLocally(photo, { budgetMs: 200 })])
    ocr.delayMs = 0
    ocr.failStart = true
    const read = await readMrzLocally(photo, { budgetMs: 3_000 })
    expect(read).toMatchObject({ td1: null, status: 'unreadable', attempts: 0, engine: 'unavailable' })
    ocr.failStart = false
    ocr.outputs = [CARD]
    ocr.calls = 0
    expect((await readMrzLocally(photo, { budgetMs: 3_000 })).status).toBe('ok')
  })
})
