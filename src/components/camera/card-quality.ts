/**
 * Identity-card capture quality: pure, DOM-free logic behind the card camera.
 *
 * Instead of hard gates that all had to hold for several consecutive ticks (which meant holding the phone perfectly
 * still), every tick gets a 0–1 score from light, reflections, sharpness (relative to the sharpest frame seen
 * recently, so autofocus hunting and soft phone lenses do not block — except on the back, whose machine-readable rows
 * must stay legible) and a very tolerant motion factor. The best frame of the last moments is kept; the camera
 * captures once the score has been good for long enough within a short window (not consecutively), or after a few
 * seconds with an acceptable best frame — always delivering the best frame, never the current one.
 */

/** ID-1 card (85.6 × 54 mm) */
export const CARD_RATIO = 85.6 / 54
export const TICK_MS = 150
export const ANALYSIS_WIDTH = 320
export const ANALYSIS_HEIGHT = Math.round(ANALYSIS_WIDTH / CARD_RATIO)

/** A tick at or above this counts towards the automatic capture. */
export const GOOD_SCORE = 0.62
/** Good time needed inside the sliding window (in total, not consecutively). */
export const GOOD_NEEDED_MS = 600
export const GOOD_WINDOW_MS = 1200
/** A phone too busy for TICK_MS: the window stretches to hold at least this many of its ticks. */
const WINDOW_TICKS = 3
/** After this long, an acceptable best frame is captured even if the good time never adds up. */
export const PATIENCE_MS = 4000
export const PATIENCE_SCORE = 0.55
const ACCEPTABLE_SCORE = 0.4
/** Frames older than this are never delivered (the card may have moved away). */
export const BEST_MAX_AGE_MS = 1500
const HISTORY_MS = 4000
/** A late timer (busy phone) must not count as a long good stretch. */
const MAX_TICK_GAP_MS = 300

/** Laplacian variance below this is blur whatever the phone. */
export const SHARP_FLOOR = 20
/** Early expectation of a sharp frame, relaxed over the first seconds so a soft lens still gets there. */
const SHARP_PRIOR_START = 140
const SHARP_PRIOR_END = 55
const SHARP_PRIOR_RELAX_MS = 3500
/** A frame is sharp enough when it reaches half of the recent peak. */
const SHARP_RELATIVE = 0.5
/** The peak fades so one lucky (or misleading) frame does not set the bar for the whole session. */
const PEAK_DECAY_MS = 4000
/**
 * The back is read by OCR, letter by letter: its machine-readable rows need a firmer floor and an expectation that
 * never relaxes. (A uniformly soft frame — autofocus hunting, a card closer than the lens can focus — measures ~90
 * at analysis size, where the OCR already confuses Q/0 and 8/B; a sharp phone frame measures well over 1000. The
 * photo's file name carries the value sent, so the server log can tune these from real phones.)
 */
export const BACK_SHARP_FLOOR = 100
export const BACK_SHARP_PRIOR = 240

/** A pixel at or above this is clipped. */
const CLIPPED = 250
/**
 * Clipped areas larger than this share of the frame are exposure (a white card or zone over-lit as a whole), not a
 * reflection: the print in them usually still shows, and the sharpness of the focus rows judges that.
 */
export const GLARE_BLOB_MAX = 0.04
/** At least this share of the frame in large clipped areas, with blurred rows: the light washes the print out. */
const OVEREXPOSED = 0.25
/** The first tick has no motion measure: neither steady nor shaken (the camera is often still settling). */
const FIRST_TICK_STEADY = 0.8
/** A full-resolution still replaces the video frame only when it has clearly more pixels than that. */
export const STILL_MIN_GAIN = 1.3
/** Sharpness at which a frame's rank is half its conditions: far from saturating on real phone frames. */
const RANK_SHARPNESS_SCALE = 1000

export type CardSide = 'front' | 'back'
export type Region = { x: number; y: number; w: number; h: number }
export type Box = { left: number; top: number; width: number; height: number }

