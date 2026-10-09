// Online payments switched off (production without PAYMENT_PROVIDER): official-fee services are paid at the
// department counter, the clerk records the receipt, and approval waits for it.
import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()
// a provider name that is neither sandbox nor configured → paymentProvider() is null, like production today
process.env.PAYMENT_PROVIDER = 'none'

let app: Express
let admin = ''
let citizen = ''
let health = ''

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])
const db = async () => (await import('../server/db.ts')).db

async function staffLogin(username: string, password: string) {
  const response = await request(app).post('/api/auth/staff/login').send({ username, password })
  expect(response.status).toBe(200)
  return cookieOf(response)
}

async function submitBirthCertificate() {
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
  const response = await req.attach('faceVideo', webm, { filename: 'face.webm', contentType: 'video/webm' })
  expect(response.status).toBe(201)
  return response
}

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
  const requested = await request(app).post('/api/onboarding/request-otp').send({ phone: '07801239201' })
  const verified = await request(app)
    .post('/api/onboarding/verify-phone')
    .send({ phone: '07801239201', challengeId: requested.body.challengeId, otp: '246810' })
  citizen = cookieOf(verified)
  ;(await db()).prepare(`UPDATE citizens SET verification_status = 'VERIFIED_MANUAL'`).run()
  const created = await request(app)
    .post('/api/super-admin/staff')
    .set('Cookie', admin)
    .send({
      username: 'office.health',
      fullName: 'Test office.health',
      role: 'EMPLOYEE',
      departmentId: 'dhiqar-health',
    })
  expect(created.status).toBe(201)
  health = await staffLogin('office.health', created.body.temporaryPassword)
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', health)
    .send({ currentPassword: created.body.temporaryPassword, newPassword: 'Rotated-office.health-2026!' })
})

describe('fees with online payments disabled', () => {
  it('the request is flagged PAY_AT_OFFICE and online fee requests are refused with a clear code', async () => {
    const config = await request(app).get('/api/payments/config')
    expect(config.body.available).toBe(false)
    const created = await submitBirthCertificate()
    expect(created.body.status).toBe('SUBMITTED')
    expect(created.body.payAtOffice).toBe(true)
    expect(created.body.feeIqd).toBe(5000)
    expect(created.body.payment).toBeNull()
    const reference = created.body.reference as string
    const online = await request(app)
      .patch(`/api/employee/service-requests/${reference}`)
      .set('Cookie', health)
      .send({ status: 'PAYMENT_REQUIRED', amountIqd: 5000 })
    expect(online.status).toBe(503)
    expect(online.body.code).toBe('ONLINE_PAYMENTS_DISABLED')
  })

  it('approval waits for the office receipt, then issues the document', async () => {
    const reference = (await submitBirthCertificate()).body.reference as string
    const view = await request(app).get(`/api/employee/service-requests/${reference}`).set('Cookie', health)
    expect(view.body.paymentStatus).toBe('PAY_AT_OFFICE')
    expect(view.body.feeIqd).toBe(5000)
    for (const item of view.body.checklist as Array<{ key: string; mediaId: string | null }>)
      if (item.mediaId)
        await request(app)
          .patch(`/api/employee/service-requests/${reference}/documents/${item.key}`)
          .set('Cookie', health)
          .send({ status: 'VERIFIED' })
    const blocked = await request(app)
      .patch(`/api/employee/service-requests/${reference}`)
      .set('Cookie', health)
      .send({ status: 'APPROVED' })
    expect(blocked.status).toBe(409)
    expect(blocked.body.code).toBe('FEE_UNPAID')
    expect(blocked.body.message).toContain('سجّل وصل الدفع في الدائرة')

    const path = `/api/employee/service-requests/${reference}/record-office-payment`
    expect(
      (await request(app).post(path).set('Cookie', health).send({ receiptNumber: '٤٥٦٧', amountIqd: 4000 })).status
    ).toBe(400)
    const recorded = await request(app)
      .post(path)
      .set('Cookie', health)
      .send({ receiptNumber: '٤٥٦٧', amountIqd: 5000 })
    expect(recorded.status).toBe(200)
    expect(recorded.body.paymentStatus).toBe('PAID')
    // Arabic-Indic digits are stored as Latin digits
    expect(recorded.body.officeReceipt).toMatchObject({ receiptNumber: '4567', amountIqd: 5000 })
    expect(recorded.body.payments[0]).toMatchObject({ status: 'PAID', provider: 'office', mode: 'OFFICE' })

    const approved = await request(app)
      .patch(`/api/employee/service-requests/${reference}`)
      .set('Cookie', health)
      .send({ status: 'APPROVED' })
    expect(approved.status).toBe(200)
    const documents = await request(app).get('/api/citizen/issued-documents').set('Cookie', citizen)
    expect(
      documents.body.some((doc: { serviceRequestReference: string }) => doc.serviceRequestReference === reference)
    ).toBe(true)
    const detail = await request(app).get(`/api/citizen/service-requests/${reference}`).set('Cookie', citizen)
    expect(detail.body.fee).toMatchObject({ amountIqd: 5000, paymentStatus: 'PAID', payAtOffice: false })
    expect(detail.body.fee.officeReceipt.receiptNumber).toBe('4567')
  })
})
