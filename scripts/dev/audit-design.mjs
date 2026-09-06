// Design-system audit: measures typography, colours, radii, buttons, contrast, links, images, overflow
// on public routes at 3 viewports × 2 themes; screenshots to qa-screens/audit-design-*.png.
import { chromium } from 'playwright'
import fs from 'node:fs'

const base = 'http://localhost:8787'
const out = 'qa-screens'
const dataOut = 'qa-screens/audit/design'
fs.mkdirSync(dataOut, { recursive: true })
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

const routes = [
  ['home', '/'],
  ['directory', '/directory'],
  ['directory-q', '/directory?q=ولادة'],
  ['directory-empty', '/directory?q=zzzzqqqq'],
  ['svc-online', '/service/muni-dir-complaint-against-municipality'],
  ['svc-appt', '/service/nid-first-issue'],
  ['svc-info', '/service/national-id'],
  ['svc-info2', '/service/airport-flight-inquiry'],
  ['svc-fee', '/service/health-birth-certificate'],
  ['svc-special', '/service/store-license'],
  ['departments', '/departments'],
  ['dept-muni', '/departments/dhiqar-municipalities'],
  ['login', '/login'],
  ['staff-login', '/staff/login'],
  ['onboarding', '/onboarding'],
  ['verify', '/verify'],
  ['404', '/this-does-not-exist'],
]
const viewports = [
  ['1440', { width: 1440, height: 900 }],
  ['1024', { width: 1024, height: 800 }],
  ['390', { width: 390, height: 844 }],
]

