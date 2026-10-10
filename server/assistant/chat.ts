import type Anthropic from '@anthropic-ai/sdk'
import {
  assistantModel,
  chatEffort,
  dailyTokenLimit,
  describeModelError,
  FALLBACK_BETA,
  modelErrorKind,
  type AssistantModelClient,
  type BetaMessage,
  type ModelRequest,
} from './client.js'
import { fallbackAnswer } from './fallback.js'
import { CITIZEN_SYSTEM_PROMPT } from './prompt.js'
import { recordUsage, tokensUsedToday, usageOf } from './store.js'
import { assistantTools, executeTool, type ToolContext, type ToolUiPayload } from './tools.js'

export type ChatTurn = { role: 'user' | 'assistant'; text: string }

/** Events streamed to the browser (one SSE `data:` line each). */
export type ChatEvent =
  | { type: 'meta'; mode: 'ai' | 'fallback'; signedIn: boolean }
  | { type: 'text'; delta: string }
  /**
   * The text streamed since the previous `interim` (or the start) was a progress note the model wrote before calling
   * tools, not the answer: the client drops it from the answer body (it may show `note` as a passing status line).
   * Without this every tool round's text piled up in one bubble and the answer read two or three times.
   */
  | { type: 'interim'; note: string }
  | { type: 'status'; label: string }
  | { type: 'ui'; payload: ToolUiPayload }
  /** discard the text streamed so far for this answer (a refusal cut it off) */
  | { type: 'reset' }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

/** Cost guards for one chat turn. */
export const CHAT_LIMITS = {
  /** thinking counts toward max_tokens on this model (it is always on); room for medium-effort thinking + the reply */
  maxTokens: 12_000,
  /** model calls per citizen message (each tool round is one call) */
  maxIterations: 6,
  historyTurns: 16,
  historyChars: 12_000,
  messageChars: 2_000,
}

const toolLabels: Record<string, string> = {
  search_services: 'يبحث في دليل الخدمات…',
  get_service_details: 'يجلب المستمسكات والخطوات…',
  get_registration_help: 'يجهز خطوات التسجيل…',
  get_platform_help: 'يراجع دليل المنصة…',
  list_departments: 'يبحث في الدوائر…',
  get_my_requests: 'يراجع معاملاتك…',
  get_request_status: 'يتحقق من حالة طلبك…',
  prepare_request_draft: 'يجهز مسودة الطلب…',
}

const REFUSAL_TEXT =
  'عذراً، ما أكدر أساعد بهذا الطلب. أكدر أساعدك بخدمات منصة ذي قار: المستمسكات، الخطوات، التسجيل، ومتابعة معاملاتك.'

/** Trims the client-held conversation to what the model needs: starts with a user turn, ends with one, size-capped. */
export function normalizeHistory(history: ChatTurn[]): ChatTurn[] {
  let turns = history
    .map(turn => ({ role: turn.role, text: turn.text.trim().slice(0, CHAT_LIMITS.messageChars) }))
    .filter(turn => turn.text.length > 0)
    .slice(-CHAT_LIMITS.historyTurns)
  while (turns.length && turns[0].role !== 'user') turns = turns.slice(1)
  while (turns.reduce((sum, turn) => sum + turn.text.length, 0) > CHAT_LIMITS.historyChars && turns.length > 1) {
    turns = turns.slice(1)
    while (turns.length && turns[0].role !== 'user') turns = turns.slice(1)
  }
  return turns
}

/**
 * After a server-side fallback the blocks the declining model produced before the last `fallback` block (thinking,
 * tool_use) must not be echoed back; everything after the boundary is echoed as-is (thinking blocks unmodified).
 */
export function echoContent(content: BetaMessage['content']): Anthropic.Beta.BetaContentBlockParam[] {
  const boundary = content.map(block => block.type).lastIndexOf('fallback')
  return content
    .filter((block, index) => {
      if (block.type === 'fallback') return false
      if (index < boundary && ['thinking', 'redacted_thinking', 'tool_use'].includes(block.type)) return false
      return true
    })
    .map(block => block as unknown as Anthropic.Beta.BetaContentBlockParam)
}

