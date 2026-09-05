import type express from 'express'
import { param } from '../http/params.js'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { sensitiveLimiter } from '../http/rate-limit.js'
import { requireSession } from '../auth/session.js'
import { ensureDepartmentRecord } from '../seed.js'
import { addAudit, db, listCitizensForSuperAdmin } from '../db.js'
import { departmentRegistry, registrySummary } from '../department-registry.js'
import {
  getGovernmentService,
  getGovernmentServiceDirectoryStats,
  listGovernmentServiceVersions,
  listGovernmentServices,
  setGovernmentServicePublication,
  upsertGovernmentService,
  type GovernmentServiceRecordInput,
} from '../government-service-directory.js'

export function registerSuperAdminRoutes(app: express.Express) {
  app.get('/api/super-admin/department-workbench', requireSession('SUPER_ADMIN'), (_req, res) => {
    const departments = db
      .prepare(
        `SELECT id, name, category, district, data_status, source_url FROM departments WHERE active = 1 ORDER BY name`
      )
      .all() as Array<Record<string, unknown>>
    const services = db
      .prepare(
        `SELECT sc.id, sc.department_id, sc.name, sc.category, sc.required_documents, sc.active, sc.updated_at FROM service_catalog sc ORDER BY sc.name`
      )
      .all() as Array<Record<string, unknown>>
    const requestRows = db
      .prepare(
        `SELECT sr.reference, sr.department_id, sr.status, sr.current_action, sr.created_at, sr.updated_at, sc.name AS service_name, c.full_name AS citizen_name
      FROM service_requests sr JOIN service_catalog sc ON sc.id = sr.service_id JOIN citizens c ON c.id = sr.citizen_id ORDER BY sr.updated_at DESC LIMIT 250`
      )
      .all() as Array<Record<string, unknown>>
    const applicationRows = db
      .prepare(
        `SELECT reference, department, status, current_action, created_at, updated_at, service_name, citizen_name FROM applications ORDER BY updated_at DESC LIMIT 250`
      )
      .all() as Array<Record<string, unknown>>
    const departmentByName = new Map(departments.map(item => [String(item.name), String(item.id)]))
    const normalisedApplications: Array<Record<string, unknown>> = applicationRows.map(item => ({
      ...item,
      department_id: departmentByName.get(String(item.department)) || null,
    }))
    res.json({
      departments: departments.map(department => ({
        id: String(department.id),
        name: String(department.name),
        category: String(department.category),
        district: String(department.district),
        dataStatus: String(department.data_status),
        sourceUrl: department.source_url ? String(department.source_url) : null,
        services: services
          .filter(service => String(service.department_id) === String(department.id))
          .map(service => ({
            id: String(service.id),
            name: String(service.name),
            category: String(service.category),
            requiredDocuments: JSON.parse(String(service.required_documents || '[]')),
            active: Boolean(service.active),
            updatedAt: String(service.updated_at),
          })),
        requests: [...requestRows, ...normalisedApplications]
          .filter(item => String(item.department_id || '') === String(department.id))
          .slice(0, 40)
          .map(item => ({
            reference: String(item.reference),
            serviceName: String(item.service_name),
            citizenName: String(item.citizen_name),
            status: String(item.status),
            currentAction: String(item.current_action),
            createdAt: String(item.created_at),
            updatedAt: String(item.updated_at),
          })),
      })),
    })
  })

  app.patch('/api/super-admin/platform-services/:key', requireSession('SUPER_ADMIN'), sensitiveLimiter, (req, res) => {
    const payload = z
      .object({
        requiredDocuments: z.array(z.string().trim().min(2).max(240)).min(1).max(24).optional(),
        active: z.boolean().optional(),
      })
      .safeParse(req.body)
    if (!payload.success || (!payload.data.requiredDocuments && payload.data.active === undefined))
      return res.status(400).json({ message: 'أدخل متطلباً واحداً على الأقل أو حدّث حالة الخدمة.' })
    const current = db
      .prepare('SELECT id, required_documents, active FROM service_catalog WHERE id = ?')
      .get(param(req, 'key')) as Record<string, unknown> | undefined
    if (!current) return res.status(404).json({ message: 'الخدمة غير موجودة في سجل المنصة.' })
    const timestamp = new Date().toISOString()
    db.prepare('UPDATE service_catalog SET required_documents = ?, active = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(payload.data.requiredDocuments || JSON.parse(String(current.required_documents || '[]'))),
      payload.data.active === undefined ? Number(current.active) : Number(payload.data.active),
      timestamp,
      param(req, 'key')
    )
    addAudit({
      actor: 'مدير النظام',
      role: 'SUPER_ADMIN',
      action: 'PLATFORM_SERVICE_UPDATED',
      entityType: 'ServiceCatalog',
      entityId: param(req, 'key'),
      previousValue: {
        requiredDocuments: JSON.parse(String(current.required_documents || '[]')),
        active: Boolean(current.active),
      },
      newValue: payload.data,
    })
    res.json({ success: true, updatedAt: timestamp })
  })

  app.post('/api/super-admin/operations/cameras', requireSession('SUPER_ADMIN'), sensitiveLimiter, (req, res) => {
    const payload = z
      .object({
        departmentId: z.string().min(3).max(120),
        label: z.string().min(3).max(160),
        streamType: z.enum(['HLS', 'WEBRTC']),
        gatewayUrl: z
          .string()
          .url()
          .max(2048)
          .optional()
          .refine(value => !value || new URL(value).protocol === 'https:', 'رابط بوابة الكاميرا يجب أن يستخدم HTTPS.'),
        enabled: z.boolean(),
        authorizationStatus: z.enum(['AWAITING_AUTHORIZATION', 'AUTHORIZED_GATEWAY']),
        sourceName: z.string().min(3).max(250).optional(),
        sourceUrl: z.string().url().max(2048).optional(),
        lastCheckedAt: z.string().datetime({ offset: true }).optional(),
      })
      .parse(req.body)
    const department = departmentRegistry.find(item => item.id === payload.departmentId)
    if (!department) return res.status(404).json({ message: 'الدائرة غير موجودة في السجل المعتمد.' })
    if (payload.enabled && (payload.authorizationStatus !== 'AUTHORIZED_GATEWAY' || !payload.gatewayUrl))
      return res.status(400).json({ message: 'تفعيل الكاميرا يتطلب تفويضاً مسجلاً وبوابة HTTPS مصرحاً بها.' })
    ensureDepartmentRecord(department.name)
    const id = `cam_${randomUUID().replaceAll('-', '')}`
    const timestamp = new Date().toISOString()
    db.prepare(
      `INSERT INTO department_cameras (id, department_id, label, stream_type, gateway_url, enabled, authorization_status, source_name, source_url, last_checked_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      payload.departmentId,
      payload.label,
      payload.streamType,
      payload.gatewayUrl || null,
      payload.enabled ? 1 : 0,
      payload.authorizationStatus,
      payload.sourceName || null,
      payload.sourceUrl || null,
      payload.lastCheckedAt || null,
      timestamp,
      timestamp
    )
    addAudit({
      actor: 'مدير النظام',
      role: 'SUPER_ADMIN',
      action: 'DEPARTMENT_CAMERA_CONFIGURED',
      entityType: 'DepartmentCamera',
      entityId: id,
      metadata: {
        departmentId: payload.departmentId,
        streamType: payload.streamType,
        enabled: payload.enabled,
        authorizationStatus: payload.authorizationStatus,
      },
    })
    res.status(201).json({ id, departmentId: payload.departmentId, label: payload.label, configured: true })
  })

  app.post(
    '/api/super-admin/operations/workforce-snapshots',
    requireSession('SUPER_ADMIN'),
    sensitiveLimiter,
    (req, res) => {
      const payload = z
        .object({
          departmentId: z.string().min(3).max(120),
          totalEmployees: z.number().int().min(0).max(100000),
          presentEmployees: z.number().int().min(0).max(100000),
          absentEmployees: z.number().int().min(0).max(100000),
          sourceName: z.string().min(3).max(250),
          sourceUrl: z.string().url().max(2048).optional(),
          observedAt: z.string().datetime({ offset: true }),
        })
        .parse(req.body)
      if (payload.presentEmployees + payload.absentEmployees > payload.totalEmployees)
        return res.status(400).json({ message: 'الحضور والغياب لا يمكن أن يتجاوزا عدد الموظفين الكلي.' })
      const department = departmentRegistry.find(item => item.id === payload.departmentId)
      if (!department) return res.status(404).json({ message: 'الدائرة غير موجودة في السجل المعتمد.' })
      ensureDepartmentRecord(department.name)
      const id = `wrk_${randomUUID().replaceAll('-', '')}`
      db.prepare(
        `INSERT INTO department_workforce_snapshots (id, department_id, total_employees, present_employees, absent_employees, source_name, source_url, authorization_status, observed_at, recorded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'RECORDED_BY_SUPER_ADMIN', ?, 'مدير النظام', ?)`
      ).run(
        id,
        payload.departmentId,
        payload.totalEmployees,
        payload.presentEmployees,
        payload.absentEmployees,
        payload.sourceName,
        payload.sourceUrl || null,
        payload.observedAt,
        new Date().toISOString()
      )
      addAudit({
        actor: 'مدير النظام',
        role: 'SUPER_ADMIN',
        action: 'WORKFORCE_SNAPSHOT_RECORDED',
        entityType: 'DepartmentWorkforceSnapshot',
        entityId: id,
        metadata: {
          departmentId: payload.departmentId,
          observedAt: payload.observedAt,
          sourceName: payload.sourceName,
        },
      })
      res.status(201).json({ id, departmentId: payload.departmentId, recorded: true })
    }
  )

  app.get('/api/super-admin/government-services', requireSession('SUPER_ADMIN'), (req, res) => {
    const publicationStatus =
      typeof req.query.status === 'string'
        ? (req.query.status as 'DRAFT' | 'APPROVED' | 'NEEDS_REVIEW' | 'DISABLED')
        : undefined
    res.json({
      services: listGovernmentServices({ publicationStatus, limit: 500 }),
      stats: getGovernmentServiceDirectoryStats(),
    })
  })

  app.get('/api/super-admin/government-services/:id', requireSession('SUPER_ADMIN'), (req, res) => {
    const service = getGovernmentService(param(req, 'id'))
    if (!service) return res.status(404).json({ message: 'سجل الخدمة غير موجود.' })
    res.json({ service, versions: listGovernmentServiceVersions(service.id) })
  })

  app.post('/api/super-admin/government-services', requireSession('SUPER_ADMIN'), sensitiveLimiter, (req, res) => {
    const payload = z
      .object({
        canonicalServiceId: z.string().min(3).max(160),
        officialNameAr: z.string().min(3).max(500),
        category: z.string().min(2).max(200),
        verificationStatus: z.enum([
          'VERIFIED_UR_PORTAL',
          'VERIFIED_MINISTRY',
          'VERIFIED_GOVERNMENT_AUTHORITY',
          'VERIFIED_MULTIPLE_OFFICIAL_SOURCES',
          'PARTIALLY_VERIFIED',
          'REQUIRES_MANUAL_VERIFICATION',
          'OUTDATED_SOURCE',
          'NEEDS_UPDATE',
        ]),
        publicationStatus: z.enum(['DRAFT', 'APPROVED', 'NEEDS_REVIEW', 'DISABLED']),
        sources: z
          .array(
            z.object({
              sourceType: z.enum(['UR_PORTAL', 'MINISTRY', 'GOVERNMENT_AUTHORITY', 'GOVERNORATE', 'OFFICIAL_ENTITY']),
              authorityName: z.string().min(2).max(240),
              officialUrl: z.string().url().max(1000),
              pageTitle: z.string().max(500).optional(),
              dateAccessed: z.string().min(10).max(40),
              datePublished: z.string().max(40).optional(),
              lastVerifiedDate: z.string().max(40).optional(),
              verificationStatus: z.enum([
                'VERIFIED_UR_PORTAL',
                'VERIFIED_MINISTRY',
                'VERIFIED_GOVERNMENT_AUTHORITY',
                'VERIFIED_MULTIPLE_OFFICIAL_SOURCES',
                'PARTIALLY_VERIFIED',
                'REQUIRES_MANUAL_VERIFICATION',
                'OUTDATED_SOURCE',
                'NEEDS_UPDATE',
              ]),
              sourceNote: z.string().max(4000).optional(),
            })
          )
          .min(1)
          .max(20),
      })
      .passthrough()
      .parse(req.body) as GovernmentServiceRecordInput
    if (payload.publicationStatus === 'APPROVED' && !payload.sources.length)
      return res.status(422).json({ message: 'لا يمكن نشر خدمة بلا مصدر حكومي رسمي.' })
    const service = upsertGovernmentService(payload, 'مدير النظام')
    res.status(201).json(service)
  })

  app.patch(
    '/api/super-admin/government-services/:id/publication',
    requireSession('SUPER_ADMIN'),
    sensitiveLimiter,
    (req, res) => {
      const payload = z
        .object({
          publicationStatus: z.enum(['DRAFT', 'APPROVED', 'NEEDS_REVIEW', 'DISABLED']),
          reason: z.string().max(1000).optional(),
        })
        .parse(req.body)
      const service = setGovernmentServicePublication({
        id: param(req, 'id'),
        publicationStatus: payload.publicationStatus,
        reason: payload.reason,
        actor: 'مدير النظام',
      })
      if (!service) return res.status(404).json({ message: 'سجل الخدمة غير موجود.' })
      res.json(service)
    }
  )

  app.get('/api/super-admin/citizens', requireSession('SUPER_ADMIN'), (req, res) => {
    const filters = z
      .object({
        q: z.string().trim().max(80).optional(),
        verificationStatus: z
          .enum([
            'PHONE_VERIFIED',
            'PENDING_REVIEW',
            'VERIFIED',
            'VERIFIED_MANUAL',
            'VERIFIED_UR_PORTAL',
            'NEEDS_RESUBMISSION',
            'REJECTED',
          ])
          .optional(),
        documentType: z.enum(['NATIONAL_ID', 'PASSPORT', 'DRIVING_LICENSE', 'UNSPECIFIED']).optional(),
        limit: z.coerce.number().int().min(1).max(250).optional(),
      })
      .parse(req.query)
    res.json({
      citizens: listCitizensForSuperAdmin({
        query: filters.q,
        verificationStatus: filters.verificationStatus,
        documentType: filters.documentType,
        limit: filters.limit,
      }),
    })
  })

  app.get('/api/super-admin/overview', requireSession('SUPER_ADMIN'), (_req, res) => {
    const audit = db
      .prepare(
        `SELECT actor, role, action, entity_type, entity_id, created_at
      FROM audit_logs ORDER BY created_at DESC LIMIT 20`
      )
      .all() as Array<Record<string, unknown>>
    const pendingIdentity = (
      db.prepare(`SELECT COUNT(*) AS total FROM identity_reviews WHERE status = 'PENDING_REVIEW'`).get() as {
        total: number
      }
    ).total
    const openApplications = (
      db
        .prepare(
          `SELECT COUNT(*) AS total FROM applications WHERE status IN ('SUBMITTED', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'PAYMENT_REQUIRED')`
        )
        .get() as { total: number }
    ).total
    res.json({
      system: {
        pendingIdentity,
        openApplications,
        verifiedDepartments: registrySummary.verified,
        gisLocations: registrySummary.gisComplete,
      },
      recentAudit: audit.map(row => ({
        actor: row.actor,
        role: row.role,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        createdAt: row.created_at,
      })),
    })
  })
}
