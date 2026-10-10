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

const AssistantPanel = lazy(() => import('./AssistantPanel').then(module => ({ default: module.AssistantPanel })))

/** Staff workspaces and the full-screen scanner have their own tools; the citizen assistant stays out of them. */
const HIDDEN_ROUTES = /^\/(employee|super-admin|operations|governor|department|staff|verify)(\/|$)/

/** Opens the assistant from anywhere: `window.dispatchEvent(new CustomEvent('dqa:open', { detail: { prompt } }))`. */
export const ASSISTANT_OPEN_EVENT = 'dqa:open'

/** Delay before the greeting grows out of the orb (the page settles first). */
const GREET_DELAY = 2600
/** The orb breathes for a while, then rests on a still frame (no endless motion). */
const REST_AFTER = 36_000

/**
 * Floating launcher of «أفندي — مساعد ذي قار», mounted once for the whole app: the أفندي orb (the owner's أفندي
 * identity), a once-per-session greeting on browsing pages, and the chat panel — a separate lazy chunk loaded on first
 * open and kept mounted afterwards, so the conversation survives navigation between pages.
 */
export function AssistantLauncher() {
  const [location] = useLocation()
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null)
  const [greeting, setGreeting] = useState<GreeterKind | null>(null)
  const [arriving, setArriving] = useState(() => !hasArrived())
  const [orbState, setOrbState] = useState<OrbState>(() => (hasArrived() ? 'idle' : 'arrival'))
  const [still] = useState(() => motionStill())
  // reduced motion / the platform's motion pause: the orb sits on a still frame from the start
  const [rest, setRest] = useState(still)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const orbRef = useRef<HTMLSpanElement | null>(null)
  const voiceRef = useRef<OrbVoice | null>(null)
  const wasOpen = useRef(false)
  const hidden = HIDDEN_ROUTES.test(location)

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

  // arrival flourish once per session, then idle breathing, then rest
  useEffect(() => {
    if (!arriving) return
    markArrived()
    const toIdle = window.setTimeout(() => setOrbState('idle'), 900)
    const done = window.setTimeout(() => setArriving(false), 1900)
    return () => {
      window.clearTimeout(toIdle)
      window.clearTimeout(done)
    }
  }, [arriving])

  useEffect(() => {
    if (rest || greeting || open) return
    const timer = window.setTimeout(() => setRest(true), REST_AFTER)
    return () => window.clearTimeout(timer)
  }, [rest, greeting, open, location])

  // a greeting on the first browsing page of the session (never on forms, sign-in or staff pages)
  useEffect(() => {
    if (open || hidden) return
    const kind = canGreet(location)
    if (!kind) return
    const timer = window.setTimeout(() => {
      if (document.visibilityState === 'hidden' || canGreet(location) !== kind) return
      markGreeted()
      if (!still) setRest(false)
      setGreeting(kind)
    }, GREET_DELAY)
    return () => window.clearTimeout(timer)
  }, [location, open, hidden, still])

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

  const speak = useCallback((schedule: VoiceSchedule) => {
    setOrbState('speaking')
    voiceRef.current?.speak(schedule)
    window.setTimeout(() => setOrbState(current => (current === 'speaking' ? 'idle' : current)), schedule.end + 400)
  }, [])

  if (hidden) return null
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
          className={`dqa-launcher afd-launcher${arriving ? ' is-arriving' : ''}${shownGreeting ? ' is-greeting' : ''}`}
          onClick={() => openChat()}
          onPointerEnter={() => {
            setLoaded(true)
            if (!still) setRest(false)
          }}
          onFocus={() => setLoaded(true)}
          aria-haspopup="dialog"
          aria-label="افتح أفندي — مساعد ذي قار"
        >
          <span className="afd-launcher__disc">
            <AfandiOrb ref={orbRef} state={orbState} arrive={arriving} motion="glint" rest={rest} />
          </span>
          <span className="afd-launcher__label">
            <strong>أفندي</strong>
            <small>مساعد ذي قار · اسألني</small>
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
