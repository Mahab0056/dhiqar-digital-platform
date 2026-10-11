import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import '../../styles/ds/assistant.css'
import '../../styles/ds/afandi.css'
import { AfandiGreeter } from './afandi/AfandiGreeter'
import { AfandiOrb, type OrbState } from './afandi/AfandiOrb'
import {
  canGreet,
  hasArrived,
  markArrived,
  markChatOpened,
  markGreeted,
  quietGreeter,
  type GreeterKind,
} from './afandi/greeter'
import { createOrbVoice, motionStill, type OrbVoice, type VoiceSchedule } from './afandi/orbEngine'
import { playAfandiSound } from './afandi/sound'
import { useLauncherPlacement } from './afandi/useLauncherPlacement'

const AssistantPanel = lazy(() => import('./AssistantPanel').then(module => ({ default: module.AssistantPanel })))

/** Staff workspaces and the full-screen scanner have their own tools; the citizen assistant stays out of them. */
const HIDDEN_ROUTES = /^\/(employee|super-admin|operations|governor|department|staff|verify)(\/|$)/

/** Opens the assistant from anywhere: `window.dispatchEvent(new CustomEvent('dqa:open', { detail: { prompt } }))`. */
export const ASSISTANT_OPEN_EVENT = 'dqa:open'

/** Delay before the greeting grows out of the orb (the page settles first). */
const GREET_DELAY = 2600
/** The orb breathes for a while, then rests on a still frame (no endless motion). */
const REST_AFTER = 36_000
/** A greeting that found no clear moment (it never covers a page's controls) gives up on that page after this. */
const GREET_WINDOW = 90_000
/** The corner must still be clear this much later (cards revealed on scroll slide in after a first look). */
const GREET_CONFIRM = 700
/** While the bubble is up, what is under it is looked at again this often. */
const GREET_WATCH = 600

/**
 * Floating launcher of «أفندي — مساعد ذي قار», mounted once for the whole app: the أفندي orb (the owner's أفندي
 * identity), a once-per-session greeting on browsing pages, and the chat panel — a separate lazy chunk loaded on first
 * open and kept mounted afterwards, so the conversation survives navigation between pages. The launcher keeps off
 * the page's content (useLauncherPlacement): on a page's first screen it tucks into the corner or steps aside, its
 * label unfolds only where it covers nothing, and the greeting waits for a moment when it would cover no control.
 */
