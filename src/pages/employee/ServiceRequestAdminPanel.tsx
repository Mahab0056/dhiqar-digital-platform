import { useEffect, useState } from 'react'
import { AlertTriangle, BriefcaseBusiness, CheckCircle2, RefreshCw } from 'lucide-react'
import { api } from '../../api'
import { getServiceDefinition } from '../../service-forms'
import type { CitizenServiceRequest } from '../../types'

export function ServiceRequestAdminPanel() {
  const [items, setItems] = useState<CitizenServiceRequest[]>([])
  const [selected, setSelected] = useState<CitizenServiceRequest | null>(null)
  const [status, setStatus] = useState<'UNDER_REVIEW' | 'ACTION_REQUIRED' | 'APPROVED' | 'REJECTED'>('UNDER_REVIEW')
  const [currentAction, setCurrentAction] = useState('')
  const [decisionNote, setDecisionNote] = useState('')
  const [requiredDocument, setRequiredDocument] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selectItem = (item: CitizenServiceRequest | null) => {
    setSelected(item)
    if (item) {
      setStatus(
        (item.status === 'SUBMITTED' || item.status === 'APPOINTMENT_REQUESTED' ? 'UNDER_REVIEW' : item.status) as
          'UNDER_REVIEW' | 'ACTION_REQUIRED' | 'APPROVED' | 'REJECTED'
      )
      setCurrentAction(item.currentAction)
      setDecisionNote(item.decisionNote || '')
      setRequiredDocument(item.requiredDocument || '')
    }
  }
  const load = async (reference?: string) => {
    setBusy(true)
    try {
      const results = await api.listEmployeeServiceRequests()
      setItems(results)
      selectItem(
        results.find(item => item.reference === reference || item.reference === selected?.reference) ||
          results[0] ||
          null
      )
    } catch (loadError) {
      setError((loadError as Error).message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    let active = true
    api
      .listEmployeeServiceRequests()
      .then(results => {
        if (!active) return
        setItems(results)
        selectItem(results[0] || null)
      })
      .catch(loadError => {
        if (active) setError((loadError as Error).message)
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    const refreshQueue = () => {
      void load()
    }
    window.addEventListener('employee-work-queue-updated', refreshQueue)
    return () => window.removeEventListener('employee-work-queue-updated', refreshQueue)
  }, [])
  const save = async () => {
    if (!selected || currentAction.trim().length < 6) return setError('اكتب إجراءً واضحاً للمواطن قبل الحفظ.')
    if (status === 'ACTION_REQUIRED' && requiredDocument.trim().length < 3)
      return setError('اكتب المستند أو النقص المطلوب من المواطن.')
    if (status === 'REJECTED' && decisionNote.trim().length < 6) return setError('اكتب سبب الرفض للمواطن.')
    setBusy(true)
    setError('')
    try {
      const updated = await api.updateEmployeeServiceRequest(selected.reference, {
        status,
        currentAction,
        decisionNote: decisionNote || undefined,
        requiredDocument: status === 'ACTION_REQUIRED' ? requiredDocument : undefined,
      })
      await load(updated.reference)
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const requestStatus: Record<string, string> = {
    SUBMITTED: 'تم التقديم',
    APPOINTMENT_REQUESTED: 'طلب موعد',
    UNDER_REVIEW: 'قيد التدقيق',
    ACTION_REQUIRED: 'مطلوب استكمال',
    APPROVED: 'تمت المعاملة',
    REJECTED: 'مرفوض',
  }
  return (
    <section className="service-requests-admin">
      <header className="service-requests-admin-heading">
        <div>
          <span className="section-kicker">استلام الطلبات</span>
          <h2>طلبات الخدمات والاستمارات</h2>
          <p>تصل جميع استمارات المواطنين هنا. قرارك يُسجَّل ويصل إلى المواطن كإشعار مباشر.</p>
        </div>
        <button className="button outline" onClick={() => void load()} disabled={busy}>
          <RefreshCw /> تحديث
        </button>
      </header>
      {error && (
        <div className="form-error">
          <AlertTriangle /> {error}
        </div>
      )}
      <div className="service-requests-admin-grid">
        <div className="service-requests-admin-list">
          {items.length === 0 ? (
            <div className="citizen-empty compact">
              <BriefcaseBusiness />
              <div>
                <strong>لا توجد طلبات خدمات حالياً</strong>
                <span>ستظهر الاستمارات هنا عند إرسالها من المواطن.</span>
              </div>
            </div>
          ) : (
            items.map(item => (
              <button
                key={item.reference}
                onClick={() => selectItem(item)}
                className={
                  selected?.reference === item.reference
                    ? 'service-request-admin-row active'
                    : 'service-request-admin-row'
                }
              >
                <span>
                  <BriefcaseBusiness />
                </span>
                <div>
                  <div>
                    <strong>
                      {item.serviceName || getServiceDefinition(item.serviceKey)?.title || item.serviceKey}
                    </strong>
                    <em className={`status ${item.status.toLowerCase()}`}>
                      {requestStatus[item.status] || item.status}
                    </em>
                  </div>
                  <small>
                    {item.reference} • {item.citizenName || 'مواطن'}
                  </small>
                  <p>{item.currentAction}</p>
                </div>
              </button>
            ))
          )}
        </div>
        <div className="service-request-admin-detail">
          {selected ? (
            <>
              <header>
                <div>
                  <span className={`status ${selected.status.toLowerCase()}`}>
                    {requestStatus[selected.status] || selected.status}
                  </span>
                  <h3>
                    {selected.serviceName || getServiceDefinition(selected.serviceKey)?.title || selected.serviceKey}
                  </h3>
                  <p>
                    {selected.reference} • {selected.citizenName || 'مواطن'} •{' '}
                    {selected.department || selected.departmentId}
                  </p>
                </div>
                <small>{new Date(selected.updatedAt).toLocaleString('en-GB')}</small>
              </header>
              <section className="service-request-form-data">
                <h4>بيانات الاستمارة</h4>
                <div>
                  {Object.entries(selected.formData).map(([key, value]) => (
                    <span key={key}>
                      <small>
                        {getServiceDefinition(selected.serviceKey)?.fields.find(field => field.key === key)?.label ||
                          key}
                      </small>
                      <strong>{String(value)}</strong>
                    </span>
                  ))}
                </div>
              </section>
              <section className="service-request-update">
                <h4>قرار الموظف</h4>
                <label>
                  الحالة
                  <select value={status} onChange={event => setStatus(event.target.value as typeof status)}>
                    <option value="UNDER_REVIEW">قيد التدقيق</option>
                    <option value="ACTION_REQUIRED">طلب نواقص</option>
                    <option value="APPROVED">اعتماد — تمت المعاملة</option>
                    <option value="REJECTED">رفض الطلب</option>
                  </select>
                </label>
                <label>
                  الرسالة والإجراء الظاهر للمواطن
                  <textarea
                    value={currentAction}
                    onChange={event => setCurrentAction(event.target.value.slice(0, 500))}
                    rows={3}
                    placeholder="مثال: اكتملت مراجعة البيانات واعتمدت المعاملة."
                  />
                </label>
                {status === 'ACTION_REQUIRED' && (
                  <label>
                    المستند أو الإجراء المطلوب
                    <input
                      value={requiredDocument}
                      onChange={event => setRequiredDocument(event.target.value.slice(0, 160))}
                      placeholder="مثال: مخطط هندسي مختوم"
                    />
                  </label>
                )}
                {status === 'REJECTED' && (
                  <label>
                    سبب الرفض
                    <textarea
                      value={decisionNote}
                      onChange={event => setDecisionNote(event.target.value.slice(0, 1500))}
                      rows={3}
                      placeholder="اكتب سبباً واضحاً ومفيداً للمواطن"
                    />
                  </label>
                )}
                {status !== 'REJECTED' && (
                  <label>
                    ملاحظة للمواطن <small>اختيارية</small>
                    <textarea
                      value={decisionNote}
                      onChange={event => setDecisionNote(event.target.value.slice(0, 1500))}
                      rows={2}
                      placeholder="تظهر ضمن تفاصيل الطلب وإشعاره"
                    />
                  </label>
                )}
                <button className="button primary" onClick={() => void save()} disabled={busy}>
                  <CheckCircle2 /> حفظ وإشعار المواطن
                </button>
              </section>
            </>
          ) : (
            <div className="empty-queue">
              <BriefcaseBusiness />
              <p>اختَر طلب خدمة للمراجعة.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
