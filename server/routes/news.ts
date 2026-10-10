import type express from 'express'
import { z } from 'zod'
import { param } from '../http/params.js'
import { adminMutationLimiter } from '../http/rate-limit.js'
import { currentSession, requireSession } from '../auth/session.js'
import { addAudit } from '../db.js'
import { getNewsItem, listNews, newsSourceCounts, newsStatus, refreshNews, setNewsHidden } from '../news/aggregator.js'

const PUBLIC_CACHE = 'public, max-age=300'
const kindSchema = z.enum(['NEWS', 'TENDER'])
const text = (value: unknown, max = 120) =>
  typeof value === 'string' && value.trim() ? value.slice(0, max) : undefined

export function registerNewsRoutes(app: express.Express) {
  app.get('/api/news', (req, res) => {
    const kind = kindSchema.safeParse(req.query.kind)
    const result = listNews({
      limit: Number(req.query.limit) || 20,
      offset: Number(req.query.offset) || 0,
      kind: kind.success ? kind.data : undefined,
      source: text(req.query.source, 80),
      q: text(req.query.q),
    })
    res.setHeader('Cache-Control', PUBLIC_CACHE)
    res.json({ ...result, sources: newsSourceCounts(), updatedAt: newsStatus().updatedAt })
  })

  app.get('/api/news/ticker', (_req, res) => {
    const { items } = listNews({ limit: 12 })
    res.setHeader('Cache-Control', PUBLIC_CACHE)
    res.json({
      updatedAt: newsStatus().updatedAt,
      items: items.map(item => ({
        id: item.id,
        title: item.title,
        link: item.link,
        sourceName: item.sourceName,
        publishedAt: item.publishedAt,
        kind: item.kind,
      })),
    })
  })

  // ---- moderation (super admin) ------------------------------------------------------------------
  const guard = requireSession('SUPER_ADMIN')

  app.get('/api/admin/news', guard, (req, res) => {
    const kind = kindSchema.safeParse(req.query.kind)
    const result = listNews({
      includeHidden: true,
      limit: Number(req.query.limit) || 100,
      offset: Number(req.query.offset) || 0,
      kind: kind.success ? kind.data : undefined,
      q: text(req.query.q),
    })
    res.json({ ...result, status: newsStatus() })
  })

  app.patch('/api/admin/news/:id', guard, adminMutationLimiter, (req, res) => {
    const session = currentSession(res)
    const parsed = z.object({ hidden: z.boolean() }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: 'حدّد hidden (true أو false).' })
    const before = getNewsItem(param(req, 'id'))
    if (!before) return res.status(404).json({ message: 'الخبر غير موجود.' })
    const item = setNewsHidden(before.id, parsed.data.hidden)!
    addAudit({
      actor: session.actor,
      role: session.role,
      action: parsed.data.hidden ? 'NEWS_ITEM_HIDDEN' : 'NEWS_ITEM_SHOWN',
      entityType: 'NewsItem',
      entityId: item.id,
      previousValue: { hidden: before.hidden },
      newValue: { hidden: item.hidden, title: item.title, source: item.sourceName },
    })
    res.json(item)
  })

  app.post('/api/admin/news/refresh', guard, adminMutationLimiter, async (_req, res, next) => {
    try {
      const session = currentSession(res)
      const summary = await refreshNews()
      addAudit({
        actor: session.actor,
        role: session.role,
        action: 'NEWS_REFRESHED',
        entityType: 'NewsFeed',
        entityId: 'news',
        newValue: {
          added: summary.added,
          total: summary.total,
          sources: summary.sources.map(item => `${item.id}:${item.ok ? item.added : 'failed'}`),
        },
      })
      res.json(summary)
    } catch (error) {
      next(error)
    }
  })
}
