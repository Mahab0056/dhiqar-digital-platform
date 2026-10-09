// Citizen ↔ employee loop audit fixes: office receipts, escalation of requests nobody can take, the appointment
// workflow, document issuance per service, request links and the citizen's full request view.
import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()

let app: Express
let admin = ''
let citizen = ''
let otherCitizen = ''
let gov = ''
let water = ''
let health = ''
let operations = ''

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)])
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])

const db = async () => (await import('../server/db.ts')).db

type Field = { key: string; type: string; options?: string[]; maxLength?: number; required?: boolean }
type ServiceShape = { key: string; fields: Field[]; requiredDocuments: Array<{ key: string; required: boolean }> }

/** YYYY-MM-DD in Baghdad, `days` from today. */
const baghdadDate = (days = 0) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000))

async function staffLogin(username: string, password: string) {
  const response = await request(app).post('/api/auth/staff/login').send({ username, password })
  expect(response.status).toBe(200)
  return cookieOf(response)
}

async function createStaff(role: string, username: string, departmentId: string | null) {
  const created = await request(app)
    .post('/api/super-admin/staff')
    .set('Cookie', admin)
    .send({ username, fullName: `Test ${username}`, role, departmentId })
  expect(created.status).toBe(201)
  const cookie = await staffLogin(username, created.body.temporaryPassword)
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', cookie)
    .send({ currentPassword: created.body.temporaryPassword, newPassword: `Rotated-${username}-2026!` })
  return cookie
}

async function citizenSession(phone: string) {
  const requested = await request(app).post('/api/onboarding/request-otp').send({ phone })
  const verified = await request(app)
    .post('/api/onboarding/verify-phone')
    .send({ phone, challengeId: requested.body.challengeId, otp: '246810' })
  return cookieOf(verified)
}

function fillField(field: Field) {
  if (field.options?.length) return field.options[0]
  if (field.type === 'tel') return '07701234567'
  if (field.type === 'email') return 'qa@example.com'
  if (field.type === 'number') return '4'
  if (field.type === 'date') return baghdadDate(3)
  if (field.type === 'time') return '10:30'
  return 'بيانات اختبار'.slice(0, field.maxLength || 160)
}

async function submit(serviceKey: string, cookie = citizen, overrides: Record<string, string> = {}) {
  const service = (await request(app).get(`/api/services/${serviceKey}`)).body as ServiceShape
  const data = { ...Object.fromEntries(service.fields.map(field => [field.key, fillField(field)])), ...overrides }
  let req = request(app)
    .post('/api/service-requests')
    .set('Cookie', cookie)
    .field('serviceKey', serviceKey)
    .field('data', JSON.stringify(data))
    .field('faceConsent', 'true')
    .field('documentConsent', 'true')
  for (const doc of service.requiredDocuments)
    req = req.attach(`doc__${doc.key}`, doc.key.includes('id') ? jpeg : pdf, {
      filename: `${doc.key}.${doc.key.includes('id') ? 'jpg' : 'pdf'}`,
      contentType: doc.key.includes('id') ? 'image/jpeg' : 'application/pdf',
    })
  const response = await req.attach('faceVideo', webm, { filename: 'face.webm', contentType: 'video/webm' })
  expect(response.status).toBe(201)
  return response.body as {
    reference: string
    status: string
    appointment: { status: string; preferredDate: string; preferredTime: string } | null
    payment: { reference: string; amountIqd: number } | null
    payAtOffice: boolean
  }
}

