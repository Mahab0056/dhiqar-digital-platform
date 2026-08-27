import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Route, Switch, useLocation } from 'wouter'
import { motion } from 'framer-motion'
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, Bell,
  BriefcaseBusiness, Building2, CalendarDays, Camera, Check, CheckCircle2,
  ChevronLeft, CircleDollarSign, Clock3, Download, ExternalLink, Eye, FileArchive,
  FileCheck2, FileText, Fingerprint, Gauge, Headphones, Landmark, LockKeyhole,
  LogIn, Map, MapPin, Menu, MessageSquareWarning, MonitorCheck, Network,
  Phone, Plus, QrCode, ReceiptText, RefreshCw, Route as RouteIcon, Search,
  Send, ShieldCheck, UserRound, UsersRound, X,
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import QRCode from 'qrcode'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip as LeafletTooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from './api'
import { categoryIcons, defaultStats, formatIQD, services, statusLabels } from './data'
import { dhiqarNews, officialProcurementLinks } from './news'
import { getServiceDefinition } from './service-forms'
import type { Citizen, CitizenNotification, CitizenServiceRequest, DashboardStats, GovernmentApplication } from './types'
import './App.css'

const reveal = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.15 },
  transition: { duration: 0.45 },
}

function CivicUtilityBar() {
  return <div className="civic-utility"><div className="container"><span><ShieldCheck size={13} /> بوابة الخدمات الرقمية لمحافظة ذي قار</span><nav><a href="#accessibility">سهولة الوصول</a><a href="#privacy">الخصوصية</a><Link href="/verify">التحقق من الوثائق</Link></nav></div></div>
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className="brand" aria-label="ذي قار الرقمية - الرئيسية"><img src="/brand/dhiqar-official-logo.jpg" alt="شعار ذي قار الرقمي الرسمي" />{!compact && <span><strong>ذي قار الرقمية</strong><small>THI QAR DIGITAL</small></span>}</Link>
}

function PublicHeader() {
  const [open, setOpen] = useState(false)
  return <><CivicUtilityBar /><header className="public-header"><div className="container nav-row"><Brand /><nav className={open ? 'nav-links is-open' : 'nav-links'}><Link href="/#services">الخدمات</Link><Link href="/#news">الأخبار</Link><Link href="/#procurement">المناقصات</Link><Link href="/citizen">حساب المواطن</Link><Link href="/operations">غرفة العمليات</Link><Link href="/login" className="nav-login"><LogIn size={17} /> دخول المنصة</Link></nav><button className="menu-button" onClick={() => setOpen(v => !v)} aria-label="القائمة" aria-expanded={open}>{open ? <X /> : <Menu />}</button></div></header></>
}

function Footer() {
  return <footer className="footer"><div className="container footer-grid"><div><Brand /><p>خدمات رقمية مصممة حول المواطن، تربط الطلب بالجهة المختصة وتوضح كل خطوة حتى الإنجاز.</p></div><div><strong>الوصول السريع</strong><Link href="/citizen">بوابة المواطن</Link><Link href="/employee">بوابة الموظف</Link><Link href="/operations">غرفة العمليات</Link><Link href="/verify">التحقق من الوثائق</Link></div><div id="privacy"><strong>الثقة والأمان</strong><span>تشفير المرفقات الحساسة</span><span>صلاحيات حسب الدور والغرض</span><span>سجل تدقيق لكل إجراء</span><Link href="/terms">الشروط وسياسة الاستخدام</Link></div></div><div className="container footer-bottom" id="accessibility"><span>© 2026 ذي قار الرقمية</span><span>العربية • RTL • أرقام إنجليزية • متوافق مع الهاتف</span></div></footer>
}

function NewsCarousel() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused || dhiqarNews.length < 2) return
    const timer = window.setInterval(() => setActiveIndex(current => (current + 1) % dhiqarNews.length), 7000)
    return () => window.clearInterval(timer)
  }, [paused])
  const item = dhiqarNews[activeIndex]
  if (!item) return null
  return <section className="home-news-carousel" id="news" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}><div className="container"><div className="home-news-head"><div><span className="section-kicker">أخبار ذي قار</span><h2>آخر المستجدات من مصادرها</h2></div><span>{String(activeIndex + 1).padStart(2, '0')} / {String(dhiqarNews.length).padStart(2, '0')}</span></div><article className="news-slide" key={item.title}><div className="news-slide-media"><img src={item.image} alt={item.title} /><span>{item.category}</span></div><div className="news-slide-copy"><small>المصدر: {item.source}</small><h3>{item.title}</h3><p>اطلع على التفاصيل الأصلية وتاريخ النشر من المصدر المرتبط مباشرة.</p><a href={item.sourceUrl} target="_blank" rel="noreferrer">فتح الخبر من المصدر <ArrowLeft /></a></div></article><div className="news-slider-controls"><div className="news-dots" aria-label="اختيار الخبر">{dhiqarNews.map((news, index) => <button key={news.title} className={index === activeIndex ? 'active' : ''} onClick={() => setActiveIndex(index)} aria-label={`عرض الخبر ${index + 1}`} />)}</div><div className="news-arrows"><button onClick={() => setActiveIndex(current => (current - 1 + dhiqarNews.length) % dhiqarNews.length)} aria-label="الخبر السابق">‹</button><button onClick={() => setActiveIndex(current => (current + 1) % dhiqarNews.length)} aria-label="الخبر التالي">›</button></div></div></div></section>
}

function LandingPage() {
  const [, navigate] = useLocation()
  const [serviceQuery, setServiceQuery] = useState('')
  const [stats, setStats] = useState(defaultStats)
  const categories = Object.entries(categoryIcons).slice(0, 8)
  useEffect(() => { api.getStats().then(setStats).catch(() => setStats(defaultStats)) }, [])
  const matchedServices = useMemo(() => {
    const query = serviceQuery.trim().toLowerCase()
    if (!query) return services.slice(0, 5)
    return services.filter(service => `${service.title} ${service.description} ${service.department} ${service.category}`.toLowerCase().includes(query)).slice(0, 5)
  }, [serviceQuery])
  const submitServiceSearch = (event: React.FormEvent) => { event.preventDefault(); if (matchedServices[0]) navigate(`/service/${matchedServices[0].key}`) }
  const quickActions = [
    { icon: Plus, title: 'ابدأ معاملة', href: '/#services' },
    { icon: CalendarDays, title: 'احجز موعداً', href: '/service/passport-appointment' },
    { icon: Search, title: 'تابع معاملة', href: '/citizen' },
    { icon: MessageSquareWarning, title: 'قدّم بلاغاً', href: '/service/water-complaint' },
    { icon: QrCode, title: 'تحقق من وثيقة', href: '/verify' },
  ]
  return <div className="public-shell"><PublicHeader /><main>
    <section className="hero hero-modern"><div className="hero-ambient hero-ambient-one" /><div className="hero-ambient hero-ambient-two" /><div className="container hero-grid"><motion.div className="hero-copy" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.48, ease: [0.23, 1, 0.32, 1] }}><div className="eyebrow"><Landmark size={16} /> بوابة ذي قار للخدمات الرقمية</div><h1>خدمتك الحكومية،<br /><em>أوضح وأقرب.</em></h1><p>قدّم طلبك، ارفع مستنداتك، احجز موعدك وتابع كل إجراء من مكان واحد، بتجربة مصممة للمواطن ومهيأة للعمل من الهاتف.</p><form className="smart-search smart-search-live" onSubmit={submitServiceSearch}><div className="search-icon"><Search size={21} /></div><label><small>ابحث باسم الخدمة أو حاجتك</small><input value={serviceQuery} onChange={event => setServiceQuery(event.target.value)} placeholder="مثال: جواز، بطاقة موحدة، إجازة محل" aria-label="البحث عن خدمة" /></label><button type="submit" className="search-submit" aria-label="فتح أول نتيجة" disabled={!matchedServices.length}><ArrowLeft /></button>{serviceQuery && <div className="hero-search-results">{matchedServices.length ? matchedServices.map(service => <Link href={`/service/${service.key}`} key={service.key} onClick={() => setServiceQuery('')}><span><FileText /></span><div><strong>{service.title}</strong><small>{service.department}</small></div><ArrowLeft /></Link>) : <p>لا توجد خدمة مطابقة. جرّب كلمة أخرى.</p>}</div>}</form><div className="hero-actions"><Link href="/#services" className="button primary">استعرض الخدمات <ArrowLeft /></Link><Link href="/citizen" className="button hero-secondary">متابعة معاملاتي</Link></div><div className="hero-trust"><span><ShieldCheck size={17} /> تشفير للمرفقات الحساسة</span><span><Fingerprint size={17} /> تحقق متعدد المراحل</span><span><Eye size={17} /> تتبّع وسجل إجراءات</span></div></motion.div><motion.div className="hero-visual hero-visual-modern" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.72, ease: [0.23, 1, 0.32, 1] }}><img src="/brand/landmarks/ur-ziggurat-panorama.jpg" alt="زقورة أور في محافظة ذي قار" /><div className="heritage-caption"><span>من أور إلى حكومة رقمية حديثة</span><small>صورة مرخصة للملكية العامة — Wikimedia Commons</small></div><div className="hero-command-card"><div className="command-head"><span className="live-badge"><i /> الخدمة متاحة</span><small>تحديث مباشر من سجل المنصة</small></div><div className="command-grid"><span><b>{stats.todayApplications.toLocaleString('en-US')}</b><small>معاملة اليوم</small></span><span><b>{stats.completed.toLocaleString('en-US')}</b><small>معاملة مكتملة</small></span><span><b>{(stats.registry?.verified ?? stats.departments.length).toLocaleString('en-US')}</b><small>جهة موثقة المصدر</small></span></div><div className="command-route"><MapPin /><span>ذي قار</span><i /><span>الخدمة المختصة</span><i /><span>المواطن</span></div></div><div className="civilization-line">إرث راسخ <ArrowLeft size={15} /> خدمة حديثة</div></motion.div></div></section>
    <NewsCarousel />
    <section className="quick-actions container">{quickActions.map(item => <Link href={item.href} className="quick-action" key={item.title}><span><item.icon /></span><strong>{item.title}</strong><ChevronLeft size={17} /></Link>)}</section>
    <section className="section container" id="services"><motion.div className="section-heading" {...reveal}><div><span className="section-kicker">الخدمات الحكومية</span><h2>لا تحتاج تعرف اسم الدائرة</h2></div><p>اختر حاجتك، والمنصة توجّهك تلقائياً إلى الخدمة والجهة المسؤولة والمتطلبات.</p></motion.div><div className="category-grid">{categories.map(([label, Icon], index) => <motion.a href="#featured-services" className="category-card" key={label} {...reveal} transition={{ delay: index * 0.03 }}><span><Icon /></span><strong>{label}</strong><small>عرض الخدمات</small></motion.a>)}</div></section>
    <section className="section section-ink" id="featured-services"><div className="container"><motion.div className="section-heading light" {...reveal}><div><span className="section-kicker">الأكثر استخداماً</span><h2>خدمات مصممة حول رحلة المواطن</h2></div><p>متطلبات واضحة قبل البدء، تعبئة تلقائية للبيانات الموثقة، ومسار مفهوم حتى إصدار الوثيقة.</p></motion.div><div className="service-grid">{services.slice(0, 3).map((service, index) => <motion.div className={index === 0 ? 'service-card featured' : 'service-card'} key={service.key} {...reveal}><div className="service-top"><span className="service-number">0{index + 1}</span><span className="service-category">{service.category}</span></div><h3>{service.title}</h3><p>{service.description}</p><div className="service-meta"><span><Clock3 /> {service.estimatedTime}</span><span><ReceiptText /> {service.fee ? formatIQD(service.fee) : 'مجانية'}</span></div><Link href={`/service/${service.key}`} className="service-link">ابدأ الخدمة <ArrowLeft /></Link></motion.div>)}</div></div></section>
    <section className="section container platform-story"><motion.div className="story-copy" {...reveal}><span className="section-kicker">حساب مواطن واحد</span><h2>من تأكيد الهوية إلى الوثيقة النهائية، بدون تكرار.</h2><p>المعلومات الموثقة تُملأ مرة واحدة وتُستخدم بأقل قدر لازم لكل خدمة. المواطن يعرف المطلوب منه الآن، والموظف يرى فقط ما تسمح به صلاحياته.</p><div className="story-steps">{['تحقق الهاتف', 'توثيق الهوية', 'اختيار الخدمة', 'تدقيق الموظف', 'الدفع والموافقة', 'وثيقة + QR'].map((step, i) => <span key={step}><b>{i + 1}</b>{step}</span>)}</div><Link href="/onboarding" className="button primary">أنشئ حسابك <ArrowLeft /></Link></motion.div><motion.div className="phone-mockup" {...reveal}><div className="phone-notch" /><div className="phone-header"><Brand compact /><span className="verified-chip"><BadgeCheck /> موثّق</span></div><div className="phone-greeting"><small>هلا مهاب،</small><strong>شنو تحتاج اليوم؟</strong></div><div className="phone-search"><Search /> ابحث عن خدمة</div><div className="phone-cards"><div><FileText /><span>معاملاتي</span><b>3</b></div><div><Bell /><span>الإشعارات</span><b>1</b></div></div><div className="phone-application"><span>إجازة فتح محل</span><strong>قيد التدقيق</strong><div className="progress"><i /></div><small>لا يوجد إجراء مطلوب منك</small></div></motion.div></section>
    <section className="section government-strip"><div className="container government-grid"><div><span className="section-kicker">للحكومة المحلية</span><h2>صورة تشغيلية واحدة للمحافظة</h2><p>المعاملات المسجلة، سجل الدوائر، حالة مصادر GIS، المالية المؤكدة، التنبيهات، وسجل الإجراءات في شاشة قيادة واحدة.</p><Link href="/operations" className="button glass">افتح غرفة العمليات <ArrowLeft /></Link></div><div className="gov-metrics"><span><FileText /><b>{stats.todayApplications.toLocaleString('en-US')}</b><small>طلبات مسجلة اليوم</small></span><span><CheckCircle2 /><b>{stats.completed.toLocaleString('en-US')}</b><small>معاملات مكتملة</small></span><span><Building2 /><b>{(stats.registry?.verified ?? stats.departments.length).toLocaleString('en-US')}</b><small>جهات موثقة المصدر</small></span><span><CircleDollarSign /><b>{formatIQD(stats.financialCollection)}</b><small>تسويات مالية مؤكدة</small></span></div></div></section><ProcurementSection />
  </main><Footer /></div>
}

