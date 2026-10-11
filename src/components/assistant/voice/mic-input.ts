import { transcribeAudio, VoiceRequestError } from '../assistant-client'
import { createVad, frameEnergy, levelFromEnergy } from './speech-text'

/**
 * أفندي's ears. Two engines behind one session API:
 * - `speech`: the browser's SpeechRecognition (Chrome, Edge, Android, iOS Safari 14.5+) — live partial transcript,
 *   lang ar-IQ → ar-SA → ar. The audio goes to the browser vendor's recogniser, never to our server.
 * - `recorder`: MediaRecorder (Firefox, browsers without recognition) — one clip (≤ 60 s) posted once to
 *   /api/assistant/transcribe; works only when the server has a speech provider (else 501 → «اكتب سؤالك»).
 * A Web Audio AnalyserNode drives the orb level and an energy VAD (auto-stop after 1.2 s of silence). On Android the
 * recogniser owns the microphone, so the level is synthesised from recognition events instead of a second capture.
 * The microphone is open only while a session runs; every track is stopped when it ends.
 */
export type VoiceEngine = 'speech' | 'recorder' | 'none'
export type VoiceErrorCode = 'denied' | 'no-mic' | 'no-speech' | 'network' | 'unsupported' | 'failed'

export const VOICE_ERRORS: Record<VoiceErrorCode, string> = {
  denied: 'الميكروفون غير مسموح. اسمح له من إعدادات المتصفح (رمز القفل جنب العنوان)، أو اكتب سؤالك.',
  'no-mic': 'ما لقيت ميكروفون شغال بهذا الجهاز. تكدر تكتب سؤالك.',
  'no-speech': 'ما سمعت شي. اضغط على المايك وتكلّم.',
  network: 'انقطع الاتصال بخدمة تحويل الكلام. جرّب مرة ثانية أو اكتب سؤالك.',
  unsupported: 'الكتابة متاحة؛ الصوت غير مدعوم في هذا المتصفح.',
  failed: 'صار خلل بالصوت. جرّب مرة ثانية أو اكتب سؤالك.',
}

export type ListenHandlers = {
  /** recognition / recording really started (microphone open) */
  onStart?: () => void
  /** 0..1 voice level for the orb, many times a second */
  onLevel?: (level: number) => void
  /** live partial transcript (speech engine only) */
  onPartial?: (text: string) => void
  /** recorder engine: the clip is being transcribed on the server */
  onTranscribing?: () => void
  /** the final transcript ('' = nothing understood) */
  onFinal: (text: string) => void
  onError: (code: VoiceErrorCode, message: string) => void
}

export type ListenSession = {
  readonly engine: Exclude<VoiceEngine, 'none'>
  /** stop listening and deliver what was heard */
  stop: () => void
  /** stop and drop everything (no onFinal) */
  cancel: () => void
}

type RecognitionResultList = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: { resultIndex?: number; results: RecognitionResultList }) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  onstart: (() => void) | null
  onspeechstart: (() => void) | null
}

export const MAX_LISTEN_MS = 60_000
const LANGS = ['ar-IQ', 'ar-SA', 'ar']

export function speechRecognitionConstructor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return scope.SpeechRecognition || scope.webkitSpeechRecognition || null
}

const hasMediaDevices = () =>
  typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof window !== 'undefined'

export const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
const isIos = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1))

/** Best recorder format: webm/opus (Chrome, Firefox, Android) or mp4/aac (iOS Safari). */
export function recorderMimeType() {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') return null
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac']
  return candidates.find(type => MediaRecorder.isTypeSupported?.(type)) ?? ''
}

/** Which engine this browser can use (`transcribe`: the server has a speech provider for the recorder path). */
export function voiceEngine(transcribe: boolean): VoiceEngine {
  if (speechRecognitionConstructor()) return 'speech'
  if (transcribe && hasMediaDevices() && recorderMimeType() !== null) return 'recorder'
  return 'none'
}

/** Mic level meter + VAD on a MediaStream (Web Audio AnalyserNode). */
function meter(stream: MediaStream, onFrame: (energy: number, now: number) => void) {
  const Context =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Context) return () => undefined
  const context = new Context()
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.2
  source.connect(analyser)
  const frame = new Uint8Array(analyser.fftSize)
  let raf = 0
  let timer = 0
  const tick = () => {
    analyser.getByteTimeDomainData(frame)
    onFrame(frameEnergy(frame), performance.now())
  }
  // rAF while visible; a timer keeps the VAD alive if the tab is hidden mid-sentence
  const loop = () => {
    tick()
    raf = window.requestAnimationFrame(loop)
  }
  raf = window.requestAnimationFrame(loop)
  timer = window.setInterval(() => document.visibilityState === 'hidden' && tick(), 100)
  void context.resume?.().catch(() => undefined)
  return () => {
    window.cancelAnimationFrame(raf)
    window.clearInterval(timer)
    try {
      source.disconnect()
    } catch {
      /* already disconnected */
    }
    void context.close().catch(() => undefined)
  }
}

