/**
 * Where the أفندي launcher sits, so it never hides what the citizen came for.
 *
 * The launcher floats over the bottom inline-start corner of every page. Past a page's first screen that is the usual
 * floating button: the content scrolls under it and the end of every layout has room for it (afandi.css). The first
 * screen is different — it is composed (the hero's search and quick actions, a sign-in form's first fields, the
 * portal's «تابع معاملاتك») and nothing can scroll out from under the orb there. So, on the first screen, the launcher
 * looks at what is under its corner (`document.elementsFromPoint`) and steps aside:
 *
 *   normal  the orb in its corner — the spot is clear (or the page is past its first screen)
 *   mini    a smaller orb tucked into the very corner — the normal spot covers content, the tucked one does not
 *   hidden  out of the way (still reachable with Tab: focus brings it back) — even the tucked orb would cover content
 *   dock    citizen portal on desktop: the orb lives in the sidebar's free band above the account card, never over the
 *           page itself
 *
 * The «أفندي · اسألني» label only unfolds at the very top of a page, on a wide screen, where it covers nothing (and on
 * hover / keyboard focus). The greeting bubble never sits over a control, field, link or heading (greetingAllowed).
 * Decisions are taken when scrolling rests (never mid-scroll: no flicker while the hero's tiles pass under the
 * corner).
 */
export type Rect = { left: number; top: number; width: number; height: number }
export type Point = { x: number; y: number }
export type Placement = 'normal' | 'mini' | 'hidden' | 'dock'

/** The first screen: until the page has scrolled this share of the viewport height, the launcher keeps it clear. */
export const FIRST_SCREEN = 0.6
/** The label unfolds only this close to the top of the page («icon only on scroll»). */
export const LABEL_TOP = 24
/** The tucked orb: size and its gap to the viewport edges. */
export const MINI_SIZE = 44
export const MINI_GAP = 8
/** The orb docked in the portal sidebar: gap to the sidebar's outer edge and above the account card. */
export const DOCK_SIDE_GAP = 20
export const DOCK_FOOT_GAP = 14
/** The greeting bubble (afandi.css .afd-greet): width, gap above the orb, a generous height estimate. */
export const GREET_WIDTH = 340
export const GREET_GAP = 18
export const GREET_HEIGHT = 210

export type PlacementFlags = {
  /** the page is within its first screen */
  inZone: boolean
  /** null: no sidebar to dock into; else whether the docked spot is clear */
  dockClear: boolean | null
  normalClear: boolean
  miniClear: boolean
}

export function choosePlacement({ inZone, dockClear, normalClear, miniClear }: PlacementFlags): Placement {
  if (dockClear) return 'dock'
  if (!inZone || normalClear) return 'normal'
  if (miniClear) return 'mini'
  return 'hidden'
}

/** The «أفندي · اسألني» label: wide screens, at the top of the page, where it covers nothing; always beside a docked orb. */
export function showLabel(options: { placement: Placement; wide: boolean; atTop: boolean; labelClear: boolean }) {
  const { placement, wide, atTop, labelClear } = options
  if (!wide || !labelClear) return false
  return placement === 'dock' || (placement === 'normal' && atTop)
}

/**
 * The greeting grows out of an orb in its normal spot, and only where the bubble covers no control, field, link or
 * heading — not the hero's search and quick actions, not «تابع معاملاتك», not a list of services. Where a page has
 * no such moment the greeting simply does not come (the label beside the orb still says «أفندي · اسألني»).
 */
export function greetingAllowed(options: { placement: Placement; greetClear: boolean }) {
  return options.placement === 'normal' && options.greetClear
}

// ---- geometry -------------------------------------------------------------------------------------------------
export const rightSide = (rect: Rect, viewportWidth: number) => rect.left + rect.width / 2 > viewportWidth / 2

/**
 * The tucked orb: in the same bottom corner, `gap` from the side edge and from `floor` (the viewport bottom, or the
 * top of the portal's phone bottom bar).
 */
