// Re-shoot homepage + a few pages with reveal animations disabled, and probe horizontal overflow sources.
import { chromium } from 'playwright'
const base = 'http://localhost:8787'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const routes = [
  ['home', '/'],
  ['directory', '/directory'],
  ['svc-special', '/service/store-license'],
  ['departments', '/departments'],
]
for (const [vname, viewport] of [
  ['1440', { width: 1440, height: 900 }],
  ['1024', { width: 1024, height: 800 }],
  ['390', { width: 390, height: 844 }],
]) {
  const ctx = await browser.newContext({
    viewport,
    isMobile: vname === '390',
    deviceScaleFactor: vname === '390' ? 2 : 1,
    reducedMotion: 'reduce',
  })
  for (const theme of ['light', 'dark']) {
    for (const [r, path] of routes) {
      if (r !== 'home' && vname === '1024') continue
      const page = await ctx.newPage()
      await page.goto(base + path, { waitUntil: 'networkidle' }).catch(() => null)
      if (theme === 'dark') await page.evaluate(() => document.documentElement.setAttribute('data-gov-theme', 'dark'))
      await page.evaluate(() => document.querySelectorAll('[data-reveal]').forEach(e => e.classList.add('is-revealed')))
      await page.waitForTimeout(700)
      const wide = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth
        const sw = document.documentElement.scrollWidth
        const out = []
        for (const el of document.querySelectorAll('body *')) {
          const rc = el.getBoundingClientRect()
          if (rc.right > vw + 2 && !el.closest('.leaflet-container'))
            out.push(
              `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')} r=${Math.round(rc.right)}`
            )
          if (out.length > 6) break
        }
        return { vw, sw, out }
      })
      console.log(r, vname, theme, JSON.stringify(wide))
      await page.screenshot({ path: `qa-screens/audit-design-${r}-${vname}-${theme}.png`, fullPage: true })
      await page.close()
    }
  }
  await ctx.close()
}
await browser.close()
