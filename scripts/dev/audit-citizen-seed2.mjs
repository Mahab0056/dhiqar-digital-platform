import { chromium } from 'playwright'
const base = 'http://localhost:8787'
const phone = '07801112233'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])
const ctx = await browser.newContext()
const otp = await (await ctx.request.post(`${base}/api/onboarding/request-otp`, { data: { phone } })).json()
await ctx.request.post(`${base}/api/onboarding/verify-phone`, { data: { phone, challengeId: otp.challengeId, otp: '246810' } })
const app3 = await ctx.request.post(`${base}/api/applications`, {
  multipart: {
    serviceKey: 'store-license', serviceName: 'إجازة محل تجاري', department: 'بلدية الناصرية',
    businessName: 'مكتب الأمانة للخدمات', activityType: 'مكتب خدمات', address: 'حي الجامعة، شارع 40', district: 'الشطرة',
    ownershipType: 'owned', coordinates: JSON.stringify({ lat: 31.06, lng: 46.26 }), fee: '0', faceConsent: 'true',
    propertyDocument: { name: 'deed.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    storefrontPhoto: { name: 'front.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    faceVideo: { name: 'face.webm', mimeType: 'video/webm', buffer: webm },
  },
})
const a3 = await app3.json(); console.log('app3', app3.status(), a3.reference || a3.message)
const sa = await browser.newContext()
await sa.request.post(`${base}/api/auth/staff/login`, { data: { username: 'superadmin', password: 'Admin-Strong-2026!' } })
const ap = await sa.request.post(`${base}/api/applications/${a3.reference}/approve`)
console.log('approve', ap.status(), (await ap.text()).slice(0, 120))
const list = await (await ctx.request.get(`${base}/api/citizen/issued-documents`)).json()
console.log(JSON.stringify(list).slice(0, 400))
await browser.close()
