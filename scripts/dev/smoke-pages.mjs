import { chromium } from 'playwright'
const base = process.env.QA_BASE || 'http://localhost:8787'
const routes = ['/', '/directory', '/login', '/onboarding', '/verify', '/operations/login', '/super-admin/login', '/employee', '/service/store-license', '/nope']
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
for (const route of routes) {
  await page.goto(base + route, { waitUntil: 'networkidle' })
  const text = (await page.textContent('body'))?.replace(/\s+/g, ' ').slice(0, 80)
  console.log(route.padEnd(24), '→', text)
}
await browser.close()
console.log(errors.length ? errors.join('\n') : 'no browser errors')
