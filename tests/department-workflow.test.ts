// Department workflow: claiming/assigning requests, referral between departments, the department-manager flag
// and per-service SLA deadlines (docs/audit/PLATFORM_QA_2026-10-09.md §5.1 and §11 «باقٍ»).
import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()

let app: Express
let admin = ''
let citizen = ''
let govA = ''
let govB = ''
let govManager = ''
let water = ''
let health = ''
const staffIds: Record<string, string> = {}

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)])
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])

const db = async () => (await import('../server/db.ts')).db

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
  staffIds[username] = created.body.account.id
  const cookie = await staffLogin(username, created.body.temporaryPassword)
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', cookie)
    .send({ currentPassword: created.body.temporaryPassword, newPassword: `Rotated-${username}-2026!` })
  return cookie
}

function fillField(field: { type: string; options?: string[]; maxLength?: number }) {
  if (field.options?.length) return field.options[0]
  if (field.type === 'tel') return '07701234567'
  if (field.type === 'email') return 'qa@example.com'
  if (field.type === 'number') return '4'
  if (field.type === 'date') return new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
  if (field.type === 'time') return '10:30'
  return 'بيانات اختبار'.slice(0, field.maxLength || 160)
}

/** A complete no-fee request to the governorate (gov-low-cost-housing). */
async function submitGovRequest() {
  const service = (await request(app).get('/api/services/gov-low-cost-housing')).body as {
    fields: Array<{ key: string; type: string; options?: string[]; maxLength?: number }>
    requiredDocuments: Array<{ key: string }>
  }
  let req = request(app)
    .post('/api/service-requests')
    .set('Cookie', citizen)
    .field('serviceKey', 'gov-low-cost-housing')
    .field('data', JSON.stringify(Object.fromEntries(service.fields.map(field => [field.key, fillField(field)]))))
    .field('faceConsent', 'true')
    .field('documentConsent', 'true')
  for (const doc of service.requiredDocuments)
    req = req.attach(`doc__${doc.key}`, pdf, { filename: `${doc.key}.pdf`, contentType: 'application/pdf' })
  const response = await req.attach('faceVideo', webm, { filename: 'face.webm', contentType: 'video/webm' })
  expect(response.status).toBe(201)
  expect(response.body.status).toBe('SUBMITTED')
  return response.body.reference as string
}

