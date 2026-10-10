/**
 * Browser side of "مساعد ذي قار الآلي": the SSE chat stream, the staff AI review and the admin status.
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

export type AssistantEvent =
  | { type: 'meta'; mode: 'ai' | 'fallback'; signedIn: boolean }
  | { type: 'text'; delta: string }
  | { type: 'status'; label: string }
  | { type: 'ui'; payload: AssistantUiPayload }
  | { type: 'reset' }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

export type AssistantTurn = { role: 'user' | 'assistant'; text: string }

export async function getAssistantConfig() {
  const response = await fetch('/api/assistant/config', { credentials: 'include' })
  if (!response.ok) throw new Error('config unavailable')
  return (await response.json()) as { mode: 'ai' | 'fallback'; signedIn: boolean }
}

/** POSTs the conversation and calls `onEvent` for every SSE event until the stream ends. */
export async function streamAssistantChat(
  messages: AssistantTurn[],
  onEvent: (event: AssistantEvent) => void,
  signal?: AbortSignal
) {
  const response = await fetch('/api/assistant/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ messages }),
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
