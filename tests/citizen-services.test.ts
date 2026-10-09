// Citizen side: complaint triage (no department → governorate office, staff re-route), the online appointment
// department list, and the catalog services citizens of Dhi Qar file online.
import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()

let app: Express
let admin = ''
let citizen = ''
let govEmployee = ''
let waterEmployee = ''
let healthEmployee = ''

async function staffLogin(username: string, password: string) {
  const response = await request(app).post('/api/auth/staff/login').send({ username, password })
  expect(response.status).toBe(200)
  return cookieOf(response)
}

async function createStaff(username: string, departmentId: string) {
  const created = await request(app)
    .post('/api/super-admin/staff')
    .set('Cookie', admin)
    .send({ username, fullName: `Test ${username}`, role: 'EMPLOYEE', departmentId })
  expect(created.status).toBe(201)
  const cookie = await staffLogin(username, created.body.temporaryPassword)
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', cookie)
    .send({ currentPassword: created.body.temporaryPassword, newPassword: `Rotated-${username}-2026!` })
  return cookie
}

const fileComplaint = (departmentId?: string) => {
  let req = request(app)
    .post('/api/citizen/feedback')
    .set('Cookie', citizen)
    .field('kind', 'COMPLAINT')
    .field('category', 'خدمات')
    .field('subject', 'انقطاع الماء عن الحي')
    .field('description', 'انقطع الماء عن الحي منذ ثلاثة أيام دون أي إشعار من الدائرة.')
  if (departmentId) req = req.field('departmentId', departmentId)
  return req
}

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  admin = await staffLogin('admin', 'Bootstrap-Admin-Pass-2026!')
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', admin)
    .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Admin-Rotated-Pass-2026!' })
  const requested = await request(app).post('/api/onboarding/request-otp').send({ phone: '07801239101' })
  const verified = await request(app)
    .post('/api/onboarding/verify-phone')
    .send({ phone: '07801239101', challengeId: requested.body.challengeId, otp: '246810' })
  citizen = cookieOf(verified)
  const { db } = await import('../server/db.ts')
  db.prepare(`UPDATE citizens SET verification_status = 'VERIFIED_MANUAL'`).run()
  govEmployee = await createStaff('cz.gov', 'dhiqar-governorate')
  waterEmployee = await createStaff('cz.water', 'dhiqar-water')
  healthEmployee = await createStaff('cz.health', 'dhiqar-health')
})

describe('complaint triage', () => {
  it('a complaint with «لا أعرف الدائرة» lands in the governorate office queue', async () => {
    const created = await fileComplaint()
    expect(created.status).toBe(201)
    expect(created.body.departmentId).toBe('dhiqar-governorate')
    const queue = await request(app).get('/api/admin/feedback').set('Cookie', govEmployee)
    expect(queue.body.some((item: { reference: string }) => item.reference === created.body.reference)).toBe(true)
    // other departments still see only their own complaints
    const water = await request(app).get('/api/admin/feedback').set('Cookie', waterEmployee)
    expect(water.body.some((item: { reference: string }) => item.reference === created.body.reference)).toBe(false)
  })

  it('a complaint with a chosen department keeps it', async () => {
    const created = await fileComplaint('dhiqar-water')
    expect(created.status).toBe(201)
    expect(created.body.departmentId).toBe('dhiqar-water')
  })

  it('the triage department re-routes a complaint; it moves queues, is audited and the citizen sees it', async () => {
    const created = await fileComplaint()
    const reference = created.body.reference as string
    // only the department holding it may re-route
    const foreign = await request(app)
      .patch(`/api/admin/feedback/${reference}/department`)
      .set('Cookie', waterEmployee)
      .send({ departmentId: 'dhiqar-water', reason: 'شكوى تخص شبكة الماء' })
    expect(foreign.status).toBe(403)
    const invalid = await request(app)
      .patch(`/api/admin/feedback/${reference}/department`)
      .set('Cookie', govEmployee)
      .send({ departmentId: 'no-such-department', reason: 'شكوى تخص شبكة الماء' })
    expect(invalid.status).toBe(400)
    const noReason = await request(app)
      .patch(`/api/admin/feedback/${reference}/department`)
      .set('Cookie', govEmployee)
      .send({ departmentId: 'dhiqar-water' })
    expect(noReason.status).toBe(400)

    const moved = await request(app)
      .patch(`/api/admin/feedback/${reference}/department`)
      .set('Cookie', govEmployee)
      .send({ departmentId: 'dhiqar-water', reason: 'شكوى تخص شبكة الماء' })
    expect(moved.status).toBe(200)
    expect(moved.body.departmentId).toBe('dhiqar-water')
    expect(moved.body.events.at(-1).title).toContain('مديرية ماء ذي قار')

    const same = await request(app)
      .patch(`/api/admin/feedback/${reference}/department`)
      .set('Cookie', waterEmployee)
      .send({ departmentId: 'dhiqar-water', reason: 'شكوى تخص شبكة الماء' })
    expect(same.status).toBe(409)

    const water = await request(app).get('/api/admin/feedback').set('Cookie', waterEmployee)
    expect(water.body.some((item: { reference: string }) => item.reference === reference)).toBe(true)
    const gov = await request(app).get('/api/admin/feedback').set('Cookie', govEmployee)
    expect(gov.body.some((item: { reference: string }) => item.reference === reference)).toBe(false)
    // the new department can now act on it
    const update = await request(app)
      .patch(`/api/admin/feedback/${reference}`)
      .set('Cookie', waterEmployee)
      .send({ status: 'IN_PROGRESS', currentAction: 'أُرسل فريق صيانة إلى الحي.' })
    expect(update.status).toBe(200)

    const mine = await request(app).get(`/api/citizen/feedback/${reference}`).set('Cookie', citizen)
    expect(mine.body.departmentId).toBe('dhiqar-water')
    const { db } = await import('../server/db.ts')
    const audit = db
      .prepare(`SELECT new_value FROM audit_logs WHERE action = 'FEEDBACK_REROUTED' AND entity_id = ?`)
      .get(reference) as { new_value: string } | undefined
    expect(audit?.new_value).toContain('dhiqar-water')
    void healthEmployee
  })

  it('a closed complaint cannot be re-routed', async () => {
    const created = await fileComplaint()
    const reference = created.body.reference as string
    await request(app)
      .patch(`/api/admin/feedback/${reference}`)
      .set('Cookie', govEmployee)
      .send({ status: 'CLOSED', currentAction: 'أُغلقت الشكوى بعد المعالجة.' })
    const moved = await request(app)
      .patch(`/api/admin/feedback/${reference}/department`)
      .set('Cookie', govEmployee)
      .send({ departmentId: 'dhiqar-water', reason: 'شكوى تخص شبكة الماء' })
    expect(moved.status).toBe(409)
  })
})

