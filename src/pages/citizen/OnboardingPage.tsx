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
  X,
} from 'lucide-react'
import { api } from '../../api'
import type { Citizen } from '../../types'
import { SecureCameraCapture } from '../../components/camera/SecureCameraCapture'
import { Brand } from '../../components/public/Brand'
import { CivicUtilityBar } from '../../components/public/CivicUtilityBar'

export function OnboardingPage() {
  const [, navigate] = useLocation()
  const requestedContinuePath = new URLSearchParams(window.location.search).get('continue') || ''
  const continuePath = requestedContinuePath.startsWith('/service/') ? requestedContinuePath : '/citizen'
  const [step, setStep] = useState(1)
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [documentType, setDocumentType] = useState<'NATIONAL_ID' | 'PASSPORT' | 'DRIVING_LICENSE'>('NATIONAL_ID')
  const [fullName, setFullName] = useState('')
  const [documentNumber, setDocumentNumber] = useState('')
  const [idFront, setIdFront] = useState<File | null>(null)
  const [idBack, setIdBack] = useState<File | null>(null)
  const [faceVideo, setFaceVideo] = useState<File | null>(null)
  const [reviewId, setReviewId] = useState('')
  const [screeningScore, setScreeningScore] = useState<number | null>(null)
  const [faceComparison, setFaceComparison] = useState<{ status: string; confidence: number | null } | null>(null)
  const [consent, setConsent] = useState(false)
  const [retainMedia, setRetainMedia] = useState(true)
  const analysisConsent = true
  const profilePhotoConsent = true
  const [analysisState, setAnalysisState] = useState<'idle' | 'loading' | 'complete' | 'unavailable'>('idle')
  const [analysisNote, setAnalysisNote] = useState('')
  const [extractedFields, setExtractedFields] = useState({
    fullName: '',
    documentNumber: '',
    dateOfBirth: '',
    nationality: '',
    sex: '',
    expiryDate: '',
  })
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
      front: 'وجه الهوية الوطنية',
      back: 'ظهر الهوية الوطنية',
      guidance: 'أظهر الحواف الأربع للبطاقة وتجنب الوهج أو الظلال.',
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
    setAnalysisState('loading')
    setAnalysisNote('جاري تحليل المستند تلقائياً...')
    setMessage('')
    try {
      const result = await api.previewIdentityDocument({ documentType, document })
      if (result.fields.fullName) setFullName(result.fields.fullName)
      if (result.fields.documentNumber) setDocumentNumber(result.fields.documentNumber)
      setExtractedFields({
        fullName: result.fields.fullName || '',
        documentNumber: result.fields.documentNumber || '',
        dateOfBirth: result.fields.dateOfBirth || '',
        nationality: result.fields.nationality || '',
        sex: result.fields.sex || '',
        expiryDate: result.fields.expiryDate || '',
      })
      setAnalysisState(result.status === 'COMPLETED' ? 'complete' : 'unavailable')
      setAnalysisNote(
        result.status === 'COMPLETED'
          ? 'تمت قراءة الحقول المتاحة تلقائياً. راجع الاسم والرقم قبل الإرسال؛ القرار النهائي للمراجع المخول.'
          : result.message || 'تعذر تشغيل مزود التحليل الآن؛ سيظهر السبب بوضوح ويمكن إعادة المحاولة بعد توفر المزود.'
      )
    } catch (error) {
      setAnalysisState('unavailable')
      setAnalysisNote((error as Error).message)
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
    if ((documentType !== 'PASSPORT' && !idBack) || fullName.trim().length < 3 || documentNumber.length < 4) return
    captureLocation(() => setStep(4))
  }
  const finish = async () => {
    if (!consent || !retainMedia)
      return setMessage('الموافقة على المراجعة والاحتفاظ المشفر بالمرفقات مطلوبة قبل الإرسال.')
    if (!fullName || !documentNumber || !idFront || (!idBack && documentType !== 'PASSPORT') || !faceVideo)
      return setMessage('أكمل الاسم والرقم وصور المستند وفيديو الوجه قبل الإرسال.')
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
      })
      setReviewId(review.id)
      setScreeningScore(review.screening.qualityScore)
      setFaceComparison(review.analysis.faceComparison)
      setStep(5)
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const titles = ['الهاتف', 'المستند', 'البيانات', 'فيديو الوجه', 'المراجعة']
  if (savedCitizen)
    return (
      <div className="onboarding-page">
        <CivicUtilityBar />
        <header className="onboarding-header container">
          <Brand />
          <Link href="/">
            <X />
          </Link>
        </header>
        <main className="container saved-account-layout">
          <section className="saved-account-card">
            <span className="success-seal">
              <BadgeCheck />
            </span>
            <span className="section-kicker">حساب محفوظ</span>
            <h1>أهلاً بك مجدداً، {savedCitizen.fullName}</h1>
            <p>
              تم العثور على حسابك المرتبط برقم الهاتف. لا تحتاج إلى إنشاء حساب جديد؛ يبقى التقديم موقوفاً حتى تكتمل
              نتيجة توثيق الوجه والمستند.
            </p>
            <div className="saved-account-details">
              <span>
                <small>رقم الهاتف</small>
                <strong>{savedCitizen.phoneMasked}</strong>
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
                  إعادة تصوير المستند وتوثيق الوجه
                </button>
              )}
            </div>
          </section>
        </main>
      </div>
    )
  return (
    <div className="onboarding-page">
      <CivicUtilityBar />
      <header className="onboarding-header container">
        <Brand />
        <span>إنشاء الهوية الرقمية</span>
        <Link href="/login">
          <X />
        </Link>
      </header>
      <main className="container onboarding-layout">
        <aside className="onboarding-aside">
          <span className="section-kicker">إنشاء حساب المواطن</span>
          <h1>يبدأ حسابك من مستند موثق.</h1>
          <p>
            يدعم التسجيل البطاقة الوطنية أو جواز السفر أو إجازة السياقة، مع مراجعة بشرية مخولة قبل تغيير حالة الهوية.
          </p>
          <div className="privacy-card">
            <ShieldCheck />
            <div>
              <strong>خصوصيتك جزء من التصميم</strong>
              <span>
                تُحفظ المرفقات بتشفير وعلى نطاق مراجعة محدد بعد موافقتك، ولا يصدر قرار هوية تلقائي من التحليل أو الفيديو
                وحدهما.
              </span>
            </div>
          </div>
        </aside>
        <section className="onboarding-panel">
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
              <p>سنرسل رمزاً حقيقياً لمرة واحدة عبر WhatsApp أو Telegram أو SMS مع تحويل تلقائي حسب التوفر.</p>
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
                      onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
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
              <h2>اختر المستند وصوّره</h2>
              <p>
                اختر المستند الذي ستسجل به ثم التقط صورته بوضوح. جواز السفر يحتاج صفحة البيانات فقط، أما الهوية وإجازة
                السياقة فيحتاجان الوجهين.
              </p>
              <div className="document-type-options">
                {(Object.entries(documentOptions) as Array<[typeof documentType, typeof documentCopy]>).map(
                  ([value, option]) => (
                    <button
                      type="button"
                      className={documentType === value ? 'active' : ''}
                      onClick={() => {
                        setDocumentType(value)
                        setIdFront(null)
                        setIdBack(null)
                        setAnalysisState('idle')
                        setAnalysisNote('')
                        setExtractedFields({
                          fullName: '',
                          documentNumber: '',
                          dateOfBirth: '',
                          nationality: '',
                          sex: '',
                          expiryDate: '',
                        })
                      }}
                      key={value}
                    >
                      {option.label}
                    </button>
                  )
                )}
              </div>
              <SecureCameraCapture
                title={documentCopy.front}
                guidance={documentCopy.guidance}
                mode="photo"
                facingMode="environment"
                file={idFront}
                onChange={file => {
                  setIdFront(file)
                  if (file) void analyzeDocument(file)
                }}
              />
              {idFront && (
                <div
                  className={
                    analysisState === 'complete'
                      ? 'automatic-analysis-status complete'
                      : analysisState === 'unavailable'
                        ? 'automatic-analysis-status unavailable'
                        : 'automatic-analysis-status'
                  }
                >
                  <Sparkles />{' '}
                  <span>
                    <strong>
                      {analysisState === 'loading'
                        ? 'جاري تحليل المستند تلقائياً'
                        : analysisState === 'complete'
                          ? 'اكتمل التحليل المبدئي'
                          : 'التحليل التلقائي قيد التهيئة'}
                    </strong>
                    <small>
                      {analysisState === 'loading'
                        ? 'لا تغلق الصفحة حتى تكتمل القراءة.'
                        : analysisState === 'complete'
                          ? 'تُملأ البيانات المتاحة في الخطوة التالية.'
                          : 'سيظهر سبب التعذر وخطوة التصحيح هنا.'}
                    </small>
                  </span>
                  {analysisState !== 'loading' && (
                    <button className="text-action" type="button" onClick={() => void analyzeDocument()}>
                      إعادة المحاولة
                    </button>
                  )}
                </div>
              )}
              {analysisNote && (
                <div className={analysisState === 'complete' ? 'form-success' : 'form-notice'}>
                  <Sparkles /> {analysisNote}
                </div>
              )}
              <div className="stage-actions">
                <button className="button ghost" onClick={() => setStep(1)}>
                  <ArrowRight /> رجوع
                </button>
                <button className="button primary" onClick={() => setStep(3)} disabled={!idFront}>
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
              <h2>راجع بيانات المستند</h2>
              <p>
                تظهر الحقول المقروءة من {documentCopy.label} كاملة قدر ما تسمح به جودة الصورة. راجع الاسم والرقم قبل
                الإرسال؛ ولا يظهر الرقم كاملاً ضمن قوائم الموظفين.
              </p>
              {documentType !== 'PASSPORT' && (
                <SecureCameraCapture
                  title={documentCopy.back}
                  guidance="صوّر الجهة الخلفية بوضوح أو ارفع صورة موجودة على الهاتف."
                  mode="photo"
                  facingMode="environment"
                  file={idBack}
                  onChange={setIdBack}
                />
              )}
              <section className="identity-extracted-data" aria-live="polite">
                <header>
                  <div>
                    <span className="section-kicker">نتيجة القراءة التلقائية</span>
                    <h3>بيانات المستند</h3>
                  </div>
                  <span className={analysisState === 'complete' ? 'analysis-chip complete' : 'analysis-chip'}>
                    {analysisState === 'complete' ? 'تمت القراءة' : 'بانتظار القراءة'}
                  </span>
                </header>
                <div className="identity-document-data-grid">
                  <span>
                    <small>نوع المستند</small>
                    <strong>{documentCopy.label}</strong>
                  </span>
                  <span>
                    <small>الاسم الكامل</small>
                    <strong>{fullName || extractedFields.fullName || 'لم يتم استخراجه تلقائياً'}</strong>
                  </span>
                  <span>
                    <small>{documentCopy.number}</small>
                    <strong dir="ltr">
                      {documentNumber || extractedFields.documentNumber || 'لم يتم استخراجه تلقائياً'}
                    </strong>
                  </span>
                  <span>
                    <small>تاريخ الميلاد</small>
                    <strong dir="ltr">{extractedFields.dateOfBirth || 'غير ظاهر بوضوح في المستند'}</strong>
                  </span>
                  <span>
                    <small>الجنسية</small>
                    <strong>{extractedFields.nationality || 'غير ظاهر بوضوح في المستند'}</strong>
                  </span>
                  <span>
                    <small>الجنس</small>
                    <strong>{extractedFields.sex || 'غير ظاهر بوضوح في المستند'}</strong>
                  </span>
                  <span>
                    <small>تاريخ الانتهاء</small>
                    <strong dir="ltr">{extractedFields.expiryDate || 'غير ظاهر أو غير منطبق'}</strong>
                  </span>
                </div>
              </section>
              <div className="identity-edit-fields">
                <label>
                  الاسم الكامل
                  <input
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    autoComplete="name"
                    placeholder="الاسم كما في المستند"
                  />
                </label>
                <label>
                  {documentCopy.number}
                  <input
                    value={documentNumber}
                    onChange={e => setDocumentNumber(e.target.value.replace(/\s/g, '').slice(0, 40))}
                    inputMode="text"
                    placeholder={documentType === 'PASSPORT' ? 'رقم الجواز' : 'رقم المستند'}
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
                  disabled={
                    locationBusy ||
                    (documentType !== 'PASSPORT' && !idBack) ||
                    fullName.trim().length < 3 ||
                    documentNumber.length < 4
                  }
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
                تفتح الكاميرا الأمامية ويبدأ التسجيل تلقائياً لمدة 7 ثوانٍ. تُحلل بيانات المستند تلقائياً بعد رفعه
                وتستعمل نتيجة الجودة أو المطابقة كمساعدة للمراجع؛ لا تعتمد الهوية تلقائياً.
              </p>
              <SecureCameraCapture
                title="فيديو الوجه لمدة 7 ثوانٍ"
                guidance="افتح الكاميرا الأمامية؛ يبدأ التسجيل تلقائياً وينتهي بعد 7 ثوانٍ. انظر للكاميرا وحرّك رأسك ببطء لليمين واليسار."
                mode="video"
                facingMode="user"
                cameraOnly
                file={faceVideo}
                onChange={setFaceVideo}
              />
              <label className="consent-box">
                <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
                <span>
                  أوافق صراحة على رفع المستند وفيديو الوجه للتدقيق البشري المخول والتحليل التلقائي المساعد لاستخراج
                  بيانات المستند.
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
                  <small>لا تُعرض صورة المستند الكاملة كصورة حساب، ويستمر المراجع البشري باتخاذ القرار.</small>
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
                  {busy ? 'جاري إرسال طلب المراجعة...' : 'إرسال للمراجعة'}
                </button>
              </div>
            </div>
          )}
          {step === 5 && (
            <div className="form-stage success-stage">
              <span className="success-seal">
                <FileCheck2 />
              </span>
              <h2>تم استلام طلب التحقق</h2>
              <p>
                وصل المستند وفيديو الوجه بشكل مشفّر إلى قائمة المراجعة، وحُفظت المرفقات وفق موافقتك. ستتحول الهوية إلى
                الحالة المناسبة بعد تدقيق الموظف المخول.
              </p>
              <div className="citizen-id-card">
                <Brand compact />
                <div>
                  <small>رقم طلب المراجعة</small>
                  <strong>{reviewId}</strong>
                  <span>
                    <CheckCircle2 /> فحص الجودة {screeningScore?.toLocaleString('en-US') || '—'}% — قيد المراجعة المخولة
                  </span>
                </div>
                <QrCode />
              </div>
              <div
                className={`face-comparison-result ${faceComparison?.status?.toLowerCase() || 'manual-review-required'}`}
              >
                <Fingerprint />
                <span>
                  <strong>
                    {faceComparison?.status === 'MATCH_ASSISTED'
                      ? 'ظهر تشابه تقني أولي بين صورة المستند وفيديو الوجه'
                      : faceComparison?.status === 'NO_MATCH_ASSISTED'
                        ? 'نتيجة التشابه تحتاج تدقيقاً إضافياً من المراجع'
                        : 'تم حفظ فيديو الوجه لمقارنته ضمن التدقيق المخول'}
                  </strong>
                  <small>
                    {faceComparison?.confidence !== null && faceComparison?.confidence !== undefined
                      ? `مؤشر التشابه التقني: ${(faceComparison.confidence * 100).toFixed(0)}% — القرار النهائي للمراجع المخول.`
                      : 'لا يصدر النظام قرار هوية أو رفضاً تلقائياً؛ تظهر الوسائط للمراجع المخول فقط.'}
                  </small>
                </span>
              </div>
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
      </main>
    </div>
  )
}
