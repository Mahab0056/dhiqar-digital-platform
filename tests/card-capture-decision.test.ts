// Identity-card camera: automatic capture decisions on simulated hand-held sequences, the best-frame buffer, the hint
// and the progress ring (pure functions only; no camera, no OCR).
import { describe, expect, it } from 'vitest'
import {
  BEST_MAX_AGE_MS,
  PATIENCE_MS,
  TICK_MS,
  chooseHint,
  createCaptureSession,
  offerFrame,
  pickFrame,
  smoothProgress,
  stepCapture,
  type CaptureSession,
  type CaptureStep,
  type CardSide,
  type FrameBuffer,
  type FrameMetrics,
  type TickRecord,
} from '../src/components/camera/card-quality'

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
const between = (next: () => number, low: number, high: number) => low + (high - low) * next()

type Run = {
  capturedAt: number | null
  reason: CaptureStep['capture']
  steps: Array<{ t: number; step: CaptureStep }>
  session: CaptureSession
}

/** Feeds a sequence of measurements, one per tick (with timer jitter), until a capture or `durationMs`. */
function simulate(
  frame: (index: number, elapsed: number, next: () => number) => FrameMetrics,
  {
    seed = 1,
    durationMs = 8000,
    jitterMs = 25,
    tickMs = TICK_MS,
    side = 'front' as CardSide,
  }: { seed?: number; durationMs?: number; jitterMs?: number; tickMs?: number; side?: CardSide } = {}
): Run {
  const next = random(seed)
  const start = 10_000
  let session = createCaptureSession(side)
  const steps: Run['steps'] = []
  let t = start
  for (let index = 0; t - start <= durationMs; index++) {
    const step = stepCapture(session, frame(index, t - start, next), t)
    session = step.session
    steps.push({ t, step })
    if (step.capture) return { capturedAt: t - start, reason: step.capture, steps, session }
    t += tickMs + between(next, -jitterMs, jitterMs)
  }
  return { capturedAt: null, reason: null, steps, session }
}

/** Hand-held: tremor every tick (motion 8–15), now and then a blurred frame, ordinary indoor light. */
const handHeld =
  (blurEvery = 0.25) =>
  (index: number, _elapsed: number, next: () => number) => ({
    brightness: between(next, 120, 160),
    glare: between(next, 0.001, 0.006),
    sharpness: next() < blurEvery ? between(next, 30, 60) : between(next, 180, 420),
    contrast: between(next, 38, 55),
    motion: index === 0 ? null : between(next, 8, 15),
  })

/** The rule this replaces: four consecutive ticks with motion < 7, Laplacian > 120 and brightness 70–215. */
function oldRuleCaptures(run: Run, frame: (index: number, elapsed: number, next: () => number) => FrameMetrics) {
  const next = random(1)
  let streak = 0
  for (let index = 0; index < 40; index++) {
    const m = frame(index, index * 280, next)
    const good =
      m.brightness >= 70 && m.brightness <= 215 && m.glare <= 0.025 && m.sharpness > 120 && (m.motion ?? 99) < 7
    streak = good ? streak + 1 : 0
    if (streak >= 4) return true
  }
  return false
}

