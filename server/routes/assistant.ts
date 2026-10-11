import type express from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import multer from 'multer'
import { z } from 'zod'
import { currentSession, readSession, requireSession } from '../auth/session.js'
import { addAudit } from '../db.js'
import { param } from '../http/params.js'
import { uploadBudget } from '../http/upload.js'
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
import {
  ensureAssistantTables,
  latestAiReview,
  recordVoiceUsage,
  saveAiReview,
  usageSummary,
  voiceUsageToday,
} from '../assistant/store.js'
import {
  ACCEPTED_AUDIO,
  audioDurationMs,
  dailyTranscribeLimit,
  getSpeechProvider,
  looksLikeAudio,
  serverTtsEnabled,
  SpeechProviderError,
  VOICE_LIMITS,
  voiceConfig,
} from '../assistant/speech.js'

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

/** 20 voice clips per 10 minutes per session / IP: every clip costs a paid transcription. */
export const assistantVoiceLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: testsWithoutLimits,
  keyGenerator: req => {
    const session = readSession(req)
    return session ? `voice-sid:${session.sid}` : `voice-ip:${ipKeyGenerator(req.ip || '')}`
  },
  message: { message: 'استعملت الصوت كثيراً خلال وقت قصير. انتظر بضع دقائق أو اكتب سؤالك.' },
})

/**
 * The optional server voice is fetched once per spoken sentence (3–6 per answer), so it has its own, larger budget:
 * sharing the clip limiter silenced أفندي after about four answers.
 */
export const assistantSpeakLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 150,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: testsWithoutLimits,
  keyGenerator: req => {
    const session = readSession(req)
    return session ? `speak-sid:${session.sid}` : `speak-ip:${ipKeyGenerator(req.ip || '')}`
  },
  message: { message: 'استعملت الصوت كثيراً خلال وقت قصير. انتظر بضع دقائق.' },
})

/** Audio stays in memory for this request only (never written to disk, never stored). */
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VOICE_LIMITS.maxBytes, files: 1, fields: 4, fieldSize: 64 },
}).single('audio')

const TOO_LONG = 'التسجيل أطول من المسموح (دقيقة واحدة).'

/** Daily cost guard of the paid transcription: refused before the clip is even read. */
const transcribeBudgetLeft = () => {
  const limit = dailyTranscribeLimit()
  return limit === null || voiceUsageToday().clips < limit
}

const chatBody = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }))
    .min(1)
    .max(40),
  /** how the latest message was entered: a spoken question gets a short, speakable answer */
  channel: z.enum(['text', 'voice']).optional(),
})

const speakBody = z.object({ text: z.string().trim().min(1).max(VOICE_LIMITS.maxSpeakChars) })

const assistantMode = () => (getAssistantClient() ? 'ai' : 'fallback')

