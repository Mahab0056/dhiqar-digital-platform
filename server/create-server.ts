import express from 'express'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './http/app.js'
import { errorHandler } from './http/error-handler.js'
import { installRealtime } from './realtime.js'
import { seedPlatformServiceCatalog } from './seed.js'
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
import { registerSuperAdminRoutes } from './routes/super-admin.js'
import { registerSystemRoutes } from './routes/system.js'
import { registerStaffAdminRoutes } from './routes/staff-admin.js'
import { bootstrapStaffAccounts } from './auth/staff.js'
import { purgeExpiredSessions } from './auth/session.js'

export function createPlatformServer(options: { serveStatic?: boolean } = {}) {
  seedVerifiedGovernmentServices()
  seedPlatformServiceCatalog()
  bootstrapStaffAccounts()
  purgeExpiredSessions()
  setInterval(purgeExpiredSessions, 60 * 60 * 1000).unref()

  const { app, httpServer } = createApp()
  installRealtime(httpServer)

  registerPublicRoutes(app)
  registerAuthRoutes(app)
  registerCitizenRoutes(app)
  registerFeedbackRoutes(app)
  registerServiceRequestsRoutes(app)
  registerOnboardingRoutes(app)
  registerApplicationsRoutes(app)
  registerDocumentsRoutes(app)
  registerOperationsRoutes(app)
  registerSuperAdminRoutes(app)
  registerStaffAdminRoutes(app)
  registerSystemRoutes(app)

  const currentDir = dirname(fileURLToPath(import.meta.url))
  const distDir = join(currentDir, '..', 'dist')
  if (options.serveStatic !== false && existsSync(distDir)) {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }))
    app.get('/{*path}', (_req, res) => res.sendFile(join(distDir, 'index.html')))
  }

  app.use(errorHandler)
  return { app, httpServer }
}
