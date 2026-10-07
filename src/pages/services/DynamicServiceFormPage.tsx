import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Building2,
  CalendarClock,
  CheckCircle2,
  Circle,
  Clock3,
  CreditCard,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  Info,
  Landmark,
  ReceiptText,
  Send,
  ShieldCheck,
} from 'lucide-react'
import { api } from '../../api'
import { getServiceDefinition } from '../../service-forms'
import type { CatalogService } from '../../types'
import { SecureCameraCapture } from '../../components/camera/SecureCameraCapture'
import { LoadingBlock, PageHeader } from '../../components/public/PageHeader'
import { NotFound } from '../NotFound'
import {
  onboardingPathForService,
  useCitizenSubmissionAccess,
  ServiceSubmissionNotice,
  PublicServiceFrame,
} from './submission-access'

const draftKey = (serviceKey: string) => `dhiqar-service-draft:${serviceKey}`

const channelLabel: Record<CatalogService['channel'], string> = {
  ONLINE_SUBMISSION: 'تقديم إلكتروني كامل',
  APPOINTMENT_REQUIRED: 'تقديم إلكتروني + حضور لإكمال الإجراء',
  INFORMATION_ONLY: 'خدمة معلوماتية',
}

const applicantLabel: Record<CatalogService['applicantType'], string> = {
  CITIZEN: 'للمواطنين',
  BUSINESS: 'للشركات والأعمال',
  BOTH: 'للمواطنين والأعمال',
}

function feeText(service: CatalogService) {
  if (service.feeStatus === 'OFFICIAL' && service.feeIqd) return `${service.feeIqd.toLocaleString('en-US')} د.ع`
  if (service.feeStatus === 'NOT_REQUIRED') return 'تحددها الدائرة عند التدقيق'
  return 'غير مؤكدة — تُثبَّت من الدائرة'
}

/** Sticky summary next to the form: what the service is, what it costs, and which documents are ready. */
function ServiceSummary({
  service,
  documents,
  showDocuments,
}: {
  service: CatalogService
  documents?: Record<string, File | null>
  showDocuments: boolean
}) {
  const docs = service.requiredDocuments
  const ready = documents ? docs.filter(doc => documents[doc.key]).length : 0
  return (
    <aside className="tq-stack tq-sticky svc-summary" aria-label="ملخص الخدمة">
      <article className="tq-panel">
        <h2>
          <ReceiptText /> ملخص الخدمة
        </h2>
        <dl className="tq-dl">
          <div>
            <dt>طريقة التقديم</dt>
            <dd>{channelLabel[service.channel]}</dd>
          </div>
          <div>
            <dt>الرسوم</dt>
            <dd>
              {feeText(service)}
              {service.feeStatus === 'OFFICIAL' && service.feeSource && (
                <a href={service.feeSource} target="_blank" rel="noreferrer" className="svc-fee-source">
                  المصدر الرسمي
                </a>
              )}
            </dd>
          </div>
          {service.estimatedDuration && (
            <div>
              <dt>مدة الإنجاز</dt>
              <dd>{service.estimatedDuration}</dd>
            </div>
          )}
          <div>
            <dt>الجهة</dt>
            <dd>
              <Link href={`/departments/${service.departmentId}`} className="gov-link">
                {service.departmentName}
              </Link>
            </dd>
          </div>
        </dl>
      </article>
      {showDocuments && docs.length > 0 && (
        <article className="tq-panel">
          <div className="tq-panel-head">
            <div>
              <h2>
                <FileCheck2 /> المستمسكات
              </h2>
              {documents && (
                <p>
                  {ready.toLocaleString('en-US')} من {docs.length.toLocaleString('en-US')} جاهزة
                </p>
              )}
            </div>
          </div>
          {documents && (
            <div className="svc-progress" aria-hidden="true">
              <i style={{ width: `${docs.length ? (ready / docs.length) * 100 : 0}%` }} />
            </div>
          )}
          <ul className="svc-checklist">
            {docs.map(doc => {
              const done = Boolean(documents?.[doc.key])
              return (
                <li key={doc.key} className={done ? 'is-done' : ''}>
                  {done ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />}
                  <span>{doc.label}</span>
                  {!doc.required && <small>اختياري</small>}
                </li>
              )
            })}
          </ul>
        </article>
      )}
      {service.sourceUrl && (
        <a href={service.sourceUrl} target="_blank" rel="noreferrer" className="gov-link svc-source">
          <ExternalLink size={14} /> المصدر الرسمي لبيانات الخدمة
        </a>
      )}
    </aside>
  )
}