export function registerAssistantRoutes(app: express.Express) {
  ensureAssistantTables()

  /** Public: which mode the widget runs in (no secrets). */
  app.get('/api/assistant/config', (req, res) => {
    const session = readSession(req)
    res.json({
      mode: assistantMode(),
      signedIn: session?.role === 'CITIZEN',
      name: 'أفندي — مساعد ذي قار',
      voice: voiceConfig(),
    })
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
        channel: parsed.data.channel || 'text',
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

  /**
   * Speech → text for browsers without speech recognition. 501 when no provider is configured (the panel then
   * offers typing). Limits, all enforced here: 60 s per clip (the declared duration is required, the bytes must fit
   * it, and the container's own length is checked), 1 MB per clip, 20 clips per 10 minutes per session / IP, and a
   * daily cap on clips sent to the paid provider (ASSISTANT_DAILY_STT_LIMIT). The audio is never stored.
   */
  const requireSpeechProvider: express.RequestHandler = (_req, res, next) => {
    if (getSpeechProvider()) return next()
    res.status(501).json({ code: 'STT_UNAVAILABLE', message: 'الكتابة متاحة؛ الصوت غير مدعوم في هذا المتصفح.' })
  }
  const requireTranscribeBudget: express.RequestHandler = (_req, res, next) => {
    if (transcribeBudgetLeft()) return next()
    res.status(503).json({ code: 'STT_BUDGET', message: 'تحويل الصوت متوقف لبقية اليوم بهذا المتصفح. اكتب سؤالك.' })
  }
  app.post(
    '/api/assistant/transcribe',
    assistantVoiceLimiter,
    requireSpeechProvider,
    requireTranscribeBudget,
    uploadBudget(2),
    (req, res) => {
      const provider = getSpeechProvider()
      if (!provider) return res.status(501).json({ code: 'STT_UNAVAILABLE' })
      audioUpload(req, res, async error => {
        if (error) {
          const tooBig = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
          return res.status(tooBig ? 413 : 400).json({ message: tooBig ? TOO_LONG : 'تعذر قراءة التسجيل الصوتي.' })
        }
        const file = req.file
        if (!file || !file.buffer?.length) return res.status(400).json({ message: 'ما وصل تسجيل صوتي.' })
        // the recorder always sends its length: a clip without one (or with a nonsense one) is refused
        const rawDuration = String(req.body?.durationMs ?? '').trim()
        const durationMs = /^\d{1,7}$/.test(rawDuration) ? Number(rawDuration) : 0
        if (durationMs <= 0) return res.status(400).json({ message: 'تعذر قراءة مدة التسجيل الصوتي.' })
        const maxMs = VOICE_LIMITS.maxDurationMs + VOICE_LIMITS.durationSlackMs
        if (durationMs > maxMs) return res.status(413).json({ message: TOO_LONG })
        // more bytes than the declared seconds can hold: the clip is longer than it says
        if (file.size > VOICE_LIMITS.byteSlack + (durationMs / 1000) * VOICE_LIMITS.maxBytesPerSecond)
          return res.status(413).json({ message: TOO_LONG })
        if (!ACCEPTED_AUDIO.test(file.mimetype) || !looksLikeAudio(file.buffer))
          return res.status(415).json({ message: 'صيغة الصوت غير مدعومة.' })
        // the container's own length (not only what the browser claims)
        const measuredMs = audioDurationMs(file.buffer)
        if (measuredMs !== null && measuredMs > maxMs) return res.status(413).json({ message: TOO_LONG })
        if (!transcribeBudgetLeft())
          return res.status(503).json({ code: 'STT_BUDGET', message: 'تحويل الصوت متوقف لبقية اليوم. اكتب سؤالك.' })
        recordVoiceUsage({ clips: 1, audioSeconds: Math.max(durationMs, measuredMs ?? 0) / 1000 })
        const controller = new AbortController()
        res.on('close', () => {
          if (!res.writableFinished) controller.abort()
        })
        try {
          const extension = /mp4|m4a|aac/i.test(file.mimetype)
            ? 'mp4'
            : /ogg/i.test(file.mimetype)
              ? 'ogg'
              : /wav/i.test(file.mimetype)
                ? 'wav'
                : /mpeg|mp3/i.test(file.mimetype)
                  ? 'mp3'
                  : 'webm'
          const text = await provider.transcribe(
            { audio: file.buffer, mimeType: file.mimetype.split(';')[0], filename: `speech.${extension}` },
            controller.signal
          )
          res.json({ text: text.trim().replace(/\s+/g, ' ').slice(0, 2000) })
        } catch (failure) {
          if (controller.signal.aborted) return
          console.error(
            '[assistant] transcription failed',
            failure instanceof SpeechProviderError ? failure.status : (failure as Error)?.name
          )
          res.status(502).json({ message: 'تعذر تحويل الكلام إلى نص الآن. حاول مرة ثانية أو اكتب سؤالك.' })
        } finally {
          // nothing is kept: drop the only reference to the audio
          file.buffer = Buffer.alloc(0)
        }
      })
    }
  )

  /**
   * Optional server voice (ASSISTANT_SERVER_TTS=true + provider key). Off by default: the browser speaks. Its own
   * limiter (one call per sentence); a sentence the citizen skipped or talked over is aborted at the provider too.
   */
  app.post('/api/assistant/speak', assistantSpeakLimiter, async (req, res) => {
    const provider = getSpeechProvider()
    if (!serverTtsEnabled() || !provider?.speak) return res.status(501).json({ code: 'TTS_UNAVAILABLE' })
    const parsed = speakBody.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: 'نص غير صالح.' })
    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) controller.abort()
    })
    try {
      recordVoiceUsage({ speechChars: parsed.data.text.length })
      const audio = await provider.speak(parsed.data.text, controller.signal)
      if (controller.signal.aborted) return
      res.setHeader('Content-Type', 'audio/mpeg')
      res.setHeader('Cache-Control', 'no-store')
      res.send(audio)
    } catch (failure) {
      if (controller.signal.aborted) return
      console.error(
        '[assistant] server voice failed',
        failure instanceof SpeechProviderError ? failure.status : 'error'
      )
      res.status(502).json({ message: 'تعذر تشغيل الصوت.' })
    }
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
      voice: { ...voiceConfig(), dailyTranscribeLimit: dailyTranscribeLimit(), today: voiceUsageToday() },
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