export function chatRequest(messages: Anthropic.Beta.BetaMessageParam[]): ModelRequest {
  return {
    model: assistantModel(),
    max_tokens: CHAT_LIMITS.maxTokens,
    // stable prefix (tools → system) with an explicit breakpoint; the automatic breakpoint caches the growing tail
    system: [{ type: 'text', text: CITIZEN_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: assistantTools,
    tool_choice: { type: 'auto' },
    messages,
    cache_control: { type: 'ephemeral' },
    // thinking is always on for this model (omitted = adaptive, display omitted: never shown to the citizen);
    // effort medium by default (ASSISTANT_CHAT_EFFORT) — low answered too thinly
    output_config: { effort: chatEffort() },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
  }
}

const sessionNote = (context: ToolContext) =>
  context.citizenId
    ? 'Session: the citizen is signed in. get_my_requests, get_request_status and prepare_request_draft are available for his own data.'
    : 'Session: visitor, not signed in. Account tools will return NOT_SIGNED_IN; invite him to sign in at /onboarding when needed.'

function sendFallback(lastMessage: string, context: ToolContext, send: (event: ChatEvent) => void) {
  const answer = fallbackAnswer(lastMessage, context)
  send({ type: 'text', delta: answer.text })
  for (const payload of answer.ui) send({ type: 'ui', payload })
  recordUsage('chat', { fallbackAnswers: 1 })
}

/**
 * One citizen message → streamed answer. With a model client: a manual streaming tool loop (tools run on the
 * server, read-only). Without one (no key, kill switch, daily budget spent): the deterministic fallback.
 */
export async function runChat(input: {
  history: ChatTurn[]
  context: ToolContext
  client: AssistantModelClient | null
  send: (event: ChatEvent) => void
  signal?: AbortSignal
}) {
  const { context, send, signal } = input
  const history = normalizeHistory(input.history)
  const lastMessage = history[history.length - 1]?.text || ''
  recordUsage('chat', { requests: 1 })
  const limit = dailyTokenLimit()
  const overBudget = limit !== null && tokensUsedToday() >= limit
  const client = overBudget ? null : input.client
  send({ type: 'meta', mode: client ? 'ai' : 'fallback', signedIn: Boolean(context.citizenId) })

  if (!client || !history.length || history[history.length - 1].role !== 'user') {
    sendFallback(lastMessage, context, send)
    send({ type: 'done' })
    return
  }

  const messages: Anthropic.Beta.BetaMessageParam[] = history.map(turn => ({ role: turn.role, content: turn.text }))
  messages.push({ role: 'system', content: sessionNote(context) })
  /** text of the final answer streamed so far (the current model call only) */
  let answerText = ''
  let anyText = false

  for (let iteration = 0; iteration < CHAT_LIMITS.maxIterations; iteration++) {
    let message: BetaMessage
    answerText = ''
    try {
      message = await client.stream(chatRequest(messages), {
        signal,
        onText: delta => {
          if (!delta) return
          anyText = true
          answerText += delta
          send({ type: 'text', delta })
        },
        onFallback: () => {
          // the declining model's partial text is superseded by the fallback model's answer
          if (answerText) send({ type: 'interim', note: '' })
          answerText = ''
        },
      })
    } catch (error) {
      if (signal?.aborted) return
      console.error('[assistant] chat model call failed', modelErrorKind(error))
      recordUsage('chat', { errors: 1 })
      if (!anyText) {
        send({ type: 'notice', message: `${describeModelError(error)} هذي نتائج البحث المباشر:` })
        sendFallback(lastMessage, context, send)
      } else send({ type: 'error', message: describeModelError(error) })
      send({ type: 'done' })
      return
    }
    recordUsage('chat', usageOf(message))

    // a classifier decline (after the server-side fallback chain also declined): drop any partial text
    if (message.stop_reason === 'refusal') {
      recordUsage('chat', { refusals: 1 })
      send({ type: 'reset' })
      send({ type: 'text', delta: REFUSAL_TEXT })
      send({ type: 'done' })
      return
    }
    if (message.stop_reason === 'pause_turn') {
      if (answerText) send({ type: 'interim', note: progressNote(answerText) })
      messages.push({ role: 'assistant', content: echoContent(message.content) })
      continue
    }
    const toolUses = message.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use'
    )
    if (message.stop_reason !== 'tool_use' || !toolUses.length) {
      if (message.stop_reason === 'max_tokens' && !answerText)
        send({ type: 'text', delta: 'عذراً، طال الرد. اسألني بشكل أقصر أو عن خدمة وحدة.' })
      send({ type: 'done' })
      return
    }

    // text written before the tool calls is a progress note, never part of the answer (the answer comes after)
    if (answerText) send({ type: 'interim', note: progressNote(answerText) })
    messages.push({ role: 'assistant', content: echoContent(message.content) })
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
    for (const tool of toolUses) {
      send({ type: 'status', label: toolLabels[tool.name] || 'يجلب البيانات…' })
      const outcome = executeTool(tool.name, tool.input, context)
      if (outcome.ui) send({ type: 'ui', payload: outcome.ui })
      results.push({
        type: 'tool_result',
        tool_use_id: tool.id,
        content: JSON.stringify(outcome.content),
        ...(outcome.isError ? { is_error: true } : {}),
      })
    }
    messages.push({ role: 'user', content: results })
  }
  // the tool budget ran out before a final answer: answer from the catalog instead of a dead end
  const fallback = fallbackAnswer(lastMessage, context)
  send({ type: 'text', delta: fallback.text })
  for (const payload of fallback.ui) send({ type: 'ui', payload })
  send({ type: 'done' })
}

/** First line of a between-tools note, trimmed for the status line. */
export function progressNote(text: string) {
  const line =
    text
      .replace(/[*_#>`]/g, '')
      .split(/\n/)
      .map(part => part.trim())
      .find(Boolean) || ''
  return line.length > 90 ? `${line.slice(0, 88)}…` : line
}
