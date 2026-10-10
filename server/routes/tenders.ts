import type express from 'express'
import { z } from 'zod'
import { param } from '../http/params.js'
import { adminMutationLimiter } from '../http/rate-limit.js'
import { currentSession, isDeptManager, requireSession, type SessionData } from '../auth/session.js'
import { addAudit, db } from '../db.js'
import {
  createTender,
  getTender,
  listTenders,
  setTenderState,
  tenderEntities,
  updateTender,
  type TenderInput,
  type TenderStatus,
  type TenderType,
} from '../tenders.js'

const statusSchema = z.enum(['OPEN', 'CLOSED', 'CANCELLED', 'AWARDED'])
const typeSchema = z.enum(['TENDER', 'AUCTION'])

const isoDate = z
  .string()
  .trim()
  .max(40)
  .refine(value => Number.isFinite(Date.parse(value)), 'تاريخ غير صالح.')
  .transform(value => new Date(value).toISOString())
const webLink = z
  .string()
  .trim()
  .max(1000)
  .refine(value => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol)
    } catch {
      return false
    }
  }, 'الرابط يجب أن يبدأ بـ https://')
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform(value => (value ? value : value === undefined ? undefined : null))

const tenderBody = z.object({
  reference: z.string().trim().min(1).max(60),
  title: z.string().trim().min(5).max(300),
  type: typeSchema,
  departmentId: z.string().trim().max(80).nullable().optional(),
  entityName: z.string().trim().min(2).max(160).optional(),
  district: optionalText(60),
  description: z.string().trim().max(4000).optional(),
  estimatedCostIqd: z.number().int().min(0).max(1e15).nullable().optional(),
  bidBond: optionalText(200),
  publishedAt: isoDate.optional(),
  closingAt: isoDate,
  documentUrl: webLink
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  sourceUrl: webLink
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
})

const department = (id: string) =>
  db.prepare(`SELECT id, name, district FROM departments WHERE id = ? AND active = 1`).get(id) as
    { id: string; name: string; district: string } | undefined

/** Super admins act on any entity; a department manager only on their own department. */
const canManage = (session: SessionData, departmentId: string | null) =>
  session.role === 'SUPER_ADMIN' || isDeptManager(session, departmentId)

const firstIssue = (error: z.ZodError) => {
  const issue = error.issues[0]
  return issue ? `${issue.path.join('.') || 'الطلب'}: ${issue.message}` : 'بيانات غير صالحة.'
}

const queryText = (value: unknown, max = 120) => (typeof value === 'string' ? value.slice(0, max) : undefined)

