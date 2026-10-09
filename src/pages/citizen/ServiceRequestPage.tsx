import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'wouter'
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarDays,
  Camera,
  Clock3,
  CreditCard,
  Download,
  Eye,
  FileArchive,
  FileCheck2,
  FileText,
  Headphones,
  History,
  QrCode,
  ReceiptText,
  RefreshCw,
  Shuffle,
} from 'lucide-react'
import { api, type CitizenServiceRequestDetail } from '../../api'
import type { CatalogService } from '../../types'
import { PortalLayout } from '../../components/citizen/PortalLayout'
import { describeAppointment, serviceRequestStatusLabel } from './my-requests'
import '../../styles/ds/citizen-requests.css'

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('en-GB')
}

const documentBadge = (status: string, required: boolean) =>
  status === 'VERIFIED'
    ? 'مدقق'
    : status === 'UPLOADED'
      ? 'بانتظار التدقيق'
      : status === 'REJECTED'
        ? 'مرفوض — أعد الرفع'
        : required
          ? 'مطلوب'
          : 'اختياري'

const actorLabel = { CITIZEN: 'أنت', DEPARTMENT: 'الدائرة', SYSTEM: 'المنصة' } as const

type DocumentRow = NonNullable<CitizenServiceRequestDetail['documents']>[number] & { accepts: Array<'image' | 'pdf'> }
type IssuedRow = NonNullable<CitizenServiceRequestDetail['issuedDocuments']>[number]
type TimelineRow = NonNullable<CitizenServiceRequestDetail['timeline']>[number]

/** The friendlier `documents` view of the detail endpoint, with the accepted file kinds from the checklist. */
function documentsOf(request: CitizenServiceRequestDetail): DocumentRow[] {
  const checklist = request.checklist || []
  const accepts = (key: string) => checklist.find(item => item.key === key)?.accepts || ['image', 'pdf']
  if (request.documents) return request.documents.map(doc => ({ ...doc, accepts: accepts(doc.key) }))
  return checklist.map(doc => ({
    key: doc.key,
    label: doc.label,
    required: doc.required,
    status: doc.status,
    rejectionReason: doc.status === 'REJECTED' ? doc.note : null,
    uploaded: doc.status === 'UPLOADED' || doc.status === 'VERIFIED',
    updatedAt: doc.updatedAt,
    accepts: doc.accepts,
  }))
}

/** Fee state: the detail endpoint's `fee` block, or the same facts read from the list item. */
function feeOf(request: CitizenServiceRequestDetail) {
  const payments = request.payments || []
  const owed =
    request.fee?.owed ||
    payments
      .filter(payment => payment.status === 'PENDING' || payment.status === 'CREATED' || payment.status === 'FAILED')
      .map(payment => ({ reference: payment.reference, amountIqd: payment.amountIqd, status: payment.status }))
  const officeReceipt = request.fee?.officeReceipt ?? request.officeReceipt ?? null
  const paidOnline = payments.filter(payment => payment.status === 'PAID' && payment.mode !== 'OFFICE')
  const payAtOffice = request.fee?.payAtOffice ?? request.paymentStatus === 'PAY_AT_OFFICE'
  return { amountIqd: request.fee?.amountIqd ?? null, owed, officeReceipt, paidOnline, payAtOffice }
}

type Step = { label: string; state: 'done' | 'current' | 'pending' | 'failed' }

/** The request's path through the department, as the citizen sees it. */
function progressSteps(request: CitizenServiceRequestDetail, fee: ReturnType<typeof feeOf>): Step[] {
  const status = request.status
  const closed = status === 'APPROVED' || status === 'REJECTED'
  const paid = Boolean(fee.officeReceipt) || fee.paidOnline.length > 0 || request.paymentStatus === 'PAID'
  const hasFee = paid || fee.owed.length > 0 || fee.payAtOffice || status === 'PAYMENT_PENDING'
  const steps: Step[] = [{ label: 'تقديم الطلب', state: 'done' }]
  if (hasFee)
    steps.push({ label: 'سداد الرسم', state: paid ? 'done' : status === 'PAYMENT_PENDING' ? 'current' : 'pending' })
  steps.push({
    label: status === 'ACTION_REQUIRED' ? 'استكمال المطلوب منك' : 'تدقيق الدائرة',
    state: closed ? 'done' : status === 'PAYMENT_PENDING' ? 'pending' : 'current',
  })
  if (request.appointment && request.appointment.status !== 'CANCELLED')
    steps.push({
      label: 'الموعد',
      state: request.appointment.confirmed || request.appointment.status === 'CONFIRMED' || closed ? 'done' : 'pending',
    })
  steps.push({
    label: status === 'REJECTED' ? 'مرفوض' : request.issuesDocument === false ? 'إنجاز الطلب' : 'القرار والإصدار',
    state: status === 'APPROVED' ? 'done' : status === 'REJECTED' ? 'failed' : 'pending',
  })
  return steps
}

