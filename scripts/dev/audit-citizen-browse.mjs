// Audit helper: walks citizen-facing pages at desktop + mobile, collects errors/overflow/a11y signals, screenshots.
import { chromium } from 'playwright'
import fs from 'node:fs'

const base = 'http://localhost:8787'
const phone = '07801112233'
const out = 'qa-screens/audit'
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const report = []

const guestRoutes = [
  '/',
  '/directory',
  '/directory?q=ولادة',
  '/service/muni-dir-complaint-against-municipality',
  '/service/health-birth-certificate',
  '/service/national-id',
  '/service/store-license',
  '/service/online-appointment',
  '/service/does-not-exist',
  '/onboarding',
  '/onboarding?continue=/service/health-birth-certificate',
  '/login',
  '/verify',
  '/citizen',
  '/citizen/application/TQD-2026-0001',
  '/nope',
]
const citizenRoutes = [
  '/citizen',
  '/citizen/notifications',
  '/citizen/feedback',
  '/citizen/feedback/TQD-CMP-2026-00001',
  '/citizen/feedback/NOPE',
  '/citizen/pay/PAY-2026-00001',
  '/citizen/pay/PAY-2026-00001/sandbox',
  '/citizen/pay/NOPE',
  '/citizen/application/TQD-2026-0001',
  '/citizen/application/TQD-2026-0002',
  '/citizen/application/TQD-2026-0003',
  '/citizen/application/NOPE',
  '/service/health-birth-certificate',
  '/service/online-appointment',
  '/service/store-license',
  '/onboarding',
  '/verify/TQD-0D29FBAE02BF4B178F',
]

