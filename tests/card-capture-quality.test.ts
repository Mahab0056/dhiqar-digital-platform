// Identity-card camera: per-frame measurements, scoring, geometry and the still-photo check (pure functions only).
import { describe, expect, it } from 'vitest'
import {
  ANALYSIS_HEIGHT,
  ANALYSIS_WIDTH,
  BACK_SHARP_FLOOR,
  GOOD_SCORE,
  acceptPhoto,
  blockThumbnail,
  expandRegion,
  focusRows,
  frameRegionInVideo,
  grayFromRgba,
  mapRegionToPhoto,
  measureFrame,
  scoreFrame,
  screenPointToVideo,
  sharpnessReference,
  stillIsLarger,
  thumbnailCorrelation,
  type FrameMetrics,
} from '../src/components/camera/card-quality'
import { createFrameStore, grabFrame } from '../src/components/camera/card-frame'

const W = ANALYSIS_WIDTH
const H = ANALYSIS_HEIGHT

/** Deterministic pseudo-random numbers (mulberry32). */
function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A card-like picture: light background, a darker portrait block and rows of small dark "characters". */
function cardImage(seed = 7, background = 200, ink = 45) {
  const next = random(seed)
  const gray = new Uint8ClampedArray(W * H).fill(background)
  const fill = (x0: number, y0: number, w: number, h: number, value: number) => {
    for (let y = y0; y < Math.min(H, y0 + h); y++)
      for (let x = x0; x < Math.min(W, x0 + w); x++) gray[y * W + x] = value
  }
  fill(Math.round(W * 0.7), Math.round(H * 0.18), Math.round(W * 0.24), Math.round(H * 0.58), 110)
  for (let row = 0; row < 9; row++) {
    const y = 12 + row * 20
    for (let x = 10; x < W * 0.66; x += 6) if (next() > 0.25) fill(x, y, 1 + Math.round(next() * 2), 6, ink)
  }
  return gray
}

function boxBlur(gray: Uint8ClampedArray, radius: number, passes = 2) {
  let src = Float32Array.from(gray)
  for (let pass = 0; pass < passes; pass++) {
    const tmp = new Float32Array(src.length)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let sum = 0
        let n = 0
        for (let k = -radius; k <= radius; k++) {
          const xx = Math.min(W - 1, Math.max(0, x + k))
          sum += src[y * W + xx]
          n++
        }
        tmp[y * W + x] = sum / n
      }
    const out = new Float32Array(src.length)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let sum = 0
        let n = 0
        for (let k = -radius; k <= radius; k++) {
          const yy = Math.min(H - 1, Math.max(0, y + k))
          sum += tmp[yy * W + x]
          n++
        }
        out[y * W + x] = sum / n
      }
    src = out
  }
  return Uint8ClampedArray.from(src)
}

const shift = (gray: Uint8ClampedArray, dx: number, dy: number) => {
  const out = new Uint8ClampedArray(gray.length)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = Math.min(W - 1, Math.max(0, x - dx))
      const sy = Math.min(H - 1, Math.max(0, y - dy))
      out[y * W + x] = gray[sy * W + sx]
    }
  return out
}

const metrics = (patch: Partial<FrameMetrics> = {}): FrameMetrics => ({
  brightness: 140,
  glare: 0.003,
  sharpness: 300,
  contrast: 45,
  motion: 10,
  ...patch,
})

