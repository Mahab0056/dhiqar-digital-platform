import type express from 'express'
import { z } from 'zod'
import { addAudit, db } from '../db.js'
import { createBackup, databaseStats, integrityCheck } from '../db-ops/backup.js'
import { param } from '../http/params.js'
import { sensitiveLimiter } from '../http/rate-limit.js'
import { currentSession, requireSession, revokeStaffSessions } from '../auth/session.js'
import {
  countStaff,
  createStaff,
  disableTotp,
  getStaffById,
  listStaff,
  resetStaffPassword,
  setStaffStatus,
  staffRoles,
  updateStaffProfile,
} from '../auth/staff.js'

const roleSchema = z.enum(['EMPLOYEE', 'IDENTITY_REVIEWER', 'OPERATIONS', 'SUPER_ADMIN'])

export function registerStaffAdminRoutes(app: express.Express) {
  const guard = requireSession('SUPER_ADMIN')

  app.get('/api/super-admin/staff', guard, (_req, res) => {
    const departments = db.prepare(`SELECT id, name FROM departments WHERE active = 1 ORDER BY name`).all() as Array<{
      id: string
      name: string
    }>
    res.json({ accounts: listStaff(), roles: staffRoles, departments })
  })

  app.post('/api/super-admin/staff', guard, sensitiveLimiter, (req, res) => {
    const session = currentSession(res)
    const payload = z
      .object({
        username: z.string().trim().min(3).max(40),
        fullName: z.string().trim().min(3).max(120),
        role: roleSchema,
        departmentId: z.string().trim().max(80).nullable().optional(),
      })
      .parse(req.body)
    let created: ReturnType<typeof createStaff>
    try {
      created = createStaff({ ...payload, departmentId: payload.departmentId || null, createdBy: session.staffId! })
    } catch (error) {
      return res.status(400).json({ message: (error as Error).message })
    }
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'STAFF_ACCOUNT_CREATED',
      entityType: 'StaffAccount',
      entityId: created.account.id,
      newValue: {
        username: created.account.username,
        role: created.account.role,
        departmentId: created.account.departmentId,
      },
    })
    res.status(201).json({ account: created.account, temporaryPassword: created.temporaryPassword })
  })

  app.patch('/api/super-admin/staff/:id', guard, sensitiveLimiter, (req, res) => {
    const session = currentSession(res)
    const id = param(req, 'id')
    const before = getStaffById(id)
    if (!before) return res.status(404).json({ message: 'الحساب غير موجود.' })
    const payload = z
      .object({
        fullName: z.string().trim().min(3).max(120).optional(),
        role: roleSchema.optional(),
        departmentId: z.string().trim().max(80).nullable().optional(),
      })
      .parse(req.body)
    if (
      before.role === 'SUPER_ADMIN' &&
      payload.role &&
      payload.role !== 'SUPER_ADMIN' &&
      countStaff('SUPER_ADMIN') <= 1
    )
      return res.status(409).json({ message: 'لا يمكن إزالة آخر مدير نظام فعّال.' })
    const account = updateStaffProfile(id, payload)
    if (payload.role && payload.role !== before.role) revokeStaffSessions(id, 'ROLE_CHANGED')
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'STAFF_ACCOUNT_UPDATED',
      entityType: 'StaffAccount',
      entityId: id,
      previousValue: { fullName: before.fullName, role: before.role, departmentId: before.departmentId },
      newValue: { fullName: account.fullName, role: account.role, departmentId: account.departmentId },
    })
    res.json({ account })
  })

  app.post('/api/super-admin/staff/:id/status', guard, sensitiveLimiter, (req, res) => {
    const session = currentSession(res)
    const id = param(req, 'id')
    const payload = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).parse(req.body)
    const account = getStaffById(id)
    if (!account) return res.status(404).json({ message: 'الحساب غير موجود.' })
    if (id === session.staffId && payload.status === 'DISABLED')
      return res.status(409).json({ message: 'لا يمكنك تعطيل حسابك الحالي.' })
    if (account.role === 'SUPER_ADMIN' && payload.status === 'DISABLED' && countStaff('SUPER_ADMIN') <= 1)
      return res.status(409).json({ message: 'لا يمكن تعطيل آخر مدير نظام فعّال.' })
    setStaffStatus(id, payload.status)
    if (payload.status === 'DISABLED') revokeStaffSessions(id, 'ACCOUNT_DISABLED')
    addAudit({
      actor: session.actor,
      role: session.role,
      action: payload.status === 'DISABLED' ? 'STAFF_ACCOUNT_DISABLED' : 'STAFF_ACCOUNT_ENABLED',
      entityType: 'StaffAccount',
      entityId: id,
    })
    res.json({ account: getStaffById(id) })
  })

  app.post('/api/super-admin/staff/:id/reset-password', guard, sensitiveLimiter, (req, res) => {
    const session = currentSession(res)
    const id = param(req, 'id')
    if (!getStaffById(id)) return res.status(404).json({ message: 'الحساب غير موجود.' })
    const temporaryPassword = resetStaffPassword(id)
    revokeStaffSessions(id, 'PASSWORD_RESET_BY_ADMIN')
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'STAFF_PASSWORD_RESET',
      entityType: 'StaffAccount',
      entityId: id,
    })
    res.json({ temporaryPassword })
  })

  app.post('/api/super-admin/staff/:id/reset-mfa', guard, sensitiveLimiter, (req, res) => {
    const session = currentSession(res)
    const id = param(req, 'id')
    if (!getStaffById(id)) return res.status(404).json({ message: 'الحساب غير موجود.' })
    disableTotp(id)
    revokeStaffSessions(id, 'MFA_RESET_BY_ADMIN')
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'STAFF_MFA_RESET',
      entityType: 'StaffAccount',
      entityId: id,
    })
    res.json({ success: true })
  })

  app.post('/api/super-admin/staff/:id/revoke-sessions', guard, sensitiveLimiter, (req, res) => {
    const session = currentSession(res)
    const id = param(req, 'id')
    if (!getStaffById(id)) return res.status(404).json({ message: 'الحساب غير موجود.' })
    const revoked = revokeStaffSessions(id, 'REVOKED_BY_ADMIN', id === session.staffId ? session.sid : undefined)
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'STAFF_SESSIONS_REVOKED_BY_ADMIN',
      entityType: 'StaffAccount',
      entityId: id,
      metadata: { revoked },
    })
    res.json({ success: true, revoked })
  })

  app.get('/api/super-admin/system/database', guard, (_req, res) => {
    res.json({ ...databaseStats(), integrity: integrityCheck() })
  })

  app.post('/api/super-admin/system/backups', guard, sensitiveLimiter, (_req, res) => {
    const session = currentSession(res)
    try {
      const entry = createBackup('MANUAL')
      addAudit({
        actor: session.actor,
        role: session.role,
        action: 'DATABASE_BACKUP_CREATED',
        entityType: 'Database',
        entityId: entry.file,
        metadata: { sizeBytes: entry.sizeBytes },
      })
      res.status(201).json(entry)
    } catch (error) {
      res.status(500).json({ message: `تعذر إنشاء النسخة الاحتياطية: ${(error as Error).message}` })
    }
  })

  app.get('/api/super-admin/audit-logs', guard, (req, res) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(100),
        action: z.string().trim().max(80).optional(),
        actor: z.string().trim().max(120).optional(),
      })
      .parse(req.query)
    const where: string[] = []
    const values: Array<string | number> = []
    if (query.action) {
      where.push('action LIKE ?')
      values.push(`%${query.action}%`)
    }
    if (query.actor) {
      where.push('actor LIKE ?')
      values.push(`%${query.actor}%`)
    }
    const rows = db
      .prepare(
        `SELECT id, actor, role, action, entity_type, entity_id, metadata, created_at FROM audit_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`
      )
      .all(...values, query.limit) as Array<Record<string, unknown>>
    res.json(
      rows.map(row => ({
        id: Number(row.id),
        actor: String(row.actor),
        role: String(row.role),
        action: String(row.action),
        entityType: String(row.entity_type),
        entityId: String(row.entity_id),
        metadata: row.metadata ? JSON.parse(String(row.metadata)) : null,
        createdAt: String(row.created_at),
      }))
    )
  })
}
