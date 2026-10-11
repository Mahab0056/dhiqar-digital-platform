import { readFileSync, readdirSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { voicePrivacyFacts } from '../server/assistant/knowledge'
import { setSpeechProvider } from '../server/assistant/speech'

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

const darkTokens = () => {
  const block = rules(read('src/styles/ds/tokens.css')).find(item => item.selector === ":root[data-gov-theme='dark']")
  expect(block).toBeDefined()
  const token = (name: string) => {
    const value = decl(block!.body, name)
    expect(value, name).toBeDefined()
    return value!
  }
  return token
}

describe('round 2 design: staff shell — workspace tab bar', () => {
  it('sticks below the sticky app top bar (a CSS var of its height), never behind it', () => {
    const shell = rule('src/styles/ds/app.css', '.app-shell')
    expect(decl(shell.body, '--app-topbar')).toMatch(/^\d+px$/)
    const topbar = rule('src/styles/ds/app.css', '.app-topbar')
    expect(decl(topbar.body, 'position')).toBe('sticky')
    expect(decl(topbar.body, 'top')).toBe('0')
    expect(decl(topbar.body, 'min-height')).toBe('var(--app-topbar)')

    const bar = rule('src/styles/ds/staff-surfaces.css', '.app-shell .workspace-tabbar')
    expect(decl(bar.body, 'position')).toBe('sticky')
    expect(decl(bar.body, 'top')).toMatch(/var\(--app-topbar\)/)
    // under the top bar in the stacking order, so a stuck bar can never paint over the header either
    expect(Number(decl(bar.body, 'z-index'))).toBeLessThan(Number(decl(topbar.body, 'z-index')))
    // opaque: content scrolling underneath never shows through the tabs
    expect(decl(bar.body, 'background-color')).toBe('var(--ds-surface)')
    // the strip between the top bar and the stuck tabs is painted in the page colour
    const skirt = rule('src/styles/ds/staff-surfaces.css', '.app-shell .workspace-tabbar::before')
    expect(decl(skirt.body, 'background')).toBe('var(--ds-bg)')
    expect(decl(skirt.body, 'height')).toBe('var(--workspace-tabbar-gap)')

    // the legacy base rule also offsets by the bar height (0 outside the app shell)
    const legacy = rule('src/styles/staff.css', '.workspace-tabbar')
    expect(decl(legacy.body, 'top')).toBe('var(--app-topbar, 0px)')
  })

  it('no stylesheet pins the tab bar at top: 0 any more', () => {
    const files = [
      'src/App.css',
      'src/index.css',
      ...readdirSync(new URL('../src/styles', import.meta.url))
        .filter(name => name.endsWith('.css'))
        .map(name => `src/styles/${name}`),
      ...readdirSync(new URL('../src/styles/ds', import.meta.url))
        .filter(name => name.endsWith('.css'))
        .map(name => `src/styles/ds/${name}`),
    ]
    for (const file of files) {
      for (const item of rules(read(file)).filter(entry => /workspace-tabbar(?![\w-])(?!\s+\S)/.test(entry.selector))) {
        expect(decl(item.body, 'top') ?? '', `${file} ${item.selector}`).not.toMatch(/^0(px)?$/)
      }
    }
  })

  it('on phones (where the tabs wrap into several rows) the bar stays in the flow instead of pinning ~260px', () => {
    const phone = rules(read('src/styles/ds/staff-surfaces.css')).find(
      item =>
        item.selector === '.app-shell .workspace-tabbar' && item.media.some(media => /max-width:\s*720px/.test(media))
    )
    expect(phone).toBeDefined()
    expect(decl(phone!.body, 'position')).not.toBe('sticky')
  })
})

describe('round 2 design: staff shell — dark mode is brand green, not gold', () => {
  it('dark accent tokens are brand greens', () => {
    const token = darkTokens()
    for (const name of [
      '--ds-primary',
      '--ds-primary-hover',
      '--ds-primary-active',
      '--ds-primary-text',
      '--ds-accent',
      '--ds-accent-text',
      '--ds-focus-color',
      '--ds-eyebrow',
    ]) {
      const value = token(name)
      expect(isGold(value), `${name} ${value}`).toBe(false)
      expect(isBrandGreen(value), `${name} ${value}`).toBe(true)
    }
    for (const name of ['--ds-primary-soft', '--ds-primary-soft-2', '--ds-accent-soft']) {
      expect(isGold(token(name)), name).toBe(false)
    }
    const stops = hexes(token('--ds-gold-gradient'))
    expect(stops.length).toBeGreaterThanOrEqual(2)
    for (const stop of stops) expect(isBrandGreen(stop), `gradient stop ${stop}`).toBe(true)
    for (const stop of rgbaHexes(token('--ds-focus'))) expect(isGold(stop), `focus ring ${stop}`).toBe(false)
  })

  it('dark accents hold WCAG AA contrast on the night surfaces', () => {
    const token = darkTokens()
    const fg = token('--ds-primary-fg')
    // button / selected-tab label on every primary fill, including each stop of the primary gradient
    for (const fill of [
      token('--ds-primary'),
      token('--ds-primary-hover'),
      token('--ds-primary-active'),
      ...hexes(token('--ds-gold-gradient')),
    ]) {
      expect(contrast(fg, fill), `${fg} on ${fill}`).toBeGreaterThanOrEqual(4.5)
    }
    // active sidebar item, staff labels and links: primary text on every surface it sits on
    for (const ground of [
      token('--ds-bg'),
      token('--ds-surface'),
      token('--ds-surface-muted'),
      token('--ds-primary-soft'),
      token('--ds-primary-soft-2'),
    ]) {
      expect(contrast(token('--ds-primary-text'), ground), `primary text on ${ground}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(token('--ds-eyebrow'), ground), `eyebrow on ${ground}`).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(token('--ds-accent-text'), token('--ds-accent-soft'))).toBeGreaterThanOrEqual(4.5)
    // the primary fill itself (focus rings, selection bars) stands off the page: non-text 3:1
    expect(contrast(token('--ds-primary'), token('--ds-bg'))).toBeGreaterThanOrEqual(3)
    expect(contrast(token('--ds-focus-color'), token('--ds-surface'))).toBeGreaterThanOrEqual(3)
  })

  it('the staff sheets carry no hard-coded gold/brass accents', () => {
    for (const file of ['src/styles/ds/staff-surfaces.css', 'src/styles/ds/components.css', 'src/styles/ds/app.css']) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '')
      for (const colour of [...hexes(css), ...rgbaHexes(css)]) {
        expect(isGold(colour), `${file}: ${colour}`).toBe(false)
      }
      expect(css, file).not.toMatch(/var\(--brass-\d+\)/)
    }
  })

  it('staff kickers («المتابعة التنفيذية»), icons and the GIS accent are switched to the green tokens', () => {
    const file = 'src/styles/ds/staff-surfaces.css'
    // App.css paints the ops/governor kicker brass (#e2c57e); the ds layer overrides it
    expect(decl(rule(file, '.app-shell .ops-header > div:first-child > span').body, 'color')).toBe('var(--ds-eyebrow)')
    expect(decl(rule(file, '.app-shell .panel-heading > svg, .app-shell .ops-kpis > div > span').body, 'color')).toBe(
      'var(--ds-primary-text)'
    )
    expect(decl(rule(file, '.app-shell .super-admin-action-list a > svg:first-child').body, 'color')).toBe(
      'var(--ds-primary-text)'
    )
    const gis = decl(rule(file, '.app-shell .gis-shell').body, '--gis-gold')!
    expect(isBrandGreen(gis), gis).toBe(true)
    // the GIS segmented control paints #1c1405 on the accent
    expect(contrast('#1c1405', gis)).toBeGreaterThanOrEqual(4.5)
    // the governor / super-admin avatar no longer uses the brass scale
    expect(decl(rule('src/styles/ds/components.css', '.user-avatar.gold').body, 'background')).toBe(
      'var(--ds-primary-active)'
    )
  })
})

describe('round 2 design: staff shell — camera dialog', () => {
  it('the camera state heading is never amber; the state is shown by a neutral or success icon chip', () => {
    const file = 'src/styles/ds/staff-surfaces.css'
    for (const item of rules(read(file)).filter(entry => /camera-dialog/.test(entry.selector))) {
      if (/>\s*strong|camera-dialog-state(?!\s*>)/.test(item.selector)) {
        expect(decl(item.body, 'color') ?? '', item.selector).not.toMatch(/warning|amber|brass/)
      }
    }
    expect(read(file)).not.toMatch(/camera-dialog-body\[data-status=[^\]]+\]\s*>\s*strong/)
    const chip = rule(file, '.camera-dialog-state > span')
    expect(decl(chip.body, 'color')).toBe('var(--ds-text-2)')
    const ready = rule(file, ".camera-dialog-body[data-status='READY_FOR_GATEWAY'] .camera-dialog-state > span")
    expect(decl(ready.body, 'color')).toBe('var(--ds-success)')

    const panel = read('src/components/operations/OperationsRegistryPanel.tsx')
    expect(panel).toContain('<strong className="camera-dialog-state">')
    // the icon is decoration; the heading text carries the state for screen readers
    expect(panel).toMatch(/className="camera-dialog-state">\s*<span aria-hidden="true">/)
  })
})

describe('round 2 design: /privacy explains the voice assistant', () => {
  afterEach(() => {
    setSpeechProvider(undefined)
    delete process.env.ASSISTANT_SERVER_TTS
  })

  const privacy = () => {
    const source = read('src/pages/public/InfoPage.tsx')
    const start = source.indexOf('privacy: {')
    const end = source.indexOf('terms: {')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    return source.slice(start, end)
  }

  it('has a voice section with when the mic is on, who turns speech into text, and that audio is not stored', () => {
    const text = privacy()
    expect(text).toContain("title: 'المساعد الصوتي أفندي'")
    // when the microphone is used
    expect(text).toMatch(/لا يعمل الميكروفون إلا عندما تضغط/)
    expect(text).toContain('«محادثة متواصلة»')
    // browser speech recognition may send audio to the browser vendor
    for (const vendor of ['Google', 'Apple', 'Microsoft']) expect(text).toContain(vendor)
    expect(text).toMatch(/قد يُرسَل صوتك إلى تلك الشركة/)
    // the server transcription provider only when enabled
    expect(text).toContain('Firefox')
    expect(text).toMatch(/فقط إذا كانت هذه الخدمة مفعّلة/)
    // audio never stored by the platform; only the answer text goes to an optional server voice
    expect(text).toMatch(/لا تحفظ المنصة صوتك/)
    expect(text).toContain('نص الجواب فقط')
    // the intro no longer claims nothing ever leaves the department
    expect(text).toMatch(/عدا ما يمر بخدمة تحويل الكلام/)
  })

  it('stays consistent with what أفندي says about voice privacy (voicePrivacyFacts), for every deployment', () => {
    const text = privacy()
    const provider = {
      name: 'fake',
      label: 'OpenAI',
      transcribe: async () => 'نص',
      speak: async () => Buffer.from('ID3'),
    }
    const covered: string[] = []
    for (const [configured, serverTts] of [
      [null, false],
      [provider, false],
      [provider, true],
    ] as const) {
      setSpeechProvider(configured)
      process.env.ASSISTANT_SERVER_TTS = serverTts ? 'true' : 'false'
      const facts = voicePrivacyFacts().join(' ')
      covered.push(facts)
      for (const name of ['Google', 'Apple', 'Microsoft', 'Firefox']) {
        if (facts.includes(name)) expect(text, `${name} (server: ${Boolean(configured)})`).toContain(name)
      }
      if (/«محادثة متواصلة»/.test(facts)) expect(text).toContain('«محادثة متواصلة»')
      if (/نص الجواب فقط/.test(facts)) expect(text).toContain('نص الجواب فقط')
      // both say the platform keeps no recording
      if (/ما تحفظ|ولا يُحفظ/.test(facts)) expect(text).toMatch(/لا تحفظ المنصة صوتك/)
    }
    // the three deployments together exercise every fact the page mirrors (the checks above are not vacuous)
    const all = covered.join(' ')
    for (const fact of ['Google', 'Firefox', '«محادثة متواصلة»', 'نص الجواب فقط', 'ما تحفظ']) {
      expect(all).toContain(fact)
    }
  })
})