/** The server timeline (newest first); for an older API, what can be reconstructed from the request itself. */
function timelineOf(request: CitizenServiceRequestDetail): TimelineRow[] {
  const byNewest = (a: TimelineRow, b: TimelineRow) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  if (request.timeline?.length) return [...request.timeline].sort(byNewest)
  const events: TimelineRow[] = [
    {
      type: 'SERVICE_REQUEST_CREATED',
      title: 'تم تقديم الطلب',
      description: 'أُرسل الطلب والمستمسكات إلى الدائرة المختصة.',
      actor: 'CITIZEN',
      createdAt: request.createdAt,
    },
  ]
  if (request.decidedAt)
    events.push({
      type: 'DECISION',
      title: request.status === 'REJECTED' ? 'قرار الدائرة: رفض' : 'قرار الدائرة: موافقة',
      description: request.decisionNote || null,
      actor: 'DEPARTMENT',
      createdAt: request.decidedAt,
    })
  if (request.updatedAt !== request.createdAt && request.updatedAt !== request.decidedAt)
    events.push({
      type: 'UPDATED',
      title: 'آخر تحديث',
      description: request.currentAction,
      actor: 'SYSTEM',
      createdAt: request.updatedAt,
    })
  return events.sort(byNewest)
}

export function ServiceRequestPage({ reference }: { reference: string }) {
  const [request, setRequest] = useState<CitizenServiceRequestDetail | null>(null)
  const [loadError, setLoadError] = useState('')
  const [fallbackIssued, setFallbackIssued] = useState<IssuedRow[]>([])
  const [service, setService] = useState<CatalogService | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState('')

  const load = useCallback(
    () =>
      api
        .getCitizenServiceRequest(reference)
        .then(item => {
          setRequest(item)
          setLoadError('')
        })
        .catch(error => setLoadError((error as Error).message || 'الطلب غير موجود.')),
    [reference]
  )
  useEffect(() => {
    void load()
  }, [load])
  // the employee's decision reaches the citizen as a notification: refresh this page when one arrives
  useEffect(() => {
    const refresh = () => void load()
    window.addEventListener('citizen-notifications-updated', refresh)
    return () => window.removeEventListener('citizen-notifications-updated', refresh)
  }, [load])
  const serviceKey = request?.serviceKey
  useEffect(() => {
    if (!serviceKey) return
    let active = true
    api
      .getService(serviceKey)
      .then(item => {
        if (active) setService(item)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [serviceKey])
  // an older API sends no issuedDocuments: look the PDFs up in the citizen's archive instead
  const needsIssuedLookup = request?.status === 'APPROVED' && !request.issuedDocuments
  useEffect(() => {
    if (!needsIssuedLookup) return
    let active = true
    api
      .listIssuedDocuments()
      .then(items => {
        if (active)
          setFallbackIssued(
            items
              .filter(item => item.serviceRequestReference === reference)
              .map(item => ({
                id: item.id,
                title: item.documentTitle,
                documentNumber: item.documentNumber,
                verificationId: item.verificationId,
                status: item.status,
                issuedAt: item.issuedAt,
                revokedAt: null,
                revokedReason: null,
                pdfUrl: item.pdfUrl,
              }))
          )
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [needsIssuedLookup, reference])

  const upload = async (target: { documentKey?: string; documentName?: string }, file: File | null) => {
    if (!request || !file) return
    setUploading(target.documentKey || 'extra')
    setUploadError('')
    try {
      await api.uploadServiceRequestDocument(request.reference, target, file)
      await load()
    } catch (error) {
      setUploadError((error as Error).message)
    } finally {
      setUploading(null)
    }
  }

  const fieldLabels = useMemo(() => new Map((service?.fields || []).map(field => [field.key, field.label])), [service])

  if (!request || request.reference !== reference)
    return (
      <PortalLayout>
        {loadError ? (
          <div className="citizen-empty-state">
            <AlertTriangle />
            <h2>تعذر فتح الطلب</h2>
            <p>{/غير موجود/.test(loadError) ? `لا يوجد طلب بالرقم ${reference} ضمن حسابك.` : loadError}</p>
            <Link href="/citizen#my-requests" className="button primary">
              <ArrowRight /> العودة إلى معاملاتي
            </Link>
          </div>
        ) : (
          <div className="loading-state">
            <RefreshCw className="spin" /> جاري تحميل الطلب...
          </div>
        )}
      </PortalLayout>
    )

  const closed = request.status === 'APPROVED' || request.status === 'REJECTED'
  const documents = documentsOf(request)
  const needsUpload = documents.filter(doc => doc.status === 'MISSING' || doc.status === 'REJECTED')
  const extraRequested =
    !closed && request.status === 'ACTION_REQUIRED' && request.requiredDocument && !needsUpload.length
  const fee = feeOf(request)
  const appointment = request.appointment ? describeAppointment(request.appointment) : null
  const issued = request.issuedDocuments || fallbackIssued
  const formEntries =
    request.formEntries ||
    Object.entries(request.formData || {}).map(([key, value]) => ({ key, label: fieldLabels.get(key) || key, value }))
  const waitingOnCitizen = request.status === 'ACTION_REQUIRED' || request.status === 'PAYMENT_PENDING'
  const tone = waitingOnCitizen
    ? 'current-action warning'
    : request.status === 'APPROVED'
      ? 'current-action success'
      : request.status === 'REJECTED'
        ? 'current-action rejected'
        : 'current-action'
  const showFee =
    fee.owed.length > 0 || fee.paidOnline.length > 0 || Boolean(fee.officeReceipt) || fee.payAtOffice || fee.amountIqd

  return (
    <PortalLayout>
      <div className="citizen-v2 cz-request-detail">
        <div className="application-detail-header">
          <Link href="/citizen#my-requests">
            <ArrowRight /> معاملاتي
          </Link>
          <div>
            <div>
              <span className={`status ${request.status.toLowerCase()}`}>
                {serviceRequestStatusLabel(request.status)}
              </span>
              <span dir="ltr">{request.reference}</span>
            </div>
            <h1>{request.serviceName || request.serviceKey}</h1>
            <p>
              {request.departmentName || request.department} • تم التقديم{' '}
              {new Date(request.createdAt).toLocaleDateString('en-GB')}
            </p>
          </div>
        </div>

        <ol className="svc-stepper" aria-label="مراحل الطلب">
          {progressSteps(request, fee).map((step, index) => (
            <li
              key={step.label}
              className={
                step.state === 'done'
                  ? 'is-done'
                  : step.state === 'current'
                    ? 'is-current'
                    : step.state === 'failed'
                      ? 'is-failed'
                      : ''
              }
              aria-current={step.state === 'current' ? 'step' : undefined}
            >
              <b>{index + 1}</b>
              <span>{step.label}</span>
            </li>
          ))}
        </ol>

        <section className={tone}>
          <span>
            {waitingOnCitizen || request.status === 'REJECTED' ? (
              <AlertTriangle />
            ) : request.status === 'APPROVED' ? (
              <BadgeCheck />
            ) : (
              <Clock3 />
            )}
          </span>
          <div>
            <small>
              {request.status === 'REJECTED'
                ? 'قرار الدائرة'
                : waitingOnCitizen
                  ? 'المطلوب منك الآن'
                  : 'الإجراء الحالي لدى الدائرة'}
            </small>
            <strong>{request.currentAction}</strong>
            {request.decisionNote && (
              <p className="rejection-reason">
                {request.status === 'REJECTED' ? 'سبب الرفض' : 'ملاحظة الموظف'}: {request.decisionNote}
                {request.decidedAt ? ` — ${new Date(request.decidedAt).toLocaleDateString('en-GB')}` : ''}
              </p>
            )}
          </div>
        </section>

        {uploadError && (
          <div className="form-error" role="alert">
            <AlertTriangle /> {uploadError}
          </div>
        )}

        <div className="cz-request-grid">
          <div className="cz-request-column">
            {(documents.length > 0 || extraRequested) && (
              <section className="app-card cz-request-card" id="documents">
                <h2>
                  <FileCheck2 /> المستمسكات
                </h2>
                <p>يدقق موظف الدائرة كل مستمسك على حدة. أعد رفع أي مستمسك مرفوض ليعود الطلب إلى التدقيق.</p>
                {documents.length > 0 && (
                  <ul className="citizen-checklist">
                    {documents.map(doc => {
                      const busy = uploading === doc.key
                      const canUpload = !closed && (doc.status === 'MISSING' || doc.status === 'REJECTED')
                      return (
                        <li key={doc.key} className={`checklist-${doc.status.toLowerCase()}`}>
                          <span className={`checklist-badge ${doc.status.toLowerCase()}`}>
                            {documentBadge(doc.status, doc.required)}
                          </span>
                          <div>
                            <strong>{doc.label}</strong>
                            {doc.status === 'REJECTED' && doc.rejectionReason && (
                              <small>سبب الرفض: {doc.rejectionReason}</small>
                            )}
                            {doc.updatedAt && doc.status !== 'MISSING' && (
                              <small className="cz-doc-time">آخر تحديث: {formatDateTime(doc.updatedAt)}</small>
                            )}
                          </div>
                          {canUpload && (
                            <label className="button outline small">
                              <Camera /> {busy ? 'جاري الرفع...' : doc.status === 'REJECTED' ? 'إعادة الرفع' : 'رفع'}
                              <input
                                hidden
                                type="file"
                                accept={doc.accepts.includes('pdf') ? 'image/*,application/pdf' : 'image/*'}
                                capture="environment"
                                disabled={busy}
                                onChange={event => {
                                  void upload({ documentKey: doc.key }, event.target.files?.[0] || null)
                                  event.target.value = ''
                                }}
                              />
                            </label>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
                {extraRequested && (
                  <div className="cz-callout is-warning">
                    <div>
                      <FileText />
                      <span>
                        <small>طلبت الدائرة منك</small>
                        <strong>{request.requiredDocument}</strong>
                      </span>
                    </div>
                    <label className="button primary">
                      <Camera /> {uploading === 'extra' ? 'جاري الرفع...' : 'تصوير / رفع المستند'}
                      <input
                        hidden
                        type="file"
                        accept="image/*,application/pdf"
                        capture="environment"
                        disabled={uploading === 'extra'}
                        onChange={event => {
                          void upload(
                            { documentName: request.requiredDocument || 'المستند المطلوب' },
                            event.target.files?.[0] || null
                          )
                          event.target.value = ''
                        }}
                      />
                    </label>
                  </div>
                )}
              </section>
            )}

            {request.status === 'APPROVED' && (issued.length > 0 || request.issuesDocument !== false) && (
              <section className="app-card cz-request-card" id="issued">
                <h2>
                  <FileArchive /> الوثائق الصادرة
                </h2>
                {issued.length ? (
                  issued.map(document => (
                    <div
                      className={document.status === 'REVOKED' ? 'cz-callout is-warning' : 'cz-callout is-success'}
                      key={document.id}
                    >
                      <div>
                        <FileCheck2 />
                        <span>
                          <small>
                            {document.documentNumber} • {formatDateTime(document.issuedAt)}
                          </small>
                          <strong>{document.title}</strong>
                          {document.status === 'REVOKED' && (
                            <small>أُلغيت الوثيقة{document.revokedReason ? `: ${document.revokedReason}` : ''}</small>
                          )}
                        </span>
                      </div>
                      <div className="issued-pdf-actions compact">
                        <a className="button primary" href={document.pdfUrl} target="_blank" rel="noreferrer">
                          <Eye /> معاينة PDF
                        </a>
                        <a className="button outline" href={`${document.pdfUrl}?download=1`} download>
                          <Download /> تنزيل PDF
                        </a>
                        <Link className="button outline" href={`/verify/${document.verificationId}`}>
                          <QrCode /> تحقق
                        </Link>
                      </div>
                    </div>
                  ))
                ) : (
                  <p>اكتملت المعاملة، وتظهر الوثيقة هنا فور أرشفتها.</p>
                )}
              </section>
            )}

            <section className="app-card cz-request-card">
              <h2>
                <History /> سجل الطلب
              </h2>
              <ol className="cz-timeline">
                {timelineOf(request).map((event, index) => (
                  <li key={`${event.type}-${event.createdAt}-${index}`}>
                    <strong>{event.title}</strong>
                    {event.description && <p>{event.description}</p>}
                    <time>
                      {formatDateTime(event.createdAt)}
                      {actorLabel[event.actor] ? ` • ${actorLabel[event.actor]}` : ''}
                    </time>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <aside className="cz-request-column">
            {showFee && (
              <section className="app-card cz-request-card" id="payment">
                <h2>
                  <CreditCard /> الرسوم والدفع
                </h2>
                {!closed &&
                  fee.owed.map(item => (
                    <div className="cz-callout is-warning" key={item.reference}>
                      <div>
                        <CreditCard />
                        <span>
                          <small>رسم الخدمة المستحق</small>
                          <strong>{item.amountIqd.toLocaleString('en-US')} د.ع</strong>
                        </span>
                      </div>
                      <Link className="button primary" href={`/citizen/pay/${item.reference}`}>
                        <CreditCard /> ادفع إلكترونياً
                      </Link>
                    </div>
                  ))}
                {fee.payAtOffice && !fee.officeReceipt && !fee.paidOnline.length && !closed && (
                  <div className="cz-callout">
                    <div>
                      <Building2 />
                      <span>
                        <small>ادفع في الدائرة</small>
                        <strong>
                          {fee.amountIqd ? `${fee.amountIqd.toLocaleString('en-US')} د.ع — ` : ''}
                          يُسدد في {request.departmentName || request.department}
                        </strong>
                      </span>
                    </div>
                    <p className="svc-muted">
                      راجع شباك الحسابات في الدائرة واذكر رقم الطلب <b dir="ltr">{request.reference}</b>، واحتفظ بالوصل
                      الرسمي. يسجّل الموظف رقم الوصل هنا بعد الدفع.
                    </p>
                  </div>
                )}
                {fee.officeReceipt && (
                  <div className="cz-callout is-success">
                    <div>
                      <ReceiptText />
                      <span>
                        <small>وصل الدفع في الدائرة</small>
                        <strong>
                          {fee.officeReceipt.receiptNumber || fee.officeReceipt.paymentReference} —{' '}
                          {fee.officeReceipt.amountIqd.toLocaleString('en-US')} د.ع
                        </strong>
                        {fee.officeReceipt.recordedAt && <small>{formatDateTime(fee.officeReceipt.recordedAt)}</small>}
                        {fee.officeReceipt.note && <small>{fee.officeReceipt.note}</small>}
                      </span>
                    </div>
                  </div>
                )}
                {fee.paidOnline.map(payment => (
                  <div className="cz-callout is-success" key={payment.reference}>
                    <div>
                      <ReceiptText />
                      <span>
                        <small>إيصال الدفع الإلكتروني</small>
                        <strong>
                          {payment.receiptNumber || payment.reference} — {payment.amountIqd.toLocaleString('en-US')} د.ع
                        </strong>
                        {payment.paidAt && <small>{formatDateTime(payment.paidAt)}</small>}
                      </span>
                    </div>
                  </div>
                ))}
                {!fee.owed.length && !fee.payAtOffice && !fee.officeReceipt && !fee.paidOnline.length && (
                  <p>
                    رسم الخدمة {fee.amountIqd?.toLocaleString('en-US')} د.ع — تحدد الدائرة طريقة السداد عند التدقيق.
                  </p>
                )}
              </section>
            )}

            {appointment && request.appointment && (
              <section className="app-card cz-request-card" id="appointment">
                <h2>
                  <CalendarDays /> الموعد
                </h2>
                <div className={appointment.confirmed ? 'cz-callout is-success' : 'cz-callout'}>
                  <div>
                    <CalendarDays />
                    <span>
                      <small>{appointment.title}</small>
                      <strong>{appointment.when}</strong>
                      {appointment.note && <small>{appointment.note}</small>}
                      {request.appointment.department && <small>{request.appointment.department}</small>}
                    </span>
                  </div>
                </div>
                {!appointment.confirmed && request.appointment.status !== 'CANCELLED' && (
                  <p>تراجع الدائرة طلبك وتؤكد الموعد أو تحدد موعداً آخر، ويصلك إشعار بذلك.</p>
                )}
              </section>
            )}

            {request.transfers && request.transfers.length > 0 && (
              <section className="app-card cz-request-card">
                <h2>
                  <Shuffle /> الإحالات بين الدوائر
                </h2>
                <ol className="cz-timeline">
                  {request.transfers.map((transfer, index) => (
                    <li key={`${transfer.createdAt}-${index}`}>
                      <strong>
                        من {transfer.fromDepartmentName} إلى {transfer.toDepartmentName}
                      </strong>
                      <time>{formatDateTime(transfer.createdAt)}</time>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {formEntries.length > 0 && (
              <section className="app-card cz-request-card">
                <h2>
                  <FileText /> بيانات الطلب
                </h2>
                <dl className="cz-kv">
                  {formEntries.map(entry => (
                    <div key={entry.key}>
                      <dt>{entry.label}</dt>
                      <dd>{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            <div className="support-card">
              <Headphones />
              <strong>تحتاج مساعدة؟</strong>
              <p>
                أرسل استفسارك عبر الشكاوى والمقترحات مع ذكر رقم الطلب {request.reference} وستصلك الإجابة في الإشعارات.
              </p>
              <Link
                href={`/citizen/feedback?about=${encodeURIComponent(request.reference)}`}
                className="button outline"
              >
                راسل الدعم
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </PortalLayout>
  )
}
