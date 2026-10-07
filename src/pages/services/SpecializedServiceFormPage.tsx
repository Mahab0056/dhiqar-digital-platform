import type React from 'react'
import { useState } from 'react'
import { useLocation } from 'wouter'
import { AlertTriangle, Building2, Clock3, ReceiptText, Send, ShieldCheck } from 'lucide-react'
import { api } from '../../api'
import { formatIQD, services } from '../../data'
import { LocationPicker, type PickedLocation } from '../../components/maps/LocationPicker'
import { SecureCameraCapture } from '../../components/camera/SecureCameraCapture'
import { PageHeader } from '../../components/public/PageHeader'
import {
  onboardingPathForService,
  useCitizenSubmissionAccess,
  ServiceSubmissionNotice,
  PublicServiceFrame,
} from './submission-access'

export function SpecializedServiceFormPage({ serviceKey }: { serviceKey: string }) {
  const [, navigate] = useLocation()
  const service = services.find(item => item.key === serviceKey) || services[0]
  const access = useCitizenSubmissionAccess()
  const [draft] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(`dhiqar-service-draft:${serviceKey}`) || '{}') as Record<string, string>
    } catch {
      return {}
    }
  })
  const [ownership, setOwnership] = useState(draft.ownershipType === 'owned' ? 'owned' : 'rent')
  const [location, setLocation] = useState<PickedLocation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [propertyDocument, setPropertyDocument] = useState<File | null>(null)
  const [storefrontPhoto, setStorefrontPhoto] = useState<File | null>(null)
  const [faceVideo, setFaceVideo] = useState<File | null>(null)
  const [faceConsent, setFaceConsent] = useState(false)
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    const data = {
      businessName: String(form.get('businessName') || '').trim(),
      activityType: String(form.get('activityType') || '').trim(),
      address: String(form.get('address') || '').trim(),
      district: String(form.get('district') || '').trim(),
      ownershipType: ownership,
    }
    if (access === 'checking') return setError('جاري التحقق من حسابك. انتظر لحظة ثم أعد الإرسال.')
    if (access !== 'verified') {
      sessionStorage.setItem(`dhiqar-service-draft:${service.key}`, JSON.stringify(data))
      navigate(onboardingPathForService(service.key))
      return
    }
    if (!faceVideo || !faceConsent)
      return setError('التقط فيديو توثيق الوجه القصير ووافق على إرفاقه مع الطلب قبل الإرسال.')
    if (!location) return setError('حدد موقع المحل على الخريطة أو اكتب العنوان واختره من النتائج.')
    if (service.key === 'store-license' && (!propertyDocument || !storefrontPhoto))
      return setError(`صوّر أو ارفع ${ownership === 'rent' ? 'عقد الإيجار' : 'سند الملكية'} وصورة واجهة المحل أولاً.`)
    setBusy(true)
    try {
      const app = await api.createApplicationWithFiles({
        serviceKey: service.key,
        serviceName: service.title,
        department: service.department,
        ...data,
        coordinates: { lat: location.lat, lng: location.lng },
        fee: service.fee,
        propertyDocument,
        storefrontPhoto,
        faceVideo,
        faceConsent,
      })
      sessionStorage.removeItem(`dhiqar-service-draft:${service.key}`)
      navigate(`/citizen/application/${app.reference}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const steps = ['الحساب', 'بيانات المحل', 'الموقع', 'المستمسكات', 'توثيق الوجه']
  return (
    <PublicServiceFrame>
      <PageHeader
        crumbs={[{ label: 'دليل الخدمات', href: '/directory' }, { label: service.title }]}
        kicker="خدمة رقمية متكاملة"
        title={service.title}
        description={service.description}
        meta={
          <>
            <span>
              <Building2 /> {service.department}
            </span>
            <span>
              <Clock3 /> {service.estimatedTime}
            </span>
            <span>
              <ReceiptText /> {service.fee ? formatIQD(service.fee) : 'يحدده التدقيق'}
            </span>
          </>
        }
      />
      <section className="tq-content">
        <form className="tq-container tq-layout" onSubmit={submit}>
          <div className="tq-stack svc-form">
            <ol className="svc-stepper" aria-label="خطوات تقديم الخدمة">
              {steps.map((label, index) => (
                <li key={label} className={index === 0 ? 'is-current' : ''}>
                  <b>{index + 1}</b>
                  <span>{label}</span>
                </li>
              ))}
            </ol>

            <section className="tq-panel svc-step">
              <header className="svc-step-head">
                <b>1</b>
                <div>
                  <h2>الحساب وتوثيق الهوية</h2>
                  <p>
                    يمكنك الاطلاع على المتطلبات وتعبئة بيانات النشاط الآن؛ يُطلب الدخول وتوثيق الوجه عند إرسال المعاملة
                    فقط.
                  </p>
                </div>
              </header>
              <ServiceSubmissionNotice access={access} />
            </section>

            <section className="tq-panel svc-step">
              <header className="svc-step-head">
                <b>2</b>
                <div>
                  <h2>بيانات المحل</h2>
                  <p>أدخل بيانات المحل والنشاط كما ستظهر في الإجازة.</p>
                </div>
              </header>
              <div className="svc-fields">
                <label className="tq-field">
                  <span>
                    نوع النشاط<b className="svc-required">*</b>
                  </span>
                  <select name="activityType" required defaultValue={draft.activityType || ''}>
                    <option value="" disabled>
                      اختر نوع النشاط
                    </option>
                    <option>متجر إلكترونيات</option>
                    <option>مطعم</option>
                    <option>مكتب خدمات</option>
                    <option>ورشة</option>
                  </select>
                </label>
                <label className="tq-field">
                  <span>
                    اسم المحل<b className="svc-required">*</b>
                  </span>
                  <input name="businessName" defaultValue={draft.businessName || ''} required />
                </label>
                <label className="tq-field is-wide">
                  <span>
                    العنوان التفصيلي<b className="svc-required">*</b>
                  </span>
                  <input
                    name="address"
                    defaultValue={draft.address || ''}
                    required
                    placeholder="المحلة، الزقاق، أقرب معلم"
                  />
                </label>
                <label className="tq-field">
                  <span>
                    القضاء<b className="svc-required">*</b>
                  </span>
                  <select name="district" required defaultValue={draft.district || ''}>
                    <option value="" disabled>
                      اختر القضاء
                    </option>
                    <option>الناصرية</option>
                    <option>الشطرة</option>
                    <option>سوق الشيوخ</option>
                    <option>الرفاعي</option>
                  </select>
                </label>
                <div className="tq-field">
                  <span id="ownership-label">صفة إشغال العقار</span>
                  <div className="tq-segmented" role="radiogroup" aria-labelledby="ownership-label">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={ownership === 'rent'}
                      className={ownership === 'rent' ? 'is-active' : ''}
                      onClick={() => setOwnership('rent')}
                    >
                      إيجار
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={ownership === 'owned'}
                      className={ownership === 'owned' ? 'is-active' : ''}
                      onClick={() => setOwnership('owned')}
                    >
                      ملك
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="tq-panel svc-step">
              <header className="svc-step-head">
                <b>3</b>
                <div>
                  <h2>موقع المحل</h2>
                  <p>
                    حدده على الخريطة، أو اضغط «موقعي الحالي»، أو اكتب العنوان واختره — يوجَّه فريق الكشف إليه مباشرة.
                  </p>
                </div>
              </header>
              <LocationPicker value={location} onChange={setLocation} height={340} />
            </section>

            <section className="tq-panel svc-step">
              <header className="svc-step-head">
                <b>4</b>
                <div>
                  <h2>المستمسكات</h2>
                  <p>تتغير المتطلبات تلقائياً بحسب صفة الإشغال ونوع النشاط.</p>
                </div>
              </header>
              <div className="svc-doc-slots">
                <div className={propertyDocument ? 'svc-doc-slot is-ready' : 'svc-doc-slot'}>
                  <div className="svc-doc-slot-head">
                    <strong>{ownership === 'rent' ? 'عقد الإيجار' : 'سند الملكية'}</strong>
                    <span className="tq-badge is-danger">مطلوب</span>
                  </div>
                  <SecureCameraCapture
                    title={ownership === 'rent' ? 'عقد الإيجار' : 'سند الملكية'}
                    guidance="صوّر المستمسك كاملاً بالكاميرا أو ارفع صورة أو ملف PDF واضحاً."
                    mode="photo"
                    facingMode="environment"
                    allowPdf
                    file={propertyDocument}
                    onChange={setPropertyDocument}
                  />
                </div>
                <div className={storefrontPhoto ? 'svc-doc-slot is-ready' : 'svc-doc-slot'}>
                  <div className="svc-doc-slot-head">
                    <strong>صورة واجهة المحل</strong>
                    <span className="tq-badge is-danger">مطلوب</span>
                  </div>
                  <SecureCameraCapture
                    title="صورة واجهة المحل"
                    guidance="التقط صورة حديثة يظهر فيها مدخل المحل واللافتة إن وجدت."
                    mode="photo"
                    facingMode="environment"
                    file={storefrontPhoto}
                    onChange={setStorefrontPhoto}
                  />
                </div>
              </div>
            </section>

            {access === 'verified' && (
              <section className="tq-panel svc-step">
                <header className="svc-step-head">
                  <b>5</b>
                  <div>
                    <h2>توثيق الوجه لهذا الطلب</h2>
                    <p>
                      سجّل فيديو قصيراً بالكاميرا الأمامية. يُحفظ مشفراً ضمن مرفقات المعاملة ويظهر للمراجع المخول فقط.
                    </p>
                  </div>
                </header>
                <div className="svc-face">
                  <SecureCameraCapture
                    title="فيديو توثيق الوجه"
                    guidance="افتح الكاميرا الأمامية، انظر للكاميرا مباشرةً وحرّك رأسك ببطء لليمين واليسار."
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
                    <span>أوافق على إرفاق فيديو الوجه المشفر بهذه المعاملة لغرض التدقيق لدى الجهة المخولة.</span>
                  </label>
                </div>
              </section>
            )}
          </div>
          <aside className="tq-stack tq-sticky svc-summary" aria-label="ملخص الطلب">
            <article className="tq-panel">
              <h2>
                <ReceiptText /> ملخص الطلب
              </h2>
              <dl className="tq-dl">
                <div>
                  <dt>الخدمة</dt>
                  <dd>{service.title}</dd>
                </div>
                <div>
                  <dt>الجهة</dt>
                  <dd>{service.department}</dd>
                </div>
                <div>
                  <dt>مدة الإنجاز</dt>
                  <dd>{service.estimatedTime}</dd>
                </div>
                <div>
                  <dt>الرسم</dt>
                  <dd>{service.fee ? formatIQD(service.fee) : 'يحدده التدقيق'}</dd>
                </div>
              </dl>
              <p className="tq-note">
                <ShieldCheck aria-hidden="true" />
                <span>
                  تُحفظ مرفقات الطلب مشفّرة وتُحال إلى الدائرة المختصة. إن حددت الدائرة رسماً بعد التدقيق يُسدد
                  إلكترونياً أو في الدائرة قبل إصدار الوثيقة.
                </span>
              </p>
              <button
                className="button primary full svc-aside-submit"
                type="submit"
                disabled={busy || access === 'checking'}
              >
                <Send />
                {busy
                  ? 'جاري الإرسال…'
                  : access === 'guest'
                    ? 'سجّل الدخول ووثّق حسابك ثم أرسل'
                    : access === 'identity-required'
                      ? 'أكمل توثيق الوجه ثم أرسل'
                      : 'إرسال المعاملة'}
              </button>
              {error && (
                <div className="form-error" role="alert">
                  <AlertTriangle /> {error}
                </div>
              )}
            </article>
          </aside>
        </form>
      </section>
    </PublicServiceFrame>
  )
}
