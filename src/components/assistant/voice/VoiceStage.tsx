import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Keyboard, Mic, MicOff, ShieldCheck, SkipForward, VolumeX } from 'lucide-react'
import { AfandiOrb, type OrbState } from '../afandi/AfandiOrb'
import { motionStill } from '../afandi/orbEngine'
import type { VoicePhase } from './useVoiceConversation'
import { VOICE_ERRORS, type VoiceEngine } from './mic-input'

/**
 * «تكلم مع أفندي» — the voice stage that replaces the composer: the big أفندي orb (its voice rings follow the
 * citizen's microphone level while listening, and أفندي's own voice while he answers), the live transcript, the big
 * mic button (tap = talk until you stop, press-and-hold = talk while pressed), skip, continuous conversation, and the
 * first-time privacy sheet (a modal: focus moves into it, Tab stays inside, Escape declines). The sheet says exactly
 * when the microphone is open and who turns the speech into text on this browser. On a device with no Arabic voice
 * the stage says up front that the answers appear as text (they are never read by a wrong-language voice).
 */

/** Shown in voice mode when this device cannot read Arabic aloud. */
export const NO_ARABIC_VOICE = 'جهازك ما بيه صوت عربي؛ الأجوبة تظهر كتابة'
const STATUS: Record<VoicePhase, string> = {
  idle: 'اضغط على المايك وتكلّم',
  consent: 'قبل ما نبدأ',
  listening: 'أسمعك… تكلّم براحتك',
  transcribing: 'أحوّل كلامك لنص…',
  thinking: 'أفندي يفكّر بجوابك…',
  speaking: 'أفندي يجاوبك — اضغط المايك حتى تقاطعه',
  error: 'ما اشتغل الصوت',
}

const ORB_STATE: Record<VoicePhase, OrbState> = {
  idle: 'idle',
  consent: 'idle',
  listening: 'attention',
  transcribing: 'typing',
  thinking: 'typing',
  speaking: 'speaking',
  error: 'idle',
}

