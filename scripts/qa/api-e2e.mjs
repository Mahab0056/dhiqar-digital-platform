// Platform QA 2026-10-09 — scripted end-to-end run across roles over direct HTTP.
// Runs ONLY against a local throwaway server (see scripts/qa/start-local.sh). Never point it at production.
//   QA_BASE=http://localhost:4100 QA_DB=/tmp/dq-qa-run/a/qa.sqlite node scripts/qa/api-e2e.mjs
// Writes qa-screens/2026-10-09/api-e2e-results.json and prints one line per check.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const base = process.env.QA_BASE || 'http://localhost:4100'
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('QA_BASE must be a local server.')
const dbPath = process.env.QA_DB
if (!dbPath) throw new Error('Set QA_DB to the local QA sqlite file.')
const db = new DatabaseSync(dbPath)
const outDir = 'qa-screens/2026-10-09'
mkdirSync(outDir, { recursive: true })

// ---- harness -------------------------------------------------------------------------------
const results = []
const ctx = {}
async function check(id, area, scenario, fn) {
  let result = 'PASS'
  let evidence = ''
  try {
    const out = await fn()
    if (out && typeof out === 'object' && out.status) {
      result = out.status
      evidence = out.evidence || ''
    } else if (out && typeof out === 'object' && 'ok' in out) {
      result = out.ok ? 'PASS' : 'FAIL'
      evidence = out.evidence || ''
    } else evidence = String(out ?? '')
  } catch (error) {
    result = 'FAIL'
    evidence = `exception: ${error.message}`
  }
  results.push({ id, area, scenario, result, evidence })
  console.log(`${result}  ${id}  ${scenario} — ${evidence}`)
}
const expect = (ok, evidence) => ({ ok: Boolean(ok), evidence })

let ipCounter = 10
class Client {
  constructor(name) {
    this.name = name
    this.cookie = ''
    this.ip = `10.9.0.${ipCounter++}`
  }
  async req(method, path, { json, form, headers = {}, raw } = {}) {
    const init = { method, headers: { 'x-forwarded-for': this.ip, ...headers }, redirect: 'manual' }
    if (this.cookie) init.headers.cookie = this.cookie
    if (json !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(json)
    } else if (form) init.body = form
    else if (raw !== undefined) init.body = raw
    const res = await fetch(base + path, init)
    const setCookies = res.headers.getSetCookie?.() || []
    for (const cookie of setCookies) {
      const pair = cookie.split(';')[0]
      if (pair.startsWith('dhiqar_session=')) this.cookie = pair.endsWith('=') ? '' : pair
    }
    const type = res.headers.get('content-type') || ''
    const buffer = Buffer.from(await res.arrayBuffer())
    let body = buffer
    if (type.includes('json'))
      try {
        body = JSON.parse(buffer.toString('utf8'))
      } catch {
        body = buffer.toString('utf8')
      }
    return { status: res.status, body, headers: res.headers, setCookies }
  }
  get(path, opts) {
    return this.req('GET', path, opts)
  }
  post(path, json, opts = {}) {
    return this.req('POST', path, { json, ...opts })
  }
  patch(path, json, opts = {}) {
    return this.req('PATCH', path, { json, ...opts })
  }
}

// ---- fixtures --------------------------------------------------------------------------------
const jpeg = (size = 25_000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 7)])
const pdf = (size = 2_000) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(size, 0x20)])
const webm = (size = 120_000) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(size, 3)])
const blob = (buffer, type) => new Blob([buffer], { type })
const sql = (query, ...args) => db.prepare(query).all(...args)
const one = (query, ...args) => db.prepare(query).get(...args)

async function staffLogin(client, username, password) {
  const res = await client.post('/api/auth/staff/login', { username, password })
  return res
}

async function createStaff(admin, account) {
  const created = await admin.post('/api/super-admin/staff', {
    username: account.username,
    fullName: account.fullName,
    role: account.role,
    departmentId: account.departmentId,
  })
  if (created.status !== 201) throw new Error(`create ${account.username}: ${created.status} ${created.body?.message}`)
  const client = new Client(account.username)
  await staffLogin(client, account.username, created.body.temporaryPassword)
  const changed = await client.post('/api/auth/staff/change-password', {
    currentPassword: created.body.temporaryPassword,
    newPassword: account.password,
  })
  if (changed.status !== 200) throw new Error(`password ${account.username}: ${changed.status}`)
  return client
}

async function citizenLogin(client, phone) {
  const otp = await client.post('/api/onboarding/request-otp', { phone })
  if (otp.status !== 201) throw new Error(`otp ${otp.status} ${otp.body?.message}`)
  const verify = await client.post('/api/onboarding/verify-phone', {
    phone,
    challengeId: otp.body.challengeId,
    otp: '246810',
  })
  if (verify.status !== 200) throw new Error(`verify ${verify.status} ${verify.body?.message}`)
  return verify
}

async function submitIdentity(client, name) {
  const form = new FormData()
  form.append('fullName', name)
  form.append('documentNumber', '199012345678')
  form.append('documentType', 'NATIONAL_ID')
  for (const key of ['consent', 'retainMedia', 'analysisConsent', 'profilePhotoConsent']) form.append(key, 'true')
  form.append('idFront', blob(jpeg(), 'image/jpeg'), 'front.jpg')
  form.append('idBack', blob(jpeg(), 'image/jpeg'), 'back.jpg')
  form.append('faceVideo', blob(webm(), 'video/webm'), 'face-video-7s-qa.webm')
  return client.req('POST', '/api/onboarding/identity-review', { form })
}

function fillField(field) {
  if (field.options?.length) return field.options[0]
  if (field.type === 'tel') return '07701234567'
  if (field.type === 'email') return 'qa@example.com'
  if (field.type === 'number') return '4'
  if (field.type === 'date') {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + 3)
    return d.toISOString().slice(0, 10)
  }
  if (field.type === 'time') return '10:30'
  return 'بيانات اختبار QA'.slice(0, field.maxLength || 160)
}

async function serviceForm(serviceKey, { skipDocs = [], overrides = {}, badDoc, idempotencyKey } = {}) {
  const service = (await new Client('anon').get(`/api/services/${serviceKey}`)).body
  const data = Object.fromEntries(service.fields.map(field => [field.key, fillField(field)]))
  Object.assign(data, overrides)
  const form = new FormData()
  form.append('serviceKey', serviceKey)
  form.append('data', JSON.stringify(data))
  form.append('faceConsent', 'true')
  form.append('documentConsent', 'true')
  if (idempotencyKey) form.append('clientRequestId', idempotencyKey)
  form.append('faceVideo', blob(webm(2000), 'video/webm'), 'face.webm')
  for (const doc of service.requiredDocuments) {
    if (skipDocs.includes(doc.key)) continue
    if (badDoc === doc.key)
      form.append(`doc__${doc.key}`, blob(Buffer.from('<html>x</html>'), 'application/pdf'), 'x.pdf')
    else form.append(`doc__${doc.key}`, blob(pdf(), 'application/pdf'), `${doc.key}.pdf`)
  }
  return { form, service }
}

// =================================================================================================
// 0. Staff setup (super admin bootstrap → forced password change → accounts per role)
// =================================================================================================
const admin = new Client('admin')
await check('AUTH-01', 'تسجيل الدخول', 'دخول المدير العام بكلمة مرور مؤقتة يفرض تغييرها قبل أي إجراء', async () => {
  const login = await staffLogin(admin, 'admin', 'QA-Bootstrap-Admin-2026!')
  const blocked = await admin.get('/api/super-admin/staff')
  const changed = await admin.post('/api/auth/staff/change-password', {
    currentPassword: 'QA-Bootstrap-Admin-2026!',
    newPassword: 'QA-Admin-Strong-Pass-2026!',
  })
  const after = await admin.get('/api/super-admin/staff')
  return expect(
    login.status === 200 &&
      blocked.status === 403 &&
      blocked.body.code === 'PASSWORD_CHANGE_REQUIRED' &&
      changed.status === 200 &&
      after.status === 200,
    `login ${login.status}, before change ${blocked.status} ${blocked.body.code}, change ${changed.status}, after ${after.status}`
  )
})

