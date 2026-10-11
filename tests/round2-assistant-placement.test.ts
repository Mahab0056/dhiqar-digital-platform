// أفندي's launcher never hides what the citizen came for (afandi/placement.ts + useLauncherPlacement.ts): on a page's
// first screen it tucks into the corner or steps aside (the hero's «حجز موعد» tile on a phone, the stats card corner
// at 1440×900, the hero quick actions at 1280×720), it docks in the portal sidebar instead of covering
// «تابع معاملاتك», its label unfolds only where it covers nothing, and the greeting bubble never sits over a control,
// field, link or heading. The DOM sampling is checked against a fake document (no browser in vitest).
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  choosePlacement,
  circlePoints,
  colorAlpha,
  dockRect,
  FIRST_SCREEN,
  greetingAllowed,
  greetRect,
  gridPoints,
  miniRect,
  showLabel,
  transformBetween,
  underPoint,
  underPoints,
  type Point,
  type Rect,
} from '../src/components/assistant/afandi/placement'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('where the launcher sits', () => {
  it('docks in the portal sidebar when its free band is clear — even past the first screen', () => {
    expect(choosePlacement({ inZone: true, dockClear: true, normalClear: false, miniClear: false })).toBe('dock')
    expect(choosePlacement({ inZone: false, dockClear: true, normalClear: true, miniClear: true })).toBe('dock')
  })

  it('on the first screen: its corner if clear, else tucked into the very corner, else out of the way', () => {
    expect(choosePlacement({ inZone: true, dockClear: null, normalClear: true, miniClear: true })).toBe('normal')
    // 1440×900 / 1280×720 homepage: the stats card / «حجز موعد» under the corner, the tucked orb fits
    expect(choosePlacement({ inZone: true, dockClear: null, normalClear: false, miniClear: true })).toBe('mini')
    // 390×844 homepage: the quick-action tiles fill the corner — the orb waits until the hero is scrolled past
    expect(choosePlacement({ inZone: true, dockClear: null, normalClear: false, miniClear: false })).toBe('hidden')
    // a sidebar band that is too crowded is not used
    expect(choosePlacement({ inZone: true, dockClear: false, normalClear: false, miniClear: true })).toBe('mini')
  })

  it('past the first screen it is the usual floating button (the end of every layout has room for it)', () => {
    expect(choosePlacement({ inZone: false, dockClear: null, normalClear: false, miniClear: false })).toBe('normal')
    expect(FIRST_SCREEN).toBeGreaterThan(0.3)
    expect(FIRST_SCREEN).toBeLessThanOrEqual(1)
  })

  it('the label is «icon only» on phones and once scrolled, and unfolds only where it covers nothing', () => {
    const at = (
      placement: Parameters<typeof showLabel>[0]['placement'],
      wide = true,
      atTop = true,
      labelClear = true
    ) => showLabel({ placement, wide, atTop, labelClear })
    expect(at('normal')).toBe(true)
    expect(at('normal', false)).toBe(false) // phone: never
    expect(at('normal', true, false)).toBe(false) // scrolled: icon only
    expect(at('normal', true, true, false)).toBe(false) // the stats card corner under it
    expect(at('mini')).toBe(false)
    expect(at('hidden')).toBe(false)
    expect(at('dock', true, false)).toBe(true) // beside the docked orb it covers nothing at any scroll
    expect(at('dock', true, false, false)).toBe(false)
  })

  it('the greeting only grows out of an orb in its corner, where the bubble covers no control', () => {
    expect(greetingAllowed({ placement: 'normal', greetClear: true })).toBe(true)
    // «تابع معاملاتك» and its first row / the hero's search and quick actions under the bubble
    expect(greetingAllowed({ placement: 'normal', greetClear: false })).toBe(false)
    for (const placement of ['mini', 'hidden', 'dock'] as const)
      expect(greetingAllowed({ placement, greetClear: true })).toBe(false)
  })
})