/** Rows (as fractions of the card height) whose sharpness matters most: the machine-readable zone on the back. */
export const focusRows = (side: CardSide) => (side === 'back' ? { top: 0.58, bottom: 0.97 } : { top: 0, bottom: 1 })

export type FrameMetrics = {
  /** mean luma, 0–255 */
  brightness: number
  /** share of the picture under small clipped areas — reflections — 0–1 (on the focus rows, or the whole card) */
  glare: number
  /** share of the whole picture under large clipped areas: over-exposure rather than a reflection, 0–1 */
  exposure?: number
  /** variance of the Laplacian over the focus rows */
  sharpness: number
  /** standard deviation of luma: a blank surface is flat */
  contrast: number
  /** mean absolute luma change since the previous tick; null on the first */
  motion: number | null
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)
const ramp = (value: number, low: number, high: number) => clamp01((value - low) / (high - low))

export function grayFromRgba(rgba: ArrayLike<number>, pixels: number) {
  const gray = new Uint8ClampedArray(pixels)
  for (let i = 0; i < pixels; i++) gray[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000
  return gray
}

export function measureFrame(
  gray: ArrayLike<number>,
  width: number,
  height: number,
  previous: ArrayLike<number> | null = null,
  rows: { top: number; bottom: number } = { top: 0, bottom: 1 }
): FrameMetrics {
  const pixels = width * height
  const top = Math.max(1, Math.floor(rows.top * height))
  const bottom = Math.min(height - 1, Math.ceil(rows.bottom * height))
  let sum = 0
  let squares = 0
  for (let i = 0; i < pixels; i++) {
    const v = gray[i]
    sum += v
    squares += v * v
  }
  const brightness = sum / pixels
  const contrast = Math.sqrt(Math.max(0, squares / pixels - brightness * brightness))
  // variance of the Laplacian: high when edges and text are crisp
  let lapSum = 0
  let lapSquares = 0
  let n = 0
  for (let y = top; y < bottom; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const lap = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i]
      lapSum += lap
      lapSquares += lap * lap
      n++
    }
  const sharpness = n ? lapSquares / n - (lapSum / n) ** 2 : 0
  let motion: number | null = null
  if (previous && previous.length === pixels) {
    let diff = 0
    let samples = 0
    for (let i = 0; i < pixels; i += 3) {
      diff += Math.abs(gray[i] - previous[i])
      samples++
    }
    motion = diff / samples
  }
  const clipped = clippedAreas(gray, width, height, top, bottom)
  const wholeCard = rows.top <= 0 && rows.bottom >= 1
  return {
    brightness,
    // on the back only the machine-readable rows are read: a reflection elsewhere counts for half
    glare: wholeCard ? clipped.glare : Math.max(clipped.zoneGlare, clipped.glare / 2),
    exposure: clipped.exposure,
    sharpness,
    contrast,
    motion,
  }
}

/**
 * Clipped pixels grouped into connected areas (4-neighbours). Small ones are reflections — a lamp or a window on the
 * laminate — that hide what lies under them. Large ones are exposure: a white card or zone over-lit as a whole, whose
 * print mostly survives; counting those as glare would block a perfectly legible card for ever.
 */
function clippedAreas(gray: ArrayLike<number>, width: number, height: number, top: number, bottom: number) {
  const pixels = width * height
  const limit = Math.max(1, Math.round(pixels * GLARE_BLOB_MAX))
  const seen = new Uint8Array(pixels)
  let stack: Int32Array | null = null
  let glare = 0
  let zoneGlare = 0
  let exposure = 0
  const push = (i: number, depth: number) => {
    seen[i] = 1
    stack![depth] = i
    return depth + 1
  }
  for (let start = 0; start < pixels; start++) {
    if (seen[start] || gray[start] < CLIPPED) continue
    stack ??= new Int32Array(pixels)
    let size = 0
    let inZone = 0
    let depth = push(start, 0)
    while (depth) {
      const i = stack[--depth]
      const y = (i / width) | 0
      const x = i - y * width
      size++
      if (y >= top && y < bottom) inZone++
      if (x > 0 && !seen[i - 1] && gray[i - 1] >= CLIPPED) depth = push(i - 1, depth)
      if (x < width - 1 && !seen[i + 1] && gray[i + 1] >= CLIPPED) depth = push(i + 1, depth)
      if (y > 0 && !seen[i - width] && gray[i - width] >= CLIPPED) depth = push(i - width, depth)
      if (y < height - 1 && !seen[i + width] && gray[i + width] >= CLIPPED) depth = push(i + width, depth)
    }
    if (size <= limit) {
      glare += size
      zoneGlare += inZone
    } else exposure += size
  }
  const zonePixels = Math.max(1, (bottom - top) * width)
  return { glare: glare / pixels, zoneGlare: zoneGlare / zonePixels, exposure: exposure / pixels }
}

