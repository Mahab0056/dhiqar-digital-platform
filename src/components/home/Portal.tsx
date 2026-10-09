import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation } from 'wouter'
import {
  Ambulance,
  ArrowLeft,
  Baby,
  BadgeCheck,
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  CalendarCheck,
  Car,
  ChevronLeft,
  ClipboardCheck,
  CreditCard,
  Droplet,
  FileSearch,
  Flame,
  Fuel,
  Globe2,
  GraduationCap,
  HandHeart,
  HardHat,
  HeartHandshake,
  HeartPulse,
  House,
  IdCard,
  Inbox,
  Info,
  KeyRound,
  Landmark,
  LayoutGrid,
  Leaf,
  LifeBuoy,
  Map as MapIcon,
  MapPin,
  MessageSquareWarning,
  Palette,
  Plane,
  Phone,
  Play,
  Receipt,
  Scale,
  School,
  ScanLine,
  ShieldCheck,
  ShoppingBasket,
  Siren,
  Smartphone,
  Store,
  Trash2,
  TrendingUp,
  Trophy,
  Truck,
  Wheat,
  Wifi,
  X,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { CatalogService, CatalogSummary, DepartmentDirectoryResponse, ServiceChannel } from '../../types'
import { useSession } from '../../lib/session'
import { departmentCount, serviceCount } from '../../lib/arabic-count'

/* ============================================================================================
   Shared bits
   ============================================================================================ */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'الوثائق الحكومية': IdCard,
  'السكن والأراضي': House,
  'الرعاية والعمل': HandHeart,
  'الشكاوى والمراجعات': MessageSquareWarning,
  'الأمن والمرور': Car,
  'التعليم العالي': GraduationCap,
  'الماء والمجاري': Droplet,
  الزراعة: Wheat,
  'البناء والبلديات': HardHat,
  'الضرائب والمالية': Receipt,
  'الطرق والنظافة': Trash2,
  الصحة: HeartPulse,
  'العدل والقضاء': Scale,
  'التربية والتعليم': School,
  'المحلات والأعمال': Store,
  الكهرباء: Zap,
  الاستثمار: TrendingUp,
  'النفط والطاقة': Fuel,
  الأوقاف: Landmark,
  البيئة: Leaf,
  'الثقافة والسياحة': Palette,
  'النقل والاتصالات': Wifi,
  'الشباب والرياضة': Trophy,
  'التخطيط والإحصاء': BarChart3,
  التخطيط: MapIcon,
  'حكومة محلية': Landmark,
}
const categoryIcon = (category: string) => CATEGORY_ICONS[category] || LayoutGrid

// a few well-known services get their own picture; the rest use their category's icon
const SERVICE_ICONS: Record<string, LucideIcon> = {
  'civ-passport-new': Plane,
  'civ-residence-card-new': House,
  'supply-ration-card-new': ShoppingBasket,
  'online-appointment': CalendarCheck,
  'elec-fault-report': Zap,
  'police-non-conviction': ShieldCheck,
}
const serviceIcon = (service: CatalogService) => SERVICE_ICONS[service.key] || categoryIcon(service.category)

const CHANNEL: Record<ServiceChannel, { label: string; icon: LucideIcon; tone: string }> = {
  ONLINE_SUBMISSION: { label: 'إلكترونية بالكامل', icon: Globe2, tone: 'online' },
  APPOINTMENT_REQUIRED: { label: 'إلكترونية + مراجعة', icon: CalendarCheck, tone: 'visit' },
  INFORMATION_ONLY: { label: 'معلومات وإرشاد', icon: Info, tone: 'info' },
}

function ChannelBadge({ channel }: { channel: ServiceChannel }) {
  const meta = CHANNEL[channel]
  return (
    <span className={`ld-badge is-${meta.tone}`}>
      <meta.icon aria-hidden="true" />
      {meta.label}
    </span>
  )
}

function SectionHead({
  id,
  kicker,
  title,
  lead,
  action,
}: {
  id: string
  kicker: string
  title: string
  lead?: string
  action?: { label: string; href: string }
}) {
  return (
    <div className="ld-sec-head" data-reveal>
      <div>
        <span className="ld-kicker">{kicker}</span>
        <h2 id={id}>{title}</h2>
        {lead && <p>{lead}</p>}
      </div>
      {action && (
        <Link href={action.href} className="ld-more">
          {action.label} <ArrowLeft aria-hidden="true" />
        </Link>
      )}
    </div>
  )
}

/** Picks catalog services by key in order, skipping keys the catalog does not have. */
const pick = (catalog: Map<string, CatalogService>, keys: string[], limit = keys.length) =>
  keys
    .map(key => catalog.get(key))
    .filter((item): item is CatalogService => Boolean(item))
    .slice(0, limit)

