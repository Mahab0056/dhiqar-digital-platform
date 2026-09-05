import type express from 'express'
import { param } from '../http/params.js'
import { currentSession, requireSession, type SessionData } from '../auth/session.js'
import { departmentById, departmentCategories, registrySummary } from '../department-registry.js'
import { getDepartmentDashboard, listPublicDepartments, publicDepartmentView } from '../departments.js'
import { addAudit } from '../db.js'

/** Department staff see only their own department; operations and super admin see all. */
export function canAccessDepartment(session: SessionData, departmentId: string) {
  if (session.role === 'SUPER_ADMIN' || session.role === 'OPERATIONS') return true
  return Boolean(session.departmentId) && session.departmentId === departmentId
}

export function registerDepartmentRoutes(app: express.Express) {
  app.get('/api/departments', (req, res) => {
    const query = String(req.query.q || '')
      .trim()
      .toLowerCase()
    const category = String(req.query.category || '').trim()
    const district = String(req.query.district || '').trim()
    const items = listPublicDepartments().filter(item => {
      if (category && item.category !== category) return false
      if (district && item.district !== district) return false
      if (!query) return true
      return `${item.name} ${item.nameEn || ''} ${item.category} ${item.district} ${item.parentMinistry || ''} ${item.services.join(' ')}`
        .toLowerCase()
        .includes(query)
    })
    res.json({
      items,
      categories: departmentCategories,
      districts: [...new Set(listPublicDepartments().map(item => item.district))],
      summary: registrySummary,
    })
  })

  app.get('/api/departments/:id', (req, res) => {
    const item = departmentById.get(param(req, 'id'))
    if (!item) return res.status(404).json({ message: 'الدائرة غير موجودة في السجل.' })
    res.json(publicDepartmentView(item))
  })

  app.get(
    '/api/departments/:id/dashboard',
    requireSession('EMPLOYEE', 'IDENTITY_REVIEWER', 'OPERATIONS', 'SUPER_ADMIN'),
    (req, res) => {
      const session = currentSession(res)
      const id = param(req, 'id')
      if (!departmentById.has(id)) return res.status(404).json({ message: 'الدائرة غير موجودة في السجل.' })
      if (!canAccessDepartment(session, id))
        return res.status(403).json({ message: 'لوحة هذه الدائرة متاحة لموظفيها وغرفة العمليات وإدارة المنصة فقط.' })
      const dashboard = getDepartmentDashboard(id)
      if (session.role !== 'SUPER_ADMIN' && session.role !== 'OPERATIONS') {
        // department staff do not need usernames of colleagues beyond names/presence
        dashboard!.staff = dashboard!.staff.map(member => ({ ...member, username: '' }))
      }
      addAudit({
        actor: session.actor,
        role: session.role,
        action: 'DEPARTMENT_DASHBOARD_VIEWED',
        entityType: 'Department',
        entityId: id,
      })
      res.json(dashboard)
    }
  )

  /** Dashboard of the signed-in staff member's own department (shortcut). */
  app.get(
    '/api/me/department',
    requireSession('EMPLOYEE', 'IDENTITY_REVIEWER', 'OPERATIONS', 'SUPER_ADMIN'),
    (_req, res) => {
      const session = currentSession(res)
      if (!session.departmentId) return res.json({ department: null })
      const item = departmentById.get(session.departmentId)
      res.json({ department: item ? publicDepartmentView(item) : null })
    }
  )
}