describe('online appointment', () => {
  it('offers every department of the registry, including civil status, passports, traffic, electricity, education', async () => {
    const service = await request(app).get('/api/services/online-appointment')
    const departments = await request(app).get('/api/departments')
    const field = service.body.fields.find((item: { key: string }) => item.key === 'department')
    expect(field.options.length).toBe(departments.body.items.length)
    for (const name of [
      'مديرية أحوال ذي قار (الأحوال المدنية والجوازات والإقامة)',
      'مديرية جوازات ذي قار',
      'مديرية مرور ذي قار',
      'فرع توزيع كهرباء ذي قار',
      'المديرية العامة للتربية في محافظة ذي قار',
    ])
      expect(field.options).toContain(name)
  })
})

describe('citizen service catalog', () => {
  const converted = [
    'water-quality-complaint',
    'water-illegal-connection-report',
    'sewer-manhole-repair-request',
    'police-vehicle-loss-report',
    'traffic-fines-inquiry',
    'elec-bill-inquiry-objection',
    'itpc-bill-payment',
  ]
  const added = [
    'martyrs-family-registration',
    'martyrs-family-data-update',
    'martyrs-grant-salary-request',
    'momd-displaced-returnee-registration',
    'momd-return-grant',
    'disability-id-card',
    'disability-full-time-carer-grant',
    'uot-student-grant',
    'opdc-household-kerosene-share',
    'opdc-household-lpg-share',
    'private-generator-complaint',
    'water-bill-payment-request',
    'elec-bill-payment-request',
  ]

  it('complaints, reports and inquiries a local department handles are online requests to an existing department', async () => {
    const departments = await request(app).get('/api/departments')
    const ids = new Set(departments.body.items.map((item: { id: string }) => item.id))
    for (const key of [...converted, ...added]) {
      const service = await request(app).get(`/api/services/${key}`)
      expect(service.status, key).toBe(200)
      expect(service.body.channel, key).toBe('ONLINE_SUBMISSION')
      expect(ids.has(service.body.departmentId), key).toBe(true)
      expect(service.body.fields.length, key).toBeGreaterThan(1)
      expect(service.body.feeIqd, key).toBeNull()
    }
  })

  it('the new departments exist and their services have documents', async () => {
    for (const id of [
      'martyrs-foundation-dhi-qar',
      'migration-displacement-dhi-qar',
      'disability-care-commission-dhi-qar',
    ]) {
      const department = await request(app).get(`/api/departments/${id}`)
      expect(department.status, id).toBe(200)
    }
    const carer = await request(app).get('/api/services/disability-full-time-carer-grant')
    expect(carer.body.requiredDocuments.filter((doc: { required: boolean }) => doc.required).length).toBeGreaterThan(1)
  })

  it('re-seeding an existing database updates the channel of a service (upsert)', async () => {
    const { db } = await import('../server/db.ts')
    const { seedServiceCatalog } = await import('../server/services/catalog.ts')
    db.prepare(`UPDATE service_catalog SET channel = 'INFORMATION_ONLY' WHERE id = 'water-quality-complaint'`).run()
    seedServiceCatalog()
    const row = db.prepare(`SELECT channel FROM service_catalog WHERE id = 'water-quality-complaint'`).get() as {
      channel: string
    }
    expect(row.channel).toBe('ONLINE_SUBMISSION')
  })

  it('a citizen can file a converted complaint and it reaches that department', async () => {
    const service = (await request(app).get('/api/services/water-quality-complaint')).body as {
      fields: Array<{ key: string; type: string; options?: string[] }>
    }
    const data = Object.fromEntries(
      service.fields.map(field => [
        field.key,
        field.options?.[0] || (field.type === 'tel' ? '07701234567' : 'ماء عكر برائحة غير طبيعية'),
      ])
    )
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])
    const response = await request(app)
      .post('/api/service-requests')
      .set('Cookie', citizen)
      .field('serviceKey', 'water-quality-complaint')
      .field('data', JSON.stringify(data))
      .field('faceConsent', 'true')
      .field('documentConsent', 'true')
      .attach('faceVideo', webm, { filename: 'face.webm', contentType: 'video/webm' })
    expect(response.status).toBe(201)
    const queue = await request(app).get('/api/employee/service-requests').set('Cookie', waterEmployee)
    expect(queue.body.items.some((item: { reference: string }) => item.reference === response.body.reference)).toBe(
      true
    )
  })
})
