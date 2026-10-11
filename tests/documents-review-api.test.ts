// Issued documents end to end: assignment rules, appointment notices, the record HMAC behind /verify, signing-key
// rotation, revocation reaching the citizen, the server-side register search and the Baghdad serial year.
import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()

let app: Express
let admin = ''
let citizen = ''
let govClerk = ''
let govManager = ''

const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)])
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])
const db = async () => (await import('../server/db.ts')).db
type Row = Record<string, string>

async function staffLogin(username: string, password: string) {
  const response = await request(app).post('/api/auth/staff/login').send({ username, password })
  expect(response.status).toBe(200)
  return cookieOf(response)
}

async function createStaff(username: string, departmentId: string, manager = false) {
  const created = await request(app)
    .post('/api/super-admin/staff')
    .set('Cookie', admin)
    .send({ username, fullName: `Test ${username}`, role: 'EMPLOYEE', departmentId })
  expect(created.status).toBe(201)
  if (manager)
    await request(app)
      .patch(`/api/super-admin/staff/${created.body.account.id}`)
      .set('Cookie', admin)
      .send({ isDepartmentManager: true })
  const cookie = await staffLogin(username, created.body.temporaryPassword)
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', cookie)
    .send({ currentPassword: created.body.temporaryPassword, newPassword: `Rotated-${username}-2026!` })
  return staffLogin(username, `Rotated-${username}-2026!`)
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
  return response.body.reference as string
}

async function decide(reference: string, body: Record<string, unknown> = {}) {
  const view = await request(app).get(`/api/employee/service-requests/${reference}`).set('Cookie', govClerk)
  for (const item of view.body.checklist as Array<{ key: string; mediaId: string | null; status: string }>) {
    if (!item.mediaId || item.status === 'VERIFIED') continue
    await request(app)
      .patch(`/api/employee/service-requests/${reference}/documents/${item.key}`)
      .set('Cookie', govClerk)
      .send({ status: 'VERIFIED' })
  }
  return request(app)
    .patch(`/api/employee/service-requests/${reference}`)
    .set('Cookie', govClerk)
    .send({ status: 'APPROVED', decisionNote: 'NOTE-MARKER يُراجع المواطن لاستلام الأصل.', ...body })
}

const issuedFor = async (reference: string) =>
  (await db()).prepare('SELECT * FROM issued_documents WHERE service_request_reference = ?').get(reference) as
    Row | undefined

async function issue() {
  const reference = await submitGovRequest()
  expect((await decide(reference)).status).toBe(200)
  const row = await issuedFor(reference)
  expect(row).toBeTruthy()
  return { reference, row: row as Row }
}

const verify = (code: string) => request(app).get(`/api/verify/${encodeURIComponent(code)}`)
const baghdadDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000))

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  admin = await staffLogin('admin', 'Bootstrap-Admin-Pass-2026!')
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', admin)
    .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Admin-Rotated-Pass-2026!' })
  admin = await staffLogin('admin', 'Admin-Rotated-Pass-2026!')
  const requested = await request(app).post('/api/onboarding/request-otp').send({ phone: '07801239302' })
  const verified = await request(app)
    .post('/api/onboarding/verify-phone')
    .send({ phone: '07801239302', challengeId: requested.body.challengeId, otp: '246810' })
  citizen = cookieOf(verified)
  ;(await db())
    .prepare(`UPDATE citizens SET verification_status = 'VERIFIED_MANUAL', national_id_masked = '199012345678 4821'`)
    .run()
  govClerk = await createStaff('rev.gov.clerk', 'dhiqar-governorate')
  govManager = await createStaff('rev.gov.manager', 'dhiqar-governorate', true)
}, 60_000)

describe('verification codes', () => {
  it('a code containing "%" answers «invalid code», never a 500', async () => {
    const response = await request(app).get('/api/verify/%25')
    expect(response.status).toBe(404)
    expect(response.body.code).toBe('INVALID_CODE')
    const { parseVerificationCode } = await import('../server/documents/token.ts')
    expect(parseVerificationCode('%').kind).toBe('invalid')
    expect(parseVerificationCode('https://thi-qar.com/verify/%E0%A4%A').kind).toBe('invalid')
  })
})