export type Issue = 'empty' | 'dark' | 'bright' | 'glare' | 'blur' | 'motion'

export type FrameScore = {
  /** 0–1: how ready this frame is for the automatic capture */
  score: number
  /** the same with a faint reflection forgiven: what the patient capture after a few seconds goes by */
  lenient: number
  /** ordering of frames for the best-frame buffer (absolute sharpness, weighed by the conditions) */
  rank: number
  light: number
  glare: number
  sharp: number
  steady: number
  presence: number
  /** what holds this frame back most; null when it is good */
  issue: Issue | null
}

/** Conditions that do not depend on the session: light, glare, a card-like presence and motion. */
export function frameConditions(metrics: FrameMetrics) {
  const b = metrics.brightness
  const light = b < 80 ? ramp(b, 35, 80) : b > 200 ? 1 - ramp(b, 200, 240) : 1
  const glare = 1 - ramp(metrics.glare, 0.01, 0.05)
  const presence = ramp(metrics.contrast, 8, 20)
  // shake already shows up as blur in the sharpness; motion alone only nudges the score down
  const steady = metrics.motion === null ? FIRST_TICK_STEADY : 1 - ramp(metrics.motion, 16, 45)
  return { light, glare, presence, steady, motionFactor: 0.55 + 0.45 * steady }
}

/** Light, reflections and a card in the frame: how a still photo compares with a video frame (it has no motion). */
export const stillConditions = (metrics: FrameMetrics) => {
  const { light, glare, presence } = frameConditions(metrics)
  return light * glare * presence
}

/** How sharp a frame must be to count as sharp, given the time since the camera opened and the recent peak. */
export function sharpnessReference(elapsedMs: number, peakSharpness: number, side: CardSide = 'front') {
  const prior =
    side === 'back'
      ? BACK_SHARP_PRIOR
      : SHARP_PRIOR_START + (SHARP_PRIOR_END - SHARP_PRIOR_START) * clamp01(elapsedMs / SHARP_PRIOR_RELAX_MS)
  return Math.max(prior, peakSharpness * SHARP_RELATIVE)
}

export function scoreFrame(metrics: FrameMetrics, reference: number, floor = SHARP_FLOOR): FrameScore {
  const { light, glare, presence, steady, motionFactor } = frameConditions(metrics)
  const sharp = ramp(metrics.sharpness, floor, Math.max(reference, floor + 1))
  const score = sharp * light * glare * presence * motionFactor
  // after a few seconds a faint reflection is forgiven; a strong one still holds the capture back
  const lenient = sharp * light * presence * motionFactor * (0.5 + 0.5 * glare)
  const s = Math.max(0, metrics.sharpness)
  // a reflection lowers a frame's standing without zeroing it (when every frame has one, the sharpest is still the
  // best), and sharpness keeps telling frames apart on sharp phones (1000–4000) instead of saturating
  const rank = light * presence * motionFactor * (0.2 + 0.8 * glare) * (s / (s + RANK_SHARPNESS_SCALE))
  let issue: Issue | null = null
  if (score < GOOD_SCORE) {
    // the weakest factor is what the hint talks about (ties go to the earlier, more basic one) — except in the
    // dark, where nothing else can be judged: then the light is what to fix
    const factors: Array<[Issue, number]> = [
      ['empty', presence],
      [metrics.brightness < 128 ? 'dark' : 'bright', light],
      ['glare', glare],
      ['blur', sharp],
      ['motion', motionFactor],
    ]
    issue =
      metrics.brightness < 40 && light < 0.2
        ? 'dark'
        : factors.reduce((weakest, factor) => (factor[1] < weakest[1] ? factor : weakest))[0]
    // blurred print under large clipped areas: too much light washes it out
    if (issue === 'blur' && (metrics.exposure ?? 0) >= OVEREXPOSED) issue = 'bright'
  }
  return { score, lenient, rank, light, glare, sharp, steady, presence, issue }
}

