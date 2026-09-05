import type express from 'express'
import { requireSession } from '../auth/session.js'
import { db } from '../db.js'
import { departmentRegistry, registrySummary } from '../department-registry.js'

function getRegistryDepartments() {
  type WorkloadRow = {
    departmentId: string
    total: number
    underReview: number
    actionRequired: number
    completed: number
    rejected: number
  }
  const workload = new Map<string, WorkloadRow>()
  const register = (departmentId: string, status: string, count: number) => {
    const current = workload.get(departmentId) || {
      departmentId,
      total: 0,
      underReview: 0,
      actionRequired: 0,
      completed: 0,
      rejected: 0,
    }
    current.total += count
    if (status === 'UNDER_REVIEW') current.underReview += count
    if (status === 'ACTION_REQUIRED') current.actionRequired += count
    if (status === 'APPROVED') current.completed += count
    if (status === 'REJECTED') current.rejected += count
    workload.set(departmentId, current)
  }
  const registryByName = new Map(departmentRegistry.map(item => [item.name, item.id]))
  const serviceRows = db
    .prepare('SELECT department_id, status, COUNT(*) AS total FROM service_requests GROUP BY department_id, status')
    .all() as Array<{ department_id: string; status: string; total: number }>
  serviceRows.forEach(row => register(String(row.department_id), String(row.status), Number(row.total)))
  const applicationRows = db
    .prepare('SELECT department, status, COUNT(*) AS total FROM applications GROUP BY department, status')
    .all() as Array<{ department: string; status: string; total: number }>
  applicationRows.forEach(row => {
    const departmentId = registryByName.get(String(row.department))
    if (departmentId) register(departmentId, String(row.status), Number(row.total))
  })
  const feedbackRows = db
    .prepare(
      `SELECT department_id, COUNT(*) AS total FROM citizen_feedback
    WHERE department_id IS NOT NULL AND status NOT IN ('RESOLVED', 'CLOSED') GROUP BY department_id`
    )
    .all() as Array<{ department_id: string; total: number }>
  const openFeedbackByDepartment = new Map(feedbackRows.map(row => [String(row.department_id), Number(row.total)]))
  const workforceRows = db
    .prepare(
      `SELECT s.* FROM department_workforce_snapshots s
    JOIN (SELECT department_id, MAX(observed_at) AS observed_at FROM department_workforce_snapshots GROUP BY department_id) latest
      ON latest.department_id = s.department_id AND latest.observed_at = s.observed_at`
    )
    .all() as Array<Record<string, unknown>>
  const workforceByDepartment = new Map(workforceRows.map(row => [String(row.department_id), row]))
  const cameraCounts = db
    .prepare(
      `SELECT department_id, COUNT(*) AS configured, SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled
    FROM department_cameras GROUP BY department_id`
    )
    .all() as Array<{ department_id: string; configured: number; enabled: number | null }>
  const cameraCountByDepartment = new Map(cameraCounts.map(row => [String(row.department_id), row]))
  const latestCameras = db
    .prepare(
      `SELECT c.* FROM department_cameras c
    JOIN (SELECT department_id, MAX(updated_at) AS updated_at FROM department_cameras GROUP BY department_id) latest
      ON latest.department_id = c.department_id AND latest.updated_at = c.updated_at`
    )
    .all() as Array<Record<string, unknown>>
  const latestCameraByDepartment = new Map(latestCameras.map(row => [String(row.department_id), row]))
  return departmentRegistry.map(item => {
    const activity = workload.get(item.id) || {
      departmentId: item.id,
      total: 0,
      underReview: 0,
      actionRequired: 0,
      completed: 0,
      rejected: 0,
    }
    const workforce = workforceByDepartment.get(item.id)
    const cameraCount = cameraCountByDepartment.get(item.id)
    const latestCamera = latestCameraByDepartment.get(item.id)
    const cameraEnabled = Number(cameraCount?.enabled || 0)
    return {
      id: item.id,
      name: item.name,
      type: item.category,
      district: item.district,
      lat: item.lat,
      lng: item.lng,
      status: item.gisStatus === 'COORDINATES_VERIFIED' ? 'ONLINE' : 'UNKNOWN',
      transactions: activity.total,
      submitted: activity.total,
      underReview: activity.underReview,
      actionRequired: activity.actionRequired,
      completed: activity.completed,
      rejected: activity.rejected,
      openFeedback: openFeedbackByDepartment.get(item.id) || 0,
      workforce: workforce
        ? {
            totalEmployees: Number(workforce.total_employees),
            presentEmployees: Number(workforce.present_employees),
            absentEmployees: Number(workforce.absent_employees),
            dataStatus: 'RECORDED_BY_SUPER_ADMIN',
            sourceName: String(workforce.source_name),
            sourceUrl: workforce.source_url ? String(workforce.source_url) : null,
            observedAt: String(workforce.observed_at),
          }
        : {
            totalEmployees: null,
            presentEmployees: null,
            absentEmployees: null,
            dataStatus: 'AWAITING_AUTHORIZED_SOURCE',
            sourceName: null,
            sourceUrl: null,
            observedAt: null,
          },
      cameras: cameraCount
        ? {
            configured: Number(cameraCount.configured),
            enabled: cameraEnabled,
            status:
              cameraEnabled > 0 && latestCamera?.authorization_status === 'AUTHORIZED_GATEWAY'
                ? 'READY_FOR_GATEWAY'
                : 'CONFIGURED_DISABLED',
            sourceName: latestCamera?.source_name ? String(latestCamera.source_name) : null,
            lastCheckedAt: latestCamera?.last_checked_at ? String(latestCamera.last_checked_at) : null,
          }
        : {
            configured: 0,
            enabled: 0,
            status: 'AWAITING_AUTHORIZATION',
            sourceName: null,
            lastCheckedAt: null,
          },
      automation: 0,
      sourceUrl: item.sourceUrl,
      dataStatus: item.dataStatus,
      gisStatus: item.gisStatus,
    }
  })
}

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
