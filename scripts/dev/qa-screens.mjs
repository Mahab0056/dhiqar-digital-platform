// Captures desktop + mobile screenshots of the main surfaces (dev helper).
import { chromium } from 'playwright'
const base = process.env.QA_BASE || 'http://localhost:8787'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const shoot = async (context, name, path, full = true) => {
  const page = await context.newPage()
  await page.goto(base + path, { waitUntil: 'networkidle' }).catch(() => null)
  await page.waitForTimeout(800)
  await page.screenshot({ path: `qa-screens/${name}.png`, fullPage: full })
  await page.close()
}
for (const [label, viewport] of [['desktop', { width: 1366, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const context = await browser.newContext({ viewport, isMobile: label === 'mobile' })
  // citizen session via OTP dev mode
  const page = await context.newPage()
  await page.goto(`${base}/`, { waitUntil: 'networkidle' })
  const otp = await page.request.post(`${base}/api/onboarding/request-otp`, { data: { phone: '07801234567' } })
  const { challengeId } = await otp.json()
  await page.request.post(`${base}/api/onboarding/verify-phone`, { data: { phone: '07801234567', challengeId, otp: '246810' } })
  await page.close()
  for (const [name, path, full] of [
    ['landing', '/', true],
    ['login', '/login', false],
    ['staff-login', '/staff/login', false],
    ['onboarding', '/onboarding', false],
    ['citizen-dashboard', '/citizen', true],
    ['service-form', '/service/store-license', true],
    ['verify', '/verify', false],
    ['departments', '/departments', false],
  ]) await shoot(context, `${label}-${name}`, path, full)
  // staff
  await context.request.post(`${base}/api/auth/logout`)
  await context.request.post(`${base}/api/auth/staff/login`, { data: { username: 'superadmin', password: 'Admin-Strong-2026!' } })
  for (const [name, path, full] of [
    ['employee', '/employee', true],
    ['operations', '/operations', true],
    ['governor', '/governor', true],
    ['super-admin', '/super-admin', true],
    ['security', '/staff/security', true],
  ]) await shoot(context, `${label}-${name}`, path, full)
  await context.close()
}
await browser.close()
console.log('done')