const stopTracks = (stream: MediaStream | null) => stream?.getTracks().forEach(track => track.stop())

function micErrorCode(error: unknown): VoiceErrorCode {
  const name = (error as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied'
  if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') return 'no-mic'
  return 'failed'
}

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
}

/**
 * Starts one listening session. `autoStop`: stop by itself after 1.2 s of silence following speech (tap mode);
 * a press-and-hold session stops on release instead.
 */
export async function startListening(options: {
  engine: Exclude<VoiceEngine, 'none'>
  /** read on every frame: a press-and-hold turns it off while the finger is down */
  autoStop: () => boolean
  handlers: ListenHandlers
}): Promise<ListenSession> {
  return options.engine === 'speech' ? listenWithRecognition(options) : listenWithRecorder(options)
}

async function listenWithRecognition({
  autoStop,
  handlers,
}: {
  autoStop: () => boolean
  handlers: ListenHandlers
}): Promise<ListenSession> {
  const Recognition = speechRecognitionConstructor()
  if (!Recognition) throw new Error('unsupported')
  let finished = false
  let cancelled = false
  let transcript = ''
  let stream: MediaStream | null = null
  let stopMeter: () => void = () => undefined
  let langIndex = 0
  let recognition: SpeechRecognitionLike | null = null
  const vad = createVad({ silenceMs: 1200, noSpeechMs: 9000 })
  let synthetic = 0
  let syntheticTimer = 0
  let lastResult = performance.now()
  const maxTimer = window.setTimeout(() => stop(), MAX_LISTEN_MS)

  const cleanup = () => {
    window.clearTimeout(maxTimer)
    window.clearInterval(syntheticTimer)
    stopMeter()
    stopTracks(stream)
    stream = null
    handlers.onLevel?.(0)
  }
  const finish = () => {
    if (finished) return
    finished = true
    cleanup()
    if (!cancelled) handlers.onFinal(transcript.trim())
  }
  const fail = (code: VoiceErrorCode) => {
    if (finished) return
    finished = true
    try {
      recognition?.abort()
    } catch {
      /* not started */
    }
    cleanup()
    if (!cancelled) handlers.onError(code, VOICE_ERRORS[code])
  }
  function stop() {
    if (finished) return
    try {
      recognition?.stop()
    } catch {
      finish()
    }
    // some engines never fire onend after stop(): deliver anyway
    window.setTimeout(finish, 1500)
  }

  // Desktop / iOS: a parallel capture drives the orb and the VAD. Android: the recogniser owns the microphone.
  if (!isAndroid() && hasMediaDevices()) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
      stopMeter = meter(stream, (energy, now) => {
        if (finished) return
        handlers.onLevel?.(levelFromEnergy(energy))
        const state = vad.push(energy, now)
        if (autoStop() && (state === 'silence' || state === 'no-speech')) stop()
      })
    } catch (error) {
      const code = micErrorCode(error)
      if (code === 'denied' || code === 'no-mic') {
        fail(code)
        return { engine: 'speech', stop: () => undefined, cancel: () => undefined }
      }
      // no meter: recognition still works, the level is synthesised
    }
  }
  if (!stream) {
    syntheticTimer = window.setInterval(() => {
      synthetic *= 0.8
      handlers.onLevel?.(synthetic)
      const now = performance.now()
      if (autoStop() && vad.heard && now - lastResult >= 1200) stop()
    }, 60)
  }

  const begin = () => {
    const instance = new Recognition()
    recognition = instance
    instance.lang = LANGS[langIndex]
    instance.interimResults = true
    instance.continuous = !isIos()
    instance.maxAlternatives = 1
    instance.onstart = () => handlers.onStart?.()
    instance.onspeechstart = () => vad.markSpeech(performance.now())
    instance.onresult = event => {
      const parts: string[] = []
      for (let index = 0; index < event.results.length; index++) parts.push(event.results[index][0]?.transcript || '')
      transcript = parts.join(' ').replace(/\s+/g, ' ').slice(0, 2000)
      lastResult = performance.now()
      vad.markSpeech(lastResult)
      synthetic = Math.min(1, 0.55 + Math.random() * 0.4)
      handlers.onPartial?.(transcript.trim())
    }
    instance.onerror = event => {
      if (event.error === 'language-not-supported' && langIndex < LANGS.length - 1) {
        langIndex++
        instance.onend = null
        begin()
        return
      }
      if (event.error === 'aborted') return
      if (event.error === 'no-speech') return finish()
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') return fail('denied')
      if (event.error === 'audio-capture') return fail('no-mic')
      if (event.error === 'network') return fail('network')
      fail('failed')
    }
    instance.onend = () => finish()
    try {
      instance.start()
    } catch {
      fail('failed')
    }
  }
  begin()

  return {
    engine: 'speech',
    stop,
    cancel: () => {
      cancelled = true
      try {
        recognition?.abort()
      } catch {
        /* not started */
      }
      finish()
    },
  }
}

