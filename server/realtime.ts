import type { Server } from 'node:http'
import { createNotification, getCitizenById, getCitizenNotifications } from './db.js'
import { installCitizenNotificationRealtime, type NotificationSnapshot } from './citizen-notification-realtime.js'
import { installEmployeeWorkQueueRealtime } from './employee-work-queue-realtime.js'
import { readSession } from './auth/session.js'
import { isAllowedOrigin } from './config.js'

let citizenRealtime: ReturnType<typeof installCitizenNotificationRealtime> | null = null
let employeeRealtime: ReturnType<typeof installEmployeeWorkQueueRealtime> | null = null

export function installRealtime(server: Server) {
  citizenRealtime = installCitizenNotificationRealtime({
    server,
    authenticateCitizen(request) {
      const session = readSession(request)
      if (session?.role !== 'CITIZEN') return null
      const citizenId = Number(session.sub)
      return Number.isSafeInteger(citizenId) && citizenId > 0 && getCitizenById(citizenId) ? citizenId : null
    },
    isAllowedOrigin,
  })
  employeeRealtime = installEmployeeWorkQueueRealtime({
    server,
    authenticateEmployee(request) {
      const session = readSession(request)
      if (!session || !['EMPLOYEE', 'IDENTITY_REVIEWER', 'SUPER_ADMIN'].includes(session.role)) return null
      return { subject: session.sub, role: session.role as 'EMPLOYEE' | 'IDENTITY_REVIEWER' | 'SUPER_ADMIN' }
    },
    isAllowedOrigin,
  })
}

export const citizenNotificationRealtime = {
  publish(citizenId: number, notifications: ReturnType<typeof getCitizenNotifications>) {
    citizenRealtime?.publish(citizenId, notifications as NotificationSnapshot)
  },
}

export const employeeWorkQueueRealtime = {
  publish(...args: Parameters<NonNullable<typeof employeeRealtime>['publish']>) {
    employeeRealtime?.publish(...args)
  },
}

export function notifyCitizen(input: {
  citizenId: number
  type: string
  title: string
  message: string
  link?: string
}) {
  createNotification(input)
  citizenNotificationRealtime.publish(input.citizenId, getCitizenNotifications(input.citizenId))
}
