import { useEffect, useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  FileCheck2,
  Fingerprint,
  MapPin,
  Phone,
  QrCode,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { api } from '../../api'
import type { Citizen } from '../../types'
import { CardTile, FaceChallengeStart, type CardData } from '../../components/camera/IdentityCaptureTiles'
import type { LivenessTimelineEntry } from '../../components/camera/IdentityCamera'
import { Brand } from '../../components/public/Brand'
import { AuthAside, AuthShell } from '../../components/public/AuthShell'

/** Mirrors server/person-name.ts: two or more words, none shorter than two letters. */
const plausibleName = (value: string) => {
  const name = value.replace(/\s+/g, ' ').trim()
  if (name.length < 5 || !/^[\p{Script=Arabic}A-Za-z' -]+$/u.test(name)) return false
  const words = name.split(' ')
  return words.length >= 2 && words.every(word => word.replace(/[ـً-ٟ'-]/g, '').length >= 2)
}

export function OnboardingPage() {
  const [, navigate] = useLocation()
  const requestedContinuePath = new URLSearchParams(window.location.search).get('continue') || ''
  const continuePath = requestedContinuePath.startsWith('/service/') ? requestedContinuePath : '/citizen'
  const [step, setStep] = useState(1)
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [challengeId, setChallengeId] = useState('')
  // identity is confirmed with the unified national card only
  const documentType = 'NATIONAL_ID' as const
  const [fullName, setFullName] = useState('')
  const [documentNumber, setDocumentNumber] = useState('')
  const [idFront, setIdFront] = useState<File | null>(null)
  const [idBack, setIdBack] = useState<File | null>(null)
  const [faceVideo, setFaceVideo] = useState<File | null>(null)
  const [cardData, setCardData] = useState<CardData | null>(null)
  const [liveness, setLiveness] = useState<{ id: string; timeline: LivenessTimelineEntry[] } | null>(null)
  const [reviewId, setReviewId] = useState('')
  const [screeningScore, setScreeningScore] = useState<number | null>(null)
  const [faceComparison, setFaceComparison] = useState<{ status: string; confidence: number | null } | null>(null)
  // the automatic decision arrives a few seconds after submission (face match, liveness, card zone)
  const [autoResult, setAutoResult] = useState<{ state: 'checking' | 'approved' | 'review'; reasons: string[] }>({
    state: 'checking',
    reasons: [],
  })
  useEffect(() => {
    if (step !== 5 || autoResult.state !== 'checking') return
    let tries = 0
    const timer = window.setInterval(async () => {
      tries += 1
      try {
        const latest = await api.getLatestIdentityReview()
        if (latest?.status === 'APPROVED') {
          setAutoResult({ state: 'approved', reasons: [] })
        } else if (latest?.auto_decision === 'HUMAN_REVIEW') {
          const reasons = latest.auto_decision_reasons ? (JSON.parse(latest.auto_decision_reasons) as string[]) : []
          setAutoResult({ state: 'review', reasons })
        }
      } catch {
        /* keep polling; the result is also sent as a notification */
      }
      if (tries >= 45)
        setAutoResult(current =>
          current.state === 'checking'
            ? { state: 'review', reasons: ['استغرق التحقق الآلي وقتاً أطول من المعتاد؛ ستصلك النتيجة كإشعار'] }
            : current
        )
    }, 2000)
    return () => window.clearInterval(timer)
  }, [step, autoResult.state])
  const [consent, setConsent] = useState(false)
  const [retainMedia, setRetainMedia] = useState(true)
  const analysisConsent = true
  const profilePhotoConsent = true
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracyM?: number } | null>(null)
  const [locationBusy, setLocationBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [savedCitizen, setSavedCitizen] = useState<Citizen | null>(null)
  const documentOptions = {
    NATIONAL_ID: {
      label: 'البطاقة الوطنية الموحدة',
      number: 'الرقم الوطني',
      front: 'وجه البطاقة الوطنية الموحدة',
      back: 'ظهر البطاقة الوطنية الموحدة',
      guidance: 'صوّر البطاقة الأصلية مباشرة: ضعها على سطح داكن، أظهر الحواف الأربع، وتجنب الوهج والظلال.',
    },
    PASSPORT: {
      label: 'جواز السفر العراقي',
      number: 'رقم جواز السفر',
      front: 'صفحة البيانات في جواز السفر',
      back: '',
      guidance: 'صوّر صفحة البيانات والصورة الشخصية كاملة وبوضوح.',
    },
    DRIVING_LICENSE: {
      label: 'إجازة السياقة العراقية',
      number: 'رقم إجازة السياقة',
      front: 'وجه إجازة السياقة',
      back: 'ظهر إجازة السياقة',
      guidance: 'أظهر الحواف الأربع للإجازة وتجنب الانعكاس أو الظل.',
    },
  } as const
  const documentCopy = documentOptions[documentType]
  const isVerifiedCitizen = (citizen: Citizen) =>
    citizen.verificationStatus === 'VERIFIED' || citizen.verificationStatus === 'VERIFIED_MANUAL'
  useEffect(() => {
    let active = true
    api
      .getSession()
      .then(async session => {
        if (session.role !== 'CITIZEN') return null
        return api.getDemoCitizen()
      })
      .then(citizen => {
        if (!active || !citizen) return
        if (isVerifiedCitizen(citizen)) navigate(continuePath)
        else if (citizen.fullName !== 'مواطن جديد') setSavedCitizen(citizen)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [navigate, continuePath])
  const requestOtp = async () => {
    setBusy(true)
    setMessage('')
    setNotice('')
    try {
      const challenge = await api.requestOtp(phone)
      setChallengeId(challenge.challengeId)
      setOtp('')
      setNotice('تم إرسال رمز لمرة واحدة إلى ' + challenge.phoneMasked + '. صالح لمدة 5 دقائق.')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const nextPhone = async () => {
    if (!challengeId) return setMessage('اطلب رمز التحقق أولاً.')
    setBusy(true)
    setMessage('')
    try {
      await api.verifyPhone(phone, challengeId, otp)
      const citizen = await api.getDemoCitizen()
      setNotice('')
      if (isVerifiedCitizen(citizen)) return navigate(continuePath)
      if (citizen.fullName !== 'مواطن جديد') return setSavedCitizen(citizen)
      setStep(2)
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const analyzeDocument = async (document: File | null = idFront) => {
    if (!document) return
    try {
      const result = await api.previewIdentityDocument({ documentType, document })
      // the server already drops OCR fragments; never overwrite what the citizen typed themselves
      if (result.fields.fullName && !fullName.trim()) setFullName(result.fields.fullName)
      if (result.fields.documentNumber) setDocumentNumber(result.fields.documentNumber)
    } catch {
      // prefilling is a convenience; the full reading happens on submission
    }
  }
  const saveChosenLocation = async (value: { lat: number; lng: number; accuracyM?: number }) => {
    setLocationBusy(true)
    setMessage('')
    try {
      await api.updateCitizenLocation({ ...value, consent: true })
      setLocation(value)
      setNotice('تم تحديد موقع الجهاز وحفظه بشكل محمي للمراجعة المخولة فقط.')
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setLocationBusy(false)
    }
  }
  const captureLocation = (onComplete?: () => void) => {
    if (!navigator.geolocation) {
      setMessage('تحديد الموقع غير مدعوم في هذا المتصفح. يمكنك إكمال التسجيل من دون موقع.')
      onComplete?.()
      return
    }
    setLocationBusy(true)
    setMessage('')
    navigator.geolocation.getCurrentPosition(
      position => {
        void saveChosenLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        }).finally(() => onComplete?.())
      },
      error => {
        setLocationBusy(false)
        setMessage(
          error.code === error.PERMISSION_DENIED
            ? 'لم تمنح إذن تحديد الموقع. يمكنك إكمال التسجيل من دون موقع أو السماح به لاحقاً من إعدادات المتصفح.'
            : 'تعذر تحديد الموقع الآن. حاول في مكان مفتوح أو أكمل التسجيل من دون موقع.'
        )
        onComplete?.()
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 }
    )
  }
  const continueToFaceVerification = () => {
    if (!idBack || !plausibleName(fullName)) return
    captureLocation(() => setStep(4))
  }
  const finish = async () => {
    if (!consent || !retainMedia)
      return setMessage('الموافقة على المراجعة والاحتفاظ المشفر بالمرفقات مطلوبة قبل الإرسال.')
    if (!plausibleName(fullName) || !idFront || !idBack || !faceVideo)
      return setMessage('أكمل الاسم وصورتي البطاقة الموحدة وفيديو الوجه قبل الإرسال.')
    setBusy(true)
    setMessage('')
    try {
      const review = await api.submitIdentityReview({
        fullName,
        documentNumber,
        documentType,
        consent,
        retainMedia,
        analysisConsent,
        profilePhotoConsent,
        location,
        idFront,
        idBack,
        faceVideo,
        livenessChallengeId: liveness?.id,
        livenessTimeline: liveness?.timeline,
      })
      setReviewId(review.id)
      setScreeningScore(review.screening.qualityScore)
      setFaceComparison(review.analysis.faceComparison)
      setAutoResult({ state: 'checking', reasons: [] })
      setStep(5)
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const titles = ['الهاتف', 'المستمسك', 'البيانات', 'فيديو الوجه', 'المراجعة']
  if (savedCitizen)
    return (
      <AuthShell context="حساب المواطن">
        <section className="auth-card onb-saved">
          <span className="success-seal">
            <BadgeCheck />
          </span>
          <span className="section-kicker">حساب محفوظ</span>
          <h1>أهلاً بك مجدداً، {savedCitizen.fullName}</h1>
          <p>
            تم العثور على حسابك المرتبط برقم الهاتف. لا تحتاج إلى إنشاء حساب جديد؛ يبقى التقديم موقوفاً حتى تكتمل نتيجة
            توثيق الوجه والمستمسك.
          </p>
          <div className="saved-account-details">
            <span>
              <small>رقم الهاتف</small>
              <strong dir="ltr">{savedCitizen.phoneMasked}</strong>
            </span>
            <span>
              <small>حالة الهوية</small>
              <strong>
                {savedCitizen.verificationStatus === 'NEEDS_RESUBMISSION'
                  ? 'مطلوب إعادة التوثيق'
                  : savedCitizen.verificationStatus === 'REJECTED'
                    ? 'تحتاج إلى مراجعة سبب الرفض'
                    : 'قيد المراجعة المخولة'}
              </strong>
            </span>
          </div>
          <div className="saved-account-actions">
            <Link className="button primary" href="/citizen">
              فتح حسابي <ArrowLeft />
            </Link>
            {savedCitizen.verificationStatus === 'NEEDS_RESUBMISSION' && (
              <button
                className="button outline"
                onClick={() => {
                  setSavedCitizen(null)
                  setStep(2)
                }}
              >
                إعادة تصوير المستمسك وتوثيق الوجه
              </button>
            )}
          </div>
        </section>
      </AuthShell>
    )
  return (
    <AuthShell
      back={{ href: '/login', label: 'بوابات الدخول' }}
      context="حساب المواطن"
      aside={
        <AuthAside
          kicker="إنشاء حساب المواطن"
          title="توثيق بالبطاقة الوطنية الموحدة"
          points={[
            'تصوّر بطاقتك الموحدة الأصلية مباشرة بكاميرا الهاتف، وتُقرأ بياناتك منها',
            'يطابق الذكاء الاصطناعي وجهك مع صورة البطاقة ويتأكد أنك أمام الكاميرا',
            'عند التطابق تُوثَّق هويتك فوراً؛ وإلا يراجع طلبك موظف مختص',
            'تُحفظ مرفقاتك مشفّرة، وتوثيق واحد يكفي لكل خدمات المنصة',
          ]}
        />
      }
    >
      <section className="auth-card onb-panel">
        <span className="section-kicker">
          <ShieldCheck size={15} /> حساب المواطن
        </span>
        <h1 className="onb-title">
          {step === 1
            ? 'ادخل أو أنشئ حسابك برقم الهاتف'
            : step === 5
              ? 'اكتمل إرسال طلب التوثيق'
              : 'وثّق هويتك مرة واحدة'}
        </h1>
        <div className="stepper">
          {titles.map((title, index) => (
            <div className={step > index + 1 ? 'done' : step === index + 1 ? 'active' : ''} key={title}>
              <span>{step > index + 1 ? <Check /> : index + 1}</span>
              <small>{title}</small>
            </div>
          ))}
        </div>
        {step === 1 && (
          <div className="form-stage">
            <span className="stage-icon">
              <Phone />
            </span>
            <h2>تأكيد رقم الهاتف</h2>
            <p>سنرسل رمز تحقق لمرة واحدة عبر واتساب أو تيليغرام أو رسالة نصية، بحسب المتاح.</p>
            <label>
              رقم الهاتف العراقي
              <input
                value={phone}
                onChange={e => {
                  setPhone(e.target.value)
                  setChallengeId('')
                  setOtp('')
                  setNotice('')
                }}
                inputMode="tel"
                autoComplete="tel"
                placeholder="07XXXXXXXXX"
              />
            </label>
            {!challengeId ? (
              <button className="button primary full" onClick={requestOtp} disabled={busy || phone.length < 10}>
                {busy ? 'جاري الإرسال...' : 'إرسال رمز التحقق'}
              </button>
            ) : (
              <>
                <label>
                  رمز التحقق
                  <input
                    value={otp}
                    onChange={e =>
                      setOtp(
                        e.target.value
                          // Arabic-Indic / Persian digits from Arabic keyboards count as digits, not as junk
                          .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) & 0xf))
                          .replace(/\D/g, '')
                          .slice(0, 6)
                      )
                    }
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="6 digits"
                  />
                </label>
                <button className="button primary full" onClick={nextPhone} disabled={busy || otp.length !== 6}>
                  {busy ? 'جاري التحقق...' : 'تأكيد الهاتف'}
                </button>
                <button className="button ghost full" onClick={requestOtp} disabled={busy}>
                  إعادة إرسال الرمز
                </button>
              </>
            )}
          </div>
        )}
        {step === 2 && (
          <div className="form-stage">
            <span className="stage-icon">
              <FileCheck2 />
            </span>
            <h2>صوّر البطاقة الوطنية الموحدة</h2>
            <p>
              التوثيق بالبطاقة الوطنية الموحدة الأصلية فقط، وتُصوَّر الآن بكاميرا الهاتف مباشرة (لا تُقبل صور محفوظة أو
              نسخ). تُقرأ بياناتك من البطاقة وتُطابق صورتها مع وجهك بالذكاء الاصطناعي.
            </p>
            <div className="id-tiles">
              <CardTile
                side="front"
                file={idFront}
                onFile={file => {
                  setIdFront(file)
                  if (file) void analyzeDocument(file)
                }}
              />
              <CardTile side="back" file={idBack} onFile={setIdBack} onCard={setCardData} />
            </div>
            <div className="stage-actions">
              <button className="button ghost" onClick={() => setStep(1)}>
                <ArrowRight /> رجوع
              </button>
              <button className="button primary" onClick={() => setStep(3)} disabled={!idFront || !idBack}>
                متابعة <ArrowLeft />
              </button>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="form-stage">
            <span className="stage-icon">
              <FileCheck2 />
            </span>
            <h2>راجع بياناتك واكتب اسمك</h2>
            <p>هذه البيانات قُرئت من بطاقتك وستُسجّل في حسابك بعد التحقق. اكتب اسمك الثلاثي بالعربي كما في البطاقة.</p>
            {cardData ? (
              <div className="id-card-data" aria-live="polite">
                <span>
                  <small>الاسم في البطاقة</small>
                  <strong dir="ltr">{cardData.name || '—'}</strong>
                </span>
                <span>
                  <small>رقم البطاقة</small>
                  <strong dir="ltr">•••• {cardData.documentLast4}</strong>
                </span>
                <span>
                  <small>تاريخ الميلاد</small>
                  <strong dir="ltr">{cardData.birthDate || '—'}</strong>
                </span>
                <span>
                  <small>الجنس</small>
                  <strong>{cardData.sex || '—'}</strong>
                </span>
                <span>
                  <small>تنتهي في</small>
                  <strong dir="ltr">{cardData.expiryDate || '—'}</strong>
                </span>
                <span>
                  <small>الجنسية</small>
                  <strong>{cardData.nationality === 'IRQ' ? 'عراقية' : cardData.nationality}</strong>
                </span>
              </div>
            ) : (
              <div className="form-notice">
                <Sparkles /> لم تُقرأ بيانات ظهر البطاقة بعد. يمكنك المتابعة، وستُقرأ بعد الإرسال؛ أو ارجع وأعد تصوير
                الظهر بوضوح.
              </div>
            )}
            <div className="identity-edit-fields">
              <label>
                الاسم الكامل
                <input
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  autoComplete="name"
                  placeholder="الاسم الثلاثي كما في المستند"
                  aria-invalid={fullName.trim() !== '' && !plausibleName(fullName)}
                />
                {fullName.trim() !== '' && !plausibleName(fullName) && (
                  <small className="field-hint is-error">
                    راجع الاسم: اكتبه كاملاً بحروف واضحة (الاسم الثلاثي على الأقل كلمتين)، وصحّح أي حروف ناقصة.
                  </small>
                )}
              </label>
              <label>
                {documentCopy.number} <small>اختياري — يُقرأ من البطاقة تلقائياً</small>
                <input
                  value={documentNumber}
                  onChange={e => setDocumentNumber(e.target.value.replace(/\s/g, '').slice(0, 40))}
                  inputMode="text"
                  placeholder="يُقرأ من البطاقة"
                />
              </label>
            </div>
            <div className={location ? 'location-consent-card location-saved' : 'location-consent-card'}>
              <div>
                <MapPin />
                <strong>{location ? 'تم حفظ موقع الجهاز' : 'سيُطلب موقع الجهاز عند المتابعة'}</strong>
                <p>
                  {location
                    ? 'لا تظهر الخريطة أو الإحداثيات داخل حسابك. الموقع محفوظ ومتاح للمراجع المخول فقط عند تدقيق الطلب.'
                    : 'عند الضغط على متابعة يفتح الهاتف طلب إذن GPS تلقائياً لمرة واحدة، ثم تنتقل إلى فيديو الوجه سواء تمت الموافقة أو لا.'}
                </p>
              </div>
              <span className="location-auto-status">
                {locationBusy ? 'جاري تحديد الموقع...' : location ? 'تم الحفظ بشكل محمي' : 'تلقائي عند المتابعة'}
              </span>
            </div>
            <div className="stage-actions">
              <button className="button ghost" onClick={() => setStep(2)}>
                <ArrowRight /> رجوع
              </button>
              <button
                className="button primary"
                onClick={continueToFaceVerification}
                disabled={locationBusy || !idBack || !plausibleName(fullName)}
              >
                متابعة <ArrowLeft />
              </button>
            </div>
          </div>
        )}
        {step === 4 && (
          <div className="form-stage">
            <span className="stage-icon">
              <Fingerprint />
            </span>
            <h2>تأكيد الوجه بفيديو 7 ثوانٍ</h2>
            <p>
              تفتح الكاميرا الأمامية ويبدأ التسجيل تلقائياً لمدة 7 ثوانٍ: انظر للكاميرا، ثم أدر رأسك ببطء لليمين ثم
              لليسار. يطابق الذكاء الاصطناعي وجهك مع صورة البطاقة ويتأكد أنك أمام الكاميرا فعلاً؛ عند التطابق تُوثَّق
              هويتك فوراً، وإلا يراجع طلبك موظف مختص.
            </p>
            <FaceChallengeStart
              done={Boolean(faceVideo)}
              onCaptured={(video, challengeId, timeline) => {
                setFaceVideo(video)
                setLiveness({ id: challengeId, timeline })
              }}
            />
            <label className="consent-box">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
              <span>
                أوافق صراحة على رفع المستند وفيديو الوجه للتدقيق البشري المخول والتحليل التلقائي المساعد لاستخراج بيانات
                المستند.
              </span>
            </label>
            <label className="consent-box">
              <input type="checkbox" checked={retainMedia} onChange={e => setRetainMedia(e.target.checked)} />
              <span>أوافق على الاحتفاظ المشفر بالمرفقات ضمن سجل حسابي بدلاً من حذفها بعد القرار.</span>
            </label>
            <div className="automatic-profile-note">
              <UserRound />
              <span>
                <strong>صورة الملف تلقائية عند الثقة الكافية</strong>
                <small>لا تُعرض صورة المستند الكاملة كصورة حساب.</small>
              </span>
            </div>
            <div className="stage-actions">
              <button className="button ghost" onClick={() => setStep(3)}>
                <ArrowRight /> رجوع
              </button>
              <button
                className="button primary"
                onClick={finish}
                disabled={busy || !faceVideo || !consent || !retainMedia}
              >
                {busy ? 'جاري الإرسال...' : 'إرسال للتوثيق'}
              </button>
            </div>
          </div>
        )}
        {step === 5 && (
          <div className="form-stage success-stage">
            <span className="success-seal">
              <FileCheck2 />
            </span>
            <span className={`id-result-anim is-${autoResult.state}`} aria-hidden="true">
              {autoResult.state === 'approved' ? (
                <CheckCircle2 />
              ) : autoResult.state === 'review' ? (
                <UserRound />
              ) : null}
            </span>
            <h2>
              {autoResult.state === 'approved'
                ? 'تم توثيق هويتك'
                : autoResult.state === 'review'
                  ? 'طلبك عند مراجع الهوية'
                  : 'جاري التحقق بالذكاء الاصطناعي…'}
            </h2>
            <div className={`identity-auto-result is-${autoResult.state}`} role="status" aria-live="polite">
              {autoResult.state === 'checking' && (
                <p>نقرأ بيانات البطاقة ونطابق وجهك مع صورتها ونتأكد من وجودك أمام الكاميرا. يستغرق ذلك عادةً ثوانٍ.</p>
              )}
              {autoResult.state === 'approved' && (
                <p>
                  تطابق وجهك مع صورة البطاقة الموحدة، وسُجلت بياناتك من البطاقة في حسابك. يمكنك تقديم المعاملات الآن.
                </p>
              )}
              {autoResult.state === 'review' && (
                <>
                  <p>لم يكتمل التوثيق التلقائي للأسباب التالية، وسيراجع طلبك موظف مختص:</p>
                  <ul>
                    {autoResult.reasons.map(reason => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="citizen-id-card">
              <Brand compact />
              <div>
                <small>رقم طلب المراجعة</small>
                <strong>{reviewId}</strong>
                <span>
                  <CheckCircle2 /> فحص الجودة {screeningScore?.toLocaleString('en-US') || '—'}%
                </span>
              </div>
              <QrCode />
            </div>
            {autoResult.state === 'checking' && faceComparison && (
              <div className="face-comparison-result manual-review-required">
                <Fingerprint />
                <span>
                  <strong>تم استلام صورتي البطاقة وفيديو الوجه بشكل مشفّر</strong>
                  <small>لا تغلق الصفحة حتى تظهر النتيجة.</small>
                </span>
              </div>
            )}
            <button className="button primary full" onClick={() => navigate('/citizen')}>
              الدخول إلى حسابي <ArrowLeft />
            </button>
          </div>
        )}
        {notice && (
          <div className="form-success">
            <CheckCircle2 /> {notice}
          </div>
        )}
        {message && (
          <div className="form-error">
            <AlertTriangle /> {message}
          </div>
        )}
      </section>
    </AuthShell>
  )
}
