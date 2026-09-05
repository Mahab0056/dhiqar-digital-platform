import type express from 'express'
import { param } from '../http/params.js'
import { db } from '../db.js'
import { getGovernmentService, listGovernmentServices } from '../government-service-directory.js'

export function registerPublicRoutes(app: express.Express) {
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'Dhi Qar Digital API', time: new Date().toISOString() })
  })

  app.get('/api/government-services', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : undefined
    const dhiQarOnly = req.query.dhiQar === 'true'
    res.json(listGovernmentServices({ query, dhiQarOnly, publicationStatus: 'APPROVED', limit: 200 }))
  })

  app.get('/api/government-services/:id', (req, res) => {
    const service = getGovernmentService(param(req, 'id'))
    if (!service || service.publicationStatus !== 'APPROVED' || !service.active)
      return res.status(404).json({ message: 'الخدمة غير موجودة أو غير منشورة.' })
    res.json(service)
  })

  app.get('/api/platform-services/:key', (req, res) => {
    const item = db
      .prepare(
        `SELECT sc.id, sc.name, sc.department_id, sc.required_documents, sc.active, d.name AS department_name
      FROM service_catalog sc JOIN departments d ON d.id = sc.department_id WHERE sc.id = ?`
      )
      .get(param(req, 'key')) as Record<string, unknown> | undefined
    if (!item || !Number(item.active)) return res.status(404).json({ message: 'الخدمة غير متاحة في سجل المنصة.' })
    res.json({
      id: String(item.id),
      name: String(item.name),
      department: String(item.department_name),
      requiredDocuments: JSON.parse(String(item.required_documents || '[]')),
    })
  })
}
