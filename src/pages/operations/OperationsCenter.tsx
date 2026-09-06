import { useEffect, useState } from 'react'
import {
  Activity,
  Bell,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileText,
  Gauge,
  Network,
  Route as RouteIcon,
  UsersRound,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../../api'
import { useSession } from '../../lib/session'
import { defaultStats, formatIQD } from '../../data'
import { DhiQarMap } from '../../components/operations/DhiQarMap'
import { OperationsRegistryPanel } from '../../components/operations/OperationsRegistryPanel'
import { OperationsShell } from '../../components/operations/OperationsShell'
import { NewRequestAlertsPanel } from '../../components/shared/NewRequestAlertsPanel'

export function OperationsCenter() {
  const { session } = useSession()
  const [stats, setStats] = useState(defaultStats)
  const [now, setNow] = useState(() => new Date())
  const [health, setHealth] = useState<
    Array<{ key: string; label: string; status: 'OK' | 'WARN' | 'OFF'; detail: string }>
  >([])
  const [paymentMode, setPaymentMode] = useState<string>('UNAVAILABLE')
  useEffect(() => {
    const loadHealth = () =>
      api
        .getOperationsHealth()
        .then(result => setHealth(result.components))
        .catch(() => {})
    loadHealth()
    api
      .getPaymentConfig()
      .then(config => setPaymentMode(config.mode))
      .catch(() => {})
    const timer = window.setInterval(loadHealth, 60_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    api
      .getStats()
      .then(setStats)
      .catch(() => setStats(defaultStats))
  }, [])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const verifiedLocations = stats.departments.filter(
    department => typeof department.lat === 'number' && typeof department.lng === 'number'
  ).length
  const pie = [
    { name: 'مكتملة', value: stats.completed, color: '#26d980' },
    { name: 'قيد المعالجة', value: Math.max(stats.todayApplications - stats.completed, 0), color: '#2a73ff' },
    { name: 'متأخرة', value: stats.overdue, color: '#ff5964' },
  ]
  return (
    <OperationsShell>
      <header className="ops-header">
        <div>
          <span>
            <Activity /> المتابعة التشغيلية
          </span>
          <h1>غرفة العمليات</h1>
          <p>محافظة ذي قار • آخر تحديث {now.toLocaleTimeString('en-GB')}</p>
        </div>
        <div className="ops-header-actions">
          <span className="clock">
            {now.toLocaleTimeString('en-GB')}
            <small>توقيت بغداد</small>
          </span>
          <a href="#operations-alerts" className="ops-alert-link" aria-label="الانتقال إلى التنبيهات">
            <Bell />
          </a>
          <span className="ops-header-identity">
            <div className="user-avatar" aria-hidden="true">
              {(session?.displayName || session?.username || 'عم').trim().slice(0, 2)}
            </div>
            <span>
              <strong>{session?.displayName || session?.username || 'غرفة العمليات'}</strong>
              <small>{session?.role === 'SUPER_ADMIN' ? 'المشرف العام' : 'موظف غرفة العمليات'}</small>
            </span>
          </span>
        </div>
      </header>
      <section className="ops-kpis">
        <div>
          <span>
            <FileText />
          </span>
          <small>معاملات اليوم</small>
          <strong>{stats.todayApplications.toLocaleString('en-GB')}</strong>
          <em>مسجل</em>
        </div>
        <div>
          <span>
            <CheckCircle2 />
          </span>
          <small>المكتملة</small>
          <strong>{stats.completed.toLocaleString('en-GB')}</strong>
          <em>مسجل</em>
        </div>
        <div>
          <span>
            <Clock3 />
          </span>
          <small>متوسط الإنجاز</small>
          <strong>{stats.avgProcessingHours ? `${stats.avgProcessingHours} س` : '—'}</strong>
          <em>يتطلب SLA</em>
        </div>
        <div>
          <span>
            <UsersRound />
          </span>
          <small>مواطنون متصلون</small>
          <strong>{stats.activeCitizens.toLocaleString('en-GB')}</strong>
          <em>آخر دقيقتين</em>
        </div>
        <div>
          <span>
            <Building2 />
          </span>
          <small>موظفون متصلون</small>
          <strong>{stats.activeEmployees.toLocaleString('en-GB')}</strong>
          <em>آخر دقيقتين</em>
        </div>
        <div>
          <span>
            <CircleDollarSign />
          </span>
          <small>التحصيل اليوم</small>
          <strong>{formatIQD(stats.financialCollection)}</strong>
          <em>
            {paymentMode === 'LIVE'
              ? 'تسويات مؤكدة من البوابة'
              : paymentMode === 'UNAVAILABLE'
                ? 'لا بوابة دفع — الرسوم في الدائرة'
                : 'محاكاة — لا أموال حقيقية'}
          </em>
        </div>
        <div>
          <span>
            <Network />
          </span>
          <small>مواقع GIS موثقة</small>
          <strong>{verifiedLocations.toLocaleString('en-US')}</strong>
          <em>نقطة منشأة</em>
        </div>
      </section>
      <section className="ops-dashboard-grid">
        <div className="ops-map-panel">
          <div className="panel-heading">
            <div>
              <h2>خريطة ذي قار التشغيلية</h2>
              <p>المواقع الموثقة وحالة الخدمات والدوائر</p>
            </div>
            <div className="map-legend">
              <span>
                <i className="online" /> موقع موثّق
              </span>
              <span>
                <i className="degraded" /> بانتظار GIS
              </span>
            </div>
          </div>
          <DhiQarMap departments={stats.departments} />
        </div>
        <div className="ops-side-stack">
          <div className="dark-panel">
            <div className="panel-heading">
              <div>
                <h3>تدفق المعاملات</h3>
                <p>آخر 6 أيام</p>
              </div>
              <RouteIcon />
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={stats.series}>
                <defs>
                  <linearGradient id="greenArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#26d980" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#26d980" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#ffffff10" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: '#91a89d', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip contentStyle={{ background: '#09291d', border: '1px solid #1c5d40', borderRadius: 12 }} />
                <Area type="monotone" dataKey="applications" stroke="#26d980" fill="url(#greenArea)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="dark-panel health-panel" id="system-health">
            <div className="panel-heading">
              <div>
                <h3>صحة المنظومة</h3>
                <p>المكونات الحرجة</p>
              </div>
              <Activity />
            </div>
            {health.length === 0 && <div className="health-row muted">جاري قياس حالة المكونات…</div>}
            {health.map(component => (
              <div className={`health-row health-${component.status.toLowerCase()}`} key={component.key}>
                <span>{component.label}</span>
                <div>
                  <i
                    style={{ width: component.status === 'OK' ? '100%' : component.status === 'WARN' ? '55%' : '12%' }}
                  />
                </div>
                <b title={component.detail}>
                  {component.status === 'OK' ? 'سليم' : component.status === 'WARN' ? 'يحتاج انتباه' : 'غير مفعّل'}
                  <small>{component.detail}</small>
                </b>
              </div>
            ))}
          </div>
        </div>
        <div className="dark-panel transactions-panel">
          <div className="panel-heading">
            <div>
              <h3>حالة معاملات اليوم</h3>
              <p>التوزيع الحالي</p>
            </div>
            <Gauge />
          </div>
          <div className="pie-wrap">
            <ResponsiveContainer width="52%" height={190}>
              <PieChart>
                <Pie data={pie} dataKey="value" innerRadius={52} outerRadius={74} paddingAngle={3}>
                  {pie.map(item => (
                    <Cell key={item.name} fill={item.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pie-legend">
              {pie.map(item => (
                <span key={item.name}>
                  <i style={{ background: item.color }} />
                  <small>{item.name}</small>
                  <strong>{item.value.toLocaleString('en-GB')}</strong>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="dark-panel alerts-panel" id="operations-alerts">
          <div className="panel-heading">
            <div>
              <h3>التنبيهات التشغيلية</h3>
              <p>تحتاج متابعة</p>
            </div>
            <Bell />
          </div>
          <div className="alert-item medium">
            <Activity />
            <span>
              <strong>تهيئة مراقبة الأداء مطلوبة</strong>
              <small>لا تُعرض تنبيهات SLA أو أزمنة استجابة قبل ربط مصدر قياس معتمد.</small>
            </span>
          </div>
          {paymentMode !== 'LIVE' && (
            <div className="alert-item low">
              <CircleDollarSign />
              <span>
                <strong>
                  {paymentMode === 'UNAVAILABLE' ? 'بوابة الدفع غير مربوطة' : 'بوابة الدفع في وضع المحاكاة'}
                </strong>
                <small>
                  {paymentMode === 'UNAVAILABLE'
                    ? 'الرسوم الرسمية تُستوفى في الدائرة ولا تُعفى؛ يُفعّل الدفع الإلكتروني عند ربط المزود.'
                    : 'المبالغ المعروضة تجريبية ولا تمثل تحصيلاً فعلياً حتى تفعيل الوضع الحقيقي.'}
                </small>
              </span>
            </div>
          )}
        </div>
      </section>
      <NewRequestAlertsPanel scope="operations" />
      <OperationsRegistryPanel stats={stats} />
    </OperationsShell>
  )
}