/* ---------------------------------------------------------------------------------------------
   Best-frame buffer: two slots (the best recent frame, and the best one seen after it) so that an
   expiring best is replaced by the next best instead of whatever the current frame happens to be
   --------------------------------------------------------------------------------------------- */
export type SlotId = 0 | 1
export type BufferedFrame = { slot: SlotId; t: number; rank: number; score: number; lenient?: number }
export type FrameBuffer = { best: BufferedFrame | null; runnerUp: BufferedFrame | null }

const otherSlot = (slot: SlotId): SlotId => (slot === 0 ? 1 : 0)

/**
 * Decides whether this tick's frame should be kept, and in which slot. On a tie the newer frame wins: when nothing
 * can be told apart (every frame at zero in the dark), the freshest one is the least likely to be out of date.
 */
export function offerFrame(
  buffer: FrameBuffer,
  candidate: { t: number; rank: number; score: number; lenient?: number },
  maxAgeMs = BEST_MAX_AGE_MS
): { buffer: FrameBuffer; storeIn: SlotId | null } {
  const now = candidate.t
  const fresh = (frame: BufferedFrame | null) => (frame && now - frame.t <= maxAgeMs ? frame : null)
  let best = fresh(buffer.best)
  let runnerUp = fresh(buffer.runnerUp)
  if (!best) {
    best = runnerUp
    runnerUp = null
  }
  if (!best) return { buffer: { best: { ...candidate, slot: 0 }, runnerUp: null }, storeIn: 0 }
  const slot = otherSlot(best.slot)
  if (candidate.rank >= best.rank) return { buffer: { best: { ...candidate, slot }, runnerUp: null }, storeIn: slot }
  if (!runnerUp || candidate.rank >= runnerUp.rank)
    return { buffer: { best, runnerUp: { ...candidate, slot } }, storeIn: slot }
  return { buffer: { best, runnerUp }, storeIn: null }
}

/** The frame to deliver: the best one from the last moments (never the current, possibly shaken one). */
export function pickFrame(buffer: FrameBuffer, now: number, maxAgeMs = BEST_MAX_AGE_MS): BufferedFrame | null {
  const fresh = (frame: BufferedFrame | null) => (frame && now - frame.t <= maxAgeMs ? frame : null)
  return fresh(buffer.best) ?? fresh(buffer.runnerUp)
}

/* ---------------------------------------------------------------------------------------------
   Session: one tick after another → score, which frame to keep, when to capture, what to say
   --------------------------------------------------------------------------------------------- */
export type HintKey = 'place' | 'dark' | 'bright' | 'glare' | 'closer' | 'focus' | 'steady' | 'good'
export type Meters = { light: boolean; glare: boolean; sharp: boolean }
export type TickRecord = { t: number; dt: number; score: number; lenient: number; issue: Issue | null } & Meters

export type CaptureSession = {
  side: CardSide
  startedAt: number | null
  lastTickAt: number | null
  peakSharpness: number
  ticks: TickRecord[]
  frames: FrameBuffer
  /** smoothed 0–1 for the ring around the shutter: it fills steadily and drains slowly */
  progress: number
  /** the last few intervals between ticks, as they really came (a busy phone ticks late) */
  gaps: number[]
}

export type CaptureStep = {
  session: CaptureSession
  frame: FrameScore
  /** draw this tick's full-resolution crop into that slot */
  storeIn: SlotId | null
  capture: 'good' | 'patience' | null
  hint: HintKey
  meters: Meters
}

