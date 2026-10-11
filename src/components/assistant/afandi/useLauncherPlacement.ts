import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  choosePlacement,
  circlePoints,
  dockRect,
  FIRST_SCREEN,
  greetingAllowed,
  greetRect,
  densePoints,
  LABEL_TOP,
  miniRect,
  showLabel,
  transformBetween,
  underPoints,
  type ContentKinds,
  type Placement,
  type Rect,
} from './placement'

/**
 * Keeps the أفندي launcher off the page's content (see placement.ts): measures its corner when the page settles, when
 * scrolling rests and on resize, and moves the launcher's body (a transform — the button's own box stays in the
 * corner, so its normal spot can always be measured). `placement` is null until the first measurement (the launcher
 * stays invisible until then: no flash over a hero that is about to be covered).
 */
export type LauncherLayout = {
  placement: Placement | null
  /** the «أفندي · اسألني» label is unfolded */
  label: boolean
  /** the greeting bubble may grow out of the orb now */
  greetOk: boolean
}

type Geometry = {
  viewportWidth: number
  viewportHeight: number
  normal: Rect
  mini: Rect
  dock: Rect | null
  /** the label beside an orb in its normal spot (null: no label at this width) */
  label: Rect | null
}

type Sample = {
  /** an overlay (the home intro splash, a modal) hides the page: nothing was judged */
  covered: boolean
  normalClear: boolean
  miniClear: boolean
  dockClear: boolean | null
  labelClear: boolean
  dockLabelClear: boolean
  greetClear: boolean
}

/** under the orb or its label: controls, text and framed cards all count */
const UNDER_ORB: ContentKinds = { text: true, cards: true }
/** under the greeting (a passing bubble): controls, fields, links and headings */
const UNDER_GREETING: ContentKinds = { text: false, cards: false }

const toRect = (rect: DOMRect | Rect): Rect => ({
  left: rect.left,
  top: rect.top,
  width: rect.width,
  height: rect.height,
})
const shift = (rect: Rect, dx: number, dy: number): Rect => ({ ...rect, left: rect.left + dx, top: rect.top + dy })

function measure(button: HTMLElement, labelElement: HTMLElement | null): Geometry {
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth
  const viewportHeight = window.innerHeight
  // the button is never transformed: its box is the orb's normal spot
  const normal = toRect(button.getBoundingClientRect())
  // the portal's phone bottom bar is the floor the tucked orb sits on
  let floor = viewportHeight
  const nav = document.querySelector('.app-bottom-nav')
  if (nav) {
    const rect = nav.getBoundingClientRect()
    if (rect.height > 0 && rect.top < viewportHeight && getComputedStyle(nav).display !== 'none') floor = rect.top
  }
  // the portal on desktop: a sidebar with a free band above its account card
  let dock: Rect | null = null
  const sidebar = document.querySelector('.app-shell .app-sidebar')
  const foot = sidebar?.querySelector('.app-sidebar-foot')
  if (sidebar && foot && viewportWidth >= 1025) {
    const side = sidebar.getBoundingClientRect()
    const style = getComputedStyle(sidebar)
    if (side.width > normal.width + 40 && side.right > 0 && side.left < viewportWidth && style.visibility !== 'hidden')
      dock = dockRect(normal, toRect(side), Math.min(foot.getBoundingClientRect().top, viewportHeight), viewportWidth)
  }
  let label: Rect | null = null
  if (labelElement && labelElement.offsetWidth > 0)
    // offsets ignore the body's transform: the label as it sits beside an orb in its normal spot
    label = {
      left: normal.left + labelElement.offsetLeft,
      top: normal.top + labelElement.offsetTop,
      width: labelElement.offsetWidth,
      height: labelElement.offsetHeight,
    }
  return {
    viewportWidth,
    viewportHeight,
    normal,
    mini: miniRect(normal, { width: viewportWidth, floor }),
    dock,
    label,
  }
}

function sample(geometry: Geometry, own: (element: Element) => boolean, greeting: boolean): Sample {
  const { normal, mini, dock, label } = geometry
  let covered = false
  const clear = (points: { x: number; y: number }[], kinds: ContentKinds) => {
    const under = underPoints(points, own, kinds)
    if (under === 'covered') covered = true
    return under === 'clear'
  }
  const dockLabel = dock && label ? shift(label, dock.left - normal.left, dock.top - normal.top) : null
  const result = {
    normalClear: clear(circlePoints(normal), UNDER_ORB),
    miniClear: clear(circlePoints(mini), UNDER_ORB),
    dockClear: dock ? clear(circlePoints(dock), UNDER_ORB) : null,
    labelClear: label ? clear(labelPoints(label), UNDER_ORB) : false,
    dockLabelClear: dockLabel ? clear(labelPoints(dockLabel), UNDER_ORB) : false,
    // the bubble's spot is only looked at while a greeting is waiting for it
    greetClear: greeting && clear(greetPoints(greetRect(normal, geometry.viewportWidth)), UNDER_GREETING),
  }
  return { covered, ...result }
}

/** the label's edge, and a few px around it, must be free too */
const labelPoints = (rect: Rect) => densePoints(rect, { x: 28, y: 14 }, -4)
/** the bubble's rounded corners are air: sampled from 8 px inside */
const greetPoints = (rect: Rect) => densePoints(rect, { x: 30, y: 18 }, 8)
const ownElement = (button: HTMLElement) => (element: Element) =>
  button.contains(element) || !!element.closest('.afd-greet, .dqa-panel')