function ProcurementSection() {
  return <><section className="section news-section news-archive" aria-hidden="true"><div className="container"><div className="section-heading"><div><span className="section-kicker">أخبار ذي قار</span><h2>متابعة مصورة من المصادر المعروضة</h2></div><p>تحتفظ كل بطاقة برابط مصدرها. راجع المصدر للخبر الكامل وتاريخ النشر قبل اتخاذ أي إجراء.</p></div><div className="news-grid">{dhiqarNews.map((item, index) => <article className={index === 0 ? 'news-card featured' : 'news-card'} key={item.title}><img src={item.image} alt={item.title} loading="lazy" /><div><span>{item.category}</span><h3>{item.title}</h3><p>المصدر: {item.source}</p><a href={item.sourceUrl} target="_blank" rel="noreferrer">فتح المصدر <ArrowLeft /></a></div></article>)}</div></div></section><section className="section procurement-section" id="procurement"><div className="container"><div className="section-heading light"><div><span className="section-kicker">المناقصات والمزادات</span><h2>بوابة شفافة إلى الإعلانات المنشورة</h2></div><p>تظهر الروابط الرسمية المتاحة حالياً. لا تُنشأ أي مناقصة أو مزاد داخل المنصة قبل إدخال الإعلان من الجهة صاحبة الصلاحية.</p></div><div className="procurement-grid">{officialProcurementLinks.map(item => <a href={item.href} target="_blank" rel="noreferrer" key={item.title}><span><FileArchive /></span><div><small>{item.source}</small><h3>{item.title}</h3><p>{item.detail}</p></div><ArrowLeft /></a>)}</div></div></section></>
}

function LoginPage() {
  const options = [
    { icon: UserRound, title: 'دخول المواطن', text: 'برقم الهاتف والهوية الرقمية', href: '/onboarding', tone: 'citizen' },
    { icon: Building2, title: 'دخول الموظف', text: 'حساب حكومي + تحقق متعدد العوامل', href: '/employee', tone: 'employee' },
    { icon: MonitorCheck, title: 'غرفة العمليات', text: 'وصول مقيّد للإدارة التشغيلية', href: '/operations', tone: 'operations' },
    { icon: ShieldCheck, title: 'مدير النظام', text: 'إدارة المنصة وسجل التدقيق', href: '/super-admin/login', tone: 'super-admin' },
  ]
  return <div className="login-page"><CivicUtilityBar /><div className="login-backdrop" /><div className="login-top container"><Brand /><Link href="/"><ArrowRight /> العودة للرئيسية</Link></div><main className="container login-content"><div className="login-intro"><span className="eyebrow"><LockKeyhole size={16} /> بوابات دخول منفصلة وآمنة</span><h1>اختر بوابة الدخول</h1><p>لا نخلط حسابات المواطنين بالحسابات الحكومية. كل بوابة لها سياساتها وصلاحياتها ومسار التحقق الخاص بها.</p></div><div className="login-options">{options.map(option => <Link href={option.href} className={`login-option ${option.tone}`} key={option.title}><span><option.icon /></span><div><h2>{option.title}</h2><p>{option.text}</p></div><ArrowLeft /></Link>)}</div><div className="security-note"><ShieldCheck /><div><strong>بنية ثقة صفرية</strong><span>الدخول وحده لا يمنح الوصول؛ كل إجراء حساس يحتاج صلاحية وغرضاً مسجلاً.</span></div></div></main></div>
}