const staffPassword = 'QA-Staff-Strong-Pass-2026!'
const empGov = await createStaff(admin, {
  username: 'qa.gov',
  fullName: 'موظف ديوان المحافظة QA',
  role: 'EMPLOYEE',
  departmentId: 'dhiqar-governorate',
  password: staffPassword,
})
const empHealth = await createStaff(admin, {
  username: 'qa.health',
  fullName: 'موظف صحة QA',
  role: 'EMPLOYEE',
  departmentId: 'dhiqar-health',
  password: staffPassword,
})
const empWater = await createStaff(admin, {
  username: 'qa.water',
  fullName: 'موظف ماء QA',
  role: 'EMPLOYEE',
  departmentId: 'dhiqar-water',
  password: staffPassword,
})
const reviewer = await createStaff(admin, {
  username: 'qa.reviewer',
  fullName: 'مراجع هوية QA',
  role: 'IDENTITY_REVIEWER',
  departmentId: null,
  password: staffPassword,
})
const ops = await createStaff(admin, {
  username: 'qa.ops',
  fullName: 'غرفة العمليات QA',
  role: 'OPERATIONS',
  departmentId: null,
  password: staffPassword,
})

// =================================================================================================
// 1. Registration, OTP, sessions
// =================================================================================================
const anon = new Client('anon')
const citizenA = new Client('citizenA')
const citizenB = new Client('citizenB')
const phoneA = '07701110001'
const phoneB = '07701110002'

await check('AUTH-02', 'التسجيل وOTP', 'رقم هاتف غير صالح يُرفض', async () => {
  const r1 = await anon.post('/api/onboarding/request-otp', { phone: '12345' })
  const r2 = await anon.post('/api/onboarding/request-otp', { phone: '06901234567' })
  const r3 = await anon.post('/api/onboarding/request-otp', { phone: '' })
  return expect(
    r1.status === 400 && r2.status === 400 && r3.status === 400,
    `"12345" → ${r1.status}; landline "06901234567" → ${r2.status}; empty → ${r3.status} (note: non-digits are stripped, so "0790000000a1" is read as 07900000001)`
  )
})

await check('AUTH-03', 'التسجيل وOTP', 'رمز خاطئ يُرفض ويُحتسب كمحاولة', async () => {
  const otp = await citizenA.post('/api/onboarding/request-otp', { phone: phoneA })
  ctx.firstChallenge = otp.body.challengeId
  const wrong = await citizenA.post('/api/onboarding/verify-phone', {
    phone: phoneA,
    challengeId: otp.body.challengeId,
    otp: '111111',
  })
  const attempts = one('SELECT attempts FROM otp_challenges WHERE id = ?', otp.body.challengeId).attempts
  return expect(
    otp.status === 201 && wrong.status === 400 && attempts === 1 && !citizenA.cookie,
    `request ${otp.status} (${otp.body.deliveryStatus}), wrong → ${wrong.status} "${wrong.body.message}", attempts=${attempts}, cookie set=${Boolean(citizenA.cookie)}`
  )
})

await check('AUTH-04', 'التسجيل وOTP', 'بعد 5 محاولات خاطئة يُقفل التحدي حتى مع الرمز الصحيح', async () => {
  for (let i = 0; i < 4; i++)
    await citizenA.post('/api/onboarding/verify-phone', {
      phone: phoneA,
      challengeId: ctx.firstChallenge,
      otp: '222222',
    })
  const right = await citizenA.post('/api/onboarding/verify-phone', {
    phone: phoneA,
    challengeId: ctx.firstChallenge,
    otp: '246810',
  })
  return expect(
    right.status === 400 && /المحاولات/.test(right.body.message),
    `correct code after 5 failures → ${right.status} "${right.body.message}"`
  )
})

await check('AUTH-05', 'التسجيل وOTP', 'رمز منتهي الصلاحية يُرفض (expires_at في الماضي)', async () => {
  const otp = await citizenA.post('/api/onboarding/request-otp', { phone: phoneA })
  db.prepare('UPDATE otp_challenges SET expires_at = ? WHERE id = ?').run(
    new Date(Date.now() - 1000).toISOString(),
    otp.body.challengeId
  )
  const r = await citizenA.post('/api/onboarding/verify-phone', {
    phone: phoneA,
    challengeId: otp.body.challengeId,
    otp: '246810',
  })
  return expect(r.status === 400 && /انتهت/.test(r.body.message), `expired → ${r.status} "${r.body.message}"`)
})

await check('AUTH-06', 'التسجيل وOTP', 'إعادة إرسال رمز جديد ثم التحقق ينجح ويُنشئ جلسة', async () => {
  const otp = await citizenA.post('/api/onboarding/request-otp', { phone: phoneA })
  const r = await citizenA.post('/api/onboarding/verify-phone', {
    phone: phoneA,
    challengeId: otp.body.challengeId,
    otp: '246810',
  })
  ctx.usedChallenge = otp.body.challengeId
  const session = await citizenA.get('/api/auth/session')
  return expect(
    r.status === 200 && session.status === 200 && session.body.role === 'CITIZEN',
    `resend ${otp.status}, verify ${r.status}, session ${session.status} ${session.body.role}`
  )
})

await check('AUTH-07', 'التسجيل وOTP', 'لا يمكن إعادة استخدام رمز سبق التحقق منه', async () => {
  const r = await anon.post('/api/onboarding/verify-phone', {
    phone: phoneA,
    challengeId: ctx.usedChallenge,
    otp: '246810',
  })
  return expect(r.status === 400, `replay → ${r.status} "${r.body.message}"`)
})

await check('AUTH-08', 'التسجيل وOTP', 'حد طلبات OTP لكل رقم (5 خلال 10 دقائق)', async () => {
  // phone A already has 3 challenges in the window; the 6th must be refused
  const c = new Client('ratelimit')
  const statuses = []
  for (let i = 0; i < 3; i++) statuses.push((await c.post('/api/onboarding/request-otp', { phone: phoneA })).status)
  return expect(
    statuses.at(-1) === 400 && statuses[0] === 201,
    `requests #4..#6 for same phone → ${statuses.join(',')}`
  )
})

await check('AUTH-09', 'التسجيل وOTP', 'الدخول مرة ثانية بنفس الرقم لا يُنشئ حساباً مكرراً', async () => {
  const again = new Client('citizenA-2')
  await citizenLogin(again, '07701110009')
  await citizenLogin(again, '07701110009')
  const rows = one("SELECT COUNT(*) AS n FROM citizens WHERE phone_masked LIKE '%0009'").n
  return expect(rows === 1, `citizens rows for phone …0009 after two logins = ${rows}`)
})

await check('AUTH-10', 'الجلسات', 'خصائص كوكي الجلسة HttpOnly وSameSite (Secure يُضاف في الاستضافة فقط)', async () => {
  const c = new Client('cookie')
  const verify = await citizenLogin(c, '07701110010')
  const cookie = verify.setCookies.find(item => item.startsWith('dhiqar_session=')) || ''
  return expect(/HttpOnly/.test(cookie) && /SameSite=Lax/.test(cookie), cookie.replace(/=[^;]+;/, '=<redacted>;'))
})

await check('AUTH-11', 'الجلسات', 'تسجيل الخروج يُلغي الجلسة في الخادم (الكوكي القديم لا يعمل)', async () => {
  const c = new Client('logout')
  await citizenLogin(c, '07701110011')
  const old = c.cookie
  const out = await c.post('/api/auth/logout', {})
  c.cookie = old
  const replay = await c.get('/api/citizen/demo')
  return expect(
    out.status === 200 && replay.status === 401,
    `logout ${out.status}, replay old cookie → ${replay.status}`
  )
})

