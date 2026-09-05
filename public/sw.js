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
