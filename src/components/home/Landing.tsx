import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'wouter'
import { motion, useScroll, useTransform } from 'framer-motion'
import {
  BarChart3,
  Briefcase,
  CalendarClock,
  FileText,
  Landmark,
  LayoutDashboard,
  Menu,
  MessageSquareWarning,
  Moon,
  ScanLine,
  ShieldCheck,
  Sun,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import { TQLogoMotion } from './TQLogoMotion'
import { useMotionPref } from './motion-pref'
import { SmartSearch } from '../public/SmartSearch'
import { useNightMode } from '../public/CivicUtilityBar'
import { useSession } from '../../lib/session'
import { staffHomeForRole } from '../../pages/auth/StaffLoginPage'

const css = (vars: Record<string, string | number>) => vars as CSSProperties

const NAV = [
  { label: 'الخدمات', href: '/directory' },
  { label: 'الدوائر', href: '/departments' },
  { label: 'تتبع معاملة', href: '#track' },
  { label: 'تحقق من وثيقة', href: '/verify' },
  { label: 'الأخبار', href: '/news' },
  { label: 'المناقصات', href: '/tenders' },
  { label: 'المساعدة', href: '#help' },
]

/* ============================================================================================
   Header — transparent over the night hero, dark glass once the page scrolls.
   Two clear doors: citizens (phone sign-in) and government staff. A signed-in visitor sees their portal.
   ============================================================================================ */
export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const { session } = useSession()
  const { theme, toggle } = useNightMode()
  const portal = session
    ? { href: staffHomeForRole(session.role), label: session.role === 'CITIZEN' ? 'لوحتي' : 'لوحة العمل' }
    : null

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24)
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])

  // the mobile menu closes with Escape and when the window grows back to the desktop layout
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const wide = window.matchMedia('(min-width: 1101px)')
    const onWide = () => wide.matches && setOpen(false)
    window.addEventListener('keydown', onKey)
    wide.addEventListener('change', onWide)
    return () => {
      window.removeEventListener('keydown', onKey)
      wide.removeEventListener('change', onWide)
    }
  }, [open])

  const close = () => setOpen(false)
  const entries = portal ? (
    <Link href={portal.href} className="ld-entry is-citizen" onClick={close}>
      <LayoutDashboard aria-hidden="true" />
      {portal.label}
    </Link>
  ) : (
    <>
      <Link href="/staff/login" className="ld-entry is-staff" onClick={close}>
        <Briefcase aria-hidden="true" />
        دخول الموظفين
      </Link>
      <Link href="/onboarding" className="ld-entry is-citizen" onClick={close}>
        <UserRound aria-hidden="true" />
        دخول المواطن
      </Link>
    </>
  )

  return (
    <header className={`ld-header${scrolled || open ? ' is-scrolled' : ''}`}>
      <a className="tq-skip-link" href="#main-content">
        تخطَّ إلى المحتوى
      </a>
      <div className="ld-wrap ld-header-row">
        <Link href="/" className="ld-brand" aria-label="ذي قار الرقمية — الصفحة الرئيسية">
          <img src="/brand/dhiqar-unified-logo.png" alt="" width={36} height={36} />
          <span>
            ذي قار الرقمية
            <small>محافظة ذي قار</small>
          </span>
        </Link>
        <nav className="ld-nav" aria-label="التنقل الرئيسي">
          {NAV.map(item =>
            item.href.startsWith('#') ? (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ) : (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            )
          )}
        </nav>
        <div className="ld-header-actions">
          <button
            type="button"
            className="ld-icon-btn"
            onClick={toggle}
            aria-pressed={theme === 'dark'}
            aria-label={theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}
            title={theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}
          >
            {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </button>
          <div className="ld-entries">{entries}</div>
          <button
            type="button"
            className="ld-icon-btn ld-menu-btn"
            onClick={() => setOpen(current => !current)}
            aria-expanded={open}
            aria-controls="ld-mobile-menu"
            aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
          >
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>
      <div id="ld-mobile-menu" className="ld-mobile-menu" hidden={!open}>
        <nav className="ld-wrap" aria-label="القائمة">
          {NAV.map(item =>
            item.href.startsWith('#') ? (
              <a key={item.href} href={item.href} onClick={close}>
                {item.label}
              </a>
            ) : (
              <Link key={item.href} href={item.href} onClick={close}>
                {item.label}
              </Link>
            )
          )}
          <div className="ld-mobile-entries">{entries}</div>
        </nav>
      </div>
    </header>
  )
}