describe('card capture — measuring a frame', () => {
  it('converts RGBA to luma', () => {
    const gray = grayFromRgba([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255], 3)
    expect(Array.from(gray)).toEqual([255, 0, 76])
  })

  it('sees crisp text as far sharper than the same card out of focus', () => {
    const sharp = measureFrame(cardImage(), W, H)
    const soft = measureFrame(boxBlur(cardImage(), 1), W, H)
    const blurred = measureFrame(boxBlur(cardImage(), 3), W, H)
    expect(sharp.sharpness).toBeGreaterThan(soft.sharpness * 3)
    expect(soft.sharpness).toBeGreaterThan(blurred.sharpness * 3)
    expect(blurred.sharpness).toBeLessThan(20)
    expect(sharp.contrast).toBeGreaterThan(20)
    expect(sharp.motion).toBeNull()
  })

  it('reads a blank surface as flat and clipped highlights as glare', () => {
    const blank = measureFrame(new Uint8ClampedArray(W * H).fill(150), W, H)
    expect(blank.contrast).toBe(0)
    expect(blank.sharpness).toBe(0)
    const shiny = cardImage()
    for (let i = 0; i < shiny.length; i += 20) shiny[i] = 255
    expect(measureFrame(shiny, W, H).glare).toBeCloseTo(0.05, 2)
  })

  it('measures motion against the previous tick', () => {
    const card = cardImage()
    expect(measureFrame(card, W, H, card).motion).toBe(0)
    const moved = measureFrame(shift(card, 4, 2), W, H, card).motion!
    expect(moved).toBeGreaterThan(5)
  })

  it('judges the back by its machine-readable rows: blurred lines are blur even if the rest is crisp', () => {
    const crisp = cardImage()
    const blurred = boxBlur(cardImage(), 3)
    const mixed = Uint8ClampedArray.from(crisp)
    const zone = focusRows('back')
    for (let y = Math.floor(zone.top * H); y < H; y++) for (let x = 0; x < W; x++) mixed[y * W + x] = blurred[y * W + x]
    const asFront = measureFrame(mixed, W, H, null, focusRows('front'))
    const asBack = measureFrame(mixed, W, H, null, zone)
    expect(asBack.sharpness).toBeLessThan(asFront.sharpness / 3)
    // and glare on those rows counts in full, not diluted by the whole card
    const glare = Uint8ClampedArray.from(crisp)
    for (let y = H - 20; y < H - 14; y++) for (let x = 0; x < W; x++) glare[y * W + x] = 255
    expect(measureFrame(glare, W, H, null, zone).glare).toBeGreaterThan(measureFrame(glare, W, H).glare * 2)
  })
})

describe('card capture — scoring', () => {
  const reference = sharpnessReference(500, 0)

  it('scores a fair hand-held frame as good, tremor included', () => {
    const frame = scoreFrame(metrics({ motion: 14 }), reference)
    expect(frame.score).toBeGreaterThanOrEqual(GOOD_SCORE)
    expect(frame.issue).toBeNull()
  })

  it('names what holds a frame back', () => {
    expect(scoreFrame(metrics({ brightness: 30, contrast: 10 }), reference).issue).toBe('dark')
    expect(scoreFrame(metrics({ brightness: 245 }), reference).issue).toBe('bright')
    expect(scoreFrame(metrics({ glare: 0.07 }), reference).issue).toBe('glare')
    expect(scoreFrame(metrics({ sharpness: 25 }), reference).issue).toBe('blur')
    expect(scoreFrame(metrics({ contrast: 3, sharpness: 2 }), reference).issue).toBe('empty')
    expect(scoreFrame(metrics({ motion: 60 }), reference).issue).toBe('motion')
  })

  it('in a very dark picture the card cannot be seen either: the hint is about the light', () => {
    // nearly black (a phone in a dark room): no contrast, no light — the light is what to fix
    expect(scoreFrame(metrics({ brightness: 6, contrast: 2, sharpness: 400 }), reference).issue).toBe('dark')
    expect(scoreFrame(metrics({ brightness: 22, contrast: 4, sharpness: 400 }), reference).issue).toBe('dark')
  })

  it('the first picture, with no motion measured yet, is not taken for a perfectly steady one', () => {
    const first = scoreFrame(metrics({ motion: null }), reference)
    const steady = scoreFrame(metrics({ motion: 10 }), reference)
    expect(first.steady).toBeLessThan(1)
    expect(first.rank).toBeLessThan(steady.rank)
  })

  it('treats motion as a nudge, never as a veto', () => {
    const shaky = scoreFrame(metrics({ motion: 80 }), reference)
    expect(shaky.score).toBeGreaterThan(0.5)
    expect(scoreFrame(metrics({ motion: 15 }), reference).score).toBe(
      scoreFrame(metrics({ motion: 2 }), reference).score
    )
  })

  it('relaxes the sharpness bar over the first seconds and follows the recent peak', () => {
    expect(sharpnessReference(0, 0)).toBeCloseTo(140)
    expect(sharpnessReference(10_000, 0)).toBeCloseTo(55)
    expect(sharpnessReference(10_000, 600)).toBe(300)
    const soft = metrics({ sharpness: 80 })
    expect(scoreFrame(soft, sharpnessReference(0, 80)).score).toBeLessThan(GOOD_SCORE)
    expect(scoreFrame(soft, sharpnessReference(3000, 80)).score).toBeGreaterThanOrEqual(GOOD_SCORE)
  })

  it('ranks frames by absolute sharpness, weighed by the conditions', () => {
    const a = scoreFrame(metrics({ sharpness: 200 }), 140).rank
    const b = scoreFrame(metrics({ sharpness: 400 }), 140).rank
    const glared = scoreFrame(metrics({ sharpness: 400, glare: 0.04 }), 140).rank
    expect(b).toBeGreaterThan(a)
    expect(glared).toBeLessThan(a)
    expect(scoreFrame(metrics({ brightness: 20, sharpness: 900 }), 140).rank).toBe(0)
  })
})