export function registerTenderRoutes(app: express.Express) {
  // ---- public ----------------------------------------------------------------------------------
  app.get('/api/tenders', (req, res) => {
    const status = statusSchema.safeParse(req.query.status)
    const type = typeSchema.safeParse(req.query.type)
    const result = listTenders({
      status: status.success ? (status.data as TenderStatus) : undefined,
      type: type.success ? (type.data as TenderType) : undefined,
      departmentId: queryText(req.query.department, 80) || undefined,
      q: queryText(req.query.q),
      limit: Number(req.query.limit) || 50,
      offset: Number(req.query.offset) || 0,
      publishedOnly: true,
    })
    res.setHeader('Cache-Control', 'public, max-age=120')
    res.json({ ...result, entities: tenderEntities() })
  })

  app.get('/api/tenders/:id', (req, res) => {
    const tender = getTender(param(req, 'id'))
    if (!tender || Date.parse(tender.publishedAt) > Date.now())
      return res.status(404).json({ message: 'الإعلان غير موجود أو لم يُنشر بعد.' })
    res.setHeader('Cache-Control', 'public, max-age=120')
    res.json(tender)
  })

  // ---- staff: super admin (any entity) and department managers (own department) ------------------
  const staffGuard = requireSession('SUPER_ADMIN', 'EMPLOYEE')

  app.get('/api/staff/tenders', staffGuard, (_req, res) => {
    const session = currentSession(res)
    if (session.role !== 'SUPER_ADMIN' && !isDeptManager(session, session.departmentId))
      return res.status(403).json({ message: 'إدارة المناقصات متاحة لمدير النظام ومدير الدائرة فقط.' })
    const scope = session.role === 'SUPER_ADMIN' ? undefined : session.departmentId || undefined
    res.json(listTenders({ departmentId: scope, limit: 200 }))
  })

  app.post('/api/staff/tenders', staffGuard, adminMutationLimiter, (req, res) => {
    const session = currentSession(res)
    const parsed = tenderBody.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) })
    const body = parsed.data
    // a manager always publishes for their own department, whatever the body says
    const departmentId = session.role === 'SUPER_ADMIN' ? body.departmentId || null : session.departmentId
    if (!canManage(session, departmentId))
      return res.status(403).json({ message: 'لا تملك صلاحية نشر مناقصات لهذه الجهة.' })
    const dept = departmentId ? department(departmentId) : undefined
    if (departmentId && !dept) return res.status(400).json({ message: 'الدائرة المحددة غير موجودة في سجل الدوائر.' })
    const entityName = dept?.name || body.entityName
    if (!entityName) return res.status(400).json({ message: 'حدّد الجهة المعلنة (دائرة من السجل أو اسم الجهة).' })
    const publishedAt = body.publishedAt || new Date().toISOString()
    if (Date.parse(body.closingAt) <= Date.parse(publishedAt))
      return res.status(400).json({ message: 'موعد الغلق يجب أن يكون بعد تاريخ النشر.' })
    const input: TenderInput = {
      reference: body.reference,
      title: body.title,
      type: body.type,
      departmentId: dept?.id || null,
      entityName,
      district: body.district ?? dept?.district ?? null,
      description: body.description || '',
      estimatedCostIqd: body.estimatedCostIqd ?? null,
      bidBond: body.bidBond ?? null,
      publishedAt,
      closingAt: body.closingAt,
      documentUrl: body.documentUrl ?? null,
      sourceUrl: body.sourceUrl ?? null,
    }
    const tender = createTender(input, session.actor)
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'TENDER_CREATED',
      entityType: 'Tender',
      entityId: tender.id,
      newValue: { reference: tender.reference, title: tender.title, type: tender.type, entity: tender.entityName },
    })
    res.status(201).json(tender)
  })

  app.patch('/api/staff/tenders/:id', staffGuard, adminMutationLimiter, (req, res) => {
    const session = currentSession(res)
    const before = getTender(param(req, 'id'))
    if (!before) return res.status(404).json({ message: 'الإعلان غير موجود.' })
    if (!canManage(session, before.departmentId))
      return res.status(403).json({ message: 'لا تملك صلاحية تعديل إعلانات هذه الجهة.' })
    const parsed = tenderBody.partial().safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) })
    const body = parsed.data
    const changes: Partial<TenderInput> = {
      reference: body.reference,
      title: body.title,
      type: body.type,
      district: body.district,
      description: body.description,
      estimatedCostIqd: body.estimatedCostIqd,
      bidBond: body.bidBond,
      publishedAt: body.publishedAt,
      closingAt: body.closingAt,
      documentUrl: body.documentUrl,
      sourceUrl: body.sourceUrl,
    }
    // only the super admin moves an announcement to another entity
    if (session.role === 'SUPER_ADMIN' && body.departmentId !== undefined) {
      const dept = body.departmentId ? department(body.departmentId) : undefined
      if (body.departmentId && !dept)
        return res.status(400).json({ message: 'الدائرة المحددة غير موجودة في سجل الدوائر.' })
      changes.departmentId = dept?.id || null
      changes.entityName = dept?.name || body.entityName || before.entityName
    } else if (session.role === 'SUPER_ADMIN' && body.entityName && !before.departmentId) {
      changes.entityName = body.entityName
    }
    const publishedAt = changes.publishedAt || before.publishedAt
    const closingAt = changes.closingAt || before.closingAt
    if (Date.parse(closingAt) <= Date.parse(publishedAt))
      return res.status(400).json({ message: 'موعد الغلق يجب أن يكون بعد تاريخ النشر.' })
    const tender = updateTender(before.id, changes, session.actor)!
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'TENDER_UPDATED',
      entityType: 'Tender',
      entityId: tender.id,
      previousValue: { title: before.title, closingAt: before.closingAt, reference: before.reference },
      newValue: { title: tender.title, closingAt: tender.closingAt, reference: tender.reference },
    })
    res.json(tender)
  })

  app.post('/api/staff/tenders/:id/status', staffGuard, adminMutationLimiter, (req, res) => {
    const session = currentSession(res)
    const before = getTender(param(req, 'id'))
    if (!before) return res.status(404).json({ message: 'الإعلان غير موجود.' })
    if (!canManage(session, before.departmentId))
      return res.status(403).json({ message: 'لا تملك صلاحية تعديل إعلانات هذه الجهة.' })
    const parsed = z
      .object({
        // ACTIVE re-opens (open/closed then follows the closing date)
        state: z.enum(['ACTIVE', 'CLOSED', 'CANCELLED', 'AWARDED']),
        note: z.string().trim().max(500).optional(),
      })
      .safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: 'حالة غير معروفة.' })
    const tender = setTenderState(before.id, parsed.data.state, parsed.data.note || null, session.actor)!
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'TENDER_STATUS_CHANGED',
      entityType: 'Tender',
      entityId: tender.id,
      previousValue: { status: before.status },
      newValue: { status: tender.status, note: parsed.data.note || null },
    })
    res.json(tender)
  })
}
