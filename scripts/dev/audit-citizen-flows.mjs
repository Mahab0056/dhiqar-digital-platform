// Audit helper: interactive citizen flows (dev only).
import { chromium } from 'playwright'
import fs from 'node:fs'

const base = 'http://localhost:8787'
const phone = '07801112233'
const out = 'qa-screens/audit'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const findings = []
const note = (k, v) => {
  findings.push([k, v])
  console.log(`## ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`)
}
const scrollAll = async page => {
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight
    for (let y = 0; y < h; y += 500) {
      window.scrollTo(0, y)
      await new Promise(r => setTimeout(r, 60))
    }
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(500)
}
const watch = (page, bucket) => {
  page.on('pageerror', e => bucket.push(`pageerror: ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_TUNNEL|openstreetmap|nominatim|401|404/.test(m.text())) bucket.push(`console: ${m.text().slice(0, 160)}`)
  })
}

// ---------- guest: homepage ----------
if (!process.env.SKIP_HOME) {
  const ctx = await browser.newContext({ locale: 'ar-IQ' })
  const page = await ctx.newPage()
  const errs = []
  watch(page, errs)
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto(base + '/', { waitUntil: 'networkidle' })
  await scrollAll(page)
  await page.screenshot({ path: `${out}/home-desktop-full.png`, fullPage: true })
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')))
  const unique = [...new Set(links)]
  note('home links', unique)
  // check internal links resolve to a non-404 page
  const bad = []
  for (const href of unique) {
    if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto') || href.startsWith('tel')) continue
    const p = await ctx.newPage()
    await p.goto(base + href, { waitUntil: 'networkidle' }).catch(() => {})
    const t = await p.textContent('body')
    if (/404|الصفحة غير موجودة/.test(t || '')) bad.push(href)
    await p.close()
  }
  note('home internal links leading to 404', bad)
  const voice = await page.locator('.gov-search-voice').count()
  note('voice button present', voice)
  await page.fill('.smart-search input', 'ولادة')
  await page.waitForTimeout(800)
  const results = await page.locator('.gov-search-results li').allTextContents()
  note('search results for ولادة', results)
  await page.screenshot({ path: `${out}/home-search-dropdown.png` })
  await page.fill('.smart-search input', 'zzzz')
  await page.waitForTimeout(800)
  note('search no-result state text', await page.locator('.smart-search').innerText())
  await page.fill('.smart-search input', 'ولادة')
  await page.waitForTimeout(600)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  note('enter on search navigates to', page.url())
  // suggestions chips
  await page.goto(base + '/', { waitUntil: 'networkidle' })
  const chips = await page.locator('.gov-search ~ * button, .hero-suggestions button, [class*=suggest] button').allTextContents().catch(() => [])
  note('quick suggestion chips', chips)
  // language switch & dark mode buttons
  const utility = await page.locator('.civic-utility-bar, .gov-utility, header').first().innerText()
  note('utility bar text', utility.slice(0, 200))
  const eng = page.getByText('English').first()
  if (await eng.count()) {
    await eng.click().catch(() => {})
    await page.waitForTimeout(500)
    note('after clicking English: url/dir/lang', { url: page.url(), dir: await page.evaluate(() => document.documentElement.dir), lang: await page.evaluate(() => document.documentElement.lang), sample: (await page.textContent('h1'))?.slice(0, 80) })
  }
  const a11y = page.getByText('إمكانية الوصول').first()
  if (await a11y.count()) {
    await a11y.click().catch(() => {})
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${out}/home-a11y-click.png` })
    note('after clicking إمكانية الوصول', await page.evaluate(() => ({ cls: document.documentElement.className, attrs: [...document.documentElement.attributes].map(a => a.name + '=' + a.value) })))
  }
  note('home errors', errs)
  // mobile home
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base + '/', { waitUntil: 'networkidle' })
  await scrollAll(page)
  await page.screenshot({ path: `${out}/home-mobile-full.png`, fullPage: true })
  await page.screenshot({ path: `${out}/home-mobile-top.png` })
  await ctx.close()
}

