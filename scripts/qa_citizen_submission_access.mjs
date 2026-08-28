const baseUrl = (process.argv[2] || 'http://127.0.0.1:8800').replace(/\/$/, '');
const debugUrl = process.argv[3] || 'http://127.0.0.1:9222/json';
const targets = await (await fetch(debugUrl)).json();
const page = targets.find((target) => target.type === 'page')
if (!page?.webSocketDebuggerUrl) throw new Error('لم يتم العثور على صفحة متصفح للفحص.')

const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 1
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})
socket.addEventListener('message', (event) => {
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
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'فشل فحص المتصفح.')
  return result.result.value
}
const go = async (path) => { await send('Page.navigate', { url: `${baseUrl}${path}` }); await delay(1100) }

await send('Page.enable')
await send('Runtime.enable')
await go('/service/water-complaint')
const genericGuestView = await evaluate(`(() => ({
  path: location.pathname,
  hasPublicShell: Boolean(document.querySelector('.public-service-shell')),
  hasPortalSidebar: Boolean(document.querySelector('.portal-sidebar')),
  hasForm: Boolean(document.querySelector('form.dynamic-service-form')),
  notice: document.querySelector('.service-submission-notice strong')?.textContent?.trim() || '',
  submitText: document.querySelector('.dynamic-form-submit button')?.textContent?.trim() || '',
}))()`)
if (!genericGuestView.hasPublicShell || genericGuestView.hasPortalSidebar || !genericGuestView.hasForm || !genericGuestView.notice.includes('الاستمارة متاحة')) {
  throw new Error(`عرض الاستمارة العامة للضيف غير صحيح: ${JSON.stringify(genericGuestView)}`)
}

await evaluate(`(() => {
  const form = document.querySelector('form.dynamic-service-form')
  const setValue = (element, value) => {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }
  form.querySelectorAll('[name]').forEach((element) => {
    if (element instanceof HTMLSelectElement) {
      const option = [...element.options].find((candidate) => !candidate.disabled && candidate.value)
      if (option) setValue(element, option.value)
      return
    }
    if (!(element instanceof HTMLInputElement)) return
    if (element.type === 'date') setValue(element, new Date().toISOString().slice(0, 10))
    else if (element.type === 'time') setValue(element, '10:00')
    else setValue(element, 'معلومة اختبار محفوظة')
  })
  form.noValidate = true
  form.requestSubmit()
  return true
})()`)
await delay(500)
const redirected = await evaluate(`(() => ({
  path: location.pathname,
  continue: new URLSearchParams(location.search).get('continue'),
  draft: sessionStorage.getItem('dhiqar-service-draft:water-complaint'),
}))()`)
if (redirected.path !== '/onboarding' || redirected.continue !== '/service/water-complaint' || !redirected.draft) {
  throw new Error(`لم تُحفظ المسودة أو لم يتحول الضيف للتسجيل: ${JSON.stringify(redirected)}`)
}

await go('/service/store-license')
const specializedGuestView = await evaluate(`(() => ({
  path: location.pathname,
  hasPublicShell: Boolean(document.querySelector('.public-service-shell')),
  hasPortalSidebar: Boolean(document.querySelector('.portal-sidebar')),
  hasForm: Boolean(document.querySelector('form.service-form-layout')),
  notice: document.querySelector('.service-submission-notice strong')?.textContent?.trim() || '',
  hasFakeCitizenName: document.body.textContent?.includes('مهاب علي ياسين') || false,
}))()`)
if (!specializedGuestView.hasPublicShell || specializedGuestView.hasPortalSidebar || !specializedGuestView.hasForm || !specializedGuestView.notice.includes('الاستمارة متاحة') || specializedGuestView.hasFakeCitizenName) {
  throw new Error(`عرض الخدمة المتخصصة للضيف غير صحيح: ${JSON.stringify(specializedGuestView)}`)
}

await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/auth/session')) return new Response(JSON.stringify({ authenticated: true, role: 'CITIZEN', subject: 'qa-citizen', expiresAt: '2030-01-01T00:00:00.000Z' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/api/citizen/demo')) return new Response(JSON.stringify({ id: 999, fullName: 'مواطن فحص', nationalIdMasked: '********0000', phoneMasked: '********0000', verificationStatus: 'VERIFIED', district: 'الناصرية', documentType: 'NATIONAL_ID', profileMediaId: null, createdAt: '2026-01-01T00:00:00.000Z' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    return originalFetch(input, init)
  }
})()` })
await go('/service/water-complaint')
const verifiedFaceView = await evaluate(`(() => ({
  hasFaceSection: Boolean(document.querySelector('.service-face-confirmation')),
  hasFaceCapture: Boolean(document.querySelector('.service-face-confirmation .secure-capture')),
  hasConsent: Boolean(document.querySelector('.service-face-confirmation input[type="checkbox"]')),
  notice: document.querySelector('.service-submission-notice strong')?.textContent?.trim() || '',
}))()`)
if (!verifiedFaceView.hasFaceSection || !verifiedFaceView.hasFaceCapture || !verifiedFaceView.hasConsent || !verifiedFaceView.notice.includes('جاهز للإرسال')) {
  throw new Error(`مطلب فيديو الوجه للحساب الموثق غير ظاهر: ${JSON.stringify(verifiedFaceView)}`)
}
await evaluate(`(() => { const form = document.querySelector('form.dynamic-service-form'); form.noValidate = true; form.requestSubmit(); return true })()`)
await delay(150)
const faceValidationMessage = await evaluate(`document.querySelector('.form-error')?.textContent?.trim() || ''`)
if (!faceValidationMessage.includes('فيديو توثيق الوجه')) throw new Error(`لم تمنع الواجهة الإرسال من دون فيديو وجه: ${faceValidationMessage}`)

await go('/onboarding?continue=%2Fservice%2Fwater-complaint')
await delay(350)
const savedAccountResume = await evaluate(`(() => ({ path: location.pathname, restoredValues: [...document.querySelectorAll('[name]')].map(element => element.value) }))()`)
if (savedAccountResume.path !== '/service/water-complaint' || !savedAccountResume.restoredValues.includes('معلومة اختبار محفوظة')) {
  throw new Error(`لم يعد الحساب المحفوظ إلى الخدمة مع المسودة: ${JSON.stringify(savedAccountResume)}`)
}

console.log(JSON.stringify({ citizen_submission_access: 'pass', genericGuestView, redirected: { path: redirected.path, continue: redirected.continue, draftSaved: Boolean(redirected.draft) }, specializedGuestView, verifiedFaceView, faceValidationMessage, savedAccountResume }, null, 2))
socket.close()
