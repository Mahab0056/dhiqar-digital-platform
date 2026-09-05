// One-off refactoring helper: splits the monolithic src/App.tsx into pages/components modules.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const root = process.cwd()
const source = readFileSync(join(root, 'src/App.tsx'), 'utf8')
const lines = source.split('\n')

// ---- 1. parse import header -------------------------------------------------
let headerEnd = 0
for (let i = 0; i < lines.length; i++) {
  if (/^function |^const |^type /.test(lines[i])) {
    headerEnd = i
    break
  }
}
const header = lines.slice(0, headerEnd).join('\n')
const importRegex = /import\s+(type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*'([^']+)'/g
/** identifier -> { source, isType, original } */
const importMap = new Map()
for (const match of header.matchAll(importRegex)) {
  const [, typeOnly, defaultName, named, src] = match
  if (defaultName) importMap.set(defaultName, { source: src, isType: !!typeOnly, spec: defaultName, isDefault: true })
  if (named) {
    for (const raw of named.split(',')) {
      const part = raw.trim()
      if (!part) continue
      const m = part.match(/^(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/)
      if (!m) continue
      const local = m[3] || m[2]
      importMap.set(local, { source: src, isType: !!typeOnly || !!m[1], spec: m[3] ? `${m[2]} as ${m[3]}` : m[2] })
    }
  }
}

// ---- 2. chunk top-level statements -----------------------------------------
const starts = []
for (let i = headerEnd; i < lines.length; i++) {
  const m = lines[i].match(/^(?:export\s+)?(?:default\s+)?(?:function|const|type|let)\s+([A-Za-z_$][\w$]*)/)
  if (m) starts.push({ name: m[1], line: i })
  else if (/^export default/.test(lines[i])) starts.push({ name: '__exportDefault', line: i })
}
const chunks = new Map()
for (let i = 0; i < starts.length; i++) {
  const from = starts[i].line
  let to = i + 1 < starts.length ? starts[i + 1].line : lines.length
  while (to > from && lines[to - 1].trim() === '') to--
  chunks.set(starts[i].name, lines.slice(from, to).join('\n'))
}

// ---- 3. grouping ------------------------------------------------------------
const groups = {
  'components/public/CivicUtilityBar.tsx': ['CivicUtilityBar'],
  'components/public/Brand.tsx': ['Brand'],
  'components/public/PublicHeader.tsx': ['PublicHeader'],
  'components/public/Footer.tsx': ['Footer'],
  'components/public/NewsCarousel.tsx': ['NewsCarousel'],
  'components/public/ProcurementSection.tsx': ['ProcurementSection'],
  'components/public/OfficialGovernmentServiceCatalog.tsx': ['OfficialGovernmentServiceCatalog'],
  'pages/public/LandingPage.tsx': ['LandingPage'],
  'pages/public/GovernmentServiceDetailPage.tsx': ['GovernmentServiceDetailPage'],
  'pages/public/GovernmentDirectoryPage.tsx': ['GovernmentDirectoryPage'],
  'pages/auth/LoginPage.tsx': ['LoginPage'],
  'pages/auth/OperationsLogin.tsx': ['OperationsLogin'],
  'pages/auth/SuperAdminLogin.tsx': ['SuperAdminLogin'],
  'pages/super-admin/GovernmentServiceAdminPanel.tsx': ['GovernmentServiceAdminPanel'],
  'components/shared/NewRequestAlertsPanel.tsx': ['NewRequestAlertsPanel'],
  'pages/super-admin/DepartmentManagementPanel.tsx': ['DepartmentManagementPanel'],
  'pages/super-admin/AdminCitizensPanel.tsx': ['AdminCitizensPanel'],
  'pages/super-admin/SuperAdminDashboard.tsx': ['SuperAdminDashboard'],
  'components/camera/SecureCameraCapture.tsx': ['CaptureMode', 'SecureCameraCapture'],
  'pages/citizen/OnboardingPage.tsx': ['OnboardingPage'],
  'components/citizen/PortalLayout.tsx': ['citizenNav', 'CitizenProfileAvatar', 'PortalLayout'],
  'pages/citizen/CitizenDashboard.tsx': ['CitizenDashboard'],
  'pages/citizen/CitizenNotificationsPage.tsx': ['CitizenNotificationsPage'],
  'pages/citizen/feedback-labels.ts': ['feedbackStatusLabels', 'feedbackCategories'],
  'pages/citizen/CitizenFeedbackPage.tsx': ['CitizenFeedbackPage'],
  'pages/citizen/CitizenFeedbackDetailPage.tsx': ['CitizenFeedbackDetailPage'],
  'pages/services/ServiceRequirements.tsx': ['ServiceRequirements'],
  'pages/services/submission-access.tsx': [
    'CitizenSubmissionAccess',
    'onboardingPathForService',
    'useCitizenSubmissionAccess',
    'ServiceSubmissionNotice',
    'PublicServiceFrame',
  ],
  'pages/services/DynamicServiceFormPage.tsx': ['DynamicServiceFormPage'],
  'pages/services/ServiceFormPage.tsx': ['ServiceFormPage'],
  'pages/services/SpecializedServiceFormPage.tsx': ['SpecializedServiceFormPage'],
  'components/citizen/CitizenPdfActions.tsx': ['CitizenPdfActions'],
  'pages/citizen/ApplicationPage.tsx': ['ApplicationPage'],
  'pages/employee/IdentityReviewPanel.tsx': ['IdentityReviewPanel'],
  'pages/employee/FeedbackAdminPanel.tsx': ['FeedbackAdminPanel'],
  'pages/employee/ServiceRequestAdminPanel.tsx': ['ServiceRequestAdminPanel'],
  'pages/employee/EmployeeDashboard.tsx': ['EmployeeDashboard'],
  'components/operations/OperationsShell.tsx': ['OperationsShell'],
  'components/operations/DhiQarMap.tsx': ['DhiQarMap'],
  'components/operations/OperationsRegistryPanel.tsx': ['OperationsRegistryPanel'],
  'pages/operations/OperationsCenter.tsx': ['OperationsCenter'],
  'pages/operations/GovernorDashboard.tsx': ['GovernorDashboard'],
  'pages/verify/VerifyScanner.tsx': ['VerifyScanner'],
  'pages/verify/VerifyPage.tsx': ['VerifyPage'],
  'components/shared/SessionGate.tsx': ['SessionGate'],
  'pages/NotFound.tsx': ['NotFound'],
}

const symbolFile = new Map()
for (const [file, names] of Object.entries(groups)) for (const n of names) symbolFile.set(n, file)
for (const name of chunks.keys()) {
  if (!symbolFile.has(name) && name !== 'App' && name !== '__exportDefault') throw new Error(`unassigned symbol ${name}`)
}

const isType = name => chunks.get(name)?.startsWith('type ')
const usesWord = (body, word) => new RegExp(`(?<![\\w$.])${word.replace('$', '\\$')}(?![\\w$])`).test(body)

function relImport(fromFile, toFile) {
  let rel = relative(dirname(fromFile), toFile).replace(/\\/g, '/').replace(/\.tsx?$/, '')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel
}

function buildImports(fromFile, body, ownSymbols) {
  const external = new Map() // source -> { values:Set, types:Set, default }
  for (const [ident, meta] of importMap) {
    if (!usesWord(body, ident)) continue
    const bucket = external.get(meta.source) || { values: new Set(), types: new Set(), default: null }
    if (meta.isDefault) bucket.default = ident
    else (meta.isType ? bucket.types : bucket.values).add(meta.spec)
    external.set(meta.source, bucket)
  }
  const internal = new Map() // file -> {values, types}
  for (const [sym, file] of symbolFile) {
    if (ownSymbols.includes(sym) || file === fromFile) continue
    if (!usesWord(body, sym)) continue
    const bucket = internal.get(file) || { values: new Set(), types: new Set() }
    ;(isType(sym) ? bucket.types : bucket.values).add(sym)
    internal.set(file, bucket)
  }
  const out = []
  const order = ['react', 'wouter', 'lucide-react', 'recharts', 'react-leaflet', 'leaflet/dist/leaflet.css']
  const sources = [...external.keys()].sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b)
  })
  for (const src of sources) {
    const b = external.get(src)
    const target = src.startsWith('./') ? relImport(fromFile, `src/${src.slice(2)}`) : src
    if (b.values.size || b.default) {
      const parts = []
      if (b.default) parts.push(b.default)
      if (b.values.size) parts.push(`{ ${[...b.values].join(', ')} }`)
      out.push(`import ${parts.join(', ')} from '${target}'`)
    }
    if (b.types.size) out.push(`import type { ${[...b.types].join(', ')} } from '${target}'`)
  }
  if (usesWord(body, 'React.') || /React\./.test(body)) {
    // body references React namespace (React.ReactNode etc.)
    out.unshift(`import type React from 'react'`)
  }
  for (const [file, b] of [...internal].sort()) {
    const target = relImport(fromFile, `src/${file}`)
    if (b.values.size) out.push(`import { ${[...b.values].join(', ')} } from '${target}'`)
    if (b.types.size) out.push(`import type { ${[...b.types].join(', ')} } from '${target}'`)
  }
  return out.join('\n')
}

