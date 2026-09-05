import { createHmac, randomUUID } from 'node:crypto'
import { db, ensureDemoCitizen } from '../server/db.js'

const base = process.argv[2] || 'http://127.0.0.1:8798'
const secret = process.env.SESSION_SECRET || 'realtime-notification-ui-qa-session-secret-long'
const sign = (sub, role) => {
  const payload = Buffer.from(JSON.stringify({ sub, role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
    'base64url'
  )
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
const citizenId = ensureDemoCitizen()
const reference = `TQD-UIWS-${randomUUID().slice(0, 8)}`
const timestamp = new Date().toISOString()
db.prepare(
  `INSERT INTO applications (reference, citizen_id, citizen_name, service_key, service_name, department, status, current_action, business_name, activity_type, address, district, ownership_type, lat, lng, fee, payment_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
).run(
  reference,
  citizenId,
  'مواطن فحص الإشعار الحي',
  'store-license',
  'إجازة فتح محل',
  'بلدية الناصرية',
  'UNDER_REVIEW',
  'بانتظار مراجعة الموظف.',
  'محل فحص',
  'مكتب خدمات',
  'الناصرية',
  'الناصرية',
  'rent',
  31.042,
  46.267,
  0,
  'NOT_REQUIRED',
  timestamp,
  timestamp
)
const pages = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = pages.find(item => item.type === 'page')
if (!page?.webSocketDebuggerUrl) throw new Error('تعذر فتح متصفح فحص الواجهة.')
const socket = new WebSocket(page.webSocketDebuggerUrl)
const waiting = new Map()
const webSocketUrls = []
let id = 1
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const requestId = id++
    waiting.set(requestId, { resolve, reject })
    socket.send(JSON.stringify({ id: requestId, method, params }))
  })
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.method === 'Network.webSocketCreated') webSocketUrls.push(message.params.url)
  if (!message.id || !waiting.has(message.id)) return
  const callback = waiting.get(message.id)
  waiting.delete(message.id)
  message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result)
})
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'فشل فحص الواجهة.')
  return result.result.value
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Network.setCookie', {
  name: 'dhiqar_session',
  value: sign(String(citizenId), 'CITIZEN'),
  url: base,
  httpOnly: true,
  sameSite: 'Lax',
})
await send('Page.navigate', { url: `${base}/citizen` })
await wait(900)
const before = await evaluate(
  `(() => ({ toast: Boolean(document.querySelector('.citizen-realtime-toast')), referenceVisible: document.body.innerText.includes(${JSON.stringify(reference)}) }))()`
)
before.hasSocket = webSocketUrls.some(url => url.includes('/ws/citizen-notifications'))
if (before.toast || !before.hasSocket)
  throw new Error(`citizen page did not establish realtime channel: ${JSON.stringify(before)}`)
const employeeCookie = `dhiqar_session=${sign('employee-ui-qa', 'EMPLOYEE')}`
const requested = await fetch(`${base}/api/applications/${reference}/request-document`, {
  method: 'POST',
  headers: { cookie: employeeCookie, 'content-type': 'application/json' },
  body: JSON.stringify({ documentName: 'فيديو توثيق الوجه القصير' }),
})
if (requested.status !== 200) throw new Error(`request status ${requested.status}`)
await wait(350)
const after = await evaluate(
  `(() => ({ toast: Boolean(document.querySelector('.citizen-realtime-toast')), toastText: document.querySelector('.citizen-realtime-toast')?.textContent || '', referenceVisible: document.body.innerText.includes(${JSON.stringify(reference)}), unreadBadge: document.querySelector('.realtime-unread-badge')?.textContent || '' }))()`
)
if (!after.toast || !after.toastText.includes('مطلوب مستند إضافي') || !after.referenceVisible || !after.unreadBadge)
  throw new Error(`citizen UI did not update from websocket without reload: ${JSON.stringify(after)}`)
console.log(JSON.stringify({ realtime_notification_frontend: 'pass', before, after }, null, 2))
socket.close()