/* ============================================================================================
   3 · Most requested services
   ============================================================================================ */
// the first eight that exist are shown; the rest stand in if a key is ever retired from the catalog
const POPULAR_KEYS = [
  'nid-first-issue',
  'civ-passport-new',
  'civ-residence-card-new',
  'supply-ration-card-new',
  'spa-register',
  'store-license',
  'building-permit',
  'water-complaint',
  'elec-fault-report',
  'online-appointment',
  'police-non-conviction',
  'traffic-driving-license-renew',
]

export function PortalPopular({ catalog }: { catalog: Map<string, CatalogService> | null }) {
  const services = catalog ? pick(catalog, POPULAR_KEYS, 8) : []
  return (
    <section className="ld-sec" id="popular" aria-labelledby="ld-popular-title">
      <div className="ld-wrap">
        <SectionHead
          id="ld-popular-title"
          kicker="ابدأ من هنا"
          title="الخدمات الأكثر طلباً"
          lead="أكثر ما يحتاجه المواطنون في ذي قار، جاهز للتقديم مباشرة."
          action={{ label: 'كل الخدمات', href: '/directory' }}
        />
        <ul className="ld-services">
          {catalog
            ? services.map((service, index) => {
                const Icon = serviceIcon(service)
                return (
                  <li key={service.key} data-reveal data-reveal-delay={(index % 4) * 60}>
                    <Link href={`/service/${service.key}`} className="ld-service">
                      <span className="ld-service-icon">
                        <Icon aria-hidden="true" />
                      </span>
                      <strong>{service.title}</strong>
                      <small>{service.departmentName}</small>
                      <span className="ld-service-foot">
                        <ChannelBadge channel={service.channel} />
                        <ChevronLeft aria-hidden="true" className="ld-service-go" />
                      </span>
                    </Link>
                  </li>
                )
              })
            : Array.from({ length: 8 }, (_, index) => <li key={index} className="ld-skeleton" aria-hidden="true" />)}
        </ul>
      </div>
    </section>
  )
}

/* ============================================================================================
   4 · Browse by category
   ============================================================================================ */
const CATEGORY_PREVIEW = 11

export function PortalCategories({ summary }: { summary: CatalogSummary | null }) {
  const [all, setAll] = useState(false)
  const categories = summary?.categories ?? []
  const shown = all ? categories : categories.slice(0, CATEGORY_PREVIEW)
  return (
    <section className="ld-sec is-tint" id="categories" aria-labelledby="ld-categories-title">
      <div className="ld-wrap">
        <SectionHead
          id="ld-categories-title"
          kicker="تصفّح"
          title="تصفّح حسب الفئة"
          lead="كل خدمات الدوائر مرتّبة حسب الموضوع، لا حسب الوزارة."
        />
        <ul className="ld-cats">
          {summary
            ? shown.map(category => {
                const Icon = categoryIcon(category.label)
                return (
                  <li key={category.label}>
                    <Link href={`/directory?category=${encodeURIComponent(category.label)}`} className="ld-cat">
                      <Icon aria-hidden="true" />
                      <strong>{category.label}</strong>
                      <small>{serviceCount(category.total)}</small>
                    </Link>
                  </li>
                )
              })
            : Array.from({ length: 12 }, (_, index) => (
                <li key={index} className="ld-skeleton is-short" aria-hidden="true" />
              ))}
          {summary && !all && (
            <li>
              <Link href="/directory" className="ld-cat is-all">
                <LayoutGrid aria-hidden="true" />
                <strong>دليل الخدمات كاملاً</strong>
                <small>{serviceCount(summary.total)}</small>
              </Link>
            </li>
          )}
        </ul>
        {summary && categories.length > CATEGORY_PREVIEW && (
          <button
            type="button"
            className="ld-btn is-outline ld-cats-toggle"
            onClick={() => setAll(current => !current)}
          >
            {all ? 'عرض فئات أقل' : `عرض كل الفئات (${categories.length})`}
          </button>
        )}
      </div>
    </section>
  )
}

/* ============================================================================================
   5 · Life events — the services a moment in life needs, across departments
   ============================================================================================ */