await check('AUTH-12', 'الجلسات', 'كوكي معدّل التوقيع يُرفض', async () => {
  const c = new Client('tamper')
  await citizenLogin(c, '07701110012')
  c.cookie = c.cookie.slice(0, -3) + 'abc'
  const r = await c.get('/api/citizen/demo')
  return expect(r.status === 401, `tampered → ${r.status}`)
})

await check('AUTH-13', 'الجلسات', 'انتهاء جلسة المواطن (expires_at) وخمول جلسة الموظف ساعة', async () => {
  const c = new Client('expire')
  await citizenLogin(c, '07701110013')
  const sid = c.cookie.split('=')[1].split('.')[0]
  db.prepare('UPDATE auth_sessions SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), sid)
  const citizenAfter = await c.get('/api/citizen/demo')
  const s = new Client('idle')
  await staffLogin(s, 'qa.water', staffPassword)
  const ssid = s.cookie.split('=')[1].split('.')[0]
  db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').run(
    new Date(Date.now() - 61 * 60 * 1000).toISOString(),
    ssid
  )
  const staffAfter = await s.get('/api/employee/service-requests')
  return expect(
    citizenAfter.status === 401 && staffAfter.status === 401,
    `expired citizen → ${citizenAfter.status}; idle staff (61 min) → ${staffAfter.status}`
  )
})

await check('AUTH-14', 'الجلسات', 'قفل حساب الموظف بعد 5 محاولات خاطئة', async () => {
  await createStaff(admin, {
    username: 'qa.lock',
    fullName: 'حساب قفل QA',
    role: 'EMPLOYEE',
    departmentId: 'dhiqar-water',
    password: staffPassword,
  })
  const c = new Client('lock')
  const statuses = []
  for (let i = 0; i < 5; i++) statuses.push((await staffLogin(c, 'qa.lock', 'wrong-password-xx')).status)
  const correct = await staffLogin(c, 'qa.lock', staffPassword)
  return expect(
    correct.status === 401 && /قفل/.test(correct.body.message),
    `5 wrong → ${statuses.join(',')}; then correct → ${correct.status} "${correct.body.message}"`
  )
})

await check('AUTH-15', 'الجلسات', 'حد معدل دخول الموظفين لكل عنوان IP (25 / 10 دقائق)', async () => {
  const c = new Client('brute')
  let last = 0
  for (let i = 0; i < 26; i++) last = (await staffLogin(c, `nouser${i}`, 'x')).status
  return expect(last === 429, `26th attempt → ${last}`)
})

// =================================================================================================
// 2. Identity verification (unified ID images + face video → human reviewer)
// =================================================================================================
await citizenLogin(citizenB, phoneB)
await check('ID-01', 'التوثيق والهوية', 'مواطن غير موثق لا يستطيع تقديم طلب خدمة', async () => {
  const { form } = await serviceForm('gov-low-cost-housing')
  const r = await citizenA.req('POST', '/api/service-requests', { form })
  return expect(r.status === 409, `unverified submit → ${r.status} "${r.body.message}"`)
})

await check('ID-02', 'التوثيق والهوية', 'صور صغيرة/فيديو غير مكتمل يُطلب إعادة التصوير', async () => {
  const form = new FormData()
  form.append('fullName', 'مواطن اختبار')
  form.append('documentNumber', '199012345678')
  for (const key of ['consent', 'retainMedia', 'analysisConsent', 'profilePhotoConsent']) form.append(key, 'true')
  form.append('idFront', blob(jpeg(500), 'image/jpeg'), 'front.jpg')
  form.append('idBack', blob(jpeg(500), 'image/jpeg'), 'back.jpg')
  form.append('faceVideo', blob(webm(500), 'video/webm'), 'v.webm')
  const r = await citizenA.req('POST', '/api/onboarding/identity-review', { form })
  return expect(r.status === 422, `low quality → ${r.status} score=${r.body.screening?.qualityScore}`)
})

await check(
  'ID-03',
  'التوثيق والهوية',
  'إرسال الهوية والفيديو يدخل قائمة المراجعة؛ لا يمكن إعادة الإرسال أثناء المراجعة',
  async () => {
    const r = await submitIdentity(citizenA, 'أحمد كاظم جاسم QA')
    ctx.reviewA = r.body.id
    const again = await submitIdentity(citizenA, 'أحمد كاظم جاسم QA')
    const rb = await submitIdentity(citizenB, 'زينب علي حسن QA')
    ctx.reviewB = rb.body.id
    return expect(
      r.status === 201 && again.status === 409 && rb.status === 201,
      `submit ${r.status} ${r.body.status} (face=${r.body.analysis?.faceComparison?.status}), resubmit ${again.status}, citizenB ${rb.status}`
    )
  }
)

await check('ID-04', 'التوثيق والهوية', 'موظف دائرة لا يرى طابور الهوية ولا يقرر فيه', async () => {
  const list = await empGov.get('/api/admin/identity-reviews')
  const decide = await empGov.post(`/api/admin/identity-reviews/${ctx.reviewA}/decision`, { decision: 'APPROVED' })
  const media = one('SELECT id_front_media_id AS m FROM identity_reviews WHERE id = ?', ctx.reviewA).m
  const open = await empGov.get(`/api/admin/media/${media}`)
  return expect(
    list.status === 403 && decide.status === 403 && open.status === 404,
    `list ${list.status}, decision ${decide.status}, identity media ${open.status}`
  )
})

await check('ID-05', 'التوثيق والهوية', 'مراجع الهوية يعتمد الطلب والقرار بشري ومسجل', async () => {
  const list = await reviewer.get('/api/admin/identity-reviews')
  const a = await reviewer.post(`/api/admin/identity-reviews/${ctx.reviewA}/decision`, {
    decision: 'APPROVED',
    notes: 'مطابقة',
  })
  const b = await reviewer.post(`/api/admin/identity-reviews/${ctx.reviewB}/decision`, {
    decision: 'APPROVED',
    notes: 'مطابقة',
  })
  const twice = await reviewer.post(`/api/admin/identity-reviews/${ctx.reviewA}/decision`, { decision: 'REJECTED' })
  const status = (await citizenA.get('/api/citizen/demo')).body.verificationStatus
  const audit = one(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'IDENTITY_REVIEW_DECIDED' AND actor LIKE '%qa.reviewer%'"
  ).n
  return expect(
    list.status === 200 &&
      a.status === 200 &&
      b.status === 200 &&
      twice.status === 409 &&
      status === 'VERIFIED_MANUAL' &&
      audit === 2,
    `queue ${list.status} (${list.body.length}), approve ${a.status}/${b.status}, second decision ${twice.status}, citizen=${status}, audit rows=${audit}`
  )
})

// =================================================================================================
// 3. Citizen service journey (no fee) + department processing
// =================================================================================================
await check('SVC-01', 'رحلة المواطن', 'عرض الخدمة يعيد المتطلبات والحقول والرسوم من الكتالوج', async () => {
  const r = await anon.get('/api/services/gov-low-cost-housing')
  return expect(
    r.status === 200 && r.body.requiredDocuments.length === 4 && r.body.fields.length > 3,
    `docs=${r.body.requiredDocuments.length} (required ${r.body.requiredDocuments.filter(d => d.required).length}), fields=${r.body.fields.length}, fee=${r.body.feeStatus}`
  )
})

await check('SVC-02', 'رحلة المواطن', 'نقص مستمسك إلزامي يمنع الإرسال', async () => {
  const { form } = await serviceForm('gov-low-cost-housing', { skipDocs: ['residence-card'] })
  const r = await citizenA.req('POST', '/api/service-requests', { form })
  return expect(r.status === 400, `${r.status} "${r.body.message}"`)
})

await check('SVC-03', 'رحلة المواطن', 'ملف بامتداد PDF ومحتوى HTML يُرفض', async () => {
  const { form } = await serviceForm('gov-low-cost-housing', { badDoc: 'residence-card' })
  const r = await citizenA.req('POST', '/api/service-requests', { form })
  return expect(r.status === 400, `${r.status} "${r.body.message}"`)
})

