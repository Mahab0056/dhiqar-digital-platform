// One-off refactoring helper: splits server/index.ts route blocks into server/routes/*.ts modules.
import { readFileSync, writeFileSync } from 'node:fs'

const src = readFileSync('server/index.ts', 'utf8')
const lines = src.split('\n')
const START = 386 // 0-based index of first route line (line 387)
const END = 2960 // exclusive: line 2961 'if (existsSync(distDir))'

const starts = []
for (let i = START; i < END; i++) {
  if (/^(app\.(get|post|patch|put|delete)\(|function |const |type |let )/.test(lines[i])) starts.push(i)
}
const chunks = starts.map((from, idx) => {
  let to = idx + 1 < starts.length ? starts[idx + 1] : END
  while (to > from && lines[to - 1].trim() === '') to--
  const text = lines.slice(from, to).join('\n')
  const route = text.match(/^app\.\w+\(\s*'([^']+)'/)?.[1]
  const name = text.match(/^(?:function|const|type|let)\s+([\w$]+)/)?.[1]
  return { text, route, name }
})

function fileFor(chunk) {
  if (chunk.name) {
    const helperMap = {
      serviceRequestDocumentDetails: 'service-requests',
      serviceRequestAttachments: 'service-requests',
      serializeServiceRequestForEmployee: 'service-requests',
      sendIssuedPdf: 'documents',
      getRegistryDepartments: 'operations',
    }
    if (!helperMap[chunk.name]) throw new Error(`unmapped helper ${chunk.name}`)
    return helperMap[chunk.name]
  }
  const r = chunk.route
  if (r === '/api/health' || r.startsWith('/api/government-services') || r.startsWith('/api/platform-services')) return 'public'
  if (r.startsWith('/api/verify')) return 'documents'
  if (r.includes('issued-documents')) return 'documents'
  if (r.startsWith('/api/auth')) return 'auth'
  if (r.startsWith('/api/citizen/feedback') || r.startsWith('/api/admin/feedback')) return 'feedback'
  if (r.startsWith('/api/service-requests') || r.includes('/service-requests')) return 'service-requests'
  if (r.startsWith('/api/onboarding') || r.startsWith('/api/webhooks') || r.startsWith('/api/admin/')) return 'onboarding'
  if (r === '/api/citizen/location' || r === '/api/citizen/profile-photo') return 'onboarding'
  if (r.startsWith('/api/citizen')) return 'citizen'
  if (r.startsWith('/api/applications') || r === '/api/employee/work-queue-summary') return 'applications'
  if (r.startsWith('/api/presence') || r.startsWith('/api/dashboard') || r.startsWith('/api/operations')) return 'operations'
  if (r.startsWith('/api/super-admin')) return 'super-admin'
  if (r.startsWith('/api/system')) return 'system'
  throw new Error(`unmapped route ${r}`)
}

const files = new Map()
for (const chunk of chunks) {
  const f = fileFor(chunk)
  files.set(f, [...(files.get(f) || []), chunk])
}

// import header of the original index.ts (lines 1..60) minus express/cors/helmet etc.
const originalHeader = lines.slice(0, 61).join('\n')
const importStatements = [...originalHeader.matchAll(/import[\s\S]*?from '[^']+'/g)].map(m => m[0])
const localHelperImports = `import express from 'express'
import multer from 'multer'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { upload, detectedMime, validateUploadedFile } from '../http/upload.js'
import { apiLimiter, sensitiveLimiter } from '../http/rate-limit.js'
import { isProduction, secureHostedRuntime, productionOrigin } from '../config.js'
import {
  type SessionRole,
  type SessionData,
  sessionTtlSeconds,
  secureStringEquals,
  readSession,
  setSession,
  clearSession,
  requireSession,
  currentCitizen,
  hasReviewAccess,
  requireReviewAccess,
  touchPresence,
} from '../auth/session.js'
import { ensureDepartmentRecord } from '../seed.js'
import { notifyCitizen, citizenNotificationRealtime, employeeWorkQueueRealtime } from '../realtime.js'`

const camel = s => s.replace(/-(\w)/g, (_, c) => c.toUpperCase())
for (const [file, list] of files) {
  const body = list
    .map(c => {
      if (c.route) return '  ' + c.text.replace(/\n/g, '\n  ')
      return null
    })
    .filter(Boolean)
    .join('\n\n')
  const helpers = list.filter(c => c.name).map(c => c.text).join('\n\n')
  const header = importStatements
    .filter(s => !/from '(express|cors|helmet|express-rate-limit|multer|node:fs|node:http|node:path|node:url|node:crypto|zod)'/.test(s))
    .map(s => s.replace(/from '\.\//g, "from '../").replace(/from '\.\.\/src\//g, "from '../../src/"))
    .join('\n')
  const out = `${localHelperImports}\n${header}\n\n${helpers ? helpers + '\n\n' : ''}export function register${camel(file[0].toUpperCase() + file.slice(1))}Routes(app: express.Express) {\n${body}\n}\n`
  writeFileSync(`server/routes/${file}.ts`, out)
  console.log(file, list.length, 'blocks')
}
