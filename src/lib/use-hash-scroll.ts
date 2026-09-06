import { useEffect } from 'react'

/**
 * wouter navigates with pushState, so `/citizen#my-requests` changes the URL without scrolling.
 * This scrolls to the hash target on mount and whenever the hash changes (including hash-only links).
 */
export function useHashScroll(dependency?: unknown) {
  useEffect(() => {
    const scrollToHash = () => {
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ''))
      if (!id) return
      // content may still be loading; retry briefly
      let attempts = 0
      const tick = () => {
        const target = document.getElementById(id)
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' })
          return
        }
        if (attempts++ < 20) window.setTimeout(tick, 100)
      }
      tick()
    }
    scrollToHash()
    window.addEventListener('hashchange', scrollToHash)
    // wouter's <Link> to a hash-only href triggers pushState without hashchange; observe clicks too
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest('a[href*="#"]') as HTMLAnchorElement | null
      if (!anchor) return
      const url = new URL(anchor.href, window.location.href)
      if (url.pathname === window.location.pathname && url.hash) window.setTimeout(scrollToHash, 0)
    }
    document.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('hashchange', scrollToHash)
      document.removeEventListener('click', onClick)
    }
  }, [dependency])
}
