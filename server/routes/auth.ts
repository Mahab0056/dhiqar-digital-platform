import type express from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { sensitiveLimiter } from '../http/rate-limit.js'
import { sessionTtlSeconds, secureStringEquals, readSession, setSession, clearSession } from '../auth/session.js'
import { addAudit } from '../db.js'

export function registerAuthRoutes(app: express.Express) {
  app.get('/api/auth/session', (req, res) => {
    const session = readSession(req)
    if (!session) return res.status(401).json({ message: 'لا توجد جلسة دخول فعالة.' })
    res.json({
      authenticated: true,
      role: session.role,
      subject: session.sub,
      expiresAt: new Date(session.exp * 1000).toISOString(),
    })
  })

  app.post('/api/auth/employee', sensitiveLimiter, (req, res) => {
    const payload = z.object({ accessCode: z.string().min(8).max(200) }).parse(req.body)
    if (!secureStringEquals(process.env.ADMIN_REVIEW_PASSWORD, payload.accessCode))
      return res.status(401).json({ message: 'بيانات دخول الموظف غير صحيحة.' })
    setSession(res, 'employee-reviewer', 'EMPLOYEE')
    addAudit({
      actor: 'موظف مصرح',
      role: 'EMPLOYEE',
      action: 'EMPLOYEE_SESSION_CREATED',
      entityType: 'Session',
      entityId: randomUUID(),
      metadata: { ip: req.ip },
    })
    res.json({ authenticated: true, role: 'EMPLOYEE', expiresInSeconds: sessionTtlSeconds })
  })

  app.post('/api/auth/operations', sensitiveLimiter, (req, res) => {
    const payload = z.object({ accessCode: z.string().regex(/^\d{4}$/) }).parse(req.body)
    if (!secureStringEquals(process.env.OPERATIONS_PASSWORD, payload.accessCode))
      return res.status(401).json({ message: 'بيانات دخول غرفة العمليات غير صحيحة.' })
    setSession(res, 'operations-controller', 'OPERATIONS')
    addAudit({
      actor: 'مشغل غرفة العمليات',
      role: 'OPERATIONS',
      action: 'OPERATIONS_SESSION_CREATED',
      entityType: 'Session',
      entityId: randomUUID(),
      metadata: { ip: req.ip },
    })
    res.json({ authenticated: true, role: 'OPERATIONS', expiresInSeconds: sessionTtlSeconds })
  })

  app.post('/api/auth/super-admin', sensitiveLimiter, (req, res) => {
    const payload = z.object({ accessCode: z.string().min(12).max(200) }).parse(req.body)
    if (!secureStringEquals(process.env.SUPER_ADMIN_PASSWORD, payload.accessCode))
      return res.status(401).json({ message: 'بيانات دخول المدير العام غير صحيحة.' })
    setSession(res, 'super-admin', 'SUPER_ADMIN')
    addAudit({
      actor: 'مدير النظام',
      role: 'SUPER_ADMIN',
      action: 'SUPER_ADMIN_SESSION_CREATED',
      entityType: 'Session',
      entityId: randomUUID(),
      metadata: { ip: req.ip },
    })
    res.json({ authenticated: true, role: 'SUPER_ADMIN', expiresInSeconds: sessionTtlSeconds })
  })

  app.post('/api/auth/logout', (req, res) => {
    const session = readSession(req)
    clearSession(res)
    if (session)
      addAudit({
        actor: session.sub,
        role: session.role,
        action: 'SESSION_ENDED',
        entityType: 'Session',
        entityId: session.sub,
      })
    res.json({ success: true })
  })
}
