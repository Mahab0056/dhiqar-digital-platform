import { useEffect, useRef, useState } from 'react'

/*
 * Progressive-enhancement motion for the public pages:
 *  - <ScrollProgress/>: a thin brand-green bar under the header that follows the page scroll.
 *  - usePointerFx(): on fine pointers only, cards get a soft spotlight + a small tilt (≤4°) and primary
 *    buttons a gentle «magnetic» pull. One delegated listener, rAF-throttled, transform/opacity only.
 *  - <CountUp/>: a number that counts up once when it scrolls into view, without shifting the layout.
 * Everything is skipped under prefers-reduced-motion (or the home page's motion pause); content never
 * depends on any of it.
 */

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
  (() => {
    try {
      return window.localStorage.getItem('tqd-motion-paused') === '1'
    } catch {
      return false
    }
  })()

export function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = bar.current
    if (!element) return
    let frame = 0
    const update = () => {
      frame = 0
      const root = document.documentElement
      const max = root.scrollHeight - window.innerHeight
      const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
      element.style.transform = `scaleX(${progress.toFixed(4)})`
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [])
  return <div className="tq-scroll-progress" ref={bar} aria-hidden="true" />
}

const CARD_SELECTOR = [
  '.ld-service',
  '.ld-life-card',
  '.ld-cat',
  '.ld-dept',
  '.ld-panel',
  '.ld-staff-features li',
  '.ld-steps li',
  '.nw-card-link',
  '.dept-card',
  '.dir-row',
  '.official-card',
].join(',')
const MAGNET_SELECTOR = '.ld-btn.is-green, .ld-hero-search .tq-search-submit, .tq-page-actions .button.primary'

export function usePointerFx() {
  useEffect(() => {
    if (reducedMotion() || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    let frame = 0
    let last: PointerEvent | null = null
    let card: HTMLElement | null = null
    let magnet: HTMLElement | null = null

    const releaseCard = () => {
      if (!card) return
      card.classList.remove('fx-lit')
      card.style.removeProperty('--fx-rx')
      card.style.removeProperty('--fx-ry')
      card = null
    }
    const releaseMagnet = () => {
      if (!magnet) return
      magnet.style.removeProperty('translate')
      magnet = null
    }
    const apply = () => {
      frame = 0
      const event = last
      if (!event) return
      const target = event.target instanceof Element ? event.target : null
      const nextCard = target?.closest<HTMLElement>(CARD_SELECTOR) ?? null
      if (nextCard !== card) {
        releaseCard()
        card = nextCard
        card?.classList.add('fx-lit')
      }
      if (card) {
        const box = card.getBoundingClientRect()
        const x = (event.clientX - box.left) / box.width
        const y = (event.clientY - box.top) / box.height
        card.style.setProperty('--fx-x', `${(x * 100).toFixed(1)}%`)
        card.style.setProperty('--fx-y', `${(y * 100).toFixed(1)}%`)
        card.style.setProperty('--fx-rx', `${((0.5 - y) * 5).toFixed(2)}deg`)
        card.style.setProperty('--fx-ry', `${((x - 0.5) * 6).toFixed(2)}deg`)
      }
      const nextMagnet = target?.closest<HTMLElement>(MAGNET_SELECTOR) ?? null
      if (nextMagnet !== magnet) {
        releaseMagnet()
        magnet = nextMagnet
      }
      if (magnet) {
        const box = magnet.getBoundingClientRect()
        const dx = (event.clientX - (box.left + box.width / 2)) / box.width
        const dy = (event.clientY - (box.top + box.height / 2)) / box.height
        magnet.style.translate = `${(dx * 6).toFixed(1)}px ${(dy * 4).toFixed(1)}px`
      }
    }
    const onMove = (event: PointerEvent) => {
      last = event
      if (!frame) frame = requestAnimationFrame(apply)
    }
    const onLeave = () => {
      releaseCard()
      releaseMagnet()
    }
    document.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      cancelAnimationFrame(frame)
      onLeave()
      document.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [])
}

/** Counts up to `value` once visible. The final number reserves the width, so nothing around it moves. */
export function CountUp({ value, duration = 1400 }: { value: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(value)
  useEffect(() => {
    const element = ref.current
    if (!element || reducedMotion() || !('IntersectionObserver' in window)) {
      setShown(value)
      return
    }
    let raf = 0
    setShown(0)
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        observer.disconnect()
        const start = performance.now()
        const tick = (now: number) => {
          const k = Math.min(1, (now - start) / duration)
          setShown(Math.round(value * (1 - Math.pow(1 - k, 3))))
          if (k < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      },
      { threshold: 0.4 }
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [value, duration])
  const final = value.toLocaleString('en-US')
  return (
    <span className="tq-count" ref={ref}>
      <span className="tq-count-ghost" aria-hidden="true">
        {final}
      </span>
      <span className="tq-count-live" aria-hidden="true">
        {shown.toLocaleString('en-US')}
      </span>
      <span className="sr-only">{final}</span>
    </span>
  )
}