export function useLauncherPlacement(options: {
  buttonRef: RefObject<HTMLElement | null>
  bodyRef: RefObject<HTMLElement | null>
  labelRef: RefObject<HTMLElement | null>
  /** the launcher is on the page (not on a staff route, the panel is closed) */
  active: boolean
  /** the current route: a new page is measured again once it has rendered */
  route: string
  /** a greeting is waiting for a clear moment: its spot is looked at too */
  greeting: boolean
}): LauncherLayout & { greetingClear: (bubble?: Element | null) => boolean } {
  const { buttonRef, bodyRef, labelRef, active, route, greeting } = options
  const [layout, setLayout] = useState<LauncherLayout>({ placement: null, label: false, greetOk: false })
  const lastSample = useRef<Sample | null>(null)
  const measuredOnce = useRef(false)

  useEffect(() => {
    if (!active) return
    const button = buttonRef.current
    const body = bodyRef.current
    if (!button || !body) return
    const own = ownElement(button)

    let retry = 0
    let retries = 0
    const run = (fresh: boolean) => {
      const geometry = measure(button, labelRef.current)
      /** the corner was looked at just now, where the page rests */
      let judged = false
      if (fresh || !lastSample.current) {
        const next = sample(geometry, own, greeting)
        if (next.covered) {
          // an overlay hides the page (the intro splash, a modal): judge again once it has gone
          window.clearTimeout(retry)
          if (retries++ < 30) retry = window.setTimeout(() => run(true), 500)
          if (!lastSample.current) return
        } else {
          retries = 0
          lastSample.current = next
          judged = true
        }
      }
      const flags = lastSample.current
      const inZone = window.scrollY < geometry.viewportHeight * FIRST_SCREEN
      const placement = choosePlacement({
        inZone,
        dockClear: geometry.dock ? flags.dockClear : null,
        normalClear: flags.normalClear,
        miniClear: flags.miniClear,
      })
      const target = placement === 'mini' ? geometry.mini : placement === 'dock' && geometry.dock ? geometry.dock : null
      const move = target ? transformBetween(geometry.normal, target) : { dx: 0, dy: 0, scale: 1 }
      body.style.setProperty('--afd-dx', `${Math.round(move.dx)}px`)
      body.style.setProperty('--afd-dy', `${Math.round(move.dy)}px`)
      body.style.setProperty('--afd-s', move.scale.toFixed(3))
      // mid-scroll (an older look at the corner) the label can only fold and the greeting waits
      setLayout(previous => {
        const label =
          showLabel({
            placement,
            wide: !!geometry.label,
            atTop: window.scrollY < LABEL_TOP,
            labelClear: placement === 'dock' ? flags.dockLabelClear : flags.labelClear,
          }) &&
          (judged || (previous.label && previous.placement === placement))
        const greetOk = judged && greetingAllowed({ placement, greetClear: flags.greetClear })
        return previous.placement === placement && previous.label === label && previous.greetOk === greetOk
          ? previous
          : { placement, label, greetOk }
      })
      measuredOnce.current = true
    }

    let frame = 0
    let idle = 0
    const onScroll = () => {
      // mid-scroll: positions follow (zone / top changes, the sticky sidebar) with the last sample — no flicker
      if (!frame)
        frame = window.requestAnimationFrame(() => {
          frame = 0
          run(false)
        })
      // scrolling rests: look under the corner again
      window.clearTimeout(idle)
      idle = window.setTimeout(() => run(true), 140)
    }
    const onResize = () => {
      window.clearTimeout(idle)
      idle = window.setTimeout(() => run(true), 160)
    }
    // the page grows or shrinks without a scroll (a list arrives from the API, a section expands): look again
    // (its first call only reports the size it starts with)
    let sized = false
    const grow =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (sized) onResize()
            sized = true
          })
    grow?.observe(document.body)
    // a new page renders (lazy routes, images, fonts) before its corner is judged; the first judgement of a visit is
    // taken once it has had a moment to settle, later ones right away
    const timers = (measuredOnce.current ? [0, 350, 1200, 2600] : [350, 1200, 2600]).map(delay =>
      window.setTimeout(() => run(true), delay)
    )
    let alive = true
    // web fonts change line lengths: once they are in (and the page has had its first look), look again
    void document.fonts?.ready.then(() => alive && measuredOnce.current && run(true))
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      alive = false
      timers.forEach(timer => window.clearTimeout(timer))
      window.clearTimeout(idle)
      window.clearTimeout(retry)
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      grow?.disconnect()
    }
  }, [active, route, greeting, buttonRef, bodyRef, labelRef])

  /**
   * Is the greeting's spot clear right now (the shown bubble's own box, or where it would grow)? Content revealed on
   * scroll can arrive after a look at the corner: the launcher asks again before the bubble shows and while it is up.
   */
  const greetingClear = useCallback(
    (bubble?: Element | null) => {
      const button = buttonRef.current
      if (!button) return false
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth
      const rect = bubble
        ? toRect(bubble.getBoundingClientRect())
        : greetRect(toRect(button.getBoundingClientRect()), viewportWidth)
      return underPoints(greetPoints(rect), ownElement(button), UNDER_GREETING) === 'clear'
    },
    [buttonRef]
  )

  return { ...layout, greetingClear }
}
