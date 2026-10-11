import { grayFromRgba, mapRegionToPhoto, stillIsLarger, type Region } from './card-quality'

/**
 * Browser side of the card camera: continuous autofocus / exposure where the camera allows it, the torch, tap to
 * focus, and a full-resolution still (ImageCapture.takePhoto) when the camera's stills are clearly larger than its
 * video. Every call is a best-effort extra: a camera that supports none of it still works exactly as before.
 */

type CardTrackCapabilities = {
  torch?: boolean
  focusMode?: string[]
  exposureMode?: string[]
  whiteBalanceMode?: string[]
}

export type CardCameraFeatures = { torch: boolean; tapFocus: boolean }

const capabilitiesOf = (track: MediaStreamTrack) => {
  try {
    return (track.getCapabilities?.() ?? {}) as CardTrackCapabilities
  } catch {
    return {}
  }
}

const supportsPointsOfInterest = () => {
  try {
    return Boolean(
      (navigator.mediaDevices?.getSupportedConstraints?.() as Record<string, boolean> | undefined)?.pointsOfInterest
    )
  } catch {
    return false
  }
}

async function applyAdvanced(track: MediaStreamTrack, constraint: Record<string, unknown>) {
  if (track.readyState !== 'live') return false
  try {
    await track.applyConstraints({ advanced: [constraint as MediaTrackConstraintSet] })
    return true
  } catch {
    return false
  }
}

export function readCardFeatures(track: MediaStreamTrack): CardCameraFeatures {
  const capabilities = capabilitiesOf(track)
  const focus = capabilities.focusMode ?? []
  return {
    torch: capabilities.torch === true,
    tapFocus: focus.includes('single-shot') || (focus.includes('continuous') && supportsPointsOfInterest()),
  }
}

/** Keeps focus, exposure and white balance adjusting by themselves while the card moves. */
export async function tuneCardTrack(track: MediaStreamTrack): Promise<CardCameraFeatures> {
  const capabilities = capabilitiesOf(track)
  for (const key of ['focusMode', 'exposureMode', 'whiteBalanceMode'] as const)
    if (capabilities[key]?.includes('continuous')) await applyAdvanced(track, { [key]: 'continuous' })
  return readCardFeatures(track)
}

export const setCardTorch = (track: MediaStreamTrack, on: boolean) => applyAdvanced(track, { torch: on })

const refocusTimers = new WeakMap<MediaStreamTrack, number>()

/** Focuses (and meters) on a point of the video, given as 0–1 coordinates, then returns to continuous focus. */
export async function focusCardAt(track: MediaStreamTrack, point: { x: number; y: number }) {
  const focus = capabilitiesOf(track).focusMode ?? []
  const mode = focus.includes('single-shot') ? 'single-shot' : focus.includes('continuous') ? 'continuous' : null
  if (!mode) return false
  let done = supportsPointsOfInterest()
    ? await applyAdvanced(track, { pointsOfInterest: [point], focusMode: mode })
    : false
  if (!done) done = await applyAdvanced(track, { focusMode: mode })
  if (mode === 'single-shot' && focus.includes('continuous')) {
    window.clearTimeout(refocusTimers.get(track))
    refocusTimers.set(
      track,
      window.setTimeout(() => void applyAdvanced(track, { focusMode: 'continuous' }), 1500)
    )
  }
  return done
}

type PhotoCapabilitiesLike = {
  fillLightMode?: string[]
  imageWidth?: { max?: number }
  imageHeight?: { max?: number }
}
type ImageCaptureLike = {
  takePhoto: (settings?: { fillLightMode?: string }) => Promise<Blob>
  getPhotoCapabilities?: () => Promise<PhotoCapabilitiesLike>
}

/** `promise`, or `fallback` when it fails or takes longer than `ms`. */
export const within = <T>(promise: Promise<T>, ms: number, fallback: T) =>
  Promise.race([
    promise.catch(() => fallback),
    new Promise<T>(resolve => window.setTimeout(() => resolve(fallback), ms)),
  ])

export type PhotoTaker = {
  /** true once the camera has said its stills are clearly larger than the video; a still is not worth it otherwise */
  useful: () => boolean
  /** starts a still now; null when one is already on its way, the camera stopped or it failed */
  take: () => Promise<Blob | null>
}

/** A full-resolution still from the same camera, or null when the browser has no ImageCapture. */
export function createPhotoTaker(track: MediaStreamTrack): PhotoTaker | null {
  const ImageCaptureCtor = (globalThis as { ImageCapture?: new (track: MediaStreamTrack) => ImageCaptureLike })
    .ImageCapture
  if (!ImageCaptureCtor) return null
  let capture: ImageCaptureLike
  try {
    capture = new ImageCaptureCtor(track)
  } catch {
    return null
  }
  let useful = false
  let settings: { fillLightMode?: string } | undefined
  // learnt ahead of time: whether stills have more pixels than the video at all (on many phones they have not, and
  // waiting for one buys nothing), and that a flash on a laminated card is nothing but glare
  void within(Promise.resolve(capture.getPhotoCapabilities?.()), 2000, undefined).then(capabilities => {
    let video: { width?: number; height?: number } = {}
    try {
      video = track.getSettings?.() ?? {}
    } catch {
      // no settings: no still
    }
    useful = stillIsLarger(capabilities, video)
    settings = capabilities?.fillLightMode?.includes('off') ? { fillLightMode: 'off' } : undefined
  })
  let busy = false
  return {
    useful: () => useful,
    take: async () => {
      if (!useful || busy || track.readyState !== 'live') return null
      busy = true
      try {
        return await capture.takePhoto(settings)
      } catch {
        return null
      } finally {
        busy = false
      }
    },
  }
}

/**
 * Crops a still photo to the card (`outer`, with its margin; at most `maxWidth` wide) and draws the frame itself
 * (`inner`) at analysis size in grey levels, to compare it with the buffered video frame.
 */
export async function cropPhoto(
  photo: Blob,
  video: { width: number; height: number },
  inner: Region,
  outer: Region,
  analysis: { width: number; height: number },
  maxWidth = 2400
) {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(photo)
  } catch {
    return null
  }
  try {
    const out = mapRegionToPhoto(outer, video.width, video.height, bitmap.width, bitmap.height)
    const frame = mapRegionToPhoto(inner, video.width, video.height, bitmap.width, bitmap.height)
    if (!out || !frame || out.w < 8 || out.h < 8) return null
    const scale = Math.min(1, maxWidth / out.w)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(out.w * scale)
    canvas.height = Math.round(out.h * scale)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, out.x, out.y, out.w, out.h, 0, 0, canvas.width, canvas.height)
    const small = document.createElement('canvas')
    small.width = analysis.width
    small.height = analysis.height
    const smallContext = small.getContext('2d', { willReadFrequently: true })
    if (!smallContext) return null
    smallContext.imageSmoothingQuality = 'medium'
    smallContext.drawImage(bitmap, frame.x, frame.y, frame.w, frame.h, 0, 0, analysis.width, analysis.height)
    const pixels = analysis.width * analysis.height
    const gray = grayFromRgba(smallContext.getImageData(0, 0, analysis.width, analysis.height).data, pixels)
    return { canvas, gray }
  } finally {
    bitmap.close()
  }
}