describe('geometry', () => {
  const desktop: Rect = { left: 1200, top: 640, width: 60, height: 60 } // 1280×720, bottom-right in RTL

  it('tucks the orb into the same corner, above the portal bottom bar on phones', () => {
    expect(miniRect(desktop, { width: 1280, floor: 720 })).toEqual({ left: 1228, top: 668, width: 44, height: 44 })
    const phone: Rect = { left: 322, top: 712, width: 54, height: 54 }
    // the floor is the bottom bar's top edge
    expect(miniRect(phone, { width: 390, floor: 780 })).toEqual({ left: 338, top: 728, width: 44, height: 44 })
    // an LTR page: the orb lives in the left corner
    expect(miniRect({ left: 20, top: 640, width: 60, height: 60 }, { width: 1280, floor: 720 }).left).toBe(8)
  })

  it('docks above the sidebar account card, inside the sidebar', () => {
    const sidebar: Rect = { left: 1008, top: 38, width: 272, height: 720 }
    const dock = dockRect({ left: 928, top: 640, width: 60, height: 60 }, sidebar, 610, 1280)
    expect(dock).toEqual({ left: 1200, top: 536, width: 60, height: 60 })
    expect(dock.left).toBeGreaterThanOrEqual(sidebar.left)
    expect(dock.top + dock.height).toBeLessThan(610)
  })

  it('places the greeting estimate above the orb, aligned with its corner and within the viewport', () => {
    const greet = greetRect({ left: 1360, top: 820, width: 60, height: 60 }, 1440)
    expect(greet.left + greet.width).toBe(1420)
    expect(greet.top + greet.height).toBe(820 - 18)
    const phone = greetRect({ left: 322, top: 776, width: 54, height: 54 }, 390)
    expect(phone.left).toBeGreaterThanOrEqual(16)
    expect(phone.width).toBeLessThanOrEqual(390 - 32)
  })

  it('moves the body with one translate + scale from its corner', () => {
    expect(transformBetween(desktop, { left: 1228, top: 668, width: 44, height: 44 })).toEqual({
      dx: 28,
      dy: 28,
      scale: 44 / 60,
    })
    expect(transformBetween(desktop, desktop)).toEqual({ dx: 0, dy: 0, scale: 1 })
  })

  it('samples the round orb (centre, inside, and a few px outside its edge) — not its square corners', () => {
    const points = circlePoints({ left: 0, top: 0, width: 60, height: 60 }, 4)
    expect(points).toHaveLength(17)
    expect(points[0]).toEqual({ x: 30, y: 30 })
    const far = Math.max(...points.map(point => Math.hypot(point.x - 30, point.y - 30)))
    expect(far).toBeCloseTo(34, 5)
    // the square's corners (42 px out) are air around a round orb: never sampled
    expect(points.every(point => Math.hypot(point.x - 30, point.y - 30) <= 34 + 1e-9)).toBe(true)
    expect(points.some(point => point.x < 5 && point.y < 5)).toBe(false)
  })

  it('samples a label with a margin around it', () => {
    const points = gridPoints({ left: 100, top: 100, width: 170, height: 48 }, 7, 3, -4)
    expect(points).toHaveLength(21)
    expect(Math.min(...points.map(point => point.x))).toBe(96)
    expect(Math.max(...points.map(point => point.y))).toBe(152)
  })

  it('reads the alpha of computed colours', () => {
    expect(colorAlpha('rgba(0, 0, 0, 0)')).toBe(0)
    expect(colorAlpha('rgb(0, 0, 0)')).toBe(1) // black is a colour, not transparency
    expect(colorAlpha('rgba(255, 255, 255, 0.12)')).toBeCloseTo(0.12)
    expect(colorAlpha('transparent')).toBe(0)
    expect(colorAlpha('oklab(0.5 0.1 0.1 / 0.4)')).toBeCloseTo(0.4)
    expect(colorAlpha('color(srgb 1 1 1 / 50%)')).toBeCloseTo(0.5)
  })
})

// ---- a fake page for elementsFromPoint ----------------------------------------------------------------------
type FakeStyle = Partial<Record<string, string>>
class FakeElement {
  parentElement: FakeElement | null = null
  childNodes: { nodeType: number; textContent: string; rects?: Rect[] }[] = []
  constructor(
    public tag: string,
    public rect: Rect,
    public style: FakeStyle = {},
    public attrs: Record<string, string> = {}
  ) {}
  child(element: FakeElement) {
    element.parentElement = this
    return element
  }
  text(content: string, rects: Rect[]) {
    this.childNodes.push({ nodeType: 3, textContent: content, rects })
    return this
  }
  getBoundingClientRect() {
    const { left, top, width, height } = this.rect
    return { left, top, width, height, right: left + width, bottom: top + height }
  }
  matches(selectors: string) {
    return selectors.split(',').some(raw => {
      const selector = raw.trim()
      if (selector === this.tag) return true
      if (selector === 'a[href]') return this.tag === 'a' && 'href' in this.attrs
      if (selector.startsWith('input')) return this.tag === 'input' && this.attrs.type !== 'hidden'
      const role = selector.match(/^\[role="([^"]+)"\]$/)
      return !!role && this.attrs.role === role[1]
    })
  }
}

const globals = globalThis as unknown as Record<string, unknown>
let stack: FakeElement[] = []
const body = new FakeElement('body', { left: 0, top: 0, width: 1440, height: 900 })
const contains = (box: Rect, point: Point) =>
  point.x >= box.left && point.x <= box.left + box.width && point.y >= box.top && point.y <= box.top + box.height

