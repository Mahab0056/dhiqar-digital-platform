import Anthropic from '@anthropic-ai/sdk'

/**
 * Configuration of "مساعد ذي قار الآلي". Everything is read from the environment on each call so the owner can
 * flip a flag on Railway and restart without code changes:
 * - ANTHROPIC_API_KEY             the Claude API key; without it the assistant runs in deterministic fallback mode
 * - ASSISTANT_MODEL               model id (default claude-opus-5-5)
 * - ASSISTANT_CHAT_EFFORT         low | medium | high for the citizen chat (default medium)
 * - ASSISTANT_DOCUMENT_REVIEW     "true" lets the staff review send the uploaded files (ID documents) to the API
 * - ASSISTANT_DISABLED            "true" forces fallback mode even with a key (kill switch)
 * - ASSISTANT_DAILY_TOKEN_LIMIT   optional cost guard: past this many tokens today the chat falls back to search
 */
export const DEFAULT_ASSISTANT_MODEL = 'claude-opus-5-5'
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export const assistantModel = () => process.env.ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL
export type ChatEffort = 'low' | 'medium' | 'high'
/**
 * Effort of the citizen chat. Default medium: on Claude Opus 5.5 it is the API default and noticeably better than low
 * at picking the right service and asking the right follow-up question, at a still modest cost per answer.
 */
export const chatEffort = (): ChatEffort => {
  const value = process.env.ASSISTANT_CHAT_EFFORT?.trim().toLowerCase()
  return value === 'low' || value === 'high' ? value : 'medium'
}
export const documentReviewEnabled = () => process.env.ASSISTANT_DOCUMENT_REVIEW?.trim().toLowerCase() === 'true'
export const apiKeyConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim())
const killSwitch = () => process.env.ASSISTANT_DISABLED?.trim().toLowerCase() === 'true'
export const dailyTokenLimit = () => {
  const value = Number(process.env.ASSISTANT_DAILY_TOKEN_LIMIT || 0)
  return Number.isFinite(value) && value > 0 ? value : null
}

export type BetaMessage = Anthropic.Beta.BetaMessage
/** Request body without `stream` (the client decides streaming vs not). */
export type ModelRequest = Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, 'stream'>

/**
 * The only surface the assistant needs from the SDK. Tests inject a fake implementation (setAssistantClient) so
 * no test ever reaches the real API.
 */
export type StreamHandlers = {
  /** A text delta of the current model turn. */
  onText: (delta: string) => void
  /**
   * A server-side fallback took over mid-stream (a `fallback` content block started): the text streamed so far was
   * written by the declining model and is superseded by what follows.
   */
  onFallback?: () => void
  signal?: AbortSignal
}

export interface AssistantModelClient {
  /** Streams one model turn; `onText` receives text deltas as they arrive. Resolves with the complete message. */
  stream(request: ModelRequest, handlers: StreamHandlers): Promise<BetaMessage>
  /** One non-streaming call (structured output for the staff review). */
  create(request: ModelRequest, options?: { signal?: AbortSignal }): Promise<BetaMessage>
}

class SdkAssistantClient implements AssistantModelClient {
  private readonly sdk: Anthropic
  constructor(apiKey: string) {
    // the SDK retries 429/5xx itself (twice, with backoff); a chat turn must not hang forever
    this.sdk = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 })
  }

  async stream(request: ModelRequest, handlers: StreamHandlers) {
    const stream = this.sdk.beta.messages.stream(request, { signal: handlers.signal })
    stream.on('text', delta => handlers.onText(delta))
    stream.on('streamEvent', event => {
      if (event.type === 'content_block_start' && event.content_block.type === 'fallback') handlers.onFallback?.()
    })
    return stream.finalMessage()
  }

  create(request: ModelRequest, options: { signal?: AbortSignal } = {}) {
    return this.sdk.beta.messages.create({ ...request, stream: false }, { signal: options.signal })
  }
}

let injected: AssistantModelClient | null | undefined
let cached: { key: string; client: AssistantModelClient } | null = null

/** Test hook: inject a fake client (or null to simulate "no key"); undefined restores the real resolution. */
export function setAssistantClient(client: AssistantModelClient | null | undefined) {
  injected = client
}

/** The model client, or null when the assistant must run in fallback mode (no key / kill switch). */
export function getAssistantClient(): AssistantModelClient | null {
  if (injected !== undefined) return injected
  if (killSwitch()) return null
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) return null
  if (!cached || cached.key !== key) cached = { key, client: new SdkAssistantClient(key) }
  return cached.client
}

/** Arabic, user-safe explanation of an SDK error (never the raw provider message). */
export function describeModelError(error: unknown) {
  if (error instanceof Anthropic.RateLimitError) return 'المساعد مشغول حالياً بسبب كثرة الطلبات. حاول بعد دقيقة.'
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError)
    return 'مفتاح المساعد الذكي غير صالح. أبلغ إدارة المنصة.'
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'تأخر رد المساعد الذكي. حاول مرة ثانية.'
  if (error instanceof Anthropic.APIConnectionError) return 'تعذر الاتصال بخدمة المساعد الذكي.'
  if (error instanceof Anthropic.BadRequestError) return 'تعذر على المساعد معالجة هذا الطلب.'
  if (error instanceof Anthropic.InternalServerError) return 'خدمة المساعد الذكي متعطلة مؤقتاً.'
  if (error instanceof Anthropic.APIError) return 'خدمة المساعد الذكي غير متاحة مؤقتاً.'
  return 'حدث خطأ غير متوقع في المساعد.'
}

/** Short machine label for usage/audit rows. */
export function modelErrorKind(error: unknown) {
  if (error instanceof Anthropic.RateLimitError) return 'RATE_LIMIT'
  if (error instanceof Anthropic.AuthenticationError) return 'AUTH'
  if (error instanceof Anthropic.APIConnectionError) return 'CONNECTION'
  if (error instanceof Anthropic.BadRequestError) return 'BAD_REQUEST'
  if (error instanceof Anthropic.APIError) return `API_${error.status ?? 'ERROR'}`
  if (error instanceof Error && error.name === 'AbortError') return 'ABORTED'
  return 'UNKNOWN'
}
