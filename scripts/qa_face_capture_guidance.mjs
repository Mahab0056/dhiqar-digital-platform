import { writeFile } from 'node:fs/promises'

const baseUrl = process.argv[2] || 'http://127.0.0.1:8800'
const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find(target => target.type === 'page' && target.url.includes(baseUrl)) ?? targets.find(target => target.type === 'page')
if (!page?.webSocketDebuggerUrl) throw new Error('لم يتم العثور على صفحة Chrome لفحص شاشة فيديو الوجه.')

const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 1
const send = (method, params = {}) => new Promise((resolve, reject) => {
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'فشل تقييم شاشة فيديو الوجه.')
  return result.result.value
}
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url
    const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/api/auth/session')) return json({ authenticated: true, role: 'CITIZEN', subject: 'qa-citizen', expiresAt: '2030-01-01T00:00:00.000Z' })
    if (url.includes('/api/citizen/demo')) return json({ id: 999, fullName: 'مواطن الفحص', nationalIdMasked: '********0000', phoneMasked: '********0000', verificationStatus: 'VERIFIED', district: 'الناصرية', documentType: 'NATIONAL_ID', profileMediaId: null, createdAt: '2026-01-01T00:00:00.000Z' })
    return originalFetch(input, init)
  }
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  navigator.mediaDevices = navigator.mediaDevices || {}
  navigator.mediaDevices.getUserMedia = async () => {
    const stream = new MediaStream()
    stream.getTracks = () => []
    return stream
  }
  class MockMediaRecorder {
    static isTypeSupported() { return true }
    constructor(stream) { this.stream = stream; this.state = 'inactive'; this.ondataavailable = null; this.onstop = null }
    start() { this.state = 'recording' }
    stop() { if (this.state !== 'recording') return; this.state = 'inactive'; this.onstop?.() }
  }
  window.MediaRecorder = MockMediaRecorder
})()` })
await send('Page.navigate', { url: `${baseUrl}/service/water-complaint` })
await delay(850)
const preflight = await evaluate(`(() => ({
  faceSection: Boolean(document.querySelector('.service-face-confirmation')),
  cameraButton: document.querySelector('.service-face-confirmation .capture-actions .button.secondary')?.textContent?.trim() || '',
}))()`)
if (!preflight.faceSection || !preflight.cameraButton.includes('فتح الكاميرا')) throw new Error(`تعذر تجهيز واجهة فيديو الوجه: ${JSON.stringify(preflight)}`)
await evaluate(`(() => { document.querySelector('.service-face-confirmation .capture-actions .button.secondary')?.click(); return true })()`)
await delay(2400)
const liveCapture = await evaluate(`(() => ({
  liveCamera: Boolean(document.querySelector('.face-video-camera')),
  frame: Boolean(document.querySelector('.face-guide-frame')),
  countdown: document.querySelector('.face-countdown')?.textContent?.trim() || '',
  countdownActive: document.querySelector('.face-countdown')?.classList.contains('active') || false,
  instruction: document.querySelector('.face-capture-instructions strong')?.textContent?.trim() || '',
  detail: document.querySelector('.face-capture-instructions > span')?.textContent?.trim() || '',
  progress: document.querySelector('.face-capture-progress i')?.style.width || '',
  cameraBounds: (() => { const rect = document.querySelector('.face-video-camera')?.getBoundingClientRect(); return rect ? { top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), left: Math.round(rect.left) } : null })(),
  frameBounds: (() => { const rect = document.querySelector('.face-guide-frame')?.getBoundingClientRect(); return rect ? { top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), left: Math.round(rect.left) } : null })(),
}))()`)
if (!liveCapture.liveCamera || !liveCapture.frame || !liveCapture.countdownActive || liveCapture.countdown !== '5' || liveCapture.instruction !== 'ابتسم للكاميرا' || !liveCapture.detail.includes('ابتسامة') || liveCapture.progress === '0%' || !liveCapture.cameraBounds || !liveCapture.frameBounds || liveCapture.frameBounds.top < liveCapture.cameraBounds.top || liveCapture.frameBounds.right > liveCapture.cameraBounds.right || liveCapture.frameBounds.bottom > liveCapture.cameraBounds.bottom || liveCapture.frameBounds.left < liveCapture.cameraBounds.left) {
  throw new Error(`توجيه الوجه المتتابع غير صحيح: ${JSON.stringify(liveCapture)}`)
}
const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
await writeFile('/tmp/dhiqar-face-capture-mobile.png', screenshot.data, 'base64')
console.log(JSON.stringify({ face_capture_guidance: 'pass', preflight, liveCapture, screenshot: '/tmp/dhiqar-face-capture-mobile.png' }, null, 2))
socket.close()
