import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { SessionData } from '../auth/session.js'
import { db } from '../db.js'
import { readDecryptedMedia } from '../media.js'
import { getCatalogService, type CatalogService } from '../services/catalog.js'
import { ESCALATION_DEPARTMENT_ID, escalationReason } from '../services/sla.js'
import {
  assistantModel,
  describeModelError,
  documentReviewEnabled,
  FALLBACK_BETA,
  modelErrorKind,
  type AssistantModelClient,
  type ModelRequest,
} from './client.js'
import { REVIEW_SYSTEM_PROMPT } from './prompt.js'
import { recordUsage, usageOf } from './store.js'

/**
 * "تدقيق ذكي" for department staff: compares one request with the service's required documents and form fields.
 * The deterministic rules always run (they know what was never uploaded); the model, when configured, adds a look at
 * the form and — only with ASSISTANT_DOCUMENT_REVIEW=true — at the files themselves. The result never decides the
 * request: the employee reads it and may send the prepared "ناقصة بس" note through the normal decision form.
 */
export type ReviewVerdict = 'READY' | 'MISSING_ITEMS' | 'NEEDS_HUMAN_CHECK'
export type ReviewDocStatus = 'PRESENT' | 'MISSING' | 'UNCLEAR'

export type AiReviewResult = {
  verdict: ReviewVerdict
  summary: string
  documents: Array<{ key: string; label: string; required: boolean; status: ReviewDocStatus; reason: string }>
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

type ChecklistItem = {
  key: string
  label: string
  description?: string
  required: boolean
  status: 'MISSING' | 'UPLOADED' | 'VERIFIED' | 'REJECTED'
  mediaId: string | null
  note: string | null
}

export const reviewRowSql = `SELECT sr.*, sc.name AS service_name, d.name AS department_name
  FROM service_requests sr JOIN service_catalog sc ON sc.id = sr.service_id JOIN departments d ON d.id = sr.department_id`

export const loadReviewRow = (reference: string) =>
  db.prepare(`${reviewRowSql} WHERE sr.reference = ?`).get(reference) as Record<string, unknown> | undefined

/** Same rule as the employee endpoints in routes/service-requests.ts (canActOn). */
export function canReview(session: SessionData, row: Record<string, unknown>) {
  if (session.role === 'SUPER_ADMIN') return true
  if (!session.departmentId) return false
  if (session.departmentId === String(row.department_id)) return true
  return (
    session.role === 'EMPLOYEE' && session.departmentId === ESCALATION_DEPARTMENT_ID && Boolean(escalationReason(row))
  )
}

const parseChecklist = (value: unknown): ChecklistItem[] => {
  try {
    const parsed = value ? JSON.parse(String(value)) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
const parseForm = (value: unknown): Record<string, string> => {
  try {
    const parsed = value ? JSON.parse(String(value)) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

const mediaInfo = (mediaId: string) =>
  db.prepare('SELECT mime_type, size_bytes, original_name, deleted_at FROM media_objects WHERE id = ?').get(mediaId) as
    { mime_type: string; size_bytes: number; original_name: string; deleted_at: string | null } | undefined

export const citizenNoteFor = (missing: string[]) =>
  missing.length ? `ناقصة بس: ${missing.join('، ')}. ارفعها من صفحة طلبك حتى نكمل معاملتك.` : ''

/** Deterministic pre-check from the checklist and the form; the baseline every model result is merged into. */
export function rulesReview(row: Record<string, unknown>, service: CatalogService | null) {
  const checklist = parseChecklist(row.document_checklist)
  const form = parseForm(row.form_data)
  const documents: AiReviewResult['documents'] = checklist.map(item => {
    const base = { key: item.key, label: item.label, required: Boolean(item.required) }
    if (item.status === 'REJECTED')
      return {
        ...base,
        status: 'MISSING',
        reason: `رُفض سابقاً${item.note ? `: ${item.note}` : ''} — يلزم إعادة رفعه.`,
      }
    if (!item.mediaId) return { ...base, status: 'MISSING', reason: item.required ? 'لم يُرفع.' : 'اختياري ولم يُرفع.' }
    const info = mediaInfo(item.mediaId)
    if (!info || info.deleted_at)
      return { ...base, status: 'UNCLEAR', reason: 'الملف غير متاح (انتهت مدة الاحتفاظ أو حُذف).' }
    if (item.status === 'VERIFIED') return { ...base, status: 'PRESENT', reason: 'مرفوع ودققه موظف.' }
    return { ...base, status: 'PRESENT', reason: 'مرفوع — لم يُفحص محتواه آلياً.' }
  })
  const fieldIssues = (service?.fields || [])
    .filter(field => field.required && !String(form[field.key] ?? '').trim())
    .map(field => ({ field: field.label, issue: 'حقل إلزامي فارغ.' }))
  const missingItems = documents.filter(doc => doc.required && doc.status === 'MISSING').map(doc => doc.label)
  for (const issue of fieldIssues) missingItems.push(issue.field)
  const unclear = documents.some(doc => doc.required && doc.status === 'UNCLEAR')
  const verdict: ReviewVerdict = missingItems.length ? 'MISSING_ITEMS' : unclear ? 'NEEDS_HUMAN_CHECK' : 'READY'
  const summary =
    verdict === 'MISSING_ITEMS'
      ? `ينقص الطلب ${missingItems.length.toLocaleString('en-US')} بند: ${missingItems.join('، ')}.`
      : verdict === 'NEEDS_HUMAN_CHECK'
        ? 'بعض الملفات غير متاحة للفحص؛ يلزم نظرة الموظف.'
        : 'كل المستمسكات الإلزامية مرفوعة والحقول الإلزامية معبأة. دقق محتوى الملفات بنفسك.'
  return { verdict, summary, documents, fieldIssues, missingItems, citizenNote: citizenNoteFor(missingItems) }
}

// ---- model review ------------------------------------------------------------------------------------------
const reviewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'documents', 'fieldIssues', 'missingItems', 'citizenNote'],
  properties: {
    verdict: { type: 'string', enum: ['READY', 'MISSING_ITEMS', 'NEEDS_HUMAN_CHECK'] },
    summary: { type: 'string', description: 'One or two Arabic sentences for the employee' },
    documents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'status', 'reason'],
        properties: {
          key: { type: 'string', description: 'Document key exactly as given' },
          status: { type: 'string', enum: ['PRESENT', 'MISSING', 'UNCLEAR'] },
          reason: { type: 'string' },
        },
      },
    },
    fieldIssues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'issue'],
        properties: { field: { type: 'string' }, issue: { type: 'string' } },
      },
    },
    missingItems: { type: 'array', items: { type: 'string' } },
    citizenNote: { type: 'string' },
  },
}

