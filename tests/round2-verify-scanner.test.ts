// /verify scanner: the platform's codes (QR token TQD1.<key>.<sig>, Code 128 manual code) must be readable in every
// browser, not only where the native BarcodeDetector exists. The fallback is ZXing-C++ (zxing-wasm); these tests decode
// codes generated exactly as the server prints them (qrcode / bwip-js) plus the committed document renders, with the
// same reader options and frame geometry the page uses.
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import QRCode from 'qrcode'
import sharp from 'sharp'
import request from 'supertest'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import { configureTestEnv } from './helpers'
import {
  fitWithin,
  frameRegion,
  pickVerificationId,
  rankHits,
  readWithZxing,
  verificationIdFromScan,
  ZXING_CAMERA_OPTIONS,
  ZXING_PHOTO_OPTIONS,
  type PixelFrame,
} from '../src/lib/qr-decode'
import { cameraErrorCode, CameraScanError, FRAME_INTERVAL_MS, MAX_FRAME_EDGE } from '../src/lib/qr-decode-camera'

configureTestEnv()

const require = createRequire(import.meta.url)
const SAMPLES = fileURLToPath(new URL('../docs/document-samples/png/', import.meta.url))

type Token = typeof import('../server/documents/token.ts')
let token: Token
let signed: { token: string; manualCode: string }

beforeAll(async () => {
  // Node has no fetch for the hashed asset: hand the reader the same .wasm file the browser downloads
  await prepareZXingModule({
    overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) },
    fireImmediately: true,
  })
  token = await import('../server/documents/token.ts')
  signed = token.signDocument({
    docKey: token.newDocKey(),
    documentNumber: 'TQD-GOV-2026-000777',
    templateId: 'certificate',
    departmentId: 'dhiqar-governorate',
    issuedAt: '2026-10-10T08:00:00.000Z',
    expiresAt: null,
    holderDigest: token.holderDigestOf(7, 'زينب علي'),
  })
})

async function frameOf(image: sharp.Sharp): Promise<PixelFrame> {
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    width: info.width,
    height: info.height,
  }
}

const read = (frame: PixelFrame, options = ZXING_CAMERA_OPTIONS) => readWithZxing(readBarcodes, frame, options)

/** QR as drawQr() prints it: dark-green vector modules, 2-module quiet zone, white emblem box at level H. */
async function printedQrPng(payload: string, cell = 8) {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'H' })
  const count = qr.modules.size
  const quiet = 2
  const side = (count + quiet * 2) * cell
  const pixels = Buffer.alloc(side * side * 3, 0xff)
  for (let row = 0; row < count; row += 1)
    for (let col = 0; col < count; col += 1) {
      if (!qr.modules.get(row, col)) continue
      for (let y = 0; y < cell; y += 1)
        for (let x = 0; x < cell; x += 1) {
          const at = (((quiet + row) * cell + y) * side + (quiet + col) * cell + x) * 3
          pixels[at] = 0x0b
          pixels[at + 1] = 0x3b
          pixels[at + 2] = 0x2e
        }
    }
  const box = Math.max(5, Math.round(count * 0.2)) + 1 // the emblem's white box, as in drawQr
  const start = Math.round((side - box * cell) / 2)
  for (let y = start; y < start + box * cell; y += 1)
    pixels.fill(0xff, (y * side + start) * 3, (y * side + start + box * cell) * 3)
  return sharp(pixels, { raw: { width: side, height: side, channels: 3 } })
    .png()
    .toBuffer()
}

/** A white "page" with the codes placed on it, like a phone pointed at a document. */
async function page(
  width: number,
  height: number,
  items: Array<{ png: Buffer; left: number; top: number; width: number }>
) {
  const composites = await Promise.all(
    items.map(async item => ({
      input: await sharp(item.png).resize({ width: item.width }).toBuffer(),
      left: item.left,
      top: item.top,
    }))
  )
  return sharp({ create: { width, height, channels: 3, background: '#F7F5EE' } })
    .composite(composites)
    .png()
    .toBuffer()
}