describe('card capture — automatic capture on hand-held sequences', () => {
  it('captures a shaky hand-held card within about a second and a half (20 different hands)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const run = simulate(handHeld(), { seed })
      expect(run.reason, `seed ${seed}`).toBe('good')
      expect(run.capturedAt!, `seed ${seed}`).toBeLessThanOrEqual(1500)
    }
  })

  it('would never have captured that sequence with the old "hold perfectly still" rule', () => {
    expect(oldRuleCaptures(simulate(handHeld()), handHeld())).toBe(false)
  })

  it('delivers the best frame of the window, not the frame of the moment', () => {
    const run = simulate(handHeld(0.3), { seed: 4 })
    const at = run.steps[run.steps.length - 1].t
    const picked = pickFrame(run.session.frames, at)!
    const recent = run.steps.filter(({ t }) => at - t <= BEST_MAX_AGE_MS)
    const bestRank = Math.max(...recent.map(({ step }) => step.frame.rank))
    expect(picked.rank).toBe(bestRank)
    expect(recent.find(({ step }) => step.frame.rank === bestRank)!.t).toBe(picked.t)
  })

  it('does not capture a truly blurred card, and suggests getting closer, then focusing', () => {
    const run = simulate((index, _elapsed, next) => ({
      ...handHeld(0)(index, _elapsed, next),
      sharpness: between(next, 4, 18),
    }))
    expect(run.capturedAt).toBeNull()
    expect(run.steps[8].step.hint).toBe('closer')
    expect(run.steps[run.steps.length - 1].step.hint).toBe('focus')
    expect(run.session.progress).toBe(0)
  })

  it('does not capture in the dark, even though sensor noise looks "sharp"', () => {
    const run = simulate((index, _elapsed, next) => ({
      brightness: between(next, 22, 36),
      glare: 0,
      sharpness: between(next, 200, 900),
      contrast: between(next, 5, 12),
      motion: index === 0 ? null : between(next, 3, 9),
    }))
    expect(run.capturedAt).toBeNull()
    expect(run.steps[run.steps.length - 1].step.hint).toBe('dark')
    // the noisy dark frames never raised the sharpness bar
    expect(run.session.peakSharpness).toBe(0)
  })

  it('does not capture through a strong reflection and asks to tilt the card', () => {
    const run = simulate((index, elapsed, next) => ({ ...handHeld(0)(index, elapsed, next), glare: 0.08 }))
    expect(run.capturedAt).toBeNull()
    expect(run.steps[run.steps.length - 1].step.hint).toBe('glare')
  })

  it('still gets there with a soft lens: the bar relaxes during the first seconds', () => {
    const run = simulate((index, elapsed, next) => ({
      ...handHeld(0)(index, elapsed, next),
      sharpness: between(next, 70, 95),
    }))
    expect(run.reason).toBe('good')
    expect(run.capturedAt!).toBeGreaterThan(700)
    expect(run.capturedAt!).toBeLessThan(3000)
  })

  it('after a few seconds takes an acceptable best frame rather than waiting for ever', () => {
    // a faint, steady reflection keeps every tick just below "good"
    const run = simulate((index, elapsed, next) => ({ ...handHeld(0)(index, elapsed, next), glare: 0.027 }))
    expect(run.reason).toBe('patience')
    expect(run.capturedAt!).toBeGreaterThanOrEqual(PATIENCE_MS)
    expect(run.capturedAt!).toBeLessThan(PATIENCE_MS + 400)
  })

  it('does not capture an empty table top', () => {
    const run = simulate((index, elapsed, next) => ({
      ...handHeld(0)(index, elapsed, next),
      contrast: between(next, 2, 6),
      sharpness: between(next, 3, 10),
    }))
    expect(run.capturedAt).toBeNull()
    expect(run.steps[run.steps.length - 1].step.hint).toBe('place')
  })

  it('a burst of shake only delays the capture, it does not start it over', () => {
    const run = simulate((index, elapsed, next) => {
      const frame = handHeld(0)(index, elapsed, next)
      // ticks 3 and 4 are a sharp jolt (heavy motion blur)
      return index === 3 || index === 4 ? { ...frame, sharpness: 25, motion: 60 } : frame
    })
    expect(run.reason).toBe('good')
    expect(run.capturedAt!).toBeLessThanOrEqual(1200)
    const progress = run.steps.map(({ step }) => step.session.progress)
    expect(progress[4]).toBeGreaterThan(0.3)
    expect(progress[4]).toBeGreaterThanOrEqual(progress[2] - 0.17)
  })
})

