// Platform QA 2026-10-09 — browser pass over the functional pages (NOT the landing page) at 390px and 1440px.
// Collects console/page errors, failed API calls, horizontal overflow, RTL, broken internal links, and takes a few
// compressed screenshots. Also submits one service form through the real UI (double-clicking the submit button).
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers QA_BASE=http://localhost:4100 QA_DB=/tmp/dq-qa-run/b/qa.sqlite node scripts/qa/ui-pass.mjs
// Requires the API e2e run first (it creates the staff accounts and the verified citizens used here).
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.env.QA_BASE || 'http://localhost:4100'
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('QA_BASE must be a local server.')
const db = new DatabaseSync(process.env.QA_DB)
const outDir = 'qa-screens/2026-10-09'
mkdirSync(outDir, { recursive: true })
const staffPassword = 'QA-Staff-Strong-Pass-2026!'

// set PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers (never run `playwright install` here)
const browser = await chromium.launch()
const findings = []
const pagesChecked = []
const linkTargets = new Set()

async function newContext(width, actor) {
  const context = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 900 },
    deviceScaleFactor: 1,
    locale: 'ar-IQ',
    extraHTTPHeaders: { 'x-forwarded-for': `10.8.${width}.${actor.length}` },
  })
  return context
}

async function loginStaff(context, username, password) {
  const res = await context.request.post(`${base}/api/auth/staff/login`, { data: { username, password } })
  if (res.status() !== 200) throw new Error(`staff login ${username} ${res.status()}`)
}
async function loginCitizen(context, phone) {
  const otp = await (await context.request.post(`${base}/api/onboarding/request-otp`, { data: { phone } })).json()
  const res = await context.request.post(`${base}/api/onboarding/verify-phone`, {
    data: { phone, challengeId: otp.challengeId, otp: '246810' },
  })
  if (res.status() !== 200) throw new Error(`citizen login ${phone} ${res.status()}`)
}

async function visit(context, actor, path, { shot } = {}) {
  const page = await context.newPage()
  const width = page.viewportSize().width
  const errors = []
  const failed = []
  page.on('console', msg => {
    const text = msg.text()
    // sandbox has no internet (map tiles/fonts → ERR_TUNNEL) and the anonymous session probe answers 401 by design
    if (msg.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|status of 401/.test(text)) errors.push(text.slice(0, 200))
  })
  page.on('pageerror', err => errors.push(`pageerror: ${err.message.slice(0, 200)}`))
  page.on('response', res => {
    const url = res.url()
    if (
      url.startsWith(base) &&
      res.status() >= 400 &&
      !url.includes('/api/citizen/profile-photo') &&
      !(res.status() === 401 && url.endsWith('/api/auth/session'))
    )
      failed.push(`${res.status()} ${url.replace(base, '')}`)
  })
  const started = Date.now()
  await page.goto(base + path, { waitUntil: 'networkidle' }).catch(error => errors.push(`goto: ${error.message}`))
  await page.waitForTimeout(600)
  const loadMs = Date.now() - started
  const info = await page.evaluate(() => {
    const doc = document.documentElement
    const anchors = [...document.querySelectorAll('a[href]')]
      .map(a => a.getAttribute('href'))
      .filter(href => href && href.startsWith('/') && !href.startsWith('//'))
    const unlabeled = [...document.querySelectorAll('button')].filter(
      b => !(b.textContent || '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')
    ).length
    const smallTargets = [...document.querySelectorAll('a, button')].filter(el => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24)
    }).length
    return {
      dir: doc.getAttribute('dir') || getComputedStyle(document.body).direction,
      overflow: Math.max(doc.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.trim().slice(0, 80) || '',
      anchors,
      unlabeled,
      smallTargets,
    }
  })
  for (const href of info.anchors) linkTargets.add(href.split('#')[0].split('?')[0] || '/')
  const record = {
    actor,
    path,
    width,
    loadMs,
    dir: info.dir,
    overflowPx: info.overflow,
    h1: info.h1,
    consoleErrors: errors,
    failedRequests: [...new Set(failed)],
    unlabeledButtons: info.unlabeled,
    smallTapTargets: info.smallTargets,
  }
  pagesChecked.push(record)
  if (info.overflow > 1) findings.push(`${actor} ${path} @${width}: horizontal overflow ${info.overflow}px`)
  if (info.dir !== 'rtl') findings.push(`${actor} ${path} @${width}: direction ${info.dir}`)
  if (errors.length) findings.push(`${actor} ${path} @${width}: console errors: ${errors.slice(0, 2).join(' | ')}`)
  if (record.failedRequests.length)
    findings.push(`${actor} ${path} @${width}: failed requests: ${record.failedRequests.slice(0, 3).join(', ')}`)
  if (shot)
    await page.screenshot({ path: `${outDir}/${shot}-${width}.jpg`, type: 'jpeg', quality: 45, fullPage: false })
  return page
}