function exportify(chunk) {
  return chunk.replace(/^(function|const|type|let)\s/, 'export $1 ')
}

// ---- 4. write files ---------------------------------------------------------
for (const [file, names] of Object.entries(groups)) {
  const body = names.map(n => exportify(chunks.get(n))).join('\n\n')
  const fromFile = `src/${file}`
  const imports = buildImports(fromFile, body, names)
  mkdirSync(dirname(join(root, fromFile)), { recursive: true })
  writeFileSync(join(root, fromFile), `${imports}\n\n${body}\n`)
}

// ---- 5. new App.tsx with lazy routes ---------------------------------------
const lazyPages = [
  'LandingPage',
  'GovernmentDirectoryPage',
  'GovernmentServiceDetailPage',
  'LoginPage',
  'OperationsLogin',
  'SuperAdminLogin',
  'SuperAdminDashboard',
  'OnboardingPage',
  'CitizenNotificationsPage',
  'CitizenFeedbackPage',
  'CitizenFeedbackDetailPage',
  'CitizenDashboard',
  'ServiceFormPage',
  'ApplicationPage',
  'EmployeeDashboard',
  'OperationsCenter',
  'GovernorDashboard',
  'VerifyScanner',
  'VerifyPage',
]
let appChunk = chunks.get('App')
const lazyImports = lazyPages
  .map(name => `const ${name} = lazy(() => import('./${symbolFile.get(name).replace(/\.tsx$/, '')}').then(m => ({ default: m.${name} })))`)
  .join('\n')
const appFile = `import { lazy, Suspense } from 'react'
import { Route, Switch } from 'wouter'
import 'leaflet/dist/leaflet.css'
import { SessionGate } from './components/shared/SessionGate'
import { NotFound } from './pages/NotFound'
import { RouteFallback } from './components/shared/RouteFallback'
import './App.css'

${lazyImports}

${appChunk.replace('return (\n    <Switch>', 'return (\n    <Suspense fallback={<RouteFallback />}>\n    <Switch>').replace('    </Switch>\n  )', '    </Switch>\n    </Suspense>\n  )')}

export default App
`
writeFileSync(join(root, 'src/App.tsx'), appFile)
console.log(`wrote ${Object.keys(groups).length} modules`)
