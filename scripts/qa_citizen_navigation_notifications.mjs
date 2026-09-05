import { writeFile } from 'node:fs/promises'

const baseUrl = process.argv[2] || 'http://127.0.0.1:8800'
const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page =
  targets.find(target => target.type === 'page' && target.url.includes(baseUrl)) ??
  targets.find(target => target.type === 'page')
if (!page?.webSocketDebuggerUrl) throw new Error('لم يتم العثور على صفحة Chrome لفحص تنقل المواطن.')

const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 1
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (!message.id || !pending.has(message.id)) return
  const request = pending.get(message.id)
  pending.delete(message.id)
  if (message.error) request.reject(new Error(message.error.message))
  else request.resolve(message.result)
})
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'فشل فحص المتصفح.')
  return result.result.value
}
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const fixture = {
  unread: 1,
  items: [
    {
      id: 'qa-notification-1',
      type: 'SERVICE_REQUEST_CREATED',
      title: 'تم تسجيل طلب الفحص',
      message: 'وصل الطلب إلى الدائرة المختصة.',
      link: '/citizen',
      readAt: null,
      createdAt: '2026-08-28T12:00:00.000Z',
    },
  ],
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
  const fixture = ${JSON.stringify(fixture)}
  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url
    const method = (init.method || 'GET').toUpperCase()
    const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/api/auth/session')) return json({ authenticated: true, role: 'CITIZEN', subject: 'qa-citizen', expiresAt: '2030-01-01T00:00:00.000Z' })
    if (url.includes('/api/citizen/demo')) return json({ id: 999, fullName: 'مواطن الفحص', nationalIdMasked: '********0000', phoneMasked: '********0000', verificationStatus: 'VERIFIED', district: 'الناصرية', documentType: 'NATIONAL_ID', profileMediaId: null, createdAt: '2026-01-01T00:00:00.000Z' })
    if (url.includes('/api/citizen/applications') || url.includes('/api/citizen/service-requests') || url.includes('/api/citizen/issued-documents')) return json([])
    if (url.includes('/api/presence/heartbeat')) return json({ activeWindowSeconds: 120 })
    if (url.includes('/api/citizen/notifications/read-all') && method === 'POST') { fixture.unread = 0; fixture.items = fixture.items.map(item => ({ ...item, readAt: '2026-08-28T12:05:00.000Z' })); return json(fixture) }
    if (url.includes('/api/citizen/notifications/qa-notification-1/read') && method === 'PATCH') { fixture.unread = 0; fixture.items = fixture.items.map(item => ({ ...item, readAt: '2026-08-28T12:05:00.000Z' })); return json(fixture) }
    if (url.includes('/api/citizen/notifications')) return json(fixture)
    return originalFetch(input, init)
  }
})()`,
})
await send('Page.navigate', { url: `${baseUrl}/citizen` })
await delay(900)

const portalLoaded = await evaluate(`(() => ({
  hasSidebar: Boolean(document.querySelector('.portal-sidebar')),
  hasMenuButton: Boolean(document.querySelector('.mobile-sidebar-button')),
  notificationHref: document.querySelector('.topbar-notification-link')?.getAttribute('href') || null,
  navLinks: [...document.querySelectorAll('.portal-sidebar nav a')].map(a => a.getAttribute('href')),
}))()`)
if (
  !portalLoaded.hasSidebar ||
  !portalLoaded.hasMenuButton ||
  portalLoaded.notificationHref !== '/citizen/notifications' ||
  !portalLoaded.navLinks.includes('/citizen/notifications')
) {
  throw new Error(`قائمة المواطن أو رابط الإشعارات غير مكتمل: ${JSON.stringify(portalLoaded)}`)
}

await evaluate(
  `(() => { document.querySelector('.mobile-sidebar-button')?.click(); return document.querySelector('.portal-sidebar')?.classList.contains('open') })()`
)
const opened = await evaluate(`document.querySelector('.portal-sidebar')?.classList.contains('open') || false`)
if (!opened) throw new Error('لم تفتح قائمة الهاتف عند الضغط على زر القائمة.')

await evaluate(
  `(() => { document.querySelector('.portal-sidebar nav a[href="/citizen#services"]')?.click(); return true })()`
)
await delay(700)
const serviceNavigation = await evaluate(
  `(() => ({ path: location.pathname, hash: location.hash, sidebarOpen: document.querySelector('.portal-sidebar')?.classList.contains('open') || false, servicesPresent: Boolean(document.getElementById('services')) }))()`
)
if (
  serviceNavigation.path !== '/citizen' ||
  serviceNavigation.hash !== '#services' ||
  serviceNavigation.sidebarOpen ||
  !serviceNavigation.servicesPresent
) {
  throw new Error(`تعذر انتقال قائمة الهاتف إلى الخدمات: ${JSON.stringify(serviceNavigation)}`)
}

await send('Page.navigate', { url: `${baseUrl}/citizen/notifications` })
await delay(850)
const notificationsView = await evaluate(`(() => ({
  path: location.pathname,
  heading: document.querySelector('.citizen-notifications-page h1')?.textContent?.trim() || '',
  rowCount: document.querySelectorAll('.citizen-notifications-full-list .citizen-notification-row').length,
  markAllVisible: Boolean(document.querySelector('.citizen-notifications-head button')),
  unreadRow: document.querySelector('.citizen-notifications-full-list .unread')?.textContent?.includes('تم تسجيل طلب الفحص') || false,
}))()`)
if (
  notificationsView.path !== '/citizen/notifications' ||
  notificationsView.heading !== 'إشعارات الحساب' ||
  notificationsView.rowCount !== 1 ||
  !notificationsView.markAllVisible ||
  !notificationsView.unreadRow
) {
  throw new Error(`تعذر فتح قائمة الإشعارات: ${JSON.stringify(notificationsView)}`)
}

await evaluate(`(() => { document.querySelector('.citizen-notifications-head button')?.click(); return true })()`)
await delay(180)
const marked = await evaluate(
  `(() => ({ markAllVisible: Boolean(document.querySelector('.citizen-notifications-head button')), unreadRows: document.querySelectorAll('.citizen-notifications-full-list .unread').length, readRows: document.querySelectorAll('.citizen-notifications-full-list .read').length }))()`
)
if (marked.markAllVisible || marked.unreadRows !== 0 || marked.readRows !== 1)
  throw new Error(`تعذر تعليم الإشعارات كمقروءة: ${JSON.stringify(marked)}`)

const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
await writeFile('/tmp/dhiqar-citizen-notifications-mobile.png', screenshot.data, 'base64')
console.log(
  JSON.stringify(
    {
      citizen_navigation_notifications: 'pass',
      portalLoaded,
      serviceNavigation,
      notificationsView,
      marked,
      screenshot: '/tmp/dhiqar-citizen-notifications-mobile.png',
    },
    null,
    2
  )
)
socket.close()
