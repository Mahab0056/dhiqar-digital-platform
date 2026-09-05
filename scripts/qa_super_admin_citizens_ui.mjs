import { createHmac, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { db, ensureDemoCitizen } from '../server/db.js'

const base = process.argv[2] || 'http://127.0.0.1:8815'
const secret = process.env.SESSION_SECRET || 'super-admin-citizens-ui-qa-secret-long'
const sign = (sub, role) => {
  const payload = Buffer.from(
    JSON.stringify({ sub, role, exp: Math.floor(Date.now() / 1000) + 3600, sid: randomUUID() })
  ).toString('base64url')
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
const timestamp = new Date().toISOString()
ensureDemoCitizen()
const alphaName = 'مواطن فحص ألف'
const betaName = 'مواطن فحص باء'
db.prepare(
  `INSERT INTO citizens (full_name, national_id_masked, phone_masked, account_key, verification_status, district, document_type, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
).run(
  alphaName,
  '1000********',
  '0780*****001',
  `admin-ui-${randomUUID()}`,
  'VERIFIED',
  'الناصرية',
  'NATIONAL_ID',
  timestamp,
  timestamp
)
db.prepare(
  `INSERT INTO citizens (full_name, national_id_masked, phone_masked, account_key, verification_status, district, document_type, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
).run(
  betaName,
  '2000********',
  '0780*****002',
  `admin-ui-${randomUUID()}`,
  'REJECTED',
  'الشطرة',
  'PASSPORT',
  timestamp,
  timestamp
)

const pages = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = pages.find(item => item.type === 'page')
if (!page?.webSocketDebuggerUrl) throw new Error('تعذر فتح متصفح فحص لوحة الإدارة.')
const socket = new WebSocket(page.webSocketDebuggerUrl)
const waiting = new Map()
const runtimeErrors = []
const consoleErrors = []
let requestId = 1
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = requestId++
    waiting.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown')
    runtimeErrors.push({
      text: message.params.exceptionDetails.text || 'Runtime exception',
      detail: message.params.exceptionDetails.exception?.description || '',
      url: message.params.exceptionDetails.url || '',
      line: message.params.exceptionDetails.lineNumber ?? null,
      column: message.params.exceptionDetails.columnNumber ?? null,
    })
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error')
    consoleErrors.push(message.params.entry.text)
  if (!message.id || !waiting.has(message.id)) return
  const handler = waiting.get(message.id)
  waiting.delete(message.id)
  message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result)
})
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'فشل فحص الواجهة.')
  return result.result.value
}
await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Log.enable')
await send('Network.setCookie', {
  name: 'dhiqar_session',
  value: sign('super-admin-ui-qa', 'SUPER_ADMIN'),
  url: base,
  httpOnly: true,
  sameSite: 'Lax',
})
await send('Page.navigate', { url: `${base}/super-admin` })
await wait(1800)
const initial = await evaluate(
  `(() => ({ panel: Boolean(document.querySelector('#admin-citizens')), alpha: document.body.innerText.includes(${JSON.stringify(alphaName)}), beta: document.body.innerText.includes(${JSON.stringify(betaName)}), path: window.location.pathname, body: document.body.innerText.slice(0, 600), root: document.querySelector('#root')?.innerHTML.slice(0, 300) || '' }))()`
)
if (!initial.panel || !initial.alpha)
  throw new Error(`لم تظهر قائمة المواطنين للمدير: ${JSON.stringify({ ...initial, runtimeErrors, consoleErrors })}`)
await evaluate(`(() => { const input = document.querySelector('.admin-citizen-search input'); input.focus(); })()`)
await send('Input.insertText', { text: alphaName })
await wait(650)
const searched = await evaluate(
  `(() => ({ alpha: document.body.innerText.includes(${JSON.stringify(alphaName)}), beta: document.body.innerText.includes(${JSON.stringify(betaName)}) }))()`
)
if (!searched.alpha) throw new Error(`فشل بحث المواطنين: ${JSON.stringify(searched)}`)
await evaluate(
  `(() => { const input = document.querySelector('.admin-citizen-search input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); const select = document.querySelectorAll('.admin-citizen-controls select')[1]; const change = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; change.call(select, 'PASSPORT'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`
)
await wait(650)
const filtered = await evaluate(
  `(() => ({ alpha: document.body.innerText.includes(${JSON.stringify(alphaName)}), beta: document.body.innerText.includes(${JSON.stringify(betaName)}) }))()`
)
if (filtered.alpha) throw new Error(`فشل فلتر نوع المستند: ${JSON.stringify(filtered)}`)
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await send('Page.reload', { ignoreCache: true })
await wait(850)
const mobile = await evaluate(
  `(() => ({ panel: Boolean(document.querySelector('#admin-citizens')), overflow: document.documentElement.scrollWidth > window.innerWidth + 1, controls: Boolean(document.querySelector('.admin-citizen-controls')), list: Boolean(document.querySelector('.admin-citizen-list')) }))()`
)
if (!mobile.panel || mobile.overflow || !mobile.controls || !mobile.list)
  throw new Error(`فشل فحص هاتف سجل المواطنين: ${JSON.stringify(mobile)}`)
await evaluate(`document.querySelector('#admin-citizens')?.scrollIntoView({ block: 'start' })`)
await wait(300)
const screenshot = await send('Page.captureScreenshot', { format: 'png' })
await writeFile('/tmp/dhiqar-super-admin-citizens-mobile.png', Buffer.from(screenshot.data, 'base64'))
console.log(JSON.stringify({ super_admin_citizens_ui: 'pass', initial, searched, filtered, mobile }, null, 2))
socket.close()
