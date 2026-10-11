import type { ReaderOptions, ReadResult } from 'zxing-wasm/reader'

/**
 * Reading the codes printed on the platform's documents, without the DOM (shared by the /verify scanner and tests).
 *
 *   QR        TQD1.<docKey>.<sig>          opaque signed token (see server/documents/token.ts), never a URL
 *   Code 128  <docKey><check>              the 20-symbol manual code, also printed as XXXX-XXXX-XXXX-XXXX-XXXX
 *   legacy    https://…/verify/<id>        QR of documents issued before signed tokens
 *
 * The browser side (camera, photo, native BarcodeDetector or the ZXing-C++ WebAssembly reader) is in
 * qr-decode-browser.ts / qr-decode-camera.ts.
 */

export type ScanFormat = 'qr' | 'code128'
export type ScanHit = { text: string; format: ScanFormat }
/** RGBA pixels, the shape of ImageData (a plain object is enough for the decoders). */
export type PixelFrame = { data: Uint8ClampedArray; width: number; height: number }

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // the server's code alphabet: no I/O/0/1
const TOKEN = /^TQD1\.[A-HJ-NP-Z2-9]{16}\.[A-Za-z0-9_-]{22}$/
const MANUAL = new RegExp(`^[${ALPHABET}]{20}$`)
const LEGACY = /^[A-Za-z0-9_-]{4,64}$/

function decodeOnce(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Turns a scanned or typed value into the id used by /verify/<id>, or null when it is not a platform code.
 *
 * `strict` (camera / photo): only the signed token, the 20-symbol manual code or a legacy /verify/ URL are accepted,
 * so a stray QR (a shop's menu, a Wi-Fi code…) is ignored and scanning continues. Manual entry is lenient: anything
 * non-empty goes to the server, which answers "invalid" itself.
 */
export function verificationIdFromScan(raw: string, { strict = false }: { strict?: boolean } = {}): string | null {
  // scanners and copy/paste can add invisible marks (BOM, zero-width, bidi controls) around the code
  let value = String(raw || '')
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
    .trim()
  const viaUrl = value.includes('/verify/')
  if (viaUrl)
    value = decodeOnce(value.split('/verify/').pop() || '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '')
  value = value.trim()
  if (!value) return null
  if (TOKEN.test(value)) return value
  const compact = value.toUpperCase().replace(/[\s-]/g, '')
  if (MANUAL.test(compact)) return compact.match(/.{4}/g)!.join('-')
  if (!strict) return value
  return viaUrl && LEGACY.test(value) ? value : null
}

/** The decoded hits ordered for use: the signed QR token first, then the manual code, then anything else. */
export function rankHits(hits: ScanHit[]) {
  const score = (hit: ScanHit) => (TOKEN.test(hit.text.trim()) ? 0 : hit.format === 'code128' ? 1 : 2)
  return [...hits].sort((a, b) => score(a) - score(b))
}

/** The first hit that is a platform code, as the /verify/<id> id. */
export function pickVerificationId(hits: ScanHit[]) {
  for (const hit of rankHits(hits)) {
    const id = verificationIdFromScan(hit.text, { strict: true })
    if (id) return id
  }
  return null
}

/** Size that fits `width`×`height` inside `maxEdge` (never upscales). */
export function fitWithin(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale }
}

/**
 * Region of a camera frame to decode. Even frames take the whole picture (downscaled), odd frames the centre — where
 * the on-screen target is — at up to full resolution, so a long Code 128 held a little far still has ~2px per bar.
 */
export function frameRegion(frameIndex: number, videoWidth: number, videoHeight: number, maxEdge: number) {
  const crop = frameIndex % 2 === 1 ? 0.6 : 1
  const sw = Math.round(videoWidth * crop)
  const sh = Math.round(videoHeight * crop)
  const sx = Math.round((videoWidth - sw) / 2)
  const sy = Math.round((videoHeight - sh) / 2)
  const target = fitWithin(sw, sh, maxEdge)
  return { sx, sy, sw, sh, width: target.width, height: target.height }
}

/** Camera frames: fast enough for ~8 fps on a phone. Photos get the slower, more thorough settings. */
export const ZXING_CAMERA_OPTIONS = {
  formats: ['QRCode', 'Code128'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: false,
  tryDownscale: true,
  maxNumberOfSymbols: 2,
} satisfies ReaderOptions

export const ZXING_PHOTO_OPTIONS = {
  ...ZXING_CAMERA_OPTIONS,
  tryInvert: true,
  tryDenoise: true,
  maxNumberOfSymbols: 4,
} satisfies ReaderOptions

/** `readBarcodes` of zxing-wasm/reader (injected so this module stays free of the WebAssembly loader). */
export type ZxingReadFn = (input: ImageData, options?: ReaderOptions) => Promise<ReadResult[]>

const zxingFormat = (format: string): ScanFormat | null =>
  format === 'QRCode' ? 'qr' : format === 'Code128' ? 'code128' : null

export async function readWithZxing(
  read: ZxingReadFn,
  frame: PixelFrame,
  options: ReaderOptions = ZXING_CAMERA_OPTIONS
): Promise<ScanHit[]> {
  const results = await read(frame as ImageData, options)
  const hits: ScanHit[] = []
  for (const result of results) {
    const format = zxingFormat(result.format)
    if (result.isValid && format && result.text) hits.push({ text: result.text, format })
  }
  return hits
}

/** BarcodeDetector format names (Shape Detection API) of the two codes printed on documents. */
export const NATIVE_FORMATS = ['qr_code', 'code_128'] as const

export const nativeFormat = (format: string): ScanFormat | null =>
  format === 'qr_code' ? 'qr' : format === 'code_128' ? 'code128' : null