export function miniRect(normal: Rect, viewport: { width: number; floor: number }, size = MINI_SIZE, gap = MINI_GAP) {
  const right = rightSide(normal, viewport.width)
  return {
    left: right ? viewport.width - gap - size : gap,
    top: viewport.floor - gap - size,
    width: size,
    height: size,
  }
}

/** The orb docked in a sidebar: `sideGap` from the sidebar's outer edge, `footGap` above the account card. */
export function dockRect(normal: Rect, sidebar: Rect, footTop: number, viewportWidth: number) {
  const right = rightSide(sidebar, viewportWidth)
  const size = normal.width
  return {
    left: right ? sidebar.left + sidebar.width - DOCK_SIDE_GAP - size : sidebar.left + DOCK_SIDE_GAP,
    top: footTop - DOCK_FOOT_GAP - size,
    width: size,
    height: size,
  }
}

/** Where the greeting bubble would sit above an orb in its normal spot. */
export function greetRect(normal: Rect, viewportWidth: number): Rect {
  const width = Math.min(GREET_WIDTH, viewportWidth - 32)
  const right = rightSide(normal, viewportWidth)
  const bottom = normal.top - GREET_GAP
  return {
    left: right ? normal.left + normal.width - width : normal.left,
    top: bottom - GREET_HEIGHT,
    width,
    height: GREET_HEIGHT,
  }
}

/** translate + scale (transform-origin 0 0) that carries `from` onto `to`. */
export function transformBetween(from: Rect, to: Rect) {
  return { dx: to.left - from.left, dy: to.top - from.top, scale: from.width ? to.width / from.width : 1 }
}

/**
 * Sample points of a round orb: the centre, a ring halfway out, and a ring `clearance` px outside its edge (nothing
 * should touch the orb either). Its square corners are air and are not sampled.
 */
export function circlePoints(rect: Rect, clearance = 4): Point[] {
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const r = Math.min(rect.width, rect.height) / 2
  const points: Point[] = [{ x: cx, y: cy }]
  for (const radius of [r * 0.55, r + clearance])
    for (let step = 0; step < 8; step++) {
      const angle = (step * Math.PI) / 4
      points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) })
    }
  return points
}

/** Sample points spread over a rectangle (a label, a greeting bubble), `inset` px inside its edges (negative: outside). */
export function gridPoints(rect: Rect, columns: number, rows: number, inset = 4): Point[] {
  const points: Point[] = []
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const fx = columns === 1 ? 0.5 : column / (columns - 1)
      const fy = rows === 1 ? 0.5 : row / (rows - 1)
      points.push({
        x: rect.left + inset + fx * Math.max(0, rect.width - 2 * inset),
        y: rect.top + inset + fy * Math.max(0, rect.height - 2 * inset),
      })
    }
  return points
}

/**
 * Sample points no further apart than `step` px (a 36 px button or a 16 px line of text cannot slip between them),
 * `inset` px inside the rectangle's edges (negative: outside).
 */
export function densePoints(rect: Rect, step: { x: number; y: number }, inset = 0): Point[] {
  const span = (size: number, gap: number) => Math.max(2, Math.ceil(Math.max(0, size - 2 * inset) / gap) + 1)
  return gridPoints(rect, span(rect.width, step.x), span(rect.height, step.y), inset)
}

// ---- what is under a point ---------------------------------------------------------------------------------------
/** Things the citizen acts on or reads first: controls, fields, links, headings. */
export const CONTROL_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  'label',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="searchbox"]',
  '[contenteditable="true"]',
  'h1',
  'h2',
  'h3',
  'video',
  'iframe',
].join(', ')
/** Text the orb would sit on. */
export const TEXT_SELECTOR = 'p, li, dt, dd, td, th, blockquote, figcaption'

export type ContentKinds = { text: boolean; cards: boolean }