const modelOutput = z.object({
  verdict: z.enum(['READY', 'MISSING_ITEMS', 'NEEDS_HUMAN_CHECK']),
  summary: z.string().max(2000),
  documents: z.array(
    z.object({ key: z.string(), status: z.enum(['PRESENT', 'MISSING', 'UNCLEAR']), reason: z.string().max(600) })
  ),
  fieldIssues: z.array(z.object({ field: z.string().max(200), issue: z.string().max(600) })).max(30),
  missingItems: z.array(z.string().max(200)).max(30),
  citizenNote: z.string().max(1200),
})

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
export const REVIEW_FILE_LIMITS = {
  imageBytes: 5 * 1024 * 1024,
  pdfBytes: 8 * 1024 * 1024,
  totalBytes: 18 * 1024 * 1024,
  files: 10,
}

/** Builds the user turn: request facts as text, then (when allowed) each file preceded by its label. */
export function buildReviewContent(row: Record<string, unknown>, service: CatalogService | null, sendFiles: boolean) {
  const checklist = parseChecklist(row.document_checklist)
  const form = parseForm(row.form_data)
  const labels = new Map((service?.fields || []).map(field => [field.key, field]))
  const lines = [
    `الخدمة: ${String(row.service_name)} — ${String(row.department_name)}`,
    service?.description ? `وصف الخدمة: ${service.description}` : '',
    `حالة الطلب الحالية: ${String(row.status)}`,
    '',
    'المستمسكات المطلوبة (key | الاسم | إلزامي | حالة الرفع | معلومات الملف):',
  ]
  for (const item of checklist) {
    const info = item.mediaId ? mediaInfo(item.mediaId) : undefined
    const file = info && !info.deleted_at ? `${info.mime_type}, ${Math.round(info.size_bytes / 1024)}KB` : 'لا يوجد ملف'
    lines.push(
      `- ${item.key} | ${item.label}${item.description ? ` (${item.description})` : ''} | ${item.required ? 'إلزامي' : 'اختياري'} | ${item.status}${item.note ? ` — ملاحظة الموظف: ${item.note}` : ''} | ${file}`
    )
  }
  lines.push('', 'حقول الاستمارة (الاسم | إلزامي | القيمة):')
  const keys = new Set([...labels.keys(), ...Object.keys(form)])
  for (const key of keys) {
    const field = labels.get(key)
    lines.push(
      `- ${field?.label || key} | ${field?.required ? 'إلزامي' : 'اختياري'} | ${String(form[key] ?? '').slice(0, 400) || '(فارغ)'}`
    )
  }

  const blocks: Anthropic.Beta.BetaContentBlockParam[] = []
  let sent = 0
  let total = 0
  const skipped: string[] = []
  if (sendFiles) {
    for (const item of checklist) {
      if (!item.mediaId || item.status === 'REJECTED') continue
      if (sent >= REVIEW_FILE_LIMITS.files) {
        skipped.push(item.label)
        continue
      }
      const info = mediaInfo(item.mediaId)
      if (!info || info.deleted_at) continue
      const isImage = IMAGE_TYPES.has(info.mime_type)
      const isPdf = info.mime_type === 'application/pdf'
      const cap = isImage ? REVIEW_FILE_LIMITS.imageBytes : isPdf ? REVIEW_FILE_LIMITS.pdfBytes : 0
      if (!cap || info.size_bytes > cap || total + info.size_bytes > REVIEW_FILE_LIMITS.totalBytes) {
        skipped.push(item.label)
        continue
      }
      let media: ReturnType<typeof readDecryptedMedia> = null
      try {
        media = readDecryptedMedia(item.mediaId)
      } catch {
        media = null
      }
      if (!media) {
        skipped.push(item.label)
        continue
      }
      const data = media.buffer.toString('base64')
      blocks.push({ type: 'text', text: `الملف التالي هو المستمسك ${item.key} — ${item.label}:` })
      blocks.push(
        isPdf
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
          : {
              type: 'image',
              source: {
                type: 'base64',
                media_type: info.mime_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data,
              },
            }
      )
      sent++
      total += info.size_bytes
    }
  }
  const scope = sendFiles
    ? `أُرفقت ${sent} ملفات أدناه${skipped.length ? `، ولم تُرفق (حجم/نوع غير مدعوم): ${skipped.join('، ')} — اعتبرها UNCLEAR` : ''}.`
    : 'لم تُرسل الملفات نفسها (سياسة الخصوصية): احكم على المستمسكات المرفوعة من حالتها ومعلومات الملف فقط؛ لا تقل PRESENT إلا لما هو مرفوع، واذكر أن المحتوى لم يُفحص.'
  lines.push('', scope, '', 'أعد نتيجة التدقيق بصيغة JSON المطلوبة.')
  return {
    content: [{ type: 'text' as const, text: lines.filter(line => line !== undefined).join('\n') }, ...blocks],
    sent,
  }
}

