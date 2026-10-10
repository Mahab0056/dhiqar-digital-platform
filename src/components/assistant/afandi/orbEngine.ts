/**
 * أفندي orb — the synthetic «voice» (ported from barmjini-site greeter/orbEngine.ts; no React, no imports).
 *
 * The orb's amplitude is synthesised from a word schedule (the greeting text, or the length of a reply that just
 * landed) and played as Web Animations on compositor-friendly properties: two wobbly voice rings that pulse and turn
 * in opposite directions, the halo's glow and the emblem nodding along. No rAF loop, no per-frame main-thread work;
 * animations pause with a hidden tab and end by themselves. Under reduced motion (or the site's motion pause) every
 * call is a no-op.
 */
export type WordBeat = { start: number; weight: number; syllable: boolean }
export type VoiceSchedule = { beats: WordBeat[]; pauses: Array<[number, number]>; lead: number; end: number }

/** Word reveal duration (CSS afd-word-in). */
export const WORD_DUR = 320
/** First word starts this long after the bubble begins to open. */
export const WORD_LEAD = 260
/** Envelope sample step (ms): the compositor interpolates linearly between samples. */
export const STEP = 33

export function hashText(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Small deterministic PRNG (same text → same voice). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Whitespace-delimited words, punctuation kept with its word (Arabic letters always stay joined). */
export const splitWords = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean)