export const createCaptureSession = (side: CardSide = 'front'): CaptureSession => ({
  side,
  startedAt: null,
  lastTickAt: null,
  peakSharpness: 0,
  ticks: [],
  frames: { best: null, runnerUp: null },
  progress: 0,
  gaps: [],
})

/** Total time spent at or above `threshold` within the window ending now. */
export function timeAbove(
  ticks: TickRecord[],
  now: number,
  threshold: number,
  windowMs = GOOD_WINDOW_MS,
  key: 'score' | 'lenient' = 'score'
) {
  let total = 0
  for (const tick of ticks) if (now - tick.t < windowMs && tick[key] >= threshold) total += tick.dt
  return total
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]

/** The good-time window, stretched when ticks come further apart than usual so that a busy phone still captures. */
export const captureWindow = (gaps: number[]) =>
  Math.max(GOOD_WINDOW_MS, WINDOW_TICKS * (gaps.length ? median(gaps) : TICK_MS))

/** The ring never snaps back to empty because of one bad tick: it rises at once and drains slowly. */
export const smoothProgress = (previous: number, raw: number) =>
  clamp01(raw >= previous ? raw : Math.max(raw, previous - 0.08))

/** One calm hint for the last moments, instead of one per tick. */
export function chooseHint(ticks: TickRecord[], now: number): HintKey {
  const recent = ticks.filter(tick => now - tick.t < 750)
  if (!recent.length) return 'place'
  const good = recent.filter(tick => tick.issue === null).length
  if (good * 2 >= recent.length) return 'good'
  const order: Issue[] = ['empty', 'dark', 'bright', 'glare', 'blur', 'motion']
  const counts = new Map<Issue, number>()
  for (const tick of recent) if (tick.issue) counts.set(tick.issue, (counts.get(tick.issue) || 0) + 1)
  const issue = order.reduce<Issue | null>(
    (top, item) => ((counts.get(item) || 0) > (top ? counts.get(top) || 0 : 0) ? item : top),
    null
  )
  if (issue === 'empty') return 'place'
  if (issue === 'dark' || issue === 'bright' || issue === 'glare') return issue
  if (issue === 'motion') return 'steady'
  // blurred for a good while: closer is not helping (too close to focus), so suggest a tap or a little distance
  const longer = ticks.filter(tick => now - tick.t < 2500)
  const blurred = longer.filter(tick => tick.issue === 'blur').length
  return longer.length >= 12 && blurred >= longer.length * 0.75 ? 'focus' : 'closer'
}

function recentMeters(ticks: TickRecord[]): Meters {
  const recent = ticks.slice(-4)
  const majority = (key: keyof Meters) => recent.filter(tick => tick[key]).length * 2 > recent.length
  return { light: majority('light'), glare: majority('glare'), sharp: majority('sharp') }
}

