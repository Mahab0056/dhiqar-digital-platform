// Round 3 — portal shell: the desktop sidebar fits under the national utility bar (so «تسجيل الخروج» is on screen
// at scroll 0), and the last brass/brown accents (light --ds-accent*, the hero search ring) are brand greens.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

type Rule = { media: string[]; selector: string; body: string }

/** Minimal CSS walker: style rules with the @media preludes around them (comments stripped). */
function rules(css: string, media: string[] = []): Rule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Rule[] = []
  let index = 0
  while (index < source.length) {
    const open = source.indexOf('{', index)
    if (open === -1) break
    const prelude = source.slice(index, open).trim()
    let depth = 1
    let close = open + 1
    while (close < source.length && depth > 0) {
      if (source[close] === '{') depth++
      else if (source[close] === '}') depth--
      close++
    }
    const body = source.slice(open + 1, close - 1)
    if (prelude.startsWith('@media') || prelude.startsWith('@supports')) out.push(...rules(body, [...media, prelude]))
    else if (!prelude.startsWith('@')) out.push({ media, selector: prelude.replace(/\s+/g, ' '), body })
    index = close
  }
  return out
}
/** every value a rule gives a property (a rule may repeat one as a fallback) */
const decls = (body: string, property: string) =>
  [...body.matchAll(new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;]+);`, 'g'))].map(match =>
    match[1].replace(/\s+/g, ' ').trim()
  )
const decl = (body: string, property: string) => decls(body, property).at(-1)
const rule = (file: string, selector: string, media: string[] = []) => {
  const found = rules(read(file)).find(item => item.selector === selector && item.media.join('|') === media.join('|'))
  expect(found, `${file}: ${selector} ${media.join(' ')}`).toBeDefined()
  return found!
}
const TABLET = ['@media (max-width: 1024px)']
const px = (value: string | undefined) => Number(/^(\d+(?:\.\d+)?)px$/.exec(value ?? '')?.[1] ?? NaN)

describe('portal sidebar: the account card and «تسجيل الخروج» are always on screen on desktop', () => {
  const APP = 'src/styles/ds/app.css'

  it('--app-utility-bar is the height of the national utility bar it sits under', () => {
    const bar = px(decl(rule(APP, '.app-shell').body, '--app-utility-bar'))
    const row = px(decl(rule('src/styles/ds/public.css', '.tq-utility-row').body, 'min-height'))
    const border = px(decl(rule('src/styles/ds/public.css', '.tq-utility').body, 'border-bottom')?.split(' ')[0])
    expect(row + border).toBe(bar)
  })

  it('the sticky sidebar is sized to fit under the bar, not a full 100vh that runs past the bottom edge', () => {
    const sidebar = rule(APP, '.app-sidebar').body
    expect(decl(sidebar, 'position')).toBe('sticky')
    expect(decl(sidebar, 'top')).toBe('0')
    const heights = decls(sidebar, 'height')
    expect(heights.length).toBeGreaterThan(0)
    for (const height of heights) expect(height).toMatch(/^calc\(100d?vh - var\(--app-utility-bar\)\)$/)
    // at scroll 0 it starts under the bar and must end exactly at the bottom edge: bar + height = viewport
    expect(decl(rule(APP, '.app-frame').body, 'min-height')).toBe('calc(100vh - var(--app-utility-bar))')
    // the nav takes what is left and scrolls on short screens, so the foot is never pushed out
    const nav = rule(APP, '.app-nav').body
    expect(decl(nav, 'flex')).toBe('1')
    expect(decl(nav, 'overflow-y')).toBe('auto')
  })

  it('no rule anywhere in the shell sheet hard-codes the old 38px bar or a bare 100vh sidebar', () => {
    const css = read(APP).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/100vh - 38px/)
    for (const item of rules(css).filter(entry => entry.selector === '.app-sidebar'))
      expect(decls(item.body, 'height'), item.media.join(' ')).not.toContain('100vh')
  })

  it('the column under the sidebar keeps its surface once the bar has scrolled away (desktop only)', () => {
    const filler = rule(APP, '.app-frame::before').body
    expect(decl(filler, 'content')).toBe("''")
    // same grid cell as the sidebar, painted under it
    expect(decl(filler, 'grid-column')).toBe('1')
    expect(decl(filler, 'grid-row')).toBe('1')
    expect(decl(rule(APP, '.app-sidebar').body, 'grid-column')).toBe('1')
    expect(decl(rule(APP, '.app-sidebar').body, 'grid-row')).toBe('1')
    expect(decl(filler, 'background')).toBe(decl(rule(APP, '.app-sidebar').body, 'background'))
    expect(decl(filler, 'border-inline-end')).toBe(decl(rule(APP, '.app-sidebar').body, 'border-inline-end'))
    expect(decl(rule(APP, '.app-main').body, 'grid-column')).toBe('2')
    // tablets and phones: one column, the sidebar is an off-canvas drawer
    expect(decl(rule(APP, '.app-frame::before', TABLET).body, 'display')).toBe('none')
    expect(decl(rule(APP, '.app-main', TABLET).body, 'grid-column')).toBe('1')
    const drawer = rule(APP, '.app-sidebar', TABLET).body
    expect(decl(drawer, 'position')).toBe('fixed')
    expect(decl(drawer, 'top')).toBe('0')
    expect(decl(drawer, 'bottom')).toBe('0')
    expect(decl(drawer, 'height')).toBe('auto')
  })
})

// ---- colour maths (WCAG 2.x relative luminance, HSL hue) ------------------------------------------
const rgb = (hex: string) => {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? [...value].map(char => char + char).join('') : value
  return [0, 2, 4].map(start => parseInt(full.slice(start, start + 2), 16) / 255)
}
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const hsl = (hex: string) => {
  const [r, g, b] = rgb(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  return { h: (h + 360) % 360, s, l }
}
/** brass / gold / amber / brown: the accent family the owner rejected */
const isGold = (hex: string) => {
  const { h, s, l } = hsl(hex)
  return h >= 22 && h <= 58 && s >= 0.3 && l >= 0.15 && l <= 0.92
}
const isBrandGreen = (hex: string) => {
  const { h, s } = hsl(hex)
  return h >= 135 && h <= 170 && s >= 0.25
}
const hexes = (value: string) => value.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) ?? []
const rgbaHexes = (value: string) =>
  [...value.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)].map(
    match => `#${[match[1], match[2], match[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('')}`
  )

