import { fetchServerSpeech } from '../assistant-client'
import { pickArabicVoice, speakableText, takeSentences } from './speech-text'

/**
 * أفندي's mouth: reads the answer aloud while it streams. The markdown answer is cut into complete sentences as they
 * arrive (speaking starts once the first sentence is complete), each sentence is stripped of markdown/links and
 * queued. Default engine: the browser's speechSynthesis with the best Arabic voice. Optional engine: the server voice
 * (/api/assistant/speak) when the deployment enables it — one shared audio element unlocked by the press that opened
 * voice mode (iOS), and the browser voice reads any sentence the server voice could not (rate limit, network,
 * playback refused), so أفندي never goes silent. The final action link is never read (it is a button).
 *
 * A device without an Arabic voice (common on Windows Chrome: its voices are English / European) is never made to
 * read Arabic with a wrong-language voice — that reads gibberish or nothing at all. There the answer stays text only,
 * and the voice stage says so (arabic-voice.ts → «جهازك ما بيه صوت عربي؛ الأجوبة تظهر كتابة»).
 */
export type SpeakerHandlers = {
  /** a sentence starts playing (the orb plays its envelope) */
  onSentence?: (text: string) => void
  /** speaking started (first sentence) */
  onStart?: () => void
  /** the queue drained after finish(), or stop() was called */
  onEnd?: (reason: 'done' | 'stopped') => void
}

export type Speaker = {
  /** the answer so far (markdown) */
  feed: (markdown: string) => void
  /** the answer is complete: speak what is left, then onEnd('done') */
  finish: (markdown: string, extra?: string) => void
  /**
   * the streamed text was retracted (a note before tools, a refusal): drop the queue, abort its server voices and
   * start over — the answer that follows is a new start (onStart fires again)
   */
  reset: () => void
  /** stop now (barge-in / skip / close) */
  stop: () => void
  readonly speaking: boolean
}

/** Spoken answers stay short; past this the rest is left on screen. */
const MAX_SPOKEN_CHARS = 420
const LINK_ONLY = /^\[[^\]\n]+\]\([^)\s]+\)[.。]?$/

/** the voice picked for the voice list as it was (a list that changes — voices load late — is looked at again) */
let cachedVoice: { count: number; voice: SpeechSynthesisVoice | null } | null = null

export function browserTtsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function'
}

/** The Arabic voice to use (undefined: the list is not loaded yet; null: the device has none). */
export function arabicVoice(): SpeechSynthesisVoice | null | undefined {
  if (!browserTtsSupported()) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return undefined
  if (!cachedVoice || cachedVoice.count !== voices.length || (cachedVoice.voice && !voices.includes(cachedVoice.voice)))
    cachedVoice = { count: voices.length, voice: pickArabicVoice(voices) }
  return cachedVoice.voice
}

/** Loads the voice list early (Chrome fills it asynchronously). */
export function warmVoices() {
  if (!browserTtsSupported()) return
  window.speechSynthesis.getVoices()
  window.speechSynthesis.addEventListener?.('voiceschanged', () => {
    cachedVoice = null
    arabicVoice()
  })
}

// ---- the optional server voice: one element, unlocked inside a press ---------------------------------------------
let sharedAudio: HTMLAudioElement | null = null
let silentUrl: string | null = null

/** 0.1 s of silence (8 kHz, 8-bit wav) played by the unlocking press. */
function silentClip() {
  if (silentUrl) return silentUrl
  const samples = 800
  const bytes = new Uint8Array(44 + samples)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) bytes[offset + index] = text.charCodeAt(index)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true)
  view.setUint32(28, 8000, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  ascii(36, 'data')
  view.setUint32(40, samples, true)
  bytes.fill(128, 44)
  silentUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
  return silentUrl
}

const audioElement = () => (sharedAudio ??= new Audio())

/**
 * Call inside a user gesture (the press that opens voice mode). iOS Safari only lets an audio element play later,
 * outside a gesture, once it has played inside one — so the server voice reuses this one element for every sentence.
 */
export function unlockServerAudio() {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return
  try {
    const element = audioElement()
    element.src = silentClip()
    void element.play()?.catch(() => undefined)
  } catch {
    /* no audio element here: the browser voice is used */
  }
}

