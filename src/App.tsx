import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Route, Switch, useLocation } from 'wouter'
import { motion } from 'framer-motion'
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, Bell,
  BriefcaseBusiness, Building2, CalendarDays, Camera, Check, CheckCircle2,
  ChevronLeft, CircleDollarSign, Clock3, Download, Eye, FileArchive,
  FileCheck2, FileText, Fingerprint, Gauge, Headphones, Landmark, LockKeyhole,
  LogIn, Map, MapPin, Menu, MessageSquareWarning, MonitorCheck, Network,
  Phone, Plus, QrCode, ReceiptText, RefreshCw, Route as RouteIcon, Search,
  Send, ShieldCheck, Sparkles, UserRound, UsersRound, WalletCards, X,
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import QRCode from 'qrcode'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { api } from './api'
import { categoryIcons, defaultStats, formatIQD, services, statusLabels } from './data'
import type { Citizen, DashboardStats, GovernmentApplication } from './types'
import './App.css'

const reveal = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.15 },
  transition: { duration: 0.45 },
}

function DemoRibbon() {
  return <div className="demo-ribbon"><span className="demo-dot" />إصدار تشغيلي مرحلي — لا تعتمد أي وثيقة أو دفعة أو تحقق هوية قانونياً قبل اعتماد الجهة المختصة وربطها الرسمي</div>
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className="brand" aria-label="ذي قار الرقمية - الرئيسية"><img src="/brand/dhiqar-official-logo.jpg" alt="شعار ذي قار الرقمي الرسمي" />{!compact && <span><strong>ذي قار الرقمية</strong><small>THI QAR DIGITAL</small></span>}</Link>
}

function PublicHeader() {
  const [open, setOpen] = useState(false)
  return <><DemoRibbon /><header className="public-header"><div className="container nav-row"><Brand /><nav className={open ? 'nav-links is-open' : 'nav-links'}><Link href="/#services">الخدمات</Link><Link href="/citizen">حساب المواطن</Link><Link href="/operations">غرفة العمليات</Link><Link href="/login" className="nav-login"><LogIn size={17} /> دخول المنصة</Link></nav><button className="menu-button" onClick={() => setOpen(v => !v)} aria-label="القائمة">{open ? <X /> : <Menu />}</button></div></header></>
}

function Footer() {
  return <footer className="footer"><div className="container footer-grid"><div><Brand /><p>حضارة عمرها آلاف السنين، بحكومة رقمية للمستقبل.</p></div><div><strong>الوصول السريع</strong><Link href="/citizen">بوابة المواطن</Link><Link href="/employee">بوابة الموظف</Link><Link href="/operations">غرفة العمليات</Link></div><div><strong>الثقة والأمان</strong><span>الخصوصية حسب الغرض</span><span>تدقيق كامل للإجراءات</span><span>ذكاء اصطناعي مساعد لا يقرر منفرداً</span></div></div><div className="container footer-bottom"><span>© 2026 ذي قار الرقمية — بوابة خدمات تشغيلية</span><span>العربية • RTL • Mobile First</span></div></footer>
}

function LandingPage() {
  const categories = Object.entries(categoryIcons).slice(0, 8)
  const quickActions = [
    { icon: Plus, title: 'ابدأ معاملة', href: '/service/store-license' },
    { icon: Search, title: 'تابع معاملة', href: '/citizen' },
    { icon: MessageSquareWarning, title: 'قدّم شكوى', href: '/service/water-complaint' },
    { icon: WalletCards, title: 'ادفع رسوم', href: '/citizen' },
    { icon: QrCode, title: 'تحقق من وثيقة', href: '/verify' },
  ]
  return <div className="public-shell"><PublicHeader /><main>
    <section className="hero"><div className="hero-ambient hero-ambient-one" /><div className="hero-ambient hero-ambient-two" /><div className="container hero-grid"><motion.div className="hero-copy" {...reveal}><div className="eyebrow"><Sparkles size={16} /> منظومة تشغيل حكومي رقمية موحّدة</div><h1>حكومة ذي قار،<br /><em>أقرب إليك.</em></h1><p>حساب مواطن موحّد، خدمات واضحة، معاملات قابلة للمتابعة، وقرارات تشغيلية مبنية على بيانات مركزية ضمن منصة واحدة.</p><div className="smart-search"><div className="search-icon"><Sparkles size={21} /></div><div><small>شنو تحتاج اليوم؟</small><strong>اكتب مثلاً: أريد أفتح محل</strong></div><Link href="/service/store-license" className="search-submit"><ArrowLeft /></Link></div><div className="hero-trust"><span><ShieldCheck size={17} /> بياناتك محمية</span><span><BadgeCheck size={17} /> حساب قيد التحقق أو موثّق يدوياً</span><span><Eye size={17} /> تتبّع واضح</span></div></motion.div><motion.div className="hero-visual" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.65 }}><img src="/brand/ur-heritage-hero.jpg" alt="زقورة أور والهوية الحضارية لذي قار" /><div className="hero-glass-card"><span className="live-badge"><span /> النظام يعمل</span><strong>31 دائرة متصلة</strong><div className="mini-map"><span className="pulse p1" /><span className="pulse p2" /><span className="pulse p3" /></div><div className="hero-metric-row"><span>المعاملات اليوم <b>1,247</b></span><span>نسبة الإنجاز <b>89%</b></span></div></div><div className="civilization-line">أور القديمة <ArrowLeft size={15} /> ذي قار الرقمية</div></motion.div></div></section>
    <section className="quick-actions container">{quickActions.map(item => <Link href={item.href} className="quick-action" key={item.title}><span><item.icon /></span><strong>{item.title}</strong><ChevronLeft size={17} /></Link>)}</section>
    <section className="section container" id="services"><motion.div className="section-heading" {...reveal}><div><span className="section-kicker">الخدمات الحكومية</span><h2>لا تحتاج تعرف اسم الدائرة</h2></div><p>اختر حاجتك، والمنصة توجّهك تلقائياً إلى الخدمة والجهة المسؤولة والمتطلبات.</p></motion.div><div className="category-grid">{categories.map(([label, Icon], index) => <motion.a href="#featured-services" className="category-card" key={label} {...reveal} transition={{ delay: index * 0.03 }}><span><Icon /></span><strong>{label}</strong><small>عرض الخدمات</small></motion.a>)}</div></section>
    <section className="section section-ink" id="featured-services"><div className="container"><motion.div className="section-heading light" {...reveal}><div><span className="section-kicker">الأكثر استخداماً</span><h2>خدمات مصممة حول رحلة المواطن</h2></div><p>متطلبات واضحة قبل البدء، تعبئة تلقائية للبيانات الموثقة، ومسار مفهوم حتى إصدار الوثيقة.</p></motion.div><div className="service-grid">{services.slice(0, 3).map((service, index) => <motion.div className={index === 0 ? 'service-card featured' : 'service-card'} key={service.key} {...reveal}><div className="service-top"><span className="service-number">0{index + 1}</span><span className="service-category">{service.category}</span></div><h3>{service.title}</h3><p>{service.description}</p><div className="service-meta"><span><Clock3 /> {service.estimatedTime}</span><span><ReceiptText /> {service.fee ? formatIQD(service.fee) : 'مجانية'}</span></div><Link href={`/service/${service.key}`} className="service-link">ابدأ الخدمة <ArrowLeft /></Link></motion.div>)}</div></div></section>
    <section className="section container platform-story"><motion.div className="story-copy" {...reveal}><span className="section-kicker">حساب مواطن واحد</span><h2>من تأكيد الهوية إلى الوثيقة النهائية، بدون تكرار.</h2><p>المعلومات الموثقة تُملأ مرة واحدة وتُستخدم بأقل قدر لازم لكل خدمة. المواطن يعرف المطلوب منه الآن، والموظف يرى فقط ما تسمح به صلاحياته.</p><div className="story-steps">{['تحقق الهاتف', 'توثيق الهوية', 'اختيار الخدمة', 'تدقيق الموظف', 'الدفع والموافقة', 'وثيقة + QR'].map((step, i) => <span key={step}><b>{i + 1}</b>{step}</span>)}</div><Link href="/onboarding" className="button primary">أنشئ حسابك <ArrowLeft /></Link></motion.div><motion.div className="phone-mockup" {...reveal}><div className="phone-notch" /><div className="phone-header"><Brand compact /><span className="verified-chip"><BadgeCheck /> موثّق</span></div><div className="phone-greeting"><small>هلا مهاب،</small><strong>شنو تحتاج اليوم؟</strong></div><div className="phone-search"><Search /> ابحث عن خدمة</div><div className="phone-cards"><div><FileText /><span>معاملاتي</span><b>3</b></div><div><Bell /><span>الإشعارات</span><b>1</b></div></div><div className="phone-application"><span>إجازة فتح محل</span><strong>قيد التدقيق</strong><div className="progress"><i /></div><small>لا يوجد إجراء مطلوب منك</small></div></motion.div></section>
    <section className="section government-strip"><div className="container government-grid"><div><span className="section-kicker">للحكومة المحلية</span><h2>صورة تشغيلية واحدة للمحافظة</h2><p>GIS، أداء الدوائر، SLA، الشكاوى، التحصيل المالي، صحة الأنظمة، وسجل تدقيق غير قابل للحذف من واجهات المستخدم.</p><Link href="/operations" className="button glass">افتح غرفة العمليات <ArrowLeft /></Link></div><div className="gov-metrics"><span><Activity /><b>99.96%</b><small>جاهزية الأنظمة</small></span><span><Gauge /><b>78%</b><small>مستوى الأتمتة</small></span><span><CircleDollarSign /><b>128.7م</b><small>تحصيل اليوم د.ع</small></span><span><Network /><b>31/33</b><small>دوائر متصلة</small></span></div></div></section>
  </main><Footer /></div>
}

