// End-to-end dev QA: verified citizen submits a catalog service with documents → department employee
// reviews the checklist → decision. Screenshots the citizen dashboard and employee queue. (dev helper)
import { chromium } from 'playwright'
import { DatabaseSync } from 'node:sqlite'

const base = process.env.QA_BASE || 'http://localhost:8787'
const dbPath = process.env.DATABASE_PATH || 'data/test.sqlite'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const errors = []
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)])
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])

const watch = page => {
  page.on('console', msg => {
    if (msg.type() === 'error' && !/profile-photo|401|TUNNEL/.test(msg.text())) errors.push(msg.text())
  })
  page.on('pageerror', err => errors.push(err.message))
}

// ---- super admin: rotate legacy password if needed, create employee for municipalities -----------
const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
let login = await adminCtx.request.post(`${base}/api/auth/staff/login`, {
  data: { username: 'superadmin', password: 'Admin-Strong-2026!' },
})
if (login.status() !== 200) {
  login = await adminCtx.request.post(`${base}/api/auth/staff/login`, {
    data: { username: 'superadmin', password: process.env.SUPER_ADMIN_PASSWORD || 'super-admin-demo-pass-123' },
  })
  await adminCtx.request.post(`${base}/api/auth/staff/change-password`, {
    data: {
      currentPassword: process.env.SUPER_ADMIN_PASSWORD || 'super-admin-demo-pass-123',
      newPassword: 'Admin-Strong-2026!',
    },
  })
}
const staffList = await (await adminCtx.request.get(`${base}/api/super-admin/staff`)).json()
let empPassword = 'Emp-Muni-2026!'
if (!staffList.accounts.some(a => a.username === 'emp.muni')) {
  const created = await (
    await adminCtx.request.post(`${base}/api/super-admin/staff`, {
      data: {
        username: 'emp.muni',
        fullName: 'موظف البلديات',
        role: 'EMPLOYEE',
        departmentId: 'dhiqar-municipalities',
      },
    })
  ).json()
  const empCtx = await browser.newContext()
  await empCtx.request.post(`${base}/api/auth/staff/login`, {
    data: { username: 'emp.muni', password: created.temporaryPassword },
  })
  await empCtx.request.post(`${base}/api/auth/staff/change-password`, {
    data: { currentPassword: created.temporaryPassword, newPassword: empPassword },
  })
  await empCtx.close()
}
await adminCtx.close()

// ---- citizen: OTP login, force verified, submit ------------------------------------------------
const citizenCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const otp = await (
  await citizenCtx.request.post(`${base}/api/onboarding/request-otp`, { data: { phone: '07809998877' } })
).json()
await citizenCtx.request.post(`${base}/api/onboarding/verify-phone`, {
  data: { phone: '07809998877', challengeId: otp.challengeId, otp: '246810' },
})
const db = new DatabaseSync(dbPath)
db.prepare(
  `UPDATE citizens SET verification_status = 'VERIFIED_MANUAL', full_name = 'حسين علي كاظم' WHERE phone_masked LIKE '%8877' OR id = (SELECT MAX(id) FROM citizens)`
).run()
db.close()
const submit = await citizenCtx.request.post(`${base}/api/service-requests`, {
  multipart: {
    serviceKey: 'muni-dir-complaint-against-municipality',
    data: JSON.stringify({
      phone: '07809998877',
      district: 'الناصرية',
      municipality: 'الناصرية',
      details: 'تأخر رفع النفايات في حي الشموخ منذ أسبوعين.',
    }),
    faceConsent: 'true',
    documentConsent: 'true',
    'doc__national-id': { name: 'id.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    'doc__supporting-evidence': { name: 'evidence.pdf', mimeType: 'application/pdf', buffer: pdf },
    faceVideo: { name: 'face.webm', mimeType: 'video/webm', buffer: webm },
  },
})
const created = await submit.json()
console.log('submit', submit.status(), created.reference || created.message)

// ---- employee: reject one doc, send back ------------------------------------------------------
const empCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await empCtx.request.post(`${base}/api/auth/staff/login`, { data: { username: 'emp.muni', password: empPassword } })
const rej = await empCtx.request.patch(
  `${base}/api/employee/service-requests/${created.reference}/documents/national-id`,
  {
    data: { status: 'REJECTED', note: 'الصورة مقطوعة من الأعلى' },
  }
)
console.log('reject doc', rej.status())
const back = await empCtx.request.patch(`${base}/api/employee/service-requests/${created.reference}`, {
  data: { status: 'ACTION_REQUIRED' },
})
console.log('send back', back.status())

// screenshots
const cPage = await citizenCtx.newPage()
watch(cPage)
await cPage.goto(`${base}/citizen`, { waitUntil: 'networkidle' })
await cPage.waitForTimeout(800)
await cPage.screenshot({ path: 'qa-screens/pipeline-citizen.png', fullPage: true })
const ePage = await empCtx.newPage()
watch(ePage)
await ePage.goto(`${base}/employee`, { waitUntil: 'networkidle' })
await ePage.waitForTimeout(1200)
await ePage.screenshot({ path: 'qa-screens/pipeline-employee.png', fullPage: true })
await browser.close()
console.log(errors.length ? errors.join('\n') : 'no console errors')
