// Screenshots + console-error check for the catalog-driven services pipeline (dev helper).
import { chromium } from 'playwright'
const base = process.env.QA_BASE || 'http://localhost:8787'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const errors = []
const shoot = async (context, name, path, full = true) => {
  const page = await context.newPage()
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`${name}: ${msg.text()}`)
  })
  page.on('pageerror', err => errors.push(`${name}: ${err.message}`))
  await page.goto(base + path, { waitUntil: 'networkidle' }).catch(() => null)
  await page.waitForTimeout(900)
  await page.screenshot({ path: `qa-screens/${name}.png`, fullPage: full })
  await page.close()
}
for (const [label, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  const context = await browser.newContext({ viewport, isMobile: label === 'mobile' })
  await shoot(context, `${label}-directory`, '/directory')
  await shoot(
    context,
    `${label}-directory-filtered`,
    '/directory?category=' + encodeURIComponent('الوثائق الحكومية') + '&channel=ONLINE_SUBMISSION'
  )
  await shoot(context, `${label}-service-guest`, '/service/muni-dir-complaint-against-municipality')
  await shoot(context, `${label}-service-info`, '/service/national-id')
  const page = await context.newPage()
  const otp = await page.request.post(`${base}/api/onboarding/request-otp`, { data: { phone: '07801234567' } })
  const { challengeId } = await otp.json()
  await page.request.post(`${base}/api/onboarding/verify-phone`, {
    data: { phone: '07801234567', challengeId, otp: '246810' },
  })
  await page.close()
  await shoot(context, `${label}-service-citizen`, '/service/muni-dir-complaint-against-municipality')
  await shoot(context, `${label}-citizen-dashboard`, '/citizen')
  await context.close()
}
await browser.close()
console.log(errors.length ? errors.join('\n') : 'no console errors')