export function DynamicServiceFormPage({ serviceKey }: { serviceKey: string }) {
  const [service, setService] = useState<CatalogService | null | undefined>(undefined)
  const [, navigate] = useLocation()
  const access = useCitizenSubmissionAccess()
  const [draft] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(draftKey(serviceKey)) || '{}') as Record<string, string>
    } catch {
      return {}
    }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [faceVideo, setFaceVideo] = useState<File | null>(null)
  const [faceConsent, setFaceConsent] = useState(false)
  const [documentConsent, setDocumentConsent] = useState(false)
  const [documents, setDocuments] = useState<Record<string, File | null>>({})
  const [result, setResult] = useState<{
    reference: string
    currentAction: string
    department: string
    appointment: { preferredDate: string; preferredTime: string; status: string } | null
    payment?: { reference: string; amountIqd: number; mode: string } | null
  } | null>(null)

  useEffect(() => {
    let active = true
    setService(undefined)
    api
      .getService(serviceKey)
      .then(item => {
        if (active) setService(item)
      })
      .catch(() => {
        if (active) setService(null)
      })
    return () => {
      active = false
    }
  }, [serviceKey])

  const [profile, setProfile] = useState<{ fullName: string } | null>(null)
  useEffect(() => {
    if (access !== 'verified') return
    let active = true
    api
      .getDemoCitizen()
      .then(citizen => {
        if (active) setProfile({ fullName: citizen.fullName })
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [access])
  const legacy = useMemo(() => getServiceDefinition(serviceKey), [serviceKey])
  const today = new Date().toISOString().slice(0, 10)
  const maxDate = useMemo(() => {
    const date = new Date()
    date.setDate(date.getDate() + 90)
    return date.toISOString().slice(0, 10)
  }, [])

  if (service === undefined)
    return (
      <PublicServiceFrame>
        <div className="tq-content">
          <div className="tq-container">
            <LoadingBlock label="جاري تحميل بيانات الخدمة…" />
          </div>
        </div>
      </PublicServiceFrame>
    )
  if (!service) return <NotFound />

  const isInformation = service.channel === 'INFORMATION_ONLY' || service.mode === 'EXTERNAL'
  const isAppointmentFlow = service.mode === 'APPOINTMENT'
  const requiredDocs = service.requiredDocuments.filter(doc => doc.required)
  const optionalDocs = service.requiredDocuments.filter(doc => !doc.required)
  const missingRequired = requiredDocs.filter(doc => !documents[doc.key])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    const data = Object.fromEntries(service.fields.map(field => [field.key, String(form.get(field.key) || '').trim()]))
    if (access === 'checking') return setError('جاري التحقق من حسابك. انتظر لحظة ثم أعد الإرسال.')
    if (access !== 'verified') {
      sessionStorage.setItem(draftKey(service.key), JSON.stringify(data))
      navigate(onboardingPathForService(service.key))
      return
    }
    if (missingRequired.length)
      return setError(`أرفق المستمسكات المطلوبة أولاً: ${missingRequired.map(doc => doc.label).join('، ')}.`)
    if (service.requiredDocuments.length && !documentConsent)
      return setError('أكّد أن المستمسكات المرفوعة أصلية وصحيحة قبل الإرسال.')
    if (!faceVideo || !faceConsent)
      return setError('التقط فيديو توثيق الوجه القصير ووافق على إرفاقه مع الطلب قبل الإرسال.')
    setBusy(true)
    try {
      const attached: Record<string, File> = {}
      for (const [key, file] of Object.entries(documents)) if (file) attached[key] = file
      const created = await api.createServiceRequest({
        serviceKey: service.key,
        data,
        faceVideo,
        faceConsent,
        documents: attached,
        documentConsent,
      })
      sessionStorage.removeItem(draftKey(service.key))
      setResult(created)
      window.scrollTo({ top: 0 })
    } catch (submitError) {
      setError((submitError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const header = (
    <PageHeader
      crumbs={[{ label: 'دليل الخدمات', href: '/directory' }, { label: service.title }]}
      kicker={
        isInformation
          ? 'خدمة معلوماتية'
          : isAppointmentFlow
            ? 'حجز موعد'
            : service.channel === 'APPOINTMENT_REQUIRED'
              ? 'تقديم إلكتروني ثم حضور'
              : 'استمارة خدمة إلكترونية'
      }
      title={service.title}
      description={service.description}
      meta={
        <>
          <span>
            <Building2 />
            <Link href={`/departments/${service.departmentId}`} className="gov-link">
              {service.departmentName}
            </Link>
          </span>
          {service.estimatedDuration && (
            <span>
              <Clock3 /> {service.estimatedDuration}
            </span>
          )}
          <span>
            <ReceiptText /> {feeText(service)}
          </span>
          <span>
            <Landmark /> {applicantLabel[service.applicantType]}
          </span>
        </>
      }
    >
      {service.sourceQuality === 'UNVERIFIED' && (
        <p className="tq-note is-warning">
          <Info aria-hidden="true" />
          <span>
            بيانات هذه الخدمة مأخوذة من مصادر عامة ولم تؤكدها الدائرة بعد. قد تطلب الدائرة مستمسكاً إضافياً أو تعدّل
            الشروط عند التدقيق.
          </span>
        </p>
      )}
    </PageHeader>
  )

  if (isInformation)
    return (
      <PublicServiceFrame>
        {header}
        <section className="tq-content">
          <div className="tq-container tq-layout">
            <div className="tq-stack">
              <article className="tq-panel">
                <div className="tq-panel-head">
                  <div>
                    <h2>
                      <FileCheck2 /> ما تحتاجه قبل مراجعة الجهة
                    </h2>
                    <p>تُنجز هذه الخدمة لدى الجهة مباشرةً أو عبر موقعها الرسمي. جهّز ما يلي.</p>
                  </div>
                </div>
                {service.requiredDocuments.length ? (
                  <ul className="tq-doc-list">
                    {service.requiredDocuments.map(doc => (
                      <li key={doc.key}>
                        <CheckCircle2 aria-hidden="true" />
                        <span>
                          <strong>{doc.label}</strong>
                          {doc.description && <small>{doc.description}</small>}
                        </span>
                        {!doc.required && <span className="tq-badge">اختياري</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>لا توجد مستمسكات مسجلة لهذه الخدمة؛ راجع الجهة أو رابطها الرسمي.</p>
                )}
                {service.notes && (
                  <p className="tq-note is-info">
                    <Info aria-hidden="true" />
                    <span>{service.notes}</span>
                  </p>
                )}
              </article>
            </div>
            <aside className="tq-stack tq-sticky">
              <article className="tq-panel is-accent">
                <h2>
                  <ShieldCheck /> الروابط الرسمية
                </h2>
                <p className="svc-muted">تأكد أن النطاق المفتوح يعود إلى الجهة الحكومية قبل إدخال بياناتك.</p>
                <div className="svc-handoff">
                  {legacy?.officialLinks?.map((link, index) => (
                    <a
                      className={index === 0 ? 'button primary full' : 'button outline full'}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      key={link.url}
                    >
                      <ExternalLink /> {link.label}
                    </a>
                  ))}
                  {!legacy?.officialLinks?.length && service.sourceUrl && (
                    <a className="button primary full" href={service.sourceUrl} target="_blank" rel="noreferrer">
                      <ExternalLink /> الموقع الرسمي للجهة
                    </a>
                  )}
                  <Link className="button outline full" href={`/departments/${service.departmentId}`}>
                    صفحة الجهة على المنصة <ArrowLeft />
                  </Link>
                </div>
                {legacy?.boundaryNote && legacy.boundaryNote !== service.notes && (
                  <p className="tq-note">
                    <ShieldCheck aria-hidden="true" />
                    <span>{legacy.boundaryNote}</span>
                  </p>
                )}
              </article>
            </aside>
          </div>
        </section>
      </PublicServiceFrame>
    )

  if (result)
    return (
      <PublicServiceFrame>
        <section className="tq-content">
          <div className="tq-container">
            <div className="svc-success">
              <span className="svc-success-icon">
                <CheckCircle2 />
              </span>
              <span className="section-kicker">تم تسجيل الطلب</span>
              <h1>
                {result.payment
                  ? 'سُجّل الطلب — بقي سداد الرسم'
                  : isAppointmentFlow
                    ? 'تم إرسال طلب الموعد'
                    : 'تم إرسال الطلب والمستمسكات إلى الدائرة'}
              </h1>
              <p>{result.currentAction}</p>
              <dl className="svc-success-data">
                <div>
                  <dt>رقم الطلب</dt>
                  <dd dir="ltr">{result.reference}</dd>
                </div>
                <div>
                  <dt>الدائرة</dt>
                  <dd>{result.department}</dd>
                </div>
                {result.appointment && (
                  <>
                    <div>
                      <dt>التاريخ المفضل</dt>
                      <dd>{new Date(`${result.appointment.preferredDate}T00:00:00`).toLocaleDateString('en-GB')}</dd>
                    </div>
                    <div>
                      <dt>الوقت المفضل</dt>
                      <dd>{result.appointment.preferredTime}</dd>
                    </div>
                  </>
                )}
              </dl>
              {result.payment ? (
                <>
                  <p className="svc-muted">
                    يبقى الطلب محجوزاً باسمك ولا يُحال إلى الدائرة إلا بعد سداد الرسم. يصدر إيصال إلكتروني فور الدفع.
                  </p>
                  <div className="tq-page-actions">
                    <Link className="button primary" href={`/citizen/pay/${result.payment.reference}`}>
                      <CreditCard /> سدّد الرسم الآن ({result.payment.amountIqd.toLocaleString('en-US')} د.ع)
                    </Link>
                    <Link className="button outline" href="/citizen#my-requests">
                      الدفع لاحقاً من حسابي
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <p className="svc-muted">
                    ستصلك إشعارات المنصة عند بدء التدقيق أو عند طلب أي استكمال. يمكنك متابعة الطلب ورفع النواقص من
                    حسابك.
                  </p>
                  <div className="tq-page-actions">
                    <Link className="button primary" href="/citizen#my-requests">
                      متابعة الطلب في حسابي <ArrowLeft />
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </PublicServiceFrame>
    )

  const stepDocs = service.requiredDocuments.length > 0
  const steps = [
    isAppointmentFlow ? 'بيانات الموعد' : 'بيانات الطلب',
    ...(stepDocs ? ['المستمسكات'] : []),
    'توثيق الوجه والإرسال',
    'تدقيق الدائرة',
  ]
  const stepNumbers = { data: 1, docs: 2, face: stepDocs ? 3 : 2 }

  return (
    <PublicServiceFrame>
      {header}
      <section className="tq-content">
        <div className="tq-container tq-layout">
          <form className="tq-stack svc-form" onSubmit={submit} noValidate={false}>
            <ol className="svc-stepper" aria-label="خطوات تقديم الخدمة">
              {steps.map((label, index) => (
                <li key={label} className={index === 0 ? 'is-current' : ''}>
                  <b>{index + 1}</b>
                  <span>{label}</span>
                </li>
              ))}
            </ol>

            <ServiceSubmissionNotice access={access} />

            <section className="tq-panel svc-step">
              <header className="svc-step-head">
                <b>{stepNumbers.data}</b>
                <div>
                  <h2>{isAppointmentFlow ? 'بيانات الموعد' : 'بيانات الطلب'}</h2>
                  <p>
                    {service.channel === 'APPOINTMENT_REQUIRED'
                      ? 'تُدقَّق بياناتك ومستمسكاتك إلكترونياً أولاً، ثم تحدد الدائرة موعد حضورك لإكمال الإجراء (توقيع، بصمة، أو استلام).'
                      : 'تُرسل هذه البيانات إلى الدائرة المختصة مباشرةً وتتحقق منها المنصة قبل الإرسال.'}
                  </p>
                </div>
              </header>
              {service.fields.length ? (
                <div className="svc-fields">
                  {service.fields.map(field => (
                    <label className={field.type === 'textarea' ? 'tq-field is-wide' : 'tq-field'} key={field.key}>
                      <span>
                        {field.label}
                        {field.required && (
                          <b className="svc-required" aria-hidden="true">
                            *
                          </b>
                        )}
                      </span>
                      {field.type === 'select' ? (
                        <select name={field.key} required={field.required} defaultValue={draft[field.key] || ''}>
                          <option value="" disabled>
                            اختر
                          </option>
                          {field.options?.map(option => (
                            <option value={option} key={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : field.type === 'textarea' ? (
                        <textarea
                          name={field.key}
                          required={field.required}
                          defaultValue={draft[field.key] || ''}
                          maxLength={field.maxLength}
                          placeholder={field.placeholder}
                          rows={4}
                        />
                      ) : (
                        <input
                          name={field.key}
                          type={field.type === 'number' ? 'text' : field.type}
                          inputMode={field.type === 'number' ? 'numeric' : field.type === 'tel' ? 'tel' : undefined}
                          required={field.required}
                          defaultValue={draft[field.key] || (field.key === 'fullName' ? profile?.fullName || '' : '')}
                          key={`${field.key}-${field.key === 'fullName' ? profile?.fullName || '' : ''}`}
                          maxLength={field.maxLength}
                          placeholder={field.placeholder}
                          min={field.type === 'date' && isAppointmentFlow ? today : undefined}
                          max={field.type === 'date' && isAppointmentFlow ? maxDate : undefined}
                        />
                      )}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="svc-muted">لا تحتاج هذه الخدمة إلى بيانات إضافية؛ تُستخدم بيانات حسابك الموثق.</p>
              )}
            </section>

            {stepDocs && (
              <section className="tq-panel svc-step">
                <header className="svc-step-head">
                  <b>{stepNumbers.docs}</b>
                  <div>
                    <h2>المستمسكات المطلوبة</h2>
                    <p>
                      صوّر كل مستمسك بوضوح أو ارفعه بصيغة PDF. يفحص موظف الدائرة كل مستمسك على حدة ويطلب إعادة رفع أي
                      مستمسك غير واضح.
                    </p>
                  </div>
                </header>
                <div className="svc-doc-slots">
                  {[...requiredDocs, ...optionalDocs].map(doc => (
                    <div className={documents[doc.key] ? 'svc-doc-slot is-ready' : 'svc-doc-slot'} key={doc.key}>
                      <div className="svc-doc-slot-head">
                        <strong>{doc.label}</strong>
                        {doc.required ? (
                          <span className="tq-badge is-danger">مطلوب</span>
                        ) : (
                          <span className="tq-badge">اختياري</span>
                        )}
                      </div>
                      {doc.description && <small className="svc-doc-hint">{doc.description}</small>}
                      {access === 'verified' ? (
                        <SecureCameraCapture
                          title={doc.label}
                          guidance="ضع المستمسك على سطح مستوٍ بإضاءة جيدة بحيث تظهر كل حوافه."
                          mode="photo"
                          facingMode="environment"
                          allowPdf={doc.accepts.includes('pdf')}
                          file={documents[doc.key] || null}
                          onChange={file => setDocuments(current => ({ ...current, [doc.key]: file }))}
                        />
                      ) : (
                        <div className="svc-doc-locked">
                          <Fingerprint aria-hidden="true" />
                          {access === 'identity-required'
                            ? 'يُفعَّل رفع المستمسكات بعد إكمال توثيق حسابك.'
                            : 'يُفعَّل رفع المستمسكات بعد تسجيل الدخول وتوثيق الحساب.'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {access === 'verified' && (
                  <label className="tq-check svc-consent">
                    <input
                      type="checkbox"
                      checked={documentConsent}
                      onChange={event => setDocumentConsent(event.target.checked)}
                    />
                    <span>أُقرّ بأن المستمسكات المرفوعة أصلية وصحيحة وتعود لي أو لمن أمثّله قانونياً.</span>
                  </label>
                )}
              </section>
            )}

            <section className="tq-panel svc-step">
              <header className="svc-step-head">
                <b>{stepNumbers.face}</b>
                <div>
                  <h2>توثيق الوجه والإرسال</h2>
                  <p>يربط فيديو الوجه القصير الطلب بصاحب الحساب الموثق ويمنع التقديم نيابةً عن الغير.</p>
                </div>
              </header>
              <p className="tq-note is-info">
                <CalendarClock aria-hidden="true" />
                <span>
                  {service.channel === 'APPOINTMENT_REQUIRED'
                    ? 'بعد الموافقة على المستمسكات تحدد الدائرة موعد الحضور ويصلك إشعار به داخل حسابك.'
                    : isAppointmentFlow
                      ? 'حجز الموعد يبقى بانتظار تأكيد الموظف ولا يتحول إلى موعد نهائي تلقائياً.'
                      : 'يصلك قرار الدائرة داخل حسابك، وعند الموافقة تُصدر وثيقة إتمام رقمية قابلة للتحقق.'}
                </span>
              </p>
              {access === 'verified' && (
                <div className="svc-face">
                  <SecureCameraCapture
                    title="فيديو توثيق الوجه"
                    guidance="افتح الكاميرا الأمامية، انظر للكاميرا مباشرةً وحرّك رأسك ببطء لليمين واليسار. يُحفظ مشفراً ويظهر للمراجع المخول فقط."
                    mode="video"
                    facingMode="user"
                    cameraOnly
                    file={faceVideo}
                    onChange={setFaceVideo}
                  />
                  <label className="tq-check svc-consent">
                    <input
                      type="checkbox"
                      checked={faceConsent}
                      onChange={event => setFaceConsent(event.target.checked)}
                    />
                    <span>أوافق على إرفاق فيديو الوجه المشفر بهذا الطلب لغرض التدقيق لدى الجهة المخولة.</span>
                  </label>
                </div>
              )}
            </section>

            {error && (
              <div className="form-error" role="alert">
                <AlertTriangle /> {error}
              </div>
            )}
            <div className="svc-submit">
              <button className="button primary" type="submit" disabled={busy || access === 'checking'}>
                <Send />
                {busy
                  ? 'جاري تسجيل الطلب…'
                  : access === 'guest'
                    ? 'سجّل الدخول ووثّق حسابك ثم أرسل'
                    : access === 'identity-required'
                      ? 'أكمل توثيق الحساب ثم أرسل'
                      : isAppointmentFlow
                        ? 'إرسال طلب الموعد'
                        : 'إرسال الطلب إلى الدائرة'}
              </button>
              <small>
                <BadgeCheck aria-hidden="true" /> {channelLabel[service.channel]}
              </small>
            </div>
          </form>
          <ServiceSummary service={service} documents={access === 'verified' ? documents : undefined} showDocuments />
        </div>
      </section>
    </PublicServiceFrame>
  )
}