function SuperAdminLogin() {
  const [, navigate] = useLocation()
  const [accessCode, setAccessCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { api.getSession().then(session => { if (session.role === 'SUPER_ADMIN') navigate('/super-admin') }).catch(() => {}) }, [navigate])
  const login = async () => {
    setBusy(true); setError('')
    try { await api.loginSuperAdmin(accessCode); navigate('/super-admin') }
    catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="login-page super-admin-login"><CivicUtilityBar /><div className="login-backdrop" /><div className="login-top container"><Brand /><Link href="/login"><ArrowRight /> بوابات الدخول</Link></div><main className="container login-content"><div className="login-intro"><span className="eyebrow"><ShieldCheck size={16} /> SYSTEM GOVERNANCE</span><h1>دخول المدير العام للنظام</h1><p>هذه البوابة مخصصة لإدارة المنصة ومراجعة المؤشرات وسجل الإجراءات. رمزها مستقل عن حساب الموظف والمواطن.</p></div><section className="super-admin-login-card"><span className="super-admin-shield"><ShieldCheck /></span><strong>SUPER ADMIN</strong><label>رمز دخول المدير العام<input value={accessCode} onChange={event => setAccessCode(event.target.value)} type="password" autoComplete="current-password" onKeyDown={event => { if (event.key === 'Enter' && accessCode.length >= 12) void login() }} /></label>{error && <div className="form-error"><AlertTriangle /> {error}</div>}<button className="button primary full" onClick={() => void login()} disabled={busy || accessCode.length < 12}>{busy ? 'جاري التحقق...' : 'دخول آمن'}</button><small>تسجل جلسات المدير العام والإجراءات الحساسة في سجل التدقيق.</small></section></main></div>
}

function SuperAdminDashboard() {
  const [, navigate] = useLocation()
  const [overview, setOverview] = useState<{ system: { pendingIdentity: number; openApplications: number; verifiedDepartments: number; gisLocations: number }; recentAudit: Array<{ actor: string; role: string; action: string; entityType: string; entityId: string; createdAt: string }> } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => { setLoading(true); setError(''); try { setOverview(await api.getSuperAdminOverview()) } catch (err) { setError((err as Error).message) } finally { setLoading(false) } }, [])
  useEffect(() => { let active = true; api.getSuperAdminOverview().then(value => { if (active) setOverview(value) }).catch(err => { if (active) setError((err as Error).message) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [])
  const endSession = async () => { await api.logout(); navigate('/login') }
  const system = overview?.system || { pendingIdentity: 0, openApplications: 0, verifiedDepartments: 0, gisLocations: 0 }
  return <OperationsShell active="super-admin"><header className="ops-header super-admin-header"><div><span><ShieldCheck /> SYSTEM GOVERNANCE</span><h1>إدارة المنصة</h1><p>صلاحيات المدير العام — مراقبة الخدمات والدوائر والإجراءات الحساسة من شاشة واحدة.</p></div><div className="ops-header-actions"><button className="button outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} /> تحديث</button><button className="button ghost" onClick={() => void endSession()}>إنهاء الجلسة</button><div className="user-avatar gold">SA</div></div></header>{error && <div className="form-error super-admin-error"><AlertTriangle /> {error}</div>}<section className="ops-kpis super-admin-kpis"><div><span><Fingerprint /></span><small>مراجعات الهوية</small><strong>{system.pendingIdentity.toLocaleString('en-US')}</strong><em>بانتظار القرار</em></div><div><span><FileText /></span><small>طلبات مفتوحة</small><strong>{system.openApplications.toLocaleString('en-US')}</strong><em>تحتاج متابعة</em></div><div><span><Building2 /></span><small>دوائر موثقة</small><strong>{system.verifiedDepartments.toLocaleString('en-US')}</strong><em>ضمن السجل</em></div><div><span><Map /></span><small>مواقع GIS</small><strong>{system.gisLocations.toLocaleString('en-US')}</strong><em>إحداثيات متحققة</em></div></section><section className="super-admin-grid"><article className="dark-panel super-admin-actions"><div className="panel-heading"><div><span className="section-kicker">مراكز الإدارة</span><h2>الوصول التشغيلي</h2><p>كل مسار يفتح وظيفة فعلية ضمن جلسة المدير العام.</p></div><ShieldCheck /></div><div className="super-admin-action-list"><Link href="/operations"><Map /><span><strong>غرفة العمليات</strong><small>GIS، صحة المنظومة، الدوائر والمالية</small></span><ArrowLeft /></Link><Link href="/employee"><FileArchive /><span><strong>المعاملات ومراجعة الهوية</strong><small>قائمة العمل، المرفقات والقرارات</small></span><ArrowLeft /></Link><Link href="/governor"><Landmark /><span><strong>لوحة المحافظ</strong><small>ملخص تنفيذي من السجلات المتاحة</small></span><ArrowLeft /></Link><Link href="/"><Bell /><span><strong>الأخبار والخدمات</strong><small>مراجعة واجهة المواطن والمحتوى المنشور</small></span><ArrowLeft /></Link></div></article><article className="dark-panel super-admin-audit"><div className="panel-heading"><div><span className="section-kicker">AUDIT TRAIL</span><h2>آخر الإجراءات المسجلة</h2><p>سجل القراءة والمراجعة والجلسات، دون إظهار محتوى الهوية.</p></div><FileCheck2 /></div>{loading ? <div className="loading-state"><RefreshCw className="spin" /> جاري تحميل سجل التدقيق...</div> : overview?.recentAudit.length ? <div className="super-admin-audit-list">{overview.recentAudit.map((entry, index) => <div key={`${entry.entityId}-${index}`}><span className={`audit-role ${entry.role.toLowerCase()}`}>{entry.role}</span><div><strong>{entry.action.replaceAll('_', ' ')}</strong><small>{entry.actor} • {entry.entityType} / {entry.entityId}</small></div><time>{new Date(entry.createdAt).toLocaleString('en-GB')}</time></div>)}</div> : <div className="empty-queue"><FileCheck2 /><p>لا توجد إجراءات مسجلة بعد.</p></div>}</article></section></OperationsShell>
}

type CaptureMode = 'photo' | 'video'

function SecureCameraCapture({
  title,
  guidance,
  mode,
  facingMode,
  allowPdf = false,
  cameraOnly = false,
  file,
  onChange,
}: {
  title: string
  guidance: string
  mode: CaptureMode
  facingMode: 'user' | 'environment'
  allowPdf?: boolean
  cameraOnly?: boolean
  file: File | null
  onChange: (file: File | null) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<number | null>(null)
  const discardRecordingRef = useRef(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(7)
  const [previewUrl, setPreviewUrl] = useState('')
  const [cameraError, setCameraError] = useState('')

  const stopCamera = () => {
    discardRecordingRef.current = true
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current)
    recordingTimerRef.current = null
    recorderRef.current?.stop()
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    setCameraOpen(false)
    setRecording(false)
  }

  useEffect(() => () => {
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current)
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
      window.setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream
        if (mode === 'video') window.setTimeout(() => startVideo(stream), 700)
      }, 0)
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

  const startVideo = (sourceStream?: MediaStream) => {
    const stream = sourceStream || streamRef.current
    if (!stream || typeof MediaRecorder === 'undefined') return setCameraError('تسجيل الفيديو غير مدعوم في هذا المتصفح. استخدم رفع فيديو قصير.')
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm'
    const recorder = new MediaRecorder(stream, { mimeType })
    chunksRef.current = []
    discardRecordingRef.current = false
    setRecordingSeconds(7)
    recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data) }
    recorder.onstop = () => {
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
      if (!discardRecordingRef.current && chunksRef.current.length) setCapturedFile(new File([new Blob(chunksRef.current, { type: 'video/webm' })], `face-video-7s-${Date.now()}.webm`, { type: 'video/webm' }))
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
      setCameraOpen(false)
      setRecording(false)
    }
    recorderRef.current = recorder
    recorder.start(500)
    setRecording(true)
    const startedAt = Date.now()
    recordingTimerRef.current = window.setInterval(() => {
      const remaining = Math.max(0, 7 - Math.floor((Date.now() - startedAt) / 1000))
      setRecordingSeconds(remaining)
      if (remaining === 0) {
        if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current)
        recordingTimerRef.current = null
        if (recorder.state === 'recording') recorder.stop()
      }
    }, 250)
  }

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
    {cameraOpen && <div className="live-camera"><video ref={videoRef} autoPlay playsInline muted /><div className="live-camera-actions">{mode === 'photo' ? <button type="button" className="button primary" onClick={takePhoto}><Camera /> التقاط الصورة</button> : recording ? <div className="recording-countdown"><span>{recordingSeconds}</span><strong>ثوانٍ — حرّك رأسك ببطء وانظر للكاميرا</strong></div> : <div className="camera-preparing"><RefreshCw /> جاري تجهيز التسجيل التلقائي...</div>}<button type="button" className="button ghost" onClick={stopCamera}>إلغاء</button></div></div>}
    <div className="capture-actions"><button type="button" className="button secondary" onClick={openCamera}><Camera /> {file ? 'إعادة التصوير' : 'فتح الكاميرا'}</button>{!cameraOnly && <button type="button" className="button ghost" onClick={() => inputRef.current?.click()}><FileText /> {mode === 'photo' ? 'رفع صورة' : 'رفع فيديو'}</button>}{file && <button type="button" className="capture-remove" onClick={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(''); onChange(null) }}><RefreshCw /> مسح</button>}</div>
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
  const [screeningScore, setScreeningScore] = useState<number | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const requestOtp = async () => { setBusy(true); setMessage(''); setNotice(''); try { const challenge = await api.requestOtp(phone); setChallengeId(challenge.challengeId); setOtp(''); setNotice(`تم إرسال رمز لمرة واحدة إلى ${challenge.phoneMasked}. صالح لمدة 5 دقائق.`) } catch (e) { setMessage((e as Error).message) } finally { setBusy(false) } }
  const nextPhone = async () => { if (!challengeId) return setMessage('اطلب رمز التحقق أولاً.'); setBusy(true); setMessage(''); try { await api.verifyPhone(phone, challengeId, otp); setNotice(''); setStep(2) } catch (e) { setMessage((e as Error).message) } finally { setBusy(false) } }
  const finish = async () => { if (!consent) return setMessage('الموافقة الصريحة مطلوبة قبل إرسال الهوية والفيديو للمراجعة.'); if (!fullName || !nationalId || !idFront || !idBack || !faceVideo) return setMessage('أكمل الاسم والرقم وصور الهوية وفيديو الوجه قبل الإرسال.'); setBusy(true); setMessage(''); try { const review = await api.submitIdentityReview({ fullName, nationalId, consent, idFront, idBack, faceVideo }); setReviewId(review.id); setScreeningScore(review.screening.qualityScore); setStep(5) } catch (e) { setMessage((e as Error).message) } finally { setBusy(false) } }
  const titles = ['الهاتف', 'الهوية', 'البيانات', 'فيديو الوجه', 'المراجعة']
  return <div className="onboarding-page"><CivicUtilityBar /><header className="onboarding-header container"><Brand /><span>إنشاء الهوية الرقمية</span><Link href="/login"><X /></Link></header><main className="container onboarding-layout"><aside className="onboarding-aside"><span className="section-kicker">DIGITAL CITIZEN ONBOARDING</span><h1>حسابك الحكومي يبدأ من هوية موثوقة.</h1><p>رحلة تحقق تدريجية ومفهومة، مع أقل قدر مطلوب من البيانات ومراجعة يدوية للحالات غير المؤكدة.</p><div className="privacy-card"><ShieldCheck /><div><strong>خصوصيتك جزء من التصميم</strong><span>تُحفظ مرفقات الهوية وفيديو الوجه بتشفير وعلى نطاق مراجعة محدد، ولا يصدر قرار تلقائي من الكاميرا وحدها.</span></div></div></aside><section className="onboarding-panel"><div className="stepper">{titles.map((title, index) => <div className={step > index + 1 ? 'done' : step === index + 1 ? 'active' : ''} key={title}><span>{step > index + 1 ? <Check /> : index + 1}</span><small>{title}</small></div>)}</div>
  {step === 1 && <div className="form-stage"><span className="stage-icon"><Phone /></span><h2>تأكيد رقم الهاتف</h2><p>سنرسل رمزاً حقيقياً لمرة واحدة عبر WhatsApp أو Telegram أو SMS مع تحويل تلقائي حسب التوفر.</p><label>رقم الهاتف العراقي<input value={phone} onChange={e => { setPhone(e.target.value); setChallengeId(''); setOtp(''); setNotice('') }} inputMode="tel" autoComplete="tel" placeholder="07XXXXXXXXX" /></label>{!challengeId ? <button className="button primary full" onClick={requestOtp} disabled={busy || phone.length < 10}>{busy ? 'جاري الإرسال...' : 'إرسال رمز التحقق'}</button> : <><label>رمز التحقق<input value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6 digits" /></label><button className="button primary full" onClick={nextPhone} disabled={busy || otp.length !== 6}>{busy ? 'جاري التحقق...' : 'تأكيد الهاتف'}</button><button className="button ghost full" onClick={requestOtp} disabled={busy}>إعادة إرسال الرمز</button></>}</div>}
  {step === 2 && <div className="form-stage"><span className="stage-icon"><Camera /></span><h2>صوّر وجه الهوية الوطنية</h2><p>افتح كاميرا الهاتف وصوّر وجه البطاقة كاملاً في إضاءة واضحة، أو ارفع صورة موجودة على الجهاز.</p><SecureCameraCapture title="وجه الهوية الوطنية" guidance="أظهر الحواف الأربع للبطاقة وتجنب الوهج أو الظلال." mode="photo" facingMode="environment" file={idFront} onChange={setIdFront} /><div className="stage-actions"><button className="button ghost" onClick={() => setStep(1)}><ArrowRight /> رجوع</button><button className="button primary" onClick={() => setStep(3)} disabled={!idFront}>متابعة <ArrowLeft /></button></div></div>}
  {step === 3 && <div className="form-stage"><span className="stage-icon"><FileCheck2 /></span><h2>أكمل بيانات الهوية</h2><p>لا يُعرض الرقم الوطني كاملاً للموظفين داخل القوائم. أدخل البيانات كما تظهر في البطاقة لإرسالها للمراجعة.</p><SecureCameraCapture title="ظهر الهوية الوطنية" guidance="صوّر الجهة الخلفية للبطاقة بوضوح أو ارفع الصورة من الهاتف." mode="photo" facingMode="environment" file={idBack} onChange={setIdBack} /><label>الاسم الكامل<input value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" placeholder="الاسم كما في الهوية" /></label><label>الرقم الوطني<input value={nationalId} onChange={e => setNationalId(e.target.value.replace(/\D/g, '').slice(0, 20))} inputMode="numeric" placeholder="رقم الهوية" /></label><div className="stage-actions"><button className="button ghost" onClick={() => setStep(2)}><ArrowRight /> رجوع</button><button className="button primary" onClick={() => setStep(4)} disabled={!idBack || fullName.trim().length < 3 || nationalId.length < 4}>متابعة <ArrowLeft /></button></div></div>}
  {step === 4 && <div className="form-stage"><span className="stage-icon"><Fingerprint /></span><h2>تأكيد الوجه بفيديو 7 ثوانٍ</h2><p>تفتح الكاميرا الأمامية ويبدأ التسجيل تلقائياً لمدة 7 ثوانٍ. يجري فحص جودة أولي، ثم تُراجع المطابقة ضمن مسار الهوية المخول ولا تعتمد الكاميرا وحدها قرار الهوية.</p><SecureCameraCapture title="فيديو الوجه لمدة 7 ثوانٍ" guidance="افتح الكاميرا الأمامية؛ يبدأ التسجيل تلقائياً وينتهي بعد 7 ثوانٍ. انظر للكاميرا وحرّك رأسك ببطء لليمين واليسار." mode="video" facingMode="user" cameraOnly file={faceVideo} onChange={setFaceVideo} /><label className="consent-box"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>أوافق صراحة على رفع صور الهوية وفيديو الوجه للتدقيق اليدوي، وأفهم أن الاحتفاظ بها ينتهي بعد المراجعة أو خلال 7 أيام كحد أقصى.</span></label><div className="stage-actions"><button className="button ghost" onClick={() => setStep(3)}><ArrowRight /> رجوع</button><button className="button primary" onClick={finish} disabled={busy || !faceVideo || !consent}>{busy ? 'جاري إرسال طلب المراجعة...' : 'إرسال للمراجعة'}</button></div></div>}
  {step === 5 && <div className="form-stage success-stage"><span className="success-seal"><FileCheck2 /></span><h2>تم استلام طلب التحقق</h2><p>وصلت صور الهوية وفيديو الوجه بشكل مشفّر إلى قائمة المراجعة. ستتحول الهوية إلى الحالة المناسبة بعد تدقيق الموظف المخول.</p><div className="citizen-id-card"><Brand compact /><div><small>رقم طلب المراجعة</small><strong>{reviewId}</strong><span><CheckCircle2 /> فحص الجودة {screeningScore?.toLocaleString('en-US') || '—'}% — قيد المراجعة المخولة</span></div><QrCode /></div><button className="button primary full" onClick={() => navigate('/citizen')}>الدخول إلى حسابي <ArrowLeft /></button></div>}
  {notice && <div className="form-success"><CheckCircle2 /> {notice}</div>}{message && <div className="form-error"><AlertTriangle /> {message}</div>}</section></main></div>
}

const citizenNav = [
  { icon: Gauge, label: 'الرئيسية', href: '/citizen' }, { icon: BriefcaseBusiness, label: 'الخدمات', href: '/citizen#services' },
  { icon: FileText, label: 'معاملاتي', href: '/citizen#my-requests' }, { icon: Bell, label: 'الإشعارات', href: '/citizen#notifications' },
  { icon: CalendarDays, label: 'حجز موعد', href: '/service/online-appointment' }, { icon: QrCode, label: 'التحقق', href: '/verify' },
]

function PortalLayout({ children, role = 'citizen' }: { children: React.ReactNode; role?: 'citizen' | 'employee' }) {
  const [location] = useLocation()
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
  return <div className="portal-shell"><CivicUtilityBar /><aside className={mobileNav ? 'portal-sidebar open' : 'portal-sidebar'}><div className="sidebar-brand"><Brand /><button onClick={() => setMobileNav(false)}><X /></button></div><div className="role-chip">{role === 'citizen' ? <UserRound /> : <Building2 />} {role === 'citizen' ? 'بوابة المواطن' : 'بوابة الموظف'}</div><nav>{nav.map((item, index) => <Link href={item.href} className={location === item.href || (index === 0 && location === '/citizen') ? 'active' : ''} key={item.label}><item.icon /> {item.label}</Link>)}</nav><div className="sidebar-security"><ShieldCheck /><span>جلسة محمية</span><small>آخر نشاط: الآن</small></div><Link href="/login" className="sidebar-logout"><LogIn /> تبديل البوابة</Link></aside><div className="portal-main"><header className="portal-topbar"><button className="mobile-sidebar-button" onClick={() => setMobileNav(true)}><Menu /></button><div className="topbar-search"><Search /><input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="ابحث عن خدمة أو دائرة" aria-label="ابحث داخل المنصة" />{!searchQuery && <span className="search-help">بحث</span>}{searchResults.length > 0 && <div className="topbar-search-results">{searchResults.map(service => <Link href={`/service/${service.key}`} key={service.key} onClick={() => setSearchQuery('')}><span><BriefcaseBusiness /></span><div><strong>{service.title}</strong><small>{service.department} • {service.category}</small></div><ArrowLeft /></Link>)}</div>}</div><div className="topbar-actions"><a className="topbar-notification-link" href={role === 'citizen' ? '#notifications' : '/employee'} aria-label={role === 'citizen' ? 'فتح الإشعارات' : 'فتح قائمة المعاملات'}><Bell /></a><div className="user-avatar">{role === 'citizen' ? 'ح' : 'م'}</div><div><strong>{role === 'citizen' ? 'حساب المواطن' : 'حساب الموظف'}</strong><small>{role === 'citizen' ? 'الخدمات والإشعارات' : 'التدقيق والمعاملات'}</small></div></div></header><main className="portal-content">{children}</main><nav className="mobile-bottom-nav" aria-label="التنقل السريع">{nav.slice(0, 4).map((item, index) => <Link href={item.href} className={location === item.href || (index === 0 && location === '/citizen') ? 'active' : ''} key={`mobile-${item.label}`}><item.icon /><span>{item.label}</span></Link>)}</nav></div></div>
}

function CitizenDashboard() {
  const [citizen, setCitizen] = useState<Citizen | null>(null)
  const [applications, setApplications] = useState<GovernmentApplication[]>([])
  const [serviceRequests, setServiceRequests] = useState<CitizenServiceRequest[]>([])
  const [notifications, setNotifications] = useState<CitizenNotification[]>([])
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const applyNotifications = (payload: { unread: number; items: CitizenNotification[] }) => { setUnreadNotifications(payload.unread); setNotifications(payload.items) }
  useEffect(() => { void Promise.all([api.getDemoCitizen().then(setCitizen), api.listCitizenApplications().then(setApplications), api.listCitizenServiceRequests().then(setServiceRequests), api.getNotifications().then(applyNotifications)]) }, [])
  const readNotification = async (id: string) => applyNotifications(await api.markNotificationRead(id))
  const readAllNotifications = async () => applyNotifications(await api.markAllNotificationsRead())
  const firstName = citizen?.fullName?.trim().split(/\s+/)[0] || 'بك'
  const actionRequired = applications.find(app => app.status === 'ACTION_REQUIRED')
  const activeApplications = applications.filter(app => !['APPROVED', 'REJECTED'].includes(app.status))
  const issuedDocuments = applications.filter(app => app.status === 'APPROVED')
  const nextRequest = serviceRequests[0]
  return <PortalLayout><div className="citizen-v2">
    <section className="citizen-v2-hero">
      <div className="citizen-v2-intro"><span className="citizen-v2-kicker"><BadgeCheck /> حساب مواطن محمي</span><h1>هلا {firstName}،<br /><em>شنو تحب تنجز اليوم؟</em></h1><p>كل خدماتك، طلباتك، وإشعاراتك بمكان واحد وبخطوات واضحة.</p><div className="citizen-v2-hero-actions"><Link href="#services" className="button primary"><BriefcaseBusiness /> تصفح الخدمات</Link><Link href="/service/online-appointment" className="button citizen-quiet-button"><CalendarDays /> احجز موعد</Link></div></div>
      <aside className="citizen-v2-identity-card"><div className="identity-card-top"><span className="identity-avatar">{firstName.slice(0, 1)}</span><div><small>ملف المواطن</small><strong>{citizen?.fullName || 'جاري تحميل الحساب'}</strong></div><BadgeCheck /></div><div className="identity-card-meta"><span><small>حالة الهوية</small><b>{citizen?.verificationStatus === 'VERIFIED' || citizen?.verificationStatus === 'VERIFIED_MANUAL' ? 'تمت المراجعة' : 'قيد المراجعة'}</b></span><span><small>حماية الحساب</small><b>OTP + جلسة آمنة</b></span></div><Link href="/onboarding" className="identity-card-link">إدارة ملف الهوية <ArrowLeft /></Link></aside>
    </section>
    <nav className="citizen-v2-quick-actions" aria-label="اختصارات المواطن"><Link href="/service/store-license"><span><Plus /></span><div><strong>خدمة جديدة</strong><small>ابدأ طلبك</small></div><ArrowLeft /></Link><Link href="/service/online-appointment"><span><CalendarDays /></span><div><strong>حجز موعد</strong><small>اختر وقتك</small></div><ArrowLeft /></Link><Link href="#notifications"><span className={unreadNotifications ? 'notification-dot' : ''}><Bell /></span><div><strong>الإشعارات</strong><small>{unreadNotifications ? `${unreadNotifications.toLocaleString('en-US')} جديد` : 'أنت مطّلع'}</small></div><ArrowLeft /></Link><Link href="/verify"><span><QrCode /></span><div><strong>تحقق من وثيقة</strong><small>مسح QR أو إدخال رقم</small></div><ArrowLeft /></Link></nav>
    <section className="citizen-v2-priority-grid"><article className={actionRequired ? 'citizen-priority-card urgent' : 'citizen-priority-card'}><span className="priority-icon">{actionRequired ? <AlertTriangle /> : <CheckCircle2 />}</span><div><small>{actionRequired ? 'إجراء مطلوب منك' : 'حالة حسابك اليوم'}</small><h2>{actionRequired ? actionRequired.currentAction : 'ماكو إجراء مطلوب حالياً'}</h2><p>{actionRequired ? `${actionRequired.serviceName} • ${actionRequired.reference}` : 'توصلك الإشعارات مباشرة عند وصول تحديث جديد من الدائرة.'}</p></div>{actionRequired ? <Link className="button primary" href={`/citizen/application/${actionRequired.reference}`}>إكمال الإجراء <ArrowLeft /></Link> : <Link className="button outline" href="#services">ابدأ خدمة <Plus /></Link>}</article><article className="citizen-progress-card"><div><span className="section-kicker">MY ACTIVITY</span><h2>ملخص بسيط</h2></div><div className="progress-stat-row"><span><b>{activeApplications.length.toLocaleString('en-US')}</b><small>طلبات جارية</small></span><span><b>{issuedDocuments.length.toLocaleString('en-US')}</b><small>وثائق صادرة</small></span><span><b>{serviceRequests.length.toLocaleString('en-US')}</b><small>طلبات عامة</small></span></div></article></section>
    <section className="citizen-v2-services" id="services"><header className="citizen-section-heading"><div><span className="section-kicker">DIGITAL SERVICES</span><h2>ابدأ الخدمة المناسبة إلك</h2><p>اختَر الخدمة، عبّي استمارتها الخاصة، وراح تتابع كل تحديث من حسابك.</p></div><Link href="/service/online-appointment">حجز موعد <ArrowLeft /></Link></header><div className="citizen-service-deck">{services.slice(0, 6).map((service, index) => <Link href={`/service/${service.key}`} className={index === 0 ? 'citizen-service-card featured' : 'citizen-service-card'} key={service.key}><div><span className="service-card-icon"><BriefcaseBusiness /></span><small>{service.department}</small></div><h3>{service.title}</h3><p>{service.description}</p><footer><span>{service.fee ? formatIQD(service.fee) : 'مجانية'}</span><ArrowLeft /></footer></Link>)}</div></section>
    <section className="citizen-v2-workspace" id="my-requests"><article className="citizen-workspace-card"><header className="citizen-section-heading compact"><div><span className="section-kicker">MY REQUESTS</span><h2>تابع معاملاتك</h2></div><Link href="/service/store-license">خدمة جديدة <Plus /></Link></header>{applications.length === 0 ? <div className="citizen-empty"><FileText /><div><strong>بعدك ما بدأت أي معاملة</strong><span>ابدأ خدمة وراح يظهر رقم المتابعة والحالة هنا.</span></div><Link className="button primary" href="/service/store-license">ابدأ الآن</Link></div> : <div className="citizen-application-list">{applications.slice(0, 4).map(app => <Link href={`/citizen/application/${app.reference}`} className="citizen-application-row" key={app.reference}><span className={`citizen-application-icon ${app.status.toLowerCase()}`}><BriefcaseBusiness /></span><div><div><strong>{app.serviceName}</strong><em className={`status ${app.status.toLowerCase()}`}>{statusLabels[app.status]}</em></div><small>{app.reference} • {app.department}</small><p>{app.currentAction}</p></div><ChevronLeft /></Link>)}</div>}</article><aside className="citizen-workspace-card citizen-notification-card" id="notifications"><header className="citizen-section-heading compact"><div><span className="section-kicker">UPDATES</span><h2>آخر الإشعارات</h2></div>{unreadNotifications > 0 && <button className="text-action" onClick={() => void readAllNotifications()}>تعليم الكل كمقروء</button>}</header>{notifications.length === 0 ? <div className="citizen-empty compact"><Bell /><div><strong>لا توجد تحديثات جديدة</strong><span>تنبيهات الهوية والطلبات والمواعيد تظهر هنا.</span></div></div> : <div className="citizen-notification-list">{notifications.slice(0, 4).map(item => item.link ? <Link href={item.link} className={item.readAt ? 'citizen-notification-row read' : 'citizen-notification-row unread'} key={item.id} onClick={() => { if (!item.readAt) void readNotification(item.id) }}><span><Bell /></span><div><strong>{item.title}</strong><p>{item.message}</p><time>{new Date(item.createdAt).toLocaleString('en-GB')}</time></div></Link> : <button className={item.readAt ? 'citizen-notification-row read' : 'citizen-notification-row unread'} key={item.id} onClick={() => void readNotification(item.id)}><span><Bell /></span><div><strong>{item.title}</strong><p>{item.message}</p><time>{new Date(item.createdAt).toLocaleString('en-GB')}</time></div></button>)}</div>}</aside></section>
    {nextRequest && <section className="citizen-v2-reminder"><span><CalendarDays /></span><div><small>آخر طلب مسجل</small><strong>{getServiceDefinition(nextRequest.serviceKey)?.title || nextRequest.serviceKey}</strong><p>{nextRequest.currentAction}</p></div><Link className="button outline" href="/service/online-appointment">حجز موعد آخر <ArrowLeft /></Link></section>}
  </div></PortalLayout>
}

function DynamicServiceFormPage({ serviceKey }: { serviceKey: string }) {
  const definition = getServiceDefinition(serviceKey)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ reference: string; currentAction: string; department: string; appointment: { preferredDate: string; preferredTime: string; status: string } | null } | null>(null)
  if (!definition) return <NotFound />
  if (definition.mode === 'EXTERNAL') return <PortalLayout><section className="national-service-page"><header><Link href="/citizen"><ArrowRight /> الرجوع</Link><span className="national-service-seal"><Landmark /></span><div className="section-kicker">OFFICIAL NATIONAL SERVICE</div><h1>{definition.title}</h1><p>{definition.description}</p><div className="national-service-meta"><span><Building2 /> {definition.department}</span><span><Clock3 /> {definition.estimatedTime}</span><span><ReceiptText /> {definition.feeNote}</span></div></header><div className="national-service-grid"><article><h2>قبل الانتقال إلى الخدمة</h2><p>جهّز الوثائق التالية واتبع تعليمات الجهة المالكة داخل موقعها أو تطبيقها الرسمي.</p><ul>{definition.requirements.map(item => <li key={item}><CheckCircle2 /> {item}</li>)}</ul></article><aside><h2>الروابط الرسمية</h2><div className="official-handoff-links">{definition.officialLinks?.map((link, index) => <a className={index === 0 ? 'button primary' : 'button outline'} href={link.url} target="_blank" rel="noreferrer" key={link.url}>{link.label} <ExternalLink /></a>)}</div><div className="handoff-security"><ShieldCheck /><span>{definition.boundaryNote}</span></div></aside></div><footer><BadgeCheck /><span>تأكد أن النطاق المفتوح يعود إلى بوابة أور أو وزارة الداخلية قبل إدخال بياناتك.</span></footer></section></PortalLayout>
  const today = new Date().toISOString().slice(0, 10)
  const maxDate = new Date(); maxDate.setDate(maxDate.getDate() + 90)
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError('')
    const form = new FormData(event.currentTarget)
    const data = Object.fromEntries(definition.fields.map(field => [field.key, String(form.get(field.key) || '').trim()]))
    try { setResult(await api.createServiceRequest(definition.key, data)) } catch (submitError) { setError((submitError as Error).message) } finally { setBusy(false) }
  }
  if (result) return <PortalLayout><section className="service-success"><span><CheckCircle2 /></span><div className="section-kicker">REQUEST REGISTERED</div><h1>{definition.mode === 'APPOINTMENT' ? 'تم إرسال طلب الموعد' : 'تم تسجيل طلب الخدمة'}</h1><p>{result.currentAction}</p><div className="service-success-data"><span><small>رقم الطلب</small><strong>{result.reference}</strong></span><span><small>الدائرة</small><strong>{result.department}</strong></span>{result.appointment && <><span><small>التاريخ المفضل</small><strong>{new Date(`${result.appointment.preferredDate}T00:00:00`).toLocaleDateString('en-GB')}</strong></span><span><small>الوقت المفضل</small><strong>{result.appointment.preferredTime}</strong></span></>}</div><Link className="button primary" href="/citizen">العودة إلى حساب المواطن <ArrowLeft /></Link></section></PortalLayout>
  return <PortalLayout><div className="service-form-header"><Link href="/citizen"><ArrowRight /> الرجوع</Link><span>{definition.mode === 'APPOINTMENT' ? 'حجز موعد' : 'استمارة خدمة'}</span><h1>{definition.title}</h1><p>{definition.description}</p><div><span><Building2 /> {definition.department}</span><span><Clock3 /> {definition.estimatedTime}</span><span><ReceiptText /> {definition.feeNote}</span></div></div><form className="dynamic-service-form" onSubmit={submit}><section className="form-card"><div className="form-card-title"><span>1</span><div><h2>بيانات مقدم الطلب</h2><p>تُستخدم بيانات حساب المواطن بعد تأكيد الهاتف ومراجعة الهوية.</p></div></div><div className="verified-profile"><div className="profile-avatar">مو</div><div><small>الحساب</small><strong>مواطن مسجل <BadgeCheck /></strong></div><span>جلسة محمية</span></div></section><section className="form-card"><div className="form-card-title"><span>2</span><div><h2>بيانات {definition.mode === 'APPOINTMENT' ? 'الموعد' : 'الخدمة'}</h2><p>الحقول أدناه خاصة بهذه الخدمة وتتحقق منها المنصة قبل الإرسال.</p></div></div><div className="form-grid dynamic-fields">{definition.fields.map(field => <label className={field.type === 'textarea' ? 'wide' : ''} key={field.key}>{field.label}{field.required && <b aria-hidden="true"> *</b>}{field.type === 'select' ? <select name={field.key} required={field.required} defaultValue=""><option value="" disabled>اختر</option>{field.options?.map(option => <option value={option} key={option}>{option}</option>)}</select> : field.type === 'textarea' ? <textarea name={field.key} required={field.required} maxLength={field.maxLength} placeholder={field.placeholder} rows={4} /> : <input name={field.key} type={field.type} required={field.required} maxLength={field.maxLength} placeholder={field.placeholder} min={field.type === 'date' ? today : undefined} max={field.type === 'date' ? maxDate.toISOString().slice(0, 10) : undefined} />}</label>)}</div></section><section className="form-card requirements-card"><div className="form-card-title"><span>3</span><div><h2>المتطلبات ومسار الطلب</h2><p>تظهر المتطلبات المعروفة فقط، وقد تطلب الدائرة مستنداً إضافياً بعد التدقيق.</p></div></div><ul>{definition.requirements.map(item => <li key={item}><CheckCircle2 /> {item}</li>)}</ul><div className="service-policy-note"><ShieldCheck /><span>إرسال الاستمارة يسجل الطلب داخل المنصة ويرسله إلى قائمة الدائرة. حجز الموعد يبقى بانتظار تأكيد الموظف ولا يتحول إلى موعد نهائي تلقائياً.</span></div></section>{error && <div className="form-error"><AlertTriangle /> {error}</div>}<div className="dynamic-form-submit"><button className="button primary" type="submit" disabled={busy}>{busy ? 'جاري تسجيل الطلب...' : definition.mode === 'APPOINTMENT' ? 'إرسال طلب الموعد' : 'إرسال طلب الخدمة'} <Send /></button></div></form></PortalLayout>
}

