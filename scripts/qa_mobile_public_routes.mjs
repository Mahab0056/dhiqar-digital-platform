import { mkdir, writeFile } from 'node:fs/promises'

const baseUrl = process.argv[2] || 'http://127.0.0.1:8800'
const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page =
  targets.find(target => target.type === 'page' && target.url.includes(baseUrl)) ??
  targets.find(target => target.type === 'page')
if (!page?.webSocketDebuggerUrl) throw new Error('لم يتم العثور على صفحة Chrome لفحص الهاتف.')
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
  message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result)
})
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'فشل فحص الهاتف.')
  return result.result.value
}
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const errors = []
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text || 'استثناء تشغيل')
})
await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await mkdir('/tmp/dhiqar-mobile-public-routes', { recursive: true })
const routes = [
  { name: 'home', expectedPath: '/', expected: 'منصة ذي قار الرقمية' },
  { name: 'login', expectedPath: '/login', expected: 'الدخول' },
  { name: 'onboarding', expectedPath: '/onboarding', expected: 'تأكيد رقم الهاتف' },
  { name: 'water-service', expectedPath: '/service/water-complaint', expected: 'بلاغ ماء أو مجارٍ' },
  { name: 'national-id', expectedPath: '/service/national-id', expected: 'البطاقة الوطنية الموحدة' },
  { name: 'verify', expectedPath: '/verify', expected: 'التحقق' },
]
const results = []
for (const route of routes) {
  await send('Page.navigate', { url: `${baseUrl}${route.expectedPath}` })
  await delay(650)
  const inspection = await evaluate(`(() => ({
    path: location.pathname,
    text: document.getElementById('root')?.innerText || '',
    notFound: Boolean(document.querySelector('.not-found')),
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    controls: document.querySelectorAll('a,button,input,select,textarea').length,
  }))()`)
  const screenshot = await send('Page.captureScreenshot', { format: 'png' })
  const screenshotPath = `/tmp/dhiqar-mobile-public-routes/${route.name}.png`
  await writeFile(screenshotPath, screenshot.data, 'base64')
  results.push({ ...route, ...inspection, screenshotPath })
}
const failed = results.filter(
  item =>
    item.path !== item.expectedPath ||
    item.notFound ||
    !item.text.includes(item.expected) ||
    item.horizontalOverflow > 1 ||
    item.controls < 1
)
if (errors.length || failed.length) throw new Error(JSON.stringify({ errors, failed }, null, 2))
console.log(JSON.stringify({ mobile_public_routes: 'pass', results }, null, 2))
socket.close()
