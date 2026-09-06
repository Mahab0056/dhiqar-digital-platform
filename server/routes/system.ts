import type express from 'express'
import { requireSession } from '../auth/session.js'
import { addAudit, resetDemo } from '../db.js'

export function registerSystemRoutes(app: express.Express) {
  // Only exists in automated tests / an explicitly opted-in local sandbox. Never registered otherwise.
  const enabled = process.env.NODE_ENV === 'test' || process.env.LOCAL_TEST_RESET === 'true'
  if (!enabled) return
  app.post('/api/system/reset-test-data', requireSession('SUPER_ADMIN'), (_req, res) => {
    if (process.env.NODE_ENV === 'production') return res.status(404).json({ message: 'المسار غير متاح.' })
    resetDemo()
    addAudit({
      actor: 'Local Operator',
      role: 'SUPER_ADMIN',
      action: 'LOCAL_TEST_DATA_RESET',
      entityType: 'System',
      entityId: 'local-test-data',
      metadata: { localOnly: true },
    })
    res.json({ success: true })
  })
}