/** Alpha of a computed CSS colour (`rgb()`, `rgba()`, or a modern `… / a)` form); 1 when it has none. */
export function colorAlpha(value: string): number {
  const color = value.trim()
  if (!color || color === 'transparent') return 0
  const slash = color.match(/\/\s*([\d.]+)(%?)\s*\)$/)
  if (slash) return slash[2] ? parseFloat(slash[1]) / 100 : parseFloat(slash[1])
  const rgba = color.match(/^rgba\(([^)]+)\)$/)
  if (rgba) {
    const parts = rgba[1].split(',')
    if (parts.length === 4) return parseFloat(parts[3])
  }
  return 1
}
const visibleColor = (value: string) => colorAlpha(value) > 0.05

/** A bounded box with a visible frame (a card, a stats panel) — not a full-bleed section or the page background. */
export function isCardLike(element: Element, viewport: { width: number; height: number }) {
  const rect = element.getBoundingClientRect()
  if (rect.width < 40 || rect.height < 32 || rect.width >= viewport.width - 8 || rect.height >= viewport.height * 0.9)
    return false
  const style = getComputedStyle(element)
  const border = (['Top', 'Right', 'Bottom', 'Left'] as const).filter(
    side =>
      parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 &&
      style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none' &&
      visibleColor(style.getPropertyValue(`border-${side.toLowerCase()}-color`))
  ).length
  if (border >= 2) return true
  return visibleColor(style.backgroundColor) && style.boxShadow !== 'none' && style.boxShadow !== ''
}

/** Is the point on a line of text that is a direct child of this element (any tag: a footer's «© 2026», a badge)? */
export function onText(element: Element, point: Point, slack = 2) {
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType !== 3 || !node.textContent?.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const box of Array.from(range.getClientRects()))
      if (
        point.x >= box.left - slack &&
        point.x <= box.right + slack &&
        point.y >= box.top - slack &&
        point.y <= box.bottom + slack
      )
        return true
  }
  return false
}

/** A fixed layer over the whole viewport (the home intro splash, a modal backdrop): the page itself is not visible. */
export function isOverlay(element: Element, viewport: { width: number; height: number }) {
  if (getComputedStyle(element).position !== 'fixed') return false
  const rect = element.getBoundingClientRect()
  return rect.width >= viewport.width * 0.9 && rect.height >= viewport.height * 0.9
}

/**
 * What is at this viewport point, ignoring أفندي's own elements? The topmost element under the point and its
 * ancestors are checked: a control or heading is always content; text and framed cards are when asked. «covered»:
 * an overlay hides the page for now (the judgement waits for it to go).
 */
export type Under = 'clear' | 'content' | 'covered'
export function underPoint(point: Point, own: (element: Element) => boolean, kinds: ContentKinds): Under {
  const viewport = { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight }
  if (point.x < 0 || point.y < 0 || point.x >= viewport.width || point.y >= viewport.height) return 'clear'
  const top = document.elementsFromPoint(point.x, point.y).find(element => !own(element))
  const chain: Element[] = []
  for (let element: Element | null = top ?? null; element; element = element.parentElement) {
    if (element === document.body || element === document.documentElement) break
    chain.push(element)
  }
  if (chain.some(element => isOverlay(element, viewport))) return 'covered'
  if (kinds.text && top && onText(top, point)) return 'content'
  for (const element of chain) {
    if (element.matches(CONTROL_SELECTOR)) return 'content'
    if (kinds.text && element.matches(TEXT_SELECTOR)) return 'content'
    if (kinds.cards && isCardLike(element, viewport)) return 'content'
  }
  return 'clear'
}

/** The worst of a set of points: covered (judge later) › content › clear. */
export function underPoints(points: Point[], own: (element: Element) => boolean, kinds: ContentKinds): Under {
  let result: Under = 'clear'
  for (const point of points) {
    const under = underPoint(point, own, kinds)
    if (under === 'covered') return 'covered'
    if (under === 'content') result = 'content'
  }
  return result
}
