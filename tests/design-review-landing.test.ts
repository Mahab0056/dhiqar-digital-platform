import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HeroHeadline } from '../src/components/home/Landing'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('design review: homepage header and hero', () => {
  it('folds the header nav before the row can overflow the fluid frame, in CSS and JS alike', () => {
    const css = stripComments(read('src/styles/ds/landing.css'))
    const tsx = read('src/components/home/Landing.tsx')
    const fold = css.match(/@media \(max-width: (\d+)px\) \{\s*\.ld-nav,\s*\.ld-entries \{\s*display: none;/)
    const compress = css.match(/@media \(max-width: (\d+)px\) \{\s*\.ld-nav \{\s*gap: 16px;/)
    const wide = tsx.match(/matchMedia\('\(min-width: (\d+)px\)'\)/)
    expect(fold, 'fold media query in landing.css').not.toBeNull()
    expect(compress, 'compressed nav media query in landing.css').not.toBeNull()
    expect(wide, 'desktop matchMedia in LandingHeader').not.toBeNull()
    const foldMax = Number(fold![1])
    // measured in Edge: brand + 7 links + theme + 2 entries need ~1245px of viewport compressed and ~1365px at
    // full size inside `.ld-wrap` (fluid gutter); below that the citizen-login button was pushed off the left edge
    expect(foldMax + 1).toBeGreaterThanOrEqual(1280)
    expect(Number(compress![1]) + 1).toBeGreaterThanOrEqual(1400)
    // the mobile menu closes exactly when the desktop nav comes back
    expect(Number(wide![1])).toBe(foldMax + 1)
  })

  it('preloads the hero photo from the homepage only, not from the shared SPA shell', () => {
    const html = read('index.html')
    expect(html).not.toMatch(/rel="preload"[^>]*hero-night|hero-night[^>]*rel="preload"/)
    const tsx = read('src/components/home/Landing.tsx')
    expect(tsx).toContain("const HERO_PHOTO = '/brand/home/hero-night.webp'")
    expect(tsx).toMatch(/preload\(HERO_PHOTO, \{ as: 'image', type: 'image\/webp', fetchPriority: 'high' \}\)/)
  })

  it('keeps a real space between the two halves of the hero headline', () => {
    const html = renderToStaticMarkup(createElement(HeroHeadline))
    const text = html.replace(/<[^>]+>/g, '')
    expect(text).toBe('خدماتك الحكومية، من مكان واحد.')
  })
})
