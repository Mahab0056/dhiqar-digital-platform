import webpush from 'web-push'
import { db } from './db.js'

/**
 * Web Push (VAPID). Works on Android Chrome/Edge/Samsung, desktop browsers, and iOS 16.4+ when the site is
 * added to the home screen. Keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (mailto: or https URL).
 * Outside production, keys are generated per process so local testing works without configuration.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    citizen_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TEXT NOT NULL,
    last_success_at TEXT,
    FOREIGN KEY (citizen_id) REFERENCES citizens(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_push_subscriptions_citizen ON push_subscriptions(citizen_id);
`)

let keys: { publicKey: string; privateKey: string; subject: string } | null | undefined

export function pushKeys() {
  if (keys !== undefined) return keys
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:support@thi-qar.com'
  if (publicKey && privateKey) keys = { publicKey, privateKey, subject }
  else if (process.env.NODE_ENV !== 'production') {
    const generated = webpush.generateVAPIDKeys()
    keys = { publicKey: generated.publicKey, privateKey: generated.privateKey, subject }
  } else keys = null
  if (keys) webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey)
  return keys
}

export const pushEnabled = () => Boolean(pushKeys())

export function savePushSubscription(input: {
  citizenId: number
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string
}) {
  db.prepare(
    `INSERT INTO push_subscriptions (citizen_id, endpoint, p256dh, auth, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET citizen_id = excluded.citizen_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent`
  ).run(
    input.citizenId,
    input.endpoint,
    input.p256dh,
    input.auth,
    input.userAgent?.slice(0, 300) || null,
    new Date().toISOString()
  )
}

export function removePushSubscription(citizenId: number, endpoint: string) {
  db.prepare('DELETE FROM push_subscriptions WHERE citizen_id = ? AND endpoint = ?').run(citizenId, endpoint)
}

export function countPushSubscriptions(citizenId: number) {
  return (
    db.prepare('SELECT COUNT(*) AS total FROM push_subscriptions WHERE citizen_id = ?').get(citizenId) as {
      total: number
    }
  ).total
}

/** Fire-and-forget delivery to every device of a citizen; dead subscriptions (404/410) are pruned. */
export function sendPushToCitizen(
  citizenId: number,
  payload: { title: string; body: string; link?: string; tag?: string }
) {
  if (!pushKeys()) return
  const rows = db
    .prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE citizen_id = ?')
    .all(citizenId) as Array<{ endpoint: string; p256dh: string; auth: string }>
  if (!rows.length) return
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    link: payload.link || '/citizen',
    tag: payload.tag || 'dhiqar',
    icon: '/brand/pwa-192.png',
    badge: '/brand/pwa-badge.png',
  })
  for (const row of rows) {
    webpush
      .sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, body, {
        TTL: 60 * 60 * 24,
        urgency: 'high',
      })
      .then(() => {
        db.prepare('UPDATE push_subscriptions SET last_success_at = ? WHERE endpoint = ?').run(
          new Date().toISOString(),
          row.endpoint
        )
      })
      .catch((error: { statusCode?: number }) => {
        if (error?.statusCode === 404 || error?.statusCode === 410)
          db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(row.endpoint)
        else console.warn('[push] delivery failed', error?.statusCode || error)
      })
  }
}
