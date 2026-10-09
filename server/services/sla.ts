import { db } from '../db.js'

/**
 * Service-level deadlines for service requests.
 *
 * - Each catalog service may carry sla_working_days; when it is NULL the default depends on the channel
 *   (an online file is a desk review, an appointment service also needs the citizen to come in).
 * - Working days skip the Iraqi weekend (Friday + Saturday) in Asia/Baghdad time.
 * - Time spent waiting on the citizen (documents to re-upload, a fee to pay) is not the department's fault:
 *   waiting_since marks the pause and due_at is pushed forward by the paused time when the request comes back.
 */

export const CLOSED_STATUSES = ['APPROVED', 'REJECTED'] as const
export const WAITING_ON_CITIZEN_STATUSES = ['ACTION_REQUIRED', 'PAYMENT_PENDING'] as const

const closed = new Set<string>(CLOSED_STATUSES)
const waiting = new Set<string>(WAITING_ON_CITIZEN_STATUSES)

export const defaultSlaWorkingDays = (channel: string) => (channel === 'APPOINTMENT_REQUIRED' ? 7 : 5)

export function effectiveSlaWorkingDays(service: { channel: string; slaWorkingDays?: number | null }) {
  const days = Number(service.slaWorkingDays)
  return Number.isInteger(days) && days > 0 ? days : defaultSlaWorkingDays(service.channel)
}

const baghdadWeekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Baghdad', weekday: 'short' })
/** Friday and Saturday are the weekend in Iraq. */
export const isIraqiWeekend = (date: Date) => {
  const day = baghdadWeekday.format(date)
  return day === 'Fri' || day === 'Sat'
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Adds `days` working days to `start`, keeping the time of day. Baghdad has had no DST since 2008, so a
 * calendar day is always 24h there. A request filed on the weekend starts counting from the next Sunday.
 */
export function addWorkingDays(start: Date, days: number) {
  let cursor = start.getTime()
  let remaining = Math.max(0, Math.floor(days))
  while (remaining > 0) {
    cursor += DAY_MS
    if (!isIraqiWeekend(new Date(cursor))) remaining--
  }
  return new Date(cursor)
}

/** Midnight today in Baghdad, as an ISO instant (used for "decided today" counts). */
export function baghdadDayStart(now = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return new Date(`${ymd}T00:00:00+03:00`).toISOString()
}

export function computeDueAt(createdAt: string, service: { channel: string; slaWorkingDays?: number | null }) {
  return addWorkingDays(new Date(createdAt), effectiveSlaWorkingDays(service)).toISOString()
}

/**
 * The SLA columns after a status change. Entering a waiting status starts a pause; leaving it pushes the
 * deadline forward by the paused time. Closing a request just ends any pause (the deadline no longer matters).
 */
export function nextSlaClock(
  current: { status: string; due_at?: unknown; waiting_since?: unknown },
  nextStatus: string,
  nowIso: string
): { dueAt: string | null; waitingSince: string | null } {
  const dueAt = current.due_at ? String(current.due_at) : null
  const waitingSince = current.waiting_since ? String(current.waiting_since) : null
  if (closed.has(nextStatus)) return { dueAt, waitingSince: null }
  if (waiting.has(nextStatus)) return { dueAt, waitingSince: waitingSince || nowIso }
  if (waitingSince && dueAt) {
    const paused = Math.max(0, Date.parse(nowIso) - Date.parse(waitingSince))
    return { dueAt: new Date(Date.parse(dueAt) + paused).toISOString(), waitingSince: null }
  }
  return { dueAt, waitingSince: null }
}

/** Whether an open request has passed its deadline. Paused (waiting on the citizen) requests are never overdue. */
export function isOverdue(row: { status: string; due_at?: unknown }, now = Date.now()) {
  if (!row.due_at || closed.has(row.status) || waiting.has(row.status)) return false
  return Date.parse(String(row.due_at)) < now
}

/**
 * Requests filed before SLAs existed have no due_at: give the open ones a deadline from their creation date so
 * the overdue flags and the manager view cover them too. Idempotent (only touches due_at IS NULL).
 */
export function backfillServiceRequestDueDates() {
  const rows = db
    .prepare(
      `SELECT sr.id, sr.created_at, sr.updated_at, sr.status, sc.channel, sc.sla_working_days FROM service_requests sr
       JOIN service_catalog sc ON sc.id = sr.service_id
       WHERE sr.due_at IS NULL AND sr.status NOT IN ('APPROVED', 'REJECTED')`
    )
    .all() as Array<{
    id: number
    created_at: string
    updated_at: string
    status: string
    channel: string
    sla_working_days: number | null
  }>
  if (!rows.length) return 0
  // a request already waiting on the citizen is treated as paused since its last update
  const update = db.prepare(
    'UPDATE service_requests SET due_at = ?, waiting_since = COALESCE(waiting_since, ?) WHERE id = ? AND due_at IS NULL'
  )
  db.exec('BEGIN')
  try {
    for (const row of rows)
      update.run(
        computeDueAt(row.created_at, { channel: row.channel, slaWorkingDays: row.sla_working_days }),
        waiting.has(row.status) ? row.updated_at : null,
        Number(row.id)
      )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return rows.length
}
