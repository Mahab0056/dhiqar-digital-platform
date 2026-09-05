import { chromium } from 'playwright'
const base = 'http://localhost:8787'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
await page.goto(`${base}/departments`, { waitUntil: 'networkidle' })
await page.screenshot({ path: 'qa-screens/departments-directory.png', fullPage: false })
await page.goto(`${base}/departments/dhiqar-municipalities`, { waitUntil: 'networkidle' })
await page.screenshot({ path: 'qa-screens/department-public.png', fullPage: true })
// login as superadmin (already rotated) and open dashboard
await page.goto(`${base}/staff/login`, { waitUntil: 'networkidle' })
await page.fill('input[autocomplete="username"]', 'superadmin')
await page.fill('input[autocomplete="current-password"]', 'Admin-Strong-2026!')
await page.click('button[type=submit]')
await page.waitForTimeout(2000)
await page.goto(`${base}/department/dhiqar-municipalities`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
await page.screenshot({ path: 'qa-screens/department-dashboard.png', fullPage: true })
await page.goto(`${base}/super-admin`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: 'qa-screens/super-admin.png', fullPage: true })
await browser.close()
console.log(errors.length ? errors.join('\n') : 'no page errors')
