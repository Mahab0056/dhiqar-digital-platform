import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { db } from './db.js'

const OTPIQ_BASE_URL = 'https://api.otpiq.com/api'
const OTP_TTL_MINUTES = 5
const OTP_MAX_ATTEMPTS = 5
const OTP_PHONE_LIMIT = 5
const OTP_IP_LIMIT = 15
const OTP_RATE_WINDOW_MINUTES = 10

function otpSecret() {
  const secret = process.env.OTP_HASH_SECRET?.trim() || process.env.MEDIA_ENCRYPTION_KEY?.trim()
  if (!secret) throw new Error('OTP_HASH_SECRET is required.')
  return secret
}

function digest(value: string) {
  return createHmac('sha256', otpSecret()).update(value).digest('hex')
}

function safeEqualHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export function normalizeIraqiPhone(input: string) {
  let digits = input.replace(/\D/g, '')
  if (digits.startsWith('00964')) digits = digits.slice(2)
  if (digits.startsWith('07')) digits = `964${digits.slice(1)}`
  if (!/^9647\d{9}$/.test(digits)) {
    throw new Error('أدخل رقم هاتف عراقي صحيح بصيغة 07XXXXXXXXX أو 9647XXXXXXXXX.')
  }
  return digits
}

function maskPhone(phone: string) {
  return `${phone.slice(0, 6)}***${phone.slice(-4)}`
}

function hashCode(challengeId: string, phone: string, code: string) {
  return digest(`${challengeId}:${phone}:${code}`)
}

function rateLimitCount(column: 'phone_hash' | 'created_ip_hash', value: string) {
  const since = new Date(Date.now() - OTP_RATE_WINDOW_MINUTES * 60 * 1000).toISOString()
  return (
    db
      .prepare(`SELECT COUNT(*) AS count FROM otp_challenges WHERE ${column} = ? AND created_at >= ?`)
      .get(value, since) as { count: number }
  ).count
}

export async function createOtpChallenge(input: { phone: string; requesterIp: string }) {
  const apiKey = process.env.OTPIQ_API_KEY?.trim()
  if (!apiKey) throw new Error('خدمة OTP غير مهيأة حالياً.')

  const phone = normalizeIraqiPhone(input.phone)
  const challengeId = `otp_${randomUUID().replaceAll('-', '')}`
  const code = randomInt(100000, 1000000).toString()
  const phoneHash = digest(`phone:${phone}`)
  const ipHash = digest(`ip:${input.requesterIp}`)

  if (rateLimitCount('phone_hash', phoneHash) >= OTP_PHONE_LIMIT) {
    throw new Error(`تجاوزت الحد المسموح لهذا الرقم. حاول بعد ${OTP_RATE_WINDOW_MINUTES} دقائق.`)
  }
  if (rateLimitCount('created_ip_hash', ipHash) >= OTP_IP_LIMIT) {
    throw new Error(`تجاوزت الحد المسموح من هذا الاتصال. حاول بعد ${OTP_RATE_WINDOW_MINUTES} دقائق.`)
  }

  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + OTP_TTL_MINUTES * 60 * 1000)
  db.prepare(
    `
    INSERT INTO otp_challenges (
      id, phone_hash, phone_masked, code_hash, delivery_status, attempts,
      max_attempts, expires_at, created_ip_hash, created_at
    ) VALUES (?, ?, ?, ?, 'REQUESTED', 0, ?, ?, ?, ?)
  `
  ).run(
    challengeId,
    phoneHash,
    maskPhone(phone),
    hashCode(challengeId, phone, code),
    OTP_MAX_ATTEMPTS,
    expiresAt.toISOString(),
    ipHash,
    createdAt.toISOString()
  )

  const webhookSecret = process.env.OTPIQ_WEBHOOK_SECRET?.trim()
  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '')
  const deliveryReport =
    webhookSecret && publicBaseUrl
      ? {
          webhookUrl: `${publicBaseUrl}/api/webhooks/otpiq`,
          deliveryReportType: 'final',
          webhookSecret,
        }
      : undefined

  const response = await fetch(`${OTPIQ_BASE_URL}/sms`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      phoneNumber: phone,
      smsType: 'verification',
      verificationCode: code,
      provider: 'whatsapp-telegram-sms',
      ...(deliveryReport ? { deliveryReport } : {}),
    }),
  })

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    db.prepare('DELETE FROM otp_challenges WHERE id = ?').run(challengeId)
    const message =
      typeof body.error === 'string'
        ? body.error
        : typeof body.message === 'string'
          ? body.message
          : 'تعذر إرسال رمز التحقق.'
    throw new Error(message)
  }

  const smsId = typeof body.smsId === 'string' ? body.smsId : typeof body.messageId === 'string' ? body.messageId : null
  db.prepare(`UPDATE otp_challenges SET sms_id = ?, delivery_status = 'SENT' WHERE id = ?`).run(smsId, challengeId)

  return {
    challengeId,
    phoneMasked: maskPhone(phone),
    expiresInSeconds: OTP_TTL_MINUTES * 60,
    deliveryStatus: 'SENT',
  }
}