function ServiceFormPage({ serviceKey }: { serviceKey: string }) {
  const definition = getServiceDefinition(serviceKey)
  if (!definition) return <NotFound />
  return definition.mode === 'SPECIALIZED' ? <SpecializedServiceFormPage serviceKey={serviceKey} /> : <DynamicServiceFormPage serviceKey={serviceKey} />
}

function SpecializedServiceFormPage({ serviceKey }: { serviceKey: string }) {
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
  type Review = { id: string; status: string; citizenName: string; phoneMasked: string; nationalIdMasked: string; consentAt: string; submittedAt: string; retentionUntil: string; notes: string | null; screening: { qualityStatus: string; qualityScore: number | null; qualityChecks: Array<{ key: string; label: string; passed: boolean; detail: string }>; faceMatchStatus: string; faceMatchScore: number | null; faceMatchProvider: string | null }; media: Array<{ id: string; label: string; mimeType: string; sizeBytes: number }> }
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
  return <section className="identity-review-admin"><div className="identity-review-head"><div><span className="section-kicker">مراجعة الهوية والوسائط</span><h2>ملفات الهوية والفيديو</h2><p>تُفتح المرفقات بتفويض مستقل، وتُسجل المشاهدة والقرار، ثم تُحذف الوسائط عند اكتمال المراجعة.</p></div><div className="review-access"><input type="password" value={accessCode} onChange={e => setAccessCode(e.target.value)} placeholder="رمز دخول المراجع" autoComplete="off" /><button className="button primary" onClick={load} disabled={busy || accessCode.length < 8}>{busy ? 'جاري الفتح...' : 'فتح قائمة المراجعة'}</button></div></div>{error && <div className="form-error"><AlertTriangle /> {error}</div>}{reviews.length > 0 && <div className="identity-review-grid"><div className="identity-review-list">{reviews.map(review => <button key={review.id} className={selected?.id === review.id ? 'identity-review-row selected' : 'identity-review-row'} onClick={() => { setSelected(review); setNotes(review.notes || '') }}><span className={review.status === 'PENDING_REVIEW' ? 'review-status pending' : 'review-status'}>{labels[review.status] || review.status}</span><strong>{review.citizenName}</strong><small>{review.nationalIdMasked} • {review.phoneMasked}</small><time>{new Date(review.submittedAt).toLocaleString('en-GB')}</time></button>)}</div><div className="identity-review-detail">{selected && <><div className="review-citizen-title"><div><span className="review-status pending">{labels[selected.status] || selected.status}</span><h3>{selected.citizenName}</h3><p>{selected.nationalIdMasked} • {selected.phoneMasked}</p></div><small>حذف تلقائي: {new Date(selected.retentionUntil).toLocaleString('en-GB')}</small></div><div className="identity-screening-panel"><div className="screening-score"><span>{selected.screening.qualityScore?.toLocaleString('en-US') || '—'}%</span><div><strong>فحص جودة آلي</strong><small>{selected.screening.qualityStatus === 'PASSED' ? 'اكتملت اختبارات الملف قبل الحفظ' : 'تحتاج الوسائط إلى إعادة تصوير'}</small></div></div><div className="screening-checks">{selected.screening.qualityChecks.map(item => <span className={item.passed ? 'passed' : 'failed'} key={item.key}>{item.passed ? <Check /> : <X />}<b>{item.label}</b><small>{item.detail}</small></span>)}</div><div className="face-match-boundary"><Fingerprint /><div><strong>مطابقة الوجه بالهوية</strong><span>{selected.screening.faceMatchStatus === 'PROVIDER_REQUIRED' ? 'لم يُربط مزود KYC / Liveness معتمد؛ القرار يبقى مراجعة بشرية ولا تُعرض نسبة مطابقة مصطنعة.' : `المزود: ${selected.screening.faceMatchProvider || 'غير محدد'}`}</span></div></div></div><div className="review-media-grid">{selected.media.map(media => <article key={media.id} className="review-media-card"><div><span><FileArchive /></span><strong>{media.label}</strong><small>{media.mimeType} • {(media.sizeBytes / 1024).toFixed(1)} KB</small></div>{mediaUrls[media.id] ? mediaUrls[media.id].mimeType.startsWith('video/') ? <video src={mediaUrls[media.id].url} controls playsInline /> : <img src={mediaUrls[media.id].url} alt={media.label} /> : <button className="button outline" onClick={() => openMedia(media.id)}><Eye /> فتح الوسيط</button>}</article>)}</div>{selected.status === 'PENDING_REVIEW' && <><label className="review-notes">ملاحظة المراجع<textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} placeholder="اكتب ملاحظة القرار أو سبب طلب إعادة الرفع" /></label><div className="review-actions identity-decisions"><button className="button outline danger" onClick={() => decide('REJECTED')} disabled={busy}>رفض</button><button className="button outline" onClick={() => decide('NEEDS_RESUBMISSION')} disabled={busy}>طلب إعادة الرفع</button><button className="button primary" onClick={() => decide('APPROVED')} disabled={busy}><CheckCircle2 /> اعتماد بعد المراجعة وحذف الوسائط</button></div></>}</>}</div></div>}</section>
}

