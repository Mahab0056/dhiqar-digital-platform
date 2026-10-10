import { randomUUID } from 'node:crypto'
import { db } from '../db.js'

/**
 * Assistant tables live next to the platform schema but are created here (idempotent) so the assistant stays one
 * self-contained module:
 * - assistant_usage: daily counters per route, from response.usage, for cost visibility on /api/assistant/status
 * - ai_reviews: every staff "تدقيق ذكي" result, with the model that produced it (or RULES when no model ran)
 */
let ready = false
export function ensureAssistantTables() {
  if (ready) return
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_usage (
      day TEXT NOT NULL,
      route TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      model_calls INTEGER NOT NULL DEFAULT 0,
      fallback_answers INTEGER NOT NULL DEFAULT 0,
      refusals INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, route)
    );
    CREATE TABLE IF NOT EXISTS ai_reviews (
      id TEXT PRIMARY KEY,
      service_request_id INTEGER NOT NULL,
      reference TEXT NOT NULL,
      verdict TEXT NOT NULL,
      result TEXT NOT NULL,
      source TEXT NOT NULL,
      model TEXT,
      documents_sent INTEGER NOT NULL DEFAULT 0,
      requested_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (service_request_id) REFERENCES service_requests(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ai_reviews_request ON ai_reviews(service_request_id, created_at);
  `)
  ready = true
}

export type AssistantRoute = 'chat' | 'review'
export type UsageDelta = {
  requests?: number
  modelCalls?: number
  fallbackAnswers?: number
  refusals?: number
  errors?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

const today = () => new Date().toISOString().slice(0, 10)

export function recordUsage(route: AssistantRoute, delta: UsageDelta) {
  ensureAssistantTables()
  db.prepare(
    `INSERT INTO assistant_usage (day, route, requests, model_calls, fallback_answers, refusals, errors, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, route) DO UPDATE SET requests = requests + excluded.requests, model_calls = model_calls + excluded.model_calls,
       fallback_answers = fallback_answers + excluded.fallback_answers, refusals = refusals + excluded.refusals, errors = errors + excluded.errors,
       input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens,
       cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens, cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens`
  ).run(
    today(),
    route,
    delta.requests || 0,
    delta.modelCalls || 0,
    delta.fallbackAnswers || 0,
    delta.refusals || 0,
    delta.errors || 0,
    delta.inputTokens || 0,
    delta.outputTokens || 0,
    delta.cacheReadTokens || 0,
    delta.cacheCreationTokens || 0
  )
}

/** Usage numbers from one API response (top-level usage covers the attempt that produced the message). */
export function usageOf(message: {
  usage?: {
    input_tokens?: number | null
    output_tokens?: number | null
    cache_read_input_tokens?: number | null
    cache_creation_input_tokens?: number | null
  } | null
}): UsageDelta {
  const usage = message.usage
  return {
    modelCalls: 1,
    inputTokens: Number(usage?.input_tokens || 0),
    outputTokens: Number(usage?.output_tokens || 0),
    cacheReadTokens: Number(usage?.cache_read_input_tokens || 0),
    cacheCreationTokens: Number(usage?.cache_creation_input_tokens || 0),
  }
}

type UsageRow = {
  day: string
  route: string
  requests: number
  model_calls: number
  fallback_answers: number
  refusals: number
  errors: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
}

const mapUsage = (row: Partial<UsageRow>) => ({
  requests: Number(row.requests || 0),
  modelCalls: Number(row.model_calls || 0),
  fallbackAnswers: Number(row.fallback_answers || 0),
  refusals: Number(row.refusals || 0),
  errors: Number(row.errors || 0),
  inputTokens: Number(row.input_tokens || 0),
  outputTokens: Number(row.output_tokens || 0),
  cacheReadTokens: Number(row.cache_read_tokens || 0),
  cacheCreationTokens: Number(row.cache_creation_tokens || 0),
})

const sumSql = `SUM(requests) AS requests, SUM(model_calls) AS model_calls, SUM(fallback_answers) AS fallback_answers, SUM(refusals) AS refusals,
  SUM(errors) AS errors, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cache_read_tokens) AS cache_read_tokens,
  SUM(cache_creation_tokens) AS cache_creation_tokens`

export function usageSummary() {
  ensureAssistantTables()
  const day = today()
  const todayRow = db.prepare(`SELECT ${sumSql} FROM assistant_usage WHERE day = ?`).get(day) as Partial<UsageRow>
  const totalRow = db.prepare(`SELECT ${sumSql} FROM assistant_usage`).get() as Partial<UsageRow>
  const byRoute = db
    .prepare(`SELECT route, ${sumSql} FROM assistant_usage GROUP BY route ORDER BY route`)
    .all() as Array<Partial<UsageRow>>
  const last7 = db
    .prepare(`SELECT day, ${sumSql} FROM assistant_usage GROUP BY day ORDER BY day DESC LIMIT 7`)
    .all() as Array<Partial<UsageRow>>
  return {
    today: mapUsage(todayRow),
    total: mapUsage(totalRow),
    byRoute: byRoute.map(row => ({ route: String(row.route), ...mapUsage(row) })),
    days: last7.map(row => ({ day: String(row.day), ...mapUsage(row) })),
  }
}

export function tokensUsedToday() {
  const today = usageSummary().today
  return today.inputTokens + today.outputTokens + today.cacheCreationTokens
}

export function saveAiReview(input: {
  serviceRequestId: number
  reference: string
  verdict: string
  result: unknown
  source: 'MODEL' | 'RULES'
  model: string | null
  documentsSent: number
  requestedBy: string
  createdAt: string
}) {
  ensureAssistantTables()
  const id = `air_${randomUUID().replaceAll('-', '')}`
  db.prepare(
    `INSERT INTO ai_reviews (id, service_request_id, reference, verdict, result, source, model, documents_sent, requested_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.serviceRequestId,
    input.reference,
    input.verdict,
    JSON.stringify(input.result),
    input.source,
    input.model,
    input.documentsSent,
    input.requestedBy,
    input.createdAt
  )
  return id
}

export function latestAiReview(serviceRequestId: number) {
  ensureAssistantTables()
  const row = db
    .prepare(`SELECT * FROM ai_reviews WHERE service_request_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .get(serviceRequestId) as Record<string, unknown> | undefined
  if (!row) return null
  try {
    return { id: String(row.id), ...(JSON.parse(String(row.result)) as Record<string, unknown>) }
  } catch {
    return null
  }
}