export function verifyOtpChallenge(input: { challengeId: string; phone: string; otp: string }) {
  const phone = normalizeIraqiPhone(input.phone)
  const row = db
    .prepare(
      `
    SELECT id, phone_hash, code_hash, attempts, max_attempts, expires_at, verified_at
    FROM otp_challenges WHERE id = ?
  `
    )
    .get(input.challengeId) as
    | {
        id: string
        phone_hash: string
        code_hash: string
        attempts: number
        max_attempts: number
        expires_at: string
        verified_at: string | null
      }
    | undefined

  if (!row) throw new Error('طلب التحقق غير موجود أو انتهت صلاحيته.')
  if (row.verified_at) throw new Error('تم استخدام رمز التحقق مسبقاً.')
  if (new Date(row.expires_at).getTime() <= Date.now()) throw new Error('انتهت صلاحية رمز التحقق. اطلب رمزاً جديداً.')
  if (row.attempts >= row.max_attempts) throw new Error('تم تجاوز عدد المحاولات المسموح. اطلب رمزاً جديداً.')
  if (!safeEqualHex(row.phone_hash, digest(`phone:${phone}`))) throw new Error('رقم الهاتف لا يطابق طلب التحقق.')

  const candidate = hashCode(input.challengeId, phone, input.otp)
  if (!safeEqualHex(row.code_hash, candidate)) {
    db.prepare('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?').run(row.id)
    throw new Error('رمز التحقق غير صحيح.')
  }

  const verifiedAt = new Date().toISOString()
  db.prepare(`UPDATE otp_challenges SET verified_at = ?, delivery_status = 'VERIFIED' WHERE id = ?`).run(
    verifiedAt,
    row.id
  )
  return { success: true, phoneMasked: maskPhone(phone), verifiedAt, accountKey: row.phone_hash }
}

export function processOtpDeliveryWebhook(input: { secret: string | undefined; payload: unknown }) {
  const expected = process.env.OTPIQ_WEBHOOK_SECRET?.trim()
  if (!expected || !input.secret) throw new Error('Unauthorized webhook.')
  const received = Buffer.from(input.secret)
  const wanted = Buffer.from(expected)
  if (received.length !== wanted.length || !timingSafeEqual(received, wanted)) throw new Error('Unauthorized webhook.')

  const payload = input.payload as { smsId?: unknown; status?: unknown }
  if (typeof payload.smsId !== 'string' || typeof payload.status !== 'string')
    throw new Error('Invalid webhook payload.')
  db.prepare('UPDATE otp_challenges SET delivery_status = ? WHERE sms_id = ?').run(
    payload.status.toUpperCase(),
    payload.smsId
  )
  return { accepted: true }
}

export async function getOtpProjectInfo() {
  const apiKey = process.env.OTPIQ_API_KEY?.trim()
  if (!apiKey) throw new Error('OTPIQ_API_KEY is not configured.')
  const response = await fetch(`${OTPIQ_BASE_URL}/info`, { headers: { Authorization: `Bearer ${apiKey}` } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error('OTPIQ credential verification failed.')
  return body
}
