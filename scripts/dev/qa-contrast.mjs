// Measures text contrast on the public + citizen surfaces in both themes (dev helper).
import { chromium } from 'playwright'
const base = process.env.QA_BASE || 'http://localhost:8787'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const routes = [
  '/',
  '/directory',
  '/departments',
  '/departments/dhiqar-municipalities',
  '/service/store-license',
  '/service/water-subscription-transfer',
  '/login',
  '/staff/login',
  '/onboarding',
  '/verify',
  '/privacy',
  '/terms',
  '/accessibility',
  '/nope-404',
]
let failures = 0
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { 'X-Forwarded-For': '10.2.4.8' },
  })
  const page = await ctx.newPage()
  await page.addInitScript(t => {
    try {
      localStorage.setItem('tqd-theme', t)
    } catch {
      /* ignore */
    }
    document.documentElement.setAttribute('data-gov-theme', t)
  }, theme)
  for (const route of routes) {
    await page.goto(base + route, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(700)
    await page.evaluate(() => document.querySelectorAll('[data-reveal]').forEach(e => e.classList.add('is-revealed')))
    const bad = await page.evaluate(() => {
      const parse = c => {
        const m = c.match(/[\d.]+/g) || []
        return { r: +m[0] || 0, g: +m[1] || 0, b: +m[2] || 0, a: m[3] === undefined ? 1 : +m[3] }
      }
      const lin = v => {
        v /= 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      }
      const lum = c => {
        const p = parse(c)
        return 0.2126 * lin(p.r) + 0.7152 * lin(p.g) + 0.0722 * lin(p.b)
      }
      // an ancestor painted with a gradient or photo cannot be measured from computed colours
      const hasImage = el => {
        let n = el
        while (n && n !== document.documentElement) {
          const bi = getComputedStyle(n).backgroundImage
          if (bi && bi !== 'none') return true
          n = n.parentElement
        }
        return false
      }
      const bgOf = el => {
        const stack = []
        let n = el
        while (n && n !== document.documentElement) {
          const c = parse(getComputedStyle(n).backgroundColor)
          if (c.a > 0) stack.push(c)
          if (c.a === 1) break
          n = n.parentElement
        }
        let out = { r: 255, g: 255, b: 255 }
        for (let i = stack.length - 1; i >= 0; i--) {
          const c = stack[i]
          out = { r: c.r * c.a + out.r * (1 - c.a), g: c.g * c.a + out.g * (1 - c.a), b: c.b * c.a + out.b * (1 - c.a) }
        }
        return `rgb(${Math.round(out.r)}, ${Math.round(out.g)}, ${Math.round(out.b)})`
      }
      const out = []
      for (const el of document.querySelectorAll('body *')) {
        const text = [...el.childNodes]
          .filter(n => n.nodeType === 3)
          .map(n => n.textContent.trim())
          .join(' ')
          .trim()
        if (text.length < 2) continue
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.2) continue
        const r = el.getBoundingClientRect()
        if (r.width < 8 || r.height < 6) continue
        if (hasImage(el)) continue
        const l1 = lum(cs.color),
          l2 = lum(bgOf(el))
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
        if (ratio < 3)
          out.push({
            t: text.slice(0, 28),
            cls: String(el.className).slice(0, 36),
            ratio: +ratio.toFixed(2),
            color: cs.color,
            bg: bgOf(el),
            size: cs.fontSize,
          })
      }
      return out.slice(0, 10)
    })
    if (bad.length) {
      failures += bad.length
      console.log(`\n== ${theme} ${route}`)
      for (const x of bad) console.log(' ', x.ratio, `"${x.t}"`, x.cls, x.color, 'on', x.bg, x.size)
    }
  }
  await ctx.close()
}
await browser.close()
console.log(failures ? `\n${failures} contrast issues` : '\nno contrast issues')