/** Letters only (harakat and tatweel do not take time). */
export const graphemes = (word: string): number => Array.from(word.replace(/[ً-ٰٟـ]/g, '')).length

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Word timings (ms from the bubble's start): a calm speaking pace, deterministic per text. */
export function buildSchedule(
  words: string[],
  opts: { lead?: number; speed?: number; seed?: number } = {}
): VoiceSchedule {
  const speed = opts.speed ?? 1
  const lead = opts.lead ?? WORD_LEAD
  const rnd = mulberry32(opts.seed ?? hashText(words.join(' ')))
  const beats: WordBeat[] = []
  const pauses: Array<[number, number]> = []
  let t = lead
  for (const w of words) {
    const g = graphemes(w)
    const gap = clamp(70 + 9 * g, 90, 170) / speed
    const pause = (/[،,]$/.test(w) ? 110 : /[.!؟?:—…]$/.test(w) ? 200 : 0) / speed
    beats.push({ start: t, weight: 0.42 + 0.38 * Math.min(1, g / 7) + 0.14 * (rnd() - 0.5), syllable: g >= 6 })
    if (pause) pauses.push([t + gap, t + gap + pause])
    t += gap + pause
  }
  const last = beats.length ? beats[beats.length - 1].start : lead
  return { beats, pauses, lead, end: last + WORD_DUR / speed }
}

/** A made-up schedule for a chat reply landing (`len` characters): clamp(600 + 12·len, 800, 2400) ms. */
export function burstSchedule(len: number, seed = len * 7919): VoiceSchedule {
  const dur = clamp(600 + 12 * len, 800, 2400)
  const rnd = mulberry32(seed)
  const beats: WordBeat[] = []
  const pauses: Array<[number, number]> = []
  let t = 40
  while (t < dur - 160) {
    const g = 2 + Math.floor(rnd() * 7)
    beats.push({ start: t, weight: 0.42 + 0.38 * Math.min(1, g / 7) + 0.14 * (rnd() - 0.5), syllable: g >= 6 })
    const gap = clamp(60 + 8 * g, 80, 150)
    const pause = rnd() < 0.12 ? 160 : 0
    if (pause) pauses.push([t + gap, t + gap + pause])
    t += gap + pause
  }
  return { beats, pauses, lead: 40, end: dur }
}

const easeOutQuad = (x: number) => 1 - (1 - x) * (1 - x)
const TAU = Math.PI * 2

/** Pulse of one beat `dt` ms after its start: 45 ms attack, then exp decay τ 110 ms. */
function pulse(weight: number, dt: number): number {
  if (dt < 0) return 0
  if (dt < 45) return weight * easeOutQuad(dt / 45)
  return weight * Math.exp(-(dt - 45) / 110)
}

/** Target amplitude at `t` ms into the schedule (0..1): a low «voice» bed with a pulse per word (and syllable). */
export function targetAt(s: VoiceSchedule, t: number): number {
  if (t < 0) return 0
  const inPause = s.pauses.some(([a, b]) => t >= a && t < b)
  const ts = t / 1000
  let v =
    t > s.end
      ? 0
      : t < s.lead
        ? 0.04
        : inPause
          ? 0.06
          : 0.18 +
            0.06 * Math.sin(TAU * 1.7 * ts) +
            0.04 * Math.sin(TAU * 2.9 * ts + 1.3) +
            0.03 * Math.sin(TAU * 4.3 * ts + 2.1)
  for (const b of s.beats) {
    const dt = t - b.start
    if (dt < 0) break
    if (dt > 700) continue
    v += pulse(b.weight, dt)
    if (b.syllable) v += pulse(0.6 * b.weight, dt - 0.45 * 110)
  }
  return clamp(v, 0, 1)
}

/** The amplitude envelope (one sample per STEP ms), smoothed like a meter (τ 60 ms rising, 140 ms falling). */
export function envelope(s: VoiceSchedule, from = 0): number[] {
  const out: number[] = []
  let amp = from
  for (let t = 0; out.length < 1200; t += STEP) {
    const target = targetAt(s, t)
    amp += (target - amp) * (1 - Math.exp(-STEP / (target > amp ? 60 : 140)))
    out.push(Math.round(amp * 1000) / 1000)
    if (t > s.end && amp < 0.01) break
  }
  out.push(0)
  return out
}

/** Closed wobbly contour (SVG units, centred on 0,0): the voice ring's static shape. */
export function contourPath(r0: number, a: number, phase: [number, number, number], offset = 0, points = 48): string {
  let d = ''
  for (let i = 0; i < points; i++) {
    const th = (i / points) * TAU
    const r =
      r0 +
      a *
        (0.55 * Math.sin(3 * th + phase[0] + offset) +
          0.3 * Math.sin(5 * th - phase[1] + offset) +
          0.15 * Math.sin(8 * th + phase[2] + offset))
    d += `${i ? 'L' : 'M'}${(r * Math.cos(th)).toFixed(3)} ${(r * Math.sin(th)).toFixed(3)}`
  }
  return `${d}Z`
}

/** Reduced motion, or the platform's own motion pause (home toggle: localStorage tqd-motion-paused). */
export function motionStill(): boolean {
  if (typeof window === 'undefined') return true
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
  try {
    if (window.localStorage.getItem('tqd-motion-paused') === '1') return true
  } catch {
    /* storage blocked */
  }
  return false
}

export type OrbVoice = {
  /** Play a schedule (a greeting reveal) from now. */
  speak(schedule: VoiceSchedule): void
  /** A chat reply landed: a short synthetic burst. */
  burst(len: number): void
  /** Let the voice fade out now. */
  stop(): void
  destroy(): void
  readonly speaking: boolean
}

type Track = { el: Element; frame: (a: number, i: number) => Keyframe }

export function createOrbVoice(orb: HTMLElement, opts: { onSpeaking?: (on: boolean) => void } = {}): OrbVoice {
  orb.querySelector('.gr-orb__voice--a path')?.setAttribute('d', contourPath(1.1, 0.085, [0.4, 0.8, 1.2]))
  orb.querySelector('.gr-orb__voice--b path')?.setAttribute('d', contourPath(1.14, 0.065, [1.45, 2.9, 4.35]))
  let anims: Animation[] = []
  let samples: number[] = []
  let startedAt = 0
  let speaking = false
  let token = 0
  const now = () => (document.timeline?.currentTime as number | null) ?? performance.now()
  const origin = now()

  const setSpeaking = (on: boolean) => {
    if (speaking === on) return
    speaking = on
    opts.onSpeaking?.(on)
  }

  const tracks = (base: number): Track[] => {
    const list: Track[] = []
    const ringA = orb.querySelector('.gr-orb__voice--a')
    const ringB = orb.querySelector('.gr-orb__voice--b')
    const halo = orb.querySelector('.gr-orb__halo')
    const mark = orb.querySelector('.gr-orb__mark')
    if (ringA)
      list.push({
        el: ringA,
        frame: (a, i) => ({
          opacity: Math.min(1, a * 1.6),
          scale: `${1 + a * 0.08}`,
          rotate: `${((base * 0.05) % 360) + i * STEP * 0.05}deg`,
        }),
      })
    if (ringB)
      list.push({
        el: ringB,
        frame: (a, i) => ({
          opacity: Math.min(1, a * 0.95),
          scale: `${1 + a * 0.06}`,
          rotate: `${-((base * 0.075) % 360) - i * STEP * 0.075}deg`,
        }),
      })
    if (halo) list.push({ el: halo, frame: a => ({ opacity: 0.42 + a * 0.5, scale: `${1 + a * 0.14}` }) })
    if (mark) list.push({ el: mark, frame: a => ({ scale: `${1 + a * 0.05} ${1 + a * 0.08}` }) })
    return list
  }

  const levelNow = (): number => {
    if (!speaking || !samples.length) return 0
    const i = Math.floor((now() - startedAt) / STEP)
    return samples[Math.max(0, Math.min(samples.length - 1, i))] ?? 0
  }

  const play = (next: number[]) => {
    anims.forEach(a => a.cancel())
    samples = next
    startedAt = now()
    const duration = Math.max(STEP, (next.length - 1) * STEP)
    const mine = ++token
    if (typeof Element.prototype.animate !== 'function') return
    anims = tracks(startedAt - origin).map(({ el, frame }) =>
      el.animate(next.map(frame), { duration, easing: 'linear' })
    )
    if (document.visibilityState === 'hidden') anims.forEach(a => a.pause())
    setSpeaking(true)
    const first = anims[0]
    if (!first) {
      setSpeaking(false)
      return
    }
    first.finished.then(
      () => {
        if (mine === token) {
          anims = []
          samples = []
          setSpeaking(false)
        }
      },
      () => {
        /* cancelled */
      }
    )
  }

  const onVisibility = () => anims.forEach(a => (document.visibilityState === 'hidden' ? a.pause() : a.play()))
  document.addEventListener('visibilitychange', onVisibility)

  return {
    speak(schedule) {
      if (motionStill()) return
      play(envelope(schedule, levelNow()))
    },
    burst(len) {
      if (motionStill()) return
      if (speaking && samples.length > 40) return
      play(envelope(burstSchedule(len), levelNow()))
    },
    stop() {
      if (!speaking) return
      const from = levelNow()
      play(from > 0.01 ? [from, from * 0.55, from * 0.25, from * 0.08, 0, 0, 0, 0] : [0, 0])
    },
    destroy() {
      document.removeEventListener('visibilitychange', onVisibility)
      token++
      anims.forEach(a => a.cancel())
      anims = []
      speaking = false
    },
    get speaking() {
      return speaking
    },
  }
}