function LoginPage() {
  const options = [
    { icon: UserRound, title: 'دخول المواطن', text: 'برقم الهاتف والهوية الرقمية', href: '/onboarding', tone: 'citizen' },
    { icon: Building2, title: 'دخول الموظف', text: 'حساب حكومي + تحقق متعدد العوامل', href: '/employee', tone: 'employee' },
    { icon: MonitorCheck, title: 'غرفة العمليات', text: 'وصول مقيّد للإدارة التشغيلية', href: '/operations', tone: 'operations' },
  ]
  return <div className="login-page"><DemoRibbon /><div className="login-backdrop" /><div className="login-top container"><Brand /><Link href="/"><ArrowRight /> العودة للرئيسية</Link></div><main className="container login-content"><div className="login-intro"><span className="eyebrow"><LockKeyhole size={16} /> بوابات دخول منفصلة وآمنة</span><h1>اختر بوابة الدخول</h1><p>لا نخلط حسابات المواطنين بالحسابات الحكومية. كل بوابة لها سياساتها وصلاحياتها ومسار التحقق الخاص بها.</p></div><div className="login-options">{options.map(option => <Link href={option.href} className={`login-option ${option.tone}`} key={option.title}><span><option.icon /></span><div><h2>{option.title}</h2><p>{option.text}</p></div><ArrowLeft /></Link>)}</div><div className="security-note"><ShieldCheck /><div><strong>بنية ثقة صفرية</strong><span>الدخول وحده لا يمنح الوصول؛ كل إجراء حساس يحتاج صلاحية وغرضاً مسجلاً.</span></div></div></main></div>
}

type CaptureMode = 'photo' | 'video'

