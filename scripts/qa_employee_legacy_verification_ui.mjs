const baseUrl = process.argv[2] || 'http://127.0.0.1:8800'
const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find(target => target.type === 'page' && target.url.includes(baseUrl)) ?? targets.find(target => target.type === 'page')
if (!page?.webSocketDebuggerUrl) throw new Error('تعذر العثور على صفحة المتصفح لفحص الموظف.')
const socket = new WebSocket(page.webSocketDebuggerUrl)
const callbacks = new Map(); let id = 1
const send = (method, params = {}) => new Promise((resolve, reject) => { const requestId = id++; callbacks.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params })) })
socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (!message.id || !callbacks.has(message.id)) return; const callback = callbacks.get(message.id); callbacks.delete(message.id); message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result) })
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'فشل فحص الواجهة.'); return result.result.value }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
await send('Page.enable'); await send('Runtime.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  let item = { id: 1, reference: 'TQD-LEGACY-0001', citizenId: 1, citizenName: 'مواطن فحص', serviceKey: 'store-license', serviceName: 'إجازة فتح محل', department: 'بلدية الناصرية', status: 'UNDER_REVIEW', currentAction: 'بانتظار مراجعة الموظف.', businessName: 'محل الفحص', activityType: 'مكتب خدمات', address: 'الناصرية', district: 'الناصرية', ownershipType: 'rent', coordinates: { lat: 31.042, lng: 46.267 }, fee: 0, paymentStatus: 'NOT_REQUIRED', requiredDocument: null, attachments: [], createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z', events: [] }
  window.__verificationRequestCount = 0
  const original = window.fetch.bind(window); const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  window.fetch = async (input, init = {}) => { const url = typeof input === 'string' ? input : input.url; const method = init.method || 'GET'
    if (url.includes('/api/auth/session')) return json({ authenticated: true, role: 'EMPLOYEE', subject: 'qa-employee', expiresAt: '2030-01-01T00:00:00.000Z' })
    if (url.endsWith('/api/applications') && method === 'GET') return json([item])
    if (url.includes('/request-document') && method === 'POST') { window.__verificationRequestCount += 1; item = { ...item, status: 'ACTION_REQUIRED', requiredDocument: 'فيديو توثيق الوجه القصير', currentAction: 'يرجى رفع فيديو توثيق الوجه القصير لإكمال التدقيق.' }; return json(item) }
    return original(input, init)
  }
})()` })
await send('Page.navigate', { url: `${baseUrl}/employee` }); await wait(650)
const initial = await evaluate(`(() => { const buttons = Array.from(document.querySelectorAll('button')); const approve = buttons.find(button => button.textContent?.includes('بانتظار فيديو الوجه')); return { hasReason: document.body.innerText.includes('لا يمكن اعتماد هذه المعاملة حالياً'), hasEmptyNotice: document.body.innerText.includes('معاملة سابقة لم تحفظ مرفقات التوثيق'), requestLabel: buttons.find(button => button.textContent?.includes('طلب استكمال التوثيق'))?.textContent?.trim() || '', approveDisabled: Boolean(approve?.disabled) } })()`)
if (!initial.hasReason || !initial.hasEmptyNotice || !initial.approveDisabled || !initial.requestLabel.includes('طلب استكمال التوثيق')) throw new Error(`رسالة منع الاعتماد غير مكتملة: ${JSON.stringify(initial)}`)
await evaluate(`(() => { Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('طلب استكمال التوثيق'))?.click(); return true })()`); await wait(250)
const afterRequest = await evaluate(`(() => ({ requestCount: window.__verificationRequestCount, text: document.body.innerText.includes('يرجى رفع فيديو توثيق الوجه القصير لإكمال التدقيق.') }))()`)
if (afterRequest.requestCount !== 1 || !afterRequest.text) throw new Error(`طلب استكمال التوثيق لم ينفذ: ${JSON.stringify(afterRequest)}`)
console.log(JSON.stringify({ employee_legacy_verification_ui: 'pass', initial, afterRequest }, null, 2)); socket.close()
