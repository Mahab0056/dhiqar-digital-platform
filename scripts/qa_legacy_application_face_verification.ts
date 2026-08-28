import { createHmac, randomUUID } from 'node:crypto'
import { db, ensureDemoCitizen } from '../server/db.js'

const base = process.env.QA_BASE || 'http://127.0.0.1:8798'
const secret = process.env.SESSION_SECRET || 'legacy-app-face-qa-session-secret-long'
const sign = (sub: string, role: string) => {
  const payload = Buffer.from(JSON.stringify({ sub, role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
const citizenId = ensureDemoCitizen()
const employeeHeaders = { cookie: `dhiqar_session=${sign('employee-qa', 'EMPLOYEE')}`, 'content-type': 'application/json' }
const citizenHeaders = { cookie: `dhiqar_session=${sign(String(citizenId), 'CITIZEN')}` }
const reference = `TQD-QA-${randomUUID().slice(0, 8)}`
const timestamp = new Date().toISOString()
db.prepare(`INSERT INTO applications (reference, citizen_id, citizen_name, service_key, service_name, department, status, current_action, business_name, activity_type, address, district, ownership_type, lat, lng, fee, payment_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run(reference, citizenId, 'مواطن فحص معاملة قديمة', 'store-license', 'إجازة فتح محل', 'بلدية الناصرية', 'UNDER_REVIEW', 'بانتظار مراجعة الموظف.', 'محل فحص', 'مكتب خدمات', 'الناصرية', 'الناصرية', 'rent', 31.042, 46.267, 0, 'NOT_REQUIRED', timestamp, timestamp)
const blocked = await fetch(`${base}/api/applications/${reference}/approve`, { method: 'POST', headers: employeeHeaders })
if (blocked.status !== 409 || !(await blocked.text()).includes('فيديو توثيق الوجه')) throw new Error('legacy application approval was not safely blocked with a clear reason')
const requested = await fetch(`${base}/api/applications/${reference}/request-document`, { method: 'POST', headers: employeeHeaders, body: JSON.stringify({ documentName: 'فيديو توثيق الوجه القصير' }) })
if (requested.status !== 200) throw new Error(`verification request status ${requested.status}`)
const requestBody = await requested.json() as { status: string; requiredDocument: string | null }
if (requestBody.status !== 'ACTION_REQUIRED' || requestBody.requiredDocument !== 'فيديو توثيق الوجه القصير') throw new Error('legacy application was not routed to face verification completion')
const video = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(110_000)])
const form = new FormData()
form.append('documentName', 'فيديو توثيق الوجه القصير')
form.append('documentPurpose', 'FACE_VIDEO')
form.append('document', new Blob([video], { type: 'video/webm' }), 'face-video-7s-legacy-test.webm')
const uploaded = await fetch(`${base}/api/applications/${reference}/upload-document`, { method: 'POST', headers: citizenHeaders, body: form })
if (uploaded.status !== 200) throw new Error(`face video upload status ${uploaded.status}: ${await uploaded.text()}`)
const uploadedBody = await uploaded.json() as { status: string; attachments: Array<{ purpose?: string; label: string; available: boolean }> }
if (uploadedBody.status !== 'UNDER_REVIEW' || !uploadedBody.attachments.some(file => file.purpose === 'FACE_VIDEO' && file.available)) throw new Error('face video was not stored as protected application media')
const approved = await fetch(`${base}/api/applications/${reference}/approve`, { method: 'POST', headers: employeeHeaders })
if (approved.status !== 200) throw new Error(`verified legacy application approval status ${approved.status}: ${await approved.text()}`)
const approvedBody = await approved.json() as { status: string; verificationId: string | null; documentNumber: string | null }
if (approvedBody.status !== 'APPROVED' || !approvedBody.verificationId || !approvedBody.documentNumber) throw new Error('verified legacy application did not issue document')
console.log('legacy_application_face_verification_qa=pass')