/* ============================================================================================
   Hero — the night ziggurat and the TQ mark, with the task up front: search, quick actions, live counts
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

const QUICK = [
  { label: 'حجز موعد', href: '/service/online-appointment', icon: CalendarClock },
  { label: 'تتبع معاملة', href: '#track', icon: ScanLine },
  { label: 'تحقق من وثيقة', href: '/verify', icon: ShieldCheck },
  { label: 'تقديم شكوى', href: '/citizen/feedback', icon: MessageSquareWarning },
]
const EXAMPLES = ['اريد اطلع جواز', 'بطاقة سكن', 'شكوى ماء', 'إجازة بناء']

export type HeroStats = { services: number | null; departments: number | null; districts: number | null }

export function LandingHero({ stats, ticker }: { stats: HeroStats; ticker?: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const tile = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const { still } = useMotionPref()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const bgY = useTransform(scrollYProgress, [0, 1], still ? ['0%', '0%'] : ['0%', '12%'])
  const visualY = useTransform(scrollYProgress, [0, 1], still ? ['0%', '0%'] : ['0%', '-10%'])

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

  // an example fills the box and keeps the focus there, so the live results open under it
  const tryExample = (example: string) => {
    setQuery(example)
    ref.current?.querySelector<HTMLInputElement>('.tq-search input')?.focus()
  }

  const counters = [
    { value: stats.services, label: 'خدمة حكومية' },
    { value: stats.departments, label: 'دائرة حكومية' },
    { value: stats.districts, label: 'قضاء ضمن المنصة' },
  ]

  return (
    <section className="ld-hero" id="top" ref={ref} aria-labelledby="ld-hero-title">
      {/* night grade of the Ziggurat of Ur artwork (public/brand/home/hero-night); clipped here so the
          search results can still drop below the hero */}
      <div className="ld-hero-art" aria-hidden="true">
        <motion.picture className="ld-hero-bg" style={{ y: bgY }}>
          <source srcSet="/brand/home/hero-night.webp" type="image/webp" />
          <img src="/brand/home/hero-night.jpg" alt="" fetchPriority="high" />
        </motion.picture>
        <div className="ld-hero-shade" />
        <div className="ld-water" />
      </div>

      {ticker && <div className="ld-wrap ld-ticker-wrap">{ticker}</div>}

      <div className="ld-wrap ld-hero-grid">
        <div className="ld-hero-copy">
          <p className="ld-hero-kicker ld-in" style={css({ '--i': 0 })}>
            <img src="/brand/iraq-coat-of-arms.png" alt="" width={22} height={22} />
            <span>
              البوابة الرسمية للخدمات الحكومية<span className="ld-hide-sm"> · محافظة ذي قار</span>
            </span>
          </p>
          <h1 id="ld-hero-title" className="ld-in" style={css({ '--i': 1 })}>
            خدماتك الحكومية،
            <em>من مكان واحد.</em>
          </h1>
          <p className="ld-hero-lead ld-in" style={css({ '--i': 2 })}>
            ابحث عن الخدمة التي تحتاجها، قدّم طلبك إلكترونياً، وتابعه حتى تستلم وثيقتك.
          </p>

          <div className="ld-hero-search ld-in" style={css({ '--i': 3 })}>
            <SmartSearch
              value={query}
              onChange={setQuery}
              placeholder="ما الخدمة التي تحتاجها؟ مثلاً: اريد اطلع جواز"
            />
            <p className="ld-examples">
              <span>جرّب:</span>
              {EXAMPLES.map(example => (
                <button key={example} type="button" onClick={() => tryExample(example)}>
                  {example}
                </button>
              ))}
            </p>
          </div>

          <nav className="ld-quick ld-in" style={css({ '--i': 4 })} aria-label="إجراءات سريعة">
            {QUICK.map(item =>
              item.href.startsWith('#') ? (
                <a key={item.label} href={item.href}>
                  <item.icon aria-hidden="true" />
                  {item.label}
                </a>
              ) : (
                <Link key={item.label} href={item.href}>
                  <item.icon aria-hidden="true" />
                  {item.label}
                </Link>
              )
            )}
          </nav>

          <dl className="ld-counters ld-in" style={css({ '--i': 5 })}>
            {counters.map(counter => (
              <div key={counter.label}>
                <dt>{counter.label}</dt>
                <dd>{counter.value === null ? '—' : counter.value.toLocaleString('en-US')}</dd>
              </div>
            ))}
          </dl>
        </div>

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
    </section>
  )
}

