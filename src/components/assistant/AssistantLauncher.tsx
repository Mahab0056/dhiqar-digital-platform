import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { Sparkles } from 'lucide-react'
import '../../styles/ds/assistant.css'

const AssistantPanel = lazy(() => import('./AssistantPanel').then(module => ({ default: module.AssistantPanel })))

/** Staff workspaces and the full-screen scanner have their own tools; the citizen assistant stays out of them. */
const HIDDEN_ROUTES = /^\/(employee|super-admin|operations|governor|department|staff|verify)(\/|$)/

/** Opens the assistant from anywhere: `window.dispatchEvent(new CustomEvent('dqa:open', { detail: { prompt } }))`. */
export const ASSISTANT_OPEN_EVENT = 'dqa:open'

/**
 * Floating launcher of "مساعد ذي قار الآلي", mounted once for the whole app. The chat panel is a separate lazy chunk
 * loaded on first open and kept mounted afterwards, so the conversation survives navigation between pages.
 */
export function AssistantLauncher() {
  const [location] = useLocation()
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const wasOpen = useRef(false)
  const hidden = HIDDEN_ROUTES.test(location)

  useEffect(() => {
    const onOpen = (event: Event) => {
      const prompt = (event as CustomEvent<{ prompt?: string } | undefined>).detail?.prompt
      if (prompt) setInitialPrompt(prompt)
      setLoaded(true)
      setOpen(true)
    }
    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpen)
  }, [])

  // give focus back to the launcher when the panel closes
  useEffect(() => {
    if (wasOpen.current && !open) buttonRef.current?.focus()
    wasOpen.current = open
  }, [open])

  if (hidden) return null
  return (
    <>
      {!open && (
        <button
          ref={buttonRef}
          type="button"
          className="dqa-launcher"
          onClick={() => {
            setLoaded(true)
            setOpen(true)
          }}
          onPointerEnter={() => setLoaded(true)}
          aria-haspopup="dialog"
          aria-label="افتح مساعد ذي قار الآلي"
        >
          <span className="dqa-launcher-icon" aria-hidden="true">
            <Sparkles />
          </span>
          <span className="dqa-launcher-label">
            <strong>مساعد ذي قار</strong>
            <small>اسألني عن أي خدمة</small>
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