export function stepCapture(session: CaptureSession, metrics: FrameMetrics, now: number): CaptureStep {
  const startedAt = session.startedAt ?? now
  const elapsed = now - startedAt
  const gap = session.lastTickAt === null ? 0 : Math.max(0, now - session.lastTickAt)
  const gaps = session.lastTickAt === null ? session.gaps : [...session.gaps.slice(-7), gap]
  // a late tick still counts for 300 ms at most, but the window holds a few ticks whatever their pace
  const windowMs = captureWindow(gaps)
  const conditions = frameConditions(metrics)
  let peak = session.peakSharpness * Math.exp(-gap / PEAK_DECAY_MS)
  // only frames in fair light count towards the peak: sensor noise in the dark looks "sharp"
  if (conditions.light >= 0.8 && conditions.glare >= 0.6 && conditions.presence >= 0.8)
    peak = Math.max(peak, metrics.sharpness)
  const floor = session.side === 'back' ? BACK_SHARP_FLOOR : SHARP_FLOOR
  const frame = scoreFrame(metrics, sharpnessReference(elapsed, peak, session.side), floor)
  const offered = offerFrame(session.frames, { t: now, rank: frame.rank, score: frame.score, lenient: frame.lenient })
  const record: TickRecord = {
    t: now,
    dt: Math.min(gap, MAX_TICK_GAP_MS),
    score: frame.score,
    lenient: frame.lenient,
    issue: frame.issue,
    light: frame.light >= 0.6,
    glare: frame.glare >= 0.6,
    sharp: frame.sharp >= 0.6,
  }
  const ticks = [...session.ticks.filter(tick => now - tick.t < Math.max(HISTORY_MS, windowMs)), record]
  const best = pickFrame(offered.buffer, now)
  const goodMs = timeAbove(ticks, now, GOOD_SCORE, windowMs)
  const acceptableMs = timeAbove(ticks, now, ACCEPTABLE_SCORE, windowMs, 'lenient')
  let capture: CaptureStep['capture'] = null
  if (best && goodMs >= GOOD_NEEDED_MS) capture = 'good'
  else if (
    best &&
    elapsed >= PATIENCE_MS &&
    acceptableMs >= GOOD_NEEDED_MS &&
    (best.lenient ?? best.score) >= PATIENCE_SCORE
  )
    capture = 'patience'
  const raw = Math.max(goodMs / GOOD_NEEDED_MS, elapsed >= PATIENCE_MS ? (acceptableMs / GOOD_NEEDED_MS) * 0.9 : 0)
  const progress = capture ? 1 : smoothProgress(session.progress, Math.min(raw, 0.97))
  return {
    session: {
      side: session.side,
      startedAt,
      lastTickAt: now,
      peakSharpness: peak,
      ticks,
      frames: offered.buffer,
      progress,
      gaps,
    },
    frame,
    storeIn: offered.storeIn,
    capture,
    hint: chooseHint(ticks, now),
    meters: recentMeters(ticks),
  }
}

/* ---------------------------------------------------------------------------------------------
   Geometry: the on-screen frame in video pixels (object-fit: cover), and video → still photo
   --------------------------------------------------------------------------------------------- */
function coverTransform(box: Box, videoWidth: number, videoHeight: number) {
  const scale = Math.max(box.width / videoWidth, box.height / videoHeight)
  return {
    scale,
    offsetX: (box.width - videoWidth * scale) / 2,
    offsetY: (box.height - videoHeight * scale) / 2,
  }
}

/** The on-screen frame mapped into the video's own pixels (the preview uses object-fit: cover). */
export function frameRegionInVideo(videoBox: Box, frameBox: Box, videoWidth: number, videoHeight: number) {
  if (!videoWidth || !videoHeight || !videoBox.width || !videoBox.height) return null
  const { scale, offsetX, offsetY } = coverTransform(videoBox, videoWidth, videoHeight)
  const x = Math.max(0, (frameBox.left - videoBox.left - offsetX) / scale)
  const y = Math.max(0, (frameBox.top - videoBox.top - offsetY) / scale)
  const region = {
    x,
    y,
    w: Math.min(videoWidth - x, frameBox.width / scale),
    h: Math.min(videoHeight - y, frameBox.height / scale),
  }
  return region.w > 8 && region.h > 8 ? region : null
}

/** A screen point as normalised (0–1) video coordinates, e.g. for a tap-to-focus point of interest. */
export function screenPointToVideo(
  videoBox: Box,
  point: { x: number; y: number },
  videoWidth: number,
  videoHeight: number
) {
  const { scale, offsetX, offsetY } = coverTransform(videoBox, videoWidth, videoHeight)
  return {
    x: clamp01((point.x - videoBox.left - offsetX) / scale / videoWidth),
    y: clamp01((point.y - videoBox.top - offsetY) / scale / videoHeight),
  }
}

/** A small margin around the frame keeps the card edges in the picture. */
export function expandRegion(region: Region, videoWidth: number, videoHeight: number, mx = 0.06, my = 0.08): Region {
  const x = Math.max(0, region.x - region.w * mx)
  const y = Math.max(0, region.y - region.h * my)
  return {
    x,
    y,
    w: Math.min(videoWidth - x, region.w * (1 + 2 * mx)),
    h: Math.min(videoHeight - y, region.h * (1 + 2 * my)),
  }
}