function EmployeeDashboard() {
  const [apps, setApps] = useState<GovernmentApplication[]>([]); const [selected, setSelected] = useState<GovernmentApplication | null>(null); const [busy, setBusy] = useState(false); const [authenticated, setAuthenticated] = useState<boolean | null>(null); const [employeeCode, setEmployeeCode] = useState(''); const [authError, setAuthError] = useState(''); const [reviewAccessCode, setReviewAccessCode] = useState(''); const [openedMedia, setOpenedMedia] = useState<{ url: string; mimeType: string; label: string } | null>(null); const [mediaError, setMediaError] = useState('')
  const load = useCallback(async () => { const items = await api.listApplications(); setApps(items); setSelected(current => !current || !items.find(item => item.reference === current.reference) ? items[0] || null : items.find(item => item.reference === current.reference) || null) }, [])
  useEffect(() => { api.getSession().then(session => { const allowed = session.role === 'EMPLOYEE' || session.role === 'IDENTITY_REVIEWER'; setAuthenticated(allowed); if (allowed) void load() }).catch(() => setAuthenticated(false)) }, [load])
  const loginEmployee = async () => { setBusy(true); setAuthError(''); try { await api.loginEmployee(employeeCode); setReviewAccessCode(employeeCode); setAuthenticated(true); await load() } catch (error) { setAuthError((error as Error).message) } finally { setBusy(false) } }
  const openAttachment = async (mediaId: string, label: string) => { if (!reviewAccessCode.trim()) return setMediaError('أدخل رمز وصول المراجعة أولاً.'); setMediaError(''); try { const item = await api.loadReviewMedia(mediaId, reviewAccessCode); setOpenedMedia({ ...item, label }) } catch (error) { setMediaError((error as Error).message) } }; const act = async (kind: 'request' | 'approve') => { if (!selected) return; setBusy(true); if (kind === 'request') await api.requestDocument(selected.reference, 'عقد الإيجار المحدّث'); else await api.approveApplication(selected.reference); await load(); setBusy(false) }
  if (authenticated === null) return <PortalLayout role="employee"><div className="employee-auth-loading"><RefreshCw className="spin" /><span>جاري التحقق من جلسة الموظف...</span></div></PortalLayout>
  if (!authenticated) return <PortalLayout role="employee"><section className="employee-login-gate"><div className="employee-login-icon"><LockKeyhole /></div><span className="section-kicker">EMPLOYEE SECURE ACCESS</span><h1>دخول الموظف</h1><p>أدخل رمز الوصول الحكومي. تُنشأ جلسة مشفرة محدودة المدة ولا تُحمّل أي معاملة قبل نجاح التحقق.</p><label>رمز الوصول<input type="password" value={employeeCode} onChange={event => setEmployeeCode(event.target.value)} autoComplete="current-password" onKeyDown={event => { if (event.key === 'Enter' && employeeCode.length >= 8) void loginEmployee() }} /></label>{authError && <div className="form-error"><AlertTriangle /> {authError}</div>}<button className="button primary full" onClick={loginEmployee} disabled={busy || employeeCode.length < 8}>{busy ? 'جاري التحقق...' : 'دخول آمن'}</button><div className="employee-login-note"><ShieldCheck /><span>تُسجل محاولات الدخول والإجراءات الحساسة في سجل التدقيق.</span></div></section></PortalLayout>
  return <PortalLayout role="employee"><section className="employee-heading"><div><span>الثلاثاء، 26 آب 2026</span><h1>صباح الخير، سارة</h1><p>لديك {apps.filter(a => a.status !== 'APPROVED').length} معاملات تحتاج مراجعة اليوم.</p></div><button className="button outline" onClick={() => void load()} disabled={busy}><RefreshCw /> تحديث قائمة العمل</button></section><section className="employee-kpis"><div><span className="blue"><FileText /></span><small>جديدة</small><strong>{apps.filter(a => a.status === 'SUBMITTED').length}</strong></div><div><span className="green"><Eye /></span><small>قيد التدقيق</small><strong>{apps.filter(a => a.status === 'UNDER_REVIEW').length}</strong></div><div><span className="amber"><Bell /></span><small>بانتظار المواطن</small><strong>{apps.filter(a => a.status === 'ACTION_REQUIRED').length}</strong></div><div><span className="red"><Clock3 /></span><small>متأخرة</small><strong>0</strong></div></section><div className="employee-workspace"><section className="work-queue"><div className="queue-toolbar"><div><h2>قائمة المعاملات</h2><span>{apps.length} نتيجة</span></div><button><Search /></button></div>{apps.length === 0 ? <div className="empty-queue"><FileText /><p>لا توجد معاملات. قدّم طلباً من بوابة المواطن أولاً.</p></div> : apps.map(app => <button className={selected?.reference === app.reference ? 'queue-item selected' : 'queue-item'} key={app.reference} onClick={() => setSelected(app)}><div><strong>{app.serviceName}</strong><span className={`status ${app.status.toLowerCase()}`}>{statusLabels[app.status]}</span></div><small>{app.reference} • {app.citizenName}</small><p>{app.currentAction}</p><time>{new Date(app.updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time></button>)}</section><section className="review-panel">{selected ? <><div className="review-header"><div><span className={`status ${selected.status.toLowerCase()}`}>{statusLabels[selected.status]}</span><h2>{selected.serviceName}</h2><p>{selected.reference}</p></div><button><FileArchive /></button></div><div className="citizen-access-notice"><ShieldCheck /><span><strong>وصول حسب الحاجة الوظيفية</strong><small>بيانات الهوية الحساسة مخفية، وتم تسجيل فتح المعاملة في سجل التدقيق.</small></span></div><div className="review-section"><h3>بيانات المواطن</h3><div className="review-data-grid"><span><small>الاسم</small><strong>{selected.citizenName} <BadgeCheck /></strong></span><span><small>الرقم الوطني</small><strong>********** 4821</strong></span><span><small>القضاء</small><strong>{selected.district}</strong></span><span><small>حالة الهوية</small><strong>موثّقة يدوياً أو قيد المراجعة</strong></span></div></div><div className="review-section"><h3>بيانات النشاط</h3><div className="review-data-grid"><span><small>المحل</small><strong>{selected.businessName}</strong></span><span><small>النشاط</small><strong>{selected.activityType}</strong></span><span className="wide"><small>العنوان</small><strong>{selected.address}</strong></span></div></div><div className="review-section"><h3>المستندات والمرفقات</h3><label className="review-access-field">رمز وصول المراجعة<input value={reviewAccessCode} onChange={event => setReviewAccessCode(event.target.value)} type="password" placeholder="رمز المراجع" autoComplete="current-password" /></label>{selected.attachments.length === 0 ? <div className="review-document empty"><FileText /><div><strong>لا توجد مرفقات محفوظة</strong><small>تظهر المرفقات عند إرسالها من نموذج الخدمة.</small></div></div> : selected.attachments.map(item => <div className="review-document" key={item.id}><FileText /><div><strong>{item.label}</strong><small>{item.originalName} • {Math.ceil(item.sizeBytes / 1024)} KB • محمي</small></div><button type="button" onClick={() => openAttachment(item.mediaId, item.label)} aria-label={`فتح ${item.label}`}><Eye /></button></div>)}{mediaError && <div className="form-error"><AlertTriangle /> {mediaError}</div>}{openedMedia && <div className="employee-media-preview"><div><strong>{openedMedia.label}</strong><button type="button" onClick={() => { URL.revokeObjectURL(openedMedia.url); setOpenedMedia(null) }}><X /></button></div>{openedMedia.mimeType.startsWith('video/') ? <video src={openedMedia.url} controls playsInline /> : openedMedia.mimeType === 'application/pdf' ? <iframe src={openedMedia.url} title={openedMedia.label} /> : <img src={openedMedia.url} alt={openedMedia.label} />}</div>}</div><div className="review-actions"><button className="button outline danger" onClick={() => act('request')} disabled={busy}><Bell /> طلب مستند</button><button className="button primary" onClick={() => act('approve')} disabled={busy || selected.status === 'ACTION_REQUIRED' || selected.status === 'PAYMENT_REQUIRED' || selected.status === 'APPROVED'}><CheckCircle2 /> {selected.status === 'APPROVED' ? 'تمت الموافقة' : selected.status === 'PAYMENT_REQUIRED' ? 'بانتظار الدفع' : 'موافقة وإصدار الوثيقة'}</button></div></> : <div className="empty-queue"><FileText /><p>اختر معاملة لبدء التدقيق.</p></div>}</section></div><IdentityReviewPanel /></PortalLayout>
}

function OperationsShell({ children, active = 'operations' }: { children: React.ReactNode; active?: string }) {
  return <div className="ops-shell"><CivicUtilityBar /><aside className="ops-sidebar"><Brand compact /><nav><Link href="/operations" className={active === 'operations' ? 'active' : ''}><Map /><span>غرفة العمليات</span></Link><Link href="/governor" className={active === 'governor' ? 'active' : ''}><Landmark /><span>لوحة المحافظ</span></Link><a href="/operations#departments"><Building2 /><span>الدوائر</span></a><a href="/operations#finance"><CircleDollarSign /><span>المالية</span></a><a href="/operations#operations-alerts"><MessageSquareWarning /><span>التنبيهات</span></a><a href="/operations#system-health"><Activity /><span>صحة النظام</span></a><Link href="/employee"><FileArchive /><span>التدقيق</span></Link><Link href="/super-admin" className={active === 'super-admin' ? 'active' : ''}><ShieldCheck /><span>إدارة المنصة</span></Link></nav><Link href="/login" className="ops-exit"><LogIn /></Link></aside><main className="ops-main">{children}</main></div>
}

function DhiQarMap({ departments }: { departments: DashboardStats['departments'] }) {
  const located = departments.filter((department): department is typeof department & { lat: number; lng: number } => typeof department.lat === 'number' && typeof department.lng === 'number')
  return <section className="real-gis-shell"><div className="real-gis-head"><div><span className="section-kicker">VERIFIED GIS LOCATIONS</span><h2>خريطة الدوائر ذات المواقع المتحققة</h2><p>تعرض الخريطة مواقع الجهات التي توافرت لها إحداثيات منشأة محددة. اضغط على النقطة لعرض المصدر وحالة البيانات.</p></div><span><Map /> {located.length.toLocaleString('en-US')} موقع موثّق</span></div><MapContainer center={[31.052, 46.249]} zoom={13} scrollWheelZoom className="real-gis-map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />{located.map(department => <CircleMarker key={department.id} center={[department.lat, department.lng]} radius={9} pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#0a8f50', fillOpacity: 1 }}><LeafletTooltip direction="top" offset={[0, -8]} opacity={1}>{department.name}</LeafletTooltip><Popup><div className="gis-popup"><strong>{department.name}</strong><span>{department.district} — {department.type}</span><small>{department.lat.toFixed(6)}, {department.lng.toFixed(6)}</small>{department.sourceUrl && <a href={department.sourceUrl} target="_blank" rel="noreferrer">فتح مصدر الموقع ↗</a>}</div></Popup></CircleMarker>)}</MapContainer><div className="real-gis-legend"><span><i className="verified" /> إحداثيات منشأة متحققة</span><span><i className="pending" /> الجهات بلا نقطة تبقى في السجل ولا تُرسم</span></div></section>

}

function OperationsRegistryPanel({ stats }: { stats: DashboardStats }) {
  return <section className="ops-registry-grid"><article className="dark-panel registry-panel" id="departments"><div className="panel-heading"><div><h2>سجل دوائر ذي قار</h2><p>{stats.registry?.verified || stats.departments.length} جهات بمصادر حكومية متحققة</p></div><Building2 /></div><div className="registry-table">{stats.departments.map(dept => <div key={dept.id}><span className={dept.dataStatus === 'VERIFIED_SOURCE' ? 'verified' : 'pending'} /> <strong>{dept.name}</strong><small>{dept.type} • {dept.gisStatus === 'COORDINATES_VERIFIED' ? 'GIS مكتمل' : 'بانتظار GIS'}</small>{dept.sourceUrl && <a href={dept.sourceUrl} target="_blank" rel="noreferrer">المصدر</a>}</div>)}</div></article><article className="dark-panel finance-panel" id="finance"><div className="panel-heading"><div><h2>المالية والواردات</h2><p>تُعرض فقط عمليات الدفع المسجلة من بوابة دفع معتمدة.</p></div><CircleDollarSign /></div><div className="finance-total"><small>تحصيل مسجل</small><strong>{formatIQD(stats.financialCollection)}</strong></div><div className="finance-note"><ShieldCheck /><span>لا توجد تسوية مالية حية أو تحصيل فعلي قبل ربط مزود الدفع وحساب التاجر وWebhook المطابقة.</span></div></article></section>
}

function OperationsCenter() {
  const [stats, setStats] = useState(defaultStats); const [now, setNow] = useState(() => new Date()); useEffect(() => { api.getStats().then(setStats).catch(() => setStats(defaultStats)) }, []); useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer) }, [])
  const verifiedLocations = stats.departments.filter(department => typeof department.lat === 'number' && typeof department.lng === 'number').length
  const pie = [{ name: 'مكتملة', value: stats.completed, color: '#26d980' }, { name: 'قيد المعالجة', value: Math.max(stats.todayApplications - stats.completed, 1), color: '#2a73ff' }, { name: 'متأخرة', value: stats.overdue, color: '#ff5964' }]
  return <OperationsShell><header className="ops-header"><div><span><Activity /> OPERATIONAL VIEW</span><h1>غرفة العمليات المركزية</h1><p>محافظة ذي قار • آخر تحديث {now.toLocaleTimeString('en-GB')}</p></div><div className="ops-header-actions"><span className="clock">{now.toLocaleTimeString('en-GB')}<small>توقيت بغداد</small></span><a href="#operations-alerts" className="ops-alert-link" aria-label="الانتقال إلى التنبيهات"><Bell /></a><div className="user-avatar">عم</div></div></header><section className="ops-kpis"><div><span><FileText /></span><small>معاملات اليوم</small><strong>{stats.todayApplications.toLocaleString('en-GB')}</strong><em>مسجل</em></div><div><span><CheckCircle2 /></span><small>المكتملة</small><strong>{stats.completed.toLocaleString('en-GB')}</strong><em>مسجل</em></div><div><span><Clock3 /></span><small>متوسط الإنجاز</small><strong>{stats.avgProcessingHours ? `${stats.avgProcessingHours} س` : '—'}</strong><em>يتطلب SLA</em></div><div><span><UsersRound /></span><small>مواطنون نشطون</small><strong>{stats.activeCitizens.toLocaleString('en-GB')}</strong><em>مسجل</em></div><div><span><CircleDollarSign /></span><small>التحصيل اليوم</small><strong>{formatIQD(stats.financialCollection)}</strong><em>تسويات مؤكدة</em></div><div><span><Network /></span><small>مواقع GIS موثقة</small><strong>{verifiedLocations.toLocaleString('en-US')}</strong><em>نقطة منشأة</em></div></section><section className="ops-dashboard-grid"><div className="ops-map-panel"><div className="panel-heading"><div><h2>Dhi Qar GIS Command Center</h2><p>الوضع التشغيلي للدوائر والخدمات</p></div><div className="map-legend"><span><i className="online" /> موقع موثّق</span><span><i className="degraded" /> بانتظار GIS</span></div></div><DhiQarMap departments={stats.departments} /></div><div className="ops-side-stack"><div className="dark-panel"><div className="panel-heading"><div><h3>تدفق المعاملات</h3><p>آخر 6 أيام</p></div><RouteIcon /></div><ResponsiveContainer width="100%" height={180}><AreaChart data={stats.series}><defs><linearGradient id="greenArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#26d980" stopOpacity={0.45}/><stop offset="100%" stopColor="#26d980" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#ffffff10" vertical={false}/><XAxis dataKey="day" tick={{ fill: '#91a89d', fontSize: 11 }} axisLine={false} tickLine={false}/><YAxis hide/><Tooltip contentStyle={{ background: '#09291d', border: '1px solid #1c5d40', borderRadius: 12 }} /><Area type="monotone" dataKey="applications" stroke="#26d980" fill="url(#greenArea)" strokeWidth={2}/></AreaChart></ResponsiveContainer></div><div className="dark-panel health-panel" id="system-health"><div className="panel-heading"><div><h3>صحة المنظومة</h3><p>المكونات الحرجة</p></div><Activity /></div>{[['API Gateway','متاح'],['قاعدة البيانات','تحتاج مراقبة'],['التخزين والوثائق','تحتاج مراقبة'],['خدمة الرسائل','مفعّلة بضوابط'],['التحقق والهوية','مراجعة بشرية']].map(([name, value]) => <div className="health-row" key={String(name)}><span>{name}</span><div><i style={{ width: value === 'متاح' ? '100%' : '35%' }}/></div><b>{value}</b></div>)}</div></div><div className="dark-panel transactions-panel"><div className="panel-heading"><div><h3>حالة معاملات اليوم</h3><p>التوزيع الحالي</p></div><Gauge /></div><div className="pie-wrap"><ResponsiveContainer width="52%" height={190}><PieChart><Pie data={pie} dataKey="value" innerRadius={52} outerRadius={74} paddingAngle={3}>{pie.map(item => <Cell key={item.name} fill={item.color}/>)}</Pie></PieChart></ResponsiveContainer><div className="pie-legend">{pie.map(item => <span key={item.name}><i style={{ background: item.color }}/><small>{item.name}</small><strong>{item.value.toLocaleString('en-GB')}</strong></span>)}</div></div></div><div className="dark-panel alerts-panel" id="operations-alerts"><div className="panel-heading"><div><h3>التنبيهات التشغيلية</h3><p>تحتاج متابعة</p></div><Bell /></div><div className="alert-item medium"><Activity /><span><strong>تهيئة مراقبة الأداء مطلوبة</strong><small>لا تُعرض تنبيهات SLA أو أزمنة استجابة قبل ربط مصدر قياس معتمد.</small></span></div><div className="alert-item low"><CircleDollarSign /><span><strong>بوابة الدفع تحتاج الربط</strong><small>لا تصدر وثيقة مدفوعة ولا يسجل تحصيل قبل مزود دفع وتطابق Webhook.</small></span></div></div></section><OperationsRegistryPanel stats={stats} /></OperationsShell>
}

