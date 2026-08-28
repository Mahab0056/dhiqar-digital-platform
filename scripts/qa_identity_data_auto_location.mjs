import { writeFile } from 'node:fs/promises'

const baseUrl = process.argv[2] || 'http://127.0.0.1:8800'
const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find(target => target.type === 'page' && target.url.includes(baseUrl)) ?? targets.find(target => target.type === 'page')
if (!page?.webSocketDebuggerUrl) throw new Error('لم يتم العثور على صفحة Chrome لفحص الهوية.')
const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 1
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (!message.id || !pending.has(message.id)) return; const request = pending.get(message.id); pending.delete(message.id); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result) })
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
const evaluate = async expression => { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'تعذر فحص الهوية.'); return response.result.value }
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const originalFetch = window.fetch.bind(window)
  const citizen = { id: 999, fullName: 'مواطن جديد', nationalIdMasked: '********0000', phoneMasked: '********0000', verificationStatus: 'PENDING_REVIEW', district: 'الناصرية', documentType: 'NATIONAL_ID', profileMediaId: null, createdAt: '2026-01-01T00:00:00.000Z' }
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/auth/session')) return json({ authenticated: true, role: 'CITIZEN', subject: 'qa-citizen', expiresAt: '2030-01-01T00:00:00.000Z' })
    if (url.includes('/api/citizen/demo')) return json(citizen)
    if (url.includes('/api/onboarding/request-otp')) return json({ challengeId: 'qa-otp', phoneMasked: '********0000', expiresInSeconds: 300, deliveryStatus: 'SIMULATED' })
    if (url.includes('/api/onboarding/verify-phone')) return json({ success: true, phoneMasked: '********0000', verifiedAt: '2026-08-28T00:00:00.000Z' })
    if (url.includes('/api/onboarding/identity-extract-preview')) return json({ status: 'COMPLETED', provider: 'فحص محاكى', confidence: .96, documentTypeDetected: 'NATIONAL_ID', fields: { fullName: 'أحمد علي محمد', documentNumber: '101416573', dateOfBirth: '1991-04-12', nationality: 'عراقي', sex: 'ذكر', expiryDate: '2031-04-12' }, documentNumberMasked: '********6573' })
    if (url.includes('/api/citizen/location')) return json(citizen)
    return originalFetch(input, init)
  }
  window.__geoCalls = 0
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(success) { window.__geoCalls += 1; success({ coords: { latitude: 31.042, longitude: 46.267, accuracy: 18 } }) } } })
})()` })
await send('Page.navigate', { url: `${baseUrl}/onboarding` })
await delay(700)
const attachImage = async () => evaluate(`(() => {
  const input = document.querySelector('.secure-capture input[type=file]')
  if (!input) return false
  const binary = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5JwAAAABJRU5ErkJggg==')
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'national-id.png', { type: 'image/png' }))
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`)
await evaluate(`(() => { const phone = document.querySelector('input[inputmode="tel"]'); if (!phone) return false; const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); value?.set?.call(phone, '0770000000'); phone.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.form-stage button.button.primary')?.click(); return true })()`)
await delay(180)
await evaluate(`(() => { const otp = document.querySelector('input[autocomplete="one-time-code"]'); if (!otp) return false; const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); value?.set?.call(otp, '123456'); otp.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.form-stage button.button.primary')?.click(); return true })()`)
await delay(300)
const frontAttached = await attachImage()
if (!frontAttached) throw new Error('تعذر إدخال صورة المستند في الفحص.')
await delay(700)
await evaluate(`(() => { document.querySelector('.form-stage .stage-actions .button.primary')?.click(); return true })()`)
await delay(300)
const backAttached = await attachImage()
if (!backAttached) throw new Error('تعذر إدخال ظهر المستند في الفحص.')
await delay(250)
const reviewStep = await evaluate(`(() => ({ text: document.querySelector('.form-stage')?.innerText || '', locationButton: Array.from(document.querySelectorAll('button')).some(button => button.textContent?.includes('تحديد موقعي')), fields: Array.from(document.querySelectorAll('.identity-document-data-grid strong')).map(item => item.textContent?.trim()) }))()`)
const requiredValues = ['البطاقة الوطنية الموحدة', 'أحمد علي محمد', '101416573', '1991-04-12', 'عراقي', 'ذكر', '2031-04-12']
if (reviewStep.locationButton || !requiredValues.every(value => reviewStep.text.includes(value))) throw new Error(`عرض بيانات أو موقع غير صحيح: ${JSON.stringify(reviewStep)}`)
const screenshot = await send('Page.captureScreenshot', { format: 'png' })
await writeFile('/tmp/dhiqar-identity-review-data-mobile.png', screenshot.data, 'base64')
await evaluate(`(() => { document.querySelector('.form-stage .stage-actions .button.primary')?.click(); return true })()`)
await delay(350)
const continuation = await evaluate(`(() => ({ heading: document.querySelector('.form-stage h2')?.textContent?.trim() || '', geoCalls: window.__geoCalls, hasFaceCapture: Boolean(document.querySelector('.secure-capture .capture-head')) }))()`)
if (continuation.geoCalls !== 1 || !continuation.heading.includes('تأكيد الوجه') || !continuation.hasFaceCapture) throw new Error(`لم يعمل GPS التلقائي أو الانتقال للوجه: ${JSON.stringify(continuation)}`)
console.log(JSON.stringify({ identity_data_auto_location: 'pass', reviewStep, continuation, screenshot: '/tmp/dhiqar-identity-review-data-mobile.png' }, null, 2))
socket.close()
