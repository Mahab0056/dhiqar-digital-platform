import { useEffect, useMemo, useState } from 'react'
import { Link } from 'wouter'
import { ArrowLeft, CalendarDays, Gauge, Landmark } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../../api'
import { defaultStats } from '../../data'
import { DhiQarMap } from '../../components/operations/DhiQarMap'
import { OperationsShell } from '../../components/operations/OperationsShell'

export function GovernorDashboard() {
  const [stats, setStats] = useState(defaultStats)
  useEffect(() => {
    api
      .getStats()
      .then(setStats)
      .catch(() => {})
  }, [])
  const ranked = useMemo(() => [...stats.departments].sort((a, b) => b.transactions - a.transactions), [stats])
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
          <div className="user-avatar gold">مح</div>
        </div>
      </header>
      <section className="executive-score">
        <div>
          <span className="score-ring">
            <b>—</b>
            <small>/100</small>
          </span>
          <div>
            <small>مؤشر الأداء الحكومي</small>
            <strong>بانتظار مصدر قياس مؤسسي</strong>
            <p>لا يُحسب قبل ربط مؤشرات SLA والرضا من الجهة المالكة</p>
          </div>
        </div>
        <div className="executive-mini">
          <span>
            <small>الالتزام بالـSLA</small>
            <strong>—</strong>
            <i style={{ width: '0%' }} />
          </span>
          <span>
            <small>رضا المواطنين</small>
            <strong>—</strong>
            <i style={{ width: '0%' }} />
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
              <h3>ترتيب الدوائر</h3>
              <p>حسب الطلبات المسجلة في المنصة</p>
            </div>
            <Gauge />
          </div>
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