describe('scanned value → /verify id', () => {
  it('accepts the signed QR token as is and the manual code in any spacing or case', () => {
    expect(verificationIdFromScan(signed.token, { strict: true })).toBe(signed.token)
    const compact = signed.manualCode.replaceAll('-', '')
    expect(verificationIdFromScan(compact, { strict: true })).toBe(signed.manualCode)
    expect(verificationIdFromScan(` ${compact.toLowerCase().match(/.{4}/g)!.join(' ')} `)).toBe(signed.manualCode)
    // invisible marks some readers / clipboards add
    expect(verificationIdFromScan(`﻿‎${signed.token}‏`, { strict: true })).toBe(signed.token)
  })

  it('keeps legacy /verify/ URLs working and ignores codes that are not the platform’s while scanning', () => {
    expect(verificationIdFromScan('https://thi-qar.com/verify/AB12-cd_34?utm=x#top', { strict: true })).toBe(
      'AB12-cd_34'
    )
    expect(verificationIdFromScan(`https://www.thi-qar.com/verify/${encodeURIComponent(signed.token)}`)).toBe(
      signed.token
    )
    for (const foreign of ['https://example.com/menu', 'WIFI:S:cafe;T:WPA;P:secret;;', '6291041500213', 'hello world'])
      expect(verificationIdFromScan(foreign, { strict: true })).toBeNull()
    // typed by hand: lenient, the server answers "invalid" itself
    expect(verificationIdFromScan('  OLD-ID-1234 ')).toBe('OLD-ID-1234')
    expect(verificationIdFromScan('   ')).toBeNull()
  })

  it('agrees with the server parser on every code the scanner accepts', () => {
    for (const value of [
      signed.token,
      signed.manualCode,
      signed.manualCode.replaceAll('-', ''),
      'https://x/verify/LEGACY_01',
    ])
      expect(token.parseVerificationCode(verificationIdFromScan(value, { strict: true })!).kind).not.toBe('invalid')
  })

  it('prefers the signed QR token, then the manual code, and skips foreign codes', () => {
    const manual = { text: signed.manualCode.replaceAll('-', ''), format: 'code128' as const }
    const qr = { text: signed.token, format: 'qr' as const }
    const foreign = { text: 'https://example.com', format: 'qr' as const }
    expect(rankHits([foreign, manual, qr])[0]).toBe(qr)
    expect(pickVerificationId([foreign, manual])).toBe(signed.manualCode)
    expect(pickVerificationId([foreign])).toBeNull()
  })
})

describe('frame geometry', () => {
  it('downscales camera frames to the canvas budget and alternates whole picture / centre crop', () => {
    expect(FRAME_INTERVAL_MS).toBeLessThanOrEqual(130) // ~8 fps
    expect(fitWithin(1920, 1080, MAX_FRAME_EDGE)).toMatchObject({ width: 960, height: 540 })
    expect(fitWithin(640, 480, MAX_FRAME_EDGE)).toMatchObject({ width: 640, height: 480, scale: 1 }) // never upscales
    expect(frameRegion(0, 1920, 1080, MAX_FRAME_EDGE)).toEqual({
      sx: 0,
      sy: 0,
      sw: 1920,
      sh: 1080,
      width: 960,
      height: 540,
    })
    const centre = frameRegion(1, 1920, 1080, MAX_FRAME_EDGE)
    expect(centre).toMatchObject({ sx: 384, sy: 216, sw: 1152, sh: 648 })
    expect(Math.max(centre.width, centre.height)).toBe(MAX_FRAME_EDGE)
  })
})