const probe = () => {
  const lum = c => {
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const [r, g, b, a = 1] = m[1].split(',').map(Number)
    return { r, g, b, a }
  }
  const rel = ({ r, g, b }) => {
    const f = v => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const blend = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  })
  const effBg = el => {
    let node = el
    let acc = null
    while (node && node !== document.documentElement.parentNode) {
      const cs = getComputedStyle(node)
      const c = lum(cs.backgroundColor)
      if (c && c.a > 0) {
        acc = acc ? blend(acc, c) : c
        if ((acc.a ?? 1) >= 1 && c.a >= 1) return acc
      }
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !acc) return null
      node = node.parentElement
    }
    return acc ? blend(acc, { r: 255, g: 255, b: 255, a: 1 }) : { r: 255, g: 255, b: 255, a: 1 }
  }
  const ratio = (a, b) => {
    const l1 = rel(a)
    const l2 = rel(b)
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
  }
  const sel = el => {
    const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .join('.')
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (el.id ? '#' + el.id : '')
  }
  const vw = document.documentElement.clientWidth
  const fonts = {}
  const sizes = {}
  const colors = {}
  const bgs = {}
  const borders = {}
  const radii = {}
  const small = []
  const contrast = []
  const lineHeights = {}
  const headings = []
  const buttons = []
  const ltr = []
  const seen = new Set()
  const els = Array.from(document.querySelectorAll('body *'))
  for (const el of els) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim().length > 0)
    const ff = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim()
    const fs = parseFloat(cs.fontSize)
    const bc = cs.borderTopColor
    const bw = parseFloat(cs.borderTopWidth)
    if (bw > 0 && bc && !bc.endsWith(', 0)')) borders[bc] = (borders[bc] || 0) + 1
    const br = cs.borderTopLeftRadius
    if (br && br !== '0px' && cs.borderStyle !== 'none' && (bw > 0 || (lum(cs.backgroundColor) || { a: 0 }).a > 0))
      radii[br] = (radii[br] || 0) + 1
    const bgc = lum(cs.backgroundColor)
    if (bgc && bgc.a > 0) bgs[cs.backgroundColor] = (bgs[cs.backgroundColor] || 0) + 1
    if (cs.direction === 'ltr' && hasText) ltr.push(sel(el) + ' "' + el.textContent.trim().slice(0, 30) + '"')
    if (/^(BUTTON|A)$/.test(el.tagName) || /\b(gov-btn|button)\b/.test(el.className)) {
      if (hasText || el.querySelector('svg'))
        buttons.push({
          sel: sel(el),
          text: el.textContent.trim().slice(0, 25),
          ff,
          fs,
          h: Math.round(r.height),
          pad: cs.padding,
          radius: br,
          bg: cs.backgroundColor,
          color: cs.color,
          border: cs.borderTopWidth + ' ' + cs.borderTopColor,
          fw: cs.fontWeight,
        })
    }
    if (!hasText) continue
    const text = el.textContent.trim().slice(0, 40)
    fonts[ff] = (fonts[ff] || 0) + 1
    const key = ff + '|' + el.tagName.toLowerCase()
    sizes[fs] = (sizes[fs] || 0) + 1
    colors[cs.color] = (colors[cs.color] || 0) + 1
    const lh = cs.lineHeight === 'normal' ? 'normal' : (parseFloat(cs.lineHeight) / fs).toFixed(2)
    lineHeights[lh] = (lineHeights[lh] || 0) + 1
    if (/^H[1-6]$/.test(el.tagName))
      headings.push({ tag: el.tagName, sel: sel(el), ff, fs, lh, fw: cs.fontWeight, text })
    if (fs < 12) small.push({ sel: sel(el), fs, text, ff })
    const fg = lum(cs.color)
    const bg = effBg(el)
    if (fg && bg && fg.a > 0) {
      const f = fg.a < 1 ? blend(fg, bg) : fg
      const cr = ratio(f, bg)
      const large = fs >= 24 || (fs >= 18.66 && parseInt(cs.fontWeight) >= 700)
      const need = large ? 3 : 4.5
      const k = sel(el) + '|' + cs.color + '|' + cs.backgroundColor
      if (cr < need && !seen.has(k)) {
        seen.add(k)
        contrast.push({ sel: sel(el), text, fs, fw: cs.fontWeight, color: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, ratio: +cr.toFixed(2), need })
      }
    }
  }
  const overflow = document.documentElement.scrollWidth > vw + 1
  const wide = []
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && (r.right > vw + 2 || r.left < -2) && getComputedStyle(el).position !== 'fixed') {
      wide.push(sel(el) + ` r=${Math.round(r.right)} l=${Math.round(r.left)} w=${Math.round(r.width)}`)
      if (wide.length > 8) break
    }
  }
  const images = Array.from(document.images).map(img => {
    const r = img.getBoundingClientRect()
    const cs = getComputedStyle(img)
    return {
      src: (img.currentSrc || img.src).replace(location.origin, '').slice(0, 80),
      alt: img.alt,
      nat: img.naturalWidth + 'x' + img.naturalHeight,
      rend: Math.round(r.width) + 'x' + Math.round(r.height),
      fit: cs.objectFit,
      upscale: img.naturalWidth > 0 ? +(r.width * devicePixelRatio / img.naturalWidth).toFixed(2) : null,
      distort:
        img.naturalWidth && cs.objectFit === 'fill'
          ? +(r.width / r.height / (img.naturalWidth / img.naturalHeight)).toFixed(2)
          : null,
      ok: img.complete && img.naturalWidth > 0,
    }
  })
  const links = Array.from(document.querySelectorAll('a')).map(a => ({
    href: a.getAttribute('href'),
    text: a.textContent.trim().slice(0, 30),
    sel: sel(a),
  }))
  const clickables = Array.from(document.querySelectorAll('button, a, [role=button]')).map(el => {
    const r = el.getBoundingClientRect()
    return { sel: sel(el), text: el.textContent.trim().slice(0, 25), w: Math.round(r.width), h: Math.round(r.height) }
  })
  const smallTargets = clickables.filter(c => c.w > 0 && (c.h < 32 || c.w < 32))
  const svgs = {}
  for (const s of document.querySelectorAll('svg')) {
    const r = s.getBoundingClientRect()
    if (!r.width) continue
    const k = Math.round(r.width) + 'x' + Math.round(r.height)
    svgs[k] = (svgs[k] || 0) + 1
  }
  const iconsNoLabel = Array.from(document.querySelectorAll('button, a'))
    .filter(el => !el.textContent.trim() && !el.getAttribute('aria-label') && !el.getAttribute('title'))
    .map(sel)
  const text = document.body.innerText
  return {
    fonts, sizes, colors, bgs, borders, radii, small, contrast, lineHeights, headings, buttons, ltr, overflow, wide,
    images, links, smallTargets, svgs, iconsNoLabel, text,
    title: document.title,
    h1: Array.from(document.querySelectorAll('h1')).map(h => h.textContent.trim()),
    hasNotFound: /الصفحة غير موجودة/.test(text),
  }
}

const results = {}
for (const [vname, viewport] of viewports) {
  const context = await browser.newContext({ viewport, isMobile: vname === '390', deviceScaleFactor: vname === '390' ? 2 : 1 })
  for (const theme of ['light', 'dark']) {
    for (const [rname, path] of routes) {
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)))
      page.on('console', m => m.type() === 'error' && !/ERR_TUNNEL|net::/.test(m.text()) && errors.push(m.text().slice(0, 200)))
      await page.addInitScript(t => {
        if (t === 'dark') document.documentElement.setAttribute('data-gov-theme', 'dark')
      }, theme)
      await page.goto(base + path, { waitUntil: 'networkidle' }).catch(() => null)
      await page.waitForTimeout(900)
      if (theme === 'dark') await page.evaluate(() => document.documentElement.setAttribute('data-gov-theme', 'dark'))
      await page.waitForTimeout(200)
      const data = await page.evaluate(probe)
      data.errors = errors
      const id = `${rname}-${vname}-${theme}`
      results[id] = data
      if (vname !== '1024' || theme === 'light') {
        await page.screenshot({ path: `${out}/audit-design-${id}.png`, fullPage: true }).catch(() => null)
      }
      await page.close()
      process.stdout.write(id + ' ')
    }
  }
  await context.close()
}
fs.writeFileSync(`${dataOut}/report.json`, JSON.stringify(results, null, 1))
await browser.close()
console.log('\ndone')