const serviceReq = db.prepare("SELECT reference FROM service_requests WHERE status = 'APPROVED' LIMIT 1").get()
const verification = db.prepare("SELECT verification_id FROM issued_documents WHERE status = 'ACTIVE' LIMIT 1").get()
const payment = db.prepare('SELECT reference FROM payment_intents ORDER BY created_at LIMIT 1').get()

const publicPages = [
  ['/directory', 'directory'],
  ['/departments', 'departments'],
  ['/departments/dhiqar-governorate', null],
  ['/service/gov-low-cost-housing', 'service-form-anon'],
  ['/service/health-birth-certificate', null],
  ['/onboarding', 'onboarding'],
  ['/login', null],
  ['/staff/login', null],
  [`/verify/${verification?.verification_id}`, 'verify'],
  ['/verify', null],
  ['/privacy', null],
  ['/this-page-does-not-exist', null],
]

for (const width of [390, 1440]) {
  // ---- anonymous -----------------------------------------------------------------------------
  const anon = await newContext(width, 'anon')
  for (const [path, shot] of publicPages) await (await visit(anon, 'anon', path, { shot })).close()
  // protected pages without a session must not leak data
  for (const path of ['/citizen', '/employee', '/operations', '/super-admin'])
    await (
      await visit(anon, 'anon', path, { shot: path === '/employee' && width === 390 ? 'employee-no-session' : null })
    ).close()
  await anon.close()

  // ---- citizen B (verified, has a paid + approved request) ------------------------------------
  const citizen = await newContext(width, 'citizen')
  await loginCitizen(citizen, '07701110002')
  for (const [path, shot] of [
    ['/citizen', 'citizen-dashboard'],
    ['/citizen/notifications', null],
    ['/citizen/feedback', null],
    [`/citizen/pay/${payment?.reference}`, 'citizen-payment'],
  ])
    await (await visit(citizen, 'citizen', path, { shot })).close()
  await citizen.close()

  // ---- staff ----------------------------------------------------------------------------------
  for (const [username, paths] of [
    [
      'qa.gov',
      [
        ['/employee', 'employee-queue'],
        ['/department/dhiqar-governorate', 'department-dashboard'],
        ['/staff/security', null],
      ],
    ],
    [
      'qa.ops',
      [
        ['/operations', 'operations-room'],
        ['/governor', null],
        ['/department/dhiqar-governorate', null],
      ],
    ],
    ['admin', [['/super-admin', 'super-admin']]],
  ]) {
    const staff = await newContext(width, username)
    await loginStaff(staff, username, username === 'admin' ? 'QA-Admin-Strong-Pass-2026!' : staffPassword)
    for (const [path, shot] of paths) await (await visit(staff, username, path, { shot })).close()
    await staff.close()
  }
}