describe('card capture — geometry', () => {
  // a 400×800 portrait screen showing a 1080×1920 stream with object-fit: cover
  const screen = { left: 0, top: 0, width: 400, height: 800 }

  it('maps the on-screen frame into video pixels', () => {
    const region = frameRegionInVideo(screen, { left: 20, top: 300, width: 360, height: 227 }, 1080, 1920)!
    const scale = 800 / 1920
    expect(region.x).toBeCloseTo((20 + 25) / scale)
    expect(region.y).toBeCloseTo(300 / scale)
    expect(region.w).toBeCloseTo(360 / scale)
    expect(region.h).toBeCloseTo(227 / scale)
    expect(frameRegionInVideo(screen, { left: 0, top: 0, width: 10, height: 10 }, 0, 0)).toBeNull()
  })

  it('maps a tap to normalised video coordinates', () => {
    const centre = screenPointToVideo(screen, { x: 200, y: 400 }, 1080, 1920)
    expect(centre.x).toBeCloseTo(0.5)
    expect(centre.y).toBeCloseTo(0.5)
    const corner = screenPointToVideo(screen, { x: -50, y: 900 }, 1080, 1920)
    expect(corner).toEqual({ x: 0, y: 1 })
  })

  it('keeps a margin around the card without leaving the picture', () => {
    const kept = expandRegion({ x: 100, y: 100, w: 1000, h: 630 }, 1920, 1080)
    expect([kept.x, kept.y, kept.w, kept.h].map(v => Math.round(v * 10) / 10)).toEqual([40, 49.6, 1120, 730.8])
    const edge = expandRegion({ x: 0, y: 0, w: 1920, h: 1080 }, 1920, 1080)
    expect(edge).toEqual({ x: 0, y: 0, w: 1920, h: 1080 })
  })

  it('maps a video region into a 4:3 still, and refuses a rotated still', () => {
    const still = mapRegionToPhoto({ x: 100, y: 100, w: 800, h: 500 }, 1920, 1080, 4032, 3024)!
    expect([still.x, still.y, still.w, still.h].map(Math.round)).toEqual([210, 588, 1680, 1050])
    const portrait = mapRegionToPhoto({ x: 100, y: 100, w: 800, h: 500 }, 1080, 1920, 3024, 4032)!
    expect(portrait.x).toBeCloseTo(378 + 210)
    expect(portrait.y).toBeCloseTo(210)
    expect(mapRegionToPhoto({ x: 0, y: 0, w: 10, h: 10 }, 1080, 1920, 4032, 3024)).toBeNull()
  })
})

