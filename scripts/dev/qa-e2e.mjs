// Full pipeline check over the API: citizen verification → catalog request with documents → employee
// checklist review → fee → payment → approval → issued PDF → public verification. (dev helper)
const base = process.env.QA_BASE || 'http://localhost:8787'
// realistic sizes: the identity quality screening rejects tiny files
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(90_000, 7), Buffer.from([0xff, 0xd9])])
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(400_000, 3)])
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}
const jar = {}
const call = async (who, path, { method = 'GET', body, form } = {}) => {
  const headers = { 'X-Forwarded-For': '10.11.12.13' }
  if (jar[who]) headers.cookie = jar[who]
  if (body) headers['content-type'] = 'application/json'
  const res = await fetch(base + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) })
  const set = res.headers.getSetCookie?.() || []
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ')
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}

// ---- citizen: OTP + identity ------------------------------------------------------------------
const phone = `0781${Math.floor(1000000 + Math.random() * 8999999)}`
const otp = await call('citizen', '/api/onboarding/request-otp', { method: 'POST', body: { phone } })
check('OTP challenge created', otp.status === 201, String(otp.status))
const verify = await call('citizen', '/api/onboarding/verify-phone', {
  method: 'POST', body: { phone, challengeId: otp.data.challengeId, otp: '246810' },
})
check('phone verified', verify.status === 200, String(verify.status))

const idForm = new FormData()
idForm.set('fullName', 'حسين علي كاظم الناصري')
idForm.set('documentNumber', '199012345678')
idForm.set('documentType', 'NATIONAL_ID')
for (const k of ['consent', 'retainMedia', 'analysisConsent', 'profilePhotoConsent']) idForm.set(k, 'true')
idForm.set('idFront', new Blob([jpeg], { type: 'image/jpeg' }), 'front.jpg')
idForm.set('idBack', new Blob([jpeg], { type: 'image/jpeg' }), 'back.jpg')
idForm.set('faceVideo', new Blob([webm], { type: 'video/webm' }), 'face-video-7s-e2e.webm')
const review = await call('citizen', '/api/onboarding/identity-review', { method: 'POST', form: idForm })
check('identity review submitted', review.status === 201 || review.status === 200, String(review.status))
const again = await call('citizen', '/api/onboarding/identity-review', { method: 'POST', form: idForm })
check('duplicate identity submission refused while pending', again.status === 409, String(again.status))

// ---- reviewer approves the identity -------------------------------------------------------------
await call('reviewer', '/api/auth/staff/login', { method: 'POST', body: { username: 'reviewer.qa', password: 'Audit-Pass-2026!' } })
const queue = await call('reviewer', '/api/admin/identity-reviews')
check('reviewer can list identity reviews', queue.status === 200, String(queue.status))
const pending = Array.isArray(queue.data) ? queue.data.find(r => r.status === 'PENDING_REVIEW') : null
check('pending review present', Boolean(pending))
if (pending) {
  const decision = await call('reviewer', `/api/admin/identity-reviews/${pending.id}/decision`, {
    method: 'POST', body: { decision: 'APPROVED', notes: 'مطابقة مؤكدة يدوياً' },
  })
  check('identity approved', decision.status === 200, String(decision.status))
}

// employee (department staff) must not read the identity queue
await call('employee', '/api/auth/staff/login', { method: 'POST', body: { username: 'emp.muni', password: 'Emp-Muni-2026!' } })
const blocked = await call('employee', '/api/admin/identity-reviews')
check('department employee cannot list identity reviews', blocked.status === 403, String(blocked.status))

// ---- citizen submits a catalog service ---------------------------------------------------------
const services = await call('citizen', '/api/services?limit=400')
const service = (services.data.items || []).find(
  s => s.departmentId === 'dhiqar-municipalities' && s.mode === 'CATALOG' && s.requiredDocuments.length > 0 && s.channel === 'ONLINE_SUBMISSION'
)
check('catalog service with documents found', Boolean(service), service?.title || 'none')
let reference = null
if (service) {
  const form = new FormData()
  form.set('serviceKey', service.key)
  form.set('faceConsent', 'true')
  form.set('documentConsent', 'true')
  form.set('faceVideo', new Blob([webm], { type: 'video/webm' }), 'face-video-7s-e2e.webm')
  const data = {}
  for (const field of service.fields || []) {
    data[field.key] =
      field.options?.length
        ? field.options[0]
        : field.type === 'tel'
          ? '07801234567'
          : field.type === 'email'
            ? 'citizen@example.com'
            : field.type === 'number'
              ? '10'
              : field.type === 'date'
                ? '2026-10-01'
                : 'قيمة اختبار كافية للتدقيق'
  }
  form.set('data', JSON.stringify(data))
  for (const doc of service.requiredDocuments) form.set(`doc__${doc.key}`, new Blob([jpeg], { type: 'image/jpeg' }), `${doc.key}.jpg`)
  const submit = await call('citizen', '/api/service-requests', { method: 'POST', form })
  check('service request submitted', submit.status === 201, `${submit.status} ${submit.data?.message || ''}`)
  reference = submit.data?.reference
}

