import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BriefcaseBusiness, CheckCircle2, ExternalLink, FileText, RefreshCw } from 'lucide-react'
import { api } from '../../api'
import { statusLabels } from '../../data'
import type { DepartmentWorkbench } from '../../types'

export function DepartmentManagementPanel() {
  const [departments, setDepartments] = useState<DepartmentWorkbench[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyService, setBusyService] = useState<string | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api.getDepartmentWorkbench()
      setDepartments(result.departments)
      setSelectedId(current => current || result.departments[0]?.id || '')
    } catch (item) {
      setError((item as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const selected = departments.find(item => item.id === selectedId) || departments[0]
  const updateRequirements = async (service: DepartmentWorkbench['services'][number]) => {
    const entered = window.prompt('اكتب المتطلبات، كل متطلب في سطر مستقل:', service.requiredDocuments.join('\n'))
    if (entered === null) return
    const requiredDocuments = entered
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean)
    if (!requiredDocuments.length) return setError('أدخل متطلباً واحداً على الأقل أو ألغِ العملية.')
    setBusyService(service.id)
    setError('')
    try {
      await api.updatePlatformService(service.id, { requiredDocuments })
      await load()
    } catch (item) {
      setError((item as Error).message)
    } finally {
      setBusyService(null)
    }
  }
  const toggleService = async (service: DepartmentWorkbench['services'][number]) => {
    setBusyService(service.id)
    setError('')
    try {
      await api.updatePlatformService(service.id, { active: !service.active })
      await load()
    } catch (item) {
      setError((item as Error).message)
    } finally {
      setBusyService(null)
    }
  }
  return (
    <section className="department-management-panel">
      <header className="panel-heading">
        <div>
          <span className="section-kicker">إدارة حسب الدائرة</span>
          <h2>الطلبات والخدمات والمتطلبات</h2>
          <p>اختر دائرة لمتابعة الطلبات الواردة وخدماتها ومتطلبات كل خدمة. تظهر البيانات المسجلة في المنصة فقط.</p>
        </div>
        <button className="button outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? 'spin' : ''} /> تحديث
        </button>
      </header>
      {error && (
        <div className="form-error">
          <AlertTriangle /> {error}
        </div>
      )}
      {loading ? (
        <div className="loading-state">
          <RefreshCw className="spin" /> جاري تحميل الدوائر...
        </div>
      ) : (
        <>
          <div className="department-workbench-tabs">
            {departments.map(item => (
              <button
                type="button"
                key={item.id}
                className={selected?.id === item.id ? 'active' : ''}
                onClick={() => setSelectedId(item.id)}
              >
                {item.name}
                <small>{item.requests.length.toLocaleString('en-US')} طلب</small>
              </button>
            ))}
          </div>
          {selected && (
            <div className="department-workbench-content">
              <header>
                <div>
                  <span>
                    {selected.category} • {selected.district}
                  </span>
                  <h3>{selected.name}</h3>
                  <p>
                    {selected.dataStatus === 'VERIFIED_SOURCE'
                      ? 'الجهة ضمن سجل مصدر موثق.'
                      : 'بيانات الجهة تحتاج تحققاً إضافياً قبل استخدامها كمصدر رسمي.'}
                  </p>
                </div>
                {selected.sourceUrl && (
                  <a className="button outline" href={selected.sourceUrl} target="_blank" rel="noreferrer">
                    مصدر الدائرة <ExternalLink />
                  </a>
                )}
              </header>
              <div className="department-workbench-grid">
                <section>
                  <h4>
                    <FileText /> طلبات المواطنين
                  </h4>
                  {selected.requests.length === 0 ? (
                    <div className="admin-empty-state">
                      <FileText />
                      <span>لا توجد طلبات مسجلة لهذه الدائرة حالياً.</span>
                    </div>
                  ) : (
                    <div className="department-request-list">
                      {selected.requests.map(request => (
                        <article key={request.reference}>
                          <span className={`status ${request.status.toLowerCase()}`}>
                            {statusLabels[request.status as keyof typeof statusLabels] || request.status}
                          </span>
                          <div>
                            <strong>{request.serviceName}</strong>
                            <small>
                              {request.reference} • {request.citizenName}
                            </small>
                            <p>{request.currentAction}</p>
                          </div>
                          <time>{new Date(request.updatedAt).toLocaleString('en-GB')}</time>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
                <section>
                  <h4>
                    <BriefcaseBusiness /> خدمات الدائرة ومتطلباتها
                  </h4>
                  {selected.services.length === 0 ? (
                    <div className="admin-empty-state">
                      <BriefcaseBusiness />
                      <span>لم يُسجل لهذه الدائرة نموذج خدمة داخل المنصة بعد.</span>
                    </div>
                  ) : (
                    <div className="department-service-list">
                      {selected.services.map(service => (
                        <article key={service.id}>
                          <header>
                            <div>
                              <strong>{service.name}</strong>
                              <small>{service.category}</small>
                            </div>
                            <span className={service.active ? 'service-state active' : 'service-state paused'}>
                              {service.active ? 'متاحة' : 'موقوفة'}
                            </span>
                          </header>
                          <ul>
                            {service.requiredDocuments.map(item => (
                              <li key={item}>
                                <CheckCircle2 /> {item}
                              </li>
                            ))}
                          </ul>
                          <footer>
                            <button
                              type="button"
                              className="button outline"
                              onClick={() => void updateRequirements(service)}
                              disabled={busyService === service.id}
                            >
                              تعديل المتطلبات
                            </button>
                            <button
                              type="button"
                              className="button ghost"
                              onClick={() => void toggleService(service)}
                              disabled={busyService === service.id}
                            >
                              {service.active ? 'إيقاف الاستقبال' : 'إعادة الاستقبال'}
                            </button>
                          </footer>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