// ---------- guest: service page flow -> onboarding ----------
if (!process.env.SKIP_ONB) {
  const ctx = await browser.newContext({ locale: 'ar-IQ', permissions: ['geolocation'], geolocation: { latitude: 31.05, longitude: 46.25 } })
  const page = await ctx.newPage()
  await page.route('**/api/onboarding/identity-extract-preview', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'PROVIDER_UNAVAILABLE', reason: 'NOT_CONFIGURED', provider: null, confidence: null, documentTypeDetected: null, fields: { fullName: null, documentNumber: null, dateOfBirth: null, nationality: null, sex: null, expiryDate: null }, documentNumberMasked: null, message: 'التحليل التلقائي متوقف لأن مزود قراءة المستندات غير مهيأ في بيئة المنصة. لا تُخمن أي بيانات؛ سيعاد التحليل تلقائياً بعد تهيئة المزود.' }) }))
  const errs = []
  watch(page, errs)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base + '/service/health-birth-certificate', { waitUntil: 'networkidle' })
  await scrollAll(page)
  await page.screenshot({ path: `${out}/service-birth-mobile-guest.png`, fullPage: true })
  const feeLine = await page.locator('.gov-service-header').innerText()
  note('birth cert header text', feeLine)
  // sticky submit bar geometry
  const sticky = await page.evaluate(() => {
    const el = document.querySelector('.dynamic-form-submit')
    const r = el?.getBoundingClientRect()
    return { pos: el && getComputedStyle(el).position, top: r?.top, bottom: r?.bottom, vh: innerHeight }
  })
  note('sticky submit bar geometry mobile', sticky)
  // fill required fields and submit as guest -> expect redirect to onboarding with continue
  await page.fill('input[name=fullName]', 'اختبار مواطن')
  await page.fill('input[name=newbornName]', 'علي')
  await page.fill('input[name=birthDate]', '2026-08-20')
  await page.fill('input[name=birthPlace]', 'مستشفى')
  await page.selectOption('select[name=requestType]', 'شهادة ولادة')
  await page.selectOption('select[name=district]', 'الناصرية')
  await page.fill('input[name=phone]', phone)
  await page.click('.dynamic-form-submit button')
  await page.waitForTimeout(800)
  note('guest submit redirects to', page.url())
  note('native validity', await page.evaluate(() => [...document.querySelectorAll('form :invalid')].map(e => e.name)))
  if (!page.url().includes('/onboarding')) await page.goto(base + '/onboarding?continue=/service/health-birth-certificate', { waitUntil: 'networkidle' })
  await page.screenshot({ path: `${out}/onboarding-mobile-step1.png`, fullPage: true })
  // onboarding: bad phone
  await page.fill('.onboarding-panel input[inputmode=tel]', '1234567890')
  await page.click('.onboarding-panel button.primary')
  await page.waitForTimeout(800)
  note('onboarding bad phone message', await page.locator('.form-error, .form-success').allTextContents())
  await page.fill('.onboarding-panel input[inputmode=tel]', '07809990001')
  await page.click('.onboarding-panel button.primary')
  await page.waitForTimeout(800)
  note('onboarding otp requested notice', await page.locator('.form-error, .form-success').allTextContents())
  await page.fill('.onboarding-panel input[inputmode=numeric]', '000000')
  await page.click('.onboarding-panel button.primary')
  await page.waitForTimeout(800)
  note('onboarding wrong otp message', await page.locator('.form-error, .form-success').allTextContents())
  await page.fill('.onboarding-panel input[inputmode=numeric]', '246810')
  await page.click('.onboarding-panel button.primary')
  await page.waitForTimeout(1000)
  note('onboarding after otp: url + step', { url: page.url(), stepper: await page.locator('.stepper').innerText().catch(() => 'n/a'), h2: await page.locator('.onboarding-panel h2').innerText().catch(() => '') })
  await page.screenshot({ path: `${out}/onboarding-mobile-step2.png`, fullPage: true })
  // open camera with no camera → message
  await page.click('.secure-capture .capture-actions button.secondary')
  await page.waitForTimeout(1500)
  note('onboarding open camera without camera', await page.locator('.capture-error').allTextContents())
  await page.screenshot({ path: `${out}/onboarding-mobile-camera-error.png`, fullPage: true })
  // upload a file instead
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
  await page.setInputFiles('.secure-capture input[type=file]', { name: 'id.jpg', mimeType: 'image/jpeg', buffer: jpeg })
  await page.waitForTimeout(2500)
  note('onboarding after upload: analysis status', await page.locator('.automatic-analysis-status, .form-notice, .form-success, .form-error').allTextContents())
  await page.screenshot({ path: `${out}/onboarding-mobile-step2-uploaded.png`, fullPage: true })
  await page.click('.stage-actions button.primary')
  await page.waitForTimeout(600)
  note('onboarding step3 heading', await page.locator('.onboarding-panel h2').innerText())
  await page.screenshot({ path: `${out}/onboarding-mobile-step3.png`, fullPage: true })
  // step 3 needs back photo + name + number
  await page.setInputFiles('.secure-capture input[type=file]', { name: 'back.jpg', mimeType: 'image/jpeg', buffer: jpeg })
  await page.fill('.identity-edit-fields input[autocomplete=name]', 'اختبار مواطن')
  await page.fill('.identity-edit-fields label:nth-child(2) input', '199012345')
  await page.waitForTimeout(300)
  await page.click('.stage-actions button.primary')
  await page.waitForTimeout(2500)
  note('onboarding step4 (after geolocation) heading/messages', { h2: await page.locator('.onboarding-panel h2').innerText(), msgs: await page.locator('.form-error, .form-success').allTextContents() })
  await page.screenshot({ path: `${out}/onboarding-mobile-step4.png`, fullPage: true })
  const uploadBtn = await page.locator('.secure-capture .capture-actions button.ghost').count()
  note('step4 face video: upload fallback button count (cameraOnly)', uploadBtn)
  await page.click('.secure-capture .capture-actions button.secondary')
  await page.waitForTimeout(1500)
  note('step4 face video camera error text', await page.locator('.capture-error').allTextContents())
  await page.screenshot({ path: `${out}/onboarding-mobile-step4-camera-error.png`, fullPage: true })
  // retain media checkbox uncheck → try
  await page.locator('.consent-box input').nth(1).uncheck()
  note('submit disabled when retainMedia unchecked', await page.locator('.stage-actions button.primary').isDisabled())
  // X close link target
  note('onboarding header X href', await page.locator('.onboarding-header a').last().getAttribute('href'))
  note('onboarding errors', errs)
  await ctx.close()
}

