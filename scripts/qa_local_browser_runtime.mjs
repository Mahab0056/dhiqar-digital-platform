const targetUrl = process.argv[2] || 'http://127.0.0.1:8799/'
const debugUrl = process.argv[3] || 'http://127.0.0.1:9222/json'

const targets = await (await fetch(debugUrl)).json()
const page =
  targets.find(target => target.type === 'page' && target.url.includes(targetUrl)) ??
  targets.find(target => target.type === 'page')

if (!page?.webSocketDebuggerUrl) {
  throw new Error('لم يتم العثور على صفحة Chrome قابلة للفحص عبر CDP.')
}

const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
const notices = []
const network = []
let nextId = 1

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })

socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const request = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    notices.push({
      type: 'exception',
      text: details.exception?.description || details.text,
      line: details.lineNumber,
      column: details.columnNumber,
    })
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    notices.push({
      type: 'console',
      level: message.params.type,
      text: message.params.args.map(item => item.value ?? item.description ?? '').join(' '),
    })
  }
  if (message.method === 'Log.entryAdded') {
    notices.push({ type: 'log', level: message.params.entry.level, text: message.params.entry.text })
  }
  if (message.method === 'Network.responseReceived') {
    const response = message.params.response
    network.push({
      type: message.params.type,
      status: response.status,
      mimeType: response.mimeType,
      url: response.url,
      fromDiskCache: response.fromDiskCache,
    })
  }
  if (message.method === 'Network.loadingFailed') {
    network.push({
      type: 'failure',
      error: message.params.errorText,
      blockedReason: message.params.blockedReason || null,
    })
  }
})

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

await send('Runtime.enable')
await send('Log.enable')
await send('Network.enable')
await send('Page.enable')
await send('Page.navigate', { url: targetUrl })
await new Promise(resolve => setTimeout(resolve, 2200))
const inspected = await send('Runtime.evaluate', {
  expression: `(() => ({
    title: document.title,
    url: location.href,
    rootHtml: document.querySelector('#root')?.innerHTML || '',
    rootText: document.querySelector('#root')?.innerText || '',
    scriptUrls: [...document.scripts].map((script) => script.src),
  }))()`,
  returnByValue: true,
})

console.log(JSON.stringify({ inspected: inspected.result.value, notices, network }, null, 2))
socket.close()