const LIFE_EVENTS: Array<{ id: string; title: string; text: string; icon: LucideIcon; query: string; keys: string[] }> =
  [
    {
      id: 'birth',
      title: 'مولود جديد',
      text: 'شهادة الولادة، تسجيله في القيد والبطاقة التموينية',
      icon: Baby,
      query: 'ولادة',
      keys: [
        'health-birth-certificate',
        'court-hujja-birth-death',
        'civ-family-record-update',
        'supply-ration-card-add-member',
        'health-vaccination-card',
        'spa-family-composition-update',
        'nid-first-issue',
      ],
    },
    {
      id: 'marriage',
      title: 'الزواج',
      text: 'الفحص الطبي، عقد الزواج وتسجيله وتحديث البيانات',
      icon: HeartHandshake,
      query: 'زواج',
      keys: [
        'health-premarital-exam',
        'ps-marriage-contract',
        'civ-marriage-registration',
        'nid-data-update',
        'civ-family-record-book',
        'supply-ration-card-new',
      ],
    },
    {
      id: 'home',
      title: 'بناء أو ترميم منزل',
      text: 'إجازة البناء، القروض، وربط الماء والكهرباء',
      icon: House,
      query: 'بناء',
      keys: [
        'building-permit',
        'urban-master-plan-info',
        'hf-construction-loan',
        'hf-renovation-loan',
        'elec-new-supply-meter',
        'water-new-subscription',
      ],
    },
    {
      id: 'business',
      title: 'فتح مشروع أو محل',
      text: 'إجازة المحل، الموافقة الصحية والدفاع المدني',
      icon: Store,
      query: 'محل',
      keys: [
        'store-license',
        'health-shop-sanitary-approval',
        'shat-cd-shop-safety-cert',
        'chamber-membership-new',
        'chamber-company-name-reservation',
        'elec-commercial-subscription',
      ],
    },
    {
      id: 'study',
      title: 'الدراسة والتعليم',
      text: 'التسجيل في المدرسة والجامعة والوثائق الدراسية',
      icon: BookOpen,
      query: 'تسجيل الطلبة',
      keys: [
        'edu-first-grade-registration',
        'edu-student-transfer',
        'edu-school-document-issuance',
        'edu-exam-record-inquiry',
        'utq-new-student-registration',
        'edu-document-authentication-travel',
      ],
    },
    {
      id: 'retire',
      title: 'التقاعد والرعاية الاجتماعية',
      text: 'الحقوق التقاعدية والإعانة الاجتماعية',
      icon: HandHeart,
      query: 'تقاعد',
      keys: [
        'pension-retirement-rights',
        'pension-salary-inquiry',
        'pension-confirmation',
        'pension-heirs',
        'spa-register',
        'spa-annual-statement',
      ],
    },
    {
      id: 'lost',
      title: 'فقدان وثيقة',
      text: 'الإخبار عن الفقدان واستخراج البدل',
      icon: FileSearch,
      query: 'بدل ضائع',
      keys: [
        'police-loss-report',
        'traffic-driving-license-replacement',
        'civ-nationality-certificate',
        'edu-lost-certificate-replacement',
        'civ-record-copy',
        'health-vaccination-card',
      ],
    },
    {
      id: 'move',
      title: 'الانتقال لسكن جديد',
      text: 'نقل بطاقة السكن والتموينية والاشتراكات',
      icon: Truck,
      query: 'نقل',
      keys: [
        'civ-residence-card-transfer',
        'supply-ration-card-transfer',
        'nid-data-update',
        'water-subscriber-name-change',
        'elec-subscriber-name-change',
        'gov-furniture-transfer-approval',
      ],
    },
  ]