await check('SVC-04', 'رحلة المواطن', 'قيمة غير مسموحة في حقل اختيار / هاتف خاطئ يُرفض', async () => {
  const a = await serviceForm('gov-low-cost-housing', { overrides: { district: 'بغداد' } })
  const b = await serviceForm('gov-low-cost-housing', { overrides: { phone: '12345' } })
  const r1 = await citizenA.req('POST', '/api/service-requests', { form: a.form })
  const r2 = await citizenA.req('POST', '/api/service-requests', { form: b.form })
  return expect(r1.status === 400 && r2.status === 400, `bad option → ${r1.status}; bad phone → ${r2.status}`)
})

await check('SVC-05', 'رحلة المواطن', 'إرسال طلب كامل يصل للدائرة الصحيحة بحالة «مقدم»', async () => {
  const { form } = await serviceForm('gov-low-cost-housing')
  const r = await citizenA.req('POST', '/api/service-requests', { form })
  ctx.reqA = r.body.reference
  const row = one('SELECT department_id, status FROM service_requests WHERE reference = ?', ctx.reqA)
  return expect(
    r.status === 201 && row.department_id === 'dhiqar-governorate' && row.status === 'SUBMITTED',
    `${r.status} ${ctx.reqA} → ${row.department_id} ${row.status}`
  )
})

await check('SVC-06', 'رحلة المواطن', 'نقر مزدوج / إعادة الطلب نفسه لا يُنشئ معاملة مكررة (idempotency)', async () => {
  const before = one('SELECT COUNT(*) AS n FROM service_requests').n
  const key = randomUUID()
  const [f1, f2] = await Promise.all([
    serviceForm('gov-low-cost-housing', { idempotencyKey: key }),
    serviceForm('gov-low-cost-housing', { idempotencyKey: key }),
  ])
  const [r1, r2] = await Promise.all([
    citizenA.req('POST', '/api/service-requests', { form: f1.form }),
    citizenA.req('POST', '/api/service-requests', { form: f2.form }),
  ])
  const f3 = await serviceForm('gov-low-cost-housing', { idempotencyKey: key })
  const r3 = await citizenA.req('POST', '/api/service-requests', { form: f3.form })
  const after = one('SELECT COUNT(*) AS n FROM service_requests').n
  return expect(
    after - before === 1 && r3.body.reference === r1.body.reference,
    `parallel ${r1.status}/${r2.status}, retry ${r3.status}; rows created=${after - before}; refs ${r1.body.reference}/${r2.body.reference}/${r3.body.reference}`
  )
})

await check('SVC-07', 'رحلة المواطن', 'المواطن يرى طلبه وحالته وقائمة المستمسكات', async () => {
  const r = await citizenA.get('/api/citizen/service-requests')
  const item = r.body.find(x => x.reference === ctx.reqA)
  return expect(
    item && item.status === 'SUBMITTED' && item.checklist.filter(c => c.status === 'UPLOADED').length === 4,
    `${item?.status}, uploaded=${item?.checklist.filter(c => c.status === 'UPLOADED').length}`
  )
})

await check('DEP-01', 'معالجة الدائرة', 'الطلب يظهر في طابور موظف الدائرة الصحيحة فقط', async () => {
  const gov = await empGov.get('/api/employee/service-requests')
  const water = await empWater.get('/api/employee/service-requests')
  const direct = await empWater.get(`/api/employee/service-requests/${ctx.reqA}`)
  return expect(
    gov.body.items.some(x => x.reference === ctx.reqA) &&
      !water.body.items.some(x => x.reference === ctx.reqA) &&
      direct.status === 403,
    `gov queue has it=${gov.body.items.some(x => x.reference === ctx.reqA)}, water queue has it=${water.body.items.some(x => x.reference === ctx.reqA)}, water direct GET → ${direct.status}`
  )
})

await check('DEP-02', 'معالجة الدائرة', 'موظف دائرة أخرى لا يقرر ولا يدقق ولا يفتح المرفقات', async () => {
  const d = await empWater.patch(`/api/employee/service-requests/${ctx.reqA}`, { status: 'APPROVED' })
  const doc = await empWater.patch(`/api/employee/service-requests/${ctx.reqA}/documents/national-id`, {
    status: 'VERIFIED',
  })
  const media = one(
    "SELECT srm.media_id AS m FROM service_request_media srm JOIN service_requests sr ON sr.id = srm.service_request_id WHERE sr.reference = ? AND srm.document_key = 'national-id'",
    ctx.reqA
  ).m
  const m1 = await empWater.get(`/api/employee/service-requests/${ctx.reqA}/media/${media}`)
  const m2 = await empWater.get(`/api/admin/media/${media}`)
  const own = await empGov.get(`/api/employee/service-requests/${ctx.reqA}/media/${media}`)
  return expect(
    d.status === 403 && doc.status === 403 && m1.status === 403 && m2.status === 404 && own.status === 200,
    `decision ${d.status}, verify ${doc.status}, media ${m1.status}/${m2.status}; own dept media ${own.status} (${own.headers.get('content-type')})`
  )
})

await check('DEP-03', 'معالجة الدائرة', 'غرفة العمليات ومراجع الهوية لا يتخذون قرار معاملة', async () => {
  const o = await ops.patch(`/api/employee/service-requests/${ctx.reqA}`, { status: 'APPROVED' })
  const rv = await reviewer.patch(`/api/employee/service-requests/${ctx.reqA}`, { status: 'APPROVED' })
  const view = await ops.get(`/api/employee/service-requests/${ctx.reqA}`)
  return expect(
    o.status === 401 && rv.status === 401 && view.status === 200,
    `ops decision ${o.status}, reviewer decision ${rv.status}, ops read-only view ${view.status}`
  )
})

await check('DEP-04', 'معالجة الدائرة', 'رفض مستمسك يتطلب سبباً؛ الموافقة قبل تدقيق كل المستمسكات مرفوضة', async () => {
  const noNote = await empGov.patch(`/api/employee/service-requests/${ctx.reqA}/documents/residence-card`, {
    status: 'REJECTED',
  })
  const withNote = await empGov.patch(`/api/employee/service-requests/${ctx.reqA}/documents/residence-card`, {
    status: 'REJECTED',
    note: 'الصورة غير واضحة',
  })
  const verify = await empGov.patch(`/api/employee/service-requests/${ctx.reqA}/documents/national-id`, {
    status: 'VERIFIED',
  })
  const approve = await empGov.patch(`/api/employee/service-requests/${ctx.reqA}`, { status: 'APPROVED' })
  return expect(
    noNote.status === 400 && withNote.status === 200 && verify.status === 200 && approve.status === 409,
    `reject w/o note ${noNote.status}, with note ${withNote.status}, verify ${verify.status}, early approve ${approve.status}`
  )
})

await check('DEP-05', 'معالجة الدائرة', 'طلب استكمال يصل للمواطن مع السبب والإشعار', async () => {
  const r = await empGov.patch(`/api/employee/service-requests/${ctx.reqA}`, {
    status: 'ACTION_REQUIRED',
    decisionNote: 'أعد رفع بطاقة السكن',
  })
  const mine = (await citizenA.get('/api/citizen/service-requests')).body.find(x => x.reference === ctx.reqA)
  const notes = (await citizenA.get('/api/citizen/notifications')).body.items.filter(n => n.message.includes(ctx.reqA))
  return expect(
    r.status === 200 &&
      mine.status === 'ACTION_REQUIRED' &&
      /بطاقة السكن/.test(mine.requiredDocument || '') &&
      notes.length >= 2,
    `${r.status}; citizen sees ${mine.status}, required="${mine.requiredDocument}", notifications=${notes.length}`
  )
})

