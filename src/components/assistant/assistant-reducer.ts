import type { AssistantEvent, AssistantUiPayload } from './assistant-client'

/**
 * Pure reducer of one assistant reply (no React): every SSE event of /api/assistant/chat is folded into the reply
 * shown in the panel. Shared by AssistantPanel and the tests, so the bubble the citizen sees is the bubble the tests
 * check (tests/assistant-quality.test.ts).
 */
export type AssistantReply = {
  text: string
  ui: AssistantUiPayload[]
  /** short passing line under the typing dots / answer (tool label or the model's between-tools note) */
  status?: string
  notice?: string
  error?: string
}

export const emptyReply = (): AssistantReply => ({ text: '', ui: [] })

/** Several tool results of one answer become one set of cards (newest first, no duplicates). */
export function mergeUi(list: AssistantUiPayload[], payload: AssistantUiPayload): AssistantUiPayload[] {
  if (payload.kind === 'services') {
    const previous = list.find(item => item.kind === 'services') as
      Extract<AssistantUiPayload, { kind: 'services' }> | undefined
    const items = [...payload.items, ...(previous?.items || [])].filter(
      (item, index, all) => all.findIndex(other => other.key === item.key) === index
    )
    return [...list.filter(item => item.kind !== 'services'), { kind: 'services', items: items.slice(0, 3) }]
  }
  if (payload.kind === 'registration' && list.some(item => item.kind === 'registration')) return list
  return [...list.filter(item => item.kind !== payload.kind), payload]
}

export function applyAssistantEvent(reply: AssistantReply, event: AssistantEvent): AssistantReply {
  switch (event.type) {
    case 'text':
      return { ...reply, text: reply.text + event.delta, status: undefined }
    case 'interim':
      // what streamed so far was a note before tool calls, not the answer: never keep it in the bubble
      return { ...reply, text: '', status: event.note || reply.status }
    case 'status':
      return { ...reply, status: event.label }
    case 'ui':
      return { ...reply, ui: mergeUi(reply.ui, event.payload) }
    case 'reset':
      return { ...reply, text: '', ui: [] }
    case 'notice':
      return { ...reply, notice: event.message }
    case 'error':
      return { ...reply, error: event.message }
    case 'done':
      return { ...reply, text: dedupeParagraphs(reply.text), status: undefined }
    default:
      return reply
  }
}

const paragraphKey = (paragraph: string) =>
  paragraph
    .replace(/[*_`>#]/g, '')
    .replace(/[\s‏‎]+/g, ' ')
    .trim()

/**
 * Last line of defence against a repeated answer: drops a paragraph that is identical (ignoring markdown and spacing)
 * to an earlier one of the same reply. Short lines (list bullets like "- صورة البطاقة") may legitimately repeat
 * across sections, so only paragraphs of 25+ characters are compared.
 */
export function dedupeParagraphs(text: string) {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const paragraph of text.split(/\n{2,}/)) {
    const key = paragraphKey(paragraph)
    if (key.length >= 25 && seen.has(key)) continue
    if (key.length >= 25) seen.add(key)
    kept.push(paragraph)
  }
  return kept.join('\n\n').trim()
}

/** Folds a whole event list (tests, replays). */
export const replyFromEvents = (events: AssistantEvent[]) => events.reduce(applyAssistantEvent, emptyReply())
