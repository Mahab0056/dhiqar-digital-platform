import { randomUUID } from 'node:crypto'
import { addAudit, db, nextReference } from '../db.js'
import { notifyCitizen, employeeWorkQueueRealtime } from '../realtime.js'
import { paymentProvider } from './providers.js'

export type PaymentIntentView = {
  id: string
  reference: string
  serviceRequestReference: string | null
  serviceKey: string
  serviceName: string
  departmentName: string
  amountIqd: number
  status: 'CREATED' | 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED'
  mode: string
  provider: string | null
  providerReference: string | null
  receiptNumber: string | null
  description: string
  paidAt: string | null
  createdAt: string
  updatedAt: string
}

const view = (row: Record<string, unknown>): PaymentIntentView => ({
  id: String(row.id),
  reference: String(row.reference),
  serviceRequestReference: row.request_reference ? String(row.request_reference) : null,
  serviceKey: String(row.service_id),
  serviceName: String(row.service_name || ''),
  departmentName: String(row.department_name || ''),
  amountIqd: Number(row.amount_iqd),
  status: String(row.status) as PaymentIntentView['status'],
  mode: String(row.mode),
  provider: row.provider ? String(row.provider) : null,
  providerReference: row.provider_reference ? String(row.provider_reference) : null,
  receiptNumber: row.receipt_number ? String(row.receipt_number) : null,
  description: String(row.description || ''),
  paidAt: row.paid_at ? String(row.paid_at) : null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
})

const select = `SELECT pi.*, sc.name AS service_name, d.name AS department_name, sr.reference AS request_reference
  FROM payment_intents pi JOIN service_catalog sc ON sc.id = pi.service_id JOIN departments d ON d.id = pi.department_id
  LEFT JOIN service_requests sr ON sr.id = pi.service_request_id`

export function getPaymentIntent(reference: string, citizenId?: number) {
  const row = db
    .prepare(`${select} WHERE pi.reference = ? ${citizenId ? 'AND pi.citizen_id = ?' : ''}`)
    .get(...(citizenId ? [reference, citizenId] : [reference])) as Record<string, unknown> | undefined
  return row ? view(row) : null
}

export function getPaymentIntentById(id: string) {
  const row = db.prepare(`${select} WHERE pi.id = ?`).get(id) as Record<string, unknown> | undefined
  return row ? view(row) : null
}

export function listPaymentsForRequest(serviceRequestId: number) {
  return (
    db.prepare(`${select} WHERE pi.service_request_id = ? ORDER BY pi.created_at DESC`).all(serviceRequestId) as Array<
      Record<string, unknown>
    >
  ).map(view)
}

/** Creates a pending payment for a service request and moves the request to PAYMENT_PENDING. */
export function createPaymentForRequest(input: {
  serviceRequestId: number
  citizenId: number
  serviceId: string
  departmentId: string
  amountIqd: number
  description: string
  requestedBy: string
}) {
  const timestamp = new Date().toISOString()
  const serial = String(nextReference('payment_intents', 'SELECT COUNT(*) AS value FROM payment_intents')).padStart(
    5,
    '0'
  )
  const reference = `PAY-${new Date().getFullYear()}-${serial}`
  const id = `pay_${randomUUID().replaceAll('-', '')}`
  const provider = paymentProvider()
  db.prepare(
    `INSERT INTO payment_intents (id, reference, citizen_id, service_id, department_id, service_request_id, amount_iqd, status, mode, provider, description, requested_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    reference,
    input.citizenId,
    input.serviceId,
    input.departmentId,
    input.serviceRequestId,
    input.amountIqd,
    provider?.mode || 'UNAVAILABLE',
    provider?.name || null,
    input.description,
    input.requestedBy,
    timestamp,
    timestamp
  )
  return getPaymentIntentById(id)!
}

/** Marks an intent paid (idempotent) and releases the linked request to the department queue. */
export function settlePayment(input: {
  intentId: string
  providerReference: string
  status: 'PAID' | 'FAILED' | 'CANCELLED'
  actor: string
}) {
  const row = db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(input.intentId) as
    Record<string, unknown> | undefined
  if (!row) return null
  if (row.status === 'PAID') return getPaymentIntentById(input.intentId)
  const timestamp = new Date().toISOString()
  if (input.status !== 'PAID') {
    db.prepare(`UPDATE payment_intents SET status = ?, provider_reference = ?, updated_at = ? WHERE id = ?`).run(
      input.status,
      input.providerReference || null,
      timestamp,
      input.intentId
    )
    return getPaymentIntentById(input.intentId)
  }
  const receipt = `RCPT-${new Date().getFullYear()}-${String(row.reference).split('-').pop()}`
  db.exec('BEGIN')
  try {
    db.prepare(
      `UPDATE payment_intents SET status = 'PAID', provider_reference = ?, receipt_number = ?, paid_at = ?, updated_at = ? WHERE id = ?`
    ).run(input.providerReference || null, receipt, timestamp, timestamp, input.intentId)
    if (row.service_request_id) {
      const request = db
        .prepare('SELECT id, reference, status, review_started_at FROM service_requests WHERE id = ?')
        .get(Number(row.service_request_id)) as Record<string, unknown> | undefined
      if (request && request.status === 'PAYMENT_PENDING') {
        const next = request.review_started_at ? 'UNDER_REVIEW' : 'SUBMITTED'
        db.prepare(
          `UPDATE service_requests SET status = ?, current_action = ?, payment_status = 'PAID', updated_at = ? WHERE id = ?`
        ).run(
          next,
          `تم سداد الرسم (إيصال ${receipt}). ${next === 'SUBMITTED' ? 'أُحيل الطلب والمستمسكات إلى الدائرة المختصة للتدقيق.' : 'استُؤنف تدقيق الطلب لدى الدائرة.'}`,
          timestamp,
          Number(request.id)
        )
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  const intent = getPaymentIntentById(input.intentId)!
  notifyCitizen({
    citizenId: Number(row.citizen_id),
    type: 'PAYMENT_CONFIRMED',
    title: 'تم تأكيد الدفع',
    message: `${intent.reference} — ${intent.amountIqd.toLocaleString('en-US')} د.ع، إيصال ${receipt}. ${intent.serviceRequestReference ? `أُحيل الطلب ${intent.serviceRequestReference} إلى ${intent.departmentName}.` : ''}`,
    link: '/citizen#my-requests',
  })
  if (intent.serviceRequestReference)
    employeeWorkQueueRealtime.publish({
      entity: 'SERVICE_REQUEST',
      action: 'UPDATED',
      reference: intent.serviceRequestReference,
      departmentId: String(row.department_id || '') || null,
    })
  addAudit({
    actor: input.actor,
    role: 'CITIZEN',
    action: 'PAYMENT_CONFIRMED',
    entityType: 'PaymentIntent',
    entityId: intent.reference,
    newValue: { amountIqd: intent.amountIqd, provider: intent.provider, receipt },
  })
  return intent
}

export function paymentsSummary() {
  const today = new Date().toISOString().slice(0, 10)
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN status = 'PAID' AND substr(paid_at, 1, 10) = ? THEN amount_iqd ELSE 0 END), 0) AS today,
              COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount_iqd ELSE 0 END), 0) AS total,
              SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending
       FROM payment_intents`
    )
    .get(today) as { today: number; total: number; pending: number }
  return { collectedToday: Number(row.today), collectedTotal: Number(row.total), pending: Number(row.pending || 0) }
}
