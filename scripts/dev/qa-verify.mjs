// Focused post-fix verification: each role's main screens, console errors, failed requests, overflow.
import { chromium } from 'playwright'
const base = process.env.QA_BASE || 'http://localhost:8787'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const accounts = {
  superadmin: { username: 'superadmin', password: 'Admin-Strong-2026!' },
  employee: { username: 'emp.muni', password: 'Emp-Muni-2026!' },
  reviewer: { username: 'reviewer.qa', password: 'Audit-Pass-2026!' },
  operations: { username: 'ops.qa', password: 'Audit-Pass-2026!' },
}
const routes = {
  employee: ['/employee', '/staff/security'],
  reviewer: ['/employee', '/staff/security'],
  operations: ['/operations', '/governor', '/staff/security'],
  superadmin: ['/super-admin#departments', '/super-admin#citizens', '/super-admin#staff', '/operations'],
}
let ip = 90
for (const [role, list] of Object.entries(routes)) {
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { 'X-Forwarded-For': `10.7.${ip++}.3` },
  })
  const login = await ctx.request.post(`${base}/api/auth/staff/login`, { data: accounts[role] })
  if (login.status() !== 200) { console.log('LOGIN FAILED', role, login.status()); continue }
  const page = await ctx.newPage()
  const errors = [], failed = []
  page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|net::ERR|tile/.test(m.text())) errors.push(m.text().slice(0, 160)) })
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message.slice(0, 160)))
  page.on('response', r => { if (r.status() >= 400 && !/openstreetmap|tile|profile-photo/.test(r.url())) failed.push(`${r.status()} ${r.url().replace(base, '')}`) })
  for (const route of list) {
    errors.length = 0; failed.length = 0
    await page.goto(base + route, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(900)
    const info = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      h1: document.querySelector('h1')?.textContent?.trim().slice(0, 60) || null,
      gate: document.querySelector('.access-gate-page')?.innerText.slice(0, 60) || null,
      height: document.body.scrollHeight,
    }))
    console.log(`${role} ${route} :: h1="${info.h1}" gate=${info.gate ? JSON.stringify(info.gate) : 'none'} overflow=${info.overflow} h=${info.height} errors=${errors.length ? JSON.stringify(errors.slice(0, 2)) : 0} failed=${failed.length ? JSON.stringify(failed.slice(0, 3)) : 0}`)
  }
  await ctx.close()
}
await browser.close()
