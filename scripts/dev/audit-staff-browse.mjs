// Staff-side audit walk: every staff route × role × viewport × theme, collecting console errors,
// failed requests, horizontal overflow and screenshots (dev helper).
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.env.QA_BASE || 'http://localhost:8787'
const outDir = 'qa-screens/audit-staff'
mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const report = []
let ipCounter = 40

const accounts = {
  superadmin: { username: 'superadmin', password: 'Admin-Strong-2026!' },
  employee: { username: 'emp.muni', password: 'Emp-Muni-2026!' },
  reviewer: { username: 'reviewer.qa', password: 'Audit-Pass-2026!' },
  operations: { username: 'ops.qa', password: 'Audit-Pass-2026!' },
  nodept: { username: 'emp.nodept', password: 'Audit-Pass-2026!' },
}

const routesByRole = {
  anon: ['/staff/login', '/employee', '/department/dhiqar-municipalities', '/operations', '/governor', '/super-admin', '/staff/security'],
  employee: [
    '/employee#employee-service-requests',
    '/employee#employee-applications',
    '/employee#employee-identity-reviews',
    '/employee#employee-feedback',
    '/employee#employee-archive',
    '/employee#employee-activity',
    '/department/dhiqar-municipalities',
    '/department/dhiqar-sewerage',
    '/staff/security',
    '/operations',
    '/super-admin',
  ],
  reviewer: ['/employee#employee-service-requests', '/employee#employee-identity-reviews', '/employee#employee-applications', '/staff/security'],
  operations: ['/operations', '/governor', '/department/dhiqar-municipalities', '/staff/security', '/employee'],
  nodept: ['/employee#employee-service-requests', '/employee#employee-applications'],
  superadmin: [
    '/super-admin#overview',
    '/super-admin#requests',
    '/super-admin#staff',
    '/super-admin#citizens',
    '/super-admin#departments',
    '/super-admin#national',
    '/super-admin#system',
    '/employee#employee-service-requests',
    '/employee#employee-identity-reviews',
    '/department/dhiqar-municipalities',
    '/operations',
    '/governor',
    '/staff/security',
  ],
}

const viewports = [
  { name: 'desktop', width: 1366, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]

for (const [role, routes] of Object.entries(routesByRole)) {
  for (const vp of viewports) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        extraHTTPHeaders: { 'X-Forwarded-For': `10.9.${ipCounter++}.7` },
        locale: 'ar-IQ',
      })
      if (role !== 'anon') {
        const login = await ctx.request.post(`${base}/api/auth/staff/login`, { data: accounts[role] })
        if (login.status() !== 200) console.log('LOGIN FAILED', role, login.status(), await login.text())
      }
      const page = await ctx.newPage()
      const errors = []
      const failed = []
      page.on('console', msg => {
        if (msg.type() === 'error' && !/ERR_TUNNEL|net::ERR/.test(msg.text())) errors.push(msg.text().slice(0, 300))
      })
      page.on('pageerror', err => errors.push(`PAGEERROR ${err.message}`))
      page.on('response', res => {
        const url = res.url()
        if (res.status() >= 400 && !/openstreetmap|tile|profile-photo/.test(url))
          failed.push(`${res.status()} ${res.request().method()} ${url.replace(base, '')}`)
      })
      await page.addInitScript(t => {
        if (t === 'dark') document.documentElement.setAttribute('data-gov-theme', 'dark')
      }, theme)
      for (const route of routes) {
        errors.length = 0
        failed.length = 0
        const slug = `${role}-${route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}-${vp.name}-${theme}`
        try {
          await page.goto(`${base}${route}`, { waitUntil: 'networkidle', timeout: 20000 })
          await page.waitForTimeout(900)
          if (theme === 'dark') await page.evaluate(() => document.documentElement.setAttribute('data-gov-theme', 'dark'))
          await page.waitForTimeout(300)
          const info = await page.evaluate(() => {
            const doc = document.documentElement
            const overflow = doc.scrollWidth - doc.clientWidth
            const offenders = []
            if (overflow > 2) {
              for (const el of document.querySelectorAll('body *')) {
                const r = el.getBoundingClientRect()
                if (r.right > doc.clientWidth + 2 && r.width > 40) {
                  offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')} right=${Math.round(r.right)}`)
                  if (offenders.length > 6) break
                }
              }
            }
            const text = document.body.innerText
            const englishEnums = (text.match(/\b[A-Z_]{6,}\b/g) || []).filter(w => !/^(STAFF|ACCESS|GIS|SLA|TOTP|PDF|OCR|MFA|KB|QR)$/.test(w))
            return {
              title: document.title,
              url: location.href,
              overflow,
              offenders,
              englishEnums: [...new Set(englishEnums)].slice(0, 12),
              h1: [...document.querySelectorAll('h1')].map(h => h.textContent.trim()).slice(0, 3),
              gate: document.querySelector('.access-gate-page')?.innerText.slice(0, 120) || null,
              errorsOnPage: [...document.querySelectorAll('.form-error')].map(e => e.textContent.trim().slice(0, 160)),
              bodyLen: text.length,
            }
          })
          await page.screenshot({ path: `${outDir}/${slug}.png`, fullPage: true })
          report.push({ role, route, viewport: vp.name, theme, ...info, consoleErrors: [...errors], failedRequests: [...failed] })
          console.log(slug, `overflow=${info.overflow}`, failed.length ? failed.join(' | ') : '', errors.length ? `ERR:${errors.join(' | ')}` : '', info.gate ? `GATE:${info.gate.slice(0, 40)}` : '')
        } catch (error) {
          report.push({ role, route, viewport: vp.name, theme, error: error.message, consoleErrors: [...errors], failedRequests: [...failed] })
          console.log(slug, 'FAILED', error.message.slice(0, 200))
        }
      }
      await ctx.close()
    }
  }
}
writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2))
await browser.close()
