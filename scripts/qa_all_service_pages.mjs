import { readFile } from 'node:fs/promises'

const baseUrl = process.argv[2] || 'http://127.0.0.1:8800'
const source = await readFile(new URL('../src/service-forms.ts', import.meta.url), 'utf8')
const services = [
  ...source.matchAll(
    /\n\s*key: '([^']+)', title: '([^']+)'[\s\S]*?mode: '(SPECIALIZED|GENERIC|APPOINTMENT|EXTERNAL)'/g
  ),
].map(match => ({ key: match[1], title: match[2], mode: match[3] }))
if (services.length !== 18) throw new Error(`عدد الخدمات المستخرجة غير متوقع: ${services.length}`)

const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page =
  targets.find(target => target.type === 'page' && target.url.includes(baseUrl)) ??
  targets.find(target => target.type === 'page')
if (!page?.webSocketDebuggerUrl) throw new Error('لم يتم العثور على صفحة Chrome لفحص الخدمات.')
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'فشل فحص المتصفح.')
  return result.result.value
}
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const runtimeErrors = []
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.exceptionThrown')
    runtimeErrors.push(message.params.exceptionDetails.text || 'استثناء JavaScript')
})
await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false })

const results = []
for (const service of services) {
  await send('Page.navigate', { url: `${baseUrl}/service/${service.key}` })
  await delay(430)
  const inspection = await evaluate(`(() => {
    const root = document.getElementById('root')
    const externalLinks = [...document.querySelectorAll('.national-service-page .official-handoff-links a')].map(a => ({ href: a.getAttribute('href') || '', target: a.getAttribute('target') || '' }))
    return {
      pathname: location.pathname,
      text: root?.innerText || '',
      hasNotFound: Boolean(document.querySelector('.not-found')),
      hasPublicShell: Boolean(document.querySelector('.public-service-shell')),
      hasGenericForm: Boolean(document.querySelector('.dynamic-service-form')),
      hasSpecializedForm: Boolean(document.querySelector('.service-form-layout')),
      hasExternalHandoff: Boolean(document.querySelector('.national-service-page')),
      fieldCount: document.querySelectorAll('form input, form select, form textarea').length,
      submitText: document.querySelector('button[type="submit"]')?.textContent?.trim() || '',
      externalLinks,
    }
  })()`)
  const expectedForm =
    service.mode === 'SPECIALIZED'
      ? inspection.hasSpecializedForm
      : service.mode === 'EXTERNAL'
        ? inspection.hasExternalHandoff
        : inspection.hasGenericForm
  const externalValid =
    service.mode !== 'EXTERNAL' ||
    (inspection.externalLinks.length > 0 &&
      inspection.externalLinks.every(link => link.href.startsWith('https://') && link.target === '_blank'))
  const localValid = service.mode === 'EXTERNAL' || (inspection.fieldCount > 0 && inspection.submitText.length > 0)
  const titlePresent = inspection.text.includes(service.title)
  results.push({
    key: service.key,
    title: service.title,
    mode: service.mode,
    pathCorrect: inspection.pathname === `/service/${service.key}`,
    titlePresent,
    expectedForm,
    externalValid,
    localValid,
    hasNotFound: inspection.hasNotFound,
  })
}
const failed = results.filter(
  item =>
    !item.pathCorrect ||
    !item.titlePresent ||
    !item.expectedForm ||
    !item.externalValid ||
    !item.localValid ||
    item.hasNotFound
)
if (runtimeErrors.length || failed.length) throw new Error(JSON.stringify({ runtimeErrors, failed }, null, 2))
console.log(
  JSON.stringify(
    {
      all_service_pages: 'pass',
      total: results.length,
      genericOrAppointment: results.filter(item => ['GENERIC', 'APPOINTMENT'].includes(item.mode)).length,
      specialized: results.filter(item => item.mode === 'SPECIALIZED').length,
      external: results.filter(item => item.mode === 'EXTERNAL').length,
      results,
    },
    null,
    2
  )
)
socket.close()