describe('ZXing WebAssembly fallback reads the printed codes', () => {
  it('reads the QR exactly as drawQr prints it (dark green, emblem hole, level H)', async () => {
    const qr = await printedQrPng(signed.token)
    const hits = await read(await frameOf(sharp(await page(960, 540, [{ png: qr, left: 380, top: 120, width: 260 }]))))
    expect(hits).toContainEqual({ text: signed.token, format: 'qr' })
    expect(pickVerificationId(hits)).toBe(signed.token)
  })

  it('reads the Code 128 rendered by the server (code128Png) and maps it to the manual code', async () => {
    const { code128Png } = await import('../server/documents/security.ts')
    const barcode = await code128Png(signed.manualCode.replaceAll('-', ''))
    const hits = await read(
      await frameOf(sharp(await page(960, 540, [{ png: barcode, left: 120, top: 220, width: 720 }])))
    )
    expect(hits).toContainEqual({ text: signed.manualCode.replaceAll('-', ''), format: 'code128' })
    expect(pickVerificationId(hits)).toBe(signed.manualCode)
  })

  it('reads a tilted, blurred, JPEG-compressed camera frame through the page’s centre crop', async () => {
    const { code128Png } = await import('../server/documents/security.ts')
    const barcode = await code128Png(signed.manualCode.replaceAll('-', ''))
    // a 1080p frame where the barcode spans only ~35% of the width: too thin once the whole frame is downscaled
    const scene = await sharp(await page(1920, 1080, [{ png: barcode, left: 620, top: 470, width: 680 }]))
      .rotate(4, { background: '#F7F5EE' })
      .resize(1920, 1080, { fit: 'cover' })
      .blur(0.8)
      .jpeg({ quality: 55 })
      .toBuffer()
    const region = frameRegion(1, 1920, 1080, MAX_FRAME_EDGE)
    const crop = sharp(scene)
      .extract({ left: region.sx, top: region.sy, width: region.sw, height: region.sh })
      .resize(region.width, region.height)
    const hits = await read(await frameOf(crop))
    expect(pickVerificationId(hits)).toBe(signed.manualCode)
  })

  it('reads a sideways, compressed phone photo with the photo settings', async () => {
    const qr = await printedQrPng(signed.token, 6)
    const photo = await sharp(await page(1600, 1200, [{ png: qr, left: 900, top: 700, width: 300 }]))
      .rotate(90)
      .jpeg({ quality: 50 })
      .toBuffer()
    const hits = await read(await frameOf(sharp(photo)), ZXING_PHOTO_OPTIONS)
    expect(pickVerificationId(hits)).toBe(signed.token)
  })

  it('reads the QR (and, where large enough, the barcode) on every committed document render', async () => {
    const files = readdirSync(SAMPLES).filter(name => name.endsWith('.png') && name !== '17-id-card.png') // front of the card has no code
    expect(files.length).toBeGreaterThanOrEqual(17)
    let barcodes = 0
    for (const name of files) {
      const hits = await read(await frameOf(sharp(join(SAMPLES, name))), ZXING_PHOTO_OPTIONS)
      const qr = hits.find(hit => hit.format === 'qr')
      expect(qr?.text, name).toMatch(/^TQD1\.[A-HJ-NP-Z2-9]{16}\.[A-Za-z0-9_-]{22}$/)
      expect(pickVerificationId(hits), name).toBe(qr!.text)
      const linear = hits.find(hit => hit.format === 'code128')
      if (linear) {
        barcodes += 1
        // the barcode carries the same document key as the QR, plus its own check symbols
        expect(linear.text.slice(0, 16), name).toBe(qr!.text.split('.')[1])
        expect(verificationIdFromScan(linear.text, { strict: true }), name).toMatch(
          /^([A-HJ-NP-Z2-9]{4}-){4}[A-HJ-NP-Z2-9]{4}$/
        )
      }
    }
    expect(barcodes).toBeGreaterThanOrEqual(5)
  })

  it('finds nothing in a picture without codes, and ignores a foreign QR', async () => {
    expect(await read(await frameOf(sharp(await page(640, 480, []))))).toEqual([])
    const foreign = await QRCode.toBuffer('https://example.com/menu', { margin: 2, scale: 6 })
    const hits = await read(
      await frameOf(sharp(await page(640, 480, [{ png: foreign, left: 200, top: 120, width: 220 }])))
    )
    expect(hits).toEqual([{ text: 'https://example.com/menu', format: 'qr' }])
    expect(pickVerificationId(hits)).toBeNull()
  })
})

describe('camera errors', () => {
  it('maps getUserMedia failures to actionable messages', () => {
    const named = (name: string) => Object.assign(new Error(name), { name })
    expect(cameraErrorCode(named('NotAllowedError'))).toBe('denied')
    expect(cameraErrorCode(named('PermissionDeniedError'))).toBe('denied')
    expect(cameraErrorCode(named('NotFoundError'))).toBe('not-found')
    expect(cameraErrorCode(named('OverconstrainedError'))).toBe('not-found')
    expect(cameraErrorCode(named('NotReadableError'))).toBe('busy')
    expect(cameraErrorCode(new CameraScanError('reader'))).toBe('reader')
    expect(cameraErrorCode(new Error('boom'))).toBe('unknown')
  })
})

describe('content security policy', () => {
  it('lets the same-origin WebAssembly reader compile without allowing JavaScript eval', async () => {
    const { createApp } = await import('../server/http/app.ts')
    const { app } = createApp()
    app.get('/__csp-probe', (_req, res) => res.send('<!doctype html>')) // express' own 404 page has its own CSP
    const response = await request(app).get('/__csp-probe')
    const csp = String(response.headers['content-security-policy'])
    const scriptSrc = csp.split(';').find(part => part.trim().startsWith('script-src'))!
    expect(scriptSrc).toContain("'wasm-unsafe-eval'")
    expect(scriptSrc).not.toMatch(/'unsafe-eval'|'unsafe-inline'|https?:/)
    expect(csp).toMatch(/connect-src[^;]*'self'/) // the .wasm is fetched from our own origin, never a CDN
  })
})
