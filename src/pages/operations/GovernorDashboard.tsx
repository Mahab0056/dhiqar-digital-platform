import { useEffect, useMemo, useState } from 'react'
import { Link } from 'wouter'
import { ArrowLeft, CalendarDays, Gauge, Landmark } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../../api'
import { useSession } from '../../lib/session'
import { defaultStats } from '../../data'
import { DhiQarMap } from '../../components/operations/DhiQarMap'
import { OperationsShell } from '../../components/operations/OperationsShell'

export function GovernorDashboard() {
  const { session } = useSession()
  const [stats, setStats] = useState(defaultStats)
  useEffect(() => {
    api
      .getStats()
      .then(setStats)
      .catch(() => {})
  }, [])
  const ranked = useMemo(
    () =>
      [...stats.departments]
        .filter(item => item.transactions > 0 || item.openFeedback > 0)
        .sort((a, b) => b.transactions - a.transactions)
        .slice(0, 10),
    [stats]
  )
  // a real completion ratio computed from platform records (not an institutional SLA/satisfaction survey)
  const totalRecorded = stats.departments.reduce((sum, item) => sum + item.transactions, 0)
  const totalCompleted = stats.departments.reduce((sum, item) => sum + item.completed, 0)
  const totalRejected = stats.departments.reduce((sum, item) => sum + item.rejected, 0)
  const completionRate = totalRecorded ? Math.round((totalCompleted / totalRecorded) * 100) : null
  const decidedRate = totalRecorded ? Math.round(((totalCompleted + totalRejected) / totalRecorded) * 100) : null
  return (
    <OperationsShell active="governor">
      <header className="ops-header governor-header">
        <div>
          <span>
            <Landmark /> المتابعة التنفيذية
          </span>
          <h1>لوحة المحافظ</h1>
          <p>ملخص تنفيذي لأداء الحكومة المحلية دون إظهار البيانات الشخصية للمواطنين</p>
        </div>
        <div className="ops-header-actions">
          <span className="period-button">
            سجل المنصة الحالي <CalendarDays />
          </span>
          <span className="ops-header-identity">
            <div className="user-avatar gold" aria-hidden="true">
              {(session?.displayName || session?.username || 'مح').trim().slice(0, 2)}
            </div>
            <span>
              <strong>{session?.displayName || session?.username || 'لوحة المحافظ'}</strong>
              <small>عرض تنفيذي — بلا بيانات شخصية</small>
            </span>
          </span>
        </div>
      </header>
      <section className="executive-score">
        <div>
          <span className={`score-ring ${completionRate === null ? 'is-empty' : ''}`}>
            <b>{completionRate === null ? '—' : completionRate.toLocaleString('en-US')}</b>
            <small>{completionRate === null ? '' : '%'}</small>
          </span>
          <div>
            <small>نسبة الإنجاز على المنصة</small>
            <strong>
              {completionRate === null
                ? 'لا توجد معاملات مسجلة بعد'
                : `${totalCompleted.toLocaleString('en-US')} معاملة مكتملة من ${totalRecorded.toLocaleString('en-US')}`}
            </strong>
            <p>
              محسوبة من سجل المنصة فقط. مؤشرات SLA ورضا المواطنين تُعرض عند اعتمادها من الجهة المالكة — لا تُعرض أرقام
              غير موثقة.
            </p>
          </div>
        </div>
        <div className="executive-mini">
          <span>
            <small>معاملات صدر فيها قرار</small>
            <strong>{decidedRate === null ? '—' : `${decidedRate}%`}</strong>
            <i style={{ width: `${decidedRate ?? 0}%` }} />
          </span>
          <span>
            <small>شكاوى مفتوحة</small>
            <strong>{stats.complaints.toLocaleString('en-US')}</strong>
            <i style={{ width: stats.complaints ? '100%' : '0%' }} />
          </span>
          <span>
            <small>طلبات مكتملة</small>
            <strong>{stats.completed.toLocaleString('en-US')}</strong>
            <i
              style={{
                width: stats.todayApplications
                  ? `${Math.min(100, Math.round((stats.completed / stats.todayApplications) * 100))}%`
                  : '0%',
              }}
            />
          </span>
        </div>
      </section>
      <section className="governor-grid">
        <div className="governor-map-card">
          <div className="panel-heading">
            <div>
              <h2>خريطة أداء ذي قار</h2>
              <p>الدوائر والمناطق التشغيلية</p>
            </div>
            <Link href="/operations">
              عرض GIS الكامل <ArrowLeft />
            </Link>
          </div>
          <DhiQarMap departments={stats.departments} />
        </div>
        <div className="ranking-card">
          <div className="panel-heading">
            <div>
              <h3>الدوائر الأكثر نشاطاً</h3>
              <p>الدوائر التي سجلت طلبات أو شكاوى على المنصة</p>
            </div>
            <Gauge />
          </div>
          {ranked.length === 0 && (
            <div className="ranking-empty">لم تُسجل بعد أي معاملة أو شكوى لدوائر المحافظة على المنصة.</div>
          )}
          {ranked.map((dept, index) => (
            <div className="ranking-row" key={dept.id}>
              <b>{index + 1}</b>
              <div>
                <strong>{dept.name}</strong>
                <small>{dept.district}</small>
              </div>
              <span>{dept.transactions.toLocaleString('en-US')} طلب مسجل</span>
            </div>
          ))}
        </div>
        <div className="governor-chart-card">
          <div className="panel-heading">
            <div>
              <h3>المعاملات المكتملة</h3>
              <p>الطلب مقابل الإنجاز</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={stats.series}>
              <CartesianGrid stroke="#153c2d" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: '#8aa399', fontSize: 11 }} axisLine={false} />
              <YAxis hide />
              <Tooltip contentStyle={{ background: '#09291d', border: '1px solid #1c5d40', borderRadius: 12 }} />
              <Bar dataKey="applications" fill="#255a43" radius={[5, 5, 0, 0]} />
              <Bar dataKey="completed" fill="#26d980" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="executive-alerts">
          <h3>متطلبات تشغيل الأداء</h3>
          {[
            ['01', 'ربط مؤشرات SLA', 'لا تُحسب أزمنة الإنجاز أو التأخير قبل تحديد SLA من الدوائر'],
            ['02', 'استكمال مواقع GIS', 'الجهات بلا إحداثيات لا تظهر كنقاط على الخريطة'],
            ['03', 'ربط بوابة الدفع', 'لا يسجل تحصيل أو تسوية قبل مزود الدفع وWebhook'],
          ].map(([n, t, s]) => (
            <div key={n}>
              <span className="priority-number">{n}</span>
              <p>
                <strong>{t}</strong>
                <small>{s}</small>
              </p>
              <ArrowLeft />
            </div>
          ))}
        </div>
      </section>
    </OperationsShell>
  )
}