describe('template assignment rules', () => {
  const assign = (templateId: string) =>
    request(app)
      .post('/api/documents/assignments/dhiqar-governorate/gov-low-cost-housing')
      .set('Cookie', govManager)
      .send({ templateId })

  it('a rejection letter, or an appointment notice for a service without attendance, cannot be assigned', async () => {
    const rejection = await assign('rejection-decision')
    expect(rejection.status).toBe(400)
    expect(rejection.body.code).toBe('TEMPLATE_NOT_ASSIGNABLE')
    const appointment = await assign('appointment-notice')
    expect(appointment.status).toBe(400)
    expect(appointment.body.code).toBe('TEMPLATE_NOT_ASSIGNABLE')
    const templates = await request(app).get('/api/documents/templates').set('Cookie', govClerk)
    const byId = new Map(
      (templates.body.templates as Array<{ id: string; issuable: boolean; requiresAppointment: boolean }>).map(item => [
        item.id,
        item,
      ])
    )
    expect(byId.get('rejection-decision')?.issuable).toBe(false)
    expect(byId.get('appointment-notice')?.requiresAppointment).toBe(true)
    expect(byId.get('completion-notice')?.issuable).toBe(true)
  })

  it('a rejection assignment saved before is ignored at issuance', async () => {
    const database = await db()
    database
      .prepare(
        `INSERT INTO document_template_assignments (department_id, service_key, template_id, updated_by, updated_at) VALUES ('dhiqar-governorate', 'gov-low-cost-housing', 'rejection-decision', 'legacy', ?)`
      )
      .run(new Date().toISOString())
    try {
      const reference = await submitGovRequest()
      const plan = await request(app).get(`/api/documents/requests/${reference}/plan`).set('Cookie', govClerk)
      expect(plan.body.template.id).toBe('completion-notice')
    } finally {
      database.prepare(`DELETE FROM document_template_assignments WHERE service_key = 'gov-low-cost-housing'`).run()
    }
  })
})

describe('issuance', () => {
  it('the approval note is a message to the citizen, not a printed condition; detail values are clipped', async () => {
    const { buildDocumentModel, planFor } = await import('../server/issued-documents.ts')
    const citizenId = Number(((await db()).prepare('SELECT id FROM citizens LIMIT 1').get() as { id: number }).id)
    const source = {
      sourceKind: 'SERVICE_REQUEST' as const,
      serviceRequestReference: 'SR-TEST',
      citizenId,
      citizenName: 'علي حسين',
      serviceName: 'إجازة بناء دار سكنية / بناء جديد',
      departmentName: 'مديرية بلدية النصر',
      documentTitle: 'x',
      issuedBy: 'clerk',
      issuedAt: new Date().toISOString(),
      details: [{ label: 'وصف', value: 'س'.repeat(2000) }],
      departmentId: 'nasr-municipality',
      serviceKey: 'nsr-muni-building-permit',
      decisionNote: 'NOTE-MARKER يُراجع المواطن لاستلام الأصل.',
    }
    const plan = planFor(source)
    const model = buildDocumentModel(
      source,
      plan,
      { documentNumber: 'N', token: 't', manualCode: 'm', expiresAt: null },
      'ISSUED'
    )
    expect(model.conditions).toEqual(plan.conditions)
    expect(model.conditions.join(' ')).not.toContain('NOTE-MARKER')
    expect(model.details[0].value.length).toBeLessThanOrEqual(300)
  })

  it('the serial year is the Baghdad year printed on the document', async () => {
    const { nextDocumentSerial } = await import('../server/issued-documents.ts')
    // 31 Dec 22:30 UTC = 1 Jan 01:30 in Baghdad
    expect(nextDocumentSerial('dhiqar-governorate', new Date('2026-12-31T22:30:00Z'))).toMatch(/^TQD-GOV-2027-\d{6}$/)
    expect(nextDocumentSerial('dhiqar-governorate', new Date('2026-12-31T20:30:00Z'))).toMatch(/^TQD-GOV-2026-\d{6}$/)
  })

  it('an appointment notice is issued only with an appointment (refused cleanly otherwise)', async () => {
    const database = await db()
    // an assignment saved before the rule existed (an online service with an appointment notice)
    database
      .prepare(
        `INSERT INTO document_template_assignments (department_id, service_key, template_id, updated_by, updated_at) VALUES ('dhiqar-governorate', 'gov-low-cost-housing', 'appointment-notice', 'legacy', ?)`
      )
      .run(new Date().toISOString())
    try {
      const reference = await submitGovRequest()
      const plan = await request(app).get(`/api/documents/requests/${reference}/plan`).set('Cookie', govClerk)
      expect(plan.body.appointmentRequired).toBe(true)
      expect(plan.body.appointment).toBeNull()
      const refused = await decide(reference)
      expect(refused.status).toBe(400)
      expect(refused.body.code).toBe('APPOINTMENT_REQUIRED')
      expect(await issuedFor(reference)).toBeUndefined()
      const status = (
        database.prepare('SELECT status FROM service_requests WHERE reference = ?').get(reference) as {
          status: string
        }
      ).status
      expect(status).not.toBe('APPROVED')
      const approved = await decide(reference, { appointmentDate: baghdadDate(3), appointmentTime: '10:00' })
      expect(approved.status).toBe(200)
      expect((await issuedFor(reference))?.template_id).toBe('appointment-notice')
    } finally {
      database.prepare(`DELETE FROM document_template_assignments WHERE service_key = 'gov-low-cost-housing'`).run()
    }
  }, 60_000)
})

