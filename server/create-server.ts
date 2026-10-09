import express from 'express'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './http/app.js'
import { errorHandler } from './http/error-handler.js'
import { installRealtime } from './realtime.js'
import { seedServiceCatalog } from './services/catalog.js'
import { registerServicesRoutes } from './routes/services.js'
import { registerPaymentRoutes } from './routes/payments.js'
import { registerPushRoutes } from './routes/push.js'
import { seedVerifiedGovernmentServices } from './government-service-seed.js'
import { registerPublicRoutes } from './routes/public.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerCitizenRoutes } from './routes/citizen.js'
import { registerFeedbackRoutes } from './routes/feedback.js'
import { registerServiceRequestsRoutes } from './routes/service-requests.js'
import { registerOnboardingRoutes } from './routes/onboarding.js'
import { registerApplicationsRoutes } from './routes/applications.js'
import { registerDocumentsRoutes } from './routes/documents.js'
import { registerOperationsRoutes } from './routes/operations.js'
import { registerReportRoutes } from './routes/reports.js'
import { registerSuperAdminRoutes } from './routes/super-admin.js'
import { registerSystemRoutes } from './routes/system.js'
import { registerStaffAdminRoutes } from './routes/staff-admin.js'
import { registerDepartmentRoutes } from './routes/departments.js'
import { seedDepartments } from './departments.js'
import { scheduleBackups } from './db-ops/backup.js'
import { bootstrapStaffAccounts } from './auth/staff.js'
import { purgeExpiredSessions } from './auth/session.js'
import { purgeExpiredMedia } from './media.js'
import { isClientRoute, registerSeoRoutes } from './routes/seo.js'

export function createPlatformServer(options: { serveStatic?: boolean } = {}) {
  seedVerifiedGovernmentServices()
  seedDepartments()
  seedServiceCatalog()
  bootstrapStaffAccounts()
  purgeExpiredSessions()
  scheduleBackups()
  setInterval(purgeExpiredSessions, 60 * 60 * 1000).unref()
  // enforce media retention: run once at boot, then hourly (never crashes the process)
  const safePurge = () => {
    try {
      const removed = purgeExpiredMedia()
      if (removed) console.log(`[media] purged ${removed} expired encrypted object(s)`)
    } catch (error) {
      console.error('[media] purge failed', error)
    }
  }
  safePurge()
  setInterval(safePurge, 60 * 60 * 1000).unref()

  const { app, httpServer } = createApp()
  installRealtime(httpServer)

  registerPublicRoutes(app)
  registerAuthRoutes(app)
  registerCitizenRoutes(app)
  registerFeedbackRoutes(app)
  registerServicesRoutes(app)
  registerServiceRequestsRoutes(app)
  registerPaymentRoutes(app)
  registerPushRoutes(app)
  registerOnboardingRoutes(app)
  registerApplicationsRoutes(app)
  registerDocumentsRoutes(app)
  registerOperationsRoutes(app)
  registerReportRoutes(app)
  registerSuperAdminRoutes(app)
  registerStaffAdminRoutes(app)
  registerDepartmentRoutes(app)
  registerSystemRoutes(app)
  registerSeoRoutes(app)

  // an unknown /api path is a client bug: answer 404 JSON instead of falling through to the SPA's index.html
  app.use('/api', (_req, res) => {
    res.status(404).json({ message: 'المسار المطلوب غير موجود في واجهة المنصة.' })
  })

  const currentDir = dirname(fileURLToPath(import.meta.url))
  const distDir = join(currentDir, '..', 'dist')
  if (options.serveStatic !== false && existsSync(distDir)) {
    // content-hashed bundles never change: cache for a year; a missing chunk is a real 404, not the SPA page
    app.use(
      '/assets',
      express.static(join(distDir, 'assets'), { index: false, immutable: true, maxAge: '1y', fallthrough: false })
    )
    app.use(express.static(distDir, { index: false, maxAge: '1h' }))
    app.get('/{*path}', (req, res) => {
      // index.html must always be revalidated so a new release is picked up immediately
      res.setHeader('Cache-Control', 'no-cache')
      res.status(isClientRoute(req.path) ? 200 : 404).sendFile(join(distDir, 'index.html'))
    })
  }

  app.use(errorHandler)
  return { app, httpServer }
}
