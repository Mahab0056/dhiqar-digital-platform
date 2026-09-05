import { useEffect } from 'react'

/**
 * Scroll-reveal for elements carrying `data-reveal` (optionally `data-reveal-delay="120"` ms).
 * Adds `is-revealed` when the element enters the viewport; respects prefers-reduced-motion.
 */
export function useRevealOnScroll(deps: unknown[] = []) {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-revealed)'))
    if (!elements.length) return
    if (reduced || !('IntersectionObserver' in window)) {
      for (const element of elements) element.classList.add('is-revealed')
      return
    }
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const element = entry.target as HTMLElement
          const delay = Number(element.dataset.revealDelay || 0)
          window.setTimeout(() => element.classList.add('is-revealed'), delay)
          observer.unobserve(element)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    )
    for (const element of elements) observer.observe(element)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