export function reviewRequest(content: Anthropic.Beta.BetaContentBlockParam[]): ModelRequest {
  return {
    model: assistantModel(),
    max_tokens: 16000,
    system: [{ type: 'text', text: REVIEW_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
    // document review needs more care than chat: medium effort (the model's default, set explicitly)
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: reviewSchema } },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
  }
}

/** Merges the model output into the rules baseline: never-uploaded documents stay MISSING whatever the model says. */
function mergeReview(rules: ReturnType<typeof rulesReview>, output: z.infer<typeof modelOutput>) {
  const byKey = new Map(output.documents.map(doc => [doc.key, doc]))
  const documents = rules.documents.map(doc => {
    if (doc.status === 'MISSING') return doc
    const judged = byKey.get(doc.key)
    return judged ? { ...doc, status: judged.status, reason: judged.reason } : doc
  })
  const fieldIssues = [...rules.fieldIssues]
  for (const issue of output.fieldIssues)
    if (!fieldIssues.some(item => item.field === issue.field)) fieldIssues.push(issue)
  const missingItems = [...rules.missingItems]
  for (const item of [
    ...output.missingItems,
    ...documents.filter(doc => doc.required && doc.status === 'MISSING').map(doc => doc.label),
  ])
    if (item.trim() && !missingItems.includes(item.trim())) missingItems.push(item.trim())
  let verdict: ReviewVerdict = output.verdict
  if (missingItems.length && verdict === 'READY') verdict = 'MISSING_ITEMS'
  if (!missingItems.length && verdict === 'MISSING_ITEMS') verdict = 'NEEDS_HUMAN_CHECK'
  const citizenNote = missingItems.length
    ? output.citizenNote.trim().startsWith('ناقصة') && output.citizenNote.trim().length > 12
      ? output.citizenNote.trim()
      : citizenNoteFor(missingItems)
    : ''
  return { verdict, summary: output.summary.trim() || rules.summary, documents, fieldIssues, missingItems, citizenNote }
}

