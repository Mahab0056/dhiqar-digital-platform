import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { splitAction } from '../assistant-reducer'
import type { AssistantChannel, AssistantEvent, AssistantUiPayload } from '../assistant-client'
import {
  startListening,
  voiceEngine,
  VOICE_ERRORS,
  watchForBargeIn,
  type ListenSession,
  type VoiceEngine,
} from './mic-input'
import { answerVoice, useArabicSpeech } from './arabic-voice'
import { browserTtsSupported, createSpeaker, warmVoices, type Speaker } from './speaker'

/**
 * The voice conversation loop of أفندي: listen → transcribe → answer (streamed and spoken) → listen again (when
 * «محادثة متواصلة» is on). Barge-in: pressing the mic — or, in a continuous conversation on desktop, simply starting
 * to talk — stops the voice. The first use shows a short privacy sheet; the microphone is open only while listening
 * (and, in a continuous conversation, while أفندي speaks, to hear a barge-in).
 *
 * Every spoken question is a numbered turn: the panel tags each reply's events with the turn that asked it, and only
 * the current turn is read aloud. A reply that was talked over (barge-in), skipped or replaced by a newer question is
 * ignored to its end — its late «done» can no longer end the newer turn.
 */
export type VoicePhase = 'idle' | 'consent' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error'

const CONSENT_KEY = 'dqa-voice-consent'
const CONTINUOUS_KEY = 'dqa-voice-continuous'
/** a press longer than this is press-and-hold (stops on release); shorter is a tap (stops on silence) */
const HOLD_MS = 380

const readFlag = (key: string, fallback: boolean) => {
  try {
    const value = window.localStorage.getItem(key)
    return value === null ? fallback : value === '1'
  } catch {
    return fallback
  }
}
const writeFlag = (key: string, value: boolean) => {
  try {
    window.localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* storage blocked: lasts for this page */
  }
}

/** Options a clarifying question offers, as one spoken sentence («مثلاً: أول مرة، أو تجديد.»). */
export function spokenOptions(options: string[]) {
  if (options.length < 2) return ''
  return `مثلاً: ${options.slice(0, -1).join('، ')}، أو ${options[options.length - 1]}.`
}

/** How a voice reply ended (the panel passes the turn its send() was given). */
export type VoiceReplyResult = { text: string; ui: AssistantUiPayload[]; failed: boolean; turn: number }

