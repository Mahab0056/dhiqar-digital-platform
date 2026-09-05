import type React from 'react'
import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  FileText,
  MapPin,
  MessageSquareWarning,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { api } from '../../api'
import { defaultStats } from '../../data'
import type { CitizenFeedback } from '../../types'
import { PortalLayout } from '../../components/citizen/PortalLayout'
import { feedbackStatusLabels, feedbackCategories } from './feedback-labels'

export function CitizenFeedbackPage() {
  const [, navigate] = useLocation()
  const [kind, setKind] = useState<'COMPLAINT' | 'SUGGESTION'>('COMPLAINT')
  const [category, setCategory] = useState(feedbackCategories.COMPLAINT[0])
  const [departmentId, setDepartmentId] = useState('')
  const [district, setDistrict] = useState('الناصرية')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [locationState, setLocationState] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<CitizenFeedback | null>(null)
  const categories = feedbackCategories[kind]
  const getLocation = () => {
    if (!navigator.geolocation) return setLocationState('متصفحك لا يدعم تحديد الموقع. يمكنك الإرسال بدون موقع.')
    setLocationState('جاري تحديد موقع البلاغ...')
    navigator.geolocation.getCurrentPosition(
      position => {
        setLocation({ lat: position.coords.latitude, lng: position.coords.longitude })
        setLocationState('تم تحديد الموقع. يمكنك تعديل الوصف قبل الإرسال.')
      },
      () => setLocationState('تعذر تحديد الموقع. تحقق من إذن الموقع أو أكمل الإرسال بدونه.'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }
  const onFiles = (files: FileList | null) => {
    const selected = Array.from(files || []).slice(0, 3)
    const allowed = selected.every(file => file.type.startsWith('image/') || file.type === 'application/pdf')
    if (!allowed) return setError('يمكن إرفاق صور أو ملفات PDF فقط.')
    if (selected.some(file => file.size > 20 * 1024 * 1024)) return setError('حجم كل مرفق يجب ألا يتجاوز 20 MB.')
    setError('')
    setAttachments(selected)
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (subject.trim().length < 6) return setError('اكتب عنواناً واضحاً من 6 أحرف على الأقل.')
    if (description.trim().length < 20) return setError('اشرح الطلب بتفصيل مختصر لا يقل عن 20 حرفاً.')
    setBusy(true)
    try {
      const result = await api.createFeedback({
        kind,
        category,
        departmentId: departmentId || undefined,
        subject,
        description,
        district,
        lat: location?.lat,
        lng: location?.lng,
        attachments,
      })
      setCreated(result)
    } catch (submitError) {
      setError((submitError as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (created)
    return (
      <PortalLayout>
        <section className="feedback-success">
          <span>
            <CheckCircle2 />
          </span>
          <div className="section-kicker">REQUEST REGISTERED</div>
          <h1>{kind === 'COMPLAINT' ? 'تم تسجيل الشكوى' : 'تم تسجيل المقترح'}</h1>
          <p>{created.currentAction}</p>
          <div>
            <span>
              <small>رقم المتابعة</small>
              <strong>{created.reference}</strong>
            </span>
            <span>
              <small>الحالة</small>
              <strong>{feedbackStatusLabels[created.status]}</strong>
            </span>
          </div>
          <Link className="button primary" href={`/citizen/feedback/${created.reference}`}>
            متابعة الطلب <ArrowLeft />
          </Link>
          <button className="button ghost" onClick={() => navigate('/citizen')}>
            العودة للحساب
          </button>
        </section>
      </PortalLayout>
    )
  return (
    <PortalLayout>
      <div className="feedback-page">
        <header className="feedback-page-head">
          <Link href="/citizen">
            <ArrowRight /> حساب المواطن
          </Link>
          <span className="section-kicker">YOUR VOICE</span>
          <h1>
            شكوى أو مقترح،<em> صوتك يوصل</em>
          </h1>
          <p>سجّل طلبك بخطوات قصيرة. راح يصلك رقم متابعة وإشعار مع كل تحديث من الجهة المختصة.</p>
        </header>
        <form className="feedback-form" onSubmit={submit}>
          <section className="feedback-kind-select">
            <button
              type="button"
              className={kind === 'COMPLAINT' ? 'active complaint' : ''}
              onClick={() => {
                setKind('COMPLAINT')
                setCategory(feedbackCategories.COMPLAINT[0])
              }}
            >
              <MessageSquareWarning />
              <span>
                <b>تقديم شكوى</b>
                <small>بلاغ عن خدمة أو مشكلة</small>
              </span>
              <CheckCircle2 />
            </button>
            <button
              type="button"
              className={kind === 'SUGGESTION' ? 'active suggestion' : ''}
              onClick={() => {
                setKind('SUGGESTION')
                setCategory(feedbackCategories.SUGGESTION[0])
              }}
            >
              <Sparkles />
              <span>
                <b>تقديم مقترح</b>
                <small>فكرة لتحسين المدينة والخدمات</small>
              </span>
              <CheckCircle2 />
            </button>
          </section>
          <section className="feedback-form-card">
            <div className="feedback-form-title">
              <span>1</span>
              <div>
                <h2>حدد الموضوع</h2>
                <p>اختَر التصنيف والجهة إذا تعرفها.</p>
              </div>
            </div>
            <div className="feedback-fields">
              <label>
                التصنيف
                <select value={category} onChange={event => setCategory(event.target.value)}>
                  {categories.map(item => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                الدائرة المعنية <small>اختياري</small>
                <select value={departmentId} onChange={event => setDepartmentId(event.target.value)}>
                  <option value="">لا أعرف الدائرة</option>
                  {defaultStats.departments.map(item => (
                    <option value={String(item.id)} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                القضاء / المنطقة
                <select value={district} onChange={event => setDistrict(event.target.value)}>
                  <option>الناصرية</option>
                  <option>الشطرة</option>
                  <option>سوق الشيوخ</option>
                  <option>الرفاعي</option>
                  <option>الجبايش</option>
                  <option>قلعة سكر</option>
                  <option>الفجر</option>
                </select>
              </label>
              <label className="feedback-wide">
                عنوان مختصر
                <input
                  value={subject}
                  onChange={event => setSubject(event.target.value.slice(0, 160))}
                  placeholder={
                    kind === 'COMPLAINT' ? 'مثال: تضرر إنارة الشارع قرب المدرسة' : 'مثال: مقترح بوابة موعد موحدة'
                  }
                />
                <small>{subject.length.toLocaleString('en-US')}/160</small>
              </label>
              <label className="feedback-wide">
                اشرح التفاصيل
                <textarea
                  value={description}
                  onChange={event => setDescription(event.target.value.slice(0, 4000))}
                  rows={5}
                  placeholder="اكتب المشكلة أو المقترح، المكان، والوقت أو أي تفاصيل تساعد الجهة المختصة."
                />
                <small>{description.length.toLocaleString('en-US')}/4000</small>
              </label>
            </div>
          </section>
          <section className="feedback-form-card">
            <div className="feedback-form-title">
              <span>2</span>
              <div>
                <h2>الموقع والمرفقات</h2>
                <p>اختيارية، لكنها تساعد على معالجة الطلب بدقة أسرع.</p>
              </div>
            </div>
            <div className="feedback-evidence-grid">
              <div className="feedback-location">
                <MapPin />
                <strong>{location ? 'تم تحديد موقع البلاغ' : 'حدد موقع البلاغ'}</strong>
                <p>
                  {location
                    ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
                    : locationState || 'يمكنك الإرسال بدون الموقع إذا كانت التفاصيل كافية.'}
                </p>
                <button className="button outline" type="button" onClick={getLocation}>
                  <MapPin /> {location ? 'تحديث الموقع' : 'استخدم موقعي'}
                </button>
              </div>
              <label className="feedback-upload">
                <input
                  hidden
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  capture="environment"
                  onChange={event => onFiles(event.target.files)}
                />
                <Camera />
                <strong>أضف صور أو PDF</strong>
                <span>حتى 3 مرفقات، 20 MB لكل ملف</span>
                <button
                  type="button"
                  className="button ghost"
                  onClick={event => {
                    event.preventDefault()
                    event.currentTarget.parentElement?.querySelector('input')?.click()
                  }}
                >
                  فتح الكاميرا / الملفات
                </button>
              </label>
            </div>
            {attachments.length > 0 && (
              <div className="feedback-attachments">
                {attachments.map((file, index) => (
                  <span key={`${file.name}-${index}`}>
                    <FileText /> {file.name}{' '}
                    <button
                      type="button"
                      onClick={() => setAttachments(current => current.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      <X />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>
          {error && (
            <div className="form-error">
              <AlertTriangle /> {error}
            </div>
          )}
          <footer className="feedback-submit">
            <div>
              <ShieldCheck />
              <span>سجل الطلب والمرفقات محمي، وتظهر تفاصيله فقط لصاحب الطلب والموظف المخول.</span>
            </div>
            <button className="button primary" type="submit" disabled={busy}>
              {busy ? 'جاري تسجيل الطلب...' : kind === 'COMPLAINT' ? 'إرسال الشكوى' : 'إرسال المقترح'} <Send />
            </button>
          </footer>
        </form>
      </div>
    </PortalLayout>
  )
}
