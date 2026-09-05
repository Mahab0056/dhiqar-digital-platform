import type express from 'express'
import { requireSession } from '../auth/session.js'
import { db } from '../db.js'
import { registrySummary } from '../department-registry.js'
import { getRegistryDepartments } from '../departments.js'

export function registerOperationsRoutes(app: express.Express) {
  app.post(
    '/api/presence/heartbeat',
    requireSession('CITIZEN', 'EMPLOYEE', 'IDENTITY_REVIEWER', 'OPERATIONS', 'SUPER_ADMIN'),
    (_req, res) => {
      res.json({ activeWindowSeconds: 120 })
    }
  )

  app.get('/api/dashboard/stats', requireSession('EMPLOYEE', 'OPERATIONS', 'SUPER_ADMIN'), (_req, res) => {
    const departments = getRegistryDepartments()
    const dynamic = departments.reduce(
      (total, department) => ({
        total: total.total + department.transactions,
        completed: total.completed + department.completed,
      }),
      { total: 0, completed: 0 }
    )
    const activeSince = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    const activeCitizens = db
      .prepare(
        `SELECT COUNT(DISTINCT session_subject) AS total FROM live_presence WHERE role = 'CITIZEN' AND last_seen_at >= ?`
      )
      .get(activeSince) as { total: number }
    const activeEmployees = db
      .prepare(
        `SELECT COUNT(DISTINCT session_subject) AS total FROM live_presence WHERE role IN ('EMPLOYEE', 'IDENTITY_REVIEWER') AND last_seen_at >= ?`
      )
      .get(activeSince) as { total: number }
    const payments = db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS collected FROM payments WHERE status = 'SETTLED'`)
      .get() as { collected: number }
    const dateRows = db
      .prepare(
        `SELECT day, COUNT(*) AS applications, SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS completed FROM (
      SELECT substr(created_at, 1, 10) AS day, status FROM applications
      UNION ALL
      SELECT substr(created_at, 1, 10) AS day, status FROM service_requests
    ) GROUP BY day`
      )
      .all() as Array<{ day: string; applications: number; completed: number | null }>
    const byDay = new Map(dateRows.map(row => [row.day, row]))
    const series = Array.from({ length: 7 }, (_, index) => {
      const date = new Date()
      date.setUTCDate(date.getUTCDate() - (6 - index))
      const key = date.toISOString().slice(0, 10)
      const row = byDay.get(key)
      return {
        day: key.slice(5).split('-').reverse().join('/'),
        applications: row?.applications || 0,
        completed: row?.completed || 0,
      }
    })
    const complaints = departments.reduce((total, department) => total + department.openFeedback, 0)
    res.json({
      todayApplications: byDay.get(new Date().toISOString().slice(0, 10))?.applications || 0,
      completed: dynamic.completed,
      overdue: 0,
      activeCitizens: activeCitizens.total,
      activeEmployees: activeEmployees.total,
      departmentsOnline: registrySummary.verified,
      financialCollection: payments.collected,
      complaints,
      avgProcessingHours: 0,
      automationRate: 0,
      series,
      departments,
      registry: registrySummary,
    })
  })

  app.get('/api/operations/cameras', requireSession('EMPLOYEE', 'OPERATIONS', 'SUPER_ADMIN'), (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, department_id, label, stream_type, enabled, authorization_status, source_name, source_url, last_checked_at, created_at, updated_at
      FROM department_cameras ORDER BY department_id ASC, updated_at DESC`
      )
      .all() as Array<Record<string, unknown>>
    res.json(
      rows.map(row => ({
        id: String(row.id),
        departmentId: String(row.department_id),
        label: String(row.label),
        streamType: String(row.stream_type),
        enabled: Boolean(row.enabled),
        authorizationStatus: String(row.authorization_status),
        sourceName: row.source_name ? String(row.source_name) : null,
        sourceUrl: row.source_url ? String(row.source_url) : null,
        lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      }))
    )
  })

  app.get(
    '/api/operations/new-request-alerts',
    requireSession('EMPLOYEE', 'OPERATIONS', 'SUPER_ADMIN'),
    (_req, res) => {
      const serviceRequests = db
        .prepare(
          `SELECT sr.reference, sc.name AS service_name, d.name AS department_name, sr.status, sr.created_at, sr.updated_at
      FROM service_requests sr JOIN service_catalog sc ON sc.id = sr.service_id JOIN departments d ON d.id = sr.department_id
      WHERE sr.status IN ('SUBMITTED', 'APPOINTMENT_REQUESTED') ORDER BY sr.created_at DESC LIMIT 30`
        )
        .all() as Array<Record<string, unknown>>
      const applications = db
        .prepare(
          `SELECT reference, service_name, department AS department_name, status, created_at, updated_at
      FROM applications WHERE status = 'SUBMITTED' ORDER BY created_at DESC LIMIT 30`
        )
        .all() as Array<Record<string, unknown>>
      const alerts = [...serviceRequests, ...applications]
        .map(item => ({
          reference: String(item.reference),
          serviceName: String(item.service_name),
          department: String(item.department_name),
          status: String(item.status),
          createdAt: String(item.created_at),
          updatedAt: String(item.updated_at),
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 30)
      res.json({ alerts, generatedAt: new Date().toISOString() })
    }
  )
}