/** Runs the review (rules + model when available). Never throws for model problems: falls back to the rules. */
export async function runReview(input: {
  row: Record<string, unknown>
  session: SessionData
  client: AssistantModelClient | null
}): Promise<AiReviewResult> {
  const { row, session, client } = input
  const service = getCatalogService(String(row.service_id))
  const rules = rulesReview(row, service)
  const documentReview = documentReviewEnabled()
  const base = { createdAt: new Date().toISOString(), requestedBy: session.actor, documentReview }
  recordUsage('review', { requests: 1 })
  if (!client)
    return {
      ...rules,
      ...base,
      source: 'RULES',
      model: null,
      documentsSent: 0,
      notice: 'المساعد الذكي غير مفعّل (لا يوجد مفتاح API): هذه نتيجة القواعد الآلية من قائمة المستمسكات فقط.',
    }

  const { content, sent } = buildReviewContent(row, service, documentReview)
  try {
    const message = await client.create(reviewRequest(content))
    recordUsage('review', usageOf(message))
    if (message.stop_reason === 'refusal') {
      recordUsage('review', { refusals: 1 })
      return {
        ...rules,
        ...base,
        source: 'RULES',
        model: null,
        documentsSent: sent,
        notice: 'امتنع النموذج عن تدقيق هذا الطلب؛ هذه نتيجة القواعد الآلية.',
      }
    }
    const text = message.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map(block => block.text)
      .join('')
    let parsed: z.infer<typeof modelOutput> | null = null
    try {
      const result = modelOutput.safeParse(JSON.parse(text))
      parsed = result.success ? result.data : null
    } catch {
      parsed = null
    }
    if (!parsed)
      return {
        ...rules,
        ...base,
        source: 'RULES',
        model: null,
        documentsSent: sent,
        notice: 'تعذر قراءة رد النموذج؛ هذه نتيجة القواعد الآلية.',
      }
    return {
      ...mergeReview(rules, parsed),
      ...base,
      source: 'MODEL',
      model: message.model || assistantModel(),
      documentsSent: sent,
      notice: documentReview
        ? null
        : 'لم تُرسل صور المستمسكات للنموذج (ASSISTANT_DOCUMENT_REVIEW متوقف)؛ دُققت البيانات وحالة الملفات فقط.',
    }
  } catch (error) {
    console.error('[assistant] review model call failed', modelErrorKind(error))
    recordUsage('review', { errors: 1 })
    return {
      ...rules,
      ...base,
      source: 'RULES',
      model: null,
      documentsSent: 0,
      notice: `${describeModelError(error)} هذه نتيجة القواعد الآلية.`,
    }
  }
}