export function PortalLifeEvents({ catalog }: { catalog: Map<string, CatalogService> | null }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const event = LIFE_EVENTS.find(item => item.id === openId) || null
  const services = event && catalog ? pick(catalog, event.keys) : []

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (event && !element.open) element.showModal()
    if (!event && element.open) element.close()
  }, [event])

  const open = (id: string, button: HTMLButtonElement) => {
    opener.current = button
    setOpenId(id)
  }
  const close = () => {
    setOpenId(null)
    opener.current?.focus()
  }

  return (
    <section className="ld-sec" id="life-events" aria-labelledby="ld-life-title">
      <div className="ld-wrap">
        <SectionHead
          id="ld-life-title"
          kicker="أحداث الحياة"
          title="ماذا يحدث في حياتك الآن؟"
          lead="اختر المناسبة، ونجمع لك خدمات كل الدوائر التي تحتاجها في مكان واحد."
        />
        <ul className="ld-life">
          {LIFE_EVENTS.map((item, index) => {
            const count = catalog ? pick(catalog, item.keys).length : null
            return (
              <li key={item.id} data-reveal data-reveal-delay={(index % 4) * 60}>
                <button
                  type="button"
                  className="ld-life-card"
                  onClick={eventClick => open(item.id, eventClick.currentTarget)}
                  aria-haspopup="dialog"
                >
                  <span className="ld-life-icon">
                    <item.icon aria-hidden="true" />
                  </span>
                  <strong>{item.title}</strong>
                  <small>{item.text}</small>
                  <span className="ld-life-count">
                    {count === null ? 'جارٍ التحميل…' : serviceCount(count)} <ArrowLeft aria-hidden="true" />
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <dialog
        ref={dialog}
        className="ld-drawer"
        aria-labelledby="ld-drawer-title"
        onClose={() => openId && close()}
        onClick={clickEvent => clickEvent.target === dialog.current && close()}
      >
        {event && (
          <div className="ld-drawer-body">
            <div className="ld-drawer-head">
              <span className="ld-life-icon">
                <event.icon aria-hidden="true" />
              </span>
              <div>
                <span className="ld-kicker">أحداث الحياة</span>
                <h3 id="ld-drawer-title">{event.title}</h3>
                <p>{event.text}</p>
              </div>
              <button type="button" className="ld-drawer-close" onClick={close} aria-label="إغلاق">
                <X aria-hidden="true" />
              </button>
            </div>
            {services.length ? (
              <ol className="ld-drawer-list">
                {services.map(service => (
                  <li key={service.key}>
                    <Link href={`/service/${service.key}`}>
                      <span>
                        <strong>{service.title}</strong>
                        <small>{service.departmentName}</small>
                      </span>
                      <ChannelBadge channel={service.channel} />
                      <ChevronLeft aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="ld-drawer-empty">تعذّر تحميل الخدمات الآن. ابحث عنها في دليل الخدمات.</p>
            )}
            <Link href={`/directory?q=${encodeURIComponent(event.query)}`} className="ld-btn is-ink ld-drawer-more">
              خدمات أخرى عن «{event.query}» <ArrowLeft aria-hidden="true" />
            </Link>
          </div>
        )}
      </dialog>
    </section>
  )
}

/* ============================================================================================
   6 · Track a request / verify a document
   ============================================================================================ */
const PENDING_REF_KEY = 'tqd-pending-track-ref'

export function PortalTrack() {
  const [, navigate] = useLocation()
  const { session, loading } = useSession()
  const [reference, setReference] = useState(() => {
    try {
      return sessionStorage.getItem(PENDING_REF_KEY) || ''
    } catch {
      return ''
    }
  })
  const [needsSignIn, setNeedsSignIn] = useState('')
  const [trackError, setTrackError] = useState('')
  const [docId, setDocId] = useState('')
  const [docError, setDocError] = useState('')

  const track = (event: FormEvent) => {
    event.preventDefault()
    const ref = reference.trim().toUpperCase().replace(/\s+/g, '')
    if (ref.length < 4) {
      setTrackError('اكتب رقم المعاملة كما وصلك، مثل TQS-2026-0001.')
      return
    }
    setTrackError('')
    const path = `/citizen/request/${encodeURIComponent(ref)}`
    if (session?.role === 'CITIZEN') {
      try {
        sessionStorage.removeItem(PENDING_REF_KEY)
      } catch {
        /* storage unavailable */
      }
      navigate(path)
      return
    }
    // keep the reference so it is still here after signing in
    try {
      sessionStorage.setItem(PENDING_REF_KEY, ref)
    } catch {
      /* storage unavailable */
    }
    setNeedsSignIn(path)
  }

  const verify = (event: FormEvent) => {
    event.preventDefault()
    const raw = docId.trim()
    const id = raw.includes('/verify/') ? raw.split('/verify/').pop() || '' : raw
    if (id.length < 4) {
      setDocError('اكتب رمز التحقق المطبوع أسفل الوثيقة، أو امسح رمز QR.')
      return
    }
    setDocError('')
    navigate(`/verify/${encodeURIComponent(id)}`)
  }

  return (
    <section className="ld-sec is-tint" id="track" aria-labelledby="ld-track-title">
      <div className="ld-wrap">
        <SectionHead
          id="ld-track-title"
          kicker="متابعة وتحقق"
          title="تابع معاملتك، أو تحقّق من وثيقة"
          lead="كل طلب يحصل على رقم مرجعي، وكل وثيقة تصدر من المنصة تحمل رمز تحقق يمكن لأي جهة فحصه."
        />
        <div className="ld-track-grid">
          <form className="ld-panel" onSubmit={track} noValidate data-reveal>
            <span className="ld-panel-icon">
              <ScanLine aria-hidden="true" />
            </span>
            <h3>تتبع معاملة</h3>
            <p>أدخل الرقم المرجعي الذي وصلك عند تقديم الطلب لترى مرحلته الحالية وما المطلوب منك.</p>
            <label htmlFor="ld-ref">الرقم المرجعي للمعاملة</label>
            <div className="ld-field">
              <input
                id="ld-ref"
                value={reference}
                onChange={event => {
                  setReference(event.target.value)
                  setNeedsSignIn('')
                }}
                placeholder="TQS-2026-0001"
                dir="ltr"
                autoComplete="off"
                inputMode="text"
                aria-invalid={Boolean(trackError)}
                aria-describedby={trackError ? 'ld-ref-error' : undefined}
              />
              <button type="submit" className="ld-btn is-ink" disabled={loading}>
                تتبع
              </button>
            </div>
            {trackError && (
              <p className="ld-field-error" id="ld-ref-error" role="alert">
                {trackError}
              </p>
            )}
            {needsSignIn && (
              <div className="ld-signin-note" role="status">
                <KeyRound aria-hidden="true" />
                <p>
                  معاملاتك محمية بحسابك. سجّل الدخول برقم هاتفك وسنفتح لك المعاملة مباشرة.
                  <Link href={`/onboarding?continue=${encodeURIComponent(needsSignIn)}`} className="ld-btn is-ink">
                    الدخول ومتابعة المعاملة <ArrowLeft aria-hidden="true" />
                  </Link>
                </p>
              </div>
            )}
            {session?.role === 'CITIZEN' && (
              <Link href="/citizen#my-requests" className="ld-link">
                أو اعرض كل معاملاتي <ArrowLeft aria-hidden="true" />
              </Link>
            )}
          </form>

          <form className="ld-panel" onSubmit={verify} noValidate data-reveal data-reveal-delay="80">
            <span className="ld-panel-icon is-gold">
              <BadgeCheck aria-hidden="true" />
            </span>
            <h3>التحقق من وثيقة</h3>
            <p>تأكّد أن الوثيقة صادرة فعلاً من المنصة وأنها سارية، دون الحاجة إلى حساب.</p>
            <label htmlFor="ld-doc">رمز التحقق</label>
            <div className="ld-field">
              <input
                id="ld-doc"
                value={docId}
                onChange={event => setDocId(event.target.value)}
                placeholder="الرمز المطبوع أسفل الوثيقة"
                dir="ltr"
                autoComplete="off"
                aria-invalid={Boolean(docError)}
                aria-describedby={docError ? 'ld-doc-error' : undefined}
              />
              <button type="submit" className="ld-btn is-ink">
                تحقّق
              </button>
            </div>
            {docError && (
              <p className="ld-field-error" id="ld-doc-error" role="alert">
                {docError}
              </p>
            )}
            <Link href="/verify" className="ld-link">
              <ScanLine aria-hidden="true" /> مسح رمز QR بالكاميرا
            </Link>
          </form>
        </div>
      </div>
    </section>
  )
}

/* ============================================================================================
   7 · How it works — four steps and the explainer video (no pinned scroll)
   ============================================================================================ */
const STEPS = [
  { icon: Smartphone, title: 'سجّل برقم هاتفك', text: 'رمز تحقق يصلك برسالة، بلا كلمة مرور.' },
  { icon: IdCard, title: 'وثّق هويتك', text: 'صوّر البطاقة الوطنية الموحدة مرة واحدة فقط.' },
  { icon: ClipboardCheck, title: 'قدّم الطلب', text: 'املأ الاستمارة وارفع المستمسكات المطلوبة.' },
  { icon: BadgeCheck, title: 'تابع واستلم وثيقتك', text: 'إشعار عند كل تحديث، ووثيقة قابلة للتحقق.' },
]

export function PortalHow() {
  const video = useRef<HTMLVideoElement>(null)
  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState(false)
  const start = () => {
    setStarted(true)
    video.current?.play().catch((error: DOMException) => {
      if (error.name !== 'AbortError') setFailed(true)
    })
  }
  return (
    <section className="ld-sec" id="how" aria-labelledby="ld-how-title">
      <div className="ld-wrap">
        <SectionHead
          id="ld-how-title"
          kicker="كيف تعمل المنصة"
          title="أربع خطوات من الطلب إلى الوثيقة"
          lead="حساب واحد لكل الدوائر. توثّق هويتك مرة واحدة، ثم تقدّم ما تحتاجه من أي مكان."
        />
        <div className="ld-how-grid">
          <ol className="ld-steps">
            {STEPS.map((step, index) => (
              <li key={step.title} data-reveal data-reveal-delay={index * 70}>
                <span className="ld-step-num">{index + 1}</span>
                <span className="ld-step-icon">
                  <step.icon aria-hidden="true" />
                </span>
                <strong>{step.title}</strong>
                <small>{step.text}</small>
              </li>
            ))}
          </ol>
          <div className="ld-player" data-reveal>
            {failed ? (
              <div className="ld-player-fallback">
                <img src="/brand/home/video-poster.jpg" alt="" />
                <p>تعذّر تشغيل الفيديو على هذا الجهاز. الخطوات الأربع مشروحة بجانبه.</p>
              </div>
            ) : (
              <>
                <video
                  ref={video}
                  controls={started}
                  preload="none"
                  playsInline
                  poster="/brand/home/video-poster.jpg"
                  onError={() => setFailed(true)}
                  aria-label="فيديو تعريفي بمنصة ذي قار الرقمية"
                >
                  <source src="/media/explainer.webm" type="video/webm" />
                  <source src="/media/explainer.mp4" type="video/mp4" />
                  <track kind="captions" srcLang="ar" label="العربية" src="/media/explainer.ar.vtt" default />
                </video>
                {!started && (
                  <button type="button" className="ld-play" onClick={start}>
                    <span className="ld-play-ring">
                      <Play aria-hidden="true" />
                    </span>
                    شاهد كيف تعمل المنصة
                    <small>فيديو تعريفي · 40 ثانية · مع ترجمة مكتوبة</small>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        <div className="ld-how-cta" data-reveal>
          <Link href="/onboarding" className="ld-btn is-green">
            إنشاء حساب مواطن <ArrowLeft aria-hidden="true" />
          </Link>
          <Link href="/directory" className="ld-btn is-outline">
            استعراض دليل الخدمات
          </Link>
        </div>
      </div>
    </section>
  )
}

/* ============================================================================================
   8 · For staff and departments
   ============================================================================================ */
const STAFF_FEATURES = [
  { icon: Inbox, title: 'استلام الطلبات وتوزيعها', text: 'طابور عمل لكل دائرة، مع الإسناد والتحويل بين الدوائر.' },
  { icon: ShieldCheck, title: 'تدقيق المستمسكات', text: 'مراجعة كل مستمسك بقبول أو رفض مع سبب واضح للمواطن.' },
  { icon: CalendarCheck, title: 'المواعيد', text: 'تحديد موعد المراجعة الحضورية وإبلاغ المواطن تلقائياً.' },
  { icon: CreditCard, title: 'وصولات الدفع في الدائرة', text: 'تسجيل الرسوم المدفوعة في الدائرة وربطها بالطلب.' },
  { icon: BadgeCheck, title: 'إصدار وثائق قابلة للتحقق', text: 'وثيقة برمز QR يتحقق منها أي شخص من صفحة التحقق.' },
  { icon: BarChart3, title: 'التقارير ولوحة الأداء', text: 'متابعة الإنجاز والتأخير على مستوى الدائرة والمحافظة.' },
]

export function PortalStaff({
  summary,
  departments,
}: {
  summary: CatalogSummary | null
  departments: DepartmentDirectoryResponse | null
}) {
  const figures = [
    { value: departments?.summary.total, label: 'دائرة على المنصة' },
    { value: summary?.channels.ONLINE_SUBMISSION, label: 'خدمة تُقدَّم إلكترونياً بالكامل' },
    { value: summary?.channels.APPOINTMENT_REQUIRED, label: 'خدمة إلكترونية مع موعد مراجعة' },
  ]
  return (
    <section className="ld-sec is-night" id="staff" aria-labelledby="ld-staff-title">
      <div className="ld-wrap ld-staff-grid">
        <div className="ld-staff-copy" data-reveal>
          <span className="ld-kicker">للموظفين والدوائر</span>
          <h2 id="ld-staff-title">بوابة عمل موحّدة لموظفي الدوائر</h2>
          <p>
            كل طلب يقدّمه المواطن يصل إلى الدائرة المختصة مباشرة. الموظف يدقق ويحدد الموعد ويصدر الوثيقة من شاشة واحدة،
            بحساب محمي بالتحقق الثنائي.
          </p>
          <dl className="ld-staff-figures">
            {figures.map(figure => (
              <div key={figure.label}>
                <dd>{figure.value === undefined ? '—' : figure.value.toLocaleString('en-US')}</dd>
                <dt>{figure.label}</dt>
              </div>
            ))}
          </dl>
          <div className="ld-staff-actions">
            <Link href="/staff/login" className="ld-btn is-light">
              <Briefcase aria-hidden="true" /> دخول الموظفين
            </Link>
            <Link href="/departments" className="ld-btn is-line">
              دليل الدوائر
            </Link>
          </div>
        </div>
        <ul className="ld-staff-features">
          {STAFF_FEATURES.map((feature, index) => (
            <li key={feature.title} data-reveal data-reveal-delay={(index % 2) * 70}>
              <feature.icon aria-hidden="true" />
              <strong>{feature.title}</strong>
              <small>{feature.text}</small>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ============================================================================================
   9 · Departments and districts
   ============================================================================================ */
export function PortalDepartments({
  departments,
  catalog,
}: {
  departments: DepartmentDirectoryResponse | null
  catalog: Map<string, CatalogService> | null
}) {
  const perDistrict = new Map<string, number>()
  for (const item of departments?.items ?? []) perDistrict.set(item.district, (perDistrict.get(item.district) || 0) + 1)

  // the departments with the most services on the platform
  const perDepartment = new Map<string, number>()
  for (const service of catalog?.values() ?? [])
    perDepartment.set(service.departmentId, (perDepartment.get(service.departmentId) || 0) + 1)
  const featured = (departments?.items ?? [])
    .map(item => ({ item, total: perDepartment.get(item.id) || 0 }))
    .filter(entry => entry.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 6)

  return (
    <section className="ld-sec" id="departments" aria-labelledby="ld-departments-title">
      <div className="ld-wrap">
        <SectionHead
          id="ld-departments-title"
          kicker="الدوائر والأقضية"
          title="دوائر المحافظة في كل الأقضية"
          lead={
            departments
              ? `${departmentCount(departments.summary.total)} في ${departments.districts.length} قضاءً، بعناوينها ومواقعها وخدماتها.`
              : 'دوائر المحافظة بعناوينها ومواقعها وخدماتها.'
          }
          action={{ label: 'دليل الدوائر والخريطة', href: '/departments' }}
        />
        <div className="ld-dept-grid">
          <div className="ld-panel ld-districts" data-reveal>
            <h3>
              <MapPin aria-hidden="true" /> الأقضية
            </h3>
            <ul>
              {departments
                ? departments.districts.map(district => (
                    <li key={district}>
                      <Link href={`/departments?district=${encodeURIComponent(district)}`}>
                        {district}
                        <small>{perDistrict.get(district) || 0}</small>
                      </Link>
                    </li>
                  ))
                : Array.from({ length: 10 }, (_, index) => (
                    <li key={index} className="ld-skeleton is-chip" aria-hidden="true" />
                  ))}
            </ul>
          </div>
          <ul className="ld-depts">
            {featured.length
              ? featured.map(({ item, total }, index) => (
                  <li key={item.id} data-reveal data-reveal-delay={(index % 3) * 60}>
                    <Link href={`/departments/${item.id}`} className="ld-dept">
                      <Building2 aria-hidden="true" />
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {item.district} · {serviceCount(total)}
                        </small>
                      </span>
                      <ChevronLeft aria-hidden="true" />
                    </Link>
                  </li>
                ))
              : Array.from({ length: 6 }, (_, index) => (
                  <li key={index} className="ld-skeleton is-short" aria-hidden="true" />
                ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

/* ============================================================================================
   10 · FAQ
   ============================================================================================ */
const FAQ = [
  {
    q: 'كيف أنشئ حساباً في المنصة؟',
    a: 'اضغط «دخول المواطن» واكتب رقم هاتفك، فيصلك رمز تحقق لمرة واحدة. لا تحتاج إلى كلمة مرور، ونفس الرقم يدخلك في كل مرة.',
  },
  {
    q: 'لماذا أحتاج إلى توثيق هويتي بالبطاقة الوطنية الموحدة؟',
    a: 'التوثيق يضمن أن الطلب صادر منك فعلاً. تصوّر وجهي البطاقة الوطنية الموحدة مرة واحدة، ويراجعها موظف مختص، وبعدها تقدّم على كل الخدمات دون تكرار.',
  },
  {
    q: 'ما الفرق بين الخدمة الإلكترونية بالكامل والخدمة التي تحتاج مراجعة؟',
    a: 'الخدمة «الإلكترونية بالكامل» تُنجز من التقديم حتى الاستلام عبر المنصة. أما «إلكترونية + مراجعة» فتقدّمها وترفع مستمسكاتها إلكترونياً، ثم تحضر في موعد محدد لإجراء لا يتم إلا حضورياً مثل البصمة أو التصوير.',
  },
  {
    q: 'كيف أدفع رسوم الخدمة؟',
    a: 'الرسوم الرسمية مذكورة في صفحة كل خدمة عندما تكون معتمدة. تُدفع في الدائرة عند المراجعة، ويسجّل الموظف وصل الدفع في طلبك فتراه في حسابك.',
  },
  {
    q: 'كيف أتابع طلبي بعد تقديمه؟',
    a: 'يصلك رقم مرجعي عند التقديم. تابع حالته من «لوحتي» أو من خانة «تتبع معاملة» في هذه الصفحة، وستصلك إشعارات عند كل تحديث أو طلب نقص.',
  },
  {
    q: 'كيف أتحقق من أن وثيقة صادرة من المنصة أصلية؟',
    a: 'كل وثيقة تحمل رمز QR ورمز تحقق. امسح الرمز أو اكتبه في صفحة «التحقق من وثيقة» لترى حالتها وبيانات إصدارها، دون الحاجة إلى حساب.',
  },
  {
    q: 'هل بياناتي ومستمسكاتي آمنة؟',
    a: 'تُستخدم بياناتك فقط لإنجاز طلباتك، ولا يطّلع عليها إلا الموظف المختص في الدائرة المعنية، وكل اطلاع مسجّل. التفاصيل في سياسة الخصوصية.',
  },
  {
    q: 'لم أجد الخدمة التي أحتاجها، ماذا أفعل؟',
    a: 'جرّب البحث بكلمات بسيطة أو باللهجة المحلية، أو تصفّح الفئات. وإذا لم تكن الخدمة موجودة، أرسل مقترحاً من «الشكاوى والمقترحات» ليصل إلى الجهة المعنية.',
  },
]

export function PortalFaq() {
  return (
    <section className="ld-sec is-tint" id="faq" aria-labelledby="ld-faq-title">
      <div className="ld-wrap ld-faq-grid">
        <div className="ld-faq-head" data-reveal>
          <span className="ld-kicker">الأسئلة الشائعة</span>
          <h2 id="ld-faq-title">أسئلة يطرحها المواطنون كثيراً</h2>
          <p>لم تجد جوابك؟ أرسل سؤالك وسيصلك الرد في حسابك.</p>
          <Link href="/citizen/feedback" className="ld-btn is-outline">
            اسألنا مباشرة
          </Link>
        </div>
        <div className="ld-faq">
          {FAQ.map(item => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>
                {item.a}
                {item.q.includes('آمنة') && (
                  <>
                    {' '}
                    <Link href="/privacy">اقرأ سياسة الخصوصية</Link>.
                  </>
                )}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ============================================================================================
   11 · Emergency numbers and help
   ============================================================================================ */
const EMERGENCY = [
  { number: '104', label: 'الشرطة', icon: Siren },
  { number: '122', label: 'الإسعاف', icon: Ambulance },
  { number: '115', label: 'الدفاع المدني', icon: Flame },
]
const HELP = [
  { href: '#faq', icon: LifeBuoy, title: 'المساعدة والأسئلة', text: 'إجابات عن التسجيل والتوثيق والرسوم.' },
  {
    href: '/citizen/feedback',
    icon: MessageSquareWarning,
    title: 'شكوى أو مقترح',
    text: 'تصل إلى الجهة المعنية وتتابع ردّها.',
  },
  {
    href: '/departments',
    icon: Phone,
    title: 'عناوين الدوائر وأرقامها',
    text: 'مواقع الدوائر على الخريطة ووسائل التواصل.',
  },
]

export function PortalHelp() {
  return (
    <section className="ld-sec" id="help" aria-labelledby="ld-help-title">
      <div className="ld-wrap">
        <SectionHead id="ld-help-title" kicker="المساعدة" title="أرقام الطوارئ والمساعدة" />
        <div className="ld-help-grid">
          <ul className="ld-emergency" aria-label="أرقام الطوارئ">
            {EMERGENCY.map(item => (
              <li key={item.number}>
                <a href={`tel:${item.number}`}>
                  <item.icon aria-hidden="true" />
                  <span>
                    <small>{item.label}</small>
                    <strong dir="ltr">{item.number}</strong>
                  </span>
                  <Phone aria-hidden="true" className="ld-call" />
                </a>
              </li>
            ))}
          </ul>
          <ul className="ld-help">
            {HELP.map(item => (
              <li key={item.title}>
                {item.href.startsWith('#') ? (
                  <a href={item.href}>
                    <item.icon aria-hidden="true" />
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.text}</small>
                    </span>
                  </a>
                ) : (
                  <Link href={item.href}>
                    <item.icon aria-hidden="true" />
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.text}</small>
                    </span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
        <p className="ld-help-note">
          أرقام الطوارئ مجانية وتعمل على مدار الساعة. في حالة الخطر اتصل بها مباشرة، فالمنصة ليست وسيلة للبلاغات
          الطارئة.
        </p>
      </div>
    </section>
  )
}
