// Public verification of decisions that are not approvals, and the revocation notice.
// - /api/verify answered «APPROVED» for a reasoned rejection decision: it now exposes a neutral validity
//   («سارية/ملغاة/منتهية») and the document's kind, and never labels a rejection «معتمد/موافقة».
// - The revocation notice said «ألغت ديوان محافظة ذي قار…» (a feminine verb for every department): it is now passive.
// - The citizen's archive lists the rejection decision under «قرارات ومراسلات», not as a certified document.
import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import type { IssuedDocument } from '../src/types'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()
process.env.PAYMENT_PROVIDER = 'none'

let app: Express
let admin = ''
let citizen = ''
let clerk = ''

const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)])
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])
const db = async () => (await import('../server/db.ts')).db
type Row = Record<string, string>

const DEPARTMENT_NAME = 'ديوان محافظة ذي قار'

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

async function decide(reference: string, body: Record<string, unknown>) {
  const view = await request(app).get(`/api/employee/service-requests/${reference}`).set('Cookie', clerk)
  for (const item of view.body.checklist as Array<{ key: string; mediaId: string | null; status: string }>) {
    if (!item.mediaId || item.status === 'VERIFIED') continue
    await request(app)
      .patch(`/api/employee/service-requests/${reference}/documents/${item.key}`)
      .set('Cookie', clerk)
      .send({ status: 'VERIFIED' })
  }
  const decided = await request(app)
    .patch(`/api/employee/service-requests/${reference}`)
    .set('Cookie', clerk)
    .send(body)
  expect(decided.status).toBe(200)
  return decided
}

const verify = (code: string) => request(app).get(`/api/verify/${encodeURIComponent(code)}`)
const APPROVAL_WORDS = /معتمد|موافقة|اعتماد/

beforeAll(async () => {
  const { resetPaymentProviderCache } = await import('../server/payments/providers.ts')
  resetPaymentProviderCache()
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  admin = await staffLogin('admin', 'Bootstrap-Admin-Pass-2026!')
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', admin)
    .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Admin-Rotated-Pass-2026!' })
  admin = await staffLogin('admin', 'Admin-Rotated-Pass-2026!')
  const requested = await request(app).post('/api/onboarding/request-otp').send({ phone: '07801239455' })
  const verified = await request(app)
    .post('/api/onboarding/verify-phone')
    .send({ phone: '07801239455', challengeId: requested.body.challengeId, otp: '246810' })
  citizen = cookieOf(verified)
  ;(await db())
    .prepare(`UPDATE citizens SET verification_status = 'VERIFIED_MANUAL', national_id_masked = '199012345678 4821'`)
    .run()
  clerk = await createStaff('fd.gov.clerk', 'dhiqar-governorate')
}, 120_000)

describe('verify labels (server/documents/verify-labels.ts)', () => {
  it('derives the kind from the issuing step, and keeps «APPROVED» for approval documents only', async () => {
    const { documentKindOf, documentKindLabels, validityLabels, verificationStatusOf } =
      await import('../server/documents/verify-labels.ts')
    expect(documentKindOf(null)).toBe('APPROVAL')
    expect(documentKindOf('REJECTION')).toBe('REJECTION')
    expect(documentKindOf('REFERRAL')).toBe('REFERRAL')
    expect(documentKindOf('RECEIPT')).toBe('RECEIPT')
    expect(documentKindOf(null, 'rejection-decision')).toBe('REJECTION')
    expect(validityLabels).toEqual({ VALID: 'سارية', EXPIRED: 'منتهية', REVOKED: 'ملغاة' })
    for (const kind of ['REJECTION', 'REFERRAL', 'RECEIPT'] as const) {
      expect(documentKindLabels[kind]).not.toMatch(APPROVAL_WORDS)
      expect(verificationStatusOf(kind, 'VALID')).toBe('ISSUED')
      expect(verificationStatusOf(kind, 'EXPIRED')).toBe('ISSUED')
      expect(verificationStatusOf(kind, 'REVOKED')).toBe('REVOKED')
    }
    expect(verificationStatusOf('APPROVAL', 'VALID')).toBe('APPROVED')
    expect(verificationStatusOf('APPROVAL', 'REVOKED')).toBe('REVOKED')
  })
})