/* ============================================================================================
   Footer
   ============================================================================================ */
const FOOTER_COLUMNS = [
  {
    title: 'المنصة',
    links: [
      { label: 'عن المنصة', href: '#how' },
      { label: 'كيف تعمل المنصة', href: '#how' },
      { label: 'أخبار ذي قار', href: '/news' },
      { label: 'فيديوهات تعليمية', href: '/guides' },
      { label: 'الأسئلة الشائعة', href: '#faq' },
      { label: 'المساعدة والطوارئ', href: '#help' },
    ],
  },
  {
    title: 'الخدمات',
    links: [
      { label: 'دليل الخدمات', href: '/directory' },
      { label: 'الخدمات الأكثر طلباً', href: '#popular' },
      { label: 'أحداث الحياة', href: '#life-events' },
      { label: 'الدوائر الحكومية', href: '/departments' },
      { label: 'المناقصات والمزادات', href: '/tenders' },
    ],
  },
  {
    title: 'للمواطن',
    links: [
      { label: 'إنشاء حساب أو الدخول', href: '/onboarding' },
      { label: 'لوحة المواطن', href: '/citizen' },
      { label: 'التحقق من وثيقة', href: '/verify' },
      { label: 'الشكاوى والمقترحات', href: '/citizen/feedback' },
    ],
  },
  {
    title: 'للموظفين',
    links: [
      { label: 'دخول الموظفين', href: '/staff/login' },
      { label: 'بوابة الموظف', href: '/employee' },
      { label: 'غرفة العمليات', href: '/operations/login' },
    ],
  },
  {
    title: 'قانوني',
    links: [
      { label: 'سياسة الخصوصية', href: '/privacy' },
      { label: 'شروط الاستخدام', href: '/terms' },
      { label: 'إمكانية الوصول', href: '/accessibility' },
    ],
  },
]

export function LandingFooter() {
  return (
    <footer className="ld-footer">
      <div className="ld-wrap">
        <div className="ld-footer-top">
          <div className="ld-footer-about">
            <Link href="/" className="ld-footer-brand">
              <img src="/brand/dhiqar-unified-logo.png" alt="" width={46} height={46} />
              <span>
                ذي قار الرقمية
                <small>منصة الخدمات الحكومية الإلكترونية</small>
              </span>
            </Link>
            <p>
              بوابة محافظة ذي قار لتقديم الخدمات الحكومية إلكترونياً: تبحث عن الخدمة، تقدّم طلبك، تتابعه، وتستلم وثيقة
              قابلة للتحقق.
            </p>
            <Link href="/staff/login" className="ld-footer-staff">
              <Briefcase aria-hidden="true" /> دخول الموظفين
            </Link>
          </div>
          {FOOTER_COLUMNS.map(column => (
            <nav key={column.title} className="ld-footer-col" aria-label={column.title}>
              <h2>{column.title}</h2>
              <ul>
                {column.links.map(link => (
                  <li key={link.label}>
                    {link.href.startsWith('#') ? (
                      <a href={link.href}>{link.label}</a>
                    ) : (
                      <Link href={link.href}>{link.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="ld-footer-bottom">
          <p>
            <img src="/brand/iraq-coat-of-arms.png" alt="" width={20} height={20} />
            <span>© {new Date().getFullYear()} محافظة ذي قار — جمهورية العراق. جميع الحقوق محفوظة.</span>
          </p>
          <p>
            <Link href="/privacy">الخصوصية</Link>
            <Link href="/terms">الشروط</Link>
            <Link href="/accessibility">إمكانية الوصول</Link>
          </p>
        </div>
      </div>
    </footer>
  )
}
