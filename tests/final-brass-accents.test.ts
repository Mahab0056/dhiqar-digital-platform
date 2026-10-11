// Final pass — the last brass/gold in the UI is brand green: the legacy --brass accent (unread notification edge,
// selected queue row, sign-in/onboarding side panels, trust icons), the retired --brass-* scale (sign-in panel, footer
// trust icons, the «نماذج الوثائق» gallery), the identity camera's "good look" corners and the var() fallbacks.
// Amber is left only where it means a warning (and the printed PDF ornaments are not UI: they are not touched here).
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

type Rule = { media: string[]; selector: string; body: string }

/** Minimal CSS walker: style rules with the @media preludes around them (comments stripped). */
function rules(css: string, media: string[] = []): Rule[] {
  const source = stripComments(css)
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
const decl = (body: string, property: string) =>
  body
    .match(new RegExp(`(?:^|[;{\\s])${property}:\\s*([^;]+);`))?.[1]
    .replace(/\s+/g, ' ')
    .trim()
const rule = (file: string, selector: string, media: string[] = []) => {
  const found = rules(read(file)).find(item => item.selector === selector && item.media.join('|') === media.join('|'))
  expect(found, `${file}: ${selector} ${media.join(' ')}`).toBeDefined()
  return found!
}
/** every declaration of a rule body, custom properties included */
const declarations = (body: string) =>
  [...body.matchAll(/(?:^|;)\s*(--[\w-]+|[a-z-]+)\s*:\s*([^;]+)/g)].map(match => ({
    property: match[1],
    value: match[2].replace(/\s+/g, ' ').trim(),
  }))

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
// both syntaxes: rgba(169, 128, 50, 0.1) and rgb(169 128 50 / 10%) (the «نماذج الوثائق» head glow hid in the latter)
const rgbaHexes = (value: string) =>
  [...value.matchAll(/rgba?\(\s*(\d+)(?:\s*,\s*|\s+)(\d+)(?:\s*,\s*|\s+)(\d+)/g)].map(
    match => `#${[match[1], match[2], match[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('')}`
  )
const colours = (value: string) => [...hexes(value), ...rgbaHexes(value)]

const dsSheets = readdirSync(new URL('../src/styles/ds', import.meta.url))
  .filter(name => name.endsWith('.css'))
  .map(name => `src/styles/ds/${name}`)

describe('the legacy --brass accent (App.css) is a brand green', () => {
  const root = () => {
    const found = rules(read('src/App.css')).filter(item => item.selector === ':root' && decl(item.body, '--brass'))
    expect(found, 'exactly one :root defines --brass').toHaveLength(1)
    return found[0].body
  }

  it('--brass / --brass-pale are greens, and nothing in App.css sets them back', () => {
    const brass = decl(root(), '--brass')!
    const pale = decl(root(), '--brass-pale')!
    for (const value of [brass, pale]) {
      expect(hexes(value), value).toHaveLength(1)
      expect(isGold(value), value).toBe(false)
    }
    expect(isBrandGreen(brass), brass).toBe(true)
    expect(hsl(pale).h).toBeGreaterThanOrEqual(135)
    expect(hsl(pale).h).toBeLessThanOrEqual(170)
    expect(stripComments(read('src/App.css')).match(/--brass\s*:/g)).toHaveLength(1)
    expect(stripComments(read('src/App.css')).toLowerCase()).not.toContain('#af8749')
  })

  it('the markers it paints still stand off the page (3:1) and stay apart from --reed in the two-tone bars', () => {
    const brass = decl(root(), '--brass')!
    const limestone = decl(root(), '--limestone')!
    const reed = decl(root(), '--reed')!
    expect(contrast(brass, limestone)).toBeGreaterThanOrEqual(3)
    expect(contrast(brass, '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(brass.toLowerCase()).not.toBe(reed.toLowerCase())
    expect(luminance(brass)).toBeGreaterThan(luminance(reed))
  })

  it('it is what paints the surfaces the owner pointed at', () => {
    const painted = rules(read('src/App.css'))
      .filter(item => /var\(--brass\)/.test(item.body))
      .flatMap(item => item.selector.split(',').map(part => part.trim()))
    for (const selector of [
      '.citizen-notification-row.unread',
      '.citizen-notifications-full-list .citizen-notification-row.unread',
      '.queue-item.selected',
      '.identity-review-row.selected',
      '.onboarding-aside::before',
      '.login-v3-kicker',
    ])
      expect(painted, selector).toContain(selector)
  })
})

describe('the retired --brass-* scale', () => {
  it('aliases the green scale, so a leftover consumer paints green', () => {
    const root = rules(read('src/styles/ds/tokens.css')).find(
      item => item.selector === ':root' && decl(item.body, '--green-500')
    )!
    for (const step of [50, 100, 200, 300, 400, 500, 600, 700])
      expect(decl(root.body, `--brass-${step}`), `--brass-${step}`).toBe(`var(--green-${step})`)
  })

  it('no stylesheet paints with it any more', () => {
    const sheets = [
      ...dsSheets.filter(file => !file.endsWith('/tokens.css')),
      ...readdirSync(new URL('../src/styles', import.meta.url))
        .filter(name => name.endsWith('.css'))
        .map(name => `src/styles/${name}`),
      'src/App.css',
      'src/index.css',
    ]
    for (const file of sheets) expect(stripComments(read(file)), file).not.toMatch(/var\(--brass-\d+\)/)
  })

  it('sign-in / onboarding side panel, footer trust icons and the document gallery are green', () => {
    expect(decl(rule('src/styles/ds/auth.css', '.auth-aside-kicker').body, 'color')).toBe('var(--green-200)')
    expect(decl(rule('src/styles/ds/auth.css', '.auth-aside li svg').body, 'color')).toBe('var(--green-300)')
    for (const stop of colours(decl(rule('src/styles/ds/auth.css', '.auth-aside::after').body, 'background')!))
      expect(isGold(stop), `side panel glow ${stop}`).toBe(false)
    expect(decl(rule('src/styles/ds/auth.css', '.auth-page').body, 'background')).toContain('var(--green-200)')

    const trust = decl(rule('src/styles/ds/public.css', '.tq-footer-trust svg').body, 'color')
    expect(trust).toBe('var(--green-300)')
    expect(decl(rule('src/styles/ds/public.css', '.tq-utility::after').body, 'background')).not.toMatch(/brass/)

    expect(decl(rule('src/styles/ds/documents.css', '.docs-card-body small').body, 'color')).toBe(
      'var(--ds-primary-text)'
    )
    const chip = rule('src/styles/ds/documents.css', '.docs-service-list button em').body
    expect(decl(chip, 'background')).toBe('var(--ds-primary-soft)')
    expect(decl(chip, 'color')).toBe('var(--ds-primary-text)')
  })

  it('the green trust icons still read on the footer chrome (3:1)', () => {
    const tokens = read('src/styles/ds/tokens.css')
    const value = (name: string) => tokens.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))![1]
    expect(contrast(value('--green-300'), value('--ds-chrome'))).toBeGreaterThanOrEqual(3)
  })
})

describe('identity camera: the frame turns mint, then green — never amber', () => {
  const file = 'src/styles/ds/identity-camera.css'

  it('a good look paints the corners mint, a lock paints them green', () => {
    const shell = rule(file, '.idcam').body
    const mint = decl(shell, '--idc-mint')!
    const green = decl(shell, '--idc-green')!
    for (const value of [mint, green]) {
      expect(isGold(value), value).toBe(false)
      expect(hsl(value).h, value).toBeGreaterThanOrEqual(135)
      expect(hsl(value).h, value).toBeLessThanOrEqual(170)
    }
    expect(decl(rule(file, '.idcam-card-frame.is-good i').body, 'border-color')).toBe('var(--idc-mint)')
    expect(decl(rule(file, '.idcam-card-frame.is-locked i').body, 'border-color')).toBe('var(--idc-green)')
    expect(read(file)).not.toMatch(/--idc-amber/)
  })

  it('the torch and the tap-to-focus ring are not amber either', () => {
    expect(decl(rule(file, '.idcam-torch.is-on').body, 'background')).toBe('var(--idc-green)')
    expect(decl(rule(file, '.idcam-focus').body, 'border')).toBe('2px solid var(--idc-mint)')
  })
})

describe('var() fallbacks', () => {
  it('assistant and documents sheets fall back to greens, not walnut / brass (warnings keep their amber)', () => {
    for (const file of ['src/styles/ds/assistant.css', 'src/styles/ds/documents.css']) {
      const css = stripComments(read(file))
      const fallbacks = [...css.matchAll(/var\(\s*(--[\w-]+)\s*,\s*(#[0-9a-f]{3,6})\b/gi)]
      expect(fallbacks.length, file).toBeGreaterThan(0)
      for (const [, name, colour] of fallbacks) {
        if (/warning/.test(name)) continue
        expect(isGold(colour), `${file}: var(${name}, ${colour})`).toBe(false)
      }
      for (const retired of ['#8a5a2b', '#b07d3c', '#fbf4e8', '#e8c77e', '#c69a42', '#e8cf95'])
        expect(css.toLowerCase(), `${file} ${retired}`).not.toContain(retired)
    }
  })
})

describe('decoration carries no gold; amber is left only on warnings', () => {
  /** where amber still means something: warning tokens and their fallbacks, the degraded "basic" mode dot, the busy
   *  KPI on the drill map, the landing amber pair kept for «يغلق قريباً» and the source caveat, warn tones */
  const allowed = (file: string, selector: string, property: string, value: string) =>
    /var\(--ds-warning/.test(value) ||
    /\.is-basic\b/.test(selector) ||
    /tone-warn|\.ai-meter/.test(selector) ||
    ['--ld-amber', '--ld-amber-soft', '--drill-busy'].includes(property) ||
    (file.endsWith('/tokens.css') && /^--(amber-\d+|ds-warning(-soft)?|ds-chrome-fg)$/.test(property))

  it('every gold colour in the design-system and staff sheets is a warning', () => {
    const offenders: string[] = []
    for (const file of [...dsSheets, 'src/styles/staff.css']) {
      for (const item of rules(read(file))) {
        for (const { property, value } of declarations(item.body)) {
          for (const colour of colours(value)) {
            if (isGold(colour) && !allowed(file, item.selector, property, value))
              offenders.push(`${file}: ${item.selector} { ${property}: ${value} }`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the landing amber pair is only used by statuses and caveats, never as decoration', () => {
    const landing = rules(read('src/styles/ds/landing.css')).filter(item => /var\(--ld-amber/.test(item.body))
    expect(landing.map(item => item.selector)).toEqual([])
    const news = rules(read('src/styles/ds/news.css'))
      .filter(item => /var\(--nw-amber/.test(item.body))
      .map(item => item.selector)
    for (const selector of news) expect(['.nw-status.is-soon', '.ld-tender-news h3 small']).toContain(selector)
    // «إعلان» is a kind tag: brand green
    expect(decl(rule('src/styles/ds/news.css', '.nw-tag').body, 'color')).toBe('var(--nw-accent)')
    expect(decl(rule('src/styles/ds/landing.css', '.ld-panel-icon.is-gold').body, 'color')).toBe('var(--ld-accent)')
  })
})