describe('a rejection decision on the public verify page', () => {
  let reference = ''
  let rejection: Row

  it('is «سارية» and a «قرار رفض» — never APPROVED / معتمد / موافقة', async () => {
    reference = await submitGovRequest()
    await decide(reference, { status: 'REJECTED', decisionNote: 'المتقدم غير مشمول بفئات الاستحقاق المحددة' })
    rejection = (await db())
      .prepare(`SELECT * FROM issued_documents WHERE related_reference = ? AND issue_event = 'REJECTION'`)
      .get(reference) as Row
    expect(rejection).toBeTruthy()
    const checked = await verify(rejection.verification_id)
    expect(checked.status).toBe(200)
    expect(checked.body).toMatchObject({
      reference,
      validity: 'VALID',
      validityLabel: 'سارية',
      documentKind: 'REJECTION',
      documentKindLabel: 'قرار رفض',
      templateTitle: 'قرار رفض مسبّب',
    })
    expect(checked.body.status).not.toBe('APPROVED')
    for (const label of [checked.body.status, checked.body.validityLabel, checked.body.documentKindLabel])
      expect(String(label)).not.toMatch(APPROVAL_WORDS)
  })

  it('an approval document still verifies as APPROVED / «وثيقة معتمدة» / «سارية»', async () => {
    const approvedReference = await submitGovRequest()
    await decide(approvedReference, { status: 'APPROVED' })
    const approval = (await db())
      .prepare('SELECT verification_id FROM issued_documents WHERE service_request_reference = ?')
      .get(approvedReference) as Row
    const checked = await verify(approval.verification_id)
    expect(checked.body).toMatchObject({
      status: 'APPROVED',
      validity: 'VALID',
      validityLabel: 'سارية',
      documentKind: 'APPROVAL',
      documentKindLabel: 'وثيقة معتمدة',
    })
  })

  it('the citizen archive marks it as a decision, not an approval document', async () => {
    const { groupCitizenDocuments } = await import('../src/components/citizen/citizen-documents.ts')
    const archive = await request(app).get('/api/citizen/issued-documents').set('Cookie', citizen)
    expect(archive.status).toBe(200)
    const groups = groupCitizenDocuments(archive.body as IssuedDocument[])
    expect(groups.correspondence.map(item => item.id)).toContain(rejection.id)
    expect(groups.approvals.map(item => item.id)).not.toContain(rejection.id)
    expect(groups.approvals).toHaveLength(1)
  })

  it('revoked: «ملغاة», and the notice is passive — «أُلغيت الوثيقة … من قِبل ديوان…», never «ألغت»', async () => {
    const revoked = await request(app)
      .post(`/api/employee/issued-documents/${rejection.id}/revoke`)
      .set('Cookie', clerk)
      .send({ reason: 'أُعيد النظر في القرار' })
    expect(revoked.status).toBe(200)
    const checked = await verify(rejection.verification_id)
    expect(checked.body).toMatchObject({ status: 'REVOKED', validity: 'REVOKED', validityLabel: 'ملغاة' })
    const notifications = await request(app).get('/api/citizen/notifications').set('Cookie', citizen)
    const notice = (notifications.body.items as Array<{ type?: string; message: string }>).find(item =>
      item.message.includes(rejection.document_number)
    )
    expect(notice?.message).toContain(
      `أُلغيت الوثيقة ${rejection.document_number} (${rejection.document_title}) من قِبل ${DEPARTMENT_NAME}`
    )
    expect(notice?.message).toContain('السبب: أُعيد النظر في القرار')
    expect(notice?.message).not.toContain('ألغت')
  })

  it('an approval document revoked: the request line uses the same passive wording', async () => {
    const approvedReference = await submitGovRequest()
    await decide(approvedReference, { status: 'APPROVED' })
    const approval = (await db())
      .prepare('SELECT id, document_number FROM issued_documents WHERE service_request_reference = ?')
      .get(approvedReference) as Row
    const revoked = await request(app)
      .post(`/api/employee/issued-documents/${approval.id}/revoke`)
      .set('Cookie', clerk)
      .send({ reason: 'خطأ في بيانات الوثيقة' })
    expect(revoked.status).toBe(200)
    const line = (
      (await db())
        .prepare('SELECT current_action FROM service_requests WHERE reference = ?')
        .get(approvedReference) as Row
    ).current_action
    expect(line.startsWith(`أُلغيت الوثيقة ${approval.document_number}`)).toBe(true)
    expect(line).toContain(`من قِبل ${DEPARTMENT_NAME}`)
    expect(line).not.toContain('ألغت')
  })
})