function GovernorDashboard() {
  const [stats, setStats] = useState(defaultStats); useEffect(() => { api.getStats().then(setStats).catch(() => {}) }, []); const ranked = useMemo(() => [...stats.departments].sort((a, b) => b.transactions - a.transactions), [stats])
  return <OperationsShell active="governor"><header className="ops-header governor-header"><div><span><Landmark /> EXECUTIVE OVERVIEW</span><h1>لوحة المحافظ</h1><p>ملخص تنفيذي لأداء الحكومة المحلية دون إظهار البيانات الشخصية للمواطنين</p></div><div className="ops-header-actions"><span className="period-button">سجل المنصة الحالي <CalendarDays /></span><div className="user-avatar gold">مح</div></div></header><section className="executive-score"><div><span className="score-ring"><b>—</b><small>/100</small></span><div><small>مؤشر الأداء الحكومي</small><strong>بانتظار مصدر قياس مؤسسي</strong><p>لا يُحسب قبل ربط مؤشرات SLA والرضا من الجهة المالكة</p></div></div><div className="executive-mini"><span><small>الالتزام بالـSLA</small><strong>—</strong><i style={{ width: '0%' }}/></span><span><small>رضا المواطنين</small><strong>—</strong><i style={{ width: '0%' }}/></span><span><small>طلبات مكتملة</small><strong>{stats.completed.toLocaleString('en-US')}</strong><i style={{ width: stats.todayApplications ? `${Math.min(100, Math.round((stats.completed / stats.todayApplications) * 100))}%` : '0%' }}/></span></div></section><section className="governor-grid"><div className="governor-map-card"><div className="panel-heading"><div><h2>خريطة أداء ذي قار</h2><p>الدوائر والمناطق التشغيلية</p></div><Link href="/operations">عرض GIS الكامل <ArrowLeft /></Link></div><DhiQarMap departments={stats.departments} /></div><div className="ranking-card"><div className="panel-heading"><div><h3>ترتيب الدوائر</h3><p>حسب الطلبات المسجلة في المنصة</p></div><Gauge /></div>{ranked.map((dept, index) => <div className="ranking-row" key={dept.id}><b>{index + 1}</b><div><strong>{dept.name}</strong><small>{dept.district}</small></div><span>{dept.transactions.toLocaleString('en-US')} طلب مسجل</span></div>)}</div><div className="governor-chart-card"><div className="panel-heading"><div><h3>المعاملات المكتملة</h3><p>الطلب مقابل الإنجاز</p></div></div><ResponsiveContainer width="100%" height={250}><BarChart data={stats.series}><CartesianGrid stroke="#153c2d" vertical={false}/><XAxis dataKey="day" tick={{ fill: '#8aa399', fontSize: 11 }} axisLine={false}/><YAxis hide/><Tooltip contentStyle={{ background: '#09291d', border: '1px solid #1c5d40', borderRadius: 12 }}/><Bar dataKey="applications" fill="#255a43" radius={[5,5,0,0]}/><Bar dataKey="completed" fill="#26d980" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></div><div className="executive-alerts"><h3>متطلبات تشغيل الأداء</h3>{[['01','ربط مؤشرات SLA','لا تُحسب أزمنة الإنجاز أو التأخير قبل تحديد SLA من الدوائر'],['02','استكمال مواقع GIS','الجهات بلا إحداثيات لا تظهر كنقاط على الخريطة'],['03','ربط بوابة الدفع','لا يسجل تحصيل أو تسوية قبل مزود الدفع وWebhook']].map(([n,t,s]) => <div key={n}><span className="priority-number">{n}</span><p><strong>{t}</strong><small>{s}</small></p><ArrowLeft /></div>)}</div></section></OperationsShell>
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
  return <div className="verify-page"><CivicUtilityBar /><header className="verify-header container"><Brand /><Link href="/"><ArrowRight /> الرئيسية</Link></header><main className="container scanner-content"><section className="scanner-card"><span className="scanner-icon"><QrCode /></span><span className="section-kicker">تحقق من وثيقة صادرة</span><h1>امسح رمز QR أو أدخل المعرّف</h1><p>يفتح المسح سجل التحقق العام ويعرض الحد الأدنى من بيانات الوثيقة. لا ترفع صورة QR إلى خادم المنصة.</p>{cameraOpen && <div className="scanner-camera"><video ref={videoRef} autoPlay playsInline muted /><button className="button ghost" onClick={stopCamera}>إيقاف الكاميرا</button></div>}<div className="scanner-actions"><button className="button primary" onClick={startScanner}><Camera /> مسح بالكاميرا</button><div className="scanner-divider"><span>أو</span></div><label>معرّف التحقق أو رابط QR<input value={value} onChange={event => setValue(event.target.value)} placeholder="TQD-..." autoComplete="off" /></label><button className="button outline" onClick={() => parseAndOpen(value)}>تحقق الآن <ArrowLeft /></button></div>{error && <div className="form-error"><AlertTriangle /> {error}</div>}</section></main></div>
}

