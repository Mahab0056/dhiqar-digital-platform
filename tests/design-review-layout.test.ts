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
const decl = (body: string, property: string) =>
  body.match(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`))?.[1].trim()

describe('design review: layout regressions', () => {
  it('finishes the inner-page rise animation after a fixed distance, not a share of the element height', () => {
    const rise = rules(read('src/styles/ds/public.css')).filter(rule =>
      /\btq-rise\b/.test(decl(rule.body, 'animation') ?? '')
    )
    expect(rise.length).toBeGreaterThan(0)
    for (const rule of rise) {
      const range = decl(rule.body, 'animation-range')
      // a percentage end (e.g. `entry 55%`) left tall panels (privacy, terms, a department) faded at load
      const match = range?.match(/^entry 0%? entry (\d+)px$/)
      expect(match, `animation-range of ${rule.selector}: ${range}`).not.toBeNull()
      expect(Number(match![1])).toBeLessThanOrEqual(160)
    }
  })

  it('never back-fills the department dashboard grid out of DOM / focus order', () => {
    for (const file of ['src/styles/ds/staff-surfaces.css', 'src/styles/departments.css']) {
      for (const rule of rules(read(file)).filter(item => item.selector.includes('department-grid'))) {
        expect(decl(rule.body, 'grid-auto-flow') ?? '', `${file} ${rule.selector}`).not.toMatch(/dense/)
        expect(decl(rule.body, 'order'), `${file} ${rule.selector}`).toBeUndefined()
      }
    }
    // holes are filled by widening the last panel of a run instead, in both the 2- and 3-column layouts
    const fills = rules(read('src/styles/ds/staff-surfaces.css')).filter(
      rule => rule.selector.includes('.department-grid >') && rule.selector.includes(':has(+ .department-chart')
    )
    expect(fills.map(rule => decl(rule.body, 'grid-column')).sort()).toEqual(['1 / -1', '1 / -1', 'span 2'])
  })

  it('only gives a card grid 4 columns where its item counts fill them evenly', () => {
    const news = rules(read('src/styles/ds/news.css'))
    const fourColumn = news
      .filter(rule => /repeat\(4,/.test(decl(rule.body, 'grid-template-columns') ?? ''))
      .flatMap(rule => rule.selector.split(',').map(part => part.trim()))
    // the homepage tenders block shows 6 cards (3 skeletons while loading): 3 columns only
    expect(fourColumn).not.toContain('.ld-tender-grid')
    const tenders = read('src/components/home/News.tsx')
    expect(tenders).toContain('.slice(0, 6)')
    // the news list pages must divide by 1, 2, 3 and 4 columns
    if (fourColumn.includes('.nwp-grid')) {
      const page = Number(read('src/pages/public/NewsPage.tsx').match(/const PAGE = (\d+)/)?.[1])
      expect(page % 12, `NewsPage PAGE = ${page}`).toBe(0)
    }
  })
})
