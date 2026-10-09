import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'wouter'
import { motion, useScroll, useTransform } from 'framer-motion'
import {
  ArrowLeft,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  Droplet,
  FileText,
  GraduationCap,
  HeartPulse,
  Info,
  Landmark,
  LayoutGrid,
  MapPin,
  Play,
  TrendingUp,
  UserRound,
  UsersRound,
  Zap,
} from 'lucide-react'
import { TQLogoMotion } from './TQLogoMotion'
import { useMotionPref } from './motion-pref'
import geoData from './dhiqar-geo.json'

const css = (vars: Record<string, string | number>) => vars as CSSProperties

/* ============================================================================================
   Header — light over the night hero, turns to dark glass once the page scrolls
   ============================================================================================ */
export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24)
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])
  return (
    <header className={`ld-header${scrolled ? ' is-scrolled' : ''}`}>
      <a className="tq-skip-link" href="#main-content">
        تخطَّ إلى المحتوى
      </a>
      <div className="ld-wrap ld-header-row">
        <Link href="/" className="ld-brand" aria-label="ذي قار الرقمية — الصفحة الرئيسية">
          <img src="/brand/dhiqar-unified-logo.png" alt="" width={34} height={34} />
          <span>ذي قار الرقمية</span>
        </Link>
        <nav className="ld-nav" aria-label="التنقل الرئيسي">
          <a href="#journey">عن المنصة</a>
          <Link href="/directory">الخدمات</Link>
          <a href="#how">كيف تعمل</a>
        </nav>
        <Link href="/login" className="ld-login">
          <UserRound aria-hidden="true" />
          تسجيل الدخول
        </Link>
      </div>
    </header>
  )
}

/* ============================================================================================
   Hero — the night ziggurat, the TQ mark on a lit platform, and the four parties it connects
   ============================================================================================ */
const HUB = { x: 300, y: 250 }
const NODES = [
  { icon: UsersRound, label: 'المواطنون', x: 112, y: 118 },
  { icon: Landmark, label: 'الدوائر الحكومية', x: 494, y: 176 },
  { icon: FileText, label: 'الخدمات الرقمية', x: 94, y: 372 },
  { icon: BarChart3, label: 'غرفة العمليات', x: 498, y: 398 },
]
const spoke = (x: number, y: number) => {
  const mx = (HUB.x + x) / 2
  return `M${HUB.x} ${HUB.y} C${mx} ${HUB.y} ${mx} ${y} ${x} ${y}`
}

