/**
 * Browser side of أفندي — مساعد ذي قار: the SSE chat stream, the staff AI review and the admin status.
 * Types mirror server/assistant (chat.ts, tools.ts, review.ts).
 */
export type AssistantServiceCard = {
  key: string
  title: string
  departmentName: string
  category: string
  channel: 'ONLINE_SUBMISSION' | 'APPOINTMENT_REQUIRED' | 'INFORMATION_ONLY'
  channelLabel: string
  feeLabel: string | null
  estimatedDuration: string | null
  documents: Array<{ label: string; required: boolean }>
}

export type AssistantRequestSummary = {
  reference: string
  serviceKey: string
  serviceName: string
  departmentName: string
  status: string
  statusLabel: string
  currentAction: string
  missingDocuments: string[]
  updatedAt: string
}

export type AssistantDraft = {
  serviceKey: string
  serviceTitle: string
  departmentName: string
  answers: Array<{ key: string; label: string; value: string }>
  missingFields: string[]
  documents: Array<{ label: string; required: boolean }>
}

export type AssistantUiPayload =
  | { kind: 'services'; items: AssistantServiceCard[] }
  | { kind: 'requests'; items: AssistantRequestSummary[] }
  | { kind: 'draft'; draft: AssistantDraft }
  | { kind: 'registration' }
  /** one short clarifying question; each option is a chip sent as the citizen's reply */
  | { kind: 'clarify'; question: string; options: string[] }

export type AssistantEvent =
  | { type: 'meta'; mode: 'ai' | 'fallback'; signedIn: boolean }
  | { type: 'text'; delta: string }
  /** the text streamed so far was a note before tool calls, not the answer */
  | { type: 'interim'; note: string }
  | { type: 'status'; label: string }
  | { type: 'ui'; payload: AssistantUiPayload }
  | { type: 'reset' }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

export type AssistantTurn = { role: 'user' | 'assistant'; text: string }

export type AssistantChannel = 'text' | 'voice'
export type AssistantVoiceConfig = {
  transcribe: boolean
  serverTts: boolean
  /** the external service that receives the clip (recorder engine) or the answer text (server voice) */
  provider?: string | null
}
export type AssistantConfig = { mode: 'ai' | 'fallback'; signedIn: boolean; voice?: AssistantVoiceConfig }

export async function getAssistantConfig() {
  const response = await fetch('/api/assistant/config', { credentials: 'include' })
  if (!response.ok) throw new Error('config unavailable')
  return (await response.json()) as AssistantConfig
}

/** Error of the voice endpoints, with the HTTP status (501 = no provider on this server). */
export class VoiceRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Fallback speech-to-text (browsers without SpeechRecognition): the clip goes to the server once, never stored. */
export async function transcribeAudio(audio: Blob, durationMs: number, signal?: AbortSignal) {
  const form = new FormData()
  form.append('durationMs', String(Math.round(durationMs)))
  const extension = /mp4|aac|m4a/.test(audio.type) ? 'mp4' : /ogg/.test(audio.type) ? 'ogg' : 'webm'
  form.append('audio', audio, `speech.${extension}`)
  const response = await fetch('/api/assistant/transcribe', {
    method: 'POST',
    credentials: 'include',
    body: form,
    signal,
  })
  const payload = (await response.json().catch(() => ({}))) as { text?: string; message?: string }
  if (!response.ok)
    throw new VoiceRequestError(
      response.status,
      payload.message ||
        (response.status === 501
          ? 'الكتابة متاحة؛ الصوت غير مدعوم في هذا المتصفح.'
          : 'تعذر تحويل الكلام إلى نص. حاول مرة ثانية أو اكتب سؤالك.')
    )
  return String(payload.text || '').trim()
}

/** Optional server voice (only when /api/assistant/config says voice.serverTts). Resolves with an mp3 blob. */
export async function fetchServerSpeech(text: string, signal?: AbortSignal) {
  const response = await fetch('/api/assistant/speak', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  })
  if (!response.ok) throw new VoiceRequestError(response.status, 'server voice unavailable')
  return response.blob()
}