async function listenWithRecorder({
  autoStop,
  handlers,
}: {
  autoStop: () => boolean
  handlers: ListenHandlers
}): Promise<ListenSession> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
  } catch (error) {
    const code = micErrorCode(error)
    handlers.onError(code, VOICE_ERRORS[code])
    return { engine: 'recorder', stop: () => undefined, cancel: () => undefined }
  }
  const mimeType = recorderMimeType() || undefined
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : undefined)
  const chunks: Blob[] = []
  const vad = createVad({ silenceMs: 1200, noSpeechMs: 9000 })
  let cancelled = false
  let done = false
  const startedAt = performance.now()
  const controller = new AbortController()
  const stopMeter = meter(stream, (energy, now) => {
    if (done) return
    handlers.onLevel?.(levelFromEnergy(energy))
    const state = vad.push(energy, now)
    if (autoStop() && (state === 'silence' || state === 'no-speech')) stop()
  })
  const maxTimer = window.setTimeout(() => stop(), MAX_LISTEN_MS)
  const release = () => {
    window.clearTimeout(maxTimer)
    stopMeter()
    stopTracks(stream)
    handlers.onLevel?.(0)
  }
  recorder.ondataavailable = event => {
    if (event.data?.size) chunks.push(event.data)
  }
  recorder.onstop = async () => {
    release()
    if (cancelled) return
    const durationMs = performance.now() - startedAt
    if (!vad.heard || !chunks.length) return handlers.onFinal('')
    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' })
    chunks.length = 0
    handlers.onTranscribing?.()
    try {
      handlers.onFinal(await transcribeAudio(blob, Math.min(durationMs, MAX_LISTEN_MS), controller.signal))
    } catch (error) {
      if (cancelled) return
      if (error instanceof VoiceRequestError && error.status === 501) handlers.onError('unsupported', error.message)
      else if (error instanceof VoiceRequestError) handlers.onError('failed', error.message)
      else handlers.onError('network', VOICE_ERRORS.network)
    }
  }
  recorder.onerror = () => {
    if (done) return
    done = true
    release()
    if (!cancelled) handlers.onError('failed', VOICE_ERRORS.failed)
  }
  function stop() {
    if (done) return
    done = true
    try {
      recorder.stop()
    } catch {
      release()
    }
  }
  recorder.start(250)
  handlers.onStart?.()
  return {
    engine: 'recorder',
    stop,
    cancel: () => {
      cancelled = true
      controller.abort()
      stop()
    },
  }
}

/**
 * Barge-in while أفندي speaks (continuous conversation, desktop / iOS): a quiet capture with echo cancellation that
 * calls `onSpeech` when the citizen clearly starts talking (louder than the room for 250 ms). Returns a stop function.
 */
export async function watchForBargeIn(onSpeech: () => void): Promise<() => void> {
  if (isAndroid() || !hasMediaDevices()) return () => undefined
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
  } catch {
    return () => undefined
  }
  let floor = 0.015
  let loudSince = -1
  let fired = false
  const startedAt = performance.now()
  const stopMeter = meter(stream, (energy, now) => {
    if (fired) return
    // ignore the first 400 ms (the speaker starting) and learn the room
    if (now - startedAt < 400) {
      floor = Math.max(floor, energy)
      return
    }
    const threshold = Math.max(0.07, floor * 3.2)
    if (energy > threshold) {
      if (loudSince < 0) loudSince = now
      if (now - loudSince >= 250) {
        fired = true
        onSpeech()
      }
    } else {
      loudSince = -1
      floor = floor * 0.98 + Math.min(energy, 0.06) * 0.02
    }
  })
  return () => {
    stopMeter()
    stopTracks(stream)
  }
}