describe('card capture — what used to block or slow it down', () => {
  /** the back as a sharp phone measures it at analysis size (1000–4000), hand-held */
  const sharpBack = (index: number, _elapsed: number, next: () => number): FrameMetrics => ({
    brightness: between(next, 120, 170),
    glare: between(next, 0, 0.004),
    exposure: 0,
    sharpness: next() < 0.25 ? between(next, 300, 800) : between(next, 1500, 3800),
    contrast: between(next, 38, 55),
    motion: index === 0 ? null : between(next, 8, 15),
  })

  it('captures a sharp hand-held back within about a second and a half', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const run = simulate(sharpBack, { seed, side: 'back' })
      expect(run.reason, `seed ${seed}`).toBe('good')
      expect(run.capturedAt!, `seed ${seed}`).toBeLessThanOrEqual(1500)
    }
  })

  it('never auto-captures a uniformly soft back, whose lines the OCR would misread — and says to focus', () => {
    // σ ≈ 3.5 px at 1080p: ~90 at analysis size; the front used to accept that after ~4 s and the back after 0.9 s
    const run = simulate(
      (index, elapsed, next) => ({ ...sharpBack(index, elapsed, next), sharpness: between(next, 70, 110) }),
      {
        side: 'back',
      }
    )
    expect(run.capturedAt).toBeNull()
    expect(['closer', 'focus']).toContain(run.steps[run.steps.length - 1].step.hint)
  })

  it('an over-lit white zone (exposure, not a reflection) does not hold the capture back', () => {
    // as measured on a card whose light zone clips on a dark table: no glare, a third of the picture clipped
    const run = simulate(
      (index, elapsed, next) => ({ ...sharpBack(index, elapsed, next), glare: 0, exposure: between(next, 0.3, 0.4) }),
      { side: 'back' }
    )
    expect(run.reason).toBe('good')
    expect(run.capturedAt!).toBeLessThanOrEqual(1500)
  })

  it('a busy phone that ticks slowly still captures, a little later', () => {
    for (const tickMs of [450, 650, 1250]) {
      const run = simulate(handHeld(0), { tickMs, jitterMs: 40, durationMs: 12_000 })
      expect(run.reason, `${tickMs} ms ticks`).toBe('good')
      expect(run.capturedAt!, `${tickMs} ms ticks`).toBeLessThanOrEqual(3 * tickMs)
    }
  })

  it('does not prefer the very first picture just because no motion was measured on it yet', () => {
    // every picture alike: the first one used to win as "perfectly steady" and was 0.6–1.2 s old when delivered
    const run = simulate((index, elapsed, next) => ({ ...handHeld(0)(index, elapsed, next), sharpness: 300 }))
    const at = run.steps[run.steps.length - 1].t
    expect(pickFrame(run.session.frames, at)!.t).toBeGreaterThan(run.steps[0].t)
  })
})

