import { fitWithin, NATIVE_FORMATS, nativeFormat, type ScanHit } from './qr-decode'
import type { WorkerRequest, WorkerResponse } from './qr-decode.worker'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/**
 * Browser decoders for the /verify page. The native BarcodeDetector is used where it exists and reads both QR and
 * Code 128 (Android Chrome, macOS Chrome); everywhere else — iPhone Safari, Firefox, Windows — the ZXing-C++
 * WebAssembly reader, in a worker. The worker bundle and the .wasm are fetched from our own origin, and only when the
 * visitor opens the camera or picks a photo (the CSP allows WebAssembly via 'wasm-unsafe-eval').
 */

export type CodeReader = {
  kind: 'native' | 'wasm'
  read: (frame: ImageData, mode?: 'camera' | 'photo') => Promise<ScanHit[]>
}

type NativeDetector = { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string; format: string }>> }
type NativeDetectorClass = {
  new (options: { formats: string[] }): NativeDetector
  getSupportedFormats?: () => Promise<string[]>
}

let wasmReader: Promise<CodeReader> | null = null
let releaseWasm: (() => void) | null = null

/**
 * The ZXing WebAssembly reader, running in a worker created on first use (see qr-decode.worker.ts). A failed start
 * is forgotten so "try again" really retries.
 */
export function loadWasmReader(): Promise<CodeReader> {
  if (wasmReader) return wasmReader
  const loading: Promise<CodeReader> = (async () => {
    const worker = new Worker(new URL('./qr-decode.worker.ts', import.meta.url), { type: 'module' })
    const pending = new Map<number, { resolve: (hits: ScanHit[]) => void; reject: (error: Error) => void }>()
    let nextId = 1
    let closed = false
    const fail = (error: Error) => {
      if (closed) return
      closed = true
      worker.terminate()
      for (const call of pending.values()) call.reject(error)
      pending.clear()
      if (releaseWasm === release) {
        releaseWasm = null
        wasmReader = null
      }
    }
    const release = () => fail(new Error('QR reader released'))
    releaseWasm = release
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const call = pending.get(event.data.id)
      if (!call) return
      pending.delete(event.data.id)
      if (event.data.ok) call.resolve(event.data.hits)
      else call.reject(new Error(event.data.error))
    }
    worker.onerror = event => {
      event.preventDefault()
      fail(new Error(event.message || 'QR reader worker failed'))
    }
    const call = (request: DistributiveOmit<WorkerRequest, 'id'>, transfer: Transferable[] = []) =>
      new Promise<ScanHit[]>((resolve, reject) => {
        if (closed) return reject(new Error('QR reader released'))
        const id = nextId++
        pending.set(id, { resolve, reject })
        worker.postMessage({ ...request, id }, transfer)
      })
    try {
      await call({ type: 'init' }) // downloads and compiles the .wasm
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
    return {
      kind: 'wasm',
      // the pixels are transferred, not copied: the caller hands over a fresh ImageData each time
      read: (frame, mode = 'camera') =>
        call({ type: 'read', mode, width: frame.width, height: frame.height, data: frame.data }, [frame.data.buffer]),
    } satisfies CodeReader
  })().catch(error => {
    if (wasmReader === loading) wasmReader = null
    throw error
  })
  wasmReader = loading
  return loading
}

/** Frees the WebAssembly reader (its worker and memory) when the scanner page is left. */
export function releaseCodeReaders() {
  releaseWasm?.()
}

async function nativeReader(): Promise<CodeReader | null> {
  const Detector = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector
  if (!Detector) return null
  try {
    const supported = (await Detector.getSupportedFormats?.()) ?? []
    if (!NATIVE_FORMATS.every(format => supported.includes(format))) return null
    const detector = new Detector({ formats: [...NATIVE_FORMATS] })
    return {
      kind: 'native',
      async read(frame) {
        const codes = await detector.detect(frame)
        const hits: ScanHit[] = []
        for (const code of codes) {
          const format = nativeFormat(code.format)
          if (format && code.rawValue) hits.push({ text: code.rawValue, format })
        }
        return hits
      },
    }
  } catch {
    return null
  }
}

/**
 * The best reader for this browser. A native detector that fails at runtime (some Android builds expose the API
 * without the detection service) hands over to the WebAssembly reader for the rest of the session.
 */
export async function createCodeReader(): Promise<CodeReader> {
  const native = await nativeReader()
  if (!native) return loadWasmReader()
  let fallback: CodeReader | null = null
  return {
    kind: 'native',
    async read(frame, mode) {
      if (fallback) return fallback.read(frame, mode)
      try {
        return await native.read(frame, mode)
      } catch {
        fallback = await loadWasmReader()
        return fallback.read(frame, mode)
      }
    },
  }
}

export class PhotoDecodeError extends Error {
  readonly code: 'not-image' | 'unreadable' | 'too-large'
  constructor(code: PhotoDecodeError['code']) {
    super(code)
    this.name = 'PhotoDecodeError'
    this.code = code
  }
}

const MAX_PHOTO_BYTES = 40 * 1024 * 1024

async function loadImage(
  file: Blob
): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      // EXIF orientation is applied by default, so a portrait phone photo is decoded upright
      const bitmap = await createImageBitmap(file)
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    } catch {
      // fall through to <img>, which decodes a few more formats on some browsers (HEIC on Safari)
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => undefined }
  } catch {
    throw new PhotoDecodeError('unreadable')
  } finally {
    URL.revokeObjectURL(url)
  }
}

function drawFrame(source: CanvasImageSource, width: number, height: number, maxEdge: number): ImageData {
  const size = fitWithin(width, height, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new PhotoDecodeError('unreadable')
  context.fillStyle = '#FFFFFF' // transparent PNGs: transparent pixels would read as black
  context.fillRect(0, 0, size.width, size.height)
  context.drawImage(source, 0, 0, size.width, size.height)
  return context.getImageData(0, 0, size.width, size.height)
}

/**
 * Decodes the codes in a photo of a document (gallery or the phone's camera app). Tried at a large size first — a
 * full A4 page holds a small QR — then smaller, which helps with blurry or noisy shots.
 */
export async function decodeImageFile(file: Blob, reader?: CodeReader): Promise<ScanHit[]> {
  if (file.type && !file.type.startsWith('image/')) throw new PhotoDecodeError('not-image')
  if (file.size > MAX_PHOTO_BYTES) throw new PhotoDecodeError('too-large')
  const image = await loadImage(file)
  try {
    if (!image.width || !image.height) throw new PhotoDecodeError('unreadable')
    const decoder = reader ?? (await createCodeReader())
    const seen = new Set<number>()
    for (const maxEdge of [2400, 1200, 800]) {
      const size = fitWithin(image.width, image.height, maxEdge)
      if (seen.has(size.width)) continue
      seen.add(size.width)
      const hits = await decoder.read(drawFrame(image.source, image.width, image.height, maxEdge), 'photo')
      if (hits.length) return hits
    }
    return []
  } finally {
    image.close()
  }
}
