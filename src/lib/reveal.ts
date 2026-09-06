import { useEffect } from 'react'

/**
 * Scroll-reveal for elements carrying `data-reveal` (optionally `data-reveal-delay="120"` ms).
 * Adds `is-revealed` when the element enters the viewport; respects prefers-reduced-motion.
 *
 * Sections that render later (after an API response) are picked up through a MutationObserver, and a
 * failsafe reveals everything after a few seconds — content must never stay invisible because an
 * observer callback did not fire.
 */
export function useRevealOnScroll(deps: unknown[] = []) {
  useEffect(() => {
    const reveal = (element: HTMLElement, delay = Number(element.dataset.revealDelay || 0)) => {
      if (delay > 0) window.setTimeout(() => element.classList.add('is-revealed'), delay)
      else element.classList.add('is-revealed')
    }
    const pending = () => Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-revealed)'))
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || !('IntersectionObserver' in window)) {
      for (const element of pending()) element.classList.add('is-revealed')
      return
    }
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          observer.unobserve(entry.target)
          reveal(entry.target as HTMLElement)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    )
    const observePending = () => {
      for (const element of pending()) observer.observe(element)
    }
    observePending()
    // sections rendered after data loads must be observed too
    const mutations = new MutationObserver(observePending)
    mutations.observe(document.body, { childList: true, subtree: true })
    const failsafe = window.setTimeout(() => {
      for (const element of pending()) element.classList.add('is-revealed')
    }, 5000)
    return () => {
      window.clearTimeout(failsafe)
      mutations.disconnect()
      observer.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