describe('card capture — still photo vs buffered frame', () => {
  const card = cardImage(3)
  const thumb = (gray: Uint8ClampedArray) => blockThumbnail(gray, W, H)

  it('recognises the same card despite exposure changes and a small shift', () => {
    expect(thumbnailCorrelation(thumb(card), thumb(card))).toBeCloseTo(1)
    const brighter = card.map(v => Math.min(255, v * 1.1 + 8))
    expect(thumbnailCorrelation(thumb(card), thumb(brighter))).toBeGreaterThan(0.95)
    expect(thumbnailCorrelation(thumb(card), thumb(shift(card, 4, 3)))).toBeGreaterThan(0.6)
  })

  it('rejects a misplaced or rotated crop', () => {
    const rotated = Uint8ClampedArray.from(card).reverse()
    expect(thumbnailCorrelation(thumb(card), thumb(rotated))).toBeLessThan(0.6)
    expect(thumbnailCorrelation(thumb(card), thumb(new Uint8ClampedArray(W * H).fill(120)))).toBe(0)
  })

  it('uses the still only when it is the same card, about as sharp on the same rows, in light as good, and larger', () => {
    const base = {
      correlation: 0.9,
      photoSharpness: 3300,
      bufferedSharpness: 3300,
      photoConditions: 1,
      bufferedConditions: 1,
      photoWidth: 2400,
      bufferedWidth: 1100,
    }
    expect(acceptPhoto(base)).toBe(true)
    expect(acceptPhoto({ ...base, photoSharpness: 3000 })).toBe(true)
    expect(acceptPhoto({ ...base, correlation: 0.4 })).toBe(false)
    // a still shot while the hand moved: a seventh of the sharpness is refused, however a saturating score saw it
    expect(acceptPhoto({ ...base, photoSharpness: 450 })).toBe(false)
    expect(acceptPhoto({ ...base, photoSharpness: 2900 })).toBe(false)
    expect(acceptPhoto({ ...base, photoConditions: 0.6 })).toBe(false)
    // no more pixels than the video, or barely more: not worth replacing the frame that was scored
    expect(acceptPhoto({ ...base, photoWidth: 1100 })).toBe(false)
    expect(acceptPhoto({ ...base, photoWidth: 1300 })).toBe(false)
  })

  it('waits for a still only when the camera says its stills are clearly larger than the video', () => {
    expect(
      stillIsLarger({ imageWidth: { max: 4032 }, imageHeight: { max: 3024 } }, { width: 1920, height: 1080 })
    ).toBe(true)
    // measured on a phone: stills as large as the video — waiting for one bought nothing
    expect(stillIsLarger({ imageWidth: { max: 1080 } }, { width: 1080, height: 1920 })).toBe(false)
    expect(stillIsLarger({ imageWidth: { max: 2200 } }, { width: 1920, height: 1080 })).toBe(false)
    expect(stillIsLarger(undefined, { width: 1920, height: 1080 })).toBe(false)
    expect(stillIsLarger({ imageWidth: { max: 4000 } }, {})).toBe(false)
  })
})

describe('card capture — exposure is not glare', () => {
  const back = focusRows('back')
  const card = cardImage()

  it('a white machine-readable zone over-lit as a whole is exposure, not a reflection: it can be captured', () => {
    // a phone over-exposing the light zone of the card on a dark table: its paper clips, its print stays
    const white = Uint8ClampedArray.from(card)
    for (let y = Math.floor(back.top * H); y < H; y++)
      for (let x = 0; x < W; x++) if (white[y * W + x] === 200) white[y * W + x] = 255
    const measured = measureFrame(white, W, H, null, back)
    expect(measured.glare).toBeLessThan(0.01)
    expect(measured.exposure).toBeGreaterThan(0.2)
    const frame = scoreFrame(measured, sharpnessReference(500, 0, 'back'), BACK_SHARP_FLOOR)
    expect(frame.glare).toBe(1)
    expect(frame.score).toBeGreaterThanOrEqual(GOOD_SCORE)
    expect(frame.issue).toBeNull()
  })

  it('a compact bright spot on the zone is a reflection, and the hint asks to tilt the card', () => {
    const spot = Uint8ClampedArray.from(card)
    for (let y = H - 50; y < H - 25; y++) for (let x = 100; x < 140; x++) spot[y * W + x] = 255
    const measured = measureFrame(spot, W, H, null, back)
    expect(measured.glare).toBeGreaterThan(0.03)
    expect(measured.exposure).toBe(0)
    const frame = scoreFrame(measured, sharpnessReference(500, 0, 'back'), BACK_SHARP_FLOOR)
    expect(frame.issue).toBe('glare')
    expect(frame.score).toBeLessThan(GOOD_SCORE)
  })

  it('a reflection lowers a frame’s rank without zeroing it: the sharpest frame stays the best one', () => {
    const glared = scoreFrame(metrics({ glare: 0.2, sharpness: 2000 }), 500)
    expect(glared.score).toBe(0)
    expect(glared.rank).toBeGreaterThan(0)
    expect(glared.rank).toBeGreaterThan(scoreFrame(metrics({ glare: 0.2, sharpness: 400 }), 500).rank)
  })

  it('blurred print under large over-lit areas asks for less light, not for getting closer', () => {
    const frame = scoreFrame(metrics({ sharpness: 30, exposure: 0.4 }), 500)
    expect(frame.issue).toBe('bright')
    expect(scoreFrame(metrics({ sharpness: 30, exposure: 0 }), 500).issue).toBe('blur')
  })
})

