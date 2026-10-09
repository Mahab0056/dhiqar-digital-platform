import type express from 'express'
import { z } from 'zod'
import { currentSession, requireSession } from '../auth/session.js'
import { addAudit, db } from '../db.js'

/**
 * Management report: every service request and shop permit in a date range, as a CSV that opens directly in Excel
 * (UTF-8 BOM, Arabic headers). It carries no citizen names, phones or card numbers — only what management needs to
 * measure the work. Employees get their own department; operations and the super admin get the whole governorate.
 */
const STATUS_AR: Record<string, string> = {
  SUBMITTED: 'جديد',
  APPOINTMENT_REQUESTED: 'طلب موعد',
  UNDER_REVIEW: 'قيد التدقيق',
  ACTION_REQUIRED: 'بانتظار المواطن',
  PAYMENT_PENDING: 'بانتظار الدفع',
  PAYMENT_REQUIRED: 'بانتظار الدفع',
  APPROVING: 'قيد الاعتماد',
  APPROVED: 'تمت الموافقة',
  REJECTED: 'مرفوض',
}

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value)
  // quote everything; neutralise spreadsheet formulas in free text
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}
const days = (from: unknown, to: unknown) =>
  from && to
    ? Math.max(0, Math.round(((Date.parse(String(to)) - Date.parse(String(from))) / 86_400_000) * 10) / 10)
    : ''

export function registerReportRoutes(app: express.Express) {
  app.get('/api/reports/transactions.csv', requireSession('EMPLOYEE', 'OPERATIONS', 'SUPER_ADMIN'), (req, res) => {
    const session = currentSession(res)
    const parsed = z
      .object({
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .safeParse(req.query)
    if (!parsed.success) return res.status(400).json({ message: 'حدد الفترة بصيغة YYYY-MM-DD.' })
    const to = parsed.data.to || new Date().toISOString().slice(0, 10)
    const from = parsed.data.from || new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
    const end = `${to}T23:59:59.999Z`
    const department = session.role === 'EMPLOYEE' ? session.departmentId : null
    if (session.role === 'EMPLOYEE' && !department) return res.status(403).json({ message: 'حسابك غير مرتبط بدائرة.' })

    const requests = db
      .prepare(
        `SELECT sr.reference, sc.name AS service_name, d.name AS department_name, sr.status, sr.created_at, sr.decided_at,
             (SELECT COALESCE(SUM(pi.amount_iqd), 0) FROM payment_intents pi WHERE pi.service_request_id = sr.id AND pi.status = 'PAID') AS paid
           FROM service_requests sr
           JOIN service_catalog sc ON sc.id = sr.service_id
           JOIN departments d ON d.id = sr.department_id
           WHERE sr.created_at BETWEEN ? AND ? ${department ? 'AND sr.department_id = ?' : ''}
           ORDER BY sr.created_at`
      )
      .all(...(department ? [from, end, department] : [from, end])) as Array<Record<string, unknown>>
    const permits = db
      .prepare(
        `SELECT reference, service_name, department AS department_name, status, created_at, decided_at, payment_status, fee
           FROM applications WHERE created_at BETWEEN ? AND ? ${department ? 'AND department_id = ?' : ''}
           ORDER BY created_at`
      )
      .all(...(department ? [from, end, department] : [from, end])) as Array<Record<string, unknown>>

    const header = [
      'النوع',
      'رقم المعاملة',
      'الخدمة',
      'الدائرة',
      'الحالة',
      'تاريخ التقديم',
      'تاريخ القرار',
      'مدة الإنجاز (يوم)',
      'الرسوم المسددة (د.ع)',
    ]
    const rows = [
      ...requests.map(row => [
        'طلب خدمة',
        row.reference,
        row.service_name,
        row.department_name,
        STATUS_AR[String(row.status)] || row.status,
        String(row.created_at).slice(0, 10),
        row.decided_at ? String(row.decided_at).slice(0, 10) : '',
        days(row.created_at, row.decided_at),
        Number(row.paid || 0),
      ]),
      ...permits.map(row => [
        'إجازة محل',
        row.reference,
        row.service_name,
        row.department_name,
        STATUS_AR[String(row.status)] || row.status,
        String(row.created_at).slice(0, 10),
        row.decided_at ? String(row.decided_at).slice(0, 10) : '',
        days(row.created_at, row.decided_at),
        row.payment_status === 'PAID' ? Number(row.fee || 0) : 0,
      ]),
    ]
    const csv = '﻿' + [header, ...rows].map(line => line.map(csvCell).join(',')).join('\r\n')
    addAudit({
      actor: session.actor,
      role: session.role,
      action: 'REPORT_EXPORTED',
      entityType: 'Report',
      entityId: `transactions:${from}:${to}`,
      metadata: { rows: rows.length, department: department || 'ALL' },
    })
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="transactions-${from}-to-${to}.csv"`)
    res.send(csv)
  })
}
