import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  Info,
  Landmark,
  ReceiptText,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react'
import { api } from '../../api'
import { getServiceDefinition } from '../../service-forms'
import type { CatalogService } from '../../types'
import { SecureCameraCapture } from '../../components/camera/SecureCameraCapture'
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

function FeeLine({ service }: { service: CatalogService }) {
  if (service.feeStatus === 'OFFICIAL' && service.feeIqd)
    return (
      <span>
        <ReceiptText /> {service.feeIqd.toLocaleString('en-US')} د.ع{' '}
        {service.feeSource && (
          <a href={service.feeSource} target="_blank" rel="noreferrer" className="gov-inline-source">
            (المصدر الرسمي)
          </a>
        )}
      </span>
    )
  if (service.feeStatus === 'NOT_REQUIRED')
    return (
      <span>
        <ReceiptText /> تُحدَّد الرسوم من الدائرة عند التدقيق
      </span>
    )
  return (
    <span>
      <ReceiptText /> الرسوم غير مؤكدة — تُثبَّت من الدائرة
    </span>
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
        <div className="service-loading">
          <RefreshCw className="spin" /> جاري تحميل بيانات الخدمة…
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
    <div className="service-form-header gov-service-header">
      <Link href="/directory">
        <ArrowRight /> الرجوع إلى دليل الخدمات
      </Link>
      <span>
        {isInformation
          ? 'خدمة معلوماتية'
          : isAppointmentFlow
            ? 'حجز موعد'
            : service.channel === 'APPOINTMENT_REQUIRED'
              ? 'تقديم إلكتروني ثم حضور'
              : 'استمارة خدمة إلكترونية'}
      </span>
      <h1>{service.title}</h1>
      <p>{service.description}</p>
      <div>
        <Link href={`/departments/${service.departmentId}`} className="gov-service-department">
          <Building2 /> {service.departmentName}
        </Link>
        {service.estimatedDuration && (
          <span>
            <Clock3 /> {service.estimatedDuration}
          </span>
        )}
        <FeeLine service={service} />
        <span>
          <Landmark /> {applicantLabel[service.applicantType]}
        </span>
      </div>
      {service.sourceQuality === 'UNVERIFIED' && (
        <div className="gov-unverified-note">
          <Info />
          <span>
            بيانات هذه الخدمة مأخوذة من مصادر عامة ولم تؤكدها الدائرة بعد. قد تطلب الدائرة مستمسكاً إضافياً أو تعدّل
            الشروط عند التدقيق.
          </span>
        </div>
      )}
    </div>
  )

  if (isInformation)
    return (
      <PublicServiceFrame>
        {header}
        <section className="gov-info-service">
          <article className="form-card">
            <div className="form-card-title">
              <span>
                <FileCheck2 />
              </span>
              <div>
                <h2>ما تحتاجه قبل مراجعة الجهة</h2>
                <p>هذه الخدمة تُنجز لدى الجهة المالكة مباشرة أو عبر موقعها الرسمي. جهّز ما يلي.</p>
              </div>
            </div>
            {service.requiredDocuments.length ? (
              <ul className="gov-doc-list">
                {service.requiredDocuments.map(doc => (
                  <li key={doc.key}>
                    <CheckCircle2 />
                    <span>
                      <strong>{doc.label}</strong>
                      {doc.description && <small>{doc.description}</small>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="gov-muted">لا توجد مستمسكات مسجلة لهذه الخدمة؛ راجع الجهة أو رابطها الرسمي.</p>
            )}
            {service.notes && (
              <div className="service-policy-note">
                <Info />
                <span>{service.notes}</span>
              </div>
            )}
          </article>
          <aside className="form-card">
            <div className="form-card-title">
              <span>
                <ShieldCheck />
              </span>
              <div>
                <h2>الروابط الرسمية</h2>
                <p>تأكد أن النطاق المفتوح يعود إلى الجهة الحكومية قبل إدخال بياناتك.</p>
              </div>
            </div>
            <div className="official-handoff-links">
              {legacy?.officialLinks?.map((link, index) => (
                <a
                  className={index === 0 ? 'button primary' : 'button outline'}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  key={link.url}
                >
                  {link.label} <ExternalLink />
                </a>
              ))}
              {!legacy?.officialLinks?.length && service.sourceUrl && (
                <a className="button primary" href={service.sourceUrl} target="_blank" rel="noreferrer">
                  الموقع الرسمي للجهة <ExternalLink />
                </a>
              )}
              <Link className="button outline" href={`/departments/${service.departmentId}`}>
                صفحة الجهة على المنصة <ArrowLeft />
              </Link>
            </div>
            {legacy?.boundaryNote && legacy.boundaryNote !== service.notes && (
              <div className="handoff-security">
                <ShieldCheck />
                <span>{legacy.boundaryNote}</span>
              </div>
            )}
          </aside>
        </section>
      </PublicServiceFrame>
    )

  if (result)
    return (
      <PublicServiceFrame>
        <section className="service-success">
          <span>
            <CheckCircle2 />
          </span>
          <div className="section-kicker">تم تسجيل الطلب</div>
          <h1>{isAppointmentFlow ? 'تم إرسال طلب الموعد' : 'تم إرسال الطلب والمستمسكات إلى الدائرة'}</h1>
          <p>{result.currentAction}</p>
          <div className="service-success-data">
            <span>
              <small>رقم الطلب</small>
              <strong>{result.reference}</strong>
            </span>
            <span>
              <small>الدائرة</small>
              <strong>{result.department}</strong>
            </span>
            {result.appointment && (
              <>
                <span>
                  <small>التاريخ المفضل</small>
                  <strong>
                    {new Date(`${result.appointment.preferredDate}T00:00:00`).toLocaleDateString('en-GB')}
                  </strong>
                </span>
                <span>
                  <small>الوقت المفضل</small>
                  <strong>{result.appointment.preferredTime}</strong>
                </span>
              </>
            )}
          </div>
          <p className="gov-muted">
            ستصلك إشعارات المنصة عند بدء التدقيق أو عند طلب أي استكمال. يمكنك متابعة الطلب ورفع النواقص من حساب المواطن.
          </p>
          <Link className="button primary" href="/citizen#my-requests">
            متابعة الطلب في حساب المواطن <ArrowLeft />
          </Link>
        </section>
      </PublicServiceFrame>
    )

  const stepDocs = service.requiredDocuments.length > 0
  const stepNumbers = { data: 1, docs: 2, face: stepDocs ? 3 : 2 }

  return (
    <PublicServiceFrame>
      {header}
      <form className="dynamic-service-form" onSubmit={submit}>
        <nav className="service-form-progress" aria-label="خطوات تقديم الخدمة">
          <span className="active">
            <b>01</b>
            <small>بيانات الطلب</small>
          </span>
          {stepDocs && (
            <span>
              <b>02</b>
              <small>المستمسكات</small>
            </span>
          )}
          <span>
            <b>{stepDocs ? '03' : '02'}</b>
            <small>توثيق الوجه والإرسال</small>
          </span>
          <span>
            <b>{stepDocs ? '04' : '03'}</b>
            <small>تدقيق الدائرة</small>
          </span>
        </nav>

        <section className="form-card">
          <div className="form-card-title">
            <span>{stepNumbers.data}</span>
            <div>
              <h2>{isAppointmentFlow ? 'بيانات الموعد' : 'بيانات الطلب'}</h2>
              <p>
                {service.channel === 'APPOINTMENT_REQUIRED'
                  ? 'تُدقَّق بياناتك ومستمسكاتك إلكترونياً أولاً، ثم تحدد الدائرة موعد حضورك لإكمال الإجراء (توقيع، بصمة، أو استلام).'
                  : 'تُرسل هذه البيانات إلى الدائرة المختصة مباشرةً وتتحقق منها المنصة قبل الإرسال.'}
              </p>
            </div>
          </div>
          <ServiceSubmissionNotice access={access} />
          {service.fields.length ? (
            <div className="form-grid dynamic-fields">
              {service.fields.map(field => (
                <label className={field.type === 'textarea' ? 'wide' : ''} key={field.key}>
                  {field.label}
                  {field.required && <b aria-hidden="true"> *</b>}
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
            <p className="gov-muted">لا تحتاج هذه الخدمة إلى بيانات إضافية؛ تُستخدم بيانات حسابك الموثق.</p>
          )}
        </section>

        {stepDocs && (
          <section className="form-card">
            <div className="form-card-title">
              <span>{stepNumbers.docs}</span>
              <div>
                <h2>المستمسكات المطلوبة</h2>
                <p>
                  صوّر كل مستمسك بوضوح أو ارفعه بصيغة PDF. يفحص موظف الدائرة كل مستمسك على حدة ويطلب إعادة رفع أي مستمسك
                  غير واضح.
                </p>
              </div>
            </div>
            <div className="gov-doc-slots">
              {[...requiredDocs, ...optionalDocs].map(doc => (
                <div className={documents[doc.key] ? 'gov-doc-slot is-ready' : 'gov-doc-slot'} key={doc.key}>
                  <div className="gov-doc-slot-head">
                    <strong>
                      {doc.label} {doc.required ? <b aria-hidden="true">*</b> : <em>اختياري</em>}
                    </strong>
                    {doc.description && <small>{doc.description}</small>}
                  </div>
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
                    <div className="gov-doc-slot-locked">
                      <Fingerprint />{' '}
                      {access === 'identity-required'
                        ? 'يُفعَّل رفع المستمسكات بعد إكمال توثيق حسابك.'
                        : 'يُفعَّل رفع المستمسكات بعد تسجيل الدخول وتوثيق الحساب.'}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {access === 'verified' && (
              <label className="consent-box">
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

        <section className="form-card requirements-card">
          <div className="form-card-title">
            <span>{stepNumbers.face}</span>
            <div>
              <h2>توثيق الوجه والإرسال</h2>
              <p>يربط فيديو الوجه القصير الطلب بصاحب الحساب الموثق ويمنع التقديم نيابةً عن الغير.</p>
            </div>
          </div>
          <div className="service-policy-note">
            <CalendarClock />
            <span>
              {service.channel === 'APPOINTMENT_REQUIRED'
                ? 'بعد الموافقة على المستمسكات تحدد الدائرة موعد الحضور ويصلك إشعار به داخل حسابك.'
                : isAppointmentFlow
                  ? 'حجز الموعد يبقى بانتظار تأكيد الموظف ولا يتحول إلى موعد نهائي تلقائياً.'
                  : 'يصلك قرار الدائرة داخل حسابك، وعند الموافقة تُصدر وثيقة إتمام رقمية قابلة للتحقق.'}
            </span>
          </div>
          {access === 'verified' && (
            <div className="service-face-confirmation">
              <div>
                <Fingerprint />
                <strong>توثيق الوجه لهذا الطلب</strong>
                <p>سجّل فيديو قصيراً بالكاميرا الأمامية. يُحفظ مشفراً ضمن مرفقات الطلب ويظهر للمراجع المخول فقط.</p>
              </div>
              <SecureCameraCapture
                title="فيديو توثيق الوجه"
                guidance="افتح الكاميرا الأمامية، انظر للكاميرا مباشرةً وحرّك رأسك ببطء لليمين واليسار."
                mode="video"
                facingMode="user"
                cameraOnly
                file={faceVideo}
                onChange={setFaceVideo}
              />
              <label className="consent-box">
                <input type="checkbox" checked={faceConsent} onChange={event => setFaceConsent(event.target.checked)} />
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
        <div className="dynamic-form-submit">
          <button className="button primary" type="submit" disabled={busy || access === 'checking'}>
            {busy
              ? 'جاري تسجيل الطلب...'
              : access === 'guest'
                ? 'تسجيل الدخول وتوثيق الحساب ثم الإرسال'
                : access === 'identity-required'
                  ? 'إكمال توثيق الحساب ثم الإرسال'
                  : isAppointmentFlow
                    ? 'إرسال طلب الموعد'
                    : 'إرسال الطلب إلى الدائرة'}{' '}
            <Send />
          </button>
          <small className="gov-muted">
            <BadgeCheck /> {channelLabel[service.channel]}
            {service.sourceUrl && (
              <>
                {' '}
                ·{' '}
                <a href={service.sourceUrl} target="_blank" rel="noreferrer">
                  المصدر الرسمي
                </a>
              </>
            )}
          </small>
        </div>
      </form>
    </PublicServiceFrame>
  )
}