export function useVoiceConversation(options: {
  active: boolean
  transcribe: boolean
  serverTts: boolean
  muted: boolean
  /**
   * sends the citizen's words (the panel's normal send); `turn` must come back with every onReplyEvent /
   * onReplyDone of that reply
   */
  send: (text: string, channel: AssistantChannel, turn: number) => Promise<void>
  /** aborts the reply being streamed */
  abort: () => void
  onLevel: (level: number) => void
  onSentence: (text: string) => void
}) {
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [partial, setPartial] = useState('')
  const [message, setMessage] = useState('')
  const [continuous, setContinuousState] = useState(() => readFlag(CONTINUOUS_KEY, true))
  // 'none' once the server said it has no speech provider (501) — else what this browser supports
  const [engineOff, setEngine] = useState<VoiceEngine | null>(null)
  const engine: VoiceEngine = engineOff ?? voiceEngine(options.transcribe)
  // no Arabic voice here (and no server voice): answers are not read aloud with a wrong-language voice — they stay
  // text, and the stage says so
  const arabic = useArabicSpeech(options.active, browserTtsSupported())
  const output = answerVoice({ serverTts: options.serverTts, arabic })
  const outputRef = useRef(output)
  const sessionRef = useRef<ListenSession | null>(null)
  const speakerRef = useRef<Speaker | null>(null)
  const bargeRef = useRef<(() => void) | null>(null)
  const holdingRef = useRef(false)
  const pressAtRef = useRef(0)
  const pendingStartRef = useRef(false)
  /** last turn number handed out */
  const turnSeqRef = useRef(0)
  /** the turn whose reply is read aloud (0: none — a barge-in, skip, mute or leaving voice mode drops it) */
  const turnRef = useRef(0)
  /** read by the speaker's handlers, which live for a whole answer (a closure would keep a stale value) */
  const continuousRef = useRef(continuous)
  const phaseRef = useRef<VoicePhase>('idle')
  /** the newest listen / afterTurn, for handlers created earlier (the speaker lives for a whole answer) */
  const latest = useRef<{ listen: () => Promise<void>; afterTurn: () => void } | null>(null)
  const activeRef = useRef(options.active)
  const opts = useRef(options)
  useLayoutEffect(() => {
    opts.current = options
    activeRef.current = options.active
    outputRef.current = output
  })

  const go = useCallback((next: VoicePhase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  useEffect(() => warmVoices(), [])

  const stopBargeIn = () => {
    bargeRef.current?.()
    bargeRef.current = null
  }

  const stopSpeaking = useCallback(() => {
    stopBargeIn()
    speakerRef.current?.stop()
    speakerRef.current = null
  }, [])

  const cancelListening = () => {
    sessionRef.current?.cancel()
    sessionRef.current = null
  }

  /** A new spoken question: it becomes the only reply read aloud. */
  const ask = useCallback(
    (text: string) => {
      const turn = ++turnSeqRef.current
      turnRef.current = turn
      setPartial(text)
      go('thinking')
      void opts.current.send(text, 'voice', turn)
    },
    [go]
  )

  const listen = useCallback(async () => {
    if (!activeRef.current) return
    // barge-in: the answer being read is dropped (its text stays on screen)
    turnRef.current = 0
    stopSpeaking()
    cancelListening()
    if (engine === 'none') {
      setMessage(VOICE_ERRORS.unsupported)
      go('error')
      return
    }
    if (!readFlag(CONSENT_KEY, false)) {
      pendingStartRef.current = true
      go('consent')
      return
    }
    setPartial('')
    setMessage('')
    go('listening')
    const session = await startListening({
      engine,
      autoStop: () => !holdingRef.current,
      handlers: {
        onLevel: level => opts.current.onLevel(level),
        onPartial: text => setPartial(text),
        onTranscribing: () => go('transcribing'),
        onFinal: text => {
          sessionRef.current = null
          opts.current.onLevel(0)
          if (!activeRef.current) return
          if (!text) {
            setMessage(VOICE_ERRORS['no-speech'])
            go('idle')
            return
          }
          ask(text)
        },
        onError: (code, text) => {
          sessionRef.current = null
          opts.current.onLevel(0)
          if (code === 'unsupported') setEngine('none')
          setMessage(text)
          go('error')
        },
      },
    })
    if (phaseRef.current === 'listening' || phaseRef.current === 'transcribing') sessionRef.current = session
    else session.cancel()
  }, [engine, go, stopSpeaking, ask])

  /** After an answer: listen again in a continuous conversation, else wait. */
  const afterTurn = useCallback(() => {
    stopBargeIn()
    speakerRef.current = null
    if (!activeRef.current) return
    const again = continuousRef.current && phaseRef.current !== 'error'
    go('idle')
    if (!again) return
    window.setTimeout(() => {
      // read again: the citizen may have switched the continuous conversation off in the meantime
      if (activeRef.current && continuousRef.current && phaseRef.current === 'idle') void latest.current?.listen()
    }, 350)
  }, [go])

  useLayoutEffect(() => {
    latest.current = { listen, afterTurn }
  })

  // ---- the mic button: tap = toggle (stops on silence), press-and-hold = talk while pressed --------------------
  const pressStart = useCallback(() => {
    pressAtRef.current = performance.now()
    const current = phaseRef.current
    if (current === 'listening') {
      sessionRef.current?.stop()
      return
    }
    if (current === 'transcribing') return
    if (current === 'thinking') opts.current.abort()
    holdingRef.current = false
    window.setTimeout(() => {
      // still pressed after HOLD_MS: press-and-hold (the VAD waits for the release)
      if (pressAtRef.current && phaseRef.current === 'listening') holdingRef.current = true
    }, HOLD_MS)
    void listen()
  }, [listen])

  const pressEnd = useCallback(() => {
    const held = holdingRef.current
    pressAtRef.current = 0
    holdingRef.current = false
    if (held && phaseRef.current === 'listening') sessionRef.current?.stop()
  }, [])

  /** Keyboard / shortcut: one toggle. */
  const toggle = useCallback(() => {
    if (phaseRef.current === 'listening') sessionRef.current?.stop()
    else {
      holdingRef.current = false
      void listen()
    }
  }, [listen])

  const acceptConsent = useCallback(() => {
    writeFlag(CONSENT_KEY, true)
    go('idle')
    if (pendingStartRef.current) {
      pendingStartRef.current = false
      void listen()
    }
  }, [go, listen])

  const declineConsent = useCallback(() => {
    pendingStartRef.current = false
    go('idle')
  }, [go])

  const setContinuous = useCallback((value: boolean) => {
    writeFlag(CONTINUOUS_KEY, value)
    continuousRef.current = value
    setContinuousState(value)
    // switched off while أفندي speaks: the barge-in microphone closes now, and no re-listen follows this answer
    if (!value) stopBargeIn()
  }, [])

  // ---- the answer: spoken while it streams -----------------------------------------------------------------
  const ensureSpeaker = () => {
    if (speakerRef.current) return speakerRef.current
    const speaker = createSpeaker({
      serverTts: opts.current.serverTts,
      handlers: {
        onStart: () => {
          if (!activeRef.current || speakerRef.current !== speaker) return
          go('speaking')
          if (continuousRef.current && !bargeRef.current)
            void watchForBargeIn(() => {
              if (phaseRef.current !== 'speaking') return
              void latest.current?.listen()
            }).then(stop => {
              const wanted =
                phaseRef.current === 'speaking' &&
                speakerRef.current === speaker &&
                continuousRef.current &&
                !bargeRef.current
              if (wanted) bargeRef.current = stop
              else stop()
            })
        },
        onSentence: text => opts.current.onSentence(text),
        onEnd: reason => {
          if (speakerRef.current !== speaker) return
          if (reason === 'done') latest.current?.afterTurn()
        },
      },
    })
    speakerRef.current = speaker
    return speaker
  }

  const canSpeak = () =>
    !opts.current.muted &&
    (outputRef.current === 'server' || (outputRef.current === 'browser' && browserTtsSupported()))

  /** Every SSE event of a reply that started from voice (text so far after the event). */
  const onReplyEvent = (event: AssistantEvent, text: string, turn: number) => {
    if (!turn || turn !== turnRef.current || !activeRef.current || !canSpeak()) return
    if (event.type === 'interim' || event.type === 'reset') {
      // what was read so far was a note before tools (or a refusal cut it off), not the answer: silence, close the
      // barge-in microphone and wait for the real answer (it starts «speaking» again)
      stopBargeIn()
      speakerRef.current?.reset()
      if (phaseRef.current === 'speaking') go('thinking')
    } else if (event.type === 'text') ensureSpeaker().feed(text)
  }

  /** The reply finished (or failed / was stopped). */
  const onReplyDone = (result: VoiceReplyResult) => {
    // a reply that was talked over, skipped or replaced: its end belongs to no current turn
    if (!result.turn || result.turn !== turnRef.current) return
    turnRef.current = 0
    if (!activeRef.current || phaseRef.current === 'listening') return
    if (result.failed || !result.text) {
      stopSpeaking()
      go('idle')
      return
    }
    if (!canSpeak()) {
      afterTurn()
      return
    }
    const clarify = result.ui.find(item => item.kind === 'clarify') as
      Extract<AssistantUiPayload, { kind: 'clarify' }> | undefined
    const body = splitAction(result.text).body
    const extra = clarify && !body.includes(clarify.options[0]) ? spokenOptions(clarify.options) : undefined
    ensureSpeaker().finish(body, extra)
  }

  /** A quick-reply chip tapped in voice mode: sent as a spoken turn (the answer is read aloud). */
  const sendFromChip = (text: string) => {
    cancelListening()
    stopSpeaking()
    ask(text)
  }

  // leaving voice mode (or closing the panel): microphone off, voice off
  useEffect(() => {
    if (options.active) return
    cancelListening()
    stopSpeaking()
    turnRef.current = 0
    setPartial('')
    setMessage('')
    go('idle')
  }, [options.active, go, stopSpeaking])

  // muting while أفندي speaks silences him at once
  useEffect(() => {
    if (options.muted && speakerRef.current) {
      turnRef.current = 0
      stopSpeaking()
      if (phaseRef.current === 'speaking') afterTurn()
    }
  }, [options.muted, stopSpeaking, afterTurn])

  useEffect(
    () => () => {
      sessionRef.current?.cancel()
      speakerRef.current?.stop()
      bargeRef.current?.()
    },
    []
  )

  return {
    phase,
    partial,
    message,
    engine,
    /** the answers are shown as text only: this device has no Arabic voice (and the deployment no server voice) */
    textOnly: output === 'text',
    continuous,
    setContinuous,
    pressStart,
    pressEnd,
    toggle,
    /** «تخطي»: silence now; the rest of this answer (even if still streaming) is not read */
    stopSpeaking: () => {
      turnRef.current = 0
      stopSpeaking()
      if (phaseRef.current === 'speaking') go('idle')
    },
    acceptConsent,
    declineConsent,
    onReplyEvent,
    onReplyDone,
    sendFromChip,
  }
}