// ---- broken internal links (server answers 404 for non-client routes) -------------------------------
const brokenLinks = []
for (const href of linkTargets) {
  if (href.startsWith('/api/')) continue
  const res = await fetch(base + href, { redirect: 'manual' })
  if (res.status >= 400) brokenLinks.push(`${res.status} ${href}`)
}
for (const link of brokenLinks) findings.push(`broken internal link: ${link}`)

// ---- real UI submission with a double click on «إرسال» (citizen B, mobile) ---------------------------
let uiSubmission = 'not run'
{
  const context = await newContext(390, 'submit')
  await loginCitizen(context, '07701110002')
  const page = await context.newPage()
  const posts = []
  page.on('request', req => {
    if (req.method() === 'POST' && req.url().endsWith('/api/service-requests')) posts.push(req.url())
  })
  await page.goto(`${base}/service/gov-low-cost-housing`, { waitUntil: 'networkidle' })
  const before = db.prepare('SELECT COUNT(*) AS n FROM service_requests').get().n
  const form = page
    .locator('form')
    .filter({ has: page.locator('button[type=submit]') })
    .first()
  for (const select of await form.locator('select').all()) {
    const options = await select.locator('option').evaluateAll(list => list.map(o => o.value).filter(Boolean))
    if (options.length) await select.selectOption(options[0])
  }
  for (const input of await form.locator('input:not([type=file]):not([type=checkbox]):not([type=hidden])').all()) {
    const type = await input.getAttribute('type')
    const mode = await input.getAttribute('inputmode')
    if ((await input.inputValue()) !== '') continue
    // digits typed the way an Arabic phone keyboard types them (٠-٩) to exercise server-side normalization
    await input.fill(
      type === 'tel' ? '٠٧٧٠١٢٣٤٥٦٧' : mode === 'numeric' ? '٤' : type === 'date' ? '2026-10-20' : 'قيمة اختبار'
    )
  }
  const pdf = {
    name: 'doc.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(800, 32)]),
  }
  const video = {
    name: 'face.webm',
    mimeType: 'video/webm',
    buffer: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(4000, 3)]),
  }
  for (const input of await page.locator('input[type=file]').all()) {
    const accept = (await input.getAttribute('accept')) || ''
    await input.setInputFiles(accept.includes('video') ? video : pdf)
  }
  for (const box of await form.locator('input[type=checkbox]').all()) await box.check().catch(() => {})
  await page.screenshot({ path: `${outDir}/service-form-filled-390.jpg`, type: 'jpeg', quality: 45, fullPage: false })
  const submit = form.locator('button[type=submit]')
  await submit.dblclick()
  await page.waitForTimeout(2500)
  const after = db.prepare('SELECT COUNT(*) AS n FROM service_requests').get().n
  const banner = (await page.locator('main').innerText()).match(/TQS-\d{4}-\d{5}/)?.[0] || ''
  await page.screenshot({ path: `${outDir}/service-form-result-390.jpg`, type: 'jpeg', quality: 45, fullPage: false })
  const errorText = await page
    .locator('.form-error, [role=alert]')
    .allInnerTexts()
    .catch(() => [])
  uiSubmission = `POSTs sent=${posts.length}, rows created=${after - before}, reference on screen=${banner || 'none'}${errorText.length ? `, messages=${errorText.join(' | ').slice(0, 200)}` : ''}`
  await context.close()
}

await browser.close()
const report = { base, ranAt: new Date().toISOString(), uiSubmission, brokenLinks, findings, pagesChecked }
writeFileSync(`${outDir}/ui-pass-results.json`, JSON.stringify(report, null, 2))
console.log(`pages checked: ${pagesChecked.length}; links checked: ${linkTargets.size}; broken: ${brokenLinks.length}`)
console.log(`UI submission (double click): ${uiSubmission}`)
for (const finding of findings) console.log(`- ${finding}`)
const slow = pagesChecked.filter(p => p.loadMs > 3000)
if (slow.length)
  console.log(`slow (>3s to networkidle): ${slow.map(p => `${p.path}@${p.width} ${p.loadMs}ms`).join(', ')}`)
