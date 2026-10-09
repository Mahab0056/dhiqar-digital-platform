/* Thi Qar Digital — service worker: web push + notification click. No offline caching of API data. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  let data = { title: 'ذي قار الرقمية', body: 'لديك تحديث جديد على معاملاتك.', link: '/citizen', tag: 'dhiqar' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    /* plain text payload */
    if (event.data) data.body = event.data.text()
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/brand/pwa-192.png',
      badge: data.badge || '/brand/pwa-badge.png',
      tag: data.tag,
      dir: 'rtl',
      lang: 'ar',
      renotify: true,
      data: { link: data.link || '/citizen' },
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/citizen'
  const target = new URL(link, self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) {
          client.focus()
          if ('navigate' in client) return client.navigate(target)
        }
      }
      return self.clients.openWindow(target)
    })
  )
})

/*
 * While a new release is starting (a few seconds on each deploy) the server cannot answer. Instead of the browser's
 * error page, show a short Arabic notice that retries by itself. Only page navigations are handled; nothing is cached.
 */
const RESTARTING_PAGE = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ذي قار الرقمية</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f4;color:#14281f;
font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;text-align:center;padding:24px}
@media (prefers-color-scheme:dark){body{background:#0e1712;color:#e8efe9}}
.s{width:42px;height:42px;margin:0 auto 18px;border-radius:50%;border:4px solid #0f7a4f33;border-top-color:#0f7a4f;
animation:r 1s linear infinite}@keyframes r{to{transform:rotate(360deg)}}p{opacity:.75;line-height:1.7}</style></head>
<body><main><div class="s"></div><h1 id="t" style="font-size:20px">نحدّث المنصة الآن</h1>
<p id="d">ثوانٍ قليلة وتعود الصفحة تلقائياً.</p></main>
<script>if(!navigator.onLine){t.textContent='لا يوجد اتصال بالإنترنت';d.textContent='تعود الصفحة تلقائياً عند عودة الاتصال.';addEventListener('online',function(){location.reload()})}else setTimeout(function(){location.reload()},4000)</script></body></html>`

self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.status === 502 || response.status === 503 || response.status === 504) throw new Error('restarting')
        return response
      })
      .catch(
        () =>
          new Response(RESTARTING_PAGE, {
            status: 503,
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
          })
      )
  )
})