await check('SVC-08', 'رحلة المواطن', 'المواطن يستبدل المستمسك المرفوض فيعود الطلب للتدقيق', async () => {
  const form = new FormData()
  form.append('documentKey', 'residence-card')
  form.append('document', blob(jpeg(3000), 'image/jpeg'), 'residence.jpg')
  const r = await citizenA.req('POST', `/api/citizen/service-requests/${ctx.reqA}/upload-document`, { form })
  const item = r.body.checklist?.find(c => c.key === 'residence-card')
  return expect(
    r.status === 200 && r.body.status === 'UNDER_REVIEW' && item.status === 'UPLOADED',
    `${r.status} status=${r.body.status}, residence-card=${item?.status}`
  )
})

await check('DEP-06', 'معالجة الدائرة', 'موافقتان متزامنتان (نقر مزدوج) تُصدران وثيقة واحدة فقط', async () => {
  for (const key of ['residence-card', 'eligibility-proof'])
    await empGov.patch(`/api/employee/service-requests/${ctx.reqA}/documents/${key}`, { status: 'VERIFIED' })
  const [a, b] = await Promise.all([
    empGov.patch(`/api/employee/service-requests/${ctx.reqA}`, { status: 'APPROVED' }),
    empGov.patch(`/api/employee/service-requests/${ctx.reqA}`, { status: 'APPROVED' }),
  ])
  const issued = one('SELECT COUNT(*) AS n FROM issued_documents WHERE service_request_reference = ?', ctx.reqA).n
  return expect(
    issued === 1 && [a.status, b.status].sort().join() === '200,409',
    `responses ${a.status}/${b.status} (expected one 200 + one 409, never 500); issued_documents rows=${issued}`
  )
})

await check(
  'DOC-01',
  'الوثائق والتحقق',
  'المواطن يستلم النتيجة ووثيقة PDF؛ صفحة التحقق العامة تعرض الحد الأدنى',
  async () => {
    const docs = (await citizenA.get('/api/citizen/issued-documents')).body
    const doc = docs.find(d => d.serviceRequestReference === ctx.reqA)
    ctx.docA = doc
    const file = await citizenA.get(doc.pdfUrl)
    const head = Buffer.from(file.body).subarray(0, 5).toString()
    const verify = await anon.get(`/api/verify/${doc.verificationId}`)
    const original = await anon.get(`/api/verify/${doc.verificationId}/original-pdf`)
    writeFileSync(`${outDir}/issued-${doc.documentNumber}.pdf`, Buffer.from(file.body))
    const leaks = JSON.stringify(verify.body).match(/national|phone|07701|lat|lng|address/i)
    return expect(
      file.status === 200 &&
        head === '%PDF-' &&
        verify.status === 200 &&
        verify.body.status === 'APPROVED' &&
        original.status === 200 &&
        !leaks,
      `pdf ${file.status} ${head} (${file.body.length} bytes), verify ${verify.status} ${verify.body.status}, original ${original.status}, PII keys in verify=${leaks ? leaks[0] : 'none'}`
    )
  }
)

await check('DOC-02', 'الوثائق والتحقق', 'معرّف تحقق غير موجود يعيد 404', async () => {
  const r = await anon.get('/api/verify/TQD-DOESNOTEXIST000')
  return expect(r.status === 404, `${r.status}`)
})

await check('DEP-07', 'معالجة الدائرة', 'الطلب المغلق لا يقبل رفعاً من المواطن ولا قراراً جديداً', async () => {
  const form = new FormData()
  form.append('documentKey', 'national-id')
  form.append('document', blob(jpeg(3000), 'image/jpeg'), 'x.jpg')
  const up = await citizenA.req('POST', `/api/citizen/service-requests/${ctx.reqA}/upload-document`, { form })
  const d = await empGov.patch(`/api/employee/service-requests/${ctx.reqA}`, {
    status: 'REJECTED',
    decisionNote: 'test',
  })
  return expect(up.status === 409 && d.status === 409, `upload ${up.status}, decision ${d.status}`)
})

await check('DEP-08', 'معالجة الدائرة', 'الرفض يتطلب سبباً ويُحفظ السبب ويصل للمواطن', async () => {
  const { form } = await serviceForm('gov-low-cost-housing')
  const created = await citizenA.req('POST', '/api/service-requests', { form })
  ctx.reqReject = created.body.reference
  const noReason = await empGov.patch(`/api/employee/service-requests/${ctx.reqReject}`, { status: 'REJECTED' })
  const r = await empGov.patch(`/api/employee/service-requests/${ctx.reqReject}`, {
    status: 'REJECTED',
    decisionNote: 'المتقدم غير مشمول بالفئات المحددة',
  })
  const row = one('SELECT status, decision_note, decided_by FROM service_requests WHERE reference = ?', ctx.reqReject)
  const mine = (await citizenA.get('/api/citizen/service-requests')).body.find(x => x.reference === ctx.reqReject)
  return expect(
    noReason.status === 400 && r.status === 200 && row.decision_note && mine.decisionNote === row.decision_note,
    `no reason ${noReason.status}; reject ${r.status}; DB=${row.status} by "${row.decided_by}" note="${row.decision_note}"; citizen sees ${mine.status}`
  )
})

await check('DEP-09', 'معالجة الدائرة', 'الحالة متطابقة بين المواطن والموظف والمدير وقاعدة البيانات', async () => {
  const refs = [ctx.reqA, ctx.reqReject]
  const mismatches = []
  for (const ref of refs) {
    const dbStatus = one('SELECT status FROM service_requests WHERE reference = ?', ref).status
    const c = (await citizenA.get('/api/citizen/service-requests')).body.find(x => x.reference === ref).status
    const e = (await empGov.get(`/api/employee/service-requests/${ref}`)).body.status
    const s = (await admin.get(`/api/employee/service-requests/${ref}`)).body.status
    if (new Set([dbStatus, c, e, s]).size !== 1) mismatches.push(`${ref}: db=${dbStatus} c=${c} e=${e} admin=${s}`)
  }
  return expect(
    !mismatches.length,
    mismatches.join('; ') || `${refs.join(', ')} consistent across citizen/employee/admin/DB`
  )
})

await check('DEP-10', 'معالجة الدائرة', 'إحالة الطلب إلى دائرة/موظف آخر', async () => {
  const r = await empGov.patch(`/api/employee/service-requests/${ctx.reqA}`, {
    status: 'REFERRED',
    departmentId: 'dhiqar-water',
  })
  return {
    status: 'NOT_IMPLEMENTED',
    evidence: `no referral/assignment endpoint exists (PATCH with status REFERRED → ${r.status}); requests are routed only by the catalog department`,
  }
})

// =================================================================================================
// 4. Payments (sandbox) + appointments
// =================================================================================================
await check('PAY-01', 'الدفع', 'خدمة برسم رسمي تُحجز «بانتظار الدفع» ولا تصل للدائرة قبل السداد', async () => {
  const { form } = await serviceForm('health-birth-certificate')
  const r = await citizenB.req('POST', '/api/service-requests', { form })
  ctx.reqPay = r.body.reference
  ctx.pay = r.body.payment?.reference
  return expect(
    r.status === 201 && r.body.status === 'PAYMENT_PENDING' && ctx.pay,
    `${r.status} ${ctx.reqPay} ${r.body.status}, payment ${ctx.pay} ${r.body.payment?.amountIqd} IQD (${r.body.payment?.mode})`
  )
})

await check('PAY-02', 'الدفع', 'مواطن آخر لا يرى ولا يسدد ولا يلغي دفعة غيره', async () => {
  const g = await citizenA.get(`/api/citizen/payments/${ctx.pay}`)
  const c = await citizenA.post(`/api/citizen/payments/${ctx.pay}/sandbox-confirm`, { outcome: 'CANCELLED' })
  return expect(g.status === 404 && c.status === 404, `get ${g.status}, confirm ${c.status}`)
})