export function AssistantLauncher() {
  const [location] = useLocation()
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null)
  const [greeting, setGreeting] = useState<GreeterKind | null>(null)
  /** a greeting whose delay has passed on this page, waiting for a moment when it covers nothing */
  const [wantGreeting, setWantGreeting] = useState<{ kind: GreeterKind; path: string } | null>(null)
  // the arrival flourish of the session plays the first time the orb is actually on screen
  const [arriving, setArriving] = useState(() => !hasArrived())
  const [arrivalSettled, setArrivalSettled] = useState(false)
  const [orbState, setOrbState] = useState<OrbState>('idle')
  const [still] = useState(() => motionStill())
  // reduced motion / the platform's motion pause: the orb sits on a still frame from the start
  const [rest, setRest] = useState(still)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const bodyRef = useRef<HTMLSpanElement | null>(null)
  const labelRef = useRef<HTMLSpanElement | null>(null)
  const orbRef = useRef<HTMLSpanElement | null>(null)
  const voiceRef = useRef<OrbVoice | null>(null)
  const wasOpen = useRef(false)
  const hidden = HIDDEN_ROUTES.test(location)
  const wanted = wantGreeting?.path === location ? wantGreeting.kind : null
  const layout = useLauncherPlacement({
    buttonRef,
    bodyRef,
    labelRef,
    active: !hidden && !open,
    route: location,
    greeting: !!wanted && !greeting,
  })
  const onScreen = layout.placement !== null && layout.placement !== 'hidden'

  const openChat = useCallback((prompt?: string) => {
    if (prompt) setInitialPrompt(prompt)
    setGreeting(null)
    setLoaded(true)
    setOpen(true)
    markChatOpened()
    playAfandiSound('chime')
  }, [])

  useEffect(() => {
    const onOpen = (event: Event) => openChat((event as CustomEvent<{ prompt?: string } | undefined>).detail?.prompt)
    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpen)
  }, [openChat])

  // the orb's voice engine lives as long as the orb is on the page
  useEffect(() => {
    const orb = orbRef.current
    if (!orb || open || hidden) return
    const voice = createOrbVoice(orb, { onSpeaking: on => on && setRest(false) })
    voiceRef.current = voice
    return () => {
      voice.destroy()
      voiceRef.current = null
    }
  }, [open, hidden])

  // arrival flourish once per session (when the orb is first on screen), then idle breathing, then rest
  const arrivingNow = arriving && onScreen
  useEffect(() => {
    if (!arrivingNow) return
    markArrived()
    const toIdle = window.setTimeout(() => setArrivalSettled(true), 900)
    const done = window.setTimeout(() => setArriving(false), 1900)
    return () => {
      window.clearTimeout(toIdle)
      window.clearTimeout(done)
    }
  }, [arrivingNow])

  useEffect(() => {
    if (rest || greeting || open) return
    const timer = window.setTimeout(() => setRest(true), REST_AFTER)
    return () => window.clearTimeout(timer)
  }, [rest, greeting, open, location])

  // a greeting on the first browsing page of the session (never on forms, sign-in or staff pages) — once its delay
  // has passed, it waits for a moment when the bubble covers no control, field or heading (the first screen's search,
  // quick actions, «تابع معاملاتك»…), and gives up on this page if none comes
  useEffect(() => {
    if (open || hidden) return
    const kind = canGreet(location)
    if (!kind) return
    const timer = window.setTimeout(() => setWantGreeting({ kind, path: location }), GREET_DELAY)
    const expire = window.setTimeout(() => setWantGreeting(null), GREET_DELAY + GREET_WINDOW)
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(expire)
      setWantGreeting(null)
    }
  }, [location, open, hidden])

  const { greetOk, greetingClear } = layout
  useEffect(() => {
    if (!wanted || !greetOk || open || hidden) return
    const timer = window.setTimeout(() => {
      if (document.visibilityState === 'hidden' || canGreet(location) !== wanted || !greetingClear()) return
      markGreeted()
      if (!still) setRest(false)
      setGreeting(wanted)
      setWantGreeting(null)
    }, GREET_CONFIRM)
    return () => window.clearTimeout(timer)
  }, [wanted, greetOk, greetingClear, location, open, hidden, still])

  // give focus back to the launcher when the panel closes
  useEffect(() => {
    if (wasOpen.current && !open) buttonRef.current?.focus()
    wasOpen.current = open
  }, [open])

  const closeGreeting = useCallback((quiet: boolean) => {
    if (quiet) quietGreeter()
    voiceRef.current?.stop()
    setGreeting(null)
  }, [])

  // the bubble belongs to the orb in its corner: when the orb tucks away or docks (back in a crowded first screen),
  // the greeting folds instead of pointing at nothing over the page
  useEffect(() => {
    if (greeting && layout.placement && layout.placement !== 'normal') closeGreeting(false)
  }, [greeting, layout.placement, closeGreeting])

  // the bubble came where it covered nothing: once the citizen scrolls on — or content arrives under it (a list that
  // loads, cards revealed on scroll) — it folds
  useEffect(() => {
    if (!greeting) return
    const from = window.scrollY
    const onScroll = () => {
      if (Math.abs(window.scrollY - from) > Math.min(160, window.innerHeight * 0.25)) closeGreeting(false)
    }
    const watch = window.setInterval(() => {
      if (!greetingClear(document.querySelector('.afd-greet'))) closeGreeting(false)
    }, GREET_WATCH)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.clearInterval(watch)
      window.removeEventListener('scroll', onScroll)
    }
  }, [greeting, closeGreeting, greetingClear])

  const speak = useCallback((schedule: VoiceSchedule) => {
    setOrbState('speaking')
    voiceRef.current?.speak(schedule)
    window.setTimeout(() => setOrbState(current => (current === 'speaking' ? 'idle' : current)), schedule.end + 400)
  }, [])

  if (hidden) return null
  // the arrival flourish, the first moment the orb is on screen this session
  const shownOrbState: OrbState = arrivingNow && !arrivalSettled && orbState === 'idle' ? 'arrival' : orbState
  // a greeting belongs to its page: navigating away folds it
  const shownGreeting = greeting && canGreetSamePage(greeting, location) ? greeting : null
  return (
    <>
      {shownGreeting && !open && (
        <AfandiGreeter
          kind={shownGreeting}
          still={still}
          onOpenChat={openChat}
          onClose={closeGreeting}
          onSpeak={speak}
          onSpeakEnd={() => voiceRef.current?.stop()}
        />
      )}
      {!open && (
        <button
          ref={buttonRef}
          type="button"
          className={`dqa-launcher afd-launcher${arrivingNow ? ' is-arriving' : ''}${shownGreeting ? ' is-greeting' : ''}`}
          data-place={layout.placement ?? 'pending'}
          data-label={layout.label ? '' : undefined}
          onClick={() => openChat()}
          onPointerEnter={() => {
            setLoaded(true)
            if (!still) setRest(false)
          }}
          onFocus={() => setLoaded(true)}
          aria-haspopup="dialog"
          aria-label="افتح أفندي — مساعد ذي قار"
        >
          <span ref={bodyRef} className="afd-launcher__body">
            <span className="afd-launcher__disc">
              <AfandiOrb ref={orbRef} state={shownOrbState} arrive={arrivingNow} motion="glint" rest={rest} />
            </span>
            <span ref={labelRef} className="afd-launcher__label">
              <strong>أفندي</strong>
              <small>مساعد ذي قار · اسألني</small>
            </span>
          </span>
        </button>
      )}
      {loaded && (
        <Suspense fallback={null}>
          <AssistantPanel
            open={open}
            onClose={() => setOpen(false)}
            initialPrompt={initialPrompt}
            onInitialPromptUsed={() => setInitialPrompt(null)}
          />
        </Suspense>
      )}
    </>
  )
}

/** The greeting stays while the citizen is still on a page of the same kind (e.g. hash / query changes). */
function canGreetSamePage(kind: GreeterKind, path: string) {
  const p = (path.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/'
  return (
    (kind === 'home' && p === '/') ||
    (kind === 'services' && (p === '/directory' || p.startsWith('/government-services/'))) ||
    (kind === 'departments' && p.startsWith('/departments')) ||
    (kind === 'news' && p === '/news') ||
    (kind === 'tenders' && p.startsWith('/tenders')) ||
    (kind === 'guides' && p === '/guides') ||
    (kind === 'citizen' && p === '/citizen')
  )
}