export function createSpeaker(options: { serverTts: boolean; handlers: SpeakerHandlers }): Speaker {
  const { handlers } = options
  let consumed = 0
  let spokenChars = 0
  let truncated = false
  let finished = false
  let stopped = false
  let started = false
  let pending = 0
  let generation = 0
  /** the server voice failed once for this answer: the rest is read by the browser voice */
  let serverFailed = false
  let serverChain: Promise<void> = Promise.resolve()
  /** aborts the server voices of the current generation (a skipped / retracted sentence is not synthesised) */
  let fetches = new AbortController()
  /** ends the sentence playing now (a paused element never fires 'ended', which would block the chain) */
  let endCurrent: (() => void) | null = null

  const maybeEnd = () => {
    if (finished && pending === 0 && !stopped) {
      stopped = true
      handlers.onEnd?.('done')
    }
  }

  const begin = () => {
    if (started) return
    started = true
    handlers.onStart?.()
  }

  const utteranceFor = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text)
    const voice = arabicVoice()
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang
    } else utterance.lang = 'ar-SA'
    utterance.rate = 1
    utterance.pitch = 0.95
    return utterance
  }

  const sayNow = (utterance: SpeechSynthesisUtterance) => {
    window.speechSynthesis.speak(utterance)
    // Chrome sometimes stays paused after a cancel()
    if (window.speechSynthesis.paused) window.speechSynthesis.resume()
  }

  const speakBrowser = (text: string, mine: number) => {
    const utterance = utteranceFor(text)
    pending++
    utterance.onstart = () => {
      if (mine !== generation) return
      begin()
      handlers.onSentence?.(text)
    }
    const done = () => {
      if (mine !== generation) return
      pending = Math.max(0, pending - 1)
      maybeEnd()
    }
    utterance.onend = done
    utterance.onerror = done
    sayNow(utterance)
  }

  /** One sentence through the browser voice, as a step of the server chain (its fallback). */
  const sayWithBrowser = (text: string, mine: number) =>
    new Promise<void>(resolve => {
      // no Arabic voice on this device: the sentence stays on screen (never read by a wrong-language voice)
      if (!browserTtsSupported() || arabicVoice() === null) return resolve()
      const utterance = utteranceFor(text)
      const done = () => {
        if (endCurrent === done) endCurrent = null
        resolve()
      }
      endCurrent = done
      utterance.onstart = () => {
        if (mine !== generation) return
        begin()
        handlers.onSentence?.(text)
      }
      utterance.onend = done
      utterance.onerror = done
      sayNow(utterance)
    })

  /** Plays one server clip on the shared element; false when the browser refused to play it. */
  const playClip = (blob: Blob, text: string, mine: number) =>
    new Promise<boolean>(resolve => {
      const url = URL.createObjectURL(blob)
      const element = audioElement()
      let settled = false
      const done = (played: boolean) => {
        if (settled) return
        settled = true
        element.onplay = null
        element.onended = null
        element.onerror = null
        URL.revokeObjectURL(url)
        if (endCurrent === interrupt) endCurrent = null
        resolve(played)
      }
      const interrupt = () => {
        element.pause()
        done(true)
      }
      endCurrent = interrupt
      element.onplay = () => {
        if (mine !== generation) return
        begin()
        handlers.onSentence?.(text)
      }
      element.onended = () => done(true)
      element.onerror = () => done(false)
      element.src = url
      const playing = element.play()
      if (playing) playing.catch(() => done(false))
    })

  const speakServer = (text: string, mine: number) => {
    pending++
    const blobPromise = serverFailed ? Promise.resolve(null) : fetchServerSpeech(text, fetches.signal).catch(() => null)
    serverChain = serverChain.then(async () => {
      const blob = await blobPromise
      if (mine !== generation || stopped) return
      const played = blob ? await playClip(blob, text, mine) : false
      if (played || mine !== generation || stopped) return
      // rate limit, network or playback refused (iOS): the browser voice reads it — never silence
      serverFailed = true
      await sayWithBrowser(text, mine)
    })
    void serverChain.finally(() => {
      if (mine !== generation) return
      pending = Math.max(0, pending - 1)
      maybeEnd()
    })
  }

  const enqueue = (raw: string) => {
    if (stopped || truncated) return
    if (LINK_ONLY.test(raw.trim())) return
    const text = speakableText(raw)
    if (text.replace(/[\s.!?؟…،,:-]/g, '').length < 2) return
    // a label alone on its line («الخطوات:») is a heading for the eye, not something to say
    if (/^[^.!?؟\n]{1,24}:$/.test(text)) return
    if (spokenChars && spokenChars + text.length > MAX_SPOKEN_CHARS) {
      truncated = true
      return
    }
    spokenChars += text.length
    if (options.serverTts) speakServer(text, generation)
    // no Arabic voice on this device: nothing is read (the answer is on screen); an unloaded list still tries —
    // the browser then picks a voice for lang="ar"
    else if (browserTtsSupported() && arabicVoice() !== null) speakBrowser(text, generation)
  }

  const cancelPlayback = () => {
    generation++
    pending = 0
    fetches.abort()
    fetches = new AbortController()
    serverChain = Promise.resolve()
    if (browserTtsSupported()) window.speechSynthesis.cancel()
    const end = endCurrent
    endCurrent = null
    end?.()
  }

  return {
    feed(markdown) {
      if (stopped || finished) return
      const { sentences, next } = takeSentences(markdown, consumed)
      consumed = next
      sentences.forEach(enqueue)
    },
    finish(markdown, extra) {
      if (stopped || finished) return
      const { sentences } = takeSentences(markdown, Math.min(consumed, markdown.length), true)
      sentences.forEach(enqueue)
      if (extra) {
        const wasTruncated = truncated
        truncated = false
        spokenChars = 0
        enqueue(extra)
        truncated = wasTruncated
      }
      if (truncated) {
        truncated = false
        spokenChars = 0
        enqueue('باقي التفاصيل مكتوبة على الشاشة.')
      }
      finished = true
      maybeEnd()
    },
    reset() {
      if (stopped) return
      cancelPlayback()
      consumed = 0
      spokenChars = 0
      truncated = false
      // nothing of the retracted text was the answer: what follows starts afresh (onStart → «speaking» again)
      started = false
    },
    stop() {
      if (stopped) return
      stopped = true
      cancelPlayback()
      handlers.onEnd?.('stopped')
    },
    get speaking() {
      return started && !stopped
    },
  }
}
