// Staff-side interactive probes for the audit (dev helper). Writes qa-screens/audit-staff/flows.json.
import { chromium } from 'playwright'
import { createHmac } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const base = process.env.QA_BASE || 'http://localhost:8787'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const out = {}
let ip = 120
const log = (k, v) => {
  out[k] = v
  console.log(k, JSON.stringify(v).slice(0, 400))
}
const ctxFor = async (creds, viewport = { width: 1366, height: 900 }) => {
  const ctx = await browser.newContext({ viewport, extraHTTPHeaders: { 'X-Forwarded-For': `10.8.${ip++}.3` } })
  if (creds) {
    const r = await ctx.request.post(`${base}/api/auth/staff/login`, { data: creds })
    if (r.status() !== 200) console.log('login failed', creds.username, await r.text())
  }
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on(
    'console',
    m => m.type() === 'error' && !/ERR_TUNNEL|WebSocket|401|403/.test(m.text()) && errors.push(m.text())
  )
  return { ctx, page, errors }
}

// ---- A. super-admin departments tab overflow -------------------------------------------------
{
  const { ctx, page } = await ctxFor({ username: 'superadmin', password: 'Admin-Strong-2026!' })
  await page.goto(`${base}/super-admin#departments`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const m = await page.evaluate(() => {
    const strip = document.querySelector('.department-workbench-tabs')
    const cs = strip && getComputedStyle(strip)
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      stripScrollWidth: strip?.scrollWidth,
      stripClientWidth: strip?.clientWidth,
      overflowX: cs?.overflowX,
      chips: strip?.children.length,
      mainScrollWidth: document.querySelector('.ops-main')?.scrollWidth,
    }
  })
  log('A.departmentsTabOverflow', m)
  await page.screenshot({ path: 'qa-screens/audit-staff-superadmin-departments-strip.png' })
  await ctx.close()
}

// ---- B. employee mobile bottom nav overlap ---------------------------------------------------
{
  const { ctx, page } = await ctxFor({ username: 'emp.muni', password: 'Emp-Muni-2026!' }, { width: 390, height: 844 })
  await page.goto(`${base}/employee`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const m = await page.evaluate(() => {
    const fixed = [...document.querySelectorAll('body *')].filter(
      el =>
        getComputedStyle(el).position === 'fixed' &&
        el.getBoundingClientRect().height > 30 &&
        el.getBoundingClientRect().bottom >= innerHeight - 2
    )
    const nav = fixed[0]
    const tabbar = document.querySelector('.workspace-tabbar')
    return {
      fixedBottom: fixed.map(
        el =>
          `${el.tagName}.${el.className} h=${Math.round(el.getBoundingClientRect().height)} items=${el.querySelectorAll('a,button').length}`
      ),
      bodyPaddingBottom: getComputedStyle(document.body).paddingBottom,
      mainPaddingBottom: getComputedStyle(document.querySelector('.portal-main') || document.body).paddingBottom,
      docHeight: document.documentElement.scrollHeight,
      navText: nav?.innerText.replace(/\n/g, ' | '),
      tabbarScrollWidth: tabbar?.scrollWidth,
      tabbarClientWidth: tabbar?.clientWidth,
      tabCount: tabbar?.querySelectorAll('button').length,
    }
  })
  log('B.mobileBottomNav', m)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'qa-screens/audit-staff-employee-mobile-bottom.png' })
  await ctx.close()
}