describe('card capture — the back must stay legible', () => {
  it('a uniformly soft back is never sharp enough, however long the camera waits', () => {
    // autofocus hunting or a card closer than the lens can focus: ~90 at analysis size, Q/0 and 8/B already confused
    const soft = metrics({ sharpness: 90 })
    for (const elapsed of [0, 2000, 4000, 10_000]) {
      const frame = scoreFrame(soft, sharpnessReference(elapsed, 90, 'back'), BACK_SHARP_FLOOR)
      expect(frame.sharp, `${elapsed} ms`).toBe(0)
      expect(frame.lenient).toBe(0)
    }
    // the front still relaxes for a soft lens: its portrait is matched, not read
    expect(scoreFrame(soft, sharpnessReference(4000, 90)).score).toBeGreaterThanOrEqual(GOOD_SCORE)
    // a sharp back frame from a real phone passes at once
    expect(scoreFrame(metrics({ sharpness: 1800 }), sharpnessReference(0, 1800, 'back'), BACK_SHARP_FLOOR).score).toBe(
      1
    )
  })
})

describe('card capture — one picture per tick', () => {
  /** a video that moves on every time it is read, as a real one does between two draws on a busy phone */
  const movingVideo = () => {
    const video = { kind: 'video', reads: 0, next: () => ++video.reads }
    return video
  }
  type FakeCanvas = { width: number; height: number; picture: number; getContext: () => unknown }
  const fakeCanvas = (made: FakeCanvas[] = []) => {
    const canvas: FakeCanvas = { width: 0, height: 0, picture: 0, getContext: () => context }
    const context = {
      drawImage: (source: { kind?: string; next?: () => number; picture?: number }) => {
        canvas.picture = source.kind === 'video' ? source.next!() : source.picture!
      },
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4).fill(canvas.picture),
      }),
    }
    made.push(canvas)
    return canvas
  }
  const area = { inner: { x: 100, y: 80, w: 1000, h: 630 }, outer: { x: 40, y: 30, w: 1120, h: 730 } }

  it('the frame kept for delivery is exactly the picture its grey levels were measured on', () => {
    const video = movingVideo()
    const analysis = fakeCanvas()
    const made: FakeCanvas[] = []
    const store = createFrameStore(() => fakeCanvas(made) as unknown as HTMLCanvasElement)
    const size = { width: 4, height: 2 }
    for (let tick = 0; tick < 12; tick++) {
      const target = store.scratch()
      const gray = grabFrame(
        video as unknown as CanvasImageSource,
        area,
        target,
        analysis.getContext() as CanvasRenderingContext2D,
        size
      )!
      // measured on this tick's picture, drawn from the kept canvas — not on a later video frame
      expect(gray[0]).toBe((target as unknown as FakeCanvas).picture)
      if (tick % 3 !== 2) store.keep(tick % 2 === 0 ? 0 : 1, { gray, sharpness: tick, conditions: 1 })
    }
    for (const slot of [0, 1] as const) {
      const held = store.get(slot)!
      expect(held.gray[0]).toBe((held.canvas as unknown as FakeCanvas).picture)
    }
    // the video is read once per tick, the full-resolution canvas keeps the margin, and keeping a frame is a pointer
    // swap: three canvases in all, whatever the number of ticks
    expect(video.reads).toBe(12)
    expect(made.map(canvas => [canvas.width, canvas.height])).toEqual([
      [1120, 730],
      [1120, 730],
      [1120, 730],
    ])
  })
})
