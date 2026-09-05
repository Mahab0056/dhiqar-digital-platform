import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Payment provider abstraction.
 *
 * - `sandbox`: no money moves. Only active outside production, or when
 *   PAYMENT_SANDBOX_ALLOWED=true is set explicitly (for a supervised pilot demo).
 * - `zaincash`: ZainCash merchant API (JWT HS256, /transaction/init → /transaction/pay → redirect with token).
 *   Requires ZAINCASH_MERCHANT_ID, ZAINCASH_SECRET, ZAINCASH_MSISDN; ZAINCASH_TEST=true uses test.zaincash.iq.
 *
 * Adding another gateway (Qi Card / FIB / AsiaHawala) = implement PaymentProvider and register it below.
 */
export type CheckoutInput = {
  intentId: string
  reference: string
  amountIqd: number
  description: string
  redirectUrl: string
}

export type CheckoutResult = {
  provider: string
  providerReference: string
  checkoutUrl: string
  mode: 'SANDBOX' | 'LIVE' | 'TEST'
}

export type CallbackResult = {
  ok: boolean
  status: 'PAID' | 'FAILED' | 'CANCELLED'
  providerReference: string
  intentId: string | null
  raw?: Record<string, unknown>
}

export interface PaymentProvider {
  readonly name: string
  readonly mode: 'SANDBOX' | 'LIVE' | 'TEST'
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>
  /** Parses the provider's return/callback payload (query or body). */
  parseCallback(payload: Record<string, unknown>): CallbackResult
}

// ---- minimal HS256 JWT (no dependency) -----------------------------------------------------
const base64url = (value: Buffer | string) =>
  Buffer.from(value).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')

export function signJwtHs256(payload: Record<string, unknown>, secret: string) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const signature = base64url(createHmac('sha256', secret).update(`${header}.${body}`).digest())
  return `${header}.${body}.${signature}`
}

export function verifyJwtHs256(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, signature] = parts
  const expected = base64url(createHmac('sha256', secret).update(`${header}.${body}`).digest())
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  try {
    return JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  } catch {
    return null
  }
}

// ---- sandbox ------------------------------------------------------------------------------
class SandboxProvider implements PaymentProvider {
  readonly name = 'sandbox'
  readonly mode = 'SANDBOX' as const
  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    return {
      provider: this.name,
      providerReference: `sbx_${input.intentId}`,
      checkoutUrl: `/citizen/pay/${encodeURIComponent(input.reference)}/sandbox`,
      mode: 'SANDBOX',
    }
  }
  parseCallback(payload: Record<string, unknown>): CallbackResult {
    const intentId = String(payload.intentId || '')
    const outcome = String(payload.outcome || 'PAID')
    return {
      ok: Boolean(intentId),
      status: outcome === 'FAILED' ? 'FAILED' : outcome === 'CANCELLED' ? 'CANCELLED' : 'PAID',
      providerReference: `sbx_${intentId}`,
      intentId: intentId || null,
    }
  }
}

// ---- ZainCash -----------------------------------------------------------------------------
class ZainCashProvider implements PaymentProvider {
  readonly name = 'zaincash'
  readonly mode: 'LIVE' | 'TEST'
  private readonly base: string
  private readonly merchantId: string
  private readonly secret: string
  private readonly msisdn: string
  constructor(merchantId: string, secret: string, msisdn: string, test: boolean) {
    this.merchantId = merchantId
    this.secret = secret
    this.msisdn = msisdn
    this.mode = test ? 'TEST' : 'LIVE'
    this.base = test ? 'https://test.zaincash.iq' : 'https://api.zaincash.iq'
  }
  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const now = Math.floor(Date.now() / 1000)
    const token = signJwtHs256(
      {
        amount: input.amountIqd,
        serviceType: input.description.slice(0, 100),
        msisdn: this.msisdn,
        orderId: input.intentId,
        redirectUrl: input.redirectUrl,
        iat: now,
        exp: now + 60 * 60 * 4,
      },
      this.secret
    )
    const response = await fetch(`${this.base}/transaction/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, merchantId: this.merchantId, lang: 'ar' }),
    })
    const body = (await response.json().catch(() => ({}))) as { id?: string; err?: { msg?: string } }
    if (!response.ok || !body.id) throw new Error(body.err?.msg || 'تعذر إنشاء عملية الدفع لدى ZainCash.')
    return {
      provider: this.name,
      providerReference: body.id,
      checkoutUrl: `${this.base}/transaction/pay?id=${encodeURIComponent(body.id)}`,
      mode: this.mode,
    }
  }
  parseCallback(payload: Record<string, unknown>): CallbackResult {
    const token = String(payload.token || '')
    const claims = token ? verifyJwtHs256(token, this.secret) : null
    if (!claims) return { ok: false, status: 'FAILED', providerReference: '', intentId: null }
    const status = String(claims.status || '')
    return {
      ok: true,
      status: status === 'success' ? 'PAID' : status === 'failed' ? 'FAILED' : 'CANCELLED',
      providerReference: String(claims.id || ''),
      intentId: claims.orderid ? String(claims.orderid) : null,
      raw: claims,
    }
  }
}

export function sandboxAllowed() {
  return process.env.NODE_ENV !== 'production' || process.env.PAYMENT_SANDBOX_ALLOWED === 'true'
}

let cached: PaymentProvider | null | undefined

/** Returns the configured provider, or null when payments cannot be taken (no gateway and sandbox not allowed). */
export function paymentProvider(): PaymentProvider | null {
  if (cached !== undefined) return cached
  const selected = (process.env.PAYMENT_PROVIDER || '').trim().toLowerCase()
  if (selected === 'zaincash') {
    const merchantId = process.env.ZAINCASH_MERCHANT_ID?.trim()
    const secret = process.env.ZAINCASH_SECRET?.trim()
    const msisdn = process.env.ZAINCASH_MSISDN?.trim()
    if (merchantId && secret && msisdn) {
      cached = new ZainCashProvider(merchantId, secret, msisdn, process.env.ZAINCASH_TEST === 'true')
      return cached
    }
    console.warn('[payments] PAYMENT_PROVIDER=zaincash but ZAINCASH_* variables are incomplete.')
  }
  cached =
    selected === 'sandbox' || (!selected && sandboxAllowed()) ? (sandboxAllowed() ? new SandboxProvider() : null) : null
  return cached
}

export function resetPaymentProviderCache() {
  cached = undefined
}
