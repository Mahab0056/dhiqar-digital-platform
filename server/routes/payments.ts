import type express from 'express'
import { safeMessage } from '../http/error-handler.js'
import { z } from 'zod'
import { param } from '../http/params.js'
import { requireSession, currentCitizen } from '../auth/session.js'
import { addAudit, db } from '../db.js'
import { productionOrigin as publicBaseUrl } from '../config.js'
import { paymentProvider, sandboxAllowed } from '../payments/providers.js'
import { getPaymentIntent, getPaymentIntentById, settlePayment } from '../payments/intents.js'

export function registerPaymentRoutes(app: express.Express) {
  /** Public: which gateway is active (the UI labels sandbox/test modes honestly). */
  app.get('/api/payments/config', (_req, res) => {
    const provider = paymentProvider()
    res.json({
      available: Boolean(provider),
      provider: provider?.name || null,
      mode: provider?.mode || 'UNAVAILABLE',
      sandboxAllowed: sandboxAllowed(),
    })
  })

  app.get('/api/citizen/payments/:reference', requireSession('CITIZEN'), (req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    const intent = getPaymentIntent(param(req, 'reference'), citizen.id)
    if (!intent) return res.status(404).json({ message: 'عملية الدفع غير موجودة ضمن حسابك.' })
    res.json(intent)
  })

  /** Starts checkout with the configured provider and returns where to send the citizen. */
  app.post('/api/citizen/payments/:reference/checkout', requireSession('CITIZEN'), async (req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    const intent = getPaymentIntent(param(req, 'reference'), citizen.id)
    if (!intent) return res.status(404).json({ message: 'عملية الدفع غير موجودة ضمن حسابك.' })
    if (intent.status === 'PAID') return res.status(409).json({ message: 'هذا الرسم مسدد مسبقاً.', intent })
    const provider = paymentProvider()
    if (!provider)
      return res.status(503).json({
        message: 'بوابة الدفع الإلكتروني غير مفعّلة بعد. راجع الدائرة لسداد الرسم يدوياً أو انتظر تفعيل البوابة.',
      })
    try {
      const checkout = await provider.createCheckout({
        intentId: intent.id,
        reference: intent.reference,
        amountIqd: intent.amountIqd,
        description: `${intent.serviceName} — ${intent.reference}`,
        redirectUrl: `${publicBaseUrl}/api/payments/return/${provider.name}`,
      })
      db.prepare(
        `UPDATE payment_intents SET provider = ?, mode = ?, provider_reference = ?, checkout_url = ?, updated_at = ? WHERE id = ?`
      ).run(
        checkout.provider,
        checkout.mode,
        checkout.providerReference,
        checkout.checkoutUrl,
        new Date().toISOString(),
        intent.id
      )
      res.json({ checkoutUrl: checkout.checkoutUrl, mode: checkout.mode, provider: checkout.provider })
    } catch (error) {
      res.status(502).json({ message: safeMessage(error, 'تعذر بدء عملية الدفع.') })
    }
  })

  /** Sandbox confirmation — the citizen "pays" on an internal page. Never moves money. */
  app.post('/api/citizen/payments/:reference/sandbox-confirm', requireSession('CITIZEN'), (req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    const provider = paymentProvider()
    if (!provider || provider.name !== 'sandbox')
      return res.status(403).json({ message: 'وضع الدفع التجريبي غير مفعّل.' })
    const intent = getPaymentIntent(param(req, 'reference'), citizen.id)
    if (!intent) return res.status(404).json({ message: 'عملية الدفع غير موجودة ضمن حسابك.' })
    const payload = z.object({ outcome: z.enum(['PAID', 'FAILED', 'CANCELLED']).default('PAID') }).parse(req.body || {})
    const result = provider.parseCallback({ intentId: intent.id, outcome: payload.outcome })
    const settled = settlePayment({
      intentId: intent.id,
      providerReference: result.providerReference,
      status: result.status,
      actor: citizen.fullName,
    })
    res.json(settled)
  })

  /** Provider return URL (browser redirect after paying). Verifies the signed token, settles, redirects to the app. */
  app.get('/api/payments/return/:provider', (req, res) => {
    const provider = paymentProvider()
    const name = param(req, 'provider')
    if (!provider || provider.name !== name) return res.redirect('/citizen?payment=unavailable')
    // the sandbox settles only through the authenticated sandbox-confirm route — never via an open GET
    if (provider.name === 'sandbox') return res.redirect('/citizen?payment=invalid')
    const result = provider.parseCallback(req.query as Record<string, unknown>)
    if (!result.ok || !result.intentId) return res.redirect('/citizen?payment=invalid')
    const intent = getPaymentIntentById(result.intentId)
    if (!intent) return res.redirect('/citizen?payment=invalid')
    // the signed callback must match the intent we created: same gateway transaction, same amount, not expired
    const claims = result.raw || {}
    const claimedAmount = Number(claims.amount ?? intent.amountIqd)
    const exp = Number(claims.exp || 0)
    if (
      (intent.providerReference && result.providerReference && intent.providerReference !== result.providerReference) ||
      (Number.isFinite(claimedAmount) && Math.round(claimedAmount) !== Math.round(intent.amountIqd)) ||
      (exp && exp * 1000 < Date.now())
    ) {
      addAudit({
        actor: 'payment-gateway',
        role: 'SYSTEM',
        action: 'PAYMENT_CALLBACK_REJECTED',
        entityType: 'PaymentIntent',
        entityId: intent.reference,
        metadata: { providerReference: result.providerReference, claimedAmount, exp },
      })
      return res.redirect(`/citizen/pay/${encodeURIComponent(intent.reference)}?result=invalid`)
    }
    settlePayment({
      intentId: intent.id,
      providerReference: result.providerReference,
      status: result.status,
      actor: 'payment-gateway',
    })
    res.redirect(`/citizen/pay/${encodeURIComponent(intent.reference)}?result=${result.status.toLowerCase()}`)
  })
}
