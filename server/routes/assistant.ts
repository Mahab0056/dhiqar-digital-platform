import type express from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { currentSession, readSession, requireSession } from '../auth/session.js'
import { addAudit } from '../db.js'
import { param } from '../http/params.js'
import { runChat, type ChatEvent } from '../assistant/chat.js'
import {
  apiKeyConfigured,
  assistantModel,
  chatEffort,
  dailyTokenLimit,
  documentReviewEnabled,
  getAssistantClient,
} from '../assistant/client.js'
import { canReview, loadReviewRow, runReview } from '../assistant/review.js'
import { ensureAssistantTables, latestAiReview, saveAiReview, usageSummary } from '../assistant/store.js'

const testsWithoutLimits = () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_ENABLED !== 'true'

/** 30 messages per 10 minutes per session (signed in) or per IP (visitors). */
export const assistantChatLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: testsWithoutLimits,
  keyGenerator: req => {
    const session = readSession(req)
    return session ? `sid:${session.sid}` : `ip:${ipKeyGenerator(req.ip || '')}`
  },
  message: { message: 'أرسلت رسائل كثيرة للمساعد خلال وقت قصير. انتظر بضع دقائق ثم أعد المحاولة.' },
})

const reviewLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: testsWithoutLimits,
  keyGenerator: req => `staff:${readSession(req)?.sid || ipKeyGenerator(req.ip || '')}`,
  message: { message: 'طلبات تدقيق ذكي كثيرة. انتظر قليلاً ثم أعد المحاولة.' },
})

const chatBody = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }))
    .min(1)
    .max(40),
})

const assistantMode = () => (getAssistantClient() ? 'ai' : 'fallback')

export function registerAssistantRoutes(app: express.Express) {
  ensureAssistantTables()

  /** Public: which mode the widget runs in (no secrets). */
  app.get('/api/assistant/config', (req, res) => {
    const session = readSession(req)
    res.json({ mode: assistantMode(), signedIn: session?.role === 'CITIZEN', name: 'أفندي — مساعد ذي قار' })
  })

  /** Citizen chat, streamed as Server-Sent Events. Conversation state is held by the browser and capped here. */
  app.post('/api/assistant/chat', assistantChatLimiter, async (req, res) => {
    const parsed = chatBody.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: 'رسالة غير صالحة للمساعد.' })
    const last = parsed.data.messages[parsed.data.messages.length - 1]
    if (last.role !== 'user' || !last.text.trim()) return res.status(400).json({ message: 'اكتب سؤالك للمساعد أولاً.' })
    const session = readSession(req)
    const citizenId = session?.role === 'CITIZEN' ? Number(session.citizenId ?? session.sub) : null

    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    // no-transform keeps the compression middleware from buffering the stream
    res.setHeader('Cache-Control', 'no-store, no-transform')
    res.setHeader('X-Accel-Buffering', 'no')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) controller.abort()
    })
    const send = (event: ChatEvent) => {
      if (res.writableEnded || controller.signal.aborted) return
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    try {
      await runChat({
        history: parsed.data.messages,
        context: { citizenId: citizenId && Number.isSafeInteger(citizenId) && citizenId > 0 ? citizenId : null },
        client: getAssistantClient(),
        send,
        signal: controller.signal,
      })
    } catch (error) {
      console.error('[assistant] chat failed', error)
      send({ type: 'error', message: 'حدث خطأ في المساعد. حاول مرة ثانية.' })
      send({ type: 'done' })
    }
    if (!res.writableEnded) res.end()
  })

  /** Super admin: configuration and cost visibility. */
  app.get('/api/assistant/status', requireSession('SUPER_ADMIN'), (_req, res) => {
    res.json({
      mode: assistantMode(),
      keyConfigured: apiKeyConfigured(),
      disabled: process.env.ASSISTANT_DISABLED?.trim().toLowerCase() === 'true',
      model: assistantModel(),
      documentReview: documentReviewEnabled(),
      dailyTokenLimit: dailyTokenLimit(),
      effort: { chat: chatEffort(), review: 'medium' },
      usage: usageSummary(),
    })
  })

  // ---- staff: AI pre-check of one request ---------------------------------------------------------------
  app.get(
    '/api/employee/service-requests/:reference/ai-review',
    requireSession('EMPLOYEE', 'SUPER_ADMIN'),
    (req, res) => {
      const session = currentSession(res)
      const row = loadReviewRow(param(req, 'reference'))
      if (!row) return res.status(404).json({ message: 'طلب الخدمة غير موجود.' })
      if (!canReview(session, row)) return res.status(403).json({ message: 'هذا الطلب يخص دائرة أخرى.' })
      res.json({
        review: latestAiReview(Number(row.id)),
        mode: assistantMode(),
        documentReview: documentReviewEnabled(),
      })
    }
  )

  app.post(
    '/api/employee/service-requests/:reference/ai-review',
    requireSession('EMPLOYEE', 'SUPER_ADMIN'),
    reviewLimiter,
    async (req, res) => {
      const session = currentSession(res)
      const row = loadReviewRow(param(req, 'reference'))
      if (!row) return res.status(404).json({ message: 'طلب الخدمة غير موجود.' })
      if (!canReview(session, row)) return res.status(403).json({ message: 'هذا الطلب يخص دائرة أخرى.' })
      const result = await runReview({ row, session, client: getAssistantClient() })
      const id = saveAiReview({
        serviceRequestId: Number(row.id),
        reference: String(row.reference),
        verdict: result.verdict,
        result,
        source: result.source,
        model: result.model,
        documentsSent: result.documentsSent,
        requestedBy: session.actor,
        createdAt: result.createdAt,
      })
      addAudit({
        actor: session.actor,
        role: session.role,
        action: 'SERVICE_REQUEST_AI_REVIEW',
        entityType: 'ServiceRequest',
        entityId: String(row.reference),
        newValue: { verdict: result.verdict, missingItems: result.missingItems.length },
        metadata: { reviewId: id, source: result.source, model: result.model, documentsSent: result.documentsSent },
      })
      res.json({ review: { id, ...result }, mode: assistantMode(), documentReview: result.documentReview })
    }
  )
}
