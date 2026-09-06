// Audit helper: creates a verified citizen with a spread of requests (dev only).
import { chromium } from 'playwright'
import { DatabaseSync } from 'node:sqlite'

const base = process.env.QA_BASE || 'http://localhost:8787'
const phone = '07801112233'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)])
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])
const log = (...a) => console.log(...a)

const ctx = await browser.newContext()
const otp = await (await ctx.request.post(`${base}/api/onboarding/request-otp`, { data: { phone } })).json()
const v = await ctx.request.post(`${base}/api/onboarding/verify-phone`, {
  data: { phone, challengeId: otp.challengeId, otp: '246810' },
})
log('verify', v.status())
const db = new DatabaseSync('data/test.sqlite')
db.prepare(
  `UPDATE citizens SET verification_status='VERIFIED_MANUAL', full_name='سجاد حيدر جبار' WHERE phone_masked LIKE '%2233'`
).run()
db.close()

const post = async (key, data, docs = {}) => {
  const r = await ctx.request.post(`${base}/api/service-requests`, {
    multipart: {
      serviceKey: key,
      data: JSON.stringify(data),
      faceConsent: 'true',
      documentConsent: 'true',
      faceVideo: { name: 'face.webm', mimeType: 'video/webm', buffer: webm },
      ...docs,
    },
  })
  const j = await r.json()
  log(key, r.status(), j.reference || j.message)
  return j
}

const complaint = await post(
  'muni-dir-complaint-against-municipality',
  { phone, district: 'الناصرية', municipality: 'الناصرية', details: 'تأخر رفع النفايات في حي الشموخ منذ أسبوعين.' },
  {
    'doc__national-id': { name: 'id.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    'doc__supporting-evidence': { name: 'evidence.pdf', mimeType: 'application/pdf', buffer: pdf },
  }
)
const birth = await post(
  'health-birth-certificate',
  {
    newbornName: 'علي سجاد حيدر',
    birthDate: '2026-08-20',
    birthPlace: 'مستشفى الحسين التعليمي',
    requestType: 'شهادة ولادة',
    district: 'الناصرية',
    phone,
  },
  Object.fromEntries(
    ['hospital-birth-report', 'father-id', 'mother-id', 'marriage-contract', 'residence-card'].map(k => [
      `doc__${k}`,
      { name: `${k}.jpg`, mimeType: 'image/jpeg', buffer: jpeg },
    ])
  )
)
const appt = await post(
  'online-appointment',
  {
    department: 'مديرية بلديات ذي قار',
    purpose: 'مراجعة بخصوص إجازة بناء',
    preferredDate: '2026-09-20',
    preferredTime: '10:00',
    contactPhone: phone,
  },
  {
    'doc__req-1': { name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    'doc__req-2': { name: 'b.jpg', mimeType: 'image/jpeg', buffer: jpeg },
  }
)
// appointment without the weird "documents" → expect rejection (bug evidence)
await post('online-appointment', {
  department: 'مديرية بلديات ذي قار',
  purpose: 'مراجعة بخصوص إجازة بناء',
  preferredDate: '2026-09-20',
  preferredTime: '10:00',
  contactPhone: phone,
})

// feedback
const fb = await ctx.request.post(`${base}/api/citizen/feedback`, {
  multipart: {
    kind: 'COMPLAINT',
    category: 'كهرباء وإنارة',
    subject: 'تضرر إنارة الشارع قرب مدرسة الفرات',
    description: 'أعمدة الإنارة في شارع المدرسة مطفأة منذ أكثر من أسبوعين، والمنطقة مظلمة ليلاً.',
    district: 'الناصرية',
    lat: '31.052',
    lng: '46.249',
    attachments: { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpeg },
  },
})
const fbj = await fb.json()
log('feedback', fb.status(), fbj.reference || fbj.message)

// store license applications
const app1 = await ctx.request.post(`${base}/api/applications`, {
  multipart: {
    serviceKey: 'store-license',
    serviceName: 'إجازة محل تجاري',
    department: 'بلدية الناصرية',
    businessName: 'محل النور للإلكترونيات',
    activityType: 'متجر إلكترونيات',
    address: 'شارع الحبوبي، مقابل الجامع الكبير',
    district: 'الناصرية',
    ownershipType: 'rent',
    coordinates: JSON.stringify({ lat: 31.05, lng: 46.25 }),
    fee: '25000',
    faceConsent: 'true',
    propertyDocument: { name: 'lease.pdf', mimeType: 'application/pdf', buffer: pdf },
    storefrontPhoto: { name: 'front.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    faceVideo: { name: 'face.webm', mimeType: 'video/webm', buffer: webm },
  },
})
const a1 = await app1.json()
log('app1', app1.status(), a1.reference || a1.message)
const app2 = await ctx.request.post(`${base}/api/applications`, {
  multipart: {
    serviceKey: 'store-license',
    serviceName: 'إجازة محل تجاري',
    department: 'بلدية الناصرية',
    businessName: 'مطعم بيت الكباب',
    activityType: 'مطعم',
    address: 'حي الشموخ، شارع 20',
    district: 'الناصرية',
    ownershipType: 'owned',
    coordinates: JSON.stringify({ lat: 31.06, lng: 46.26 }),
    fee: '25000',
    faceConsent: 'true',
    propertyDocument: { name: 'deed.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    storefrontPhoto: { name: 'front.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    faceVideo: { name: 'face.webm', mimeType: 'video/webm', buffer: webm },
  },
})
const a2 = await app2.json()
log('app2', app2.status(), a2.reference || a2.message)

// employee actions
const emp = await browser.newContext()
const l = await emp.request.post(`${base}/api/auth/staff/login`, {
  data: { username: 'emp.muni', password: 'Emp-Muni-2026!' },
})
log('emp login', l.status())
if (complaint.reference) {
  const rej = await emp.request.patch(
    `${base}/api/employee/service-requests/${complaint.reference}/documents/national-id`,
    { data: { status: 'REJECTED', note: 'الصورة مقطوعة من الأعلى' } }
  )
  const back = await emp.request.patch(`${base}/api/employee/service-requests/${complaint.reference}`, {
    data: { status: 'ACTION_REQUIRED' },
  })
  log('reject/back', rej.status(), back.status())
}
const sa = await browser.newContext()
const sl = await sa.request.post(`${base}/api/auth/staff/login`, {
  data: { username: 'superadmin', password: 'Admin-Strong-2026!' },
})
log('sa login', sl.status())
if (a1.reference) {
  const ap = await sa.request.post(`${base}/api/applications/${a1.reference}/approve`)
  log('approve', ap.status(), (await ap.text()).slice(0, 200))
}
if (a2.reference) {
  const rd = await sa.request.post(`${base}/api/applications/${a2.reference}/request-document`, {
    data: { documentName: 'كتاب موافقة الدفاع المدني' },
  })
  log('request doc', rd.status())
}
await browser.close()
