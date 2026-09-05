import type express from 'express'
import { z } from 'zod'
import { requireSession, currentCitizen } from '../auth/session.js'
import { countPushSubscriptions, pushEnabled, pushKeys, removePushSubscription, savePushSubscription } from '../push.js'

export function registerPushRoutes(app: express.Express) {
  app.get('/api/push/config', (_req, res) => {
    const keys = pushKeys()
    res.json({ enabled: pushEnabled(), publicKey: keys?.publicKey || null })
  })

  app.get('/api/citizen/push/status', requireSession('CITIZEN'), (_req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    res.json({ enabled: pushEnabled(), devices: countPushSubscriptions(citizen.id) })
  })

  app.post('/api/citizen/push/subscribe', requireSession('CITIZEN'), (req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    if (!pushEnabled()) return res.status(503).json({ message: 'إشعارات المتصفح غير مفعّلة على الخادم.' })
    const payload = z
      .object({
        endpoint: z.string().url().max(2048),
        keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(5).max(500) }),
      })
      .safeParse(req.body)
    if (!payload.success) return res.status(400).json({ message: 'بيانات الاشتراك غير صالحة.' })
    savePushSubscription({
      citizenId: citizen.id,
      endpoint: payload.data.endpoint,
      p256dh: payload.data.keys.p256dh,
      auth: payload.data.keys.auth,
      userAgent: req.get('user-agent') || undefined,
    })
    res.json({ ok: true, devices: countPushSubscriptions(citizen.id) })
  })

  app.post('/api/citizen/push/unsubscribe', requireSession('CITIZEN'), (req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    const endpoint = String(req.body?.endpoint || '')
    if (endpoint) removePushSubscription(citizen.id, endpoint)
    res.json({ ok: true, devices: countPushSubscriptions(citizen.id) })
  })
}
