import { createHmac } from 'node:crypto'
import { ensureDemoCitizen } from '../server/db.js'

const base = process.env.QA_BASE || 'http://127.0.0.1:8798'
const secret = process.env.SESSION_SECRET || 'identity-document-expansion-session-secret-long'
const citizenId = ensureDemoCitizen()
const payload = Buffer.from(JSON.stringify({ sub: String(citizenId), role: 'CITIZEN', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
const cookie = `dhiqar_session=${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
const baseFields = (form: FormData) => { form.append('serviceKey', 'store-license'); form.append('serviceName', 'إجازة فتح محل'); form.append('department', 'مديرية بلديات ذي قار'); form.append('businessName', 'محل اختبار'); form.append('activityType', 'متجر'); form.append('address', 'شارع اختبار، الناصرية'); form.append('district', 'الناصرية'); form.append('ownershipType', 'rent'); form.append('coordinates', JSON.stringify({ lat: 31.05, lng: 46.26 })); form.append('fee', '0') }
const missing = new FormData(); baseFields(missing)
const missingResponse = await fetch(`${base}/api/applications`, { method: 'POST', headers: { cookie }, body: missing })
const missingBody = await missingResponse.json() as { message?: string }
if (missingResponse.status !== 400 || !missingBody.message?.includes('عقد الإيجار')) throw new Error(`missing file reason not clear: ${missingResponse.status} ${missingBody.message}`)
const invalid = new FormData(); baseFields(invalid)
invalid.append('propertyDocument', new Blob([Buffer.alloc(64)], { type: 'image/jpeg' }), 'invalid.jpg')
invalid.append('storefrontPhoto', new Blob([Buffer.alloc(64)], { type: 'image/jpeg' }), 'front.jpg')
const invalidResponse = await fetch(`${base}/api/applications`, { method: 'POST', headers: { cookie }, body: invalid })
const invalidBody = await invalidResponse.json().catch(() => ({})) as { message?: string }
if (invalidResponse.status !== 400 || !invalidBody.message?.includes('لا يطابق صيغة آمنة') || !invalidBody.message.includes('أعد تصويره')) throw new Error(`invalid file reason not actionable: ${invalidResponse.status} ${invalidBody.message}`)
console.log('service_submission_errors_qa=pass')