describe('card capture — best-frame buffer', () => {
  const empty: FrameBuffer = { best: null, runnerUp: null }

  it('keeps the best frame, and the best one after it in the other slot', () => {
    let state = offerFrame(empty, { t: 0, rank: 0.5, score: 0.7 })
    expect(state.storeIn).toBe(0)
    state = offerFrame(state.buffer, { t: 150, rank: 0.4, score: 0.6 })
    expect(state.storeIn).toBe(1)
    expect(state.buffer.runnerUp?.rank).toBe(0.4)
    state = offerFrame(state.buffer, { t: 300, rank: 0.3, score: 0.5 })
    expect(state.storeIn).toBeNull()
    state = offerFrame(state.buffer, { t: 450, rank: 0.8, score: 0.9 })
    expect(state.storeIn).toBe(1)
    expect(state.buffer).toEqual({ best: { slot: 1, t: 450, rank: 0.8, score: 0.9 }, runnerUp: null })
  })

  it('lets an old best expire in favour of the next best, never the current frame by default', () => {
    let state = offerFrame(empty, { t: 0, rank: 0.9, score: 0.9 })
    state = offerFrame(state.buffer, { t: 200, rank: 0.7, score: 0.8 })
    state = offerFrame(state.buffer, { t: 400, rank: 0.6, score: 0.7 })
    expect(state.storeIn).toBeNull()
    // at 1600 ms the first frame is too old: the 200 ms frame takes over and the newcomer becomes the runner-up
    state = offerFrame(state.buffer, { t: 1600, rank: 0.2, score: 0.3 })
    expect(state.buffer.best?.t).toBe(200)
    expect(state.buffer.runnerUp?.t).toBe(1600)
    expect(state.storeIn).toBe(state.buffer.runnerUp?.slot)
    expect(state.storeIn).not.toBe(state.buffer.best?.slot)
  })

  it('never draws over the slot that holds the best frame (random sequences)', () => {
    const next = random(99)
    let buffer = empty
    for (let i = 0; i < 2000; i++) {
      const before = pickFrame(buffer, i * 150)
      const offered = offerFrame(buffer, { t: i * 150, rank: next(), score: next() })
      if (offered.storeIn !== null && before && offered.buffer.best !== null && offered.buffer.best.t !== i * 150)
        expect(offered.storeIn).not.toBe(offered.buffer.best.slot)
      if (offered.buffer.best && offered.buffer.runnerUp)
        expect(offered.buffer.best.slot).not.toBe(offered.buffer.runnerUp.slot)
      const best = pickFrame(offered.buffer, i * 150)!
      expect(i * 150 - best.t).toBeLessThanOrEqual(BEST_MAX_AGE_MS)
      buffer = offered.buffer
    }
  })

  it('on a tie the newer frame wins: in the dark, a press sends the newest picture, not one 1.3 s old', () => {
    let buffer = empty
    for (let t = 0; t <= 3000; t += 150) buffer = offerFrame(buffer, { t, rank: 0, score: 0 }).buffer
    expect(pickFrame(buffer, 3000)?.t).toBe(3000)
    let state = offerFrame(empty, { t: 0, rank: 0.5, score: 0.5 })
    state = offerFrame(state.buffer, { t: 150, rank: 0.5, score: 0.5 })
    expect(state.buffer.best?.t).toBe(150)
    expect(state.storeIn).toBe(1)
  })

  it('serves the shutter the best frame of the last moments only', () => {
    let buffer = offerFrame(empty, { t: 0, rank: 0.9, score: 0.9 }).buffer
    buffer = offerFrame(buffer, { t: 1000, rank: 0.5, score: 0.6 }).buffer
    expect(pickFrame(buffer, 1200)?.t).toBe(0)
    // pressed 1.7 s after the sharp frame: that one is stale, the 1 s frame is used
    expect(pickFrame(buffer, 1700)?.t).toBe(1000)
    expect(pickFrame(buffer, 5000)).toBeNull()
  })
})

describe('card capture — hint and ring', () => {
  const tick = (t: number, issue: TickRecord['issue']): TickRecord => ({
    t,
    dt: 150,
    score: issue ? 0.3 : 0.9,
    lenient: issue ? 0.3 : 0.9,
    issue,
    light: true,
    glare: issue !== 'glare',
    sharp: issue !== 'blur',
  })

  it('keeps a calm hint: one odd tick among good ones does not change it', () => {
    const ticks = [tick(0, null), tick(150, null), tick(300, 'glare'), tick(450, null), tick(600, null)]
    expect(chooseHint(ticks, 600)).toBe('good')
    expect(chooseHint([], 0)).toBe('place')
    const glare = [tick(0, 'glare'), tick(150, 'glare'), tick(300, null), tick(450, 'glare')]
    expect(chooseHint(glare, 450)).toBe('glare')
  })

  it('fills smoothly and drains slowly', () => {
    expect(smoothProgress(0.2, 0.6)).toBe(0.6)
    expect(smoothProgress(0.6, 0)).toBeCloseTo(0.52)
    let value = 0.9
    for (let i = 0; i < 5; i++) value = smoothProgress(value, 0)
    expect(value).toBeCloseTo(0.5)
  })

  it('shows progress while a good stretch builds up, and never reports full before capturing', () => {
    const run = simulate(handHeld(0), { seed: 5 })
    const progress = run.steps.map(({ step }) => step.session.progress)
    expect(progress[0]).toBe(0)
    expect(progress[2]).toBeGreaterThan(0.3)
    expect(progress.slice(0, -1).every(value => value < 1)).toBe(true)
    expect(progress[progress.length - 1]).toBe(1)
    const session = createCaptureSession()
    expect(session.progress).toBe(0)
  })
})