function SecureCameraCapture({
  title,
  guidance,
  mode,
  facingMode,
  allowPdf = false,
  file,
  onChange,
}: {
  title: string
  guidance: string
  mode: CaptureMode
  facingMode: 'user' | 'environment'
  allowPdf?: boolean
  file: File | null
  onChange: (file: File | null) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [cameraOpen, setCameraOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [cameraError, setCameraError] = useState('')

  const stopCamera = () => {
    recorderRef.current?.stop()
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    setCameraOpen(false)
    setRecording(false)
  }

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const setCapturedFile = (captured: File) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(captured))
    onChange(captured)
  }

  const openCamera = async () => {
    setCameraError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: mode === 'video',
      })
      streamRef.current = stream
      setCameraOpen(true)
      window.setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream }, 0)
    } catch {
      setCameraError('تعذر فتح الكاميرا. امنح الإذن للكاميرا أو استخدم رفع ملف من الهاتف.')
    }
  }

  const takePhoto = () => {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(blob => {
      if (blob) setCapturedFile(new File([blob], `${title}-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      stopCamera()
    }, 'image/jpeg', .9)
  }

  const startVideo = () => {
    const stream = streamRef.current
    if (!stream || typeof MediaRecorder === 'undefined') return setCameraError('تسجيل الفيديو غير مدعوم في هذا المتصفح. استخدم رفع فيديو قصير.')
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm'
    const recorder = new MediaRecorder(stream, { mimeType })
    chunksRef.current = []
    recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data) }
    recorder.onstop = () => {
      if (chunksRef.current.length) setCapturedFile(new File([new Blob(chunksRef.current, { type: 'video/webm' })], `face-video-${Date.now()}.webm`, { type: 'video/webm' }))
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
      setCameraOpen(false)
      setRecording(false)
    }
    recorderRef.current = recorder
    recorder.start()
    setRecording(true)
  }

  const stopVideo = () => recorderRef.current?.stop()

  const pickFile = (selected: File | undefined) => {
    if (!selected) return
    const accepted = mode === 'photo' ? (selected.type.startsWith('image/') || (allowPdf && selected.type === 'application/pdf')) : selected.type.startsWith('video/')
    if (!accepted) return setCameraError(mode === 'photo' ? 'اختر صورة للوثيقة فقط.' : 'اختر فيديو الوجه فقط.')
    if (selected.size > 20 * 1024 * 1024) return setCameraError('حجم الملف أكبر من 20 MB.')
    setCameraError('')
    setCapturedFile(selected)
  }

  return <div className="secure-capture">
    <input ref={inputRef} type="file" hidden accept={mode === 'photo' ? (allowPdf ? 'image/*,application/pdf' : 'image/*') : 'video/*'} capture={facingMode === 'environment' ? 'environment' : 'user'} onChange={event => pickFile(event.target.files?.[0])} />
    <div className="capture-head"><div><strong>{title}</strong><p>{guidance}</p></div>{file && <span className="capture-ready"><CheckCircle2 /> جاهز</span>}</div>
    {previewUrl && <div className="capture-preview">{mode === 'photo' ? file?.type === 'application/pdf' ? <div className="pdf-preview"><FileText /><strong>{file.name}</strong><small>PDF جاهز للرفع</small></div> : <img src={previewUrl} alt={title} /> : <video src={previewUrl} controls playsInline />}</div>}
    {cameraOpen && <div className="live-camera"><video ref={videoRef} autoPlay playsInline muted /><div className="live-camera-actions">{mode === 'photo' ? <button type="button" className="button primary" onClick={takePhoto}><Camera /> التقاط الصورة</button> : !recording ? <button type="button" className="button primary" onClick={startVideo}><Camera /> ابدأ فيديو قصير</button> : <button type="button" className="button danger" onClick={stopVideo}>إيقاف وحفظ الفيديو</button>}<button type="button" className="button ghost" onClick={stopCamera}>إلغاء</button></div></div>}
    <div className="capture-actions"><button type="button" className="button secondary" onClick={openCamera}><Camera /> {file ? 'إعادة التصوير' : 'فتح الكاميرا'}</button><button type="button" className="button ghost" onClick={() => inputRef.current?.click()}><FileText /> {mode === 'photo' ? 'رفع صورة' : 'رفع فيديو'}</button>{file && <button type="button" className="capture-remove" onClick={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(''); onChange(null) }}><RefreshCw /> مسح</button>}</div>
    {cameraError && <div className="capture-error"><AlertTriangle /> {cameraError}</div>}
  </div>
}

function OnboardingPage() {
  const [, navigate] = useLocation()
  const [step, setStep] = useState(1)
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [fullName, setFullName] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [idFront, setIdFront] = useState<File | null>(null)
  const [idBack, setIdBack] = useState<File | null>(null)
  const [faceVideo, setFaceVideo] = useState<File | null>(null)
  const [reviewId, setReviewId] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const requestOtp = async () => { setBusy(true); setMessage(''); setNotice(''); try { const challenge = await api.requestOtp(phone); setChallengeId(challenge.challengeId); setOtp(''); setNotice(`تم إرسال رمز لمرة واحدة إلى ${challenge.phoneMasked}. صالح لمدة 5 دقائق.`) } catch (e) { setMessage((e as Error).message) } finally { setBusy(false) } }
  const nextPhone = async () => { if (!challengeId) return setMessage('اطلب رمز التحقق أولاً.'); setBusy(true); setMessage(''); try { await api.verifyPhone(phone, challengeId, otp); setNotice(''); setStep(2) } catch (e) { setMessage((e as Error).message) } finally { setBusy(false) } }
  const finish = async () => { if (!consent) return setMessage('الموافقة الصريحة مطلوبة قبل إرسال الهوية والفيديو للمراجعة.'); if (!fullName || !nationalId || !idFront || !idBack || !faceVideo) return setMessage('أكمل الاسم والرقم وصور الهوية وفيديو الوجه قبل الإرسال.'); setBusy(true); setMessage(''); try { const review = await api.submitIdentityReview({ fullName, nationalId, consent, idFront, idBack, faceVideo }); setReviewId(review.id); setStep(5) } catch (e) { setMessage((e as Error).message) } finally { setBusy(false) } }
  const titles = ['الهاتف', 'الهوية', 'البيانات', 'فيديو الوجه', 'المراجعة']
  return <div className="onboarding-page"><DemoRibbon /><header className="onboarding-header container"><Brand /><span>إنشاء الهوية الرقمية</span><Link href="/login"><X /></Link></header><main className="container onboarding-layout"><aside className="onboarding-aside"><span className="section-kicker">DIGITAL CITIZEN ONBOARDING</span><h1>حسابك الحكومي يبدأ من هوية موثوقة.</h1><p>رحلة تحقق تدريجية ومفهومة، مع أقل قدر مطلوب من البيانات ومراجعة يدوية للحالات غير المؤكدة.</p><div className="privacy-card"><ShieldCheck /><div><strong>خصوصيتك جزء من التصميم</strong><span>تُحفظ مرفقات الهوية وفيديو الوجه بتشفير وعلى نطاق مراجعة محدد، ولا يصدر قرار تلقائي من الكاميرا وحدها.</span></div></div></aside><section className="onboarding-panel"><div className="stepper">{titles.map((title, index) => <div className={step > index + 1 ? 'done' : step === index + 1 ? 'active' : ''} key={title}><span>{step > index + 1 ? <Check /> : index + 1}</span><small>{title}</small></div>)}</div>
  {step === 1 && <div className="form-stage"><span className="stage-icon"><Phone /></span><h2>تأكيد رقم الهاتف</h2><p>سنرسل رمزاً حقيقياً لمرة واحدة عبر WhatsApp أو Telegram أو SMS مع تحويل تلقائي حسب التوفر.</p><label>رقم الهاتف العراقي<input value={phone} onChange={e => { setPhone(e.target.value); setChallengeId(''); setOtp(''); setNotice('') }} inputMode="tel" autoComplete="tel" placeholder="07XXXXXXXXX" /></label>{!challengeId ? <button className="button primary full" onClick={requestOtp} disabled={busy || phone.length < 10}>{busy ? 'جاري الإرسال...' : 'إرسال رمز التحقق'}</button> : <><label>رمز التحقق<input value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6 digits" /></label><button className="button primary full" onClick={nextPhone} disabled={busy || otp.length !== 6}>{busy ? 'جاري التحقق...' : 'تأكيد الهاتف'}</button><button className="button ghost full" onClick={requestOtp} disabled={busy}>إعادة إرسال الرمز</button></>}</div>}
  {step === 2 && <div className="form-stage"><span className="stage-icon"><Camera /></span><h2>صوّر وجه الهوية الوطنية</h2><p>افتح كاميرا الهاتف وصوّر وجه البطاقة كاملاً في إضاءة واضحة، أو ارفع صورة موجودة على الجهاز.</p><SecureCameraCapture title="وجه الهوية الوطنية" guidance="أظهر الحواف الأربع للبطاقة وتجنب الوهج أو الظلال." mode="photo" facingMode="environment" file={idFront} onChange={setIdFront} /><button className="button primary full" onClick={() => setStep(3)} disabled={!idFront}>متابعة <ArrowLeft /></button></div>}
  {step === 3 && <div className="form-stage"><span className="stage-icon"><FileCheck2 /></span><h2>أكمل بيانات الهوية</h2><p>لا يُعرض الرقم الوطني كاملاً للموظفين داخل القوائم. أدخل البيانات كما تظهر في البطاقة لإرسالها للمراجعة.</p><SecureCameraCapture title="ظهر الهوية الوطنية" guidance="صوّر الجهة الخلفية للبطاقة بوضوح أو ارفع الصورة من الهاتف." mode="photo" facingMode="environment" file={idBack} onChange={setIdBack} /><label>الاسم الكامل<input value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" placeholder="الاسم كما في الهوية" /></label><label>الرقم الوطني<input value={nationalId} onChange={e => setNationalId(e.target.value.replace(/\D/g, '').slice(0, 20))} inputMode="numeric" placeholder="رقم الهوية" /></label><button className="button primary full" onClick={() => setStep(4)} disabled={!idBack || fullName.trim().length < 3 || nationalId.length < 4}>متابعة <ArrowLeft /></button></div>}
  {step === 4 && <div className="form-stage"><span className="stage-icon"><Fingerprint /></span><h2>سجّل فيديو الوجه القصير</h2><p>استخدم الكاميرا الأمامية وسجّل فيديو قصيراً للوجه. سيصل إلى موظف المراجعة ولا يُعتبر تحقق حيوية أو قرار قبول آلياً.</p><SecureCameraCapture title="فيديو الوجه" guidance="انظر للكاميرا وحرك رأسك ببطء لليمين واليسار خلال 3–8 ثوانٍ." mode="video" facingMode="user" file={faceVideo} onChange={setFaceVideo} /><label className="consent-box"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>أوافق صراحة على رفع صور الهوية وفيديو الوجه للتدقيق اليدوي، وأفهم أن الاحتفاظ بها ينتهي بعد المراجعة أو خلال 7 أيام كحد أقصى.</span></label><button className="button primary full" onClick={finish} disabled={busy || !faceVideo || !consent}>{busy ? 'جاري إرسال طلب المراجعة...' : 'إرسال للمراجعة'}</button></div>}
  {step === 5 && <div className="form-stage success-stage"><span className="success-seal"><FileCheck2 /></span><h2>تم استلام طلب التحقق</h2><p>وصلت صور الهوية وفيديو الوجه بشكل مشفّر إلى قائمة المراجعة. ستتحول الهوية إلى الحالة المناسبة بعد تدقيق الموظف المخول.</p><div className="citizen-id-card"><Brand compact /><div><small>رقم طلب المراجعة</small><strong>{reviewId}</strong><span><Clock3 /> قيد المراجعة البشرية</span></div><QrCode /></div><button className="button primary full" onClick={() => navigate('/citizen')}>الدخول إلى حسابي <ArrowLeft /></button></div>}
  {notice && <div className="form-success"><CheckCircle2 /> {notice}</div>}{message && <div className="form-error"><AlertTriangle /> {message}</div>}</section></main></div>
}

const citizenNav = [
  { icon: Gauge, label: 'الرئيسية', href: '/citizen' }, { icon: FileText, label: 'معاملاتي', href: '/citizen' },
  { icon: FileArchive, label: 'وثائقي', href: '/citizen' }, { icon: WalletCards, label: 'مدفوعاتي', href: '/citizen' },
  { icon: MessageSquareWarning, label: 'شكاواي', href: '/citizen' }, { icon: CalendarDays, label: 'مواعيدي', href: '/citizen' },
]

function PortalLayout({ children, role = 'citizen' }: { children: React.ReactNode; role?: 'citizen' | 'employee' }) {
  const [mobileNav, setMobileNav] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchResults = useMemo(() => {
    const term = searchQuery.trim().toLowerCase()
    if (!term) return []
    return services.filter(service => `${service.title} ${service.department} ${service.category} ${service.description}`.toLowerCase().includes(term)).slice(0, 6)
  }, [searchQuery])
  const nav = role === 'citizen' ? citizenNav : [
    { icon: Gauge, label: 'لوحة العمل', href: '/employee' }, { icon: FileText, label: 'المعاملات', href: '/employee' },
    { icon: CalendarDays, label: 'الكشوفات', href: '/employee' }, { icon: FileArchive, label: 'الأرشيف', href: '/employee' },
    { icon: Activity, label: 'سجل الإجراءات', href: '/employee' },
  ]
  return <div className="portal-shell"><DemoRibbon /><aside className={mobileNav ? 'portal-sidebar open' : 'portal-sidebar'}><div className="sidebar-brand"><Brand /><button onClick={() => setMobileNav(false)}><X /></button></div><div className="role-chip">{role === 'citizen' ? <UserRound /> : <Building2 />} {role === 'citizen' ? 'بوابة المواطن' : 'بوابة الموظف'}</div><nav>{nav.map((item, index) => <Link href={item.href} className={index === 0 ? 'active' : ''} key={item.label}><item.icon /> {item.label}</Link>)}</nav><div className="sidebar-security"><ShieldCheck /><span>جلسة محمية</span><small>آخر نشاط: الآن</small></div><Link href="/login" className="sidebar-logout"><LogIn /> تبديل البوابة</Link></aside><div className="portal-main"><header className="portal-topbar"><button className="mobile-sidebar-button" onClick={() => setMobileNav(true)}><Menu /></button><div className="topbar-search"><Search /><input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="ابحث عن خدمة أو دائرة" aria-label="ابحث داخل المنصة" />{!searchQuery && <kbd>⌘ K</kbd>}{searchResults.length > 0 && <div className="topbar-search-results">{searchResults.map(service => <Link href={`/service/${service.key}`} key={service.key} onClick={() => setSearchQuery('')}><span><BriefcaseBusiness /></span><div><strong>{service.title}</strong><small>{service.department} • {service.category}</small></div><ArrowLeft /></Link>)}</div>}</div><div className="topbar-actions"><button><Bell /><i>1</i></button><div className="user-avatar">مي</div><div><strong>{role === 'citizen' ? 'مهاب علي ياسين' : 'سارة كاظم حسن'}</strong><small>{role === 'citizen' ? 'مواطن موثّق' : 'موظفة تدقيق — بلدية الناصرية'}</small></div></div></header><main className="portal-content">{children}</main></div></div>
}

function CitizenDashboard() {
  const [citizen, setCitizen] = useState<Citizen | null>(null)
  const [applications, setApplications] = useState<GovernmentApplication[]>([])
  useEffect(() => { api.getDemoCitizen().then(setCitizen); api.listApplications().then(setApplications) }, [])
  return <PortalLayout><section className="dashboard-welcome"><div><span className="verified-chip"><BadgeCheck /> هوية موثّقة تجريبياً</span><h1>هلا {citizen?.fullName?.split(' ')[0] || 'مهاب'}، شنو تحتاج اليوم؟</h1><p>ابدأ خدمة جديدة أو تابع ما يحتاج تدخلك الآن.</p></div><Link href="/service/store-license" className="button primary"><Plus /> ابدأ معاملة</Link></section><div className="ai-service-search"><span><Sparkles /></span><div><small>مساعد الخدمات الذكي</small><strong>اكتب حاجتك باللهجة العراقية أو العربية</strong></div><button>اسأل الآن <ArrowLeft /></button></div><section className="citizen-summary-grid"><div className="summary-card attention"><span><Bell /></span><div><small>المطلوب منك الآن</small><strong>{applications.some(app => app.status === 'ACTION_REQUIRED') ? 'يرجى رفع مستند ناقص' : 'لا يوجد إجراء مطلوب منك'}</strong></div></div><div className="summary-card"><span><FileText /></span><div><small>المعاملات الجارية</small><strong>{applications.filter(a => a.status !== 'APPROVED').length}</strong></div></div><div className="summary-card"><span><FileCheck2 /></span><div><small>الوثائق الصادرة</small><strong>{applications.filter(a => a.status === 'APPROVED').length}</strong></div></div><div className="summary-card"><span><WalletCards /></span><div><small>المدفوعات</small><strong>{formatIQD(applications.reduce((s, a) => s + (a.paymentStatus === 'PAID' ? a.fee : 0), 0))}</strong></div></div></section><section className="dashboard-section"><div className="dashboard-section-title"><div><h2>معاملاتي</h2><p>حالة واضحة وما يجب فعله الآن.</p></div><Link href="/service/store-license">خدمة جديدة <Plus /></Link></div><div className="application-list">{applications.length === 0 ? <div className="empty-state"><FileText /><h3>لا توجد معاملات بعد</h3><p>ابدأ خدمة إجازة محل لإرسال طلبك ومرفقاتك إلى الدائرة المختصة.</p><Link className="button primary" href="/service/store-license">ابدأ إجازة محل</Link></div> : applications.map(app => <Link href={`/citizen/application/${app.reference}`} className="application-row" key={app.reference}><div className="application-icon"><BriefcaseBusiness /></div><div className="application-main"><div><strong>{app.serviceName}</strong><span className={`status ${app.status.toLowerCase()}`}>{statusLabels[app.status]}</span></div><small>{app.reference} • {app.department}</small><p>{app.currentAction}</p></div><ChevronLeft /></Link>)}</div></section><section className="dashboard-section"><div className="dashboard-section-title"><div><h2>خدمات سريعة</h2><p>الأكثر استخداماً في منطقتك.</p></div></div><div className="portal-service-grid">{services.map(service => <Link href={`/service/${service.key}`} key={service.key}><span><BriefcaseBusiness /></span><strong>{service.title}</strong><small>{service.department}</small><ArrowLeft /></Link>)}</div></section></PortalLayout>
}

function ServiceFormPage({ serviceKey }: { serviceKey: string }) {
  const [, navigate] = useLocation(); const service = services.find(item => item.key === serviceKey) || services[0]
  const [ownership, setOwnership] = useState('rent'); const [coords, setCoords] = useState({ lat: 31.045, lng: 46.258 })
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [propertyDocument, setPropertyDocument] = useState<File | null>(null); const [storefrontPhoto, setStorefrontPhoto] = useState<File | null>(null)
  const submit = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); if (service.key === 'store-license' && (!propertyDocument || !storefrontPhoto)) return setError(`صوّر أو ارفع ${ownership === 'rent' ? 'عقد الإيجار' : 'سند الملكية'} وصورة واجهة المحل أولاً.`); setBusy(true); setError(''); const form = new FormData(event.currentTarget); try { const app = await api.createApplicationWithFiles({ serviceKey: service.key, serviceName: service.title, department: service.department, businessName: String(form.get('businessName') || ''), activityType: String(form.get('activityType') || ''), address: String(form.get('address') || ''), district: String(form.get('district') || ''), ownershipType: ownership, coordinates: coords, fee: service.fee, propertyDocument, storefrontPhoto }); navigate(`/citizen/application/${app.reference}`) } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  return <PortalLayout><div className="service-form-header"><Link href="/citizen"><ArrowRight /> الرجوع</Link><span>خدمة رقمية</span><h1>{service.title}</h1><p>{service.description}</p><div><span><Building2 /> {service.department}</span><span><Clock3 /> {service.estimatedTime}</span><span><ReceiptText /> {service.fee ? formatIQD(service.fee) : 'مجانية'}</span></div></div><form className="service-form-layout" onSubmit={submit}><div className="service-form-main"><section className="form-card"><div className="form-card-title"><span>1</span><div><h2>بيانات المواطن</h2><p>تعبئة تلقائية من ملفك الموثق؛ لا يمكن تعديل بيانات الهوية هنا.</p></div></div><div className="verified-profile"><div className="profile-avatar">مي</div><div><small>الاسم الكامل</small><strong>مهاب علي ياسين <BadgeCheck /></strong></div><div><small>الرقم الوطني</small><strong>********** 4821</strong></div><span>موثّق</span></div></section><section className="form-card"><div className="form-card-title"><span>2</span><div><h2>بيانات المحل</h2><p>أدخل المعلومات التشغيلية للخدمة.</p></div></div><div className="form-grid"><label>نوع النشاط<select name="activityType" defaultValue="متجر إلكترونيات"><option>متجر إلكترونيات</option><option>مطعم</option><option>مكتب خدمات</option><option>ورشة</option></select></label><label>اسم المحل<input name="businessName" defaultValue="متجر أور للتقنيات" required /></label><label className="wide">العنوان التفصيلي<input name="address" defaultValue="شارع الحبوبي، قرب جسر الزيتون" required /></label><label>القضاء<select name="district" defaultValue="الناصرية"><option>الناصرية</option><option>الشطرة</option><option>سوق الشيوخ</option><option>الرفاعي</option></select></label><div className="ownership-field"><span>صفة إشغال العقار</span><div><button type="button" className={ownership === 'rent' ? 'active' : ''} onClick={() => setOwnership('rent')}>إيجار</button><button type="button" className={ownership === 'owned' ? 'active' : ''} onClick={() => setOwnership('owned')}>ملك</button></div></div></div></section><section className="form-card"><div className="form-card-title"><span>3</span><div><h2>موقع المحل</h2><p>حدده على الخريطة لتوجيه الكشف إلى الفريق الصحيح.</p></div></div><div className="location-picker" onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setCoords({ lat: 31.02 + (1 - (event.clientY - rect.top) / rect.height) * 0.06, lng: 46.22 + ((event.clientX - rect.left) / rect.width) * 0.08 }) }}><div className="map-grid-lines" /><span className="map-river" /><div className="map-pin-selected" style={{ left: `${((coords.lng - 46.22) / 0.08) * 100}%`, top: `${(1 - (coords.lat - 31.02) / 0.06) * 100}%` }}><MapPin /></div><span className="map-label l1">مركز الناصرية</span><span className="map-label l2">نهر الفرات</span></div><div className="coordinate-row"><span>خط العرض: {coords.lat.toFixed(5)}</span><span>خط الطول: {coords.lng.toFixed(5)}</span><span><CheckCircle2 /> تم تحديد الموقع</span></div></section><section className="form-card"><div className="form-card-title"><span>4</span><div><h2>المستندات</h2><p>تتغير المتطلبات تلقائياً بحسب صفة الإشغال ونوع النشاط.</p></div></div><div className="service-document-captures"><SecureCameraCapture title={ownership === 'rent' ? 'عقد الإيجار' : 'سند الملكية'} guidance="صوّر المستند كاملاً من الكاميرا أو ارفع صورة / PDF واضحاً." mode="photo" facingMode="environment" allowPdf file={propertyDocument} onChange={setPropertyDocument} /><SecureCameraCapture title="صورة واجهة المحل" guidance="التقط صورة حديثة من كاميرا الهاتف يظهر فيها مدخل المحل واللافتة إن وجدت." mode="photo" facingMode="environment" file={storefrontPhoto} onChange={setStorefrontPhoto} /></div></section></div><aside className="service-form-aside"><div className="form-summary"><h3>ملخص الطلب</h3><div><span>الخدمة</span><strong>{service.title}</strong></div><div><span>الجهة</span><strong>{service.department}</strong></div><div><span>مدة الإنجاز</span><strong>{service.estimatedTime}</strong></div><div><span>الرسم</span><strong>{service.fee ? formatIQD(service.fee) : 'مجانية'}</strong></div><hr /><p><ShieldCheck /> تُحفظ مرفقات الطلب مشفرة وتُوجّه للدائرة المختصة. تبقى عملية الدفع معلقة إلى حين تهيئة بوابة دفع معتمدة.</p><button className="button primary full" type="submit" disabled={busy}>{busy ? 'جاري الإرسال...' : 'إرسال المعاملة'} <Send /></button>{error && <div className="form-error"><AlertTriangle /> {error}</div>}</div></aside></form></PortalLayout>
}

function ApplicationPage({ reference }: { reference: string }) {
  const [app, setApp] = useState<GovernmentApplication | null>(null); const [busy, setBusy] = useState(false); const [qr, setQr] = useState(''); const [missingDocument, setMissingDocument] = useState<File | null>(null); const docRef = useRef<HTMLDivElement>(null)
  const refresh = () => api.getApplication(reference).then(setApp)
  useEffect(() => { void api.getApplication(reference).then(setApp) }, [reference]); useEffect(() => { if (app?.verificationId) QRCode.toDataURL(`${window.location.origin}/verify/${app.verificationId}`, { width: 220, margin: 1, color: { dark: '#073b24', light: '#ffffff' } }).then(setQr) }, [app?.verificationId])
  const upload = async () => { if (!app || !missingDocument) return; setBusy(true); try { await api.uploadMissingDocument(app.reference, app.requiredDocument || 'المستند المطلوب', missingDocument); setMissingDocument(null); await refresh() } finally { setBusy(false) } }
  const downloadPdf = async () => { if (!docRef.current || !app) return; const canvas = await html2canvas(docRef.current, { scale: 2, backgroundColor: '#fff' }); const img = canvas.toDataURL('image/jpeg', .95); const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }); const width = 190; const height = canvas.height * width / canvas.width; pdf.addImage(img, 'JPEG', 10, 10, width, Math.min(height, 277)); pdf.save(`${app.documentNumber || app.reference}.pdf`) }
  if (!app) return <PortalLayout><div className="loading-state"><RefreshCw className="spin" /> جاري تحميل المعاملة...</div></PortalLayout>
  return <PortalLayout><div className="application-detail-header"><Link href="/citizen"><ArrowRight /> معاملاتي</Link><div><div><span className={`status ${app.status.toLowerCase()}`}>{statusLabels[app.status]}</span><span>{app.reference}</span></div><h1>{app.serviceName}</h1><p>{app.department} • تم التقديم {new Date(app.createdAt).toLocaleDateString('en-GB')}</p></div></div><section className={app.status === 'ACTION_REQUIRED' ? 'current-action warning' : app.status === 'APPROVED' ? 'current-action success' : 'current-action'}><span>{app.status === 'ACTION_REQUIRED' ? <AlertTriangle /> : app.status === 'APPROVED' ? <BadgeCheck /> : <Clock3 />}</span><div><small>المطلوب منك الآن</small><strong>{app.currentAction}</strong></div>{app.status === 'ACTION_REQUIRED' && <button className="button primary" onClick={upload} disabled={busy}>{busy ? 'جاري الرفع...' : `رفع ${app.requiredDocument}`} <Plus /></button>}</section>{app.status === 'ACTION_REQUIRED' && <section className="missing-document-capture"><div><span className="section-kicker">مستند مطلوب</span><h2>{app.requiredDocument}</h2><p>افتح كاميرا الهاتف وصوّر المستند كاملاً، أو ارفع صورة / PDF واضحاً. لا تُعاد المعاملة للموظف إلا بعد رفع ملف فعلي.</p></div><SecureCameraCapture title={app.requiredDocument || 'المستند المطلوب'} guidance="تأكد أن كامل المستند واضح وقابل للقراءة قبل الإرسال." mode="photo" facingMode="environment" allowPdf file={missingDocument} onChange={setMissingDocument} /><button className="button primary" onClick={upload} disabled={busy || !missingDocument}>{busy ? 'جاري رفع المستند...' : 'إرسال المستند للموظف'} <Send /></button></section>}<div className="application-detail-grid"><section className="timeline-card"><h2>رحلة المعاملة</h2><div className="timeline">{app.events.map((event, index) => <div className="timeline-item" key={event.id}><span className="timeline-dot">{index === 0 || index === app.events.length - 1 ? <Check /> : index + 1}</span><div><div><strong>{event.title}</strong><time>{new Date(event.createdAt).toLocaleString('en-GB')}</time></div><p>{event.description}</p><small>{event.actor}</small></div></div>)}</div></section><aside className="detail-aside"><div><h3>بيانات الطلب</h3><span><small>اسم المحل</small><strong>{app.businessName}</strong></span><span><small>النشاط</small><strong>{app.activityType}</strong></span><span><small>العنوان</small><strong>{app.address}</strong></span><span><small>الرسم</small><strong>{formatIQD(app.fee)} — {app.paymentStatus === 'PAID' ? 'مدفوع' : 'بانتظار الموافقة'}</strong></span></div><div className="support-card"><Headphones /><strong>تحتاج مساعدة؟</strong><p>تواصل مع مركز دعم المواطنين مع ذكر رقم المعاملة.</p><button>اتصل بالدعم</button></div></aside></div>{app.status === 'APPROVED' && <section className="issued-document-section"><div className="issued-document-heading"><div><span className="section-kicker">الوثيقة النهائية</span><h2>تم إصدار إجازة المحل</h2><p>وثيقة رقمية قابلة للتحقق عبر QR ومعرّف مستقل داخل المنصة.</p></div><button className="button primary" onClick={downloadPdf}><Download /> تحميل PDF</button></div><div className="official-document" ref={docRef}><div className="document-watermark">DIGITAL</div><div className="document-header"><img src="/brand/dhiqar-official-logo.jpg" /><div><strong>جمهورية العراق</strong><span>محافظة ذي قار — بلدية الناصرية</span><b>تتطلب هذه الوثيقة اعتماد الجهة المختصة لتُعد نافذة خارج المنصة</b></div><div className="doc-number"><small>رقم الوثيقة</small><strong>{app.documentNumber}</strong></div></div><hr /><h2>إجازة ممارسة نشاط تجاري</h2><p>تسجل منصة ذي قار الرقمية اكتمال مسار المعاملة المبين أدناه وإصدار نسخة رقمية قابلة للتحقق داخل المنصة.</p><div className="document-data"><span><small>اسم صاحب الطلب</small><strong>{app.citizenName}</strong></span><span><small>اسم المحل</small><strong>{app.businessName}</strong></span><span><small>نوع النشاط</small><strong>{app.activityType}</strong></span><span><small>العنوان</small><strong>{app.address}</strong></span><span><small>رقم المعاملة</small><strong>{app.reference}</strong></span><span><small>تاريخ الإصدار</small><strong>{new Date(app.updatedAt).toLocaleDateString('en-GB')}</strong></span></div><div className="document-footer"><div><strong>مدير البلدية</strong><span>توقيع إلكتروني قيد اعتماد الجهة</span></div><div className="verification-box">{qr && <img src={qr} />}<span><b>تحقق من الوثيقة</b><small>{app.verificationId}</small></span></div></div></div></section>}</PortalLayout>
}

function IdentityReviewPanel() {
  type Review = { id: string; status: string; citizenName: string; phoneMasked: string; nationalIdMasked: string; consentAt: string; submittedAt: string; retentionUntil: string; notes: string | null; media: Array<{ id: string; label: string; mimeType: string; sizeBytes: number }> }
  const [accessCode, setAccessCode] = useState('')
  const [reviews, setReviews] = useState<Review[]>([])
  const [selected, setSelected] = useState<Review | null>(null)
  const [mediaUrls, setMediaUrls] = useState<Record<string, { url: string; mimeType: string }>>({})
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => { setBusy(true); setError(''); try { const items = await api.listIdentityReviews(accessCode); setReviews(items); setSelected(current => items.find(item => item.id === current?.id) || items[0] || null) } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  const openMedia = async (mediaId: string) => { if (mediaUrls[mediaId]) return; try { const item = await api.loadReviewMedia(mediaId, accessCode); setMediaUrls(current => ({ ...current, [mediaId]: item })) } catch (e) { setError((e as Error).message) } }
  const decide = async (decision: 'APPROVED' | 'REJECTED' | 'NEEDS_RESUBMISSION') => { if (!selected) return; setBusy(true); setError(''); try { await api.decideIdentityReview(selected.id, accessCode, { decision, notes }); Object.values(mediaUrls).forEach(item => URL.revokeObjectURL(item.url)); setMediaUrls({}); setNotes(''); await load() } catch (e) { setError((e as Error).message); setBusy(false) } }
  const labels: Record<string, string> = { PENDING_REVIEW: 'بانتظار المراجعة', APPROVED: 'مقبول يدوياً', REJECTED: 'مرفوض', NEEDS_RESUBMISSION: 'مطلوب إعادة الرفع' }
  return <section className="identity-review-admin"><div className="identity-review-head"><div><span className="section-kicker">مراجعة الهوية والوسائط</span><h2>ملفات الهوية والفيديو</h2><p>تُفتح المرفقات بتفويض مستقل، وتُسجل المشاهدة والقرار، ثم تُحذف الوسائط عند اكتمال المراجعة.</p></div><div className="review-access"><input type="password" value={accessCode} onChange={e => setAccessCode(e.target.value)} placeholder="رمز دخول المراجع" autoComplete="off" /><button className="button primary" onClick={load} disabled={busy || accessCode.length < 8}>{busy ? 'جاري الفتح...' : 'فتح قائمة المراجعة'}</button></div></div>{error && <div className="form-error"><AlertTriangle /> {error}</div>}{reviews.length > 0 && <div className="identity-review-grid"><div className="identity-review-list">{reviews.map(review => <button key={review.id} className={selected?.id === review.id ? 'identity-review-row selected' : 'identity-review-row'} onClick={() => { setSelected(review); setNotes(review.notes || '') }}><span className={review.status === 'PENDING_REVIEW' ? 'review-status pending' : 'review-status'}>{labels[review.status] || review.status}</span><strong>{review.citizenName}</strong><small>{review.nationalIdMasked} • {review.phoneMasked}</small><time>{new Date(review.submittedAt).toLocaleString('en-GB')}</time></button>)}</div><div className="identity-review-detail">{selected && <><div className="review-citizen-title"><div><span className="review-status pending">{labels[selected.status] || selected.status}</span><h3>{selected.citizenName}</h3><p>{selected.nationalIdMasked} • {selected.phoneMasked}</p></div><small>حذف تلقائي: {new Date(selected.retentionUntil).toLocaleString('en-GB')}</small></div><div className="review-media-grid">{selected.media.map(media => <article key={media.id} className="review-media-card"><div><span><FileArchive /></span><strong>{media.label}</strong><small>{media.mimeType} • {(media.sizeBytes / 1024).toFixed(1)} KB</small></div>{mediaUrls[media.id] ? mediaUrls[media.id].mimeType.startsWith('video/') ? <video src={mediaUrls[media.id].url} controls playsInline /> : <img src={mediaUrls[media.id].url} alt={media.label} /> : <button className="button outline" onClick={() => openMedia(media.id)}><Eye /> فتح الوسيط</button>}</article>)}</div>{selected.status === 'PENDING_REVIEW' && <><label className="review-notes">ملاحظة المراجع<textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} placeholder="اكتب ملاحظة القرار أو سبب طلب إعادة الرفع" /></label><div className="review-actions identity-decisions"><button className="button outline danger" onClick={() => decide('REJECTED')} disabled={busy}>رفض</button><button className="button outline" onClick={() => decide('NEEDS_RESUBMISSION')} disabled={busy}>طلب إعادة الرفع</button><button className="button primary" onClick={() => decide('APPROVED')} disabled={busy}><CheckCircle2 /> اعتماد يدوي وحذف الوسائط</button></div></>}</>}</div></div>}</section>
}

function EmployeeDashboard() {
  const [apps, setApps] = useState<GovernmentApplication[]>([]); const [selected, setSelected] = useState<GovernmentApplication | null>(null); const [busy, setBusy] = useState(false)
  const load = () => api.listApplications().then(items => { setApps(items); if (!selected || !items.find(a => a.reference === selected.reference)) setSelected(items[0] || null); else setSelected(items.find(a => a.reference === selected.reference) || null) })
  useEffect(() => { void load() }, []); const act = async (kind: 'request' | 'approve') => { if (!selected) return; setBusy(true); if (kind === 'request') await api.requestDocument(selected.reference, 'عقد الإيجار المحدّث'); else await api.approveApplication(selected.reference); await load(); setBusy(false) }
  return <PortalLayout role="employee"><section className="employee-heading"><div><span>الثلاثاء، 26 آب 2026</span><h1>صباح الخير، سارة</h1><p>لديك {apps.filter(a => a.status !== 'APPROVED').length} معاملات تحتاج مراجعة اليوم.</p></div><button className="button outline"><RefreshCw /> تحديث قائمة العمل</button></section><section className="employee-kpis"><div><span className="blue"><FileText /></span><small>جديدة</small><strong>{apps.filter(a => a.status === 'SUBMITTED').length}</strong></div><div><span className="green"><Eye /></span><small>قيد التدقيق</small><strong>{apps.filter(a => a.status === 'UNDER_REVIEW').length}</strong></div><div><span className="amber"><Bell /></span><small>بانتظار المواطن</small><strong>{apps.filter(a => a.status === 'ACTION_REQUIRED').length}</strong></div><div><span className="red"><Clock3 /></span><small>متأخرة</small><strong>0</strong></div></section><div className="employee-workspace"><section className="work-queue"><div className="queue-toolbar"><div><h2>قائمة المعاملات</h2><span>{apps.length} نتيجة</span></div><button><Search /></button></div>{apps.length === 0 ? <div className="empty-queue"><FileText /><p>لا توجد معاملات. قدّم طلباً من بوابة المواطن أولاً.</p></div> : apps.map(app => <button className={selected?.reference === app.reference ? 'queue-item selected' : 'queue-item'} key={app.reference} onClick={() => setSelected(app)}><div><strong>{app.serviceName}</strong><span className={`status ${app.status.toLowerCase()}`}>{statusLabels[app.status]}</span></div><small>{app.reference} • {app.citizenName}</small><p>{app.currentAction}</p><time>{new Date(app.updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time></button>)}</section><section className="review-panel">{selected ? <><div className="review-header"><div><span className={`status ${selected.status.toLowerCase()}`}>{statusLabels[selected.status]}</span><h2>{selected.serviceName}</h2><p>{selected.reference}</p></div><button><FileArchive /></button></div><div className="citizen-access-notice"><ShieldCheck /><span><strong>وصول حسب الحاجة الوظيفية</strong><small>بيانات الهوية الحساسة مخفية، وتم تسجيل فتح المعاملة في سجل التدقيق.</small></span></div><div className="review-section"><h3>بيانات المواطن</h3><div className="review-data-grid"><span><small>الاسم</small><strong>{selected.citizenName} <BadgeCheck /></strong></span><span><small>الرقم الوطني</small><strong>********** 4821</strong></span><span><small>القضاء</small><strong>{selected.district}</strong></span><span><small>حالة الهوية</small><strong>VERIFIED — DEMO</strong></span></div></div><div className="review-section"><h3>بيانات النشاط</h3><div className="review-data-grid"><span><small>المحل</small><strong>{selected.businessName}</strong></span><span><small>النشاط</small><strong>{selected.activityType}</strong></span><span className="wide"><small>العنوان</small><strong>{selected.address}</strong></span></div></div><div className="review-section"><h3>المستندات</h3><div className="review-document"><FileText /><div><strong>عقد الإيجار.pdf</strong><small>PDF • فحص خلو من البرمجيات: ناجح</small></div><button><Eye /></button></div></div><div className="review-actions"><button className="button outline danger" onClick={() => act('request')} disabled={busy}><Bell /> طلب مستند</button><button className="button primary" onClick={() => act('approve')} disabled={busy || selected.status === 'ACTION_REQUIRED' || selected.status === 'APPROVED'}><CheckCircle2 /> {selected.status === 'APPROVED' ? 'تمت الموافقة' : 'موافقة وإصدار الوثيقة'}</button></div></> : <div className="empty-queue"><FileText /><p>اختر معاملة لبدء التدقيق.</p></div>}</section></div><IdentityReviewPanel /></PortalLayout>
}

function OperationsShell({ children, active = 'operations' }: { children: React.ReactNode; active?: string }) {
  return <div className="ops-shell"><DemoRibbon /><aside className="ops-sidebar"><Brand compact /><nav><Link href="/operations" className={active === 'operations' ? 'active' : ''}><Map /><span>غرفة العمليات</span></Link><Link href="/governor" className={active === 'governor' ? 'active' : ''}><Landmark /><span>لوحة المحافظ</span></Link><a><Building2 /><span>الدوائر</span></a><a><CircleDollarSign /><span>المالية</span></a><a><MessageSquareWarning /><span>الشكاوى</span></a><a><Activity /><span>صحة النظام</span></a><a><FileArchive /><span>التدقيق</span></a></nav><Link href="/login" className="ops-exit"><LogIn /></Link></aside><main className="ops-main">{children}</main></div>
}

function DhiQarMap({ departments }: { departments: DashboardStats['departments'] }) {
  const [selected, setSelected] = useState<DashboardStats['departments'][number] | null>(departments[0] || null)
  const bounds = { minLat: 30.82, maxLat: 31.78, minLng: 46.02, maxLng: 46.55 }
  const mappable = departments.filter((dept): dept is typeof dept & { lat: number; lng: number } => typeof dept.lat === 'number' && typeof dept.lng === 'number')
  useEffect(() => { if (!selected && departments[0]) setSelected(departments[0]) }, [departments, selected])
  return <div className="dhiqar-map"><div className="map-topography" /><div className="dhiqar-outline" />{mappable.map(dept => { const left = ((dept.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 82 + 9; const top = (1 - (dept.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 78 + 10; return <button key={dept.id} className={`department-marker ${dept.status.toLowerCase()} ${selected?.id === dept.id ? 'selected' : ''}`} style={{ left: `${left}%`, top: `${top}%` }} onClick={() => setSelected(dept)}><span><Building2 /></span><small>{dept.district}</small></button> })}{mappable.length === 0 && <div className="gis-awaiting"><Map /><strong>سجل الدوائر جاهز، بانتظار ملف GIS الرسمي</strong><small>تم التحقق من أسماء الجهات ومصادرها؛ لم تُعرض نقاط مكانية لأن الإحداثيات الرسمية لم تُسلَّم بعد.</small></div>} {selected && <div className="map-detail-card source-card"><div><span className="system-status unknown" /><small>{selected.dataStatus === 'VERIFIED_SOURCE' ? 'SOURCE VERIFIED' : 'NEEDS VERIFICATION'}</small></div><h3>{selected.name}</h3><p><MapPin /> {selected.district}، ذي قار</p><div><span><small>حالة GIS</small><strong>{selected.gisStatus === 'COORDINATES_VERIFIED' ? 'مكتملة' : 'بانتظار الإحداثيات'}</strong></span><span><small>المعاملات في المنصة</small><strong>{selected.transactions.toLocaleString('en-GB')}</strong></span></div>{selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noreferrer">فتح المصدر <ArrowLeft /></a>}</div>}<div className="gis-registry-list">{departments.map(dept => <button key={dept.id} className={selected?.id === dept.id ? 'active' : ''} onClick={() => setSelected(dept)}><span className={dept.dataStatus === 'VERIFIED_SOURCE' ? 'verified' : 'pending'} />{dept.name}<small>{dept.type}</small></button>)}</div><span className="map-caption">خريطة GIS تعرض فقط الإحداثيات الواردة من الجهة المالكة. سجل الدوائر أدناه يبيّن المصدر وحالة اكتمال البيانات.</span></div>
}

function OperationsCenter() {
  const [stats, setStats] = useState(defaultStats); useEffect(() => { api.getStats().then(setStats).catch(() => setStats(defaultStats)) }, [])
  const pie = [{ name: 'مكتملة', value: stats.completed, color: '#26d980' }, { name: 'قيد المعالجة', value: Math.max(stats.todayApplications - stats.completed, 1), color: '#2a73ff' }, { name: 'متأخرة', value: stats.overdue, color: '#ff5964' }]
  return <OperationsShell><header className="ops-header"><div><span><Activity /> LIVE GOVERNMENT VIEW</span><h1>غرفة العمليات المركزية</h1><p>محافظة ذي قار • آخر تحديث الآن</p></div><div className="ops-header-actions"><span className="clock">10:45:39<small>توقيت بغداد</small></span><button><Bell /><i>3</i></button><div className="user-avatar">عم</div></div></header><section className="ops-kpis"><div><span><FileText /></span><small>معاملات اليوم</small><strong>{stats.todayApplications.toLocaleString('en-GB')}</strong><em>+12.4%</em></div><div><span><CheckCircle2 /></span><small>المكتملة</small><strong>{stats.completed.toLocaleString('en-GB')}</strong><em>79%</em></div><div><span><Clock3 /></span><small>متوسط الإنجاز</small><strong>{stats.avgProcessingHours} س</strong><em>أفضل 8%</em></div><div><span><UsersRound /></span><small>مواطنون نشطون</small><strong>{(stats.activeCitizens / 1000).toFixed(1)}K</strong><em>اليوم</em></div><div><span><CircleDollarSign /></span><small>التحصيل اليوم</small><strong>{(stats.financialCollection / 1_000_000).toFixed(1)}م</strong><em>د.ع</em></div><div><span><Network /></span><small>دوائر متصلة</small><strong>{stats.departmentsOnline}</strong><em>من 33</em></div></section><section className="ops-dashboard-grid"><div className="ops-map-panel"><div className="panel-heading"><div><h2>Dhi Qar GIS Command Center</h2><p>الوضع التشغيلي للدوائر والخدمات</p></div><div className="map-legend"><span><i className="online" /> يعمل</span><span><i className="degraded" /> متأثر</span><span><i className="offline" /> متوقف</span></div></div><DhiQarMap departments={stats.departments} /></div><div className="ops-side-stack"><div className="dark-panel"><div className="panel-heading"><div><h3>تدفق المعاملات</h3><p>آخر 6 أيام</p></div><RouteIcon /></div><ResponsiveContainer width="100%" height={180}><AreaChart data={stats.series}><defs><linearGradient id="greenArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#26d980" stopOpacity={0.45}/><stop offset="100%" stopColor="#26d980" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#ffffff10" vertical={false}/><XAxis dataKey="day" tick={{ fill: '#91a89d', fontSize: 11 }} axisLine={false} tickLine={false}/><YAxis hide/><Tooltip contentStyle={{ background: '#09291d', border: '1px solid #1c5d40', borderRadius: 12 }} /><Area type="monotone" dataKey="applications" stroke="#26d980" fill="url(#greenArea)" strokeWidth={2}/></AreaChart></ResponsiveContainer></div><div className="dark-panel health-panel"><div className="panel-heading"><div><h3>صحة المنظومة</h3><p>المكونات الحرجة</p></div><Activity /></div>{[['API Gateway',99.99],['قاعدة البيانات',99.98],['التخزين والوثائق',99.94],['خدمة الرسائل',98.70],['التحقق التجريبي',99.10]].map(([name, value]) => <div className="health-row" key={String(name)}><span>{name}</span><div><i style={{ width: `${value}%` }}/></div><b>{value}%</b></div>)}</div></div><div className="dark-panel transactions-panel"><div className="panel-heading"><div><h3>حالة معاملات اليوم</h3><p>التوزيع الحالي</p></div><Gauge /></div><div className="pie-wrap"><ResponsiveContainer width="52%" height={190}><PieChart><Pie data={pie} dataKey="value" innerRadius={52} outerRadius={74} paddingAngle={3}>{pie.map(item => <Cell key={item.name} fill={item.color}/>)}</Pie></PieChart></ResponsiveContainer><div className="pie-legend">{pie.map(item => <span key={item.name}><i style={{ background: item.color }}/><small>{item.name}</small><strong>{item.value.toLocaleString('en-GB')}</strong></span>)}</div></div></div><div className="dark-panel alerts-panel"><div className="panel-heading"><div><h3>التنبيهات التشغيلية</h3><p>تحتاج متابعة</p></div><Bell /></div><div className="alert-item high"><AlertTriangle /><span><strong>ارتفاع زمن المعالجة</strong><small>بلدية سوق الشيوخ • قبل 12 د</small></span></div><div className="alert-item medium"><Activity /><span><strong>تأثر بوابة الرسائل</strong><small>زمن الاستجابة 1.8 ث • قبل 24 د</small></span></div><div className="alert-item low"><CircleDollarSign /><span><strong>عملية تسوية بانتظار المطابقة</strong><small>مزود الدفع التجريبي • قبل 41 د</small></span></div></div></section></OperationsShell>
}

function GovernorDashboard() {
  const [stats, setStats] = useState(defaultStats); useEffect(() => { api.getStats().then(setStats).catch(() => {}) }, []); const ranked = useMemo(() => [...stats.departments].sort((a, b) => b.automation - a.automation), [stats])
  return <OperationsShell active="governor"><header className="ops-header governor-header"><div><span><Landmark /> EXECUTIVE OVERVIEW</span><h1>لوحة المحافظ</h1><p>ملخص تنفيذي لأداء الحكومة المحلية دون إظهار البيانات الشخصية للمواطنين</p></div><div className="ops-header-actions"><button className="period-button">هذا الشهر <CalendarDays /></button><div className="user-avatar gold">مح</div></div></header><section className="executive-score"><div><span className="score-ring"><b>84</b><small>/100</small></span><div><small>مؤشر الأداء الحكومي</small><strong>أداء مستقر مع فرص تحسين</strong><p>تحسن 6 نقاط عن الشهر الماضي</p></div></div><div className="executive-mini"><span><small>الالتزام بالـSLA</small><strong>88%</strong><i style={{ width: '88%' }}/></span><span><small>رضا المواطنين</small><strong>81%</strong><i style={{ width: '81%' }}/></span><span><small>نسبة الأتمتة</small><strong>{stats.automationRate}%</strong><i style={{ width: `${stats.automationRate}%` }}/></span></div></section><section className="governor-grid"><div className="governor-map-card"><div className="panel-heading"><div><h2>خريطة أداء ذي قار</h2><p>الدوائر والمناطق التشغيلية</p></div><button>عرض GIS الكامل</button></div><DhiQarMap departments={stats.departments} /></div><div className="ranking-card"><div className="panel-heading"><div><h3>ترتيب الدوائر</h3><p>حسب الأتمتة والإنجاز</p></div><Gauge /></div>{ranked.map((dept, index) => <div className="ranking-row" key={dept.id}><b>{index + 1}</b><div><strong>{dept.name}</strong><small>{dept.district}</small></div><span>{dept.automation}%</span></div>)}</div><div className="governor-chart-card"><div className="panel-heading"><div><h3>المعاملات المكتملة</h3><p>الطلب مقابل الإنجاز</p></div></div><ResponsiveContainer width="100%" height={250}><BarChart data={stats.series}><CartesianGrid stroke="#153c2d" vertical={false}/><XAxis dataKey="day" tick={{ fill: '#8aa399', fontSize: 11 }} axisLine={false}/><YAxis hide/><Tooltip contentStyle={{ background: '#09291d', border: '1px solid #1c5d40', borderRadius: 12 }}/><Bar dataKey="applications" fill="#255a43" radius={[5,5,0,0]}/><Bar dataKey="completed" fill="#26d980" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></div><div className="executive-alerts"><h3>أولويات المتابعة</h3>{[['01','تسريع معالجة إجازات البناء','متوسط الزمن أعلى من الهدف بـ18%'],['02','رفع أتمتة بلدية سوق الشيوخ','الأقل ضمن الدوائر المرتبطة'],['03','إغلاق الشكاوى المتأخرة','42 شكوى تجاوزت SLA']].map(([n,t,s]) => <div key={n}><span className="priority-number">{n}</span><p><strong>{t}</strong><small>{s}</small></p><ArrowLeft /></div>)}</div></section></OperationsShell>
}

function VerifyScanner() {
  const [, navigate] = useLocation()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const [value, setValue] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [error, setError] = useState('')

  const parseAndOpen = (raw: string) => {
    const normalized = raw.trim()
    const identifier = normalized.includes('/verify/') ? normalized.split('/verify/').pop() || '' : normalized
    if (!identifier) return setError('أدخل معرّف التحقق أو امسح رمز QR صالحاً.')
    navigate(`/verify/${encodeURIComponent(identifier)}`)
  }
  const stopCamera = () => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    setCameraOpen(false)
  }
  useEffect(() => () => stopCamera(), [])
  const startScanner = async () => {
    setError('')
    const Detector = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector
    if (!Detector) return setError('المسح المباشر غير مدعوم في هذا المتصفح. استخدم كاميرا الجهاز لفتح الرابط أو أدخل معرّف الوثيقة يدوياً.')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      streamRef.current = stream
      setCameraOpen(true)
      window.setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream }, 0)
      const detector = new Detector({ formats: ['qr_code'] })
      timerRef.current = window.setInterval(async () => {
        if (!videoRef.current) return
        const codes = await detector.detect(videoRef.current).catch(() => [])
        if (codes[0]?.rawValue) { stopCamera(); parseAndOpen(codes[0].rawValue) }
      }, 600)
    } catch {
      setError('تعذر فتح كاميرا الهاتف. امنح إذن الكاميرا أو أدخل معرّف الوثيقة يدوياً.')
    }
  }
  return <div className="verify-page"><DemoRibbon /><header className="verify-header container"><Brand /><Link href="/"><ArrowRight /> الرئيسية</Link></header><main className="container scanner-content"><section className="scanner-card"><span className="scanner-icon"><QrCode /></span><span className="section-kicker">تحقق من وثيقة صادرة</span><h1>امسح رمز QR أو أدخل المعرّف</h1><p>يفتح المسح سجل التحقق العام ويعرض الحد الأدنى من بيانات الوثيقة. لا ترفع صورة QR إلى خادم المنصة.</p>{cameraOpen && <div className="scanner-camera"><video ref={videoRef} autoPlay playsInline muted /><button className="button ghost" onClick={stopCamera}>إيقاف الكاميرا</button></div>}<div className="scanner-actions"><button className="button primary" onClick={startScanner}><Camera /> مسح بالكاميرا</button><div className="scanner-divider"><span>أو</span></div><label>معرّف التحقق أو رابط QR<input value={value} onChange={event => setValue(event.target.value)} placeholder="TQD-..." autoComplete="off" /></label><button className="button outline" onClick={() => parseAndOpen(value)}>تحقق الآن <ArrowLeft /></button></div>{error && <div className="form-error"><AlertTriangle /> {error}</div>}</section></main></div>
}

function VerifyPage({ verificationId }: { verificationId: string }) {
  const [app, setApp] = useState<GovernmentApplication | null>(null); const [error, setError] = useState('')
  useEffect(() => { api.verifyDocument(verificationId).then(setApp).catch(() => setError('لم يتم العثور على وثيقة بهذا المعرّف.')) }, [verificationId])
  return <div className="verify-page"><DemoRibbon /><header className="verify-header container"><Brand /><Link href="/"><ArrowRight /> الرئيسية</Link></header><main className="container verify-content">{app ? <div className="verification-result valid"><span className="verification-icon"><BadgeCheck /></span><span className="section-kicker">DIGITAL DOCUMENT VERIFICATION</span><h1>الوثيقة صحيحة ضمن سجل المنصة</h1><p>تم إصدار هذه الوثيقة من سجل ذي قار الرقمية ويمكن التحقق من بياناتها هنا. يبقى نفاذها خارج المنصة مرتبطاً باعتماد الجهة المختصة.</p><div className="verification-data"><span><small>نوع الوثيقة</small><strong>إجازة ممارسة نشاط تجاري</strong></span><span><small>رقم الوثيقة</small><strong>{app.documentNumber}</strong></span><span><small>رقم المعاملة</small><strong>{app.reference}</strong></span><span><small>صاحب الوثيقة</small><strong>{app.citizenName}</strong></span><span><small>الحالة</small><strong>فعّالة في سجل المنصة</strong></span><span><small>تاريخ الإصدار</small><strong>{new Date(app.updatedAt).toLocaleDateString('en-GB')}</strong></span></div><div className="verification-hash"><QrCode /><span><small>Verification ID</small><strong>{app.verificationId}</strong></span></div></div> : error ? <div className="verification-result invalid"><span className="verification-icon"><AlertTriangle /></span><h1>تعذر التحقق</h1><p>{error}</p><Link className="button primary" href="/">العودة للرئيسية</Link></div> : <div className="loading-state"><RefreshCw className="spin" /> جاري التحقق من الوثيقة...</div>}</main></div>
}

function NotFound() { return <div className="not-found"><Brand /><strong>404</strong><h1>الصفحة غير موجودة</h1><p>المسار الذي فتحته غير متاح في هذه النسخة التجريبية.</p><Link href="/" className="button primary">العودة للرئيسية</Link></div> }

function App() {
  return <Switch><Route path="/" component={LandingPage} /><Route path="/login" component={LoginPage} /><Route path="/onboarding" component={OnboardingPage} /><Route path="/citizen" component={CitizenDashboard} /><Route path="/service/:key">{params => <ServiceFormPage serviceKey={params.key} />}</Route><Route path="/citizen/application/:reference">{params => <ApplicationPage reference={params.reference} />}</Route><Route path="/employee" component={EmployeeDashboard} /><Route path="/operations" component={OperationsCenter} /><Route path="/governor" component={GovernorDashboard} /><Route path="/verify" component={VerifyScanner} /><Route path="/verify/:id">{params => <VerifyPage verificationId={params.id} />}</Route><Route component={NotFound} /></Switch>
}

export default App