await check('PAY-03', 'الدفع', 'إلغاء ثم فشل الدفع لا يغير حالة الطلب', async () => {
  const cancel = await citizenB.post(`/api/citizen/payments/${ctx.pay}/sandbox-confirm`, { outcome: 'CANCELLED' })
  const fail = await citizenB.post(`/api/citizen/payments/${ctx.pay}/sandbox-confirm`, { outcome: 'FAILED' })
  const row = one('SELECT status, payment_status FROM service_requests WHERE reference = ?', ctx.reqPay)
  return expect(
    cancel.body.status === 'CANCELLED' && fail.body.status === 'FAILED' && row.status === 'PAYMENT_PENDING',
    `cancel → ${cancel.body.status}, fail → ${fail.body.status}; request ${row.status}/${row.payment_status}`
  )
})

await check('PAY-04', 'الدفع', 'لا يمكن للموظف اعتماد طلب لم يُسدد رسمه (حتى بعد فشل/إلغاء الدفع)', async () => {
  const docs = one('SELECT document_checklist FROM service_requests WHERE reference = ?', ctx.reqPay)
  for (const item of JSON.parse(docs.document_checklist))
    if (item.mediaId)
      await empHealth.patch(`/api/employee/service-requests/${ctx.reqPay}/documents/${item.key}`, {
        status: 'VERIFIED',
      })
  const approve = await empHealth.patch(`/api/employee/service-requests/${ctx.reqPay}`, { status: 'APPROVED' })
  const issued = one('SELECT COUNT(*) AS n FROM issued_documents WHERE service_request_reference = ?', ctx.reqPay).n
  return expect(
    approve.status === 409 && issued === 0,
    `approve unpaid (intent FAILED) → ${approve.status} "${approve.body.message || approve.body.status}"; documents issued=${issued}`
  )
})

await check('PAY-05', 'الدفع', 'نجاح الدفع يُصدر إيصالاً ويحيل الطلب؛ التأكيد المكرر لا يخصم مرتين', async () => {
  const [p1, p2] = await Promise.all([
    citizenB.post(`/api/citizen/payments/${ctx.pay}/sandbox-confirm`, { outcome: 'PAID' }),
    citizenB.post(`/api/citizen/payments/${ctx.pay}/sandbox-confirm`, { outcome: 'PAID' }),
  ])
  const again = await citizenB.post(`/api/citizen/payments/${ctx.pay}/sandbox-confirm`, { outcome: 'FAILED' })
  const row = one('SELECT status, payment_status FROM service_requests WHERE reference = ?', ctx.reqPay)
  const paid = one(
    "SELECT COUNT(*) AS n, receipt_number FROM payment_intents WHERE reference = ? AND status = 'PAID'",
    ctx.pay
  )
  const audits = one(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'PAYMENT_CONFIRMED' AND entity_id = ?",
    ctx.pay
  ).n
  return expect(
    p1.body.status === 'PAID' &&
      p2.body.status === 'PAID' &&
      again.body.status === 'PAID' &&
      row.status !== 'PAYMENT_PENDING' &&
      audits === 1,
    `parallel confirms ${p1.body.status}/${p2.body.status}, later FAILED → ${again.body.status}; receipt ${paid.receipt_number}; request ${row.status}/${row.payment_status}; PAYMENT_CONFIRMED audits=${audits}`
  )
})

await check('PAY-06', 'الدفع', 'رابط العودة المفتوح لا يسوّي دفعة sandbox', async () => {
  const r = await anon.get(`/api/payments/return/sandbox?intentId=x&outcome=PAID`)
  return expect(
    r.status === 302 && /invalid/.test(r.headers.get('location')),
    `${r.status} → ${r.headers.get('location')}`
  )
})

await check('PAY-07', 'الدفع', 'رسم إضافي من الموظف؛ لا يُطلب رسم ثانٍ أثناء وجود رسم معلق', async () => {
  const r1 = await empHealth.patch(`/api/employee/service-requests/${ctx.reqPay}`, {
    status: 'PAYMENT_REQUIRED',
    amountIqd: 1000,
    decisionNote: 'رسم طابع',
  })
  const r2 = await empHealth.patch(`/api/employee/service-requests/${ctx.reqPay}`, {
    status: 'PAYMENT_REQUIRED',
    amountIqd: 1000,
  })
  const pending = (r1.body.payments || []).find(p => p.status === 'PENDING')
  ctx.pay2 = pending?.reference
  const pay = await citizenB.post(`/api/citizen/payments/${ctx.pay2}/sandbox-confirm`, { outcome: 'PAID' })
  const approve = await empHealth.patch(`/api/employee/service-requests/${ctx.reqPay}`, { status: 'APPROVED' })
  return expect(
    r1.status === 200 && r2.status === 409 && pay.body.status === 'PAID' && approve.status === 200,
    `extra fee ${r1.status} (${ctx.pay2}), second ${r2.status}, pay ${pay.body.status}, approve ${approve.status}`
  )
})

await check('PAY-08', 'الدفع', 'بوابة دفع حقيقية (ZainCash) مربوطة', async () => {
  const cfg = await anon.get('/api/payments/config')
  return {
    status: 'NOT_TESTED',
    evidence: `config: provider=${cfg.body.provider} mode=${cfg.body.mode}; ZainCash adapter exists in code but needs merchant credentials — not testable locally`,
  }
})

await check('APT-01', 'المواعيد', 'حجز موعد بتاريخ ماضٍ يُرفض؛ تاريخ صالح يُسجل ويؤكده موظف الدائرة', async () => {
  const past = await serviceForm('online-appointment', { overrides: { preferredDate: '2020-01-01' } })
  const bad = await citizenA.req('POST', '/api/service-requests', { form: past.form })
  const okForm = await serviceForm('online-appointment', { overrides: { department: 'ديوان محافظة ذي قار' } })
  const ok = await citizenA.req('POST', '/api/service-requests', { form: okForm.form })
  const confirm = await empGov.patch(`/api/employee/service-requests/${ok.body.reference}`, {
    status: 'APPROVED',
    appointmentDate: '2026-10-20 10:00',
    appointmentNote: 'قاعة المراجعين',
  })
  const apt = one(
    'SELECT a.status FROM appointments a JOIN service_requests sr ON sr.id = a.service_request_id WHERE sr.reference = ?',
    ok.body.reference
  )
  return expect(
    bad.status === 400 &&
      ok.status === 201 &&
      ok.body.status === 'APPOINTMENT_REQUESTED' &&
      confirm.status === 200 &&
      apt.status === 'CONFIRMED',
    `past ${bad.status}; book ${ok.status} ${ok.body.status}; confirm ${confirm.status} → appointment ${apt?.status}`
  )
})

// =================================================================================================
// 5. Authorization (IDOR / roles) — every :reference / :id route
// =================================================================================================
await check('SEC-01', 'الأمان والصلاحيات', 'مواطن لا يرى طلبات/وثائق/إشعارات غيره', async () => {
  const list = (await citizenB.get('/api/citizen/service-requests')).body
  const pdf = await citizenB.get(ctx.docA.pdfUrl)
  const notif = one(
    'SELECT id FROM notifications WHERE citizen_id = (SELECT citizen_id FROM service_requests WHERE reference = ?) LIMIT 1',
    ctx.reqA
  ).id
  const read = await citizenB.patch(`/api/citizen/notifications/${notif}/read`, {})
  return expect(
    !list.some(x => x.reference === ctx.reqA) && pdf.status === 404 && read.status === 404,
    `B list has A's request=${list.some(x => x.reference === ctx.reqA)}; A's PDF → ${pdf.status}; mark A's notification → ${read.status}`
  )
})

await check('SEC-02', 'الأمان والصلاحيات', 'مواطن لا يرفع مستنداً على طلب غيره', async () => {
  const { form } = await serviceForm('gov-low-cost-housing')
  const open = await citizenA.req('POST', '/api/service-requests', { form })
  ctx.reqOpen = open.body.reference
  const up = new FormData()
  up.append('documentKey', 'national-id')
  up.append('document', blob(jpeg(3000), 'image/jpeg'), 'x.jpg')
  const r = await citizenB.req('POST', `/api/citizen/service-requests/${ctx.reqOpen}/upload-document`, { form: up })
  return expect(r.status === 404, `${r.status}`)
})

