import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Eye,
  FileCheck2,
  FileWarning,
  Info,
  ReceiptText,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import { api } from '../../api'
import { useSession } from '../../lib/session'
import type { ChecklistItem, CitizenServiceRequest } from '../../types'

const requestStatus: Record<string, string> = {
  SUBMITTED: 'جديد',
  APPOINTMENT_REQUESTED: 'طلب موعد',
  UNDER_REVIEW: 'قيد التدقيق',
  ACTION_REQUIRED: 'بانتظار المواطن',
  APPROVED: 'تمت الموافقة',
  REJECTED: 'مرفوض',
  PAYMENT_PENDING: 'بانتظار الدفع',
}

const checklistStatus: Record<ChecklistItem['status'], string> = {
  MISSING: 'غير مرفوع',
  UPLOADED: 'بانتظار التدقيق',
  VERIFIED: 'مدقق ✓',
  REJECTED: 'مرفوض — يُعاد رفعه',
}

type Decision = 'UNDER_REVIEW' | 'ACTION_REQUIRED' | 'APPROVED' | 'REJECTED' | 'PAYMENT_REQUIRED'

export function ServiceRequestAdminPanel({
  departmentId,
  focusReference,
}: {
  /** When set (department dashboard), only this department's requests are shown even for supervisors. */
  departmentId?: string
  /** Reference to open when the list loads / changes. */
  focusReference?: string | null
} = {}) {
  const { session } = useSession()
  const readOnly = session?.role === 'OPERATIONS' || session?.role === 'IDENTITY_REVIEWER'
  const [items, setItems] = useState<CitizenServiceRequest[]>([])
  const [scope, setScope] = useState<{ scope: string; message?: string }>({ scope: 'ALL' })
  const [filter, setFilter] = useState<'OPEN' | 'ALL'>('OPEN')
  const [selected, setSelected] = useState<CitizenServiceRequest | null>(null)
  const [status, setStatus] = useState<Decision>('UNDER_REVIEW')
  const [currentAction, setCurrentAction] = useState('')
  const [decisionNote, setDecisionNote] = useState('')
  const [requiredDocument, setRequiredDocument] = useState('')
  const [appointmentDate, setAppointmentDate] = useState('')
  const [appointmentNote, setAppointmentNote] = useState('')
  const [amountIqd, setAmountIqd] = useState('')
  const [docNotes, setDocNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const selectItem = useCallback((item: CitizenServiceRequest | null) => {
    setSelected(item)
    setError('')
    if (item) {
      setStatus(
        (item.status === 'SUBMITTED' || item.status === 'APPOINTMENT_REQUESTED' || item.status === 'PAYMENT_PENDING'
          ? 'UNDER_REVIEW'
          : item.status) as Decision
      )
      setCurrentAction('')
      setDecisionNote(item.decisionNote || '')
      setRequiredDocument('')
      setAppointmentDate('')
      setAppointmentNote('')
      setAmountIqd('')
      setDocNotes({})
    }
  }, [])

  const load = useCallback(
    async (reference?: string) => {
      setBusy(true)
      try {
        const response = await api.listEmployeeServiceRequests()
        setScope({ scope: response.scope, message: response.message })
        const items = departmentId ? response.items.filter(item => item.departmentId === departmentId) : response.items
        setItems(items)
        const target = reference || selected?.reference
        const next = items.find(item => item.reference === target) || null
        if (next || !target) selectItem(next || items[0] || null)
      } catch (loadError) {
        setError((loadError as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [selected?.reference, selectItem, departmentId]
  )

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!focusReference) return
    const match = items.find(item => item.reference === focusReference)
    if (match && match.reference !== selected?.reference) {
      selectItem(match)
      setFilter('ALL')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReference, items])
  useEffect(() => {
    const refreshQueue = () => void load()
    window.addEventListener('employee-work-queue-updated', refreshQueue)
    return () => window.removeEventListener('employee-work-queue-updated', refreshQueue)
  }, [load])

  const reviewDocument = async (item: ChecklistItem, verdict: 'VERIFIED' | 'REJECTED') => {
    if (!selected) return
    const note = (docNotes[item.key] || '').trim()
    if (verdict === 'REJECTED' && note.length < 3)
      return setError(`اكتب سبب رفض «${item.label}» حتى يعرف المواطن ما المطلوب.`)
    setBusy(true)
    setError('')
    try {
      const updated = await api.reviewServiceRequestDocument(selected.reference, item.key, {
        status: verdict,
        note: note || undefined,
      })
      setItems(current => current.map(entry => (entry.reference === updated.reference ? updated : entry)))
      setSelected(updated)
    } catch (reviewError) {
      setError((reviewError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!selected) return
    if (status === 'REJECTED' && decisionNote.trim().length < 6) return setError('اكتب سبب الرفض للمواطن.')
    if (status === 'PAYMENT_REQUIRED' && !(Number(amountIqd) >= 250))
      return setError('أدخل مبلغ الرسم بالدينار (250 د.ع فأكثر).')
    if (status === 'APPROVED' && pendingRequired.length)
      return setError(`دقّق كل المستمسكات المطلوبة قبل الموافقة: ${pendingRequired.map(doc => doc.label).join('، ')}.`)
    setBusy(true)
    setError('')
    try {
      const updated = await api.updateEmployeeServiceRequest(selected.reference, {
        status,
        currentAction: currentAction.trim().length >= 6 ? currentAction.trim() : undefined,
        decisionNote: decisionNote.trim() || undefined,
        requiredDocument: status === 'ACTION_REQUIRED' && requiredDocument.trim() ? requiredDocument.trim() : undefined,
        appointmentDate: status === 'APPROVED' && appointmentDate ? appointmentDate : undefined,
        appointmentNote: status === 'APPROVED' && appointmentNote.trim() ? appointmentNote.trim() : undefined,
        amountIqd: status === 'PAYMENT_REQUIRED' ? Math.round(Number(amountIqd)) : undefined,
      })
      await load(updated.reference)
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const checklist = selected?.checklist || []
  const pendingRequired = checklist.filter(item => item.required && item.status !== 'VERIFIED')
  const rejectedDocs = checklist.filter(item => item.status === 'REJECTED')
  const closed = selected ? ['APPROVED', 'REJECTED'].includes(selected.status) : false
  const pendingPayment = selected?.payments?.find(payment => payment.status === 'PENDING')
  const paidPayments = selected?.payments?.filter(payment => payment.status === 'PAID') || []
  const visibleItems = items.filter(item => filter === 'ALL' || !['APPROVED', 'REJECTED'].includes(item.status))
  const openCount = items.filter(item => !['APPROVED', 'REJECTED'].includes(item.status)).length
  const attachmentFor = (item: ChecklistItem) =>
    selected?.attachments?.find(attachment => attachment.mediaId === item.mediaId) || null

  return (
    <section className="service-requests-admin">
      <header className="service-requests-admin-heading">
        <div>
          <span className="section-kicker">قائمة الدائرة</span>
          <h2>طلبات الخدمات الإلكترونية</h2>
          <p>
            {scope.scope === 'ALL'
              ? 'تعرض هذه القائمة طلبات جميع الدوائر (صلاحية إشراف).'
              : 'تصل هنا طلبات دائرتك فقط. دقّق كل مستمسك، ثم اتخذ القرار — يصل المواطن إشعار فوري.'}
          </p>
        </div>
        <div className="service-requests-admin-tools">
          <div className="gov-segmented" role="group" aria-label="تصفية الطلبات">
            <button className={filter === 'OPEN' ? 'active' : ''} onClick={() => setFilter('OPEN')}>
              المفتوحة <b>{openCount.toLocaleString('en-US')}</b>
            </button>
            <button className={filter === 'ALL' ? 'active' : ''} onClick={() => setFilter('ALL')}>
              الكل <b>{items.length.toLocaleString('en-US')}</b>
            </button>
          </div>
          <button className="button outline" onClick={() => void load()} disabled={busy}>
            <RefreshCw className={busy ? 'spin' : ''} /> تحديث
          </button>
        </div>
      </header>
      {scope.scope === 'NONE' && (
        <div className="form-error">
          <AlertTriangle /> {scope.message || 'حسابك غير مرتبط بدائرة بعد.'}
        </div>
      )}
      {error && (
        <div className="form-error" role="alert">
          <AlertTriangle /> {error}
        </div>
      )}
      <div className="service-requests-admin-grid">
        <div className="service-requests-admin-list">
          {visibleItems.length === 0 ? (
            <div className="citizen-empty compact">
              <BriefcaseBusiness />
              <div>
                <strong>{filter === 'OPEN' ? 'لا توجد طلبات مفتوحة' : 'لا توجد طلبات بعد'}</strong>
                <span>تظهر الطلبات هنا فور إرسالها من المواطن مع مستمسكاتها.</span>
              </div>
            </div>
          ) : (
            visibleItems.map(item => {
              const pending = (item.checklist || []).filter(doc => doc.status === 'UPLOADED').length
              return (
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
                      <strong>{item.serviceName || item.serviceKey}</strong>
                      <em className={`status ${item.status.toLowerCase()}`}>
                        {requestStatus[item.status] || item.status}
                      </em>
                    </div>
                    <small>
                      {item.reference} • {item.citizenName || 'مواطن'}
                      {scope.scope === 'ALL' && item.department ? ` • ${item.department}` : ''}
                    </small>
                    <p>{pending ? `${pending.toLocaleString('en-US')} مستمسك بانتظار التدقيق` : item.currentAction}</p>
                  </div>
                </button>
              )
            })
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
                  <h3>{selected.serviceName || selected.serviceKey}</h3>
                  <p>
                    {selected.reference} • {selected.citizenName || 'مواطن'}
                    {selected.citizenPhone ? ` • ${selected.citizenPhone}` : ''} •{' '}
                    {selected.department || selected.departmentId}
                  </p>
                </div>
                <small>
                  أُرسل {new Date(selected.createdAt).toLocaleString('en-GB')}
                  <br />
                  آخر تحديث {new Date(selected.updatedAt).toLocaleString('en-GB')}
                </small>
              </header>
              <div className="service-request-current-action">
                <Info />
                <span>{selected.currentAction}</span>
              </div>
              {selected.appointment && (
                <div className="service-request-current-action">
                  <CalendarClock />
                  <span>
                    موعد مطلوب: {selected.appointment.preferredDate} الساعة {selected.appointment.preferredTime} —{' '}
                    {selected.appointment.status === 'CONFIRMED' ? 'مؤكد' : 'بانتظار التأكيد'}
                  </span>
                </div>
              )}

              {selected.paymentStatus === 'PAY_AT_OFFICE' && !pendingPayment && paidPayments.length === 0 && (
                <div className="service-request-current-action">
                  <ReceiptText />
                  <span>
                    رسم رسمي يُستوفى في الدائرة عند إكمال الإجراء (الدفع الإلكتروني غير مفعّل). تأكد من الاستيفاء قبل
                    الموافقة.
                  </span>
                </div>
              )}
              {(pendingPayment || paidPayments.length > 0) && (
                <div className={`service-request-current-action ${pendingPayment ? '' : 'closed'}`}>
                  <ReceiptText />
                  <span>
                    {pendingPayment
                      ? `بانتظار سداد ${pendingPayment.amountIqd.toLocaleString('en-US')} د.ع (${pendingPayment.reference}) — لا يمكن الموافقة قبل التسديد.`
                      : `الرسوم مسددة: ${paidPayments.map(payment => `${payment.receiptNumber} — ${payment.amountIqd.toLocaleString('en-US')} د.ع`).join('، ')}`}
                  </span>
                </div>
              )}
              <section className="service-request-form-data">
                <h4>بيانات الاستمارة</h4>
                {(selected.formEntries?.length || Object.keys(selected.formData).length) > 0 ? (
                  <div>
                    {(
                      selected.formEntries ||
                      Object.entries(selected.formData).map(([key, value]) => ({ key, label: key, value }))
                    ).map(entry => (
                      <span key={entry.key}>
                        <small>{entry.label}</small>
                        <strong>{String(entry.value)}</strong>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="gov-muted">لا توجد حقول إضافية لهذه الخدمة.</p>
                )}
              </section>

              <section className="service-request-checklist">
                <h4>
                  <FileCheck2 /> تدقيق المستمسكات{' '}
                  <small>
                    {checklist.filter(item => item.status === 'VERIFIED').length.toLocaleString('en-US')} /{' '}
                    {checklist.length.toLocaleString('en-US')} مدقق
                  </small>
                </h4>
                {checklist.length === 0 ? (
                  <p className="gov-muted">لا تتطلب هذه الخدمة مستمسكات.</p>
                ) : (
                  <ul>
                    {checklist.map(item => {
                      const attachment = attachmentFor(item)
                      return (
                        <li key={item.key} className={`checklist-${item.status.toLowerCase()}`}>
                          <div className="checklist-head">
                            <div>
                              <strong>
                                {item.label} {!item.required && <em>اختياري</em>}
                              </strong>
                              {item.description && <small>{item.description}</small>}
                            </div>
                            <span className={`checklist-badge ${item.status.toLowerCase()}`}>
                              {checklistStatus[item.status]}
                            </span>
                          </div>
                          {item.note && item.status === 'REJECTED' && (
                            <p className="checklist-note">
                              <FileWarning /> {item.note}
                            </p>
                          )}
                          {item.mediaId && (
                            <div className="checklist-actions">
                              <a
                                className="button outline small"
                                href={`/api/employee/service-requests/${encodeURIComponent(selected.reference)}/media/${encodeURIComponent(item.mediaId)}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Eye /> عرض {attachment?.mimeType === 'application/pdf' ? 'PDF' : 'الصورة'}
                              </a>
                              {!closed && !readOnly && item.status === 'UPLOADED' && (
                                <>
                                  <input
                                    value={docNotes[item.key] || ''}
                                    onChange={event =>
                                      setDocNotes(current => ({
                                        ...current,
                                        [item.key]: event.target.value.slice(0, 400),
                                      }))
                                    }
                                    placeholder="ملاحظة (إلزامية عند الرفض)"
                                    aria-label={`ملاحظة على ${item.label}`}
                                  />
                                  <button
                                    className="button primary small"
                                    disabled={busy}
                                    onClick={() => void reviewDocument(item, 'VERIFIED')}
                                  >
                                    <CheckCircle2 /> صحيح
                                  </button>
                                  <button
                                    className="button danger small"
                                    disabled={busy}
                                    onClick={() => void reviewDocument(item, 'REJECTED')}
                                  >
                                    <XCircle /> غير مقبول
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              {!closed && !readOnly ? (
                <section className="service-request-update">
                  <h4>قرار الدائرة</h4>
                  <label>
                    الحالة
                    <select value={status} onChange={event => setStatus(event.target.value as Decision)}>
                      <option value="UNDER_REVIEW">قيد التدقيق</option>
                      <option value="ACTION_REQUIRED">إعادة للمواطن — نواقص</option>
                      <option value="APPROVED" disabled={pendingRequired.length > 0}>
                        موافقة {pendingRequired.length ? `(بقي ${pendingRequired.length} مستمسك)` : ''}
                      </option>
                      <option value="PAYMENT_REQUIRED" disabled={pendingPayment !== undefined}>
                        طلب سداد رسم {pendingPayment ? '(يوجد رسم بانتظار السداد)' : ''}
                      </option>
                      <option value="REJECTED">رفض الطلب</option>
                    </select>
                  </label>
                  {status === 'PAYMENT_REQUIRED' && (
                    <label>
                      مبلغ الرسم (د.ع)
                      <input
                        inputMode="numeric"
                        value={amountIqd}
                        onChange={event => setAmountIqd(event.target.value.replace(/[^\d]/g, ''))}
                        placeholder="مثال: 25000"
                      />
                      <small>يُرسل للمواطن رابط الدفع الإلكتروني ويعود الطلب إليك بعد التسديد.</small>
                    </label>
                  )}
                  {status === 'ACTION_REQUIRED' && (
                    <>
                      {rejectedDocs.length > 0 && (
                        <p className="gov-muted">
                          سيُطلب من المواطن إعادة رفع: {rejectedDocs.map(doc => doc.label).join('، ')}.
                        </p>
                      )}
                      <label>
                        مستمسك أو إجراء إضافي <small>اختياري إن كانت هناك مستمسكات مرفوضة أعلاه</small>
                        <input
                          value={requiredDocument}
                          onChange={event => setRequiredDocument(event.target.value.slice(0, 160))}
                          placeholder="مثال: مخطط هندسي مختوم من نقابة المهندسين"
                        />
                      </label>
                    </>
                  )}
                  {status === 'APPROVED' && (
                    <div className="form-grid">
                      <label>
                        موعد حضور المواطن <small>إن كان الإجراء يتطلب الحضور</small>
                        <input
                          type="date"
                          value={appointmentDate}
                          min={new Date().toISOString().slice(0, 10)}
                          onChange={event => setAppointmentDate(event.target.value)}
                        />
                      </label>
                      <label>
                        تعليمات الحضور
                        <input
                          value={appointmentNote}
                          onChange={event => setAppointmentNote(event.target.value.slice(0, 300))}
                          placeholder="مثال: الطابق الثاني، شعبة الإصدار، إحضار الأصول"
                        />
                      </label>
                    </div>
                  )}
                  <label>
                    {status === 'REJECTED'
                      ? 'سبب الرفض (يصل المواطن نصاً)'
                      : status === 'PAYMENT_REQUIRED'
                        ? 'بيان الرسم (يظهر للمواطن مع رابط الدفع)'
                        : 'ملاحظة للمواطن'}{' '}
                    {status !== 'REJECTED' && <small>اختيارية</small>}
                    <textarea
                      value={decisionNote}
                      onChange={event => setDecisionNote(event.target.value.slice(0, 1500))}
                      rows={3}
                      placeholder={
                        status === 'REJECTED' ? 'اكتب سبباً واضحاً وقابلاً للتصحيح' : 'تظهر ضمن تفاصيل الطلب وإشعاره'
                      }
                    />
                  </label>
                  <label>
                    نص الإجراء الظاهر للمواطن <small>اختياري — يُولَّد تلقائياً إن تُرك فارغاً</small>
                    <input
                      value={currentAction}
                      onChange={event => setCurrentAction(event.target.value.slice(0, 500))}
                      placeholder="مثال: اكتمل التدقيق وسيُستدعى المواطن لاستلام الإجازة"
                    />
                  </label>
                  <button className="button primary" onClick={() => void save()} disabled={busy}>
                    <CheckCircle2 /> حفظ القرار وإشعار المواطن
                  </button>
                </section>
              ) : readOnly && !closed ? (
                <div className="service-request-current-action">
                  <Info />
                  <span>عرض للمتابعة فقط — القرار وتدقيق المستمسكات من صلاحية موظفي الدائرة.</span>
                </div>
              ) : (
                <div className="service-request-current-action closed">
                  <CheckCircle2 />
                  <span>
                    قرار نهائي بواسطة {selected.decidedBy || 'الدائرة'}
                    {selected.decidedAt ? ` — ${new Date(selected.decidedAt).toLocaleString('en-GB')}` : ''}
                    {selected.decisionNote ? ` — ${selected.decisionNote}` : ''}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="empty-queue">
              <BriefcaseBusiness />
              <p>اختَر طلباً من القائمة لتدقيق مستمسكاته واتخاذ القرار.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
