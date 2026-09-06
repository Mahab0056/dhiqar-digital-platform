// Fonts actually loaded/used, link resolution (SPA 404 detection), focus/hover states, image status.
import { chromium } from 'playwright'
import fs from 'node:fs'
const base = 'http://localhost:8787'
const R = JSON.parse(fs.readFileSync('qa-screens/audit/design/report.json', 'utf8'))
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.goto(base + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const fonts = await page.evaluate(async () => {
  await document.fonts.ready
  const loaded = [...document.fonts].map(f => `${f.family} ${f.weight} ${f.status}`)
  const used = {}
  for (const el of document.querySelectorAll('body *')) {
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue
    const ff = getComputedStyle(el).fontFamily
    used[ff] = (used[ff] || 0) + 1
  }
  const checks = ['IBM Plex Sans Arabic', 'Noto Kufi Arabic', 'Segoe UI', 'Tahoma', 'Inter'].map(
    f => f + ':' + document.fonts.check(`16px "${f}"`)
  )
  return {
    loaded: [...new Set(loaded)],
    used,
    checks,
    body: getComputedStyle(document.body).fontFamily,
    root: getComputedStyle(document.documentElement).fontFamily,
    button: getComputedStyle(document.querySelector('button')).fontFamily,
  }
})
console.log('FONTS', JSON.stringify(fonts, null, 1))

// focus/hover states on home
await page.goto(base + '/', { waitUntil: 'networkidle' })
const focus = await page.evaluate(() => {
  const out = []
  const targets = [...document.querySelectorAll('a, button, input')]
    .filter(e => e.getBoundingClientRect().width > 0)
    .slice(0, 60)
  for (const el of targets) {
    el.focus()
    const cs = getComputedStyle(el)
    const sel = el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 2).join('.')
    out.push(
      `${sel} outline=${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} shadow=${cs.boxShadow !== 'none'}`
    )
  }
  return out
})
console.log('FOCUS(programmatic)')
console.log([...new Set(focus)].join('\n'))
// keyboard focus-visible check
await page.goto(base + '/', { waitUntil: 'networkidle' })
const kb = []
for (let i = 0; i < 25; i++) {
  await page.keyboard.press('Tab')
  kb.push(
    await page.evaluate(() => {
      const el = document.activeElement
      const cs = getComputedStyle(el)
      return `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')}«${el.textContent.trim().slice(0, 14)}» outline=${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} ring=${cs.boxShadow !== 'none'}`
    })
  )
}
console.log('TAB ORDER')
console.log(kb.join('\n'))
// hover states
const hov = []
for (const sel of [
  '.gov-btn.primary',
  '.gov-btn.outline',
  '.gov-category',
  '.gov-quick-action',
  '.gov-nav a',
  '.gov-link',
  '.gov-service-row a, .gov-services-two a',
  '.footer a',
  '.button.primary',
]) {
  const el = page.locator(sel).first()
  if (!(await el.count())) {
    hov.push(sel + ' n/a')
    continue
  }
  const before = await el.evaluate(e => {
    const c = getComputedStyle(e)
    return [c.backgroundColor, c.color, c.borderColor, c.boxShadow, c.transform, c.textDecorationLine].join('|')
  })
  await el.hover().catch(() => null)
  await page.waitForTimeout(250)
  const after = await el.evaluate(e => {
    const c = getComputedStyle(e)
    return [c.backgroundColor, c.color, c.borderColor, c.boxShadow, c.transform, c.textDecorationLine].join('|')
  })
  hov.push(`${sel} changed=${before !== after} ${before} -> ${after}`)
}
console.log('HOVER')
console.log(hov.join('\n'))
// images
const imgs = {}
for (const [id, d] of Object.entries(R))
  if (id.endsWith('-1440-light'))
    for (const im of d.images) {
      const k = im.src
      if (!imgs[k]) imgs[k] = { ...im, pages: [] }
      imgs[k].pages.push(id.replace('-1440-light', ''))
    }
console.log('IMAGES')
for (const im of Object.values(imgs))
  if (!/leaflet|tile/.test(im.src))
    console.log(
      `${im.src} alt="${im.alt}" nat=${im.nat} rend=${im.rend} fit=${im.fit} upscale=${im.upscale} distort=${im.distort} ok=${im.ok} pages=${im.pages.length}`
    )
await browser.close()
