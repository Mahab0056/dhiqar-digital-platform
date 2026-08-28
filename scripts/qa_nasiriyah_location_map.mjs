import { readFileSync } from 'node:fs'

const source = readFileSync('src/App.tsx', 'utf8')
const checks = [
  ['إجراء التقاط موقع الهوية', 'const captureLocation = () =>'],
  ['طلب إذن GPS من المتصفح', 'navigator.geolocation.getCurrentPosition'],
  ['حفظ الموقع في API المحمية', 'api.updateCitizenLocation'],
  ['زر السماح وتحديد الموقع', 'السماح وتحديد موقعي'],
  ['رسالة عدم إظهار الخريطة للمواطن', 'لا تظهر الخريطة أو الإحداثيات داخل حسابك'],
  ['قيد المراجع المخول', 'للمراجع المخول فقط عند تدقيق الطلب'],
]
for (const [label, needle] of checks) if (!source.includes(needle)) throw new Error(`missing: ${label}`)
console.log('identity_location_privacy_qa=pass')
