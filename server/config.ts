export const port = Number(process.env.PORT || 8787)
export const isProduction = process.env.NODE_ENV === 'production'

export const productionOrigin =
  process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') || 'https://dhiqar-digital-platform-production.up.railway.app'

/** True when the app is served over HTTPS by a hosting provider (Railway/Render) or NODE_ENV=production without local preview. */
export const secureHostedRuntime =
  process.env.RAILWAY_ENVIRONMENT === 'production' ||
  (process.env.NODE_ENV === 'production' && process.env.LOCAL_HTTP_PREVIEW !== 'true')

const customDomainOrigins = (process.env.ALLOWED_ORIGINS || 'https://thi-qar.com,https://www.thi-qar.com')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean)

export const allowedOrigins = new Set([
  productionOrigin,
  ...customDomainOrigins,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
])

export const isLocalPreviewOrigin = (origin: string) =>
  !secureHostedRuntime && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)

export const isAllowedOrigin = (origin?: string | null) =>
  !origin || allowedOrigins.has(origin) || isLocalPreviewOrigin(origin)