await check('SEC-03', 'الأمان والصلاحيات', 'المواطن لا يصل لمسارات الموظفين والإدارة والعمليات', async () => {
  const paths = [
    '/api/employee/service-requests',
    `/api/employee/service-requests/${ctx.reqA}`,
    '/api/applications',
    '/api/admin/feedback',
    '/api/super-admin/staff',
    '/api/super-admin/audit-logs',
    '/api/dashboard/stats',
    '/api/operations/health',
    '/api/departments/dhiqar-governorate/dashboard',
    '/api/employee/issued-documents',
    '/api/admin/identity-reviews',
  ]
  const statuses = []
  for (const p of paths) statuses.push(`${p.split('/').slice(2, 4).join('/')}=${(await citizenA.get(p)).status}`)
  return expect(
    statuses.every(s => s.endsWith('=401')),
    statuses.join(' ')
  )
})

await check('SEC-04', 'الأمان والصلاحيات', 'بدون جلسة: كل المسارات المحمية 401', async () => {
  const paths = [
    '/api/citizen/demo',
    '/api/citizen/service-requests',
    '/api/citizen/issued-documents',
    `/api/citizen/payments/${ctx.pay}`,
    '/api/employee/service-requests',
    '/api/super-admin/staff',
    '/api/operations/health',
    `/api/applications/TQD-2026-0001`,
  ]
  const statuses = []
  for (const p of paths) statuses.push((await anon.get(p)).status)
  return expect(
    statuses.every(s => s === 401),
    statuses.join(',')
  )
})

await check('SEC-05', 'الأمان والصلاحيات', 'الموظف لا يصل لمسارات المدير العام', async () => {
  const s1 = (await empGov.get('/api/super-admin/staff')).status
  const s2 = (
    await empGov.post('/api/super-admin/staff', { username: 'evil.x', fullName: 'evil user', role: 'SUPER_ADMIN' })
  ).status
  const s3 = (await empGov.get('/api/super-admin/audit-logs')).status
  const s4 = (await ops.patch('/api/super-admin/platform-services/gov-complaint', { active: false })).status
  return expect(
    [s1, s2, s3, s4].every(s => s === 401),
    `${s1},${s2},${s3},${s4}`
  )
})

await check('SEC-06', 'الأمان والصلاحيات', 'موظف دائرة لا يفتح لوحة دائرة أخرى ولا وثائقها المؤرشفة', async () => {
  const dash = await empWater.get('/api/departments/dhiqar-governorate/dashboard')
  const pdf = await empWater.get(`/api/employee/issued-documents/${ctx.docA.id}/pdf`)
  const own = await empGov.get(`/api/employee/issued-documents/${ctx.docA.id}/pdf`)
  return expect(
    dash.status === 403 && pdf.status === 404 && own.status === 200,
    `other dashboard ${dash.status}, other archive ${pdf.status}, own archive ${own.status}`
  )
})

await check('SEC-07', 'الأمان والصلاحيات', 'موظف دائرة لا يرى تنبيهات الطلبات الواردة لكل الدوائر', async () => {
  const r = await empWater.get('/api/operations/new-request-alerts')
  const leaked = r.status === 200 ? r.body.alerts.filter(a => !/ماء/.test(a.department)).length : 0
  return expect(
    r.status !== 200 || leaked === 0,
    `water employee → ${r.status}, alerts from other departments=${leaked}`
  )
})

await check('SEC-08', 'الأمان والصلاحيات', 'الشكاوى: موظف دائرة أخرى لا يعدّلها ولا يفتح مرفقاتها', async () => {
  const form = new FormData()
  form.append('kind', 'COMPLAINT')
  form.append('category', 'خدمات')
  form.append('departmentId', 'dhiqar-governorate')
  form.append('subject', 'شكوى اختبار QA')
  form.append('description', 'وصف شكوى اختبار ضمن فحص الجودة للتأكد من الصلاحيات.')
  form.append('attachments', blob(jpeg(2000), 'image/jpeg'), 'a.jpg')
  const created = await citizenA.req('POST', '/api/citizen/feedback', { form })
  ctx.feedback = created.body.reference
  const other = await empWater.patch(`/api/admin/feedback/${ctx.feedback}`, {
    status: 'RESOLVED',
    currentAction: 'تمت المعالجة',
  })
  const own = await empGov.patch(`/api/admin/feedback/${ctx.feedback}`, {
    status: 'IN_REVIEW',
    currentAction: 'قيد المراجعة لدى الديوان',
  })
  const mediaId =
    created.body.attachments?.[0]?.mediaId ||
    one(
      'SELECT fm.media_id AS m FROM feedback_media fm JOIN citizen_feedback cf ON cf.id = fm.feedback_id WHERE cf.reference = ?',
      ctx.feedback
    )?.m
  const bView = await citizenB.get(`/api/citizen/feedback/${ctx.feedback}`)
  const bMedia = await citizenB.get(`/api/citizen/feedback/${ctx.feedback}/media/${mediaId}`)
  return expect(
    created.status === 201 &&
      other.status === 403 &&
      own.status === 200 &&
      bView.status === 404 &&
      bMedia.status === 404,
    `create ${created.status}, other dept ${other.status}, own dept ${own.status}, citizen B view ${bView.status}, media ${bMedia.status}`
  )
})

await check('SEC-09', 'الأمان والصلاحيات', 'مرفق شكوى غير صالح لا يترك شكوى ناقصة في القاعدة', async () => {
  const before = one('SELECT COUNT(*) AS n FROM citizen_feedback').n
  const form = new FormData()
  form.append('kind', 'COMPLAINT')
  form.append('category', 'خدمات')
  form.append('subject', 'شكوى بمرفق غير صالح')
  form.append('description', 'وصف شكوى اختبار ضمن فحص الجودة مع مرفق غير صالح.')
  form.append('attachments', blob(Buffer.from('<svg onload=alert(1)>'), 'image/png'), 'a.png')
  const r = await citizenA.req('POST', '/api/citizen/feedback', { form })
  const after = one('SELECT COUNT(*) AS n FROM citizen_feedback').n
  return expect(r.status === 400 && after === before, `${r.status}; feedback rows added=${after - before}`)
})

await check('SEC-10', 'الأمان والصلاحيات', 'رفع الملفات: نوع غير مسموح، توقيع مزور، حجم زائد، اسم مسار', async () => {
  const up = async (buffer, type, name) => {
    const form = new FormData()
    form.append('documentKey', 'national-id')
    form.append('document', blob(buffer, type), name)
    return citizenA.req('POST', `/api/citizen/service-requests/${ctx.reqOpen}/upload-document`, { form })
  }
  const html = await up(Buffer.from('<html><script>alert(1)</script></html>'), 'text/html', 'x.html')
  const spoof = await up(Buffer.from('<html>'), 'image/jpeg', 'x.jpg')
  const big = await up(Buffer.alloc(21 * 1024 * 1024, 1), 'application/pdf', 'big.pdf')
  const trav = await up(jpeg(3000), 'image/jpeg', '../../../../etc/passwd.jpg')
  const stored = one('SELECT storage_path FROM media_objects ORDER BY created_at DESC LIMIT 1').storage_path
  return expect(
    html.status === 400 &&
      spoof.status === 400 &&
      big.status === 413 &&
      trav.status === 200 &&
      /media_[0-9a-f]+\.bin$/.test(stored),
    `html ${html.status}, spoofed jpeg ${spoof.status}, 21MB ${big.status}, traversal name ${trav.status} stored as ${stored.split('/').pop()}`
  )
})

await check('SEC-11', 'الأمان والصلاحيات', 'إشعارات الدفع (Web Push) لا تقبل عناوين داخلية (SSRF)', async () => {
  const r = await citizenA.post('/api/citizen/push/subscribe', {
    endpoint: 'http://127.0.0.1:4100/api/health',
    keys: {
      p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
      auth: 'tBHItJI5svbpez7KI4CCXg',
    },
  })
  return expect(r.status === 400, `internal http endpoint → ${r.status}`)
})