const lightTokens = () => {
  const blocks = rules(read('src/styles/ds/tokens.css')).filter(item => item.selector === ':root')
  const token = (name: string): string => {
    const value = blocks.map(block => decl(block.body, name)).find(Boolean)
    expect(value, name).toBeDefined()
    const ref = /^var\((--[\w-]+)\)$/.exec(value!)
    return ref ? token(ref[1]) : value!
  }
  return token
}

describe('light theme: the accent tokens are brand greens with AA contrast', () => {
  it('--ds-accent / --ds-accent-text are greens, the soft fill is not brass', () => {
    const token = lightTokens()
    for (const name of ['--ds-accent', '--ds-accent-text']) {
      const value = token(name)
      expect(isGold(value), `${name} ${value}`).toBe(false)
      expect(isBrandGreen(value), `${name} ${value}`).toBe(true)
    }
    expect(isGold(token('--ds-accent-soft'))).toBe(false)
    expect(hsl(token('--ds-accent-soft')).h).toBeGreaterThanOrEqual(135)
    expect(hsl(token('--ds-accent-soft')).h).toBeLessThanOrEqual(175)
    const css = read('src/styles/ds/tokens.css').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const retired of ['#b07d3c', '#8a5a2b', '#fbf4e8']) expect(css.toLowerCase()).not.toContain(retired)
  })

  it('every place the accent is used still reads: text AA on its grounds, the rule 3:1 on cards', () => {
    const token = lightTokens()
    const text = token('--ds-accent-text')
    // badges / status pills / channel tags / reminder icon (on the soft fill); the 404 code (on the page); the AI
    // review icon and draft flag (soft fill fading into the card surface)
    for (const ground of [
      token('--ds-accent-soft'),
      token('--ds-bg'),
      token('--ds-surface'),
      token('--ds-surface-muted'),
      token('--ds-surface-sunken'),
    ])
      expect(contrast(text, ground), `accent text on ${ground}`).toBeGreaterThanOrEqual(4.5)
    // «قيد المراجعة» request card: the accent as its inline-start rule on the white card
    expect(contrast(token('--ds-accent'), token('--ds-surface'))).toBeGreaterThanOrEqual(3)
    expect(contrast(token('--ds-accent'), token('--ds-bg'))).toBeGreaterThanOrEqual(3)
  })

  it('«قيد المراجعة» pills stay distinguishable from the success green', () => {
    const token = lightTokens()
    expect(token('--ds-accent-text').toLowerCase()).not.toBe(token('--ds-success').toLowerCase())
    expect(token('--ds-accent-soft').toLowerCase()).not.toBe(token('--ds-success-soft').toLowerCase())
    expect(token('--ds-accent').toLowerCase()).not.toBe(token('--ds-success').toLowerCase())
  })
})

describe('landing hero: the search field ring runs in greens, no gold', () => {
  it('the ring gradient has no brass stop', () => {
    // the painted ring only (its mask is a plain black alpha layer)
    const ring = decl(rule('src/styles/ds/landing.css', '.ld-hero-search .tq-search::before').body, 'background')!
    expect(ring).toMatch(/^conic-gradient\(/)
    const stops = [...hexes(ring), ...rgbaHexes(ring)]
    expect(stops.length).toBeGreaterThanOrEqual(2)
    for (const stop of stops) {
      expect(isGold(stop), `ring stop ${stop}`).toBe(false)
      expect(hsl(stop).h, `ring stop ${stop}`).toBeGreaterThanOrEqual(135)
      expect(hsl(stop).h, `ring stop ${stop}`).toBeLessThanOrEqual(170)
    }
    expect(read('src/styles/ds/landing.css').toLowerCase()).not.toContain('#e8c77e')
  })
})
