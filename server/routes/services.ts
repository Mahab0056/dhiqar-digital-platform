import type { Express } from 'express'
import { catalogSummary, getCatalogService, listCatalogServices, type ServiceChannel } from '../services/catalog.js'
import { searchCatalog } from '../services/search.js'

const channels = new Set<ServiceChannel>(['ONLINE_SUBMISSION', 'APPOINTMENT_REQUIRED', 'INFORMATION_ONLY'])

/** Public, read-only service catalog (DB-driven, seeded from the researched registry). */
export function registerServicesRoutes(app: Express) {
  app.get('/api/services', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : undefined
    const category = typeof req.query.category === 'string' ? req.query.category : undefined
    const departmentId = typeof req.query.department === 'string' ? req.query.department : undefined
    const channelParam = typeof req.query.channel === 'string' ? (req.query.channel as ServiceChannel) : undefined
    const channel = channelParam && channels.has(channelParam) ? channelParam : undefined
    res.json({ items: listCatalogServices({ query, category, departmentId, channel }) })
  })

  app.get('/api/services/summary', (_req, res) => res.json(catalogSummary()))

  /** Ranked search (synonyms + fuzzy). Used by the homepage search box, voice search and the directory. */
  app.get('/api/services/search', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 160) : ''
    const limit = Math.min(40, Math.max(1, Number(req.query.limit) || 12))
    const { hits, tokens } = searchCatalog(query, limit)
    res.json({
      query,
      tokens,
      items: hits.map(hit => ({ ...hit.service, score: Math.round(hit.score * 100) / 100 })),
    })
  })

  app.get('/api/services/:key', (req, res) => {
    const key = String(req.params.key)
    const service = getCatalogService(key)
    if (!service || !service.active) return res.status(404).json({ message: 'الخدمة غير موجودة في الكتالوج.' })
    res.json(service)
  })
}