describe('record integrity and signing keys', () => {
  let first: { reference: string; row: Row }

  it('any edit to a stored column behind a valid code makes /verify answer «invalid»', async () => {
    first = await issue()
    expect(first.row.record_mac).toMatch(/^[a-f0-9]{64}$/)
    expect((await verify(first.row.verification_id)).status).toBe(200)
    const database = await db()
    const tamper = async (column: string, value: string) => {
      database.prepare(`UPDATE issued_documents SET ${column} = ? WHERE id = ?`).run(value, first.row.id)
      const response = await verify(first.row.verification_id)
      database.prepare(`UPDATE issued_documents SET ${column} = ? WHERE id = ?`).run(first.row[column], first.row.id)
      return response
    }
    // another stored file (e.g. a doctored PDF uploaded elsewhere) — not another document's PDF: pdf_media_id is
    // UNIQUE, and `LIMIT 1` alone walks the random-UUID key order, so it sometimes picked one (a flaky failure)
    const otherMedia = (
      database
        .prepare(
          `SELECT id FROM media_objects WHERE id != ?
             AND id NOT IN (SELECT pdf_media_id FROM issued_documents WHERE pdf_media_id IS NOT NULL) LIMIT 1`
        )
        .get(first.row.pdf_media_id) as {
        id: string
      }
    ).id
    for (const [column, value] of [
      ['document_title', 'قرار تخصيص'],
      ['service_name', 'خدمة أخرى'],
      ['department_name', 'دائرة أخرى'],
      ['pdf_sha256', 'f'.repeat(64)],
      ['pdf_media_id', otherMedia],
    ]) {
      const response = await tamper(column, value)
      expect(response.status, column).toBe(404)
      expect(response.body.code, column).toBe('INVALID_CODE')
    }
    expect((await verify(first.row.verification_id)).status).toBe(200)
  }, 60_000)

  it('rotating SESSION_SECRET changes nothing; rotating the signing key keeps older documents valid', async () => {
    const { signingKeyId } = await import('../server/documents/token.ts')
    const session = process.env.SESSION_SECRET
    process.env.SESSION_SECRET = 'rotated-session-secret-after-an-incident-0123456789'
    try {
      expect((await verify(first.row.verification_id)).body.validity).toBe('VALID')
    } finally {
      process.env.SESSION_SECRET = session
    }
    process.env.DOCUMENT_SIGNING_KEY = 'document-signing-key-one-0123456789abcdef'
    try {
      const second = await issue()
      expect(second.row.signing_key_id).toBe(signingKeyId('document-signing-key-one-0123456789abcdef'))
      expect((await verify(second.row.verification_id)).body.validity).toBe('VALID')
      // documents signed with the pinned key keep verifying after an explicit key is configured
      expect((await verify(first.row.verification_id)).body.validity).toBe('VALID')
      // rotation: the old key stays accepted while it is listed as retired
      process.env.DOCUMENT_SIGNING_KEY = 'document-signing-key-two-0123456789abcdef'
      process.env.DOCUMENT_SIGNING_KEYS_RETIRED = 'document-signing-key-one-0123456789abcdef'
      expect((await verify(second.row.verification_id)).body.validity).toBe('VALID')
      delete process.env.DOCUMENT_SIGNING_KEYS_RETIRED
      expect((await verify(second.row.verification_id)).body.code).toBe('INVALID_CODE')
    } finally {
      delete process.env.DOCUMENT_SIGNING_KEY
      delete process.env.DOCUMENT_SIGNING_KEYS_RETIRED
    }
  }, 60_000)

  it('revocation notifies the citizen, shows on their side, and cannot be undone in the database', async () => {
    const path = `/api/employee/issued-documents/${first.row.id}/revoke`
    const revoked = await request(app).post(path).set('Cookie', govClerk).send({ reason: 'صدرت بالخطأ REVOKE-MARKER' })
    expect(revoked.status).toBe(200)
    const notifications = await request(app).get('/api/citizen/notifications').set('Cookie', citizen)
    const notice = (notifications.body.items as Array<{ type: string; message: string; link: string }>).find(
      item => item.type === 'DOCUMENT_REVOKED'
    )
    expect(notice?.message).toContain('REVOKE-MARKER')
    expect(notice?.message).toContain(first.row.document_number)
    expect(notice?.link).toContain(first.reference)
    const mine = await request(app).get('/api/citizen/issued-documents').set('Cookie', citizen)
    const doc = (mine.body as Array<{ id: string; status: string; revokedReason: string | null }>).find(
      item => item.id === first.row.id
    )
    expect(doc?.status).toBe('REVOKED')
    expect(doc?.revokedReason).toContain('REVOKE-MARKER')
    const detail = await request(app).get(`/api/citizen/service-requests/${first.reference}`).set('Cookie', citizen)
    expect(detail.body.currentAction).toContain('REVOKE-MARKER')
    expect((await verify(first.row.verification_id)).body.validity).toBe('REVOKED')
    // un-revoking directly in the database breaks the record seal
    ;(await db()).prepare(`UPDATE issued_documents SET status = 'ACTIVE' WHERE id = ?`).run(first.row.id)
    const forged = await verify(first.row.verification_id)
    expect(forged.status).toBe(404)
    expect(forged.body.code).toBe('INVALID_CODE')
  }, 60_000)
})

describe('issued documents register', () => {
  it('searches the whole register server-side and pages through it', async () => {
    const all = (await db())
      .prepare('SELECT document_number FROM issued_documents ORDER BY issued_at ASC')
      .all() as Array<{
      document_number: string
    }>
    expect(all.length).toBeGreaterThanOrEqual(3)
    const oldest = all[0].document_number
    const found = await request(app)
      .get(`/api/employee/issued-documents?q=${encodeURIComponent(oldest)}&limit=1`)
      .set('Cookie', admin)
    expect(found.status).toBe(200)
    expect(found.body.map((item: { documentNumber: string }) => item.documentNumber)).toEqual([oldest])
    const page1 = await request(app).get('/api/employee/issued-documents?limit=1').set('Cookie', govClerk)
    const page2 = await request(app).get('/api/employee/issued-documents?limit=1&offset=1').set('Cookie', govClerk)
    expect(page1.body).toHaveLength(1)
    expect(page2.body).toHaveLength(1)
    expect(page1.body[0].id).not.toBe(page2.body[0].id)
    const wildcard = await request(app).get('/api/employee/issued-documents?q=%25').set('Cookie', admin)
    expect(wildcard.status).toBe(200)
    expect(wildcard.body).toEqual([])
  })
})
