import { createHmac, randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import { db, ensureDemoCitizen } from '../server/db.js'

const base = process.env.QA_BASE || 'http://127.0.0.1:8798'
const wsBase = base.replace(/^http/, 'ws')
const secret = process.env.SESSION_SECRET || 'realtime-notification-qa-session-secret-long'
const sign = (sub: string, role: string) => {
  const payload = Buffer.from(JSON.stringify({ sub, role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
const waitFor = <T>(socket: WebSocket, predicate: (value: T) => boolean, timeoutMs = 4_000) => new Promise<T>((resolve, reject) => {
  const timeout = setTimeout(() => { socket.off('message', receive); reject(new Error('timed out waiting for realtime notification')) }, timeoutMs)
  const receive = (raw: Buffer) => {
    const value = JSON.parse(raw.toString()) as T
    if (!predicate(value)) return
    clearTimeout(timeout); socket.off('message', receive); resolve(value)
  }
  socket.on('message', receive)
})
const expectRejected = (headers: Record<string, string>, status: number) => new Promise<void>((resolve, reject) => {
  const socket = new WebSocket(`${wsBase}/ws/citizen-notifications`, { headers })
  socket.once('unexpected-response', (_request, response) => { response.resume(); response.statusCode === status ? resolve() : reject(new Error(`expected websocket ${status}, got ${response.statusCode}`)) })
  socket.once('open', () => { socket.close(); reject(new Error('unauthorised websocket was accepted')) })
  socket.once('error', () => {})
})

const citizenId = ensureDemoCitizen()
const reference = `TQD-WS-${randomUUID().slice(0, 8)}`
const timestamp = new Date().toISOString()
db.prepare(`INSERT INTO applications (reference, citizen_id, citizen_name, service_key, service_name, department, status, current_action, business_name, activity_type, address, district, ownership_type, lat, lng, fee, payment_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run(reference, citizenId, 'مواطن فحص التحديث اللحظي', 'store-license', 'إجازة فتح محل', 'بلدية الناصرية', 'UNDER_REVIEW', 'بانتظار مراجعة الموظف.', 'محل فحص', 'مكتب خدمات', 'الناصرية', 'الناصرية', 'rent', 31.042, 46.267, 0, 'NOT_REQUIRED', timestamp, timestamp)
const citizenCookie = `dhiqar_session=${sign(String(citizenId), 'CITIZEN')}`
await expectRejected({ origin: 'http://127.0.0.1:8798' }, 401)
await expectRejected({ origin: 'https://invalid.example', cookie: citizenCookie }, 403)
const socket = new WebSocket(`${wsBase}/ws/citizen-notifications`, { headers: { origin: 'http://127.0.0.1:8798', cookie: citizenCookie } })
const receivedMessages: Array<{ type?: string }> = []
socket.on('message', raw => { try { receivedMessages.push(JSON.parse(raw.toString()) as { type?: string }) } catch { /* ignored in test */ } })
await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
await new Promise(resolve => setTimeout(resolve, 50))
if (!receivedMessages.some(message => message.type === 'citizen.notifications.connected')) throw new Error('citizen websocket did not establish')
const employeeHeaders = { cookie: `dhiqar_session=${sign('employee-qa', 'EMPLOYEE')}`, 'content-type': 'application/json' }
type SnapshotMessage = { type: string; payload: { unread: number; items: Array<{ id: string; type: string; message: string; link: string | null; readAt: string | null }> } }
const notificationUpdate = waitFor<SnapshotMessage>(socket, value => value.type === 'citizen.notifications.updated' && value.payload.items.some(item => item.type === 'ACTION_REQUIRED' && item.link === `/citizen/application/${reference}`))
const requested = await fetch(`${base}/api/applications/${reference}/request-document`, { method: 'POST', headers: employeeHeaders, body: JSON.stringify({ documentName: 'فيديو توثيق الوجه القصير' }) })
if (requested.status !== 200) throw new Error(`verification request status ${requested.status}`)
const update = await notificationUpdate
const notification = update.payload.items.find(item => item.type === 'ACTION_REQUIRED' && item.link === `/citizen/application/${reference}`)
if (!notification || notification.readAt !== null || update.payload.unread < 1 || !notification.message.includes('فيديو توثيق الوجه القصير')) throw new Error('verification notification websocket payload is incomplete')
const readUpdatePromise = waitFor<SnapshotMessage>(socket, value => value.type === 'citizen.notifications.updated' && value.payload.items.some(item => item.id === notification!.id && item.readAt))
const read = await fetch(`${base}/api/citizen/notifications/${notification.id}/read`, { method: 'PATCH', headers: { cookie: citizenCookie } })
if (read.status !== 200) throw new Error(`read status ${read.status}`)
const readUpdate = await readUpdatePromise
if (readUpdate.payload.items.find(item => item.id === notification!.id)?.readAt === null) throw new Error('read status was not broadcast to the citizen socket')
socket.close()
console.log('realtime_citizen_notifications_qa=pass')