// ---- employee: department scoping + checklist + fee ---------------------------------------------
if (reference) {
  const list = await call('employee', '/api/employee/service-requests')
  check('employee sees only their department', (list.data.items || []).every(item => item.departmentId === 'dhiqar-municipalities'))
  const fee = await call('employee', `/api/employee/service-requests/${reference}`, {
    method: 'PATCH', body: { status: 'PAYMENT_REQUIRED', currentAction: 'رسم الخدمة المقرر من الدائرة', amountIqd: 5000 },
  })
  check('employee can request a fee', fee.status === 200, `${fee.status} ${fee.data?.message || ''}`)
  const mine = await call('citizen', '/api/citizen/service-requests')
  const row = (mine.data || []).find(r => r.reference === reference)
  check('request is waiting for payment', row?.status === 'PAYMENT_PENDING', row?.status)
  const payRef = row?.payments?.find(p => p.status === 'PENDING')?.reference
  check('payment intent created', Boolean(payRef), payRef || '')
  if (payRef) {
    const openPay = await fetch(`${base}/api/payments/return/sandbox?intentId=x&outcome=PAID`, { redirect: 'manual' })
    check('unauthenticated sandbox settlement refused', (openPay.headers.get('location') || '').includes('invalid'), openPay.headers.get('location') || '')
    const paid = await call('citizen', `/api/citizen/payments/${payRef}/sandbox-confirm`, { method: 'POST', body: { outcome: 'PAID' } })
    check('citizen pays in sandbox', paid.status === 200 && paid.data.status === 'PAID', paid.data?.status || String(paid.status))
  }
  const after = await call('citizen', '/api/citizen/service-requests')
  const released = (after.data || []).find(r => r.reference === reference)
  check('paid request returns to the department queue', ['SUBMITTED', 'UNDER_REVIEW'].includes(released?.status), released?.status)
  const detail = await call('employee', `/api/employee/service-requests/${reference}`)
  for (const item of detail.data.checklist || []) {
    if (item.mediaId) await call('employee', `/api/employee/service-requests/${reference}/documents/${item.key}`, { method: 'PATCH', body: { status: 'VERIFIED' } })
  }
  const approve = await call('employee', `/api/employee/service-requests/${reference}`, {
    method: 'PATCH', body: { status: 'APPROVED', currentAction: 'اكتملت المعاملة وصدرت الوثيقة', decisionNote: 'مستوفٍ للشروط' },
  })
  check('employee approves after payment', approve.status === 200, `${approve.status} ${approve.data?.message || ''}`)
  const docs = await call('citizen', '/api/citizen/issued-documents')
  const issued = (docs.data || []).find(d => d.serviceRequestReference === reference)
  check('document issued to the citizen', Boolean(issued), issued?.documentNumber || '')
  if (issued) {
    const pdf = await fetch(`${base}/api/citizen/issued-documents/${issued.id}/pdf`, { headers: { cookie: jar.citizen } })
    const buffer = Buffer.from(await pdf.arrayBuffer())
    check('PDF downloads', pdf.status === 200 && buffer.subarray(0, 4).toString() === '%PDF', `${pdf.status} ${buffer.length} bytes`)
    const pub = await call('public', `/api/verify/${issued.verificationId}`)
    check('public verification returns a minimal record', pub.status === 200 && pub.data.status === 'APPROVED' && !('address' in pub.data) && !('citizenId' in pub.data), Object.keys(pub.data).join(','))
  }
}
console.log(failures ? `\n${failures} FAILURES` : '\nall checks passed')
process.exit(failures ? 1 : 0)
