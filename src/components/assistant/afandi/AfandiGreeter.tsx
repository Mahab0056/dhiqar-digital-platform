import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Volume2, X } from 'lucide-react'
import { arabicVoice, GREETER_COPY, type GreeterKind } from './greeter'
import { buildSchedule, splitWords, type VoiceSchedule } from './orbEngine'
import { playAfandiSound } from './sound'

/**
 * The أفندي greeting bubble: grows out of the orb with the line revealed word by word (the orb «speaks» in step),
 * then folds back on its own after a while unless the citizen is reading it (hover / focus). «اسأل أفندي» opens the
 * chat, «اسمعني» reads the line aloud with the device's Arabic voice (only on that press — never autoplay), «لا شكراً»
 * keeps the greeter quiet for a week, × / Esc just closes it.
 */
export function AfandiGreeter({
  kind,
  still,
  onOpenChat,
  onClose,
  onSpeak,
  onSpeakEnd,
}: {
  kind: GreeterKind
  still: boolean
  onOpenChat: (prompt?: string) => void
  onClose: (quiet: boolean) => void
  onSpeak: (schedule: VoiceSchedule) => void
  onSpeakEnd: () => void
}) {
  const copy = GREETER_COPY[kind]
  const words = splitWords(copy.line)
  const [voice, setVoice] = useState(() => arabicVoice())
  const [speaking, setSpeaking] = useState(false)
  const [holding, setHolding] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const schedule = useRef(buildSchedule(words))

  // the orb speaks along with the word reveal
  useEffect(() => {
    if (!still) onSpeak(schedule.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // system voices load asynchronously in Chromium
  useEffect(() => {
    if (voice || typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const update = () => setVoice(arabicVoice())
    window.speechSynthesis.addEventListener('voiceschanged', update)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update)
  }, [voice])

  // folds back by itself after 16 s, unless hovered / focused / speaking
  useEffect(() => {
    if (holding || speaking) return
    const timer = window.setTimeout(() => onClose(false), 16_000)
    return () => window.clearTimeout(timer)
  }, [holding, speaking, onClose])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(
    () => () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
    },
    []
  )

  const speak = () => {
    if (!voice) return
    const synth = window.speechSynthesis
    if (speaking) {
      synth.cancel()
      return
    }
    playAfandiSound('chime')
    const utterance = new SpeechSynthesisUtterance(copy.line)
    utterance.voice = voice
    utterance.lang = voice.lang
    utterance.rate = 0.95
    utterance.onstart = () => {
      setSpeaking(true)
      // the spoken pace is slower than the reveal: replay the schedule a bit slower
      onSpeak(buildSchedule(words, { lead: 0, speed: 0.8 }))
    }
    const end = () => {
      setSpeaking(false)
      onSpeakEnd()
    }
    utterance.onend = end
    utterance.onerror = end
    synth.cancel()
    window.setTimeout(() => synth.speak(utterance), 380)
  }

  return (
    <div
      ref={rootRef}
      className={`afd-greet${still ? ' is-still' : ''}`}
      role="dialog"
      aria-modal="false"
      aria-label="ترحيب أفندي"
      onPointerEnter={() => setHolding(true)}
      onPointerLeave={() => setHolding(false)}
      onFocus={() => setHolding(true)}
      onBlur={event => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setHolding(false)
      }}
    >
      <span className="afd-greet__beam" aria-hidden="true" />
      <div className="afd-greet__head">
        <span className="afd-greet__name">أفندي</span>
        <span className="afd-greet__tag">مساعد ذي قار الآلي</span>
        <button type="button" className="afd-greet__x" onClick={() => onClose(false)} aria-label="إغلاق الترحيب">
          <X aria-hidden="true" />
        </button>
      </div>
      <p className="afd-greet__msg">
        <span className="afd-sr">{copy.line}</span>
        <span aria-hidden="true">
          {words.map((word, index) => (
            <span
              key={`${word}-${index}`}
              className="afd-word"
              style={{ ['--d' as string]: `${schedule.current.beats[index]?.start ?? 0}ms` }}
            >
              {word}{' '}
            </span>
          ))}
        </span>
      </p>
      <div className="afd-greet__actions">
        <button type="button" className="afd-btn afd-btn--primary" onClick={() => onOpenChat(copy.prompt)}>
          <MessageCircle aria-hidden="true" /> اسأل أفندي
        </button>
        {voice && (
          <button
            type="button"
            className={`afd-btn afd-btn--ghost${speaking ? ' is-on' : ''}`}
            onClick={speak}
            aria-pressed={speaking}
          >
            <Volume2 aria-hidden="true" /> {speaking ? 'إيقاف' : 'اسمعني'}
          </button>
        )}
        <button type="button" className="afd-btn afd-btn--text" onClick={() => onClose(true)}>
          لا شكراً
        </button>
      </div>
      <svg className="afd-greet__tail" viewBox="0 0 16 11" aria-hidden="true">
        <path d="M0 0H16L3 11Z" />
      </svg>
    </div>
  )
}