beforeEach(() => {
  stack = []
  globals.window = { innerWidth: 1440, innerHeight: 900 }
  globals.document = {
    body,
    documentElement: { clientWidth: 1440 },
    elementsFromPoint: (x: number, y: number) => stack.filter(element => contains(element.rect, { x, y })),
    createRange: () => {
      let node: { rects?: Rect[] } | null = null
      return {
        selectNodeContents: (target: { rects?: Rect[] }) => (node = target),
        getClientRects: () =>
          (node?.rects ?? []).map(box => ({ ...box, right: box.left + box.width, bottom: box.top + box.height })),
      }
    },
  }
  globals.getComputedStyle = (element: FakeElement) => {
    const style = element.style
    return {
      position: style.position ?? 'static',
      backgroundColor: style.backgroundColor ?? 'rgba(0, 0, 0, 0)',
      boxShadow: style.boxShadow ?? 'none',
      getPropertyValue: (name: string) =>
        style[name] ??
        (name.endsWith('-width')
          ? '0px'
          : name.endsWith('-style')
            ? 'none'
            : name.endsWith('-color')
              ? 'rgb(0, 0, 0)'
              : ''),
    }
  }
})
afterEach(() => {
  delete globals.window
  delete globals.document
  delete globals.getComputedStyle
})

const framed = (color = 'rgba(255, 255, 255, 0.12)'): FakeStyle =>
  Object.fromEntries(
    ['top', 'right', 'bottom', 'left'].flatMap(side => [
      [`border-${side}-width`, '1px'],
      [`border-${side}-style`, 'solid'],
      [`border-${side}-color`, color],
    ])
  )

describe('what is under the corner', () => {
  const orb = { text: true, cards: true }
  const bubble = { text: false, cards: false }
  const own = (element: Element) => (element as unknown as FakeElement).tag === 'afd'

  it('a control (the hero quick action «حجز موعد») is content; the hero background is not', () => {
    const hero = body.child(new FakeElement('section', { left: 0, top: 0, width: 1440, height: 900 }))
    const link = hero.child(new FakeElement('a', { left: 1180, top: 640, width: 100, height: 50 }, {}, { href: '/' }))
    const icon = link.child(new FakeElement('svg', { left: 1190, top: 650, width: 20, height: 20 }))
    stack = [icon, link, hero]
    expect(underPoint({ x: 1195, y: 655 }, own, bubble)).toBe('content')
    expect(underPoint({ x: 600, y: 300 }, own, orb)).toBe('clear')
  })

  it('skips أفندي’s own orb on top of the page', () => {
    const hero = body.child(new FakeElement('section', { left: 0, top: 0, width: 1440, height: 900 }))
    const button = hero.child(new FakeElement('button', { left: 1340, top: 800, width: 90, height: 90 }))
    const disc = body.child(new FakeElement('afd', { left: 1360, top: 820, width: 60, height: 60 }))
    stack = [disc, button, hero]
    expect(underPoint({ x: 1390, y: 850 }, own, orb)).toBe('content')
    stack = [disc, hero]
    expect(underPoint({ x: 1390, y: 850 }, own, orb)).toBe('clear')
  })

  it('a framed card (the hero stats card) counts under the orb, not under the passing bubble', () => {
    const card = body.child(new FakeElement('div', { left: 916, top: 743, width: 466, height: 90 }, framed()))
    stack = [card]
    expect(underPoint({ x: 1370, y: 828 }, own, orb)).toBe('content')
    expect(underPoint({ x: 1370, y: 828 }, own, bubble)).toBe('clear')
    // a transparent border is no frame; a full-bleed section is no card
    stack = [
      body.child(new FakeElement('div', { left: 916, top: 743, width: 466, height: 90 }, framed('rgba(0, 0, 0, 0)'))),
    ]
    expect(underPoint({ x: 1370, y: 828 }, own, orb)).toBe('clear')
    stack = [body.child(new FakeElement('section', { left: 0, top: 600, width: 1440, height: 300 }, framed()))]
    expect(underPoint({ x: 1370, y: 828 }, own, orb)).toBe('clear')
  })

  it('a line of text in any tag (the footer «© 2026 محافظة ذي قار») counts under the orb', () => {
    const foot = body.child(new FakeElement('footer', { left: 0, top: 852, width: 1440, height: 48 }))
    const small = foot.child(new FakeElement('small', { left: 1250, top: 870, width: 130, height: 18 }))
    small.text('© 2026 محافظة ذي قار', [{ left: 1257, top: 871, width: 120, height: 17 }])
    stack = [small, foot]
    expect(underPoint({ x: 1300, y: 878 }, own, orb)).toBe('content')
    expect(underPoint({ x: 1252, y: 878 }, own, orb)).toBe('clear') // beside the text, inside its box
    expect(underPoint({ x: 1300, y: 878 }, own, bubble)).toBe('clear')
  })

  it('an overlay over the whole page (the home intro splash) defers the judgement', () => {
    const splash = body.child(
      new FakeElement('div', { left: 0, top: 0, width: 1440, height: 900 }, { position: 'fixed' })
    )
    const skip = splash.child(new FakeElement('button', { left: 1300, top: 820, width: 100, height: 40 }))
    stack = [skip, splash]
    expect(underPoint({ x: 1350, y: 840 }, own, orb)).toBe('covered')
    const card = body.child(new FakeElement('a', { left: 0, top: 0, width: 200, height: 200 }, {}, { href: '/' }))
    stack = [card]
    // covered beats content beats clear
    const points = [
      { x: 10, y: 10 },
      { x: 1350, y: 840 },
    ]
    expect(underPoints(points, own, orb)).toBe('content')
    stack = [skip, splash, card]
    expect(underPoints(points, own, orb)).toBe('covered')
  })

  it('points outside the viewport are clear', () => {
    expect(underPoint({ x: -2, y: 10 }, own, orb)).toBe('clear')
    expect(underPoint({ x: 1440, y: 10 }, own, orb)).toBe('clear')
    expect(underPoint({ x: 10, y: 900 }, own, orb)).toBe('clear')
  })
})