const decide = (cookie: string, reference: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/employee/service-requests/${reference}`).set('Cookie', cookie).send(body)
const post = (cookie: string, path: string, body: Record<string, unknown> = {}) =>
  request(app).post(path).set('Cookie', cookie).send(body)

/** Verifies every uploaded document of a request. */
async function verifyAll(cookie: string, reference: string) {
  const view = await request(app).get(`/api/employee/service-requests/${reference}`).set('Cookie', cookie)
  expect(view.status).toBe(200)
  for (const item of view.body.checklist as Array<{ key: string; mediaId: string | null }>) {
    if (!item.mediaId) continue
    const verified = await request(app)
      .patch(`/api/employee/service-requests/${reference}/documents/${item.key}`)
      .set('Cookie', cookie)
      .send({ status: 'VERIFIED' })
    expect(verified.status).toBe(200)
  }
}

const notifications = async (cookie = citizen) =>
  (await request(app).get('/api/citizen/notifications').set('Cookie', cookie)).body.items as Array<{
    title: string
    message: string
    link: string | null
  }>

const queue = async (cookie: string) =>
  (await request(app).get('/api/employee/service-requests').set('Cookie', cookie)).body.items as Array<{
    reference: string
    escalation: { reason: string; label: string } | null
  }>

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  admin = await staffLogin('admin', 'Bootstrap-Admin-Pass-2026!')
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', admin)
    .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Admin-Rotated-Pass-2026!' })
  citizen = await citizenSession('07801239101')
  otherCitizen = await citizenSession('07801239102')
  ;(await db()).prepare(`UPDATE citizens SET verification_status = 'VERIFIED_MANUAL'`).run()
  gov = await createStaff('EMPLOYEE', 'loop.gov', 'dhiqar-governorate')
  water = await createStaff('EMPLOYEE', 'loop.water', 'dhiqar-water')
  health = await createStaff('EMPLOYEE', 'loop.health', 'dhiqar-health')
  operations = await createStaff('OPERATIONS', 'loop.ops', null)
})

describe('document issuance per service', () => {
  it('serviceIssuesDocument: complaints, reports and appointments issue no PDF', async () => {
    const { serviceIssuesDocument } = await import('../server/routes/service-requests.ts')
    expect(serviceIssuesDocument({ key: 'gov-complaint', category: 'الشكاوى والمراجعات' })).toBe(false)
    expect(serviceIssuesDocument({ key: 'elec-fault-report', category: 'الكهرباء' })).toBe(false)
    expect(serviceIssuesDocument({ key: 'nid-appointment-reschedule', category: 'الوثائق الحكومية' })).toBe(false)
    expect(serviceIssuesDocument({ key: 'gov-governor-meeting-request', category: 'الشكاوى والمراجعات' })).toBe(false)
    expect(
      serviceIssuesDocument({ key: 'online-appointment', category: 'الوثائق الحكومية', mode: 'APPOINTMENT' })
    ).toBe(false)
    expect(serviceIssuesDocument({ key: 'gov-low-cost-housing', category: 'السكن والأراضي' })).toBe(true)
    expect(serviceIssuesDocument({ key: 'health-birth-certificate', category: 'الصحة' })).toBe(true)
  })

  it('approving a complaint notifies the citizen without issuing a document', async () => {
    const { reference } = await submit('gov-complaint')
    await verifyAll(gov, reference)
    const approved = await decide(gov, reference, { status: 'APPROVED', decisionNote: 'عولجت الشكوى' })
    expect(approved.status).toBe(200)
    expect(approved.body.issuesDocument).toBe(false)
    expect(approved.body.currentAction).not.toContain('الوثيقة الرقمية')
    const count = (await db())
      .prepare('SELECT COUNT(*) AS n FROM issued_documents WHERE service_request_reference = ?')
      .get(reference) as { n: number }
    expect(count.n).toBe(0)
    const notice = (await notifications()).find(
      item => item.message.includes(reference) && item.title.includes('الموافقة')
    )
    expect(notice?.link).toBe(`/citizen/request/${reference}`)
  })
})

describe('office receipt for a service-request fee', () => {
  it('records the counter receipt, supersedes the online intent and unblocks approval', async () => {
    const created = await submit('health-birth-certificate')
    expect(created.status).toBe('PAYMENT_PENDING')
    const reference = created.reference
    const path = `/api/employee/service-requests/${reference}/record-office-payment`
    // validation, scope and amount
    expect((await post(health, path, { amountIqd: 5000 })).status).toBe(400)
    expect((await post(water, path, { receiptNumber: 'R-1001', amountIqd: 5000 })).status).toBe(403)
    expect((await post(citizen, path, { receiptNumber: 'R-1001', amountIqd: 5000 })).status).toBe(401)
    const short = await post(health, path, { receiptNumber: 'R-1001', amountIqd: 100 })
    expect(short.status).toBe(400)
    expect(short.body.message).toContain('أقل من الرسم')
    // approving while the fee is owed is refused
    const early = await decide(health, reference, { status: 'APPROVED' })
    expect(early.status).toBe(409)

    const recorded = await post(health, path, { receiptNumber: 'R-1001', amountIqd: 5000, note: 'دفع نقدي' })
    expect(recorded.status).toBe(200)
    expect(recorded.body.paymentStatus).toBe('PAID')
    expect(recorded.body.status).toBe('SUBMITTED')
    expect(recorded.body.officeReceipt).toMatchObject({ receiptNumber: 'R-1001', amountIqd: 5000, note: 'دفع نقدي' })
    expect(recorded.body.slaPaused).toBe(false)
    // the online intent can no longer be paid
    const online = (await db())
      .prepare('SELECT status, provider_reference FROM payment_intents WHERE reference = ?')
      .get(created.payment!.reference) as { status: string; provider_reference: string }
    expect(online).toMatchObject({ status: 'CANCELLED', provider_reference: 'OFFICE:R-1001' })
    const sandbox = await post(citizen, `/api/citizen/payments/${created.payment!.reference}/sandbox-confirm`, {
      outcome: 'PAID',
    })
    expect(sandbox.status).toBe(409)
    const checkout = await post(citizen, `/api/citizen/payments/${created.payment!.reference}/checkout`)
    expect(checkout.status).toBe(409)
    // second receipt on the same request → nothing owed
    expect((await post(health, path, { receiptNumber: 'R-1002', amountIqd: 5000 })).status).toBe(409)
    // the same receipt number can't be reused on another request of the department
    const another = await submit('health-birth-certificate')
    const reused = await post(health, `/api/employee/service-requests/${another.reference}/record-office-payment`, {
      receiptNumber: 'R-1001',
      amountIqd: 5000,
    })
    expect(reused.status).toBe(409)

    // audit + citizen notification with the request link
    const audit = (await db())
      .prepare(
        `SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id = ? AND action = 'SERVICE_REQUEST_OFFICE_PAYMENT_RECORDED'`
      )
      .get(reference) as { n: number }
    expect(audit.n).toBe(1)
    const notice = (await notifications()).find(item => item.message.includes('R-1001'))
    expect(notice?.link).toBe(`/citizen/request/${reference}`)

    await verifyAll(health, reference)
    const approved = await decide(health, reference, { status: 'APPROVED' })
    expect(approved.status).toBe(200)
    expect(approved.body.issuesDocument).toBe(true)

    // the citizen's full view shows the receipt, the superseded intent is not owed, and the PDF is listed
    const detail = await request(app).get(`/api/citizen/service-requests/${reference}`).set('Cookie', citizen)
    expect(detail.status).toBe(200)
    expect(detail.body.fee.officeReceipt.receiptNumber).toBe('R-1001')
    expect(detail.body.fee.owed).toEqual([])
    expect(detail.body.issuedDocuments).toHaveLength(1)
    expect(detail.body.issuedDocuments[0].pdfUrl).toMatch(/^\/api\/citizen\/issued-documents\/.+\/pdf$/)
    const types = detail.body.timeline.map((item: { type: string }) => item.type)
    expect(types).toEqual(
      expect.arrayContaining([
        'SERVICE_REQUEST_CREATED',
        'SERVICE_REQUEST_OFFICE_PAYMENT_RECORDED',
        'SERVICE_DOCUMENT_VERIFIED',
        'SERVICE_REQUEST_APPROVED_DOCUMENT_ISSUED',
      ])
    )
    // staff names never reach the citizen
    expect(JSON.stringify(detail.body.timeline)).not.toContain('loop.health')
  })
})

describe('escalation of requests nobody in the department can take', () => {
  let unstaffedService = ''
  beforeAll(async () => {
    const services = (await request(app).get('/api/services?department=dhiqar-electricity')).body.items as Array<{
      key: string
      channel: string
      mode: string
      feeIqd: number | null
      active: boolean
    }>
    unstaffedService = services.find(
      item => item.channel === 'ONLINE_SUBMISSION' && item.mode === 'CATALOG' && !item.feeIqd && item.active
    )!.key
    expect(unstaffedService).toBeTruthy()
  })

  it('a department with no active employee: the governorate office sees, claims and decides it', async () => {
    const { reference } = await submit(unstaffedService)
    const govItem = (await queue(gov)).find(item => item.reference === reference)
    expect(govItem?.escalation).toMatchObject({ reason: 'NO_STAFF', label: 'محال من دائرة بلا موظفين' })
    // still strictly scoped for every other department
    expect((await queue(water)).some(item => item.reference === reference)).toBe(false)
    expect((await request(app).get(`/api/employee/service-requests/${reference}`).set('Cookie', water)).status).toBe(
      403
    )
    expect((await request(app).get(`/api/employee/service-requests/${reference}`).set('Cookie', gov)).status).toBe(200)
    const claimed = await post(gov, `/api/employee/service-requests/${reference}/claim`)
    expect(claimed.status).toBe(200)
    expect(claimed.body.departmentId).toBe('dhiqar-electricity')
    expect((await decide(gov, reference, { status: 'UNDER_REVIEW', decisionNote: 'تابعه الديوان' })).status).toBe(200)

    // coverage report for the super admin / operations room
    const coverage = await request(app).get('/api/operations/department-coverage').set('Cookie', admin)
    expect(coverage.status).toBe(200)
    const electricity = coverage.body.items.find((item: { id: string }) => item.id === 'dhiqar-electricity')
    expect(electricity.activeEmployees).toBe(0)
    expect(electricity.openRequests).toBeGreaterThanOrEqual(1)
    expect(coverage.body.items.some((item: { id: string }) => item.id === 'dhiqar-water')).toBe(false)
    expect(coverage.body.summary.openRequestsWithoutStaff).toBeGreaterThanOrEqual(1)
    expect((await request(app).get('/api/operations/department-coverage').set('Cookie', operations)).status).toBe(200)
    expect([401, 403]).toContain(
      (await request(app).get('/api/operations/department-coverage').set('Cookie', gov)).status
    )

    // once the department is staffed, new requests stay with it; the one the governorate claimed stays with them
    await createStaff('EMPLOYEE', 'loop.electricity', 'dhiqar-electricity')
    const fresh = await submit(unstaffedService)
    const govQueue = await queue(gov)
    expect(govQueue.some(item => item.reference === fresh.reference)).toBe(false)
    expect(govQueue.find(item => item.reference === reference)?.escalation?.reason).toBe('SLA_UNCLAIMED')
  })

  it('an unclaimed request past its SLA is escalated until a department employee claims it', async () => {
    const services = (await request(app).get('/api/services?department=dhiqar-water')).body.items as Array<{
      key: string
      channel: string
      mode: string
      feeIqd: number | null
      active: boolean
    }>
    const key = services.find(
      item => item.channel === 'ONLINE_SUBMISSION' && item.mode === 'CATALOG' && !item.feeIqd && item.active
    )!.key
    const { reference } = await submit(key)
    expect((await queue(gov)).some(item => item.reference === reference)).toBe(false)
    ;(await db())
      .prepare('UPDATE service_requests SET due_at = ? WHERE reference = ?')
      .run(new Date(Date.now() - 3_600_000).toISOString(), reference)
    expect((await queue(gov)).find(item => item.reference === reference)?.escalation?.reason).toBe('SLA_UNCLAIMED')
    expect((await post(water, `/api/employee/service-requests/${reference}/claim`)).status).toBe(200)
    expect((await queue(gov)).some(item => item.reference === reference)).toBe(false)
    expect((await request(app).get(`/api/employee/service-requests/${reference}`).set('Cookie', gov)).status).toBe(403)
  })
})

describe('appointments', () => {
  it('approving an attendance service requires a slot and books an appointments row', async () => {
    const { reference, appointment } = await submit('gov-official-statement')
    expect(appointment).toBeNull()
    await verifyAll(gov, reference)
    const missing = await decide(gov, reference, { status: 'APPROVED' })
    expect(missing.status).toBe(400)
    expect(missing.body.code).toBe('APPOINTMENT_REQUIRED')
    const day = baghdadDate(5)
    expect(
      (await decide(gov, reference, { status: 'APPROVED', appointmentDate: day, appointmentTime: '25:00' })).status
    ).toBe(400)
    expect(
      (await decide(gov, reference, { status: 'APPROVED', appointmentDate: baghdadDate(-2), appointmentTime: '10:00' }))
        .status
    ).toBe(400)
    const approved = await decide(gov, reference, {
      status: 'APPROVED',
      appointmentDate: day,
      appointmentTime: '10:15',
      appointmentNote: 'شعبة الإصدار',
    })
    expect(approved.status).toBe(200)
    expect(approved.body.appointment).toMatchObject({ preferredDate: day, preferredTime: '10:15', status: 'CONFIRMED' })
    expect(approved.body.currentAction).toContain(`${day} الساعة 10:15`)

    // the department's day view
    const list = await request(app).get(`/api/employee/appointments?date=${day}`).set('Cookie', gov)
    expect(list.status).toBe(200)
    const booked = list.body.items.find((item: { requestReference: string }) => item.requestReference === reference)
    expect(booked).toMatchObject({ time: '10:15', status: 'CONFIRMED', confirmed: true })
    const waterList = await request(app).get(`/api/employee/appointments?date=${day}`).set('Cookie', water)
    expect(waterList.body.items.some((item: { requestReference: string }) => item.requestReference === reference)).toBe(
      false
    )
    const adminList = await request(app).get(`/api/employee/appointments?date=${day}`).set('Cookie', admin)
    expect(adminList.body.items.some((item: { requestReference: string }) => item.requestReference === reference)).toBe(
      true
    )
    expect((await request(app).get('/api/employee/appointments?date=2026-13-45x').set('Cookie', gov)).status).toBe(400)

    // reschedule after approval: the citizen is told the new date and time
    const later = baghdadDate(9)
    const moved = await post(gov, `/api/employee/service-requests/${reference}/appointment`, {
      action: 'RESCHEDULE',
      date: later,
      time: '12:30',
    })
    expect(moved.status).toBe(200)
    expect(moved.body.appointment).toMatchObject({ preferredDate: later, preferredTime: '12:30', status: 'CONFIRMED' })
    expect(moved.body.status).toBe('APPROVED')
    const rescheduleNotice = (await notifications()).find(item => item.title === 'تم تغيير موعد حضورك')
    expect(rescheduleNotice?.message).toContain(`${later} الساعة 12:30`)
    expect(rescheduleNotice?.link).toBe(`/citizen/request/${reference}`)
    expect(
      (
        await post(gov, `/api/employee/service-requests/${reference}/appointment`, {
          action: 'RESCHEDULE',
          date: later,
        })
      ).status
    ).toBe(400)
    expect(
      (
        await post(water, `/api/employee/service-requests/${reference}/appointment`, {
          action: 'CONFIRM',
          date: later,
          time: '09:00',
        })
      ).status
    ).toBe(403)
    const rows = (await db())
      .prepare(
        'SELECT COUNT(*) AS n FROM appointments a JOIN service_requests sr ON sr.id = a.service_request_id WHERE sr.reference = ?'
      )
      .get(reference) as { n: number }
    expect(rows.n).toBe(1)

    const detail = await request(app).get(`/api/citizen/service-requests/${reference}`).set('Cookie', citizen)
    expect(detail.body.appointment).toMatchObject({ preferredDate: later, preferredTime: '12:30', confirmed: true })
    expect(detail.body.timeline.map((item: { type: string }) => item.type)).toContain(
      'SERVICE_REQUEST_APPOINTMENT_RESCHEDULED'
    )
  })

  it('an appointment booking: 201 carries the slot, the clerk confirms it, approval issues no PDF', async () => {
    const created = await submit('online-appointment', citizen, {
      preferredDate: baghdadDate(4),
      preferredTime: '11:00',
    })
    expect(created.status).toBe('APPOINTMENT_REQUESTED')
    expect(created.appointment).toMatchObject({
      preferredDate: baghdadDate(4),
      preferredTime: '11:00',
      status: 'REQUESTED',
    })
    const view = await request(app).get(`/api/employee/service-requests/${created.reference}`).set('Cookie', admin)
    const department = view.body.departmentId as string
    const staff = department === 'dhiqar-governorate' ? gov : admin
    const confirmed = await post(staff, `/api/employee/service-requests/${created.reference}/appointment`, {
      action: 'CONFIRM',
    })
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.status).toBe('UNDER_REVIEW')
    expect(confirmed.body.appointment).toMatchObject({ preferredTime: '11:00', status: 'CONFIRMED' })
    const notice = (await notifications()).find(
      item => item.title === 'تم تأكيد موعد حضورك' && item.message.includes(created.reference)
    )
    expect(notice?.message).toContain(`${baghdadDate(4)} الساعة 11:00`)
    await verifyAll(staff, created.reference)
    const approved = await decide(staff, created.reference, { status: 'APPROVED' })
    expect(approved.status).toBe(200)
    expect(approved.body.issuesDocument).toBe(false)
    const count = (await db())
      .prepare('SELECT COUNT(*) AS n FROM issued_documents WHERE service_request_reference = ?')
      .get(created.reference) as { n: number }
    expect(count.n).toBe(0)
  })
})

describe('citizen request page', () => {
  it('GET /api/citizen/service-requests/:reference returns the full view to its owner only', async () => {
    const { reference } = await submit('gov-low-cost-housing')
    const rejected = await request(app)
      .patch(`/api/employee/service-requests/${reference}/documents/national-id`)
      .set('Cookie', gov)
      .send({ status: 'REJECTED', note: 'الصورة غير واضحة' })
    expect(rejected.status).toBe(200)
    const sentBack = await decide(gov, reference, { status: 'ACTION_REQUIRED' })
    expect(sentBack.status).toBe(200)
    const detail = await request(app).get(`/api/citizen/service-requests/${reference}`).set('Cookie', citizen)
    expect(detail.status).toBe(200)
    expect(detail.body).toMatchObject({
      reference,
      status: 'ACTION_REQUIRED',
      issuesDocument: true,
      appointment: null,
      issuedDocuments: [],
    })
    expect(detail.body.currentAction).toContain('الصورة غير واضحة')
    const nationalId = detail.body.documents.find((item: { key: string }) => item.key === 'national-id')
    expect(nationalId).toMatchObject({ status: 'REJECTED', rejectionReason: 'الصورة غير واضحة', uploaded: true })
    expect(detail.body.fee).toMatchObject({ paymentStatus: 'NOT_REQUIRED', owed: [], officeReceipt: null })
    const types = detail.body.timeline.map((item: { type: string }) => item.type)
    expect(types).toEqual(['SERVICE_REQUEST_CREATED', 'SERVICE_DOCUMENT_REJECTED', 'SERVICE_REQUEST_ACTION_REQUIRED'])
    expect(detail.body.timeline[1].description).toContain('الصورة غير واضحة')
    expect(detail.body.timeline[0].actor).toBe('CITIZEN')
    expect(detail.body.timeline[1].actor).toBe('DEPARTMENT')
    // another citizen's reference looks exactly like a missing one
    expect(
      (await request(app).get(`/api/citizen/service-requests/${reference}`).set('Cookie', otherCitizen)).status
    ).toBe(404)
    expect((await request(app).get(`/api/citizen/service-requests/TQS-1999-99999`).set('Cookie', citizen)).status).toBe(
      404
    )
    expect((await request(app).get(`/api/citizen/service-requests/${reference}`).set('Cookie', gov)).status).toBe(401)
    // every notification about it opens the request page
    const links = (await notifications()).filter(item => item.message.includes(reference)).map(item => item.link)
    expect(links.length).toBeGreaterThanOrEqual(2)
    expect(new Set(links)).toEqual(new Set([`/citizen/request/${reference}`]))
  })
})
