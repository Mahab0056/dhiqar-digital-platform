import type express from 'express'
import { requireSession } from '../auth/session.js'
import { addAudit, resetDemo } from '../db.js'

export function registerSystemRoutes(app: express.Express) {
  app.post('/api/system/reset-test-data', requireSession('EMPLOYEE'), (_req, res) => {
    if (process.env.NODE_ENV === 'production') return res.status(404).json({ message: 'المسار غير متاح.' })
    resetDemo()
    addAudit({
      actor: 'Local Operator',
      role: 'EMPLOYEE',
      action: 'LOCAL_TEST_DATA_RESET',
      entityType: 'System',
      entityId: 'local-test-data',
      metadata: { localOnly: true },
    })
    res.json({ success: true })
  })
}