/** POSTs the conversation and calls `onEvent` for every SSE event until the stream ends. */
export async function streamAssistantChat(
  messages: AssistantTurn[],
  onEvent: (event: AssistantEvent) => void,
  signal?: AbortSignal,
  channel: AssistantChannel = 'text'
) {
  const response = await fetch('/api/assistant/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ messages, channel }),
    signal,
  })
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(
      payload.message ||
        (response.status === 429
          ? 'أرسلت رسائل كثيرة خلال وقت قصير. انتظر قليلاً ثم أعد المحاولة.'
          : 'تعذر الوصول إلى المساعد الآن. تحقق من الاتصال ثم أعد المحاولة.')
    )
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const chunk = buffer.slice(0, boundary).trim()
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
      if (!chunk.startsWith('data:')) continue
      try {
        onEvent(JSON.parse(chunk.slice(5).trim()) as AssistantEvent)
      } catch {
        /* a malformed event is skipped, the stream continues */
      }
    }
  }
}

// ---- staff: AI review ------------------------------------------------------------------------------------
export type AiReview = {
  id: string
  verdict: 'READY' | 'MISSING_ITEMS' | 'NEEDS_HUMAN_CHECK'
  summary: string
  documents: Array<{
    key: string
    label: string
    required: boolean
    status: 'PRESENT' | 'MISSING' | 'UNCLEAR'
    reason: string
  }>
  fieldIssues: Array<{ field: string; issue: string }>
  missingItems: string[]
  citizenNote: string
  source: 'MODEL' | 'RULES'
  model: string | null
  documentReview: boolean
  documentsSent: number
  notice: string | null
  createdAt: string
  requestedBy: string
}

export type AiReviewResponse = { review: AiReview | null; mode: 'ai' | 'fallback'; documentReview: boolean }

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(payload.message || 'تعذر تنفيذ الطلب.')
  }
  return response.json() as Promise<T>
}

export const getAiReview = (reference: string) =>
  fetch(`/api/employee/service-requests/${encodeURIComponent(reference)}/ai-review`, { credentials: 'include' }).then(
    response => json<AiReviewResponse>(response)
  )

export const runAiReview = (reference: string) =>
  fetch(`/api/employee/service-requests/${encodeURIComponent(reference)}/ai-review`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).then(response => json<AiReviewResponse>(response))

// ---- super admin: status -----------------------------------------------------------------------------------
export type AssistantUsage = {
  requests: number
  modelCalls: number
  fallbackAnswers: number
  refusals: number
  errors: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}
export type AssistantStatus = {
  mode: 'ai' | 'fallback'
  keyConfigured: boolean
  disabled: boolean
  model: string
  documentReview: boolean
  dailyTokenLimit: number | null
  effort: { chat: string; review: string }
  usage: {
    today: AssistantUsage
    total: AssistantUsage
    byRoute: Array<AssistantUsage & { route: string }>
    days: Array<AssistantUsage & { day: string }>
  }
  voice?: AssistantVoiceConfig
}

export const getAssistantStatus = () =>
  fetch('/api/assistant/status', { credentials: 'include' }).then(response => json<AssistantStatus>(response))

/** Hands an assistant draft to the normal service page (DynamicServiceFormPage reads these keys). */
export function handDraftToServicePage(draft: AssistantDraft) {
  const key = `dhiqar-service-draft:${draft.serviceKey}`
  const values = Object.fromEntries(draft.answers.map(answer => [answer.key, answer.value]))
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null') as { values?: Record<string, string> } | null
    const merged = { ...(saved?.values || {}), ...values }
    localStorage.setItem(key, JSON.stringify({ values: merged, savedAt: Date.now() }))
    sessionStorage.setItem(key, JSON.stringify(merged))
  } catch {
    /* storage blocked: the citizen fills the form by hand */
  }
}