const decide = (cookie: string, reference: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/employee/service-requests/${reference}`).set('Cookie', cookie).send(body)
const post = (cookie: string, path: string, body: Record<string, unknown> = {}) =>
  request(app).post(path).set('Cookie', cookie).send(body)

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  admin = await staffLogin('admin', 'Bootstrap-Admin-Pass-2026!')
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', admin)
    .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Admin-Rotated-Pass-2026!' })
  const requested = await request(app).post('/api/onboarding/request-otp').send({ phone: '07801239001' })
  const verified = await request(app)
    .post('/api/onboarding/verify-phone')
    .send({ phone: '07801239001', challengeId: requested.body.challengeId, otp: '246810' })
  citizen = cookieOf(verified)
  ;(await db()).prepare(`UPDATE citizens SET verification_status = 'VERIFIED_MANUAL'`).run()
  govA = await createStaff('EMPLOYEE', 'wf.gov.a', 'dhiqar-governorate')
  govB = await createStaff('EMPLOYEE', 'wf.gov.b', 'dhiqar-governorate')
  govManager = await createStaff('EMPLOYEE', 'wf.gov.manager', 'dhiqar-governorate')
  water = await createStaff('EMPLOYEE', 'wf.water', 'dhiqar-water')
  health = await createStaff('EMPLOYEE', 'wf.health', 'dhiqar-health')
  const flagged = await request(app)
    .patch(`/api/super-admin/staff/${staffIds['wf.gov.manager']}`)
    .set('Cookie', admin)
    .send({ isDepartmentManager: true })
  expect(flagged.status).toBe(200)
})

describe('department manager flag', () => {
  it('is carried in the session and toggled only by the super admin', async () => {
    const manager = await request(app).get('/api/auth/session').set('Cookie', govManager)
    const clerk = await request(app).get('/api/auth/session').set('Cookie', govA)
    expect(manager.body.isDepartmentManager).toBe(true)
    expect(clerk.body.isDepartmentManager).toBe(false)
    // only an EMPLOYEE bound to a department can be a manager
    const ops = await createStaff('OPERATIONS', 'wf.ops', null)
    void ops
    const refused = await request(app)
      .patch(`/api/super-admin/staff/${staffIds['wf.ops']}`)
      .set('Cookie', admin)
      .send({ isDepartmentManager: true })
    expect(refused.status).toBe(400)
    const notAdmin = await request(app)
      .patch(`/api/super-admin/staff/${staffIds['wf.gov.a']}`)
      .set('Cookie', govManager)
      .send({ isDepartmentManager: true })
    expect(notAdmin.status).toBe(401)
    const listed = await request(app).get('/api/super-admin/staff').set('Cookie', admin)
    const account = listed.body.accounts.find((item: { username: string }) => item.username === 'wf.gov.manager')
    expect(account.isDepartmentManager).toBe(true)
  })
})

describe('claiming a request', () => {
  it('two simultaneous claims: exactly one wins, the other gets 409 naming the holder', async () => {
    const reference = await submitGovRequest()
    const [a, b] = await Promise.all([
      post(govA, `/api/employee/service-requests/${reference}/claim`),
      post(govB, `/api/employee/service-requests/${reference}/claim`),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const winner = a.status === 200 ? a : b
    const loser = a.status === 200 ? b : a
    expect(winner.body.assignedStaffId).toBeTruthy()
    expect(winner.body.assignedStaffName).toMatch(/^Test wf\.gov\./)
    expect(loser.body.assignedStaffId).toBe(winner.body.assignedStaffId)
    const row = (await db())
      .prepare('SELECT assigned_staff_id FROM service_requests WHERE reference = ?')
      .get(reference) as { assigned_staff_id: string }
    expect(row.assigned_staff_id).toBe(winner.body.assignedStaffId)
    // a double click by the holder is not an error; another department can't claim at all
    const winnerCookie = a.status === 200 ? govA : govB
    expect((await post(winnerCookie, `/api/employee/service-requests/${reference}/claim`)).status).toBe(200)
    expect((await post(water, `/api/employee/service-requests/${reference}/claim`)).status).toBe(403)
  })

  it('only the assignee (or the manager) can decide or review documents on a claimed request', async () => {
    const reference = await submitGovRequest()
    expect((await post(govA, `/api/employee/service-requests/${reference}/claim`)).status).toBe(200)
    const other = await decide(govB, reference, { status: 'UNDER_REVIEW', decisionNote: 'بدأ التدقيق' })
    expect(other.status).toBe(409)
    expect(other.body.code).toBe('ASSIGNED_TO_OTHER')
    const doc = await request(app)
      .patch(`/api/employee/service-requests/${reference}/documents/national-id`)
      .set('Cookie', govB)
      .send({ status: 'VERIFIED' })
    expect(doc.status).toBe(409)
    const transfer = await post(govB, `/api/employee/service-requests/${reference}/transfer`, {
      toDepartmentId: 'dhiqar-water',
      reason: 'ليس من اختصاص الديوان',
    })
    expect(transfer.status).toBe(409)
    const own = await decide(govA, reference, { status: 'UNDER_REVIEW', decisionNote: 'بدأ التدقيق' })
    expect(own.status).toBe(200)
    const manager = await decide(govManager, reference, { status: 'UNDER_REVIEW', decisionNote: 'متابعة المدير' })
    expect(manager.status).toBe(200)
    // unassigned requests stay open to every employee of the department (behaviour before assignment existed)
    const unassigned = await submitGovRequest()
    expect((await decide(govB, unassigned, { status: 'UNDER_REVIEW', decisionNote: 'بدأ التدقيق' })).status).toBe(200)
  })

  it('release by the assignee or manager; assign by the manager to an active employee of the same department', async () => {
    const reference = await submitGovRequest()
    await post(govA, `/api/employee/service-requests/${reference}/claim`)
    expect((await post(govB, `/api/employee/service-requests/${reference}/release`)).status).toBe(403)
    // a plain employee cannot assign
    expect(
      (await post(govA, `/api/employee/service-requests/${reference}/assign`, { staffId: staffIds['wf.gov.b'] })).status
    ).toBe(403)
    // the manager cannot assign across departments
    expect(
      (await post(govManager, `/api/employee/service-requests/${reference}/assign`, { staffId: staffIds['wf.water'] }))
        .status
    ).toBe(400)
    const assigned = await post(govManager, `/api/employee/service-requests/${reference}/assign`, {
      staffId: staffIds['wf.gov.b'],
    })
    expect(assigned.status).toBe(200)
    expect(assigned.body.assignedStaffId).toBe(staffIds['wf.gov.b'])
    expect(assigned.body.assignedStaffName).toBe('Test wf.gov.b')
    // the previous holder is now the "other" employee
    expect((await decide(govA, reference, { status: 'UNDER_REVIEW', decisionNote: 'ملاحظة' })).status).toBe(409)
    const released = await post(govManager, `/api/employee/service-requests/${reference}/release`)
    expect(released.status).toBe(200)
    expect(released.body.assignedStaffId).toBeNull()
    expect((await post(govManager, `/api/employee/service-requests/${reference}/release`)).status).toBe(409)
    // self-release by the holder
    await post(govA, `/api/employee/service-requests/${reference}/claim`)
    const selfRelease = await post(govA, `/api/employee/service-requests/${reference}/release`)
    expect(selfRelease.status).toBe(200)
    const audit = (await db())
      .prepare(
        `SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id = ? AND action IN ('SERVICE_REQUEST_CLAIMED', 'SERVICE_REQUEST_ASSIGNED', 'SERVICE_REQUEST_RELEASED')`
      )
      .get(reference) as { n: number }
    expect(audit.n).toBe(5)
    const staff = await request(app).get('/api/employee/department-staff').set('Cookie', govManager)
    expect(staff.body.items.map((item: { id: string }) => item.id)).toContain(staffIds['wf.gov.b'])
    expect(staff.body.items.map((item: { id: string }) => item.id)).not.toContain(staffIds['wf.water'])
  })
})

describe('referral to another department', () => {
  it('moves the request, clears the assignment, notifies the citizen and the old department loses access', async () => {
    const reference = await submitGovRequest()
    await post(govA, `/api/employee/service-requests/${reference}/claim`)
    const short = await post(govA, `/api/employee/service-requests/${reference}/transfer`, {
      toDepartmentId: 'dhiqar-water',
      reason: 'قصير',
    })
    expect(short.status).toBe(400)
    const same = await post(govA, `/api/employee/service-requests/${reference}/transfer`, {
      toDepartmentId: 'dhiqar-governorate',
      reason: 'إحالة إلى الدائرة نفسها',
    })
    expect(same.status).toBe(400)
    const moved = await post(govA, `/api/employee/service-requests/${reference}/transfer`, {
      toDepartmentId: 'dhiqar-water',
      reason: 'الطلب يخص شبكة الماء وليس الديوان',
    })
    expect(moved.status).toBe(200)
    expect(moved.body.departmentId).toBe('dhiqar-water')
    expect(moved.body.originDepartmentId).toBe('dhiqar-governorate')
    expect(moved.body.assignedStaffId).toBeNull()
    expect(moved.body.transfers).toHaveLength(1)
    expect(moved.body.transfers[0].reason).toBe('الطلب يخص شبكة الماء وليس الديوان')
    const row = (await db())
      .prepare(
        'SELECT department_id, origin_department_id, assigned_staff_id FROM service_requests WHERE reference = ?'
      )
      .get(reference) as Record<string, unknown>
    expect(row).toMatchObject({
      department_id: 'dhiqar-water',
      origin_department_id: 'dhiqar-governorate',
      assigned_staff_id: null,
    })
    // the old department can no longer open or act on it; the new one can
    expect((await request(app).get(`/api/employee/service-requests/${reference}`).set('Cookie', govA)).status).toBe(403)
    expect((await decide(govA, reference, { status: 'UNDER_REVIEW', decisionNote: 'محاولة' })).status).toBe(403)
    const govQueue = await request(app).get('/api/employee/service-requests').set('Cookie', govA)
    expect(govQueue.body.items.some((item: { reference: string }) => item.reference === reference)).toBe(false)
    const waterQueue = await request(app).get('/api/employee/service-requests').set('Cookie', water)
    const arrived = waterQueue.body.items.find((item: { reference: string }) => item.reference === reference)
    expect(arrived.transfers[0].fromDepartmentId).toBe('dhiqar-governorate')
    expect((await decide(water, reference, { status: 'UNDER_REVIEW', decisionNote: 'استلمنا الإحالة' })).status).toBe(
      200
    )
    // citizen is told where it went
    const notifications = await request(app).get('/api/citizen/notifications').set('Cookie', citizen)
    expect(
      notifications.body.items.some(
        (item: { message: string }) => item.message.includes(reference) && item.message.includes('أُحيل طلبك إلى')
      )
    ).toBe(true)
    const mine = await request(app).get('/api/citizen/service-requests').set('Cookie', citizen)
    expect(mine.body.find((item: { reference: string }) => item.reference === reference).departmentId).toBe(
      'dhiqar-water'
    )
    // referral logs on both sides
    const out = await request(app).get('/api/employee/transfers?direction=out').set('Cookie', govA)
    expect(out.body.items.some((item: { reference: string }) => item.reference === reference)).toBe(true)
    const incoming = await request(app).get('/api/employee/transfers?direction=in').set('Cookie', water)
    expect(incoming.body.items.some((item: { reference: string }) => item.reference === reference)).toBe(true)
    const healthOut = await request(app).get('/api/employee/transfers?direction=in').set('Cookie', health)
    expect(healthOut.body.items.some((item: { reference: string }) => item.reference === reference)).toBe(false)
  })

  it('is blocked while a fee is open', async () => {
    let req = request(app)
      .post('/api/service-requests')
      .set('Cookie', citizen)
      .field('serviceKey', 'health-birth-certificate')
      .field(
        'data',
        JSON.stringify({
          newbornName: 'علي حسين',
          birthDate: '2026-08-01',
          birthPlace: 'مستشفى الحبوبي',
          requestType: 'شهادة ولادة',
          district: 'الناصرية',
          phone: '07801234567',
        })
      )
      .field('faceConsent', 'true')
      .field('documentConsent', 'true')
    for (const key of ['hospital-birth-report', 'father-id', 'mother-id', 'marriage-contract', 'residence-card'])
      req = req.attach(`doc__${key}`, jpeg, { filename: `${key}.jpg`, contentType: 'image/jpeg' })
    const created = await req.attach('faceVideo', webm, { filename: 'face.webm', contentType: 'video/webm' })
    expect(created.body.status).toBe('PAYMENT_PENDING')
    const reference = created.body.reference as string
    const blocked = await post(health, `/api/employee/service-requests/${reference}/transfer`, {
      toDepartmentId: 'dhiqar-governorate',
      reason: 'ليست من اختصاص الصحة',
    })
    expect(blocked.status).toBe(409)
    expect(blocked.body.code).toBe('OPEN_FEE')
    expect(blocked.body.message).toMatch(/رسم غير مسدد/)
    // sent back to the citizen with the fee still owed → still blocked
    await decide(health, reference, { status: 'ACTION_REQUIRED', requiredDocument: 'صورة أوضح للهوية' })
    const stillBlocked = await post(health, `/api/employee/service-requests/${reference}/transfer`, {
      toDepartmentId: 'dhiqar-governorate',
      reason: 'ليست من اختصاص الصحة',
    })
    expect(stillBlocked.status).toBe(409)
    const row = (await db())
      .prepare('SELECT department_id FROM service_requests WHERE reference = ?')
      .get(reference) as {
      department_id: string
    }
    expect(row.department_id).toBe('dhiqar-health')
  })
})

describe('SLA deadlines', () => {
  it('adds working days skipping Friday and Saturday in Baghdad time', async () => {
    const { addWorkingDays, isIraqiWeekend } = await import('../server/services/sla.ts')
    // Thursday 2026-10-08 10:00 Baghdad (07:00Z) + 1 working day → Sunday 2026-10-11 10:00
    expect(addWorkingDays(new Date('2026-10-08T07:00:00Z'), 1).toISOString()).toBe('2026-10-11T07:00:00.000Z')
    // Sunday + 5 → the next Sunday (Mon, Tue, Wed, Thu, [Fri, Sat], Sun)
    expect(addWorkingDays(new Date('2026-10-11T07:00:00Z'), 5).toISOString()).toBe('2026-10-18T07:00:00.000Z')
    // 22:00Z Thursday is already Friday 01:00 in Baghdad: the weekend is judged in Baghdad, not UTC
    expect(isIraqiWeekend(new Date('2026-10-08T22:00:00Z'))).toBe(true)
    expect(isIraqiWeekend(new Date('2026-10-08T20:00:00Z'))).toBe(false)
    // filed on Friday → Sat skipped, Sun counts as the first working day
    expect(addWorkingDays(new Date('2026-10-09T07:00:00Z'), 1).toISOString()).toBe('2026-10-11T07:00:00.000Z')
  })

  it('due_at follows the service SLA, the list flags overdue, and waiting on the citizen pauses the clock', async () => {
    const { computeDueAt } = await import('../server/services/sla.ts')
    const database = await db()
    const reference = await submitGovRequest()
    const row = database
      .prepare('SELECT created_at, due_at, waiting_since FROM service_requests WHERE reference = ?')
      .get(reference) as { created_at: string; due_at: string; waiting_since: string | null }
    // default for an ONLINE_SUBMISSION service: 5 working days
    expect(row.due_at).toBe(computeDueAt(row.created_at, { channel: 'ONLINE_SUBMISSION' }))
    expect(row.waiting_since).toBeNull()

    const listItem = async () =>
      (await request(app).get('/api/employee/service-requests').set('Cookie', govA)).body.items.find(
        (item: { reference: string }) => item.reference === reference
      )
    expect((await listItem()).overdue).toBe(false)
    expect((await listItem()).dueAt).toBe(row.due_at)
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    database.prepare('UPDATE service_requests SET due_at = ? WHERE reference = ?').run(past, reference)
    expect((await listItem()).overdue).toBe(true)
    // the manager's overdue list has it; a plain employee gets no management block
    const managerView = await request(app)
      .get('/api/departments/dhiqar-governorate/dashboard')
      .set('Cookie', govManager)
    expect(managerView.status).toBe(200)
    expect(
      managerView.body.management.overdue.some((item: { reference: string }) => item.reference === reference)
    ).toBe(true)
    expect(managerView.body.management.workload.map((item: { fullName: string }) => item.fullName)).toContain(
      'Test wf.gov.a'
    )
    expect(managerView.body.management.unassignedOpen).toBeGreaterThan(0)
    expect(
      managerView.body.management.outgoingReferrals.some(
        (item: { toDepartmentName: string }) => item.toDepartmentName.length > 0
      )
    ).toBe(true)
    const clerkView = await request(app).get('/api/departments/dhiqar-governorate/dashboard').set('Cookie', govA)
    expect(clerkView.body.management).toBeNull()

    // sent back to the citizen: paused, never overdue
    expect((await decide(govA, reference, { status: 'ACTION_REQUIRED', requiredDocument: 'كتاب تأييد' })).status).toBe(
      200
    )
    const paused = await listItem()
    expect(paused.overdue).toBe(false)
    expect(paused.slaPaused).toBe(true)
    // pretend it waited two hours on the citizen, then the citizen uploads what was asked
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    database.prepare('UPDATE service_requests SET waiting_since = ? WHERE reference = ?').run(twoHoursAgo, reference)
    const extraKey = (
      (await request(app).get('/api/citizen/service-requests').set('Cookie', citizen)).body.find(
        (item: { reference: string }) => item.reference === reference
      ).checklist as Array<{ key: string; status: string }>
    ).find(item => item.status === 'MISSING')?.key
    const upload = await request(app)
      .post(`/api/citizen/service-requests/${reference}/upload-document`)
      .set('Cookie', citizen)
      .field('documentKey', extraKey || '')
      .field('documentName', 'كتاب تأييد')
      .attach('document', pdf, { filename: 'letter.pdf', contentType: 'application/pdf' })
    expect(upload.status).toBe(200)
    expect(upload.body.status).toBe('UNDER_REVIEW')
    const resumed = database
      .prepare('SELECT due_at, waiting_since FROM service_requests WHERE reference = ?')
      .get(reference) as { due_at: string; waiting_since: string | null }
    expect(resumed.waiting_since).toBeNull()
    const pushedBy = Date.parse(resumed.due_at) - Date.parse(past)
    expect(pushedBy).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000 - 5_000)
    expect(pushedBy).toBeLessThan(2 * 60 * 60 * 1000 + 60_000)
  })

  it('the super admin sets a per-service SLA used by new requests', async () => {
    const edited = await request(app)
      .patch('/api/super-admin/platform-services/gov-low-cost-housing')
      .set('Cookie', admin)
      .send({ slaWorkingDays: 2 })
    expect(edited.status).toBe(200)
    const bad = await request(app)
      .patch('/api/super-admin/platform-services/gov-low-cost-housing')
      .set('Cookie', admin)
      .send({ slaWorkingDays: 0 })
    expect(bad.status).toBe(400)
    const workbench = await request(app).get('/api/super-admin/department-workbench').set('Cookie', admin)
    const service = workbench.body.departments
      .find((item: { id: string }) => item.id === 'dhiqar-governorate')
      .services.find((item: { id: string }) => item.id === 'gov-low-cost-housing')
    expect(service.slaWorkingDays).toBe(2)
    expect(service.slaDefaultDays).toBe(5)
    const { computeDueAt } = await import('../server/services/sla.ts')
    const reference = await submitGovRequest()
    const row = (await db())
      .prepare('SELECT created_at, due_at FROM service_requests WHERE reference = ?')
      .get(reference) as { created_at: string; due_at: string }
    expect(row.due_at).toBe(computeDueAt(row.created_at, { channel: 'ONLINE_SUBMISSION', slaWorkingDays: 2 }))
    await request(app)
      .patch('/api/super-admin/platform-services/gov-low-cost-housing')
      .set('Cookie', admin)
      .send({ slaWorkingDays: null })
  })
})
