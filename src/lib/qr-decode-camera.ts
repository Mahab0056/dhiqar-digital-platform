import { createCodeReader, type CodeReader } from './qr-decode-browser'
import { frameRegion, type ScanHit } from './qr-decode'

/**
 * Continuous scanning from the phone's rear camera for the /verify page: ~8 frames a second, each drawn on a small
 * canvas (alternating the whole picture and the centre target), never overlapping decodes. The camera is released on
 * `signal` abort, on `stop()`, when a hit is accepted, or if the track ends on its own.
 */

export type CameraErrorCode =
  'insecure' | 'unsupported' | 'denied' | 'not-found' | 'busy' | 'reader' | 'cancelled' | 'unknown'

export class CameraScanError extends Error {
  readonly code: CameraErrorCode
  constructor(code: CameraErrorCode, cause?: unknown) {
    super(code, { cause })
    this.name = 'CameraScanError'
    this.code = code
  }
}

export type CameraFeatures = {
  torch: boolean
  zoom: { min: number; max: number; step: number; value: number } | null
}

export type CameraScanSession = {
  readerKind: CodeReader['kind']
  stop: () => void
  setTorch: (on: boolean) => Promise<boolean>
  setZoom: (value: number) => Promise<boolean>
}

export const FRAME_INTERVAL_MS = 125 // ~8 fps
export const MAX_FRAME_EDGE = 960

/** Maps getUserMedia / play() failures (DOMException names, incl. old Chrome aliases) to what the visitor can do. */
export function cameraErrorCode(error: unknown): CameraErrorCode {
  if (error instanceof CameraScanError) return error.code
  const name = (error as { name?: unknown } | null)?.name
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied'
  if (name === 'SecurityError') return globalThis.isSecureContext === false ? 'insecure' : 'denied'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'not-found'
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy'
  return 'unknown'
}

type TrackCapabilities = {
  torch?: boolean
  zoom?: { min: number; max: number; step?: number }
  focusMode?: string[]
}

async function openRearCamera() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    })
  } catch (error) {
    // a camera that cannot satisfy even "ideal" hints (old Safari): take whatever it offers
    if ((error as { name?: string } | null)?.name !== 'OverconstrainedError') throw error
    return navigator.mediaDevices.getUserMedia({ audio: false, video: true })
  }
}

export async function startCameraScan(options: {
  video: HTMLVideoElement
  signal: AbortSignal
  /** Called with the codes of a frame; return true when one was accepted (scanning stops). */
  onHits: (hits: ScanHit[]) => boolean
  onStatus?: (status: 'loading-reader' | 'scanning') => void
  onFeatures?: (features: CameraFeatures) => void
  /** The camera stopped by itself (another app took it, the device was unplugged…). */
  onEnded?: () => void
}): Promise<CameraScanSession> {
  const { video, signal } = options
  if (!globalThis.isSecureContext) throw new CameraScanError('insecure')
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraScanError('unsupported')
  if (signal.aborted) throw new CameraScanError('cancelled')

  // the decoder downloads while the visitor answers the permission prompt
  const readerPromise = createCodeReader()
  readerPromise.catch(() => undefined)

  let stream: MediaStream
  try {
    stream = await openRearCamera()
  } catch (error) {
    throw new CameraScanError(cameraErrorCode(error), error)
  }

  let stopped = false
  let timer = 0
  const track = stream.getVideoTracks()[0]
  const stop = () => {
    if (stopped) return
    stopped = true
    if (timer) window.clearTimeout(timer)
    signal.removeEventListener('abort', stop)
    stream.getTracks().forEach(item => item.stop())
    if (video.srcObject === stream) {
      video.pause()
      video.srcObject = null
    }
  }
  // the page may have been left while the permission prompt was open: never keep a camera nobody looks at
  if (signal.aborted) {
    stop()
    throw new CameraScanError('cancelled')
  }
  signal.addEventListener('abort', stop, { once: true })
  track?.addEventListener('ended', () => {
    if (stopped) return
    stop()
    options.onEnded?.()
  })

  try {
    video.muted = true
    video.playsInline = true
    video.setAttribute('playsinline', '') // iOS: play inline instead of going full screen
    video.srcObject = stream
    await video.play()
  } catch (error) {
    stop()
    throw new CameraScanError(signal.aborted ? 'cancelled' : cameraErrorCode(error), error)
  }

  const readFeatures = (): CameraFeatures => {
    const capabilities = (track?.getCapabilities?.() ?? {}) as TrackCapabilities
    const settings = (track?.getSettings?.() ?? {}) as { zoom?: number }
    const zoom = capabilities.zoom
    return {
      torch: capabilities.torch === true,
      zoom:
        zoom && zoom.max > zoom.min
          ? { min: zoom.min, max: zoom.max, step: zoom.step || 0.1, value: settings.zoom ?? zoom.min }
          : null,
    }
  }
  const applyAdvanced = async (constraint: Record<string, unknown>) => {
    if (stopped || !track) return false
    try {
      await track.applyConstraints({ advanced: [constraint as MediaTrackConstraintSet] })
      return true
    } catch {
      return false
    }
  }
  options.onFeatures?.(readFeatures())
  // some Android cameras only report torch/zoom once frames are flowing
  window.setTimeout(() => {
    if (!stopped) options.onFeatures?.(readFeatures())
  }, 800)
  const capabilities = (track?.getCapabilities?.() ?? {}) as TrackCapabilities
  if (capabilities.focusMode?.includes('continuous')) void applyAdvanced({ focusMode: 'continuous' })

  options.onStatus?.('loading-reader')
  let reader: CodeReader
  try {
    reader = await readerPromise
  } catch (error) {
    stop()
    throw new CameraScanError(signal.aborted ? 'cancelled' : 'reader', error)
  }
  if (stopped) throw new CameraScanError('cancelled')
  options.onStatus?.('scanning')

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  let frameIndex = 0
  const tick = async () => {
    timer = 0
    if (stopped) return
    const started = performance.now()
    if (context && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      const region = frameRegion(frameIndex++, video.videoWidth, video.videoHeight, MAX_FRAME_EDGE)
      if (canvas.width !== region.width || canvas.height !== region.height) {
        canvas.width = region.width
        canvas.height = region.height
      }
      context.drawImage(video, region.sx, region.sy, region.sw, region.sh, 0, 0, region.width, region.height)
      let hits: ScanHit[] = []
      try {
        hits = await reader.read(context.getImageData(0, 0, region.width, region.height))
      } catch {
        // one bad frame (e.g. the stream resized mid-draw) is not worth stopping for
      }
      if (stopped) return
      if (hits.length && options.onHits(hits)) return stop()
    }
    timer = window.setTimeout(() => void tick(), Math.max(0, FRAME_INTERVAL_MS - (performance.now() - started)))
  }
  timer = window.setTimeout(() => void tick(), 0)

  return {
    readerKind: reader.kind,
    stop,
    setTorch: on => applyAdvanced({ torch: on }),
    setZoom: value => applyAdvanced({ zoom: value }),
  }
}