// ---- C. EMPLOYEE clicks identity approve -----------------------------------------------------
{
  const { ctx, page, errors } = await ctxFor({ username: 'emp.muni', password: 'Emp-Muni-2026!' })
  await page.goto(`${base}/employee#employee-identity-reviews`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const btn = page.getByRole('button', { name: /اعتماد بعد المراجعة/ })
  const visible = await btn.isVisible().catch(() => false)
  if (visible) await btn.click()
  await page.waitForTimeout(800)
  log('C.employeeIdentityApprove', {
    buttonVisible: visible,
    error: await page
      .locator('.identity-review-admin .form-error')
      .first()
      .innerText()
      .catch(() => null),
    detailBadgeClass: await page.locator('.review-citizen-title .review-status').first().getAttribute('class'),
    fullDocNumberShown: await page
      .locator('.review-extracted-document')
      .innerText()
      .then(t => /\d{10,}/.test(t))
      .catch(() => null),
    errors,
  })
  await page.screenshot({ path: 'qa-screens/audit-staff-employee-identity-forbidden.png', fullPage: false })
  // approved row still shows PENDING badge style?
  await ctx.close()
}

// ---- D. super-admin: payment request + PAYMENT_PENDING select state ---------------------------
{
  const { ctx, page } = await ctxFor({ username: 'superadmin', password: 'Admin-Strong-2026!' })
  const r = await ctx.request.patch(`${base}/api/employee/service-requests/TQS-2026-00003`, {
    data: { status: 'PAYMENT_REQUIRED', amountIqd: 5000, decisionNote: 'رسم إصدار الشهادة' },
  })
  log('D.paymentRequired', { status: r.status(), body: (await r.text()).slice(0, 200) })
  await page.goto(`${base}/employee#employee-service-requests`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page
    .getByRole('button', { name: /TQS-2026-00003/ })
    .first()
    .click()
  await page.waitForTimeout(500)
  const sel = page.locator('.service-request-update select').first()
  const selectState = await sel
    .evaluate(el => ({
      value: el.value,
      selectedText: el.options[el.selectedIndex]?.text,
      options: [...el.options].map(o => `${o.value}${o.disabled ? '(disabled)' : ''}`),
    }))
    .catch(e => e.message)
  log('D.paymentPendingSelect', selectState)
  await page.getByRole('button', { name: /حفظ القرار/ }).click()
  await page.waitForTimeout(800)
  log('D.saveWhilePaymentPending', {
    error: await page
      .locator('.service-requests-admin .form-error')
      .first()
      .innerText()
      .catch(() => null),
  })
  await page.screenshot({ path: 'qa-screens/audit-staff-employee-payment-pending-save.png' })
  await ctx.close()
}

// ---- E. realtime queue update ----------------------------------------------------------------
{
  const { ctx, page } = await ctxFor({ username: 'emp.muni', password: 'Emp-Muni-2026!' })
  await page.goto(`${base}/employee#employee-service-requests`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const before = await page.locator('.service-request-admin-row').count()
  const citizen = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': `10.8.${ip++}.3` } })
  const phone = '07801112233'
  const otp = await (await citizen.request.post(`${base}/api/onboarding/request-otp`, { data: { phone } })).json()
  await citizen.request.post(`${base}/api/onboarding/verify-phone`, {
    data: { phone, challengeId: otp.challengeId, otp: '246810' },
  })
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])
  const submit = await citizen.request.post(`${base}/api/service-requests`, {
    multipart: {
      serviceKey: 'muni-dir-complaint-against-municipality',
      data: JSON.stringify({
        phone,
        district: 'الناصرية',
        municipality: 'الناصرية',
        details: 'اختبار التحديث الفوري لقائمة الموظف.',
      }),
      faceConsent: 'true',
      documentConsent: 'true',
      'doc__national-id': { name: 'id.jpg', mimeType: 'image/jpeg', buffer: jpeg },
      faceVideo: { name: 'face.webm', mimeType: 'video/webm', buffer: webm },
    },
  })
  const created = await submit.json()
  await page.waitForTimeout(2500)
  const after = await page.locator('.service-request-admin-row').count()
  const banner = await page
    .locator('.employee-live-banner, [class*="live"]')
    .allInnerTexts()
    .catch(() => [])
  log('E.realtime', {
    submit: submit.status(),
    reference: created.reference || created.message,
    rowsBefore: before,
    rowsAfter: after,
    banner: banner.slice(0, 3),
  })
  // document verify by another employee should also refresh? (not published server-side)
  out.realtimeReference = created.reference
  await citizen.close()
  await ctx.close()
}

// ---- F. reviewer on /employee -----------------------------------------------------------------
{
  const { ctx, page, errors } = await ctxFor({ username: 'reviewer.qa', password: 'Audit-Pass-2026!' })
  await page.goto(`${base}/employee`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  log('F.reviewerEmployeePage', {
    tiles: await page
      .locator('.employee-live-work-queue')
      .innerText()
      .then(t => t.replace(/\n/g, ' | ')),
    heading: await page.locator('.employee-heading p').first().innerText(),
    tabs: await page.locator('.workspace-tabbar button').allInnerTexts(),
    errors,
  })
  await ctx.close()
}

// ---- G. super-admin reset password without confirmation ------------------------------------------
{
  const { ctx, page } = await ctxFor({ username: 'superadmin', password: 'Admin-Strong-2026!' })
  await page.goto(`${base}/super-admin#staff`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  page.on('dialog', d => d.dismiss())
  const row = page.locator('tr', { hasText: 'emp.nodept' })
  await row.locator('button[title="إعادة تعيين كلمة المرور"]').click()
  await page.waitForTimeout(800)
  const notice = await page
    .locator('.staff-notice')
    .innerText()
    .catch(() => null)
  log('G.resetWithoutConfirm', {
    notice: notice?.slice(0, 160),
    iconButtonsWithoutAria: await page.locator('.row-actions button:not([aria-label])').count(),
  })
  await page.screenshot({ path: 'qa-screens/audit-staff-superadmin-reset-no-confirm.png' })
  // a11y: sidebar icons without labels
  log(
    'G.sidebarA11y',
    await page.evaluate(() =>
      [...document.querySelectorAll('.ops-sidebar nav a')].map(a => ({
        text: a.textContent.trim(),
        aria: a.getAttribute('aria-label'),
        visibleLabel: a.querySelector('span') ? getComputedStyle(a.querySelector('span')).display : null,
      }))
    )
  )
  await ctx.close()
}

// ---- H. must-change-password account browsing directly ---------------------------------------
{
  const admin = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': `10.8.${ip++}.3` } })
  await admin.request.post(`${base}/api/auth/staff/login`, {
    data: { username: 'superadmin', password: 'Admin-Strong-2026!' },
  })
  const c = await admin.request.post(`${base}/api/super-admin/staff`, {
    data: {
      username: `tmp.mc${Date.now() % 10000}`,
      fullName: 'حساب مؤقت',
      role: 'EMPLOYEE',
      departmentId: 'dhiqar-municipalities',
    },
  })
  const created = await c.json()
  await admin.close()
  const { ctx, page, errors } = await ctxFor({
    username: created.account.username,
    password: created.temporaryPassword,
  })
  await page.goto(`${base}/employee`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  log('H.mustChangeDirectEmployee', {
    url: page.url(),
    h1: await page
      .locator('h1')
      .first()
      .innerText()
      .catch(() => null),
    visibleError: await page.locator('.form-error').allInnerTexts(),
    errors: errors.slice(0, 3),
  })
  await page.goto(`${base}/department/dhiqar-municipalities`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  log('H.mustChangeDepartment', { url: page.url() })
  await ctx.close()
}

// ---- I. MFA enrol + login through the UI ----------------------------------------------------------
{
  const { ctx, page } = await ctxFor({ username: 'emp.nodept', password: 'Audit-Pass-2026!' })
  // password was reset in G → log in with temp? Use reviewer instead.
  await ctx.close()
  const who = { username: 'reviewer.qa', password: 'Audit-Pass-2026!' }
  const s = await ctxFor(who)
  await s.page.goto(`${base}/staff/security`, { waitUntil: 'networkidle' })
  await s.page.getByRole('button', { name: 'بدء الإعداد' }).click()
  await s.page.waitForTimeout(800)
  const secret = await s.page.locator('.mfa-setup code').innerText()
  await s.page.locator('.mfa-setup input').fill('000000')
  await s.page.getByRole('button', { name: 'تأكيد التفعيل' }).click()
  await s.page.waitForTimeout(600)
  const wrong = await s.page
    .locator('.security-card .form-error')
    .first()
    .innerText()
    .catch(() => null)
  const totp = sec => {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    let bits = 0,
      value = 0
    const bytes = []
    for (const ch of sec.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
      value = (value << 5) | A.indexOf(ch)
      bits += 5
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 255)
        bits -= 8
      }
    }
    const msg = Buffer.alloc(8)
    msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
    const d = createHmac('sha1', Buffer.from(bytes)).update(msg).digest()
    const o = d[d.length - 1] & 15
    const code = ((d[o] & 0x7f) << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]
    return String(code % 1e6).padStart(6, '0')
  }
  await s.page.locator('.mfa-setup input').fill(totp(secret))
  await s.page.getByRole('button', { name: 'تأكيد التفعيل' }).click()
  await s.page.waitForTimeout(800)
  const pill = await s.page.locator('.security-card .status-pill').first().innerText()
  await s.page.screenshot({ path: 'qa-screens/audit-staff-security-mfa.png', fullPage: true })
  log('I.mfaEnrol', { secretLen: secret.length, wrongCodeMsg: wrong, pillAfter: pill })
  await s.ctx.close()
  // login through the UI with MFA
  const l = await ctxFor(null)
  await l.page.goto(`${base}/staff/login?next=%2Femployee`, { waitUntil: 'networkidle' })
  await l.page.locator('input[autocomplete="username"]').fill(who.username)
  await l.page.locator('input[autocomplete="current-password"]').fill(who.password)
  await l.page.getByRole('button', { name: 'دخول آمن' }).click()
  await l.page.waitForTimeout(800)
  const mfaStep = await l.page.locator('.staff-login-card strong').first().innerText()
  await l.page.locator('input[autocomplete="one-time-code"]').fill('123456')
  await l.page.getByRole('button', { name: 'تأكيد' }).click()
  await l.page.waitForTimeout(600)
  const mfaErr = await l.page
    .locator('.form-error')
    .first()
    .innerText()
    .catch(() => null)
  await l.page.locator('input[autocomplete="one-time-code"]').fill(totp(secret))
  await l.page.getByRole('button', { name: 'تأكيد' }).click()
  await l.page.waitForTimeout(1500)
  log('I.mfaLogin', { mfaStep, mfaErr, landed: l.page.url() })
  await l.ctx.close()
  // reset MFA via super admin so later runs work
  const admin = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': `10.8.${ip++}.3` } })
  await admin.request.post(`${base}/api/auth/staff/login`, {
    data: { username: 'superadmin', password: 'Admin-Strong-2026!' },
  })
  const list = await (await admin.request.get(`${base}/api/super-admin/staff`)).json()
  const acc = list.accounts.find(a => a.username === who.username)
  await admin.request.post(`${base}/api/super-admin/staff/${acc.id}/reset-mfa`)
  await admin.close()
}

// ---- K. store licence "طلب مستند" text ------------------------------------------------------------
{
  const { ctx, page } = await ctxFor({ username: 'superadmin', password: 'Admin-Strong-2026!' })
  await page.goto(`${base}/employee#employee-applications`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.locator('.queue-item', { hasText: 'TQD-2026-0001' }).click()
  await page.waitForTimeout(300)
  const reqBtn = page.locator('.review-actions button', { hasText: /طلب/ })
  const label = await reqBtn.innerText()
  await reqBtn.click()
  await page.waitForTimeout(800)
  const r = await (await ctx.request.get(`${base}/api/applications/TQD-2026-0001`)).json()
  log('K.requestDocument', {
    buttonLabel: label,
    currentAction: r.currentAction,
    requiredDocument: r.requiredDocument,
    status: r.status,
    deadButtons: await page
      .locator('.queue-toolbar button, .review-header button')
      .evaluateAll(b =>
        b.map(x => `${x.textContent.trim() || x.innerHTML.slice(0, 40)} onclick=${Boolean(x.onclick)}`)
      ),
  })
  await page.screenshot({ path: 'qa-screens/audit-staff-employee-applications-fake-id.png' })
  await ctx.close()
}

// ---- L. dark mode contrast samples (employee) --------------------------------------------------
{
  const { ctx, page } = await ctxFor({ username: 'emp.muni', password: 'Emp-Muni-2026!' })
  await page.goto(`${base}/employee#employee-service-requests`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.documentElement.setAttribute('data-gov-theme', 'dark'))
  await page.waitForTimeout(500)
  const samples = await page.evaluate(() => {
    const pick = sel => {
      const el = document.querySelector(sel)
      if (!el) return null
      const cs = getComputedStyle(el)
      let bg = cs.backgroundColor,
        p = el
      while (p && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {
        p = p.parentElement
        if (!p) break
        bg = getComputedStyle(p).backgroundColor
      }
      return { color: cs.color, bg }
    }
    return {
      checklistLabel: pick('.service-request-checklist li strong'),
      currentAction: pick('.service-request-current-action span'),
      segmentedAll: pick('.gov-segmented button:not(.active) b'),
      logout: pick('.portal-sidebar button'),
      myDeptBtn: pick('.department-dashboard-actions a.button.ghost'),
      queueRowText: pick('.service-request-admin-row small'),
    }
  })
  log('L.darkContrast', samples)
  await ctx.close()
}

writeFileSync('qa-screens/audit-staff/flows.json', JSON.stringify(out, null, 2))
await browser.close()
