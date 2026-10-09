import { useEffect } from 'react'

/**
 * Smooth scrolling is skipped by some browsers (background tabs, embedded webviews, power saving): when the page has
 * not moved shortly after a smooth scroll, jump there directly so the link never looks dead.
 */
const scrollWithFallback = (scroll: (behavior: ScrollBehavior) => void, behavior: ScrollBehavior) => {
  const before = window.scrollY
  scroll(behavior)
  if (behavior === 'smooth') window.setTimeout(() => window.scrollY === before && scroll('instant'), 700)
}

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * wouter navigates with pushState, so `/citizen#my-requests` changes the URL without scrolling, and a link back to
 * the page you are already on («الرئيسية» → /citizen) does nothing at all. This scrolls to the hash target on mount and
 * whenever the hash changes (including hash-only links), and back to the top for a link to the current page.
 */
export function useHashScroll(dependency?: unknown) {
  useEffect(() => {
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth'
    let timer = 0
    const scrollToHash = () => {
      window.clearTimeout(timer)
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ''))
      if (!id) return
      // content may still be loading (lazy route chunk, data); retry for a few seconds
      let attempts = 0
      const tick = () => {
        const target = document.getElementById(id)
        if (target) {
          scrollWithFallback(mode => target.scrollIntoView({ behavior: mode, block: 'start' }), behavior)
          return
        }
        if (attempts++ < 40) timer = window.setTimeout(tick, 100)
      }
      tick()
    }
    scrollToHash()
    window.addEventListener('hashchange', scrollToHash)
    // wouter's <Link> triggers pushState without hashchange; observe clicks on same-page links too
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as HTMLElement | null)?.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return
      if (url.hash) {
        // a bare "#id" anchor (skip link…) keeps the browser's own fragment navigation, focus handling included
        if (!event.defaultPrevented && (anchor.getAttribute('href') || '').startsWith('#')) return
        // "/citizen#services" while on /citizen would jump natively: keep it smooth and inside the SPA
        if (!event.defaultPrevented) {
          event.preventDefault()
          if (window.location.hash !== url.hash) window.history.pushState(window.history.state, '', url.href)
        }
        // pushState fires no hashchange: announce it so the scroll and the portal's active nav item both follow
        window.dispatchEvent(new HashChangeEvent('hashchange'))
      } else if (!url.search || url.search === window.location.search) {
        window.setTimeout(() => {
          if (window.scrollY > 0) scrollWithFallback(mode => window.scrollTo({ top: 0, behavior: mode }), behavior)
        }, 0)
      }
    }
    document.addEventListener('click', onClick)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('hashchange', scrollToHash)
      document.removeEventListener('click', onClick)
    }
  }, [dependency])
}