await check(
  'SEC-12',
  'الأمان والصلاحيات',
  'ترويسات الأمان (CSP، frame-ancestors، nosniff، HSTS، بلا x-powered-by)',
  async () => {
    const r = await anon.get('/api/health')
    const h = name => r.headers.get(name)
    return expect(
      /frame-ancestors 'none'/.test(h('content-security-policy')) &&
        h('x-content-type-options') === 'nosniff' &&
        h('strict-transport-security') &&
        !h('x-powered-by'),
      `csp=${Boolean(h('content-security-policy'))}, nosniff=${h('x-content-type-options')}, hsts=${h('strict-transport-security')}, x-powered-by=${h('x-powered-by')}`
    )
  }
)

await check('SEC-13', 'الأمان والصلاحيات', 'طلب من أصل غير مصرح (CORS/CSRF) يُرفض', async () => {
  const r = await citizenA.post(
    '/api/citizen/notifications/read-all',
    {},
    { headers: { origin: 'https://evil.example' } }
  )
  return expect(r.status === 403, `${r.status} acao=${r.headers.get('access-control-allow-origin')}`)
})

await check('SEC-14', 'الأمان والصلاحيات', 'JSON تالف ومدخلات طويلة تعيد 400 لا 500', async () => {
  const broken = await citizenA.req('POST', '/api/citizen/location', {
    raw: '{bad json',
    headers: { 'content-type': 'application/json' },
  })
  const long = await anon.post('/api/onboarding/request-otp', { phone: '0'.repeat(5000) })
  const search = await anon.get(`/api/services/search?q=${encodeURIComponent("' OR 1=1 --")}`)
  return expect(
    broken.status === 400 && long.status === 400 && search.status === 200,
    `bad json ${broken.status}, long phone ${long.status}, sql-ish search ${search.status}`
  )
})

await check('SEC-15', 'الأمان والصلاحيات', 'سجل التدقيق يسجل الإجراءات باسم الفاعل الحقيقي', async () => {
  const rows = sql('SELECT action, actor FROM audit_logs WHERE entity_id = ? ORDER BY id', ctx.reqA)
  const actions = rows.map(r => r.action)
  const needed = [
    'SERVICE_REQUEST_CREATED',
    'SERVICE_DOCUMENT_REJECTED',
    'SERVICE_DOCUMENT_VERIFIED',
    'SERVICE_REQUEST_ACTION_REQUIRED',
    'SERVICE_REQUEST_DOCUMENT_UPLOADED',
    'SERVICE_REQUEST_APPROVED_DOCUMENT_ISSUED',
    'SERVICE_DOCUMENT_VIEWED',
  ]
  const missing = needed.filter(a => !actions.includes(a))
  const named = rows.filter(r => /qa\.gov/.test(r.actor)).length
  return expect(
    !missing.length && named > 0,
    `${rows.length} rows for ${ctx.reqA}; missing=${missing.join(',') || 'none'}; rows naming qa.gov=${named}`
  )
})

await check('SEC-16', 'الأمان والصلاحيات', 'لا توجد أسرار حقيقية في المستودع (فحص نمطي)', async () => {
  const { execSync } = await import('node:child_process')
  const out = execSync(
    `git grep -nIE "(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY|ghp_[A-Za-z0-9]{30,}|xox[bp]-)" -- . ":(exclude)pnpm-lock.yaml" || true`
  )
    .toString()
    .trim()
  return expect(!out, out ? out.split('\n').slice(0, 3).join(' | ') : 'no key-shaped secrets matched')
})

// =================================================================================================
// 6. Dashboards: numbers vs SQL
// =================================================================================================
await check('DASH-01', 'اللوحات', 'مؤشرات غرفة العمليات تطابق قاعدة البيانات', async () => {
  const s = (await ops.get('/api/dashboard/stats')).body
  const today = new Date().toISOString().slice(0, 10)
  const completed = one(
    "SELECT (SELECT COUNT(*) FROM applications WHERE status='APPROVED') + (SELECT COUNT(*) FROM service_requests WHERE status='APPROVED') AS n"
  ).n
  const todayApps = one(
    'SELECT (SELECT COUNT(*) FROM applications WHERE substr(created_at,1,10)=?) + (SELECT COUNT(*) FROM service_requests WHERE substr(created_at,1,10)=?) AS n',
    today,
    today
  ).n
  const collected = one(
    "SELECT COALESCE(SUM(amount_iqd),0) AS n FROM payment_intents WHERE status='PAID' AND substr(paid_at,1,10)=?",
    today
  ).n
  const complaints = one(
    "SELECT COUNT(*) AS n FROM citizen_feedback WHERE status NOT IN ('RESOLVED','CLOSED') AND department_id IS NOT NULL"
  ).n
  const diffs = []
  if (s.completed !== completed) diffs.push(`completed api=${s.completed} sql=${completed}`)
  if (s.todayApplications !== todayApps) diffs.push(`today api=${s.todayApplications} sql=${todayApps}`)
  if (s.financialCollection !== collected) diffs.push(`collected api=${s.financialCollection} sql=${collected}`)
  if (s.complaints !== complaints) diffs.push(`complaints api=${s.complaints} sql=${complaints}`)
  return expect(
    !diffs.length,
    diffs.join('; ') ||
      `completed=${completed}, today=${todayApps}, collected=${collected} IQD, open complaints=${complaints}, automationRate=${s.automationRate} (hard-coded 0), departmentsOnline=${s.departmentsOnline}`
  )
})

await check('DASH-02', 'اللوحات', 'لوحة دائرة الديوان تطابق قاعدة البيانات', async () => {
  const d = (await empGov.get('/api/departments/dhiqar-governorate/dashboard')).body
  const k = d.kpis || d.stats || d
  const total = one(
    "SELECT (SELECT COUNT(*) FROM service_requests WHERE department_id='dhiqar-governorate') + (SELECT COUNT(*) FROM applications WHERE department_id='dhiqar-governorate') AS n"
  ).n
  const approved = one(
    "SELECT COUNT(*) AS n FROM service_requests WHERE department_id='dhiqar-governorate' AND status='APPROVED'"
  ).n
  const rejected = one(
    "SELECT COUNT(*) AS n FROM service_requests WHERE department_id='dhiqar-governorate' AND status='REJECTED'"
  ).n
  writeFileSync(`${outDir}/department-dashboard-governorate.json`, JSON.stringify(d, null, 2))
  const apiTotal = k.transactions ?? k.total ?? d.department?.transactions
  const apiCompleted = k.completed ?? d.department?.completed
  return expect(
    apiTotal === total && apiCompleted === approved,
    `api transactions=${apiTotal} sql=${total}; api completed=${apiCompleted} sql approved=${approved}; rejected sql=${rejected}`
  )
})

await check('DASH-03', 'اللوحات', 'لا توجد بيانات تجريبية مزروعة مختلطة مع البيانات الحقيقية', async () => {
  const demo = sql('SELECT id, full_name, verification_status FROM citizens WHERE account_key IS NULL')
  return expect(
    !demo.length,
    demo.length
      ? `fresh DB contains seeded citizen(s) without an account: ${demo.map(c => `#${c.id} ${c.full_name} ${c.verification_status}`).join(', ')}`
      : 'no account-less seeded citizens'
  )
})

// ---- output ---------------------------------------------------------------------------------
writeFileSync(
  `${outDir}/api-e2e-results.json`,
  JSON.stringify({ base, ranAt: new Date().toISOString(), results }, null, 2)
)
const failed = results.filter(r => r.result === 'FAIL')
console.log(
  `\n${results.filter(r => r.result === 'PASS').length}/${results.length} passed; failed: ${failed.map(r => r.id).join(', ') || 'none'}; other: ${
    results
      .filter(r => !['PASS', 'FAIL'].includes(r.result))
      .map(r => `${r.id}=${r.result}`)
      .join(', ') || 'none'
  }`
)