describe('launcher styles and wiring', () => {
  const css = read('src/styles/ds/afandi.css')
  const rule = (selector: string) => {
    // a rule of its own (not the selector's tail inside a longer one)
    const index = css.indexOf(`\n${selector} {`)
    expect(index, selector).toBeGreaterThan(-1)
    return css.slice(index, css.indexOf('}', index))
  }

  it('the button stays in the corner and takes no hits; its body moves and takes them', () => {
    expect(rule('.dqa-launcher.afd-launcher')).toMatch(/pointer-events:\s*none/)
    const bodyRule = rule('.afd-launcher__body')
    expect(bodyRule).toMatch(/pointer-events:\s*auto/)
    expect(bodyRule).toMatch(
      /transform:\s*translate\(var\(--afd-dx, 0px\), var\(--afd-dy, 0px\)\) scale\(var\(--afd-s, 1\)\)/
    )
    expect(css).toMatch(
      /\.afd-launcher:is\(\[data-place='pending'\], \[data-place='hidden'\]\) \.afd-launcher__body \{\s*opacity:\s*0;\s*pointer-events:\s*none;/
    )
    // Tab still reaches a stepped-aside orb: focus brings it back
    expect(css).toMatch(
      /\.afd-launcher:is\(\[data-place='pending'\], \[data-place='hidden'\]\):focus-visible \.afd-launcher__body \{\s*opacity:\s*1;/
    )
  })

  it('the label is out of the flow and folded unless unfolded on purpose', () => {
    const label = rule('.afd-launcher__label')
    expect(label).toMatch(/position:\s*absolute/)
    expect(label).toMatch(/visibility:\s*hidden/)
    expect(label).toMatch(/pointer-events:\s*none/)
    expect(css).toMatch(/\.afd-launcher:not\(\.is-greeting\)\[data-label\] \.afd-launcher__label/)
    expect(css).toMatch(/@media \(hover: hover\)/)
  })

  it('end-of-page room and scroll padding keep controls out of the corner', () => {
    expect(css).toMatch(
      /body:has\(\.afd-launcher\) :is\(\.auth-foot, \.tq-footer, \.portal-content\) \{\s*padding-bottom:/
    )
    expect(css).toMatch(/body:has\(\.afd-launcher\) \.auth-foot-row \{\s*padding-inline-start:/)
    expect(css).toMatch(/html:has\(\.afd-launcher\) \{\s*scroll-padding-bottom:/)
  })

  it('the launcher wires the placement, and the greeting waits for a clear moment', () => {
    const launcher = read('src/components/assistant/AssistantLauncher.tsx')
    expect(launcher).toMatch(/useLauncherPlacement\(/)
    expect(launcher).toMatch(/data-place=\{layout\.placement \?\? 'pending'\}/)
    expect(launcher).toMatch(/className="afd-launcher__body"/)
    expect(launcher).toMatch(/if \(!wanted \|\| !greetOk/)
    // looked at again before it shows (content revealed on scroll) and while it is up
    expect(launcher).toMatch(/canGreet\(location\) !== wanted \|\| !greetingClear\(\)/)
    expect(launcher).toMatch(/if \(!greetingClear\(document\.querySelector\('\.afd-greet'\)\)\) closeGreeting\(false\)/)
    const hook = read('src/components/assistant/afandi/useLauncherPlacement.ts')
    // mid-scroll an older look never unfolds the label nor lets the greeting in
    expect(hook).toMatch(/const greetOk =\s*judged &&/)
  })
})
