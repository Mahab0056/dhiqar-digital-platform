// A fee paid online issues the same QR-verifiable «وصل استلام» as one paid at the department counter: once the
// gateway settlement returns PAID (here the sandbox provider), once per payment, and never for a failed attempt.
import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()
process.env.PAYMENT_PROVIDER = 'sandbox'

let app: Express
let citizen = ''

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])
const db = async () => (await import('../server/db.ts')).db

async function citizenSession(phone: string) {
  const requested = await request(app).post('/api/onboarding/request-otp').send({ phone })
  const verified = await request(app)
    .post('/api/onboarding/verify-phone')
    .send({ phone, challengeId: requested.body.challengeId, otp: '246810' })
  return cookieOf(verified)
}

/** A birth certificate request: an official fee, so it waits for payment (PAYMENT_PENDING) with an online intent. */
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
  expect(response.body.status).toBe('PAYMENT_PENDING')
  expect(response.body.payment?.reference).toBeTruthy()
  return response.body as { reference: string; payment: { reference: string; amountIqd: number } }
}

const receipts = async (reference: string) =>
  (await db())
    .prepare(
      `SELECT * FROM issued_documents WHERE related_reference = ? AND issue_event = 'RECEIPT' ORDER BY issued_at`
    )
    .all(reference) as Array<Record<string, string>>

const confirm = (paymentReference: string, outcome: 'PAID' | 'FAILED' | 'CANCELLED') =>
  request(app)
    .post(`/api/citizen/payments/${encodeURIComponent(paymentReference)}/sandbox-confirm`)
    .set('Cookie', citizen)
    .send({ outcome })

beforeAll(async () => {
  const { resetPaymentProviderCache } = await import('../server/payments/providers.ts')
  resetPaymentProviderCache()
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  citizen = await citizenSession('07801239301')
  ;(await db()).prepare(`UPDATE citizens SET verification_status = 'VERIFIED_MANUAL'`).run()
})

describe('online fee receipt', () => {
  it('a failed attempt issues nothing; the PAID settlement issues «وصل استلام» once', async () => {
    const created = await submitBirthCertificate()
    const { reference, payment } = created

    const failed = await confirm(payment.reference, 'FAILED')
    expect(failed.status).toBe(200)
    expect(failed.body.status).toBe('FAILED')
    expect(await receipts(reference)).toHaveLength(0)

    const paid = await confirm(payment.reference, 'PAID')
    expect(paid.status).toBe(200)
    expect(paid.body.status).toBe('PAID')
    const [receipt, ...more] = await receipts(reference)
    expect(more).toHaveLength(0)
    expect(receipt).toMatchObject({ template_id: 'receipt', department_id: 'dhiqar-health', status: 'ACTIVE' })
    expect(receipt.event_key).toBe(`SR:${reference}:RECEIPT:${String(paid.body.id)}`)
    // the platform issues it on the gateway's confirmation, not the citizen
    expect(receipt.issued_by).toBe('payment-gateway')

    // a repeated settlement (gateway retry, double click) does not issue a second receipt
    expect((await confirm(payment.reference, 'PAID')).status).toBe(200)
    expect(await receipts(reference)).toHaveLength(1)

    // the citizen sees it on the request page whatever the status, and in the archive
    const detail = await request(app).get(`/api/citizen/service-requests/${reference}`).set('Cookie', citizen)
    expect(detail.status).toBe(200)
    expect(detail.body.status).not.toBe('APPROVED')
    expect(detail.body.issuedDocuments).toEqual([])
    expect(detail.body.eventDocuments).toEqual([
      expect.objectContaining({ id: receipt.id, issueEvent: 'RECEIPT', status: 'ACTIVE' }),
    ])
    const pdf = await request(app).get(detail.body.eventDocuments[0].pdfUrl).set('Cookie', citizen)
    expect(pdf.status).toBe(200)
    expect(pdf.headers['content-type']).toContain('application/pdf')
    const verified = await request(app).get(`/api/verify/${encodeURIComponent(receipt.verification_id)}`)
    expect(verified.status).toBe(200)
    expect(verified.body.validity).toBe('VALID')
  })

  it('the issueFeeReceipt helper stays idempotent for an online payment', async () => {
    const { reference, payment } = await submitBirthCertificate()
    const paid = await confirm(payment.reference, 'PAID')
    expect(paid.body.status).toBe('PAID')
    const [receipt] = await receipts(reference)
    const { issueFeeReceipt } = await import('../server/routes/service-requests.ts')
    expect((await issueFeeReceipt(reference, String(paid.body.id), 'retry'))?.id).toBe(receipt.id)
    expect(await receipts(reference)).toHaveLength(1)
  })
})