function VerifyPage({ verificationId }: { verificationId: string }) {
  const [app, setApp] = useState<GovernmentApplication | null>(null); const [error, setError] = useState('')
  useEffect(() => { api.verifyDocument(verificationId).then(setApp).catch(() => setError('لم يتم العثور على وثيقة بهذا المعرّف.')) }, [verificationId])
  return <div className="verify-page"><CivicUtilityBar /><header className="verify-header container"><Brand /><Link href="/"><ArrowRight /> الرئيسية</Link></header><main className="container verify-content">{app ? <div className="verification-result valid"><span className="verification-icon"><BadgeCheck /></span><span className="section-kicker">DIGITAL DOCUMENT VERIFICATION</span><h1>الوثيقة صحيحة ضمن سجل المنصة</h1><p>تم إصدار هذه الوثيقة من سجل ذي قار الرقمية ويمكن التحقق من بياناتها هنا. يبقى نفاذها خارج المنصة مرتبطاً باعتماد الجهة المختصة.</p><div className="verification-data"><span><small>نوع الوثيقة</small><strong>إجازة ممارسة نشاط تجاري</strong></span><span><small>رقم الوثيقة</small><strong>{app.documentNumber}</strong></span><span><small>رقم المعاملة</small><strong>{app.reference}</strong></span><span><small>صاحب الوثيقة</small><strong>{app.citizenName}</strong></span><span><small>الحالة</small><strong>فعّالة في سجل المنصة</strong></span><span><small>تاريخ الإصدار</small><strong>{new Date(app.updatedAt).toLocaleDateString('en-GB')}</strong></span></div><div className="verification-hash"><QrCode /><span><small>Verification ID</small><strong>{app.verificationId}</strong></span></div></div> : error ? <div className="verification-result invalid"><span className="verification-icon"><AlertTriangle /></span><h1>تعذر التحقق</h1><p>{error}</p><Link className="button primary" href="/">العودة للرئيسية</Link></div> : <div className="loading-state"><RefreshCw className="spin" /> جاري التحقق من الوثيقة...</div>}</main></div>
}