/**
 * A region of the video mapped into a still photo of the same camera. The video is a centred crop of the sensor (a
 * 16:9 stream from a 4:3 sensor), so it spans the photo's full width or height. Different orientations (a rotated
 * still) are refused rather than guessed.
 */
export function mapRegionToPhoto(
  region: Region,
  videoWidth: number,
  videoHeight: number,
  photoWidth: number,
  photoHeight: number
): Region | null {
  if (!videoWidth || !videoHeight || !photoWidth || !photoHeight) return null
  if (videoWidth >= videoHeight !== photoWidth >= photoHeight) return null
  const videoAspect = videoWidth / videoHeight
  const photoAspect = photoWidth / photoHeight
  let scale: number
  let originX = 0
  let originY = 0
  if (photoAspect > videoAspect) {
    scale = photoHeight / videoHeight
    originX = (photoWidth - videoWidth * scale) / 2
  } else {
    scale = photoWidth / videoWidth
    originY = (photoHeight - videoHeight * scale) / 2
  }
  const x = Math.max(0, originX + region.x * scale)
  const y = Math.max(0, originY + region.y * scale)
  return { x, y, w: Math.min(photoWidth - x, region.w * scale), h: Math.min(photoHeight - y, region.h * scale) }
}

/* ---------------------------------------------------------------------------------------------
   Still photo vs buffered frame: same scene (not a shifted or rotated crop), and at least as good
   --------------------------------------------------------------------------------------------- */
export function blockThumbnail(gray: ArrayLike<number>, width: number, height: number, cols = 24, rows = 15) {
  const out = new Float32Array(cols * rows)
  const counts = new Uint32Array(cols * rows)
  for (let y = 0; y < height; y++) {
    const row = Math.min(rows - 1, Math.floor((y * rows) / height))
    for (let x = 0; x < width; x++) {
      const cell = row * cols + Math.min(cols - 1, Math.floor((x * cols) / width))
      out[cell] += gray[y * width + x]
      counts[cell]++
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = counts[i] ? out[i] / counts[i] : 0
  return out
}

/** Normalised cross-correlation of two thumbnails, −1…1 (brightness and contrast changes do not matter). */
export function thumbnailCorrelation(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a.length !== b.length || !a.length) return 0
  let meanA = 0
  let meanB = 0
  for (let i = 0; i < a.length; i++) {
    meanA += a[i]
    meanB += b[i]
  }
  meanA /= a.length
  meanB /= b.length
  let cross = 0
  let varA = 0
  let varB = 0
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    cross += da * db
    varA += da * da
    varB += db * db
  }
  return varA && varB ? cross / Math.sqrt(varA * varB) : 0
}

/**
 * The still photo replaces the buffered frame only when it shows the same card, with clearly more pixels, at least
 * about as sharp on the same rows (measured the same way, at analysis size — a still shot while the hand moved is
 * blurred, and a saturating score would hide it) and in light as good.
 */
export const acceptPhoto = (input: {
  correlation: number
  photoSharpness: number
  bufferedSharpness: number
  photoConditions: number
  bufferedConditions: number
  photoWidth: number
  bufferedWidth: number
}) =>
  input.correlation >= 0.6 &&
  input.photoWidth >= input.bufferedWidth * STILL_MIN_GAIN &&
  input.photoSharpness >= input.bufferedSharpness * 0.9 &&
  input.photoConditions >= input.bufferedConditions * 0.9

/** A still is only worth waiting for when the camera's stills are clearly larger than its video (often they are not). */
export function stillIsLarger(
  photo: { imageWidth?: { max?: number }; imageHeight?: { max?: number } } | null | undefined,
  video: { width?: number; height?: number }
) {
  const photoLong = Math.max(photo?.imageWidth?.max ?? 0, photo?.imageHeight?.max ?? 0)
  const videoLong = Math.max(video.width ?? 0, video.height ?? 0)
  return videoLong > 0 && photoLong >= videoLong * STILL_MIN_GAIN
}