export function VoiceStage({
  orbRef,
  stageRef,
  phase,
  partial,
  message,
  engine,
  provider,
  serverVoice,
  textOnly = false,
  continuous,
  onContinuous,
  onPressStart,
  onPressEnd,
  onToggle,
  onSkip,
  onKeyboard,
  onAccept,
  onDecline,
}: {
  orbRef: RefObject<HTMLSpanElement | null>
  stageRef: RefObject<HTMLDivElement | null>
  phase: VoicePhase
  partial: string
  message: string
  engine: VoiceEngine
  /** the external service that turns a recorded clip into text (recorder engine) / voices the answer */
  provider: string | null
  /** the deployment voices answers on the server (the answer text goes to `provider`) */
  serverVoice: boolean
  /** no Arabic voice on this device: the answers are shown as text only */
  textOnly?: boolean
  continuous: boolean
  onContinuous: (value: boolean) => void
  onPressStart: () => void
  onPressEnd: () => void
  onToggle: () => void
  onSkip: () => void
  onKeyboard: () => void
  onAccept: () => void
  onDecline: () => void
}) {
  const micRef = useRef<HTMLButtonElement | null>(null)
  const keyboardRef = useRef<HTMLButtonElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const acceptRef = useRef<HTMLButtonElement | null>(null)
  const wasConsentRef = useRef(false)
  const pointerRef = useRef(false)
  // reduced motion or the site's motion pause: the mic ring keeps its opacity cue but does not scale
  const [still] = useState(() => motionStill())
  const listening = phase === 'listening'
  // no speech engine on this browser (and no server transcription): the mic is disabled, so the stage says why
  // instead of inviting a tap, and focus goes to «كتابة» (a disabled button cannot hold focus)
  const unsupported = engine === 'none'
  const status = unsupported && (phase === 'idle' || phase === 'error') ? 'الصوت غير متاح هنا' : STATUS[phase]
  const hint = unsupported
    ? VOICE_ERRORS.unsupported
    : phase === 'idle' && !message
      ? 'نقرة وحدة وتكلّم (يوقف لمن تسكت)، أو اضغط مطوّلاً وتكلّم'
      : phase === 'error' || (phase === 'idle' && message)
        ? message
        : ''

  useEffect(() => {
    ;(unsupported ? keyboardRef : micRef).current?.focus({ preventScroll: true })
  }, [unsupported])

  // the consent sheet is a modal: focus goes into it (the mic under it is disabled), and back to the mic after it
  useEffect(() => {
    if (phase === 'consent') {
      wasConsentRef.current = true
      acceptRef.current?.focus({ preventScroll: true })
    } else if (wasConsentRef.current) {
      wasConsentRef.current = false
      ;(micRef.current?.disabled ? keyboardRef : micRef).current?.focus({ preventScroll: true })
    }
  }, [phase])

  const onSheetKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // declines the sheet only (the panel's own Escape would close the whole assistant)
      event.preventDefault()
      event.stopPropagation()
      onDecline()
      return
    }
    if (event.key !== 'Tab') return
    const items = [...(sheetRef.current?.querySelectorAll<HTMLElement>('button, input') || [])].filter(
      item => !(item as HTMLButtonElement).disabled
    )
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || !sheetRef.current?.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !sheetRef.current?.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  const external = provider || 'مزوّد خارجي'

  return (
    <div className="afd-voice" ref={stageRef} data-phase={phase} data-motion={still ? 'still' : 'on'}>
      <div className="afd-voice-orb">
        <AfandiOrb ref={orbRef} state={ORB_STATE[phase]} markSize={44} />
      </div>
      <p className="afd-voice-status" role="status" aria-live="polite">
        {status}
      </p>
      <p className={`afd-voice-transcript${partial ? '' : ' is-empty'}`} aria-live="polite" aria-atomic="true">
        {partial ? <bdi>{partial}</bdi> : hint}
      </p>
      {textOnly && (
        <p className="afd-voice-note" role="status">
          <VolumeX aria-hidden="true" />
          <span>{NO_ARABIC_VOICE}</span>
        </p>
      )}

      <div className="afd-voice-controls">
        <button
          ref={keyboardRef}
          type="button"
          className="afd-voice-side"
          onClick={onKeyboard}
          aria-label="رجوع للكتابة"
        >
          <Keyboard aria-hidden="true" />
          <span>كتابة</span>
        </button>
        <button
          ref={micRef}
          type="button"
          className={`afd-voice-mic${listening ? ' is-on' : ''}`}
          aria-label={
            unsupported
              ? 'الصوت غير مدعوم في هذا المتصفح'
              : listening
                ? 'إيقاف الاستماع وإرسال كلامك'
                : 'تكلّم مع أفندي'
          }
          aria-pressed={listening}
          aria-keyshortcuts="Alt+M"
          disabled={engine === 'none' || phase === 'transcribing' || phase === 'consent'}
          onPointerDown={event => {
            if (event.button !== 0) return
            pointerRef.current = true
            event.currentTarget.setPointerCapture?.(event.pointerId)
            onPressStart()
          }}
          onPointerUp={() => {
            if (!pointerRef.current) return
            pointerRef.current = false
            onPressEnd()
          }}
          onPointerCancel={() => {
            if (!pointerRef.current) return
            pointerRef.current = false
            onPressEnd()
          }}
          onContextMenu={event => event.preventDefault()}
          onClick={event => {
            // assistive tech activates with a synthetic click (no pointer, detail 0)
            if (event.detail === 0) onToggle()
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              if (!event.repeat) onToggle()
            }
          }}
        >
          <span className="afd-voice-mic-ring" aria-hidden="true" />
          {engine === 'none' ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="afd-voice-side"
          onClick={onSkip}
          disabled={phase !== 'speaking'}
          aria-label="أسكت أفندي (تخطي الجواب الصوتي)"
        >
          <SkipForward aria-hidden="true" />
          <span>تخطي</span>
        </button>
      </div>

      <label className="afd-voice-switch">
        <input type="checkbox" checked={continuous} onChange={event => onContinuous(event.target.checked)} />
        <span aria-hidden="true" />
        محادثة متواصلة
        <small>يسمعك وحده بعد كل جواب، وأثناء كلام أفندي حتى تقاطعه</small>
      </label>

      {phase === 'consent' && (
        <div
          ref={sheetRef}
          className="afd-voice-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="afd-voice-sheet-title"
          onKeyDown={onSheetKey}
        >
          <ShieldCheck aria-hidden="true" />
          <strong id="afd-voice-sheet-title">قبل ما تتكلم مع أفندي</strong>
          <ul>
            <li>
              {continuous
                ? 'الميكروفون يشتغل من تضغط على المايك ويطفى لمن تسكت. ومع «محادثة متواصلة» (مفعّلة) يرجع يشتغل وحده بعد كل جواب، ويسمع أثناء كلام أفندي حتى تكدر تقاطعه.'
                : 'الميكروفون يشتغل بس من تضغط على المايك، ويطفى لمن تسكت.'}
            </li>
            <li>المنصة ما تحفظ صوتك. كلامك يتحول لنص ويُرسل لأفندي مثل الكتابة بالضبط.</li>
            <li>
              {engine === 'recorder'
                ? `بهذا المتصفح يتسجّل كلامك كمقطع صوتي ويُرسل عبر خادم المنصة إلى ${external} (جهة خارجية) حتى يتحول لنص. المنصة ما تحفظ المقطع، و${external} يعالجه حسب شروطه.`
                : 'تحويل الكلام لنص تسويه خدمة المتصفح نفسه (Google أو Apple أو Microsoft)، يعني صوتك يروح لهاي الشركة مو لخادم المنصة.'}
            </li>
            {serverVoice && <li>صوت أفندي يتولّد عند {external}: يُرسل له نص الجواب فقط.</li>}
            <li>لا تقول رمز التحقق أو رقم هويتك بصوت.</li>
          </ul>
          <label className="afd-voice-switch is-in-sheet">
            <input type="checkbox" checked={continuous} onChange={event => onContinuous(event.target.checked)} />
            <span aria-hidden="true" />
            محادثة متواصلة
            <small>الميكروفون يرجع يسمع وحده بعد كل جواب وأثناء كلام أفندي</small>
          </label>
          <div className="afd-voice-sheet-actions">
            <button ref={acceptRef} type="button" className="dqa-btn is-primary" onClick={onAccept}>
              تمام، نبدأ
            </button>
            <button type="button" className="dqa-btn" onClick={onDecline}>
              لا، أكتب أحسن
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