export function LandingHero() {
  const ref = useRef<HTMLElement>(null)
  const tile = useRef<HTMLDivElement>(null)
  const { still } = useMotionPref()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const bgY = useTransform(scrollYProgress, [0, 1], still ? ['0%', '0%'] : ['0%', '12%'])
  const visualY = useTransform(scrollYProgress, [0, 1], still ? ['0%', '0%'] : ['0%', '-10%'])
  const copyFade = useTransform(scrollYProgress, [0.5, 0.95], [1, still ? 1 : 0.15])

  // the logo tile leans gently toward the pointer
  useEffect(() => {
    const hero = ref.current
    if (!hero || still || !window.matchMedia('(hover: hover)').matches) {
      tile.current?.style.removeProperty('--rx')
      tile.current?.style.removeProperty('--ry')
      return
    }
    let frame = 0
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const box = hero.getBoundingClientRect()
        const px = (event.clientX - box.left) / box.width - 0.5
        const py = (event.clientY - box.top) / box.height - 0.5
        tile.current?.style.setProperty('--ry', `${(-12 + px * 14).toFixed(2)}deg`)
        tile.current?.style.setProperty('--rx', `${(7 - py * 9).toFixed(2)}deg`)
      })
    }
    hero.addEventListener('pointermove', onMove)
    return () => {
      cancelAnimationFrame(frame)
      hero.removeEventListener('pointermove', onMove)
    }
  }, [still])

  return (
    <section className="ld-hero" id="top" ref={ref} aria-labelledby="ld-hero-title">
      {/* night grade of the Ziggurat of Ur artwork (public/brand/home/hero-night) */}
      <motion.picture className="ld-hero-bg" style={{ y: bgY }} aria-hidden="true">
        <source srcSet="/brand/home/hero-night.webp" type="image/webp" />
        <img src="/brand/home/hero-night.jpg" alt="" fetchPriority="high" />
      </motion.picture>
      <div className="ld-hero-shade" aria-hidden="true" />
      <div className="ld-water" aria-hidden="true" />

      <div className="ld-wrap ld-hero-grid">
        <motion.div className="ld-hero-copy" style={{ opacity: copyFade }}>
          <h1 id="ld-hero-title" className="ld-in" style={css({ '--i': 0 })}>
            محافظة كاملة،
            <em>مترابطة رقمياً.</em>
          </h1>
          <p className="ld-in" style={css({ '--i': 1 })}>
            المواطن والدوائر والخدمات، ضمن منظومة واحدة.
          </p>
          <div className="ld-hero-actions ld-in" style={css({ '--i': 2 })}>
            <Link href="/onboarding" className="ld-btn is-light">
              ابدأ معاملتك <ArrowLeft aria-hidden="true" />
            </Link>
            <a href="#journey" className="ld-btn is-text">
              استكشف المنصة
            </a>
          </div>
        </motion.div>

        <motion.div className="ld-hero-visual" style={{ y: visualY }} aria-hidden="true">
          <svg className="ld-net" viewBox="0 0 600 540">
            <defs>
              <filter id="ld-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3.5" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <radialGradient id="ld-pad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#35d07a" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#35d07a" stopOpacity="0" />
              </radialGradient>
            </defs>
            <ellipse cx="300" cy="404" rx="250" ry="66" fill="url(#ld-pad)" />
            <ellipse className="ld-ring" cx="300" cy="404" rx="262" ry="72" filter="url(#ld-glow)" />
            <ellipse className="ld-ring is-mid" cx="300" cy="404" rx="196" ry="52" />
            <ellipse className="ld-ring is-inner" cx="300" cy="404" rx="128" ry="34" filter="url(#ld-glow)" />
            <ellipse className="ld-orbit" cx="300" cy="262" rx="282" ry="158" transform="rotate(-14 300 262)" />
            <ellipse className="ld-orbit is-2" cx="300" cy="270" rx="250" ry="120" transform="rotate(10 300 270)" />
            {NODES.map((node, index) => (
              <g key={node.label}>
                <path className="ld-spoke" d={spoke(node.x, node.y)} filter="url(#ld-glow)" />
                <path className="ld-pulse" d={spoke(node.x, node.y)} pathLength={100} style={css({ '--i': index })} />
              </g>
            ))}
          </svg>
          {NODES.map((node, index) => (
            <span
              key={node.label}
              className="ld-node"
              style={css({ left: `${(node.x / 600) * 100}%`, top: `${(node.y / 540) * 100}%`, '--i': index })}
            >
              <node.icon />
              {node.label}
            </span>
          ))}
          <div className="ld-hub" style={{ left: `${(HUB.x / 600) * 100}%`, top: `${(HUB.y / 540) * 100}%` }}>
            <div className="ld-tile" ref={tile}>
              <TQLogoMotion speed={0.6} play={!still} />
            </div>
          </div>
        </motion.div>
      </div>

      <a href="#journey" className="ld-cue">
        اكتشف أكثر <ChevronDown aria-hidden="true" />
      </a>
    </section>
  )
}

/* ============================================================================================
   From request to completion — a sticky scene: the form card changes state as the page scrolls
   ============================================================================================ */
const STEPS = [
  { title: 'اختر خدمتك', text: 'حدد الخدمة من بين خدمات الدوائر.' },
  { title: 'ارفع مستمسكاتك', text: 'أرفق المستندات المطلوبة بسهولة.' },
  { title: 'تابع معاملتك', text: 'احصل على إشعارات بكل مرحلة.' },
]