// ---------- citizen: dashboard interactions ----------
if (!process.env.SKIP_CIT) {
  const ctx = await browser.newContext({ locale: 'ar-IQ' })
  const otp = await (await ctx.request.post(`${base}/api/onboarding/request-otp`, { data: { phone } })).json()
  await ctx.request.post(`${base}/api/onboarding/verify-phone`, { data: { phone, challengeId: otp.challengeId, otp: '246810' } })
  const page = await ctx.newPage()
  const errs = []
  watch(page, errs)
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto(base + '/citizen', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${out}/citizen-dashboard-desktop-top.png` })
  if (process.env.FROM_PAY) { await page.goto(base + '/citizen/pay/PAY-2026-00001', { waitUntil: 'networkidle' }); await page.waitForTimeout(500) }
  if (!process.env.FROM_PAY) {
  const before = await page.evaluate(() => scrollY)
  await page.click('.citizen-v2-hero-actions a.button.primary')
  await page.waitForTimeout(600)
  note('click تصفح الخدمات (hash link): url + scrollY', { url: page.url(), before, after: await page.evaluate(() => scrollY) })
  await page.evaluate(() => scrollTo(0, 0))
  const cats = await page.locator('.citizen-service-controls nav button').allTextContents()
  note('dashboard category buttons', cats)
  const navGeom = await page.evaluate(() => {
    const nav = document.querySelector('.citizen-service-controls nav')
    const r = nav.getBoundingClientRect()
    return { overflowX: getComputedStyle(nav).overflowX, scrollWidth: nav.scrollWidth, clientWidth: nav.clientWidth, left: r.left, right: r.right }
  })
  note('category nav geometry', navGeom)
  const priority = await page.locator('.citizen-priority-card').innerText()
  note('priority card', priority)
  const prioHref = await page.locator('.citizen-priority-card a').getAttribute('href')
  note('priority card href', prioHref)
  const myReq = await page.locator('#my-requests').innerText()
  note('my-requests section', myReq)
  const identity = await page.locator('.citizen-v2-identity-card').innerText()
  note('identity card', identity)
  const stats = await page.locator('.progress-stat-row').innerText()
  note('stats', stats)
  const general = await page.locator('#general-requests').innerText().catch(() => 'none')
  note('general requests section', general)
  const reminder = await page.locator('.citizen-v2-reminder').innerText().catch(() => 'none')
  note('reminder', reminder)
  const docs = await page.locator('#issued-documents').innerText()
  note('issued docs', docs)
  const pdfHref = await page.locator('#issued-documents a.button.primary').first().getAttribute('href').catch(() => null)
  if (pdfHref) {
    const r = await ctx.request.get(base + pdfHref)
    note('pdf preview response', { href: pdfHref, status: r.status(), type: r.headers()['content-type'] })
  }
  // sidebar / logout
  note('sidebar text', await page.locator('.portal-sidebar').innerText())
  note('sidebar logout href', await page.locator('.sidebar-logout').getAttribute('href'))
  // topbar search
  await page.fill('.topbar-search input', 'ولادة')
  await page.waitForTimeout(400)
  note('topbar search results', await page.locator('.topbar-search-results a').allTextContents())
  await page.fill('.topbar-search input', '')
  // checklist upload rejected doc
  const uploadLabel = page.locator('.citizen-checklist label.button').first()
  if (await uploadLabel.count()) {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
    await uploadLabel.locator('input').setInputFiles({ name: 'id2.jpg', mimeType: 'image/jpeg', buffer: jpeg })
    await page.waitForTimeout(1500)
    note('after checklist re-upload', await page.locator('.citizen-service-request').first().innerText())
  }
  await scrollAll(page)
  await page.screenshot({ path: `${out}/citizen-dashboard-desktop-full.png`, fullPage: true })
  // notifications page + push card
  await page.goto(base + '/citizen/notifications', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  note('push card', await page.locator('.push-card').innerText().catch(() => 'no push card'))
  note('push config', await (await ctx.request.get(base + '/api/push/config')).text())
  const pushBtn = page.locator('.push-card button')
  if (await pushBtn.count()) {
    await pushBtn.click()
    await page.waitForTimeout(1500)
    note('push after click', await page.locator('.push-card').innerText())
  }
  note('notifications list', (await page.locator('.citizen-notifications-full-list').innerText().catch(() => 'empty')).slice(0, 1200))
  await page.screenshot({ path: `${out}/citizen-notifications-desktop.png`, fullPage: true })
  // feedback page
  await page.goto(base + '/citizen/feedback', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const deptOptions = await page.locator('.feedback-fields select').nth(1).locator('option').allTextContents()
  note('feedback department options', deptOptions)
  await page.click('.feedback-submit button')
  await page.waitForTimeout(400)
  note('feedback empty submit error', await page.locator('.form-error').allTextContents())
  const errBox = await page.locator('.form-error').boundingBox()
  note('feedback error box position vs viewport', { errBox, scrollY: await page.evaluate(() => scrollY), vh: 768 })
  await page.fill('.feedback-fields input', 'عنوان تجريبي طويل')
  await page.click('.feedback-submit button')
  await page.waitForTimeout(400)
  note('feedback short desc error', await page.locator('.form-error').allTextContents())
  // map click
  const map = page.locator('.gov-location-map')
  const mb = await map.boundingBox()
  await map.scrollIntoViewIfNeeded()
  await page.mouse.click(mb.x + mb.width / 2, mb.y + mb.height / 2)
  await page.waitForTimeout(800)
  note('after map click status', await page.locator('.gov-location-status').innerText())
  await page.fill('.gov-location-search input', 'الناصرية شارع')
  await page.waitForTimeout(1500)
  note('address search hits (external blocked)', await page.locator('.gov-location-hits').innerText().catch(() => 'no dropdown'))
  await page.screenshot({ path: `${out}/citizen-feedback-desktop.png`, fullPage: true })
  // application page dead button
  await page.goto(base + '/citizen/application/TQD-2026-0002', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const supportBtn = page.locator('.support-card button')
  note('support button attrs', await supportBtn.evaluate(b => ({ onclick: b.onclick, type: b.type, text: b.textContent })))
  await page.goto(base + '/citizen/application/TQD-2026-0001', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  note('approved-with-fee application text', (await page.locator('.current-action, .detail-aside').allInnerTexts()).join(' | '))
  // payment flow
  await page.goto(base + '/citizen/pay/PAY-2026-00001', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  }
  note('payment page', await page.locator('.payment-card').innerText())
  await page.click('.payment-actions button.primary')
  await page.waitForTimeout(1000)
  note('after ادفع click url', page.url())
  await page.screenshot({ path: `${out}/citizen-pay-sandbox.png` })
  note('sandbox buttons disabled after in-app navigation?', await page.locator('.payment-sandbox button').evaluateAll(bs => bs.map(b => b.disabled)))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  note('sandbox buttons disabled after reload?', await page.locator('.payment-sandbox button').evaluateAll(bs => bs.map(b => b.disabled)))
  await page.click('.payment-sandbox button.primary')
  await page.waitForTimeout(1200)
  note('after sandbox pay', { url: page.url(), text: await page.locator('.payment-card').innerText() })
  await page.screenshot({ path: `${out}/citizen-pay-paid.png` })
  // back to dashboard to see paid
  await page.goto(base + '/citizen', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  note('dashboard general requests after payment', (await page.locator('#general-requests').innerText()).slice(0, 1500))
  // logout attempt: click تبديل البوابة → /login
  await page.goto(base + '/login', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  note('login page (as logged-in citizen) text', (await page.locator('main, body').first().innerText()).slice(0, 900))
  await page.screenshot({ path: `${out}/login-as-citizen.png`, fullPage: true })
  note('citizen errors', errs)

  // ---- mobile dashboard checks
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base + '/citizen', { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${out}/citizen-dashboard-mobile-top.png` })
  const bottomNav = await page.evaluate(() => {
    const nav = document.querySelector('.mobile-bottom-nav')
    const r = nav.getBoundingClientRect()
    const cs = getComputedStyle(nav)
    const main = document.querySelector('.portal-content')
    const pb = getComputedStyle(main).paddingBottom
    const items = [...nav.querySelectorAll('a')].map(a => ({ t: a.textContent.trim(), h: Math.round(a.getBoundingClientRect().height), w: Math.round(a.getBoundingClientRect().width), href: a.getAttribute('href') }))
    return { display: cs.display, position: cs.position, top: r.top, height: r.height, mainPaddingBottom: pb, items }
  })
  note('mobile bottom nav', bottomNav)
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(400)
  const lastOverlap = await page.evaluate(() => {
    const nav = document.querySelector('.mobile-bottom-nav').getBoundingClientRect()
    const content = document.querySelector('.portal-content')
    const last = content.lastElementChild.getBoundingClientRect()
    return { navTop: nav.top, contentBottom: last.bottom, overlapped: last.bottom > nav.top }
  })
  note('mobile: last content bottom vs nav top', lastOverlap)
  await page.screenshot({ path: `${out}/citizen-dashboard-mobile-bottom.png` })
  await page.evaluate(() => scrollTo(0, 0))
  await page.click('.mobile-sidebar-button')
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${out}/citizen-mobile-sidebar.png` })
  note('mobile sidebar open geometry', await page.evaluate(() => { const r = document.querySelector('.portal-sidebar').getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width } }))
  await page.click('.sidebar-brand button')
  // tap "معاملاتي" bottom nav → hash
  const y0 = await page.evaluate(() => scrollY)
  await page.click('.mobile-bottom-nav a:nth-child(3)')
  await page.waitForTimeout(800)
  note('tap معاملاتي bottom nav', { url: page.url(), y0, y: await page.evaluate(() => scrollY) })
  // toast overlap / topbar
  note('mobile topbar geometry', await page.evaluate(() => { const r = document.querySelector('.portal-topbar').getBoundingClientRect(); return { top: r.top, h: r.height, pos: getComputedStyle(document.querySelector('.portal-topbar')).position } }))
  // service page mobile with sticky submit vs bottom
  await page.goto(base + '/service/health-birth-certificate', { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await scrollAll(page)
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${out}/service-birth-mobile-citizen-bottom.png` })
  note('service page mobile: doc slots count + first slot buttons', { slots: await page.locator('.gov-doc-slot').count(), btns: await page.locator('.gov-doc-slot').first().locator('button').allTextContents() })
  // appointment page: "documents" step
  await page.goto(base + '/service/online-appointment', { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await scrollAll(page)
  note('appointment page doc slots', await page.locator('.gov-doc-slot-head').allInnerTexts())
  note('appointment header', await page.locator('.gov-service-header').innerText())
  await page.screenshot({ path: `${out}/service-appointment-mobile.png`, fullPage: true })
  // national id
  await page.goto(base + '/service/national-id', { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await scrollAll(page)
  note('national-id page text', (await page.locator('.public-service-main').innerText()).slice(0, 1500))
  note('national-id links', await page.locator('.official-handoff-links a').evaluateAll(as => as.map(a => a.textContent.trim() + ' -> ' + a.href)))
  await page.screenshot({ path: `${out}/service-national-id-mobile.png`, fullPage: true })
  await ctx.close()
}

// ---------- directory ----------
if (!process.env.SKIP_DIR) {
  const ctx = await browser.newContext({ locale: 'ar-IQ' })
  const page = await ctx.newPage()
  const errs = []
  watch(page, errs)
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto(base + '/directory', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  note('directory top text', (await page.locator('main').innerText()).slice(0, 1200))
  note('directory cards count', await page.locator('a[href^="/service/"]').count())
  await page.screenshot({ path: `${out}/directory-desktop-top.png` })
  await page.goto(base + '/directory?q=zzzzzz', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  note('directory no result state', (await page.locator('main').innerText()).slice(0, 600))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base + '/directory', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/directory-mobile-top.png` })
  note('directory errors', errs)
  await ctx.close()
}
fs.writeFileSync(`${out}/flows.json`, JSON.stringify(findings, null, 1))
await browser.close()
