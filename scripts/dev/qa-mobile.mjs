// Mobile (390px) full-page screenshots of the main surfaces + horizontal overflow detection (dev helper).
import { chromium } from 'playwright'
const base = process.env.QA_BASE || 'http://localhost:8787'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
const otp = await page.request.post(`${base}/api/onboarding/request-otp`, { data: { phone: '07801234567' } })
const { challengeId } = await otp.json()
await page.request.post(`${base}/api/onboarding/verify-phone`, { data: { phone: '07801234567', challengeId, otp: '246810' } })
const pages = [
  ['home', '/'],
  ['directory', '/directory'],
  ['service', '/service/muni-dir-complaint-against-municipality'],
  ['service-info', '/service/national-id'],
  ['departments', '/departments'],
  ['department', '/departments/dhiqar-municipalities'],
  ['citizen', '/citizen'],
  ['notifications', '/citizen/notifications'],
  ['feedback', '/citizen/feedback'],
  ['login', '/login'],
  ['onboarding', '/onboarding'],
  ['verify', '/verify'],
]
for (const [name, path] of pages) {
  await page.goto(base + path, { waitUntil: 'networkidle' }).catch(() => null)
  await page.waitForTimeout(700)
  const overflow = await page.evaluate(() => {
    const docWidth = document.documentElement.scrollWidth
    const offenders = []
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && (rect.right > window.innerWidth + 2 || rect.left < -2) && getComputedStyle(el).position !== 'fixed') {
        offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')} [${Math.round(rect.left)}..${Math.round(rect.right)}]`)
        if (offenders.length > 6) break
      }
    }
    return { docWidth, offenders }
  })
  console.log(name, 'scrollWidth=' + overflow.docWidth, overflow.offenders.length ? '\n   ' + overflow.offenders.join('\n   ') : 'ok')
  await page.screenshot({ path: `qa-screens/m-${name}.png`, fullPage: true })
}
await browser.close()