export function LandingJourney() {
  const ref = useRef<HTMLElement>(null)
  const { still } = useMotionPref()
  const [stage, setStage] = useState(1)
  const [sticky, setSticky] = useState(false)

  // the scroll-linked version only on wide screens with motion on; phones get a plain section
  useEffect(() => {
    const query = window.matchMedia('(min-width: 960px)')
    const update = () => setSticky(query.matches && !still)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [still])

  // stage follows how far the visitor has scrolled through the pinned section
  useEffect(() => {
    if (!sticky) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const section = ref.current
        if (!section) return
        const travel = section.offsetHeight - window.innerHeight
        const progress = travel > 0 ? -section.getBoundingClientRect().top / travel : 0
        setStage(progress < 0.3 ? 0 : progress < 0.66 ? 1 : 2)
      })
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [sticky])

  const choose = (index: number) => {
    setStage(index)
    const section = ref.current
    if (!sticky || !section) return
    const travel = section.offsetHeight - window.innerHeight
    window.scrollTo({ top: section.offsetTop + travel * [0.15, 0.48, 0.85][index], behavior: 'smooth' })
  }

  return (
    <section
      className={`ld-journey${sticky ? ' is-sticky' : ''}`}
      id="journey"
      ref={ref}
      aria-labelledby="ld-journey-title"
    >
      <div className="ld-journey-stage">
        <div className="ld-wrap ld-journey-grid">
          <div className="ld-journey-copy" data-reveal>
            <h2 id="ld-journey-title">
              من الطلب
              <em>إلى الإنجاز.</em>
            </h2>
            <p>خطوات واضحة، ومتابعة بكل مرحلة.</p>
            <ol className="ld-steps">
              {STEPS.map((step, index) => (
                <li key={step.title} className={index === stage ? 'is-on' : index < stage ? 'is-done' : ''}>
                  <button
                    type="button"
                    onClick={() => choose(index)}
                    aria-current={index === stage ? 'step' : undefined}
                  >
                    <span className="ld-step-num">
                      {index < stage ? <Check aria-hidden="true" /> : (index + 1).toLocaleString('ar-IQ')}
                    </span>
                    <span className="ld-step-text">
                      <b>{step.title}</b>
                      <small>{step.text}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <div className="ld-journey-visual" data-stage={stage} aria-hidden="true">
            <div className="ld-receipt">
              <span className="ld-receipt-check">
                <Check />
              </span>
              <b>تم استلام الطلب</b>
              <p>سيتم إشعارك بمستجدات المعاملة عبر حسابك في المنصة.</p>
              <span className="ld-receipt-ref">TQD-2026-0418</span>
              <span className="ld-fake-btn">متابعة الطلب</span>
              <ul>
                <li />
                <li />
                <li />
              </ul>
            </div>

            <div className="ld-form">
              <div className="ld-form-head">
                <b>طلب خدمة</b>
                <i />
              </div>
              <ol className="ld-stepper">
                {['اختيار الخدمة', 'رفع المستمسكات', 'إرسال الطلب'].map((label, index) => (
                  <li key={label} className={index === stage ? 'is-on' : index < stage ? 'is-done' : ''}>
                    <span>{index < stage ? <Check /> : (index + 1).toLocaleString('ar-IQ')}</span>
                    {label}
                  </li>
                ))}
              </ol>
              <label className={`ld-field${stage === 0 ? ' is-focus' : ''}`}>
                <small>نوع الخدمة</small>
                <span>
                  إجازة بناء دار سكنية <ChevronDown />
                </span>
              </label>
              <label className="ld-field">
                <small>الجهة المستفيدة</small>
                <span>
                  مديرية بلدية الناصرية <ChevronDown />
                </span>
              </label>
              <div className="ld-field">
                <small>المستمسكات المطلوبة</small>
                <div className={`ld-doc${stage >= 1 ? ' is-up' : ''}`}>
                  <span className="ld-pdf">PDF</span>
                  <span className="ld-doc-text">
                    <b>البطاقة الوطنية الموحدة · pdf</b>
                    <small>{stage >= 1 ? 'تم الرفع بنجاح' : 'بانتظار الرفع'}</small>
                  </span>
                  <span className="ld-doc-check">
                    <Check />
                  </span>
                  <i className="ld-doc-bar" />
                </div>
              </div>
              <span className={`ld-submit${stage === 2 ? ' is-sent' : ''}`}>
                {stage === 2 ? (
                  <>
                    <Check /> تم إرسال الطلب
                  </>
                ) : (
                  <>
                    إرسال الطلب <ArrowLeft />
                  </>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ============================================================================================
   The governorate in front of you — operations room with the real district map
   ============================================================================================ */
type GeoPoint = { n: string; c: string; d: string; p: number[] }
const geo = geoData as {
  W: number
  H: number
  gov: string
  districts: Array<{ name: string; d: string }>
  points: GeoPoint[]
}
// five real, spread-out municipal offices get a labelled pin; every other department is a dot
const LABELLED = [
  ['مديرية بلدية الناصرية', 'بلدية الناصرية'],
  ['مديرية بلدية الشطرة', 'بلدية الشطرة'],
  ['مديرية بلدية الرفاعي', 'بلدية الرفاعي'],
  ['مديرية بلدية سوق الشيوخ', 'بلدية سوق الشيوخ'],
  ['مديرية بلدية الجبايش', 'بلدية الجبايش'],
] as const
const labelled = LABELLED.map(([name, label]) => ({ point: geo.points.find(p => p.n === name), label })).filter(
  (item): item is { point: GeoPoint; label: (typeof LABELLED)[number][1] } => Boolean(item.point)
)
const PERF = [
  { icon: Landmark, name: 'دائرة البلدية', v: 86 },
  { icon: GraduationCap, name: 'دائرة التربية', v: 74 },
  { icon: HeartPulse, name: 'دائرة الصحة', v: 81 },
  { icon: Zap, name: 'دائرة الكهرباء', v: 63 },
  { icon: Droplet, name: 'الموارد المائية', v: 70 },
]
const SUMMARY = [
  { icon: FileText, label: 'المعاملات', value: '١٢٬٤٨٠', bars: [78, 46], tone: '' },
  { icon: TrendingUp, label: 'الإيرادات', value: '١٨٦ م.د', bars: [64, 38], tone: '' },
  { icon: Bell, label: 'التنبيهات', value: '٣٧ متأخرة', bars: [42, 22], tone: 'is-alert' },
]

export function LandingOperations() {
  const board = useRef<HTMLDivElement>(null)
  const { still } = useMotionPref()
  const [hover, setHover] = useState<GeoPoint | null>(null)
  const [on, setOn] = useState(false)
  // the board starts tilted back like a wall of screens and settles flat as it scrolls into view
  const { scrollYProgress } = useScroll({ target: board, offset: ['start end', 'start 0.3'] })
  const tilt = useTransform(scrollYProgress, [0, 1], still ? [0, 0] : [18, 0])
  const scale = useTransform(scrollYProgress, [0, 1], still ? [1, 1] : [0.9, 1])

  useEffect(() => {
    const element = board.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setOn(true)
          observer.disconnect()
        }
      },
      { threshold: 0.25 }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <section className="ld-ops" id="operations" aria-labelledby="ld-ops-title">
      <div className="ld-ops-backdrop" aria-hidden="true" />
      <div className="ld-wrap">
        <div className="ld-ops-head" data-reveal>
          <div>
            <span className="ld-eyebrow">غرفة العمليات المركزية</span>
            <h2 id="ld-ops-title">المحافظة أمامك.</h2>
            <p>رؤية موحدة، وقرارات أوضح.</p>
          </div>
          <a href="#how" className="ld-btn is-line">
            <BarChart3 aria-hidden="true" /> عرض توضيحي
          </a>
        </div>

        <motion.div
          className="ld-board"
          ref={board}
          data-on={on ? '' : undefined}
          style={{ rotateX: tilt, scale, transformPerspective: 1400 }}
        >
          <span className="ld-demo">
            <Info aria-hidden="true" /> بيانات تجريبية للعرض — ليست أرقاماً حقيقية
          </span>

          <aside className="ld-board-side">
            <div className="ld-mini">
              <b>محافظة ذي قار</b>
              <svg viewBox={`0 0 ${geo.W} ${geo.H}`} aria-hidden="true">
                <path d={geo.gov} />
              </svg>
            </div>
            <ul className="ld-menu">
              <li>
                <LayoutGrid aria-hidden="true" /> الخدمات
              </li>
              <li>
                <FileText aria-hidden="true" /> المعاملات
              </li>
              <li className="is-on">
                <MapPin aria-hidden="true" /> الخريطة التفاعلية
              </li>
              <li>
                <Bell aria-hidden="true" /> التنبيهات
              </li>
            </ul>
          </aside>

          <div className="ld-map">
            <svg viewBox={`0 0 ${geo.W} ${geo.H}`} role="img" aria-label="خريطة أقضية محافظة ذي قار ومواقع الدوائر">
              <defs>
                <linearGradient id="ld-land" x1="0" y1="0" x2="0.5" y2="1">
                  <stop offset="0%" stopColor="#4f8f4a" />
                  <stop offset="100%" stopColor="#1f5a35" />
                </linearGradient>
                <pattern id="ld-grain" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(32)">
                  <path d="M0 0H8" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="2" />
                </pattern>
              </defs>
              {geo.districts.map((district, index) => (
                <path key={district.name} className="ld-district" d={district.d} style={css({ '--s': index })} />
              ))}
              {geo.districts.map(district => (
                <path key={`g-${district.name}`} d={district.d} fill="url(#ld-grain)" pointerEvents="none" />
              ))}
              <path className="ld-gov" d={geo.gov} />
              {geo.points.map((point, index) => (
                <circle
                  key={point.n}
                  className="ld-dot"
                  cx={point.p[0]}
                  cy={point.p[1]}
                  r="4"
                  style={css({ '--s': index })}
                  onMouseEnter={() => setHover(point)}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>{point.n}</title>
                </circle>
              ))}
              {labelled.map(({ point, label }, order) => (
                <g
                  key={point.n}
                  className="ld-pin"
                  style={css({ '--s': order })}
                  transform={`translate(${point.p[0]} ${point.p[1]})`}
                >
                  <path d="M0 0 C-9 -12 -14 -19 -14 -27 A14 14 0 1 1 14 -27 C14 -19 9 -12 0 0Z" />
                  <circle cy="-27" r="5.5" fill="#fff" />
                  <rect x={-(label.length * 7 + 22) / 2} y="-72" width={label.length * 7 + 22} height="26" rx="13" />
                  <text x="0" y="-54.5">
                    {label}
                  </text>
                </g>
              ))}
            </svg>
            <div className="ld-map-caption">
              {hover ? (
                <>
                  <b>{hover.n}</b>
                  <small>
                    {hover.c} · {hover.d}
                  </small>
                </>
              ) : (
                <>
                  <b>{geo.points.length.toLocaleString('ar-IQ')} دائرة بمواقعها الحقيقية</b>
                  <small>حدود الأقضية ومواقع الدوائر من OpenStreetMap</small>
                </>
              )}
            </div>
          </div>

          <div className="ld-perf">
            <b>أداء الدوائر</b>
            <ul>
              {PERF.map((row, index) => (
                <li key={row.name} style={css({ '--v': `${row.v}%`, '--s': index })}>
                  <row.icon aria-hidden="true" />
                  <span>{row.name}</span>
                  <i>
                    <em />
                  </i>
                </li>
              ))}
            </ul>
          </div>

          <div className="ld-summary">
            {SUMMARY.map((card, index) => (
              <div key={card.label} className={`ld-sum ${card.tone}`} style={css({ '--s': index })}>
                <span className="ld-sum-icon">
                  <card.icon aria-hidden="true" />
                </span>
                <span className="ld-sum-text">
                  <b>{card.label}</b>
                  <small>{card.value}</small>
                  <i style={css({ '--v': `${card.bars[0]}%` })} />
                  <i style={css({ '--v': `${card.bars[1]}%` })} />
                </span>
                <ChevronLeft aria-hidden="true" />
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}

/* ============================================================================================
   See how it works — the explainer video
   ============================================================================================ */
export function LandingHow() {
  const video = useRef<HTMLVideoElement>(null)
  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState(false)
  const start = () => {
    setStarted(true)
    requestAnimationFrame(() => video.current?.play().catch(() => setFailed(true)))
  }
  return (
    <section className="ld-how" id="how" aria-labelledby="ld-how-title">
      <div className="ld-wrap ld-how-grid">
        <div className="ld-how-copy" data-reveal>
          <h2 id="ld-how-title">
            شوف شلون <em>تشتغل.</em>
          </h2>
          <p>رحلة رقمية تربط المواطن بالدائرة.</p>
          <div className="ld-how-actions">
            <Link href="/onboarding" className="ld-btn is-ink">
              إنشاء حساب <ArrowLeft aria-hidden="true" />
            </Link>
            <Link href="/directory" className="ld-btn is-outline">
              استعراض الخدمات
            </Link>
          </div>
        </div>

        <div className="ld-player" data-reveal>
          {failed ? (
            <div className="ld-player-fallback">
              <img src="/brand/home/video-poster.jpg" alt="" />
              <p>تعذّر تشغيل الفيديو على هذا الجهاز. نفس الشرح موجود بالأقسام فوق.</p>
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
                  تعرّف على المنصة
                  <small>٠:٤٠ · بدون صوت، مع شرح مكتوب</small>
                  <i className="ld-play-track" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

/* ============================================================================================
   Footer
   ============================================================================================ */
export function LandingFooter() {
  return (
    <footer className="ld-footer">
      <div className="ld-wrap ld-footer-row">
        <Link href="/" className="ld-footer-brand">
          <img src="/brand/dhiqar-unified-logo.png" alt="" width={40} height={40} />
          <span>
            ذي قار الرقمية
            <small>البوابة الحكومية لمحافظة ذي قار</small>
          </span>
        </Link>
        <nav aria-label="روابط التذييل">
          <Link href="/departments">الدوائر الحكومية</Link>
          <Link href="/verify">التحقق من وثيقة</Link>
          <Link href="/citizen">متابعة معاملة</Link>
          <Link href="/staff/login">بوابة الموظفين</Link>
        </nav>
        <nav aria-label="روابط قانونية" className="is-quiet">
          <Link href="/privacy">الخصوصية</Link>
          <Link href="/accessibility">إمكانية الوصول</Link>
          <Link href="/citizen/feedback">تواصل معنا</Link>
        </nav>
      </div>
    </footer>
  )
}
