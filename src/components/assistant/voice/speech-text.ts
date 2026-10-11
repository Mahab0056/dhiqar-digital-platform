/**
 * Pure helpers of أفندي's voice (no DOM): what is read aloud, how it is cut into sentences while the answer streams,
 * which system voice speaks Arabic best, and the energy VAD. Shared by the voice mode and the tests.
 */

/** Markdown answer → plain speakable text: no links, URLs, bullets, bold marks or emojis. */
export function speakableText(markdown: string) {
  return (
    markdown
      // [label](/path) → label ; bare URLs and internal paths are not read
      .replace(/\[([^\]\n]+)\]\([^)\s]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/(^|\s)\/[\w\-/.?=&%#]+/g, '$1')
      .replace(/[*_`#>|]/g, '')
      // list markers → a pause
      .replace(/^\s*(?:[-•]|\d{1,2}[.)-])\s+/gm, '')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim()
  )
}

/** Sentence ends: Arabic and Latin full stops, question and exclamation marks, and line breaks (list items). */
const SENTENCE_END = /[.!?؟…](?=\s|$)|\n/g

/**
 * Complete sentences of `text` starting at character `from` (a streaming answer: the last, unfinished sentence is
 * left for later unless `final`). Returns the sentences and the offset to continue from.
 */
export function takeSentences(text: string, from: number, final = false) {
  const sentences: string[] = []
  let cursor = from
  SENTENCE_END.lastIndex = from
  for (let match = SENTENCE_END.exec(text); match; match = SENTENCE_END.exec(text)) {
    const end = match.index + match[0].length
    const sentence = text.slice(cursor, end).trim()
    if (sentence.replace(/[\s.!?؟…،,:-]/g, '').length > 1) sentences.push(sentence)
    cursor = end
  }
  if (final) {
    const rest = text.slice(cursor).trim()
    if (rest.replace(/[\s.!?؟…،,:-]/g, '').length > 1) sentences.push(rest)
    cursor = text.length
  }
  return { sentences: sentences.flatMap(splitLong), next: cursor }
}

/** Chrome cuts utterances longer than ~15 s: long sentences are split at commas / spaces (~180 characters). */
function splitLong(sentence: string): string[] {
  if (sentence.length <= 180) return [sentence]
  const parts: string[] = []
  let rest = sentence
  while (rest.length > 180) {
    const window = rest.slice(0, 180)
    const cut = Math.max(window.lastIndexOf('،'), window.lastIndexOf(','), window.lastIndexOf(' '))
    const at = cut > 60 ? cut + 1 : 180
    parts.push(rest.slice(0, at).trim())
    rest = rest.slice(at)
  }
  if (rest.trim()) parts.push(rest.trim())
  return parts
}

/** Voice answers are short; a long fallback answer is cut to its first sentences and the rest stays on screen. */
export function voiceSummary(sentences: string[], maxChars = 420) {
  const kept: string[] = []
  let total = 0
  for (const sentence of sentences) {
    if (kept.length && total + sentence.length > maxChars) return { sentences: kept, truncated: true }
    kept.push(sentence)
    total += sentence.length
  }
  return { sentences: kept, truncated: false }
}

export type VoiceLike = { name: string; lang: string; localService?: boolean; default?: boolean }

/**
 * Best Arabic system voice: Arabic first (Iraqi, then Gulf/Saudi and Egyptian, then any Arabic), neural / natural /
 * online / premium voices before compact ones. Returns null when the device has no Arabic voice.
 */
export function pickArabicVoice<T extends VoiceLike>(voices: readonly T[]): T | null {
  const arabic = voices.filter(voice => /^ar([-_]|$)/i.test(voice.lang))
  if (!arabic.length) return null
  const score = (voice: T) => {
    const lang = voice.lang.toLowerCase().replace('_', '-')
    const name = voice.name.toLowerCase()
    let points = 0
    if (lang === 'ar-iq') points += 40
    else if (lang === 'ar-sa') points += 34
    else if (lang === 'ar-eg') points += 30
    else if (/ar-(ae|kw|bh|qa|om|jo)/.test(lang)) points += 26
    else if (lang === 'ar-001' || lang === 'ar') points += 22
    else points += 12
    if (/neural|natural|online|premium|enhanced|wavenet|studio/.test(name)) points += 30
    if (/google/.test(name)) points += 14
    if (/microsoft/.test(name)) points += 10
    if (/(maged|tarik|laila|mariam|majed|hamed|zariyah|salma|shakir|bassel|rana)/.test(name)) points += 6
    if (/compact|eloquence/.test(name)) points -= 20
    if (voice.localService === false) points += 4
    return points
  }
  return [...arabic].sort((a, b) => score(b) - score(a))[0]
}

/** Root-mean-square energy of one analyser frame (byte time-domain samples, 128 = silence) → 0..1. */
export function frameEnergy(samples: ArrayLike<number>) {
  let sum = 0
  for (let index = 0; index < samples.length; index++) {
    const value = (samples[index] - 128) / 128
    sum += value * value
  }
  return samples.length ? Math.sqrt(sum / samples.length) : 0
}

/**
 * Energy voice-activity detector: learns the room's noise floor, marks speech when the energy stays above
 * max(0.02, floor × 2.6) for 150 ms, and reports «silence» after `silenceMs` (default 1.2 s) of quiet that follows
 * speech, or `noSpeechMs` without any speech at all.
 */
export function createVad(options: { silenceMs?: number; noSpeechMs?: number } = {}) {
  const silenceMs = options.silenceMs ?? 1200
  const noSpeechMs = options.noSpeechMs ?? 8000
  let floor = 0.012
  let started = -1
  let aboveSince = -1
  let lastLoud = -1
  let heard = false
  return {
    /** Feeds one frame (energy 0..1 at time `now` ms). */
    push(energy: number, now: number): 'speech' | 'silence' | 'no-speech' | 'quiet' {
      if (started < 0) started = now
      const threshold = Math.max(0.02, floor * 2.6)
      if (energy > threshold) {
        if (aboveSince < 0) aboveSince = now
        if (now - aboveSince >= 150) heard = true
        lastLoud = now
        return heard ? 'speech' : 'quiet'
      }
      aboveSince = -1
      // the floor follows the quiet frames slowly (a fan, a street)
      floor = floor * 0.97 + Math.min(energy, 0.08) * 0.03
      if (heard && now - lastLoud >= silenceMs) return 'silence'
      if (!heard && now - started >= noSpeechMs) return 'no-speech'
      return 'quiet'
    },
    get heard() {
      return heard
    },
    /** A recogniser result also counts as speech (no meter on some phones). */
    markSpeech(now: number) {
      heard = true
      lastLoud = now
    },
  }
}

/** Level 0..1 for the orb from a frame energy (speech RMS is small: ~0.02–0.3). */
export const levelFromEnergy = (energy: number) => Math.max(0, Math.min(1, (energy - 0.01) * 4.2))
