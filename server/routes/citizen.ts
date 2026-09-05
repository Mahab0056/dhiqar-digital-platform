import type express from 'express'
import { param } from '../http/params.js'
import { requireSession, currentCitizen } from '../auth/session.js'
import { citizenNotificationRealtime } from '../realtime.js'
import {
  addAudit,
  getCitizenNotifications,
  getApplicationsForCitizen,
  markAllNotificationsRead,
  markNotificationRead,
} from '../db.js'

export function registerCitizenRoutes(app: express.Express) {
  app.get('/api/citizen/demo', requireSession('CITIZEN'), (_req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    addAudit({
      actor: citizen.fullName,
      role: 'CITIZEN',
      action: 'PROFILE_VIEW',
      entityType: 'Citizen',
      entityId: String(citizen.id),
      metadata: { masked: true },
    })
    res.json(citizen)
  })

  app.get('/api/citizen/applications', requireSession('CITIZEN'), (_req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    res.json(getApplicationsForCitizen(citizen.id))
  })

  app.get('/api/citizen/notifications', requireSession('CITIZEN'), (_req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    res.json(getCitizenNotifications(citizen.id))
  })

  app.patch('/api/citizen/notifications/:id/read', requireSession('CITIZEN'), (req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    if (!markNotificationRead(citizen.id, param(req, 'id')))
      return res.status(404).json({ message: 'الإشعار غير موجود.' })
    const snapshot = getCitizenNotifications(citizen.id)
    citizenNotificationRealtime.publish(citizen.id, snapshot)
    res.json(snapshot)
  })

  app.post('/api/citizen/notifications/read-all', requireSession('CITIZEN'), (_req, res) => {
    const citizen = currentCitizen(res)
    if (!citizen) return
    const updated = markAllNotificationsRead(citizen.id)
    addAudit({
      actor: citizen.fullName,
      role: 'CITIZEN',
      action: 'NOTIFICATIONS_MARKED_READ',
      entityType: 'Notification',
      entityId: 'all',
      metadata: { updated },
    })
    const snapshot = getCitizenNotifications(citizen.id)
    citizenNotificationRealtime.publish(citizen.id, snapshot)
    res.json(snapshot)
  })
}
