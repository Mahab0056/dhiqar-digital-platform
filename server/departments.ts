import { db } from './db.js'
import { departmentById, departmentRegistry, type DepartmentRegistryItem } from './department-registry.js'

/** Upserts the full Dhi Qar registry into the departments table (idempotent, runs at startup). */
export function seedDepartments() {
  const timestamp = new Date().toISOString()
  const statement = db.prepare(
    `INSERT INTO departments (id, name, name_en, category, parent_ministry, district, address, phone, website, facebook, lat, lng, gis_status, data_status, source_url, services_json, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, name_en = excluded.name_en, category = excluded.category, parent_ministry = excluded.parent_ministry,
       district = excluded.district, address = COALESCE(departments.address, excluded.address), phone = COALESCE(departments.phone, excluded.phone),
       website = excluded.website, facebook = excluded.facebook, lat = COALESCE(departments.lat, excluded.lat), lng = COALESCE(departments.lng, excluded.lng),
       gis_status = excluded.gis_status, data_status = excluded.data_status, source_url = excluded.source_url, services_json = excluded.services_json,
       notes = excluded.notes, updated_at = excluded.updated_at`
  )
  db.exec('BEGIN')
  try {
    for (const item of departmentRegistry) {
      statement.run(
        item.id,
        item.name,
        item.nameEn,
        item.category,
        item.parentMinistry,
        item.district,
        item.address,
        item.phone,
        item.website,
        item.facebook,
        item.lat,
        item.lng,
        item.gisStatus,
        item.dataStatus,
        item.sourceUrl,
        JSON.stringify(item.services),
        item.notes,
        timestamp,
        timestamp
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function publicDepartmentView(item: DepartmentRegistryItem) {
  return {
    id: item.id,
    name: item.name,
    nameEn: item.nameEn,
    category: item.category,
    parentMinistry: item.parentMinistry,
    district: item.district,
    address: item.address,
    phone: item.phone,
    website: item.website,
    facebook: item.facebook,
    lat: item.lat,
    lng: item.lng,
    gisStatus: item.gisStatus,
    dataStatus: item.dataStatus,
    sourceUrl: item.sourceUrl,
    services: item.services,
    notes: item.notes,
  }
}

export function listPublicDepartments() {
  const serviceCounts = db
    .prepare(`SELECT department_id, COUNT(*) AS total FROM service_catalog WHERE active = 1 GROUP BY department_id`)
    .all() as Array<{ department_id: string; total: number }>
  const digitalServices = new Map(serviceCounts.map(row => [row.department_id, Number(row.total)]))
  return departmentRegistry.map(item => ({
    ...publicDepartmentView(item),
    digitalServices: digitalServices.get(item.id) || 0,
  }))
}

export function getRegistryDepartments() {
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

const statusLabel = (status: string) => status

/** Everything a department dashboard needs, scoped to one department. */
export function getDepartmentDashboard(id: string) {
  const item = departmentById.get(id)
  if (!item) return null
  const stats = getRegistryDepartments().find(entry => entry.id === id)!
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const applicationRows = db
    .prepare(
      `SELECT reference, citizen_name, service_name, status, current_action, created_at, updated_at, 'APPLICATION' AS kind
       FROM applications WHERE department = ? ORDER BY updated_at DESC LIMIT 60`
    )
    .all(item.name) as Array<Record<string, unknown>>
  const serviceRequestRows = db
    .prepare(
      `SELECT sr.reference, c.full_name AS citizen_name, sc.name AS service_name, sr.status, sr.current_action, sr.created_at, sr.updated_at, 'SERVICE_REQUEST' AS kind
       FROM service_requests sr JOIN citizens c ON c.id = sr.citizen_id JOIN service_catalog sc ON sc.id = sr.service_id
       WHERE sr.department_id = ? ORDER BY sr.updated_at DESC LIMIT 60`
    )
    .all(id) as Array<Record<string, unknown>>
  const requests = [...applicationRows, ...serviceRequestRows]
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, 60)
    .map(row => ({
      reference: String(row.reference),
      kind: String(row.kind) as 'APPLICATION' | 'SERVICE_REQUEST',
      citizenName: String(row.citizen_name),
      serviceName: String(row.service_name),
      status: statusLabel(String(row.status)),
      currentAction: String(row.current_action || ''),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }))

  const countWhere = (sql: string, ...values: Array<string | number>) =>
    Number((db.prepare(sql).get(...values) as { total: number }).total)
  const todayNew =
    countWhere(
      `SELECT COUNT(*) AS total FROM applications WHERE department = ? AND created_at >= ?`,
      item.name,
      dayStart
    ) +
    countWhere(
      `SELECT COUNT(*) AS total FROM service_requests WHERE department_id = ? AND created_at >= ?`,
      id,
      dayStart
    )
  const weekCompleted =
    countWhere(
      `SELECT COUNT(*) AS total FROM applications WHERE department = ? AND status = 'APPROVED' AND updated_at >= ?`,
      item.name,
      weekStart
    ) +
    countWhere(
      `SELECT COUNT(*) AS total FROM service_requests WHERE department_id = ? AND status IN ('APPROVED', 'COMPLETED') AND updated_at >= ?`,
      id,
      weekStart
    )
  const avgHoursRow = db
    .prepare(
      `SELECT AVG((julianday(updated_at) - julianday(created_at)) * 24) AS hours FROM applications WHERE department = ? AND status = 'APPROVED'`
    )
    .get(item.name) as { hours: number | null }

  const series: Array<{ day: string; created: number; completed: number }> = []
  for (let offset = 13; offset >= 0; offset--) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
    const created =
      countWhere(
        `SELECT COUNT(*) AS total FROM applications WHERE department = ? AND created_at >= ? AND created_at < ?`,
        item.name,
        start.toISOString(),
        end.toISOString()
      ) +
      countWhere(
        `SELECT COUNT(*) AS total FROM service_requests WHERE department_id = ? AND created_at >= ? AND created_at < ?`,
        id,
        start.toISOString(),
        end.toISOString()
      )
    const completed =
      countWhere(
        `SELECT COUNT(*) AS total FROM applications WHERE department = ? AND status = 'APPROVED' AND updated_at >= ? AND updated_at < ?`,
        item.name,
        start.toISOString(),
        end.toISOString()
      ) +
      countWhere(
        `SELECT COUNT(*) AS total FROM service_requests WHERE department_id = ? AND status IN ('APPROVED', 'COMPLETED') AND updated_at >= ? AND updated_at < ?`,
        id,
        start.toISOString(),
        end.toISOString()
      )
    series.push({
      day: `${String(start.getDate()).padStart(2, '0')}/${String(start.getMonth() + 1).padStart(2, '0')}`,
      created,
      completed,
    })
  }

  const services = (
    db
      .prepare(
        `SELECT id, name, category, fee_iqd, fee_status, estimated_duration, active, updated_at FROM service_catalog WHERE department_id = ? ORDER BY name`
      )
      .all(id) as Array<Record<string, unknown>>
  ).map(row => ({
    id: String(row.id),
    name: String(row.name),
    category: String(row.category),
    feeIqd: Number(row.fee_iqd || 0),
    feeStatus: String(row.fee_status),
    estimatedDuration: String(row.estimated_duration || ''),
    active: Boolean(row.active),
    updatedAt: String(row.updated_at),
  }))

  const feedback = (
    db
      .prepare(
        `SELECT reference, kind, category, status, subject, created_at, updated_at FROM citizen_feedback WHERE department_id = ? ORDER BY updated_at DESC LIMIT 30`
      )
      .all(id) as Array<Record<string, unknown>>
  ).map(row => ({
    reference: String(row.reference),
    kind: String(row.kind),
    category: String(row.category),
    status: String(row.status),
    subject: String(row.subject),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }))

  const staff = (
    db
      .prepare(
        `SELECT s.id, s.username, s.full_name, s.role, s.status, s.last_login_at,
           EXISTS(SELECT 1 FROM live_presence p WHERE p.session_subject = s.id AND p.last_seen_at >= ?) AS online
         FROM staff_accounts s WHERE s.department_id = ? ORDER BY s.full_name`
      )
      .all(new Date(now.getTime() - 2 * 60 * 1000).toISOString(), id) as Array<Record<string, unknown>>
  ).map(row => ({
    id: String(row.id),
    username: String(row.username),
    fullName: String(row.full_name),
    role: String(row.role),
    status: String(row.status),
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
    online: Boolean(row.online),
  }))

  const recentActivity = (
    db
      .prepare(
        `SELECT a.actor, a.role, a.action, a.entity_type, a.entity_id, a.created_at FROM audit_logs a
         JOIN staff_accounts s ON a.actor = s.full_name || ' (' || s.username || ')'
         WHERE s.department_id = ? ORDER BY a.id DESC LIMIT 25`
      )
      .all(id) as Array<Record<string, unknown>>
  ).map(row => ({
    actor: String(row.actor),
    role: String(row.role),
    action: String(row.action),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    createdAt: String(row.created_at),
  }))

  return {
    department: publicDepartmentView(item),
    kpis: {
      total: stats.transactions,
      open: stats.underReview + stats.actionRequired,
      underReview: stats.underReview,
      actionRequired: stats.actionRequired,
      completed: stats.completed,
      rejected: stats.rejected,
      todayNew,
      weekCompleted,
      avgProcessingHours: avgHoursRow.hours ? Math.round(avgHoursRow.hours * 10) / 10 : null,
      openFeedback: stats.openFeedback,
      staffTotal: staff.length,
      staffOnline: staff.filter(member => member.online).length,
      digitalServices: services.filter(service => service.active).length,
    },
    series,
    requests,
    services,
    feedback,
    staff,
    workforce: stats.workforce,
    cameras: stats.cameras,
    recentActivity,
  }
}
