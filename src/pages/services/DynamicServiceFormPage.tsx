import type React from 'react'
import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Fingerprint,
  Landmark,
  ReceiptText,
  Send,
  ShieldCheck,
} from 'lucide-react'
import { api } from '../../api'
import { getServiceDefinition } from '../../service-forms'
import { SecureCameraCapture } from '../../components/camera/SecureCameraCapture'
import { NotFound } from '../NotFound'
import { ServiceRequirements } from './ServiceRequirements'
import {
  onboardingPathForService,
  useCitizenSubmissionAccess,
  ServiceSubmissionNotice,
  PublicServiceFrame,
} from './submission-access'

export function DynamicServiceFormPage({ serviceKey }: { serviceKey: string }) {
  const definition = getServiceDefinition(serviceKey)
  const [, navigate] = useLocation()
  const access = useCitizenSubmissionAccess()
  const [draft] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(`dhiqar-service-draft:${serviceKey}`) || '{}') as Record<string, string>
    } catch {
      return {}
    }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [faceVideo, setFaceVideo] = useState<File | null>(null)
  const [faceConsent, setFaceConsent] = useState(false)
  const [result, setResult] = useState<{
    reference: string
    currentAction: string
    department: string
    appointment: { preferredDate: string; preferredTime: string; status: string } | null
  } | null>(null)
  if (!definition) return <NotFound />
  if (definition.mode === 'EXTERNAL')
    return (
      <PublicServiceFrame>
        <section className="national-service-page">
          <header>
            <Link href="/">
              <ArrowRight /> الرجوع للرئيسية
            </Link>
            <span className="national-service-seal">
              <Landmark />
            </span>
            <div className="section-kicker">OFFICIAL NATIONAL SERVICE</div>
            <h1>{definition.title}</h1>
            <p>{definition.description}</p>
            <div className="national-service-meta">
              <span>
                <Building2 /> {definition.department}
              </span>
              <span>
                <Clock3 /> {definition.estimatedTime}
              </span>
              <span>
                <ReceiptText /> {definition.feeNote}
              </span>
            </div>
          </header>
          <div className="national-service-grid">
            <article>
              <h2>قبل الانتقال إلى الخدمة</h2>
              <p>جهّز الوثائق التالية واتبع تعليمات الجهة المالكة داخل موقعها أو تطبيقها الرسمي.</p>
              <ul>
                {definition.requirements.map(item => (
                  <li key={item}>
                    <CheckCircle2 /> {item}
                  </li>
                ))}
              </ul>
            </article>
            <aside>
              <h2>الروابط الرسمية</h2>
              <div className="official-handoff-links">
                {definition.officialLinks?.map((link, index) => (
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
              </div>
              <div className="handoff-security">
                <ShieldCheck />
                <span>{definition.boundaryNote}</span>
              </div>
            </aside>
          </div>
          <footer>
            <BadgeCheck />
            <span>تأكد أن النطاق المفتوح يعود إلى بوابة أور أو وزارة الداخلية قبل إدخال بياناتك.</span>
          </footer>
        </section>
      </PublicServiceFrame>
    )
  const today = new Date().toISOString().slice(0, 10)
  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + 90)
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    const data = Object.fromEntries(
      definition.fields.map(field => [field.key, String(form.get(field.key) || '').trim()])
    )
    if (access === 'checking') return setError('جاري التحقق من حسابك. انتظر لحظة ثم أعد الإرسال.')
    if (access !== 'verified') {
      sessionStorage.setItem(`dhiqar-service-draft:${definition.key}`, JSON.stringify(data))
      navigate(onboardingPathForService(definition.key))
      return
    }
    if (!faceVideo || !faceConsent)
      return setError('التقط فيديو توثيق الوجه القصير ووافق على إرفاقه مع الطلب قبل الإرسال.')
    setBusy(true)
    try {
      const created = await api.createServiceRequestWithFace(definition.key, data, faceVideo, faceConsent)
      sessionStorage.removeItem(`dhiqar-service-draft:${definition.key}`)
      setResult(created)
    } catch (submitError) {
      setError((submitError as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (result)
    return (
      <PublicServiceFrame>
        <section className="service-success">
          <span>
            <CheckCircle2 />
          </span>
          <div className="section-kicker">تم تسجيل الطلب</div>
          <h1>{definition.mode === 'APPOINTMENT' ? 'تم إرسال طلب الموعد' : 'تم تسجيل طلب الخدمة'}</h1>
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
          <Link className="button primary" href="/citizen">
            العودة إلى حساب المواطن <ArrowLeft />
          </Link>
        </section>
      </PublicServiceFrame>
    )
  return (
    <PublicServiceFrame>
      <div className="service-form-header">
        <Link href="/">
          <ArrowRight /> الرجوع للرئيسية
        </Link>
        <span>{definition.mode === 'APPOINTMENT' ? 'حجز موعد' : 'استمارة خدمة'}</span>
        <h1>{definition.title}</h1>
        <p>{definition.description}</p>
        <div>
          <span>
            <Building2 /> {definition.department}
          </span>
          <span>
            <Clock3 /> {definition.estimatedTime}
          </span>
          <span>
            <ReceiptText /> {definition.feeNote}
          </span>
        </div>
      </div>
      <form className="dynamic-service-form" onSubmit={submit}>
        <nav className="service-form-progress" aria-label="خطوات تقديم الخدمة">
          <span className="active">
            <b>01</b>
            <small>التعبئة العامة</small>
          </span>
          <span>
            <b>02</b>
            <small>تفاصيل الخدمة</small>
          </span>
          <span>
            <b>03</b>
            <small>تأكيد الإرسال</small>
          </span>
        </nav>
        <section className="form-card">
          <div className="form-card-title">
            <span>1</span>
            <div>
              <h2>الحساب وتوثيق الوجه</h2>
              <p>يمكنك مراجعة الاستمارة وتعبئتها الآن. يطلب التسجيل وتوثيق الوجه فقط عند إرسال طلبك.</p>
            </div>
          </div>
          <ServiceSubmissionNotice access={access} />
        </section>
        <section className="form-card">
          <div className="form-card-title">
            <span>2</span>
            <div>
              <h2>بيانات {definition.mode === 'APPOINTMENT' ? 'الموعد' : 'الخدمة'}</h2>
              <p>الحقول أدناه خاصة بهذه الخدمة وتتحقق منها المنصة قبل الإرسال.</p>
            </div>
          </div>
          <div className="form-grid dynamic-fields">
            {definition.fields.map(field => (
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
                    type={field.type}
                    required={field.required}
                    defaultValue={draft[field.key] || ''}
                    maxLength={field.maxLength}
                    placeholder={field.placeholder}
                    min={field.type === 'date' ? today : undefined}
                    max={field.type === 'date' ? maxDate.toISOString().slice(0, 10) : undefined}
                  />
                )}
              </label>
            ))}
          </div>
        </section>
        <section className="form-card requirements-card">
          <div className="form-card-title">
            <span>3</span>
            <div>
              <h2>المتطلبات ومسار الطلب</h2>
              <p>تظهر المتطلبات المعروفة فقط، وقد تطلب الدائرة مستنداً إضافياً بعد التدقيق.</p>
            </div>
          </div>
          <ServiceRequirements serviceKey={definition.key} fallback={definition.requirements} />
          <div className="service-policy-note">
            <ShieldCheck />
            <span>
              إرسال الاستمارة يسجل الطلب داخل المنصة ويرسله إلى قائمة الدائرة. حجز الموعد يبقى بانتظار تأكيد الموظف ولا
              يتحول إلى موعد نهائي تلقائياً.
            </span>
          </div>
          {access === 'verified' && (
            <div className="service-face-confirmation">
              <div>
                <Fingerprint />
                <strong>توثيق الوجه لهذا الطلب</strong>
                <p>سجّل فيديو قصيراً بالكاميرا الأمامية. يحفظ مشفراً ضمن مرفقات الطلب ويظهر للمراجع المخول فقط.</p>
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
          <div className="form-error">
            <AlertTriangle /> {error}
          </div>
        )}
        <div className="dynamic-form-submit">
          <button className="button primary" type="submit" disabled={busy || access === 'checking'}>
            {busy
              ? 'جاري تسجيل الطلب...'
              : access === 'guest'
                ? 'تسجيل الدخول وتوثيق الوجه ثم الإرسال'
                : access === 'identity-required'
                  ? 'إكمال توثيق الوجه ثم الإرسال'
                  : definition.mode === 'APPOINTMENT'
                    ? 'إرسال طلب الموعد'
                    : 'إرسال طلب الخدمة'}{' '}
            <Send />
          </button>
        </div>
      </form>
    </PublicServiceFrame>
  )
}
