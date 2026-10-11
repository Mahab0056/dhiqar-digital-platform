import { prepareZXingModule, purgeZXingModule, readBarcodes } from 'zxing-wasm/reader'
import wasmPath from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { readWithZxing, ZXING_CAMERA_OPTIONS, ZXING_PHOTO_OPTIONS, type ScanHit } from './qr-decode'

/**
 * ZXing-C++ (WebAssembly) in its own worker: the /verify page creates it only when a code must be read, so the reader
 * is never part of the shared bundles, and decoding a frame never blocks the camera preview. The .wasm is the hashed
 * asset served by our own origin (zxing-wasm's default would fetch it from a public CDN).
 */

export type WorkerRequest =
  | { id: number; type: 'init' }
  | { id: number; type: 'read'; mode: 'camera' | 'photo'; width: number; height: number; data: Uint8ClampedArray }
export type WorkerResponse = { id: number; ok: true; hits: ScanHit[] } | { id: number; ok: false; error: string }

// the app is type-checked against the DOM lib; this is the slice of DedicatedWorkerGlobalScope used here
const scope = self as unknown as {
  location: Location
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: WorkerResponse) => void
}
let ready: Promise<unknown> | null = null

const init = () =>
  (ready ??= prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? new URL(wasmPath, scope.location.href).href : prefix + path,
    },
    fireImmediately: true,
  }).catch(error => {
    // a failed download must not stay cached: the next request retries
    ready = null
    purgeZXingModule()
    throw error
  }))

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  try {
    await init()
    const hits =
      request.type === 'read'
        ? await readWithZxing(
            readBarcodes,
            { data: request.data, width: request.width, height: request.height },
            request.mode === 'photo' ? ZXING_PHOTO_OPTIONS : ZXING_CAMERA_OPTIONS
          )
        : []
    scope.postMessage({ id: request.id, ok: true, hits } satisfies WorkerResponse)
  } catch (error) {
    scope.postMessage({ id: request.id, ok: false, error: String(error) } satisfies WorkerResponse)
  }
}
