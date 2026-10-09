// "معاملاتي": applications and service requests merged into one list (src/pages/citizen/my-requests.ts).
import { describe, expect, it } from 'vitest'
import { describeAppointment, mergeCitizenRequests, summarizeCitizenRequests } from '../src/pages/citizen/my-requests'
import type { CitizenServiceRequest, GovernmentApplication } from '../src/types'

const application = (reference: string, status: string, updatedAt: string) =>
  ({
    reference,
    status,
    serviceName: 'إجازة فتح محل',
    department: 'مديرية بلدية الناصرية',
    currentAction: 'قيد التدقيق',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  }) as unknown as GovernmentApplication

const serviceRequest = (reference: string, status: string, updatedAt: string) =>
  ({
    id: 1,
    reference,
    status,
    serviceKey: 'water-bill-objection',
    serviceName: 'اعتراض على قائمة أجور الماء',
    departmentId: 'dhiqar-water',
    departmentName: 'مديرية ماء ذي قار',
    formData: {},
    currentAction: 'بانتظار الموظف',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  }) as CitizenServiceRequest

describe('mergeCitizenRequests', () => {
  it('shows service requests even when the citizen also has applications, newest first', () => {
    const items = mergeCitizenRequests(
      [application('APP-1', 'UNDER_REVIEW', '2026-03-01T10:00:00.000Z')],
      [
        serviceRequest('SR-1', 'SUBMITTED', '2026-02-01T10:00:00.000Z'),
        serviceRequest('SR-2', 'ACTION_REQUIRED', '2026-04-01T10:00:00.000Z'),
      ]
    )
    expect(items.map(item => item.reference)).toEqual(['SR-2', 'APP-1', 'SR-1'])
    expect(items[0].href).toBe('/citizen/request/SR-2')
    expect(items[1].href).toBe('/citizen/application/APP-1')
  })

  it('flags what waits on the citizen and keeps the stats in line with the list', () => {
    const items = mergeCitizenRequests(
      [application('APP-1', 'PAYMENT_REQUIRED', '2026-03-01T10:00:00.000Z')],
      [
        serviceRequest('SR-1', 'PAYMENT_PENDING', '2026-02-01T10:00:00.000Z'),
        serviceRequest('SR-2', 'APPROVED', '2026-02-02T10:00:00.000Z'),
        serviceRequest('SR-3', 'REJECTED', '2026-02-03T10:00:00.000Z'),
        serviceRequest('SR-4', 'APPOINTMENT_REQUESTED', '2026-02-04T10:00:00.000Z'),
      ]
    )
    expect(items.filter(item => item.needsAction).map(item => item.reference)).toEqual(['APP-1', 'SR-1'])
    expect(summarizeCitizenRequests(items)).toEqual({ total: 5, open: 3, needsAction: 2, done: 1 })
    expect(items.find(item => item.reference === 'SR-4')?.statusLabel).toBe('بانتظار تأكيد الموعد')
  })
})

describe('describeAppointment', () => {
  it('a requested slot is shown as waiting for the department', () => {
    const slot = describeAppointment({ preferredDate: '2026-11-02', preferredTime: '10:30', status: 'REQUESTED' })
    expect(slot.confirmed).toBe(false)
    expect(slot.title).toBe('بانتظار تأكيد الدائرة')
    expect(slot.when).toContain('10:30')
  })
  it('a confirmed slot shows the confirmed date and time', () => {
    const slot = describeAppointment({
      preferredDate: '2026-11-02',
      preferredTime: '10:30',
      status: 'CONFIRMED',
      confirmed: true,
      note: 'راجع شباك رقم 3',
    })
    expect(slot).toMatchObject({ confirmed: true, title: 'موعد مؤكد' })
    expect(slot.when).toContain('10:30')
    expect(slot.note).toBe('راجع شباك رقم 3')
  })
})
