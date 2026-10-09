import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, ShieldAlert, UsersRound } from 'lucide-react'
import { api, type DepartmentCoverage } from '../../api'

const ageLabel = (iso: string | null) => {
  if (!iso) return '—'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return days <= 0 ? 'اليوم' : days === 1 ? 'منذ يوم' : `منذ ${days.toLocaleString('en-US')} أيام`
}

/**
 * Departments with no active employee account. Their open requests are not lost — they are escalated to the
 * governorate office's queue — but each one here is a staffing gap the super admin should close.
 */
export function DepartmentCoveragePanel() {
  const [coverage, setCoverage] = useState<DepartmentCoverage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [onlyWithRequests, setOnlyWithRequests] = useState(true)
  const load = useCallback(async () => {
    setBusy(true)
    try {
      setCoverage(await api.getDepartmentCoverage())
      setError('')
    } catch (loadError) {
      setError((loadError as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const items = (coverage?.items || []).filter(item => !onlyWithRequests || item.openRequests > 0)
  return (
    <section className="admin-panel system-health-panel" id="department-coverage">
      <div className="panel-heading">
        <div>
          <h2>تغطية الدوائر بالموظفين</h2>
          <p>
            {coverage
              ? `${coverage.summary.departmentsWithoutStaff.toLocaleString('en-US')} دائرة من ${coverage.summary.departments.toLocaleString('en-US')} بلا موظف فعّال، وفيها ${coverage.summary.openRequestsWithoutStaff.toLocaleString('en-US')} طلب مفتوح. تظهر هذه الطلبات تلقائياً في قائمة ${coverage.escalationDepartment.name} بشارة «محال من دائرة بلا موظفين».`
              : 'جارٍ التحميل...'}
          </p>
        </div>
        <div className="department-workbench-actions">
          <label className="gov-muted">
            <input
              type="checkbox"
              checked={onlyWithRequests}
              onChange={event => setOnlyWithRequests(event.target.checked)}
            />{' '}
            الدوائر التي لديها طلبات مفتوحة فقط
          </label>
          <button className="button ghost" onClick={() => void load()} disabled={busy}>
            <RefreshCw className={busy ? 'spin' : ''} /> تحديث
          </button>
        </div>
      </div>
      {error && (
        <div className="form-error">
          <AlertTriangle /> {error}
        </div>
      )}
      {coverage && coverage.escalationDepartment.activeEmployees === 0 && (
        <div className="form-error" role="alert">
          <ShieldAlert /> لا يوجد موظف فعّال في {coverage.escalationDepartment.name} نفسه — الطلبات المحالة لن يراها إلا
          المدير العام. أنشئ حساب موظف للديوان من «الموظفون والصلاحيات».
        </div>
      )}
      {coverage && (
        <div className="system-health-grid">
          <div className="system-health-card">
            <h3>
              <UsersRound size={15} /> دوائر بلا موظف فعّال
            </h3>
            {items.length === 0 ? (
              <p className="muted">
                {onlyWithRequests ? 'لا توجد طلبات مفتوحة في دوائر بلا موظفين.' : 'كل الدوائر لديها موظف فعّال.'}
              </p>
            ) : (
              <ul className="system-tables">
                {items.map(item => (
                  <li key={item.id}>
                    <span>
                      {item.name}
                      <small className="muted">
                        {' '}
                        {item.district ? `• ${item.district}` : ''}
                        {item.disabledEmployees ? ` • ${item.disabledEmployees.toLocaleString('en-US')} حساب معطل` : ''}
                        {item.openRequests ? ` • أقدم طلب ${ageLabel(item.oldestOpenAt)}` : ''}
                        {item.overdueRequests ? ` • ${item.overdueRequests.toLocaleString('en-US')} متأخر` : ''}
                      </small>
                    </span>
                    <strong title="طلبات مفتوحة">{item.openRequests.toLocaleString('en-US')}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
