import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Building2,
  FileArchive,
  FileCheck2,
  FileText,
  Fingerprint,
  Landmark,
  Map,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { api } from '../../api'
import { OperationsShell } from '../../components/operations/OperationsShell'
import { NewRequestAlertsPanel } from '../../components/shared/NewRequestAlertsPanel'
import { AdminCitizensPanel } from './AdminCitizensPanel'
import { DepartmentManagementPanel } from './DepartmentManagementPanel'
import { GovernmentServiceAdminPanel } from './GovernmentServiceAdminPanel'
import { StaffAccountsPanel } from './StaffAccountsPanel'
import { SystemHealthPanel } from './SystemHealthPanel'
import { logoutAndRedirect, useSession } from '../../lib/session'

export function SuperAdminDashboard() {
  const [, navigate] = useLocation()
  const [overview, setOverview] = useState<{
    system: { pendingIdentity: number; openApplications: number; verifiedDepartments: number; gisLocations: number }
    recentAudit: Array<{
      actor: string
      role: string
      action: string
      entityType: string
      entityId: string
      createdAt: string
    }>
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setOverview(await api.getSuperAdminOverview())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    let active = true
    api
      .getSuperAdminOverview()
      .then(value => {
        if (active) setOverview(value)
      })
      .catch(err => {
        if (active) setError((err as Error).message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])
  const { session } = useSession()
  const endSession = () => logoutAndRedirect(path => navigate(path), '/staff/login')
  const system = {
    pendingIdentity: Number(overview?.system?.pendingIdentity || 0),
    openApplications: Number(overview?.system?.openApplications || 0),
    verifiedDepartments: Number(overview?.system?.verifiedDepartments || 0),
    gisLocations: Number(overview?.system?.gisLocations || 0),
  }
  return (
    <OperationsShell active="super-admin">
      <header className="ops-header super-admin-header">
        <div>
          <span>
            <ShieldCheck /> حوكمة المنصة
          </span>
          <h1>إدارة المنصة</h1>
          <p>صلاحيات المدير العام — مراقبة الخدمات والدوائر والإجراءات الحساسة من شاشة واحدة.</p>
        </div>
        <div className="ops-header-actions">
          <button className="button outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? 'spin' : ''} /> تحديث
          </button>
          <button className="button ghost" onClick={() => void endSession()}>
            إنهاء الجلسة
          </button>
          <Link className="button ghost" href="/staff/security">
            الأمان
          </Link>
          <div className="user-avatar gold" title={session?.displayName || ''}>
            {(session?.displayName || 'SA').slice(0, 2)}
          </div>
        </div>
      </header>
      {error && (
        <div className="form-error super-admin-error">
          <AlertTriangle /> {error}
        </div>
      )}
      <section className="ops-kpis super-admin-kpis">
        <div>
          <span>
            <Fingerprint />
          </span>
          <small>مراجعات الهوية</small>
          <strong>{system.pendingIdentity.toLocaleString('en-US')}</strong>
          <em>بانتظار القرار</em>
        </div>
        <div>
          <span>
            <FileText />
          </span>
          <small>طلبات مفتوحة</small>
          <strong>{system.openApplications.toLocaleString('en-US')}</strong>
          <em>تحتاج متابعة</em>
        </div>
        <div>
          <span>
            <Building2 />
          </span>
          <small>دوائر موثقة</small>
          <strong>{system.verifiedDepartments.toLocaleString('en-US')}</strong>
          <em>ضمن السجل</em>
        </div>
        <div>
          <span>
            <Map />
          </span>
          <small>مواقع GIS</small>
          <strong>{system.gisLocations.toLocaleString('en-US')}</strong>
          <em>إحداثيات متحققة</em>
        </div>
      </section>
      <section className="super-admin-grid">
        <article className="dark-panel super-admin-actions">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">مراكز الإدارة</span>
              <h2>الوصول التشغيلي</h2>
              <p>كل مسار يفتح وظيفة فعلية ضمن جلسة المدير العام.</p>
            </div>
            <ShieldCheck />
          </div>
          <div className="super-admin-action-list">
            <Link href="/operations">
              <Map />
              <span>
                <strong>غرفة العمليات</strong>
                <small>GIS، صحة المنظومة، الدوائر والمالية</small>
              </span>
              <ArrowLeft />
            </Link>
            <Link href="/employee">
              <FileArchive />
              <span>
                <strong>المعاملات ومراجعة الهوية</strong>
                <small>قائمة العمل، المرفقات والقرارات</small>
              </span>
              <ArrowLeft />
            </Link>
            <Link href="/governor">
              <Landmark />
              <span>
                <strong>لوحة المحافظ</strong>
                <small>ملخص تنفيذي من السجلات المتاحة</small>
              </span>
              <ArrowLeft />
            </Link>
            <Link href="/">
              <Bell />
              <span>
                <strong>الأخبار والخدمات</strong>
                <small>مراجعة واجهة المواطن والمحتوى المنشور</small>
              </span>
              <ArrowLeft />
            </Link>
          </div>
        </article>
        <article className="dark-panel super-admin-audit">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">سجل التدقيق</span>
              <h2>آخر الإجراءات المسجلة</h2>
              <p>سجل القراءة والمراجعة والجلسات، دون إظهار محتوى الهوية.</p>
            </div>
            <FileCheck2 />
          </div>
          {loading ? (
            <div className="loading-state">
              <RefreshCw className="spin" /> جاري تحميل سجل التدقيق...
            </div>
          ) : overview?.recentAudit.length ? (
            <div className="super-admin-audit-list">
              {overview.recentAudit.map((entry, index) => (
                <div key={`${entry.entityId}-${index}`}>
                  <span className={`audit-role ${entry.role.toLowerCase()}`}>{entry.role}</span>
                  <div>
                    <strong>{entry.action.replaceAll('_', ' ')}</strong>
                    <small>
                      {entry.actor} • {entry.entityType} / {entry.entityId}
                    </small>
                  </div>
                  <time>{new Date(entry.createdAt).toLocaleString('en-GB')}</time>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-queue">
              <FileCheck2 />
              <p>لا توجد إجراءات مسجلة بعد.</p>
            </div>
          )}
        </article>
      </section>
      <StaffAccountsPanel />
      <NewRequestAlertsPanel scope="admin" />
      <AdminCitizensPanel />
      <DepartmentManagementPanel />
      <GovernmentServiceAdminPanel />
      <SystemHealthPanel />
    </OperationsShell>
  )
}