const probe = async page => {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const overflowX = document.documentElement.scrollWidth > vw + 1
    const wide = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && (r.right > vw + 2 || r.left < -2) && getComputedStyle(el).position !== 'fixed') {
        wide.push(`${el.tagName.toLowerCase()}.${String(el.className).toString().split(' ').slice(0, 2).join('.')} right=${Math.round(r.right)} left=${Math.round(r.left)}`)
        if (wide.length > 6) break
      }
    }
    const imgsNoAlt = [...document.querySelectorAll('img:not([alt])')].map(i => i.getAttribute('src')).slice(0, 5)
    const btnsNoName = [...document.querySelectorAll('button, a[href]')]
      .filter(b => !(b.textContent || '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title'))
      .map(b => `${b.tagName.toLowerCase()}.${b.className} href=${b.getAttribute('href') || ''}`)
      .slice(0, 8)
    const inputsNoLabel = [...document.querySelectorAll('input:not([type=hidden]):not([hidden]), select, textarea')]
      .filter(i => !i.closest('label') && !i.getAttribute('aria-label') && !(i.id && document.querySelector(`label[for="${i.id}"]`)))
      .map(i => `${i.tagName.toLowerCase()} name=${i.getAttribute('name') || ''} ph=${i.getAttribute('placeholder') || ''}`)
      .slice(0, 8)
    const small = []
    if (vw < 500)
      for (const el of document.querySelectorAll('button, a[href], input, select, label.button')) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0 && (r.height < 32 || r.width < 32) && getComputedStyle(el).display !== 'none') {
          small.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.textContent || '').trim().slice(0, 25)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
          if (small.length > 10) break
        }
      }
    const fixedBars = [...document.querySelectorAll('body *')]
      .filter(el => ['fixed', 'sticky'].includes(getComputedStyle(el).position))
      .map(el => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} h=${Math.round(el.getBoundingClientRect().height)}`)
      .slice(0, 6)
    const fonts = new Set()
    for (const el of document.querySelectorAll('h1,h2,h3,p,button,a,strong,small,span,input'))
      fonts.add(getComputedStyle(el).fontFamily.split(',')[0].replace(/"/g, ''))
    const latin = [...document.querySelectorAll('h1,h2,h3,small,span,strong,button,p,em,div')]
      .filter(el => el.children.length === 0)
      .map(el => (el.textContent || '').trim())
      .filter(t => /^[A-Za-z][A-Za-z ]{4,}$/.test(t))
      .slice(0, 10)
    const title = document.title
    const text = (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160)
    return { overflowX, wide, imgsNoAlt, btnsNoName, inputsNoLabel, small, fixedBars, fonts: [...fonts], latin, title, text }
  })
}

const run = async (ctx, label, routes, width) => {
  const page = await ctx.newPage()
  await page.setViewportSize({ width, height: width < 500 ? 844 : 768 })
  let errors = []
  let failed = []
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_TUNNEL|tile\.openstreetmap|nominatim/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`)
  })
  page.on('response', r => {
    const u = r.url()
    if (u.startsWith(base) && r.status() >= 400 && !/profile-photo/.test(u)) failed.push(`${r.status()} ${u.replace(base, '')}`)
  })
  for (const route of routes) {
    errors = []
    failed = []
    try {
      await page.goto(base + route, { waitUntil: 'networkidle', timeout: 20000 })
    } catch (e) {
      report.push({ label, width, route, error: `goto: ${e.message.slice(0, 100)}` })
    }
    await page.waitForTimeout(700)
    const info = await probe(page)
    const slug = `${label}-${width}-${route.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}`
    await page.screenshot({ path: `${out}/${slug}.png`, fullPage: true })
    // dark mode
    await page.evaluate(() => document.documentElement.setAttribute('data-gov-theme', 'dark'))
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${out}/${slug}-dark.png`, fullPage: true })
    const dark = await page.evaluate(() => {
      const bg = getComputedStyle(document.body).backgroundColor
      // sample low-contrast pairs: text colour == background colour of nearest bg ancestor
      const bad = []
      const lum = c => {
        const m = c.match(/\d+(\.\d+)?/g)
        if (!m) return null
        const [r, g, b] = m.map(Number)
        const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      const bgOf = el => {
        let n = el
        while (n && n !== document.documentElement) {
          const c = getComputedStyle(n).backgroundColor
          if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c
          n = n.parentElement
        }
        return getComputedStyle(document.body).backgroundColor
      }
      for (const el of document.querySelectorAll('p,small,span,strong,h1,h2,h3,a,button,b,em,li,dd,dt,time,label')) {
        if (el.children.length || !(el.textContent || '').trim()) continue
        const r = el.getBoundingClientRect()
        if (!r.width || !r.height) continue
        const cs = getComputedStyle(el)
        const l1 = lum(cs.color), l2 = lum(bgOf(el))
        if (l1 === null || l2 === null) continue
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
        if (ratio < 3) {
          bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.textContent || '').trim().slice(0, 30)}" ${ratio.toFixed(2)} ${cs.color} on ${bgOf(el)}`)
          if (bad.length > 8) break
        }
      }
      return { bg, bad }
    })
    await page.evaluate(() => document.documentElement.removeAttribute('data-gov-theme'))
    // light contrast too
    const light = await page.evaluate(() => {
      const bad = []
      const lum = c => {
        const m = c.match(/\d+(\.\d+)?/g)
        if (!m) return null
        const [r, g, b] = m.map(Number)
        const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      const bgOf = el => {
        let n = el
        while (n && n !== document.documentElement) {
          const c = getComputedStyle(n).backgroundColor
          if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c
          n = n.parentElement
        }
        return getComputedStyle(document.body).backgroundColor
      }
      for (const el of document.querySelectorAll('p,small,span,strong,h1,h2,h3,a,button,b,em,li,dd,dt,time,label')) {
        if (el.children.length || !(el.textContent || '').trim()) continue
        const r = el.getBoundingClientRect()
        if (!r.width || !r.height) continue
        const cs = getComputedStyle(el)
        const l1 = lum(cs.color), l2 = lum(bgOf(el))
        if (l1 === null || l2 === null) continue
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
        if (ratio < 3) {
          bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.textContent || '').trim().slice(0, 30)}" ${ratio.toFixed(2)} ${cs.color} on ${bgOf(el)}`)
          if (bad.length > 8) break
        }
      }
      return bad
    })
    report.push({ label, width, route, url: page.url().replace(base, ''), errors: [...errors], failed: [...failed], ...info, darkBg: dark.bg, darkLowContrast: dark.bad, lightLowContrast: light })
  }
  await page.close()
}

for (const width of [1366, 390]) {
  const guest = await browser.newContext({ locale: 'ar-IQ' })
  await run(guest, 'guest', guestRoutes, width)
  await guest.close()
  const cit = await browser.newContext({ locale: 'ar-IQ' })
  const otp = await (await cit.request.post(`${base}/api/onboarding/request-otp`, { data: { phone } })).json()
  await cit.request.post(`${base}/api/onboarding/verify-phone`, { data: { phone, challengeId: otp.challengeId, otp: '246810' } })
  await run(cit, 'citizen', citizenRoutes, width)
  await cit.close()
}
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2))
for (const r of report) {
  const flags = []
  if (r.errors?.length) flags.push(`ERR:${r.errors.length}`)
  if (r.failed?.length) flags.push(`HTTP:${r.failed.join('|')}`)
  if (r.overflowX) flags.push('OVERFLOW')
  if (r.wide?.length) flags.push(`WIDE:${r.wide.length}`)
  if (r.small?.length) flags.push(`SMALL:${r.small.length}`)
  console.log(`${r.label}@${r.width} ${r.route} -> ${r.url} | ${flags.join(' ')} | ${r.text?.slice(0, 60)}`)
}
await browser.close()
