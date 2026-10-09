import type { CitizenServiceRequest, GovernmentApplication } from '../../types'

/** How a request looks from the citizen's side: waiting on them, moving at the department, or finished. */
export type MyRequestTone = 'action' | 'progress' | 'done' | 'rejected'

export type MyRequestItem = {
  kind: 'APPLICATION' | 'SERVICE_REQUEST'
  reference: string
  title: string
  department: string
  status: string
  statusLabel: string
  tone: MyRequestTone
  needsAction: boolean
  currentAction: string
  updatedAt: string
  href: string
}

const serviceRequestLabels: Record<string, string> = {
  SUBMITTED: 'تم التقديم',
  UNDER_REVIEW: 'قيد التدقيق',
  ACTION_REQUIRED: 'مطلوب استكمال',
  PAYMENT_PENDING: 'بانتظار الدفع',
  APPOINTMENT_REQUESTED: 'بانتظار تأكيد الموعد',
  APPROVED: 'تمت المعاملة',
  REJECTED: 'مرفوض',
}

const applicationLabels: Record<string, string> = {
  SUBMITTED: 'تم التقديم',
  UNDER_REVIEW: 'قيد التدقيق',
  ACTION_REQUIRED: 'مطلوب إجراء',
  PAYMENT_REQUIRED: 'بانتظار الدفع',
  APPROVING: 'جاري الاعتماد',
  APPROVED: 'مكتملة',
  REJECTED: 'مرفوضة',
}

/** Statuses where the next step is the citizen's (upload a document or pay), not the department's. */
export const CITIZEN_ACTION_STATUSES = ['ACTION_REQUIRED', 'PAYMENT_PENDING', 'PAYMENT_REQUIRED'] as const

export const serviceRequestStatusLabel = (status: string) => serviceRequestLabels[status] || 'تم التقديم'

const toneOf = (status: string): MyRequestTone =>
  (CITIZEN_ACTION_STATUSES as readonly string[]).includes(status)
    ? 'action'
    : status === 'APPROVED'
      ? 'done'
      : status === 'REJECTED'
        ? 'rejected'
        : 'progress'

export const isOpenRequest = (item: Pick<MyRequestItem, 'tone'>) => item.tone === 'action' || item.tone === 'progress'

const timeOf = (value: string) => {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * One list for "معاملاتي": the store-licence applications and every catalog service request, newest activity first.
 * The dashboard stats and the list are both computed from this, so they always agree.
 */
export function mergeCitizenRequests(
  applications: GovernmentApplication[],
  serviceRequests: CitizenServiceRequest[]
): MyRequestItem[] {
  const items: MyRequestItem[] = [
    ...applications.map(app => {
      const tone = toneOf(app.status)
      return {
        kind: 'APPLICATION' as const,
        reference: app.reference,
        title: app.serviceName,
        department: app.department,
        status: app.status,
        statusLabel: applicationLabels[app.status] || app.status,
        tone,
        needsAction: tone === 'action',
        currentAction: app.currentAction,
        updatedAt: app.updatedAt || app.createdAt,
        href: `/citizen/application/${encodeURIComponent(app.reference)}`,
      }
    }),
    ...serviceRequests.map(request => {
      const tone = toneOf(request.status)
      return {
        kind: 'SERVICE_REQUEST' as const,
        reference: request.reference,
        title: request.serviceName || request.serviceKey,
        department: request.departmentName || request.department || '',
        status: request.status,
        statusLabel: serviceRequestStatusLabel(request.status),
        tone,
        needsAction: tone === 'action',
        currentAction: request.currentAction,
        updatedAt: request.updatedAt || request.createdAt,
        href: `/citizen/request/${encodeURIComponent(request.reference)}`,
      }
    }),
  ]
  return items.sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt) || b.reference.localeCompare(a.reference))
}

export function summarizeCitizenRequests(items: MyRequestItem[]) {
  return {
    total: items.length,
    open: items.filter(isOpenRequest).length,
    needsAction: items.filter(item => item.needsAction).length,
    done: items.filter(item => item.tone === 'done').length,
  }
}

type AppointmentLike = {
  preferredDate: string
  preferredTime: string
  status: string
  confirmed?: boolean
  note?: string | null
}

const formatDay = (value: string) => {
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-GB')
}

/**
 * What to tell the citizen about an appointment: once the department confirms, preferredDate/preferredTime hold the
 * confirmed slot and `note` the attendance instructions; before that it is the date they asked for, marked as pending.
 */
export function describeAppointment(appointment: AppointmentLike) {
  const confirmed = appointment.confirmed === true || appointment.status === 'CONFIRMED'
  const slot = `${formatDay(appointment.preferredDate)} — ${appointment.preferredTime}`
  if (appointment.status === 'CANCELLED')
    return { confirmed: false, title: 'أُلغي الموعد', when: slot, note: appointment.note || null }
  return confirmed
    ? { confirmed, title: 'موعد مؤكد', when: slot, note: appointment.note || null }
    : { confirmed, title: 'بانتظار تأكيد الدائرة', when: `التاريخ المفضل: ${slot}`, note: null as string | null }
}
