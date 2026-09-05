import type React from 'react'
import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock3,
  MapPin,
  ReceiptText,
  Send,
  ShieldCheck,
} from 'lucide-react'
import { api } from '../../api'
import { formatIQD, services } from '../../data'
import { SecureCameraCapture } from '../../components/camera/SecureCameraCapture'
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
  const [coords, setCoords] = useState({ lat: 31.045, lng: 46.258 })
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
    if (service.key === 'store-license' && (!propertyDocument || !storefrontPhoto))
      return setError(`صوّر أو ارفع ${ownership === 'rent' ? 'عقد الإيجار' : 'سند الملكية'} وصورة واجهة المحل أولاً.`)
    setBusy(true)
    try {
      const app = await api.createApplicationWithFiles({
        serviceKey: service.key,
        serviceName: service.title,
        department: service.department,
        ...data,
        coordinates: coords,
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
  return (
    <PublicServiceFrame>
      <div className="service-form-header">
        <Link href="/">
          <ArrowRight /> الرجوع للرئيسية
        </Link>
        <span>خدمة رقمية</span>
        <h1>{service.title}</h1>
        <p>{service.description}</p>
        <div>
          <span>
            <Building2 /> {service.department}
          </span>
          <span>
            <Clock3 /> {service.estimatedTime}
          </span>
          <span>
            <ReceiptText /> {service.fee ? formatIQD(service.fee) : 'مجانية'}
          </span>
        </div>
      </div>
      <form className="service-form-layout" onSubmit={submit}>
        <div className="service-form-main">
          <section className="form-card">
            <div className="form-card-title">
              <span>1</span>
              <div>
                <h2>الحساب وتوثيق الوجه</h2>
                <p>
                  يمكنك الاطلاع على المتطلبات وتعبئة بيانات النشاط الآن؛ يُطلب الدخول وتوثيق الوجه عند إرسال المعاملة
                  فقط.
                </p>
              </div>
            </div>
            <ServiceSubmissionNotice access={access} />
          </section>
          <section className="form-card">
            <div className="form-card-title">
              <span>2</span>
              <div>
                <h2>بيانات المحل</h2>
                <p>أدخل المعلومات التشغيلية للخدمة.</p>
              </div>
            </div>
            <div className="form-grid">
              <label>
                نوع النشاط
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
              <label>
                اسم المحل
                <input name="businessName" defaultValue={draft.businessName || ''} required />
              </label>
              <label className="wide">
                العنوان التفصيلي
                <input name="address" defaultValue={draft.address || ''} required />
              </label>
              <label>
                القضاء
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
              <div className="ownership-field">
                <span>صفة إشغال العقار</span>
                <div>
                  <button
                    type="button"
                    className={ownership === 'rent' ? 'active' : ''}
                    onClick={() => setOwnership('rent')}
                  >
                    إيجار
                  </button>
                  <button
                    type="button"
                    className={ownership === 'owned' ? 'active' : ''}
                    onClick={() => setOwnership('owned')}
                  >
                    ملك
                  </button>
                </div>
              </div>
            </div>
          </section>
          <section className="form-card">
            <div className="form-card-title">
              <span>3</span>
              <div>
                <h2>موقع المحل</h2>
                <p>حدده على الخريطة لتوجيه الكشف إلى الفريق الصحيح.</p>
              </div>
            </div>
            <div
              className="location-picker"
              onClick={event => {
                const rect = event.currentTarget.getBoundingClientRect()
                setCoords({
                  lat: 31.02 + (1 - (event.clientY - rect.top) / rect.height) * 0.06,
                  lng: 46.22 + ((event.clientX - rect.left) / rect.width) * 0.08,
                })
              }}
            >
              <div className="map-grid-lines" />
              <span className="map-river" />
              <div
                className="map-pin-selected"
                style={{
                  left: `${((coords.lng - 46.22) / 0.08) * 100}%`,
                  top: `${(1 - (coords.lat - 31.02) / 0.06) * 100}%`,
                }}
              >
                <MapPin />
              </div>
              <span className="map-label l1">مركز الناصرية</span>
              <span className="map-label l2">نهر الفرات</span>
            </div>
            <div className="coordinate-row">
              <span>خط العرض: {coords.lat.toFixed(5)}</span>
              <span>خط الطول: {coords.lng.toFixed(5)}</span>
              <span>
                <CheckCircle2 /> تم تحديد الموقع
              </span>
            </div>
          </section>
          <section className="form-card">
            <div className="form-card-title">
              <span>4</span>
              <div>
                <h2>المستندات</h2>
                <p>تتغير المتطلبات تلقائياً بحسب صفة الإشغال ونوع النشاط.</p>
              </div>
            </div>
            <div className="service-document-captures">
              <SecureCameraCapture
                title={ownership === 'rent' ? 'عقد الإيجار' : 'سند الملكية'}
                guidance="صوّر المستند كاملاً من الكاميرا أو ارفع صورة / PDF واضحاً."
                mode="photo"
                facingMode="environment"
                allowPdf
                file={propertyDocument}
                onChange={setPropertyDocument}
              />
              <SecureCameraCapture
                title="صورة واجهة المحل"
                guidance="التقط صورة حديثة من كاميرا الهاتف يظهر فيها مدخل المحل واللافتة إن وجدت."
                mode="photo"
                facingMode="environment"
                file={storefrontPhoto}
                onChange={setStorefrontPhoto}
              />
            </div>
          </section>
          {access === 'verified' && (
            <section className="form-card service-face-confirmation">
              <div className="form-card-title">
                <span>5</span>
                <div>
                  <h2>توثيق الوجه لهذا الطلب</h2>
                  <p>سجل فيديو قصيراً بالكاميرا الأمامية. يحفظ مشفراً ضمن مرفقات المعاملة ويظهر للمراجع المخول فقط.</p>
                </div>
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
                <span>أوافق على إرفاق فيديو الوجه المشفر بهذه المعاملة لغرض التدقيق لدى الجهة المخولة.</span>
              </label>
            </section>
          )}
        </div>
        <aside className="service-form-aside">
          <div className="form-summary">
            <h3>ملخص الطلب</h3>
            <div>
              <span>الخدمة</span>
              <strong>{service.title}</strong>
            </div>
            <div>
              <span>الجهة</span>
              <strong>{service.department}</strong>
            </div>
            <div>
              <span>مدة الإنجاز</span>
              <strong>{service.estimatedTime}</strong>
            </div>
            <div>
              <span>الرسم</span>
              <strong>{service.fee ? formatIQD(service.fee) : 'مجانية'}</strong>
            </div>
            <hr />
            <p>
              <ShieldCheck /> تُحفظ مرفقات الطلب مشفرة وتُوجّه للدائرة المختصة. تبقى عملية الدفع معلقة إلى حين تهيئة
              بوابة دفع معتمدة.
            </p>
            <button className="button primary full" type="submit" disabled={busy || access === 'checking'}>
              {busy
                ? 'جاري الإرسال...'
                : access === 'guest'
                  ? 'تسجيل الدخول وتوثيق الوجه ثم الإرسال'
                  : access === 'identity-required'
                    ? 'إكمال توثيق الوجه ثم الإرسال'
                    : 'إرسال المعاملة'}{' '}
              <Send />
            </button>
            {error && (
              <div className="form-error">
                <AlertTriangle /> {error}
              </div>
            )}
          </div>
        </aside>
      </form>
    </PublicServiceFrame>
  )
}
