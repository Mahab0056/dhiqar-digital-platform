import express from 'express'
import compression from 'compression'
import cors from 'cors'
import helmet from 'helmet'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { allowedOrigins, isLocalPreviewOrigin, secureHostedRuntime } from '../config.js'
import { apiLimiter, identityUploadLimiter, otpRequestLimiter, otpVerifyLimiter } from './rate-limit.js'

export function createApp() {
  const app = express()
  const httpServer = createServer(app)

  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  // gzip every text response (HTML, JS, CSS, JSON) — the CSS bundle alone is ~525 KB uncompressed
  app.use(compression({ threshold: 1024 }))

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'", 'ws:', 'wss:', 'https://nominatim.openstreetmap.org'],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          formAction: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: secureHostedRuntime ? [] : null,
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  )
  app.use(
    cors({
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Review-Access-Code', 'X-CSRF-Token'],
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin) || isLocalPreviewOrigin(origin)) return callback(null, true)
        callback(new Error('Origin غير مصرح.'))
      },
    })
  )
  app.use((_req, res, next) => {
    const requestId = randomUUID()
    res.locals.requestId = requestId
    res.setHeader('X-Request-Id', requestId)
    next()
  })
  app.use('/api', apiLimiter)
  // API responses are private and uncacheable by default (citizen, staff, payment and verification data);
  // only the public catalogue reads below may be cached briefly
  const publicApi = /^\/api\/(health|services|departments|government-services|news|payments\/config|push\/config)(\/|$)/
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' && publicApi.test(req.originalUrl.split('?')[0]) && !/\/dashboard(\/|$)/.test(req.path))
      res.setHeader('Cache-Control', 'public, max-age=60')
    else {
      res.setHeader('Cache-Control', 'no-store, private')
      res.setHeader('Pragma', 'no-cache')
    }
    next()
  })
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false, limit: '64kb' }))
  // Separate budgets so one abused path never locks an office (shared NAT IP) out of the staff API.
  app.use('/api/onboarding/request-otp', otpRequestLimiter)
  app.use('/api/onboarding/verify-phone', otpVerifyLimiter)
  app.use(['/api/onboarding/identity-review', '/api/onboarding/identity-extract-preview'], identityUploadLimiter)

  return { app, httpServer }
}