function SessionGate({ role, children }: { role: 'CITIZEN' | 'EMPLOYEE' | 'SUPER_ADMIN'; children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'allowed' | 'denied'>('loading')
  useEffect(() => { api.getSession().then(session => setState(session.role === role || (role === 'EMPLOYEE' && (session.role === 'IDENTITY_REVIEWER' || session.role === 'SUPER_ADMIN')) ? 'allowed' : 'denied')).catch(() => setState('denied')) }, [role])
  if (state === 'loading') return <div className="access-gate-page"><RefreshCw className="spin" /><span>جاري التحقق من الجلسة...</span></div>
  if (state === 'denied') return <div className="access-gate-page denied"><Brand /><span className="access-gate-icon"><LockKeyhole /></span><h1>الدخول مطلوب</h1><p>{role === 'CITIZEN' ? 'أكد رقم هاتفك لإدارة معاملاتك وبياناتك بأمان.' : role === 'SUPER_ADMIN' ? 'سجّل دخولك بحساب المدير العام قبل فتح إدارة المنصة.' : 'سجّل دخولك بحساب الموظف قبل فتح الشاشات التشغيلية.'}</p><Link className="button primary" href={role === 'CITIZEN' ? '/onboarding' : role === 'SUPER_ADMIN' ? '/super-admin/login' : '/employee'}>{role === 'CITIZEN' ? 'تأكيد الهاتف' : role === 'SUPER_ADMIN' ? 'دخول المدير العام' : 'دخول الموظف'} <ArrowLeft /></Link></div>
  return <>{children}</>
}

function NotFound() { return <div className="not-found"><Brand /><strong>404</strong><h1>الصفحة غير موجودة</h1><p>المسار الذي فتحته غير متاح أو تم نقله إلى مسار آخر.</p><Link href="/" className="button primary">العودة للرئيسية</Link></div> }

function App() {
  return <Switch><Route path="/" component={LandingPage} /><Route path="/login" component={LoginPage} /><Route path="/super-admin/login" component={SuperAdminLogin} /><Route path="/super-admin"><SessionGate role="SUPER_ADMIN"><SuperAdminDashboard /></SessionGate></Route><Route path="/onboarding" component={OnboardingPage} /><Route path="/citizen"><SessionGate role="CITIZEN"><CitizenDashboard /></SessionGate></Route><Route path="/service/:key">{params => <ServiceFormPage serviceKey={params.key} />}</Route><Route path="/citizen/application/:reference">{params => <ApplicationPage reference={params.reference} />}</Route><Route path="/employee" component={EmployeeDashboard} /><Route path="/operations"><SessionGate role="EMPLOYEE"><OperationsCenter /></SessionGate></Route><Route path="/governor"><SessionGate role="EMPLOYEE"><GovernorDashboard /></SessionGate></Route><Route path="/verify" component={VerifyScanner} /><Route path="/verify/:id">{params => <VerifyPage verificationId={params.id} />}</Route><Route component={NotFound} /></Switch>
}

export default App
