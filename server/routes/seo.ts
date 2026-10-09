import type express from 'express'
import { listPublicDepartments } from '../departments.js'
import { listGovernmentServices } from '../government-service-directory.js'
import { listCatalogServices } from '../services/catalog.js'

/**
 * Client routes the SPA renders. Anything else gets the SPA's not-found screen with a real 404 status, so
 * crawlers and monitors don't index soft-404 pages. Keep in sync with the <Route> list in src/App.tsx.
 */
const clientRoutes: RegExp[] = [
  /^\/$/,
  /^\/(directory|departments|login|onboarding|verify|privacy|terms|accessibility|employee|operations|governor|super-admin|citizen)\/?$/,
  /^\/(staff\/login|staff\/security|operations\/login|super-admin\/login)\/?$/,
  /^\/(departments|department|government-services|service|verify)\/[^/]+\/?$/,
  /^\/citizen\/(notifications|feedback)\/?$/,
  /^\/citizen\/(feedback|application|request|pay)\/[^/]+\/?$/,
  /^\/citizen\/pay\/[^/]+\/sandbox\/?$/,
]

export const isClientRoute = (path: string) => clientRoutes.some(pattern => pattern.test(path))

const publicPages = [
  '/',
  '/directory',
  '/departments',
  '/verify',
  '/login',
  '/onboarding',
  '/privacy',
  '/terms',
  '/accessibility',
]

const xmlEscape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const siteOrigin = (req: express.Request) =>
  (process.env.PUBLIC_SITE_URL?.trim() || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')

export function registerSeoRoutes(app: express.Express) {
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').setHeader('Cache-Control', 'public, max-age=3600')
    res.send(
      [
        'User-agent: *',
        // personal portals and staff tools are never useful in search results
        'Disallow: /citizen',
        'Disallow: /employee',
        'Disallow: /department/',
        'Disallow: /operations',
        'Disallow: /governor',
        'Disallow: /super-admin',
        'Disallow: /staff/',
        'Disallow: /api/',
        'Allow: /',
        '',
        `Sitemap: ${siteOrigin(req)}/sitemap.xml`,
        '',
      ].join('\n')
    )
  })

  app.get('/sitemap.xml', (req, res) => {
    const origin = siteOrigin(req)
    const urls = new Set<string>(publicPages)
    for (const service of listCatalogServices({})) urls.add(`/service/${encodeURIComponent(service.key)}`)
    for (const department of listPublicDepartments()) urls.add(`/departments/${encodeURIComponent(department.id)}`)
    for (const entry of listGovernmentServices({ publicationStatus: 'APPROVED', limit: 500 }))
      urls.add(`/government-services/${encodeURIComponent(entry.canonicalServiceId || entry.id)}`)
    const body = [...urls].map(path => `  <url><loc>${xmlEscape(origin + path)}</loc></url>`).join('\n')
    res.type('application/xml').setHeader('Cache-Control', 'public, max-age=3600')
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
    )
  })
}
