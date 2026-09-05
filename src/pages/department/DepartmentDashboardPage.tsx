import { useCallback, useEffect, useState } from 'react'
import { Link } from 'wouter'
import {
  Activity,
  AlertTriangle,
  Building2,
  Camera,
  CheckCircle2,
  Clock3,
  FileText,
  MessageSquareWarning,
  RefreshCw,
  UsersRound,
  Zap,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../../api'
import { statusLabels } from '../../data'
import type { DepartmentDashboard } from '../../types'
import { PortalLayout } from '../../components/citizen/PortalLayout'
import { useSession } from '../../lib/session'

const roleLabels: Record<string, string> = {
  EMPLOYEE: 'موظف معاملات',
  IDENTITY_REVIEWER: 'مراجع هوية',
  OPERATIONS: 'غرفة العمليات',
  SUPER_ADMIN: 'مدير النظام',
}

const actionLabels: Record<string, string> = {
  DOCUMENT_REQUESTED: 'طلب مستند',
  APPLICATION_APPROVED_DOCUMENT_ISSUED: 'موافقة وإصدار وثيقة',
  APPLICATION_REJECTED: 'رفض معاملة',
  PAYMENT_REQUIRED: 'طلب دفع',
  IDENTITY_REVIEW_DECIDED: 'قرار مراجعة هوية',
  IDENTITY_MEDIA_VIEWED: 'عرض وسيط هوية',
  STAFF_SESSION_CREATED: 'تسجيل دخول',
  SESSION_ENDED: 'تسجيل خروج',
  DEPARTMENT_DASHBOARD_VIEWED: 'فتح لوحة الدائرة',
  SERVICE_REQUEST_DECIDED: 'قرار على طلب خدمة',
  FEEDBACK_STATUS_UPDATED: 'تحديث شكوى',
}

const formatDate = (value: string) =>
  new Date(value).toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' })

export function DepartmentDashboardPage({ id }: { id: string }) {
  const [data, setData] = useState<DepartmentDashboard | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const { session } = useSession()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api.getDepartmentDashboard(id))
      setError('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [id])
  useEffect(() => {
    void load()
    const refresh = () => void load()
    window.addEventListener('employee-work-queue-updated', refresh)
    return () => window.removeEventListener('employee-work-queue-updated', refresh)
  }, [load])

  const kpis = data?.kpis
  const tiles = kpis
    ? [
        { icon: FileText, label: 'معاملات اليوم', value: kpis.todayNew, hint: 'وردت اليوم' },
        { icon: Clock3, label: 'قيد المعالجة', value: kpis.open, hint: `${kpis.actionRequired} بانتظار المواطن` },
        {
          icon: CheckCircle2,
          label: 'أُنجزت هذا الأسبوع',
          value: kpis.weekCompleted,
          hint: `${kpis.completed} إجمالاً`,
        },
        {
          icon: Activity,
          label: 'متوسط الإنجاز',
          value: kpis.avgProcessingHours === null ? '—' : `${kpis.avgProcessingHours} س`,
          hint: 'من التقديم للموافقة',
        },
        { icon: MessageSquareWarning, label: 'شكاوى مفتوحة', value: kpis.openFeedback, hint: 'تخص الدائرة' },
        {
          icon: UsersRound,
          label: 'موظفون متصلون',
          value: `${kpis.staffOnline}/${kpis.staffTotal}`,
          hint: 'آخر دقيقتين',
        },
        { icon: Zap, label: 'خدمات رقمية', value: kpis.digitalServices, hint: 'مفعّلة على المنصة' },
      ]
    : []

  return (
    <PortalLayout role="employee">
      <section className="employee-heading department-dashboard-heading">
        <div>
          <span className="section-kicker">
            <Building2 size={14} /> لوحة الدائرة
          </span>
          <h1>{data?.department.name || 'جارٍ التحميل...'}</h1>
          <p>
            {data
              ? `${data.department.category} • ${data.department.district}${data.department.parentMinistry ? ` • ${data.department.parentMinistry}` : ''}`
              : ''}
          </p>
        </div>
        <div className="department-dashboard-actions">
          <button className="button outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? 'spin' : ''} /> تحديث
          </button>
          {data && (
            <Link href={`/departments/${data.department.id}`} className="button ghost">
              الصفحة العامة
            </Link>
          )}
          {session?.role === 'SUPER_ADMIN' && (
            <Link href="/super-admin#staff-accounts" className="button ghost">
              إدارة الحسابات
            </Link>
          )}
        </div>
      </section>

      {error && (
        <div className="form-error">
          <AlertTriangle /> {error}
        </div>
      )}

      {data && (
        <>
          <section className="department-kpis">
            {tiles.map(tile => (
              <div key={tile.label}>
                <span>
                  <tile.icon />
                </span>
                <small>{tile.label}</small>
                <strong>{typeof tile.value === 'number' ? tile.value.toLocaleString('en-US') : tile.value}</strong>
                <em>{tile.hint}</em>
              </div>
            ))}
          </section>

          <section className="department-grid">
            <article className="department-panel department-chart">
              <header>
                <div>
                  <h2>تدفق المعاملات</h2>
                  <p>آخر 14 يوماً — الواردة مقابل المنجزة</p>
                </div>
              </header>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.series}>
                  <defs>
                    <linearGradient id="depCreated" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0a944d" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#0a944d" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="depCompleted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#c9a66b" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#c9a66b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e3ebe6" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: '#68776f', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: '#68776f', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #d8e2dc' }} />
                  <Area
                    type="monotone"
                    dataKey="created"
                    name="واردة"
                    stroke="#0a944d"
                    fill="url(#depCreated)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="completed"
                    name="منجزة"
                    stroke="#c9a66b"
                    fill="url(#depCompleted)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
              <div className="department-chart-legend">
                <span>
                  <i style={{ background: '#0a944d' }} /> واردة
                </span>
                <span>
                  <i style={{ background: '#c9a66b' }} /> منجزة
                </span>
              </div>
            </article>

            <article className="department-panel">
              <header>
                <div>
                  <h2>فريق الدائرة</h2>
                  <p>{data.staff.length ? `${data.kpis.staffOnline} متصل الآن` : 'لم تُنشأ حسابات لهذه الدائرة بعد'}</p>
                </div>
                <UsersRound />
              </header>
              <ul className="department-staff-list">
                {data.staff.map(member => (
                  <li key={member.id} className={member.status === 'DISABLED' ? 'disabled' : ''}>
                    <i className={member.online ? 'online' : ''} aria-hidden="true" />
                    <div>
                      <strong>{member.fullName}</strong>
                      <small>
                        {roleLabels[member.role] || member.role}
                        {member.lastLoginAt ? ` • آخر دخول ${formatDate(member.lastLoginAt)}` : ' • لم يسجل بعد'}
                      </small>
                    </div>
                  </li>
                ))}
                {!data.staff.length && (
                  <li className="muted">
                    {session?.role === 'SUPER_ADMIN'
                      ? 'أنشئ حسابات الموظفين واربطها بهذه الدائرة من إدارة المنصة.'
                      : 'اطلب من مدير النظام ربط حسابات الموظفين بهذه الدائرة.'}
                  </li>
                )}
              </ul>
              {data.workforce.totalEmployees !== null && (
                <p className="department-workforce">
                  الملاك المسجل: {data.workforce.totalEmployees} موظفاً — حاضر {data.workforce.presentEmployees} / غائب{' '}
                  {data.workforce.absentEmployees}
                  <small>المصدر: {data.workforce.sourceName}</small>
                </p>
              )}
            </article>

            <article className="department-panel department-requests">
              <header>
                <div>
                  <h2>معاملات الدائرة</h2>
                  <p>آخر 60 معاملة وطلب خدمة</p>
                </div>
                <FileText />
              </header>
              <div className="table-scroll">
                <table className="department-table">
                  <thead>
                    <tr>
                      <th>المرجع</th>
                      <th>المواطن</th>
                      <th>الخدمة</th>
                      <th>الحالة</th>
                      <th>الإجراء الحالي</th>
                      <th>آخر تحديث</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.requests.map(row => (
                      <tr key={`${row.kind}-${row.reference}`}>
                        <td>
                          <Link
                            href={
                              row.kind === 'APPLICATION'
                                ? `/employee#employee-applications`
                                : '/employee#employee-service-requests'
                            }
                          >
                            {row.reference}
                          </Link>
                        </td>
                        <td>{row.citizenName}</td>
                        <td>{row.serviceName}</td>
                        <td>
                          <span
                            className={`status-pill ${row.status === 'APPROVED' ? 'on' : row.status === 'REJECTED' ? 'danger' : 'off'}`}
                          >
                            {statusLabels[row.status as keyof typeof statusLabels] || row.status}
                          </span>
                        </td>
                        <td className="muted">{row.currentAction}</td>
                        <td>
                          <small>{formatDate(row.updatedAt)}</small>
                        </td>
                      </tr>
                    ))}
                    {!data.requests.length && (
                      <tr>
                        <td colSpan={6} className="muted">
                          لا توجد معاملات مسجلة لهذه الدائرة بعد.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="department-panel">
              <header>
                <div>
                  <h2>خدمات الدائرة على المنصة</h2>
                  <p>
                    {data.services.length
                      ? `${data.kpis.digitalServices} مفعّلة من ${data.services.length}`
                      : 'لا خدمات رقمية بعد'}
                  </p>
                </div>
                <Zap />
              </header>
              <ul className="department-services-list">
                {data.services.map(service => (
                  <li key={service.id}>
                    <div>
                      <strong>{service.name}</strong>
                      <small>
                        {service.category} • {service.estimatedDuration || 'مدة غير محددة'} •{' '}
                        {service.feeIqd
                          ? `${service.feeIqd.toLocaleString('en-US')} د.ع (${service.feeStatus === 'UNVERIFIED' ? 'رسم غير معتمد' : 'معتمد'})`
                          : 'بدون رسوم'}
                      </small>
                    </div>
                    <span className={service.active ? 'status-pill on' : 'status-pill off'}>
                      {service.active ? 'مفعّلة' : 'موقوفة'}
                    </span>
                  </li>
                ))}
                {!data.services.length && (
                  <li className="muted">
                    الخدمات المسجلة في الدليل: {data.department.services.join('، ') || '—'}. تحويلها إلى معاملات رقمية
                    يتم من إدارة المنصة.
                  </li>
                )}
              </ul>
            </article>

            <article className="department-panel">
              <header>
                <div>
                  <h2>الشكاوى والمقترحات</h2>
                  <p>{data.kpis.openFeedback ? `${data.kpis.openFeedback} مفتوحة` : 'لا شكاوى مفتوحة'}</p>
                </div>
                <MessageSquareWarning />
              </header>
              <ul className="department-feedback-list">
                {data.feedback.map(item => (
                  <li key={item.reference}>
                    <div>
                      <strong>{item.subject}</strong>
                      <small>
                        {item.reference} • {item.category} • {formatDate(item.updatedAt)}
                      </small>
                    </div>
                    <span
                      className={['RESOLVED', 'CLOSED'].includes(item.status) ? 'status-pill on' : 'status-pill off'}
                    >
                      {item.status}
                    </span>
                  </li>
                ))}
                {!data.feedback.length && <li className="muted">لا توجد شكاوى أو مقترحات موجهة لهذه الدائرة.</li>}
              </ul>
            </article>

            <article className="department-panel">
              <header>
                <div>
                  <h2>سجل إجراءات الفريق</h2>
                  <p>آخر 25 إجراءً باسم موظفي الدائرة</p>
                </div>
                <Activity />
              </header>
              <ul className="department-activity">
                {data.recentActivity.map((entry, index) => (
                  <li key={`${entry.createdAt}-${index}`}>
                    <strong>{actionLabels[entry.action] || entry.action}</strong>
                    <small>
                      {entry.actor} • {entry.entityType} {entry.entityId.slice(0, 24)} • {formatDate(entry.createdAt)}
                    </small>
                  </li>
                ))}
                {!data.recentActivity.length && <li className="muted">لا توجد إجراءات مسجلة بعد.</li>}
              </ul>
            </article>

            <article className="department-panel department-cameras">
              <header>
                <div>
                  <h2>الكاميرات والموقع</h2>
                  <p>
                    {data.cameras.configured
                      ? `${data.cameras.enabled} مفعّلة من ${data.cameras.configured}`
                      : 'لم تُهيأ كاميرات لهذه الدائرة'}
                  </p>
                </div>
                <Camera />
              </header>
              <p className="muted">
                الموقع: {data.department.address || 'غير مسجل'} —{' '}
                {data.department.gisStatus === 'COORDINATES_VERIFIED' ? 'إحداثيات موثقة' : 'بانتظار إحداثيات رسمية'}
              </p>
            </article>
          </section>
        </>
      )}
    </PortalLayout>
  )
}
