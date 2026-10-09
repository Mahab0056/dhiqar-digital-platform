import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'wouter'
import { AnimatePresence, motion, useScroll, useTransform } from 'framer-motion'
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
  Leaf,
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
          <img src="/brand/dhiqar-unified-logo.png" alt="" width={36} height={36} />
          <span>ذي قار الرقمية</span>
        </Link>
        <nav className="ld-nav" aria-label="التنقل الرئيسي">
          <a href="#services">عن المنصة</a>
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
            <a href="#services" className="ld-btn is-text">
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

      <a href="#services" className="ld-cue">
        اكتشف أكثر <ChevronDown aria-hidden="true" />
      </a>
    </section>
  )
}

/* ============================================================================================
   From request to completion — a pinned scene: the request card walks through the nine real
   stages of an application while the page scrolls; three phases on the side, as in the mockup
   ============================================================================================ */
type JourneyStage = { title: string; note?: string }
const STAGES: JourneyStage[] = [
  { title: 'اختيار الخدمة' },
  { title: 'تعبئة البيانات' },
  { title: 'رفع المستمسكات' },
  { title: 'إرسال الطلب' },
  { title: 'تدقيق الموظف' },
  { title: 'استكمال النواقص', note: 'عند الحاجة فقط' },
  { title: 'الموافقة' },
  { title: 'الدفع', note: 'حسب الخدمة وعند توفر الربط' },
  { title: 'إصدار الوثيقة والتحقق عبر QR' },
]
const PHASES = [
  { title: 'اختر خدمتك', text: 'حدد الخدمة من بين خدمات الدوائر.', from: 0, to: 1 },
  { title: 'ارفع مستمسكاتك', text: 'أرفق المستندات المطلوبة بسهولة.', from: 2, to: 3 },
  { title: 'تابع معاملتك', text: 'احصل على إشعارات بكل مرحلة.', from: 4, to: 8 },
]
const phaseOf = (stage: number) => PHASES.findIndex(phase => stage >= phase.from && stage <= phase.to)
// what the citizen's notification feed says once the request has left their hands
const NOTICES: Array<{ icon: typeof Check; title: string; text: string; tone?: string }> = [
  { icon: Check, title: 'تم استلام الطلب', text: 'سيتم إشعارك بمستجدات المعاملة عبر حسابك في المنصة.' },
  { icon: UserRound, title: 'طلبك قيد التدقيق', text: 'الموظف المختص في بلدية الناصرية يدقق المستمسكات.' },
  { icon: Bell, title: 'مطلوب استكمال', text: 'صورة بطاقة السكن غير واضحة. ارفعها من نفس الطلب.', tone: 'is-warn' },
  { icon: Check, title: 'تمت الموافقة', text: 'اعتمد الموظف المخوّل الطلب وسُجّل القرار باسمه.' },
  { icon: Check, title: 'تم الدفع', text: 'وصل رسمي إلكتروني برقم TQP-2026-1182.' },
  { icon: Check, title: 'وثيقتك جاهزة', text: 'نزّلها PDF، وأي جهة تتحقق منها عبر رمز QR.' },
]
const noticeFor = (stage: number) => (stage < 3 ? null : NOTICES[Math.min(stage - 3, NOTICES.length - 1)])

export function LandingJourney() {
  const ref = useRef<HTMLElement>(null)
  const { still } = useMotionPref()
  const [stage, setStage] = useState(2)
  const [sticky, setSticky] = useState(false)

  // the scroll-linked version only on wide screens with motion on; phones get a plain section
  useEffect(() => {
    const query = window.matchMedia('(min-width: 960px)')
    const update = () => setSticky(query.matches && !still)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [still])

  // pinned: the stage follows how far the visitor has scrolled through the section
  useEffect(() => {
    if (!sticky) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const section = ref.current
        if (!section) return
        const travel = section.offsetHeight - window.innerHeight
        const progress = Math.min(1, Math.max(0, travel > 0 ? -section.getBoundingClientRect().top / travel : 0))
        section.style.setProperty('--p', progress.toFixed(3))
        setStage(Math.min(STAGES.length - 1, Math.floor(progress * STAGES.length)))
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

  // phones: the card plays through the stages on its own while it is on screen
  useEffect(() => {
    const section = ref.current
    if (sticky || still || !section) return
    let timer = 0
    const observer = new IntersectionObserver(
      ([entry]) => {
        window.clearInterval(timer)
        if (entry.isIntersecting)
          timer = window.setInterval(() => setStage(current => (current + 1) % STAGES.length), 2600)
      },
      { threshold: 0.35 }
    )
    observer.observe(section)
    return () => {
      observer.disconnect()
      window.clearInterval(timer)
    }
  }, [sticky, still])

  const choose = (index: number) => {
    setStage(index)
    const section = ref.current
    if (!sticky || !section) return
    const travel = section.offsetHeight - window.innerHeight
    window.scrollTo({ top: section.offsetTop + (travel * (index + 0.5)) / STAGES.length, behavior: 'smooth' })
  }

  const phase = phaseOf(stage)
  const notice = noticeFor(stage)

  return (
    <section
      className={`ld-journey${sticky ? ' is-sticky' : ''}`}
      id="journey"
      ref={ref}
      aria-labelledby="ld-journey-title"
      style={sticky ? undefined : css({ '--p': stage / (STAGES.length - 1) })}
    >
      <div className="ld-journey-stage">
        <div className="ld-wrap ld-journey-grid">
          <div className="ld-journey-copy" data-reveal>
            <h2 id="ld-journey-title" className="ld-split">
              <span className="ld-l">
                <span>من الطلب</span>
              </span>
              <span className="ld-l" style={css({ '--l': 1 })}>
                <em>إلى الإنجاز.</em>
              </span>
            </h2>
            <p>خطوات واضحة، ومتابعة بكل مرحلة.</p>
            <ol className="ld-steps">
              {PHASES.map((item, index) => (
                <li key={item.title} className={index === phase ? 'is-on' : index < phase ? 'is-done' : ''}>
                  <button
                    type="button"
                    onClick={() => choose(item.from)}
                    aria-current={index === phase ? 'step' : undefined}
                  >
                    <span className="ld-step-num">
                      {index < phase ? <Check aria-hidden="true" /> : (index + 1).toLocaleString('ar-IQ')}
                    </span>
                    <span className="ld-step-text">
                      <b>{item.title}</b>
                      <small>{item.text}</small>
                      {index === phase && (
                        <span className="ld-substage" aria-live="polite">
                          <i>
                            {(stage + 1).toLocaleString('ar-IQ')} / {STAGES.length.toLocaleString('ar-IQ')}
                          </i>
                          {STAGES[stage].title}
                          {STAGES[stage].note && <em>{STAGES[stage].note}</em>}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <div className="ld-journey-visual" data-stage={stage} aria-hidden="true">
            <div className={`ld-receipt${notice ? ' is-live' : ''} ${notice?.tone ?? ''}`}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={notice?.title ?? 'idle'}
                  className="ld-receipt-body"
                  initial={still ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={still ? undefined : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.3 }}
                >
                  <span className="ld-receipt-check">{notice ? <notice.icon /> : <Bell />}</span>
                  <b>{notice ? notice.title : 'إشعارات طلبك'}</b>
                  <p>{notice ? notice.text : 'كل مرحلة يوصلك عنها إشعار، بدون مراجعة أو اتصال.'}</p>
                </motion.div>
              </AnimatePresence>
              <span className="ld-receipt-ref">TQD-2026-0418</span>
              <span className="ld-fake-btn">متابعة الطلب</span>
              <ul>
                {[0, 1, 2].map(index => (
                  <li key={index} className={stage >= 4 + index * 2 ? 'is-done' : ''} />
                ))}
              </ul>
            </div>

            <div className="ld-form">
              <div className="ld-form-head">
                <b>طلب خدمة</b>
                <span className="ld-form-ref">{stage >= 3 ? 'TQD-2026-0418' : 'مسودة'}</span>
              </div>
              <ol className="ld-stepper">
                {['اختيار الخدمة', 'رفع المستمسكات', 'متابعة الطلب'].map((label, index) => (
                  <li key={label} className={index === phase ? 'is-on' : index < phase ? 'is-done' : ''}>
                    <span>{index < phase ? <Check /> : (index + 1).toLocaleString('ar-IQ')}</span>
                    {label}
                  </li>
                ))}
              </ol>
              <div className="ld-form-rail">
                {STAGES.map((item, index) => (
                  <i key={item.title} className={index < stage ? 'is-done' : index === stage ? 'is-on' : ''} />
                ))}
              </div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={stage}
                  className="ld-form-body"
                  initial={still ? false : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={still ? undefined : { opacity: 0, y: -12 }}
                  transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  <StageScreen stage={stage} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

const Field = ({ label, value, focus, mark }: { label: string; value: string; focus?: boolean; mark?: string }) => (
  <div className={`ld-field${focus ? ' is-focus' : ''}`}>
    <small>{label}</small>
    <span>
      {value}
      {mark ? <em className="ld-field-mark">{mark}</em> : <ChevronDown />}
    </span>
  </div>
)
const DocRow = ({ name, state }: { name: string; state: 'up' | 'ok' | 'bad' }) => (
  <div className={`ld-doc is-${state}`}>
    <span className="ld-pdf">PDF</span>
    <span className="ld-doc-text">
      <b>{name}</b>
      <small>{state === 'ok' ? 'تم الرفع بنجاح' : state === 'up' ? 'جاري الرفع…' : 'الصورة غير واضحة'}</small>
    </span>
    <span className="ld-doc-check">{state === 'bad' ? <Info /> : <Check />}</span>
    <i className="ld-doc-bar" />
  </div>
)

function StageScreen({ stage }: { stage: number }) {
  switch (stage) {
    case 0:
      return (
        <>
          <Field label="ابحث عن خدمة" value="هوية سكن" focus mark="بحث" />
          <ul className="ld-results">
            <li className="is-on">
              <b>إصدار هوية سكنية</b>
              <small>مديرية بلدية الناصرية · إلكترونية</small>
            </li>
            <li>
              <b>نقل بطاقة السكن</b>
              <small>الأحوال المدنية · إلكترونية + حضور</small>
            </li>
            <li>
              <b>تحديث عنوان السكن</b>
              <small>الأحوال المدنية · إلكترونية</small>
            </li>
          </ul>
        </>
      )
    case 1:
      return (
        <>
          <Field label="نوع الخدمة" value="إصدار هوية سكنية" />
          <Field label="الجهة المستفيدة" value="مديرية بلدية الناصرية" />
          <Field label="الاسم الكامل" value="من حسابك الموثّق" focus mark="✓ تلقائي" />
        </>
      )
    case 2:
      return (
        <>
          <Field label="نوع الخدمة" value="إصدار هوية سكنية" />
          <small className="ld-label">المستمسكات المطلوبة</small>
          <DocRow name="هوية الأحوال المدنية pdf" state="ok" />
          <DocRow name="بطاقة السكن pdf" state="up" />
        </>
      )
    case 3:
      return (
        <>
          <Field label="نوع الخدمة" value="إصدار هوية سكنية" />
          <DocRow name="هوية الأحوال المدنية pdf" state="ok" />
          <span className="ld-submit is-sent">
            <Check /> تم إرسال الطلب
          </span>
          <p className="ld-hint">وصل إلى مديرية بلدية الناصرية — قسم الإجازات.</p>
        </>
      )
    case 4:
      return (
        <div className="ld-status">
          <span className="ld-pill is-wait">قيد التدقيق</span>
          <b>الموظف المختص يدقق طلبك</b>
          <ul className="ld-checks">
            <li className="is-done">
              <Check /> البيانات مطابقة للهوية
            </li>
            <li className="is-done">
              <Check /> هوية الأحوال المدنية واضحة
            </li>
            <li className="is-run">بطاقة السكن…</li>
          </ul>
        </div>
      )
    case 5:
      return (
        <div className="ld-status">
          <span className="ld-pill is-warn">مطلوب استكمال</span>
          <b>صورة بطاقة السكن غير واضحة</b>
          <DocRow name="بطاقة السكن pdf" state="bad" />
          <span className="ld-submit is-ghost">
            إعادة الرفع من نفس الطلب <ArrowLeft />
          </span>
        </div>
      )
    case 6:
      return (
        <div className="ld-status is-center">
          <span className="ld-big-check">
            <Check />
          </span>
          <b>تمت الموافقة</b>
          <small>القرار من الموظف المخوّل · مسجّل باسمه ووقته</small>
        </div>
      )
    case 7:
      return (
        <div className="ld-status">
          <span className="ld-pill is-info">رسم الخدمة</span>
          <div className="ld-amount">
            ٢٥٬٠٠٠ <small>د.ع</small>
          </div>
          <span className="ld-submit">
            ادفع إلكترونياً <ArrowLeft />
          </span>
          <p className="ld-hint">يظهر فقط للخدمات اللي بيها رسوم وبعد تفعيل بوابة الدفع.</p>
        </div>
      )
    default:
      return (
        <div className="ld-issued">
          <div>
            <span className="ld-pill is-ok">صادرة</span>
            <b>هوية سكنية</b>
            <small>وثيقة PDF رسمية</small>
            <span className="ld-submit is-small">
              تنزيل الوثيقة <ArrowLeft />
            </span>
          </div>
          <QrMark />
        </div>
      )
  }
}

// a decorative QR-style mark (not a scannable code): three finder squares and a fixed module pattern
const QR_SIZE = 21
const finder = (x: number, y: number) => (x < 7 && y < 7) || (x >= QR_SIZE - 7 && y < 7) || (x < 7 && y >= QR_SIZE - 7)
const qrModules = Array.from({ length: QR_SIZE * QR_SIZE }, (_, index) => {
  const x = index % QR_SIZE
  const y = Math.floor(index / QR_SIZE)
  if (finder(x, y) || (x < 8 && y < 8) || (x >= QR_SIZE - 8 && y < 8) || (x < 8 && y >= QR_SIZE - 8)) return false
  return (x * 7 + y * 13 + x * y) % 5 < 2 !== ((x + y) % 3 === 0)
})
function QrMark() {
  const eye = (x: number, y: number) => (
    <g key={`e${x}-${y}`}>
      <rect x={x} y={y} width="7" height="7" rx="1.2" />
      <rect x={x + 1} y={y + 1} width="5" height="5" rx="0.8" fill="#fff" />
      <rect x={x + 2} y={y + 2} width="3" height="3" rx="0.6" />
    </g>
  )
  return (
    <svg className="ld-qr" viewBox="-2 -2 25 25" aria-hidden="true">
      <rect x="-2" y="-2" width="25" height="25" rx="2" fill="#fff" />
      {eye(0, 0)}
      {eye(QR_SIZE - 7, 0)}
      {eye(0, QR_SIZE - 7)}
      {qrModules.map((on, index) =>
        on ? <rect key={index} x={index % QR_SIZE} y={Math.floor(index / QR_SIZE)} width="1" height="1" /> : null
      )}
    </svg>
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
  { icon: Leaf, name: 'دائرة الزراعة', v: 63 },
  { icon: Droplet, name: 'دائرة الموارد المائية', v: 70 },
]
const SUMMARY = [
  { icon: FileText, label: 'المعاملات', bars: [78, 46], tone: '' },
  { icon: TrendingUp, label: 'الإيرادات', bars: [64, 38], tone: '' },
  { icon: Bell, label: 'التنبيهات', bars: [42, 22], tone: 'is-alert' },
]

// operators at their consoles, silhouetted against the wall of screens (pure SVG, no photo)
const OPERATORS = [90, 300, 520, 760, 1010, 1240, 1470]
function ConsoleRow() {
  return (
    <svg className="ld-consoles" viewBox="0 0 1600 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="ld-screen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3ad584" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0d4b2c" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="ld-screen-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5fb4ff" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#123a5c" stopOpacity="0.85" />
        </linearGradient>
        <radialGradient id="ld-spill" cx="50%" cy="0%" r="70%">
          <stop offset="0%" stopColor="#35d07a" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#35d07a" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* console monitors */}
      {Array.from({ length: 22 }, (_, index) => (
        <g key={index} transform={`translate(${index * 74 + 6} 168)`}>
          <rect width="62" height="38" rx="3" fill={index % 3 === 1 ? 'url(#ld-screen-b)' : 'url(#ld-screen)'} />
          <rect x="6" y="8" width={20 + (index % 4) * 6} height="3" rx="1.5" fill="#d9ffe9" opacity="0.55" />
          <rect x="6" y="16" width={34 - (index % 3) * 6} height="3" rx="1.5" fill="#d9ffe9" opacity="0.35" />
          <rect x="6" y="24" width="44" height="8" rx="2" fill="#ffffff" opacity="0.12" />
          <ellipse cx="31" cy="44" rx="40" ry="10" fill="url(#ld-spill)" />
        </g>
      ))}
      {/* desk */}
      <rect y="206" width="1600" height="54" fill="#020705" />
      <rect y="204" width="1600" height="3" fill="#35d07a" opacity="0.18" />
      {/* seated operators: head + shoulders, with a rim of screen light */}
      {OPERATORS.map((x, index) => (
        <g key={x} transform={`translate(${x} ${index % 2 ? 132 : 124}) scale(${index % 3 === 0 ? 1.08 : 1})`}>
          <path
            d="M-58 140 C-58 92 -40 74 -20 68 C-30 60 -34 48 -34 36 C-34 14 -18 0 0 0 C18 0 34 14 34 36 C34 48 30 60 20 68 C40 74 58 92 58 140Z"
            fill="#020604"
          />
          <path d="M-30 30 C-28 12 -14 3 0 3" fill="none" stroke="#7df0b0" strokeOpacity="0.35" strokeWidth="2" />
        </g>
      ))}
    </svg>
  )
}

export function LandingOperations() {
  const board = useRef<HTMLDivElement>(null)
  const { still } = useMotionPref()
  const [hover, setHover] = useState<GeoPoint | null>(null)
  const [on, setOn] = useState(false)
  // the board starts tilted back like a wall of screens and settles flat as it scrolls into view
  const { scrollYProgress } = useScroll({ target: board, offset: ['start end', 'start 0.3'] })
  const tilt = useTransform(scrollYProgress, [0, 1], still ? [0, 0] : [18, 0])
  const scale = useTransform(scrollYProgress, [0, 1], still ? [1, 1] : [0.9, 1])
  // the screen wall drifts slower than the board in front of it
  const section = useRef<HTMLElement>(null)
  const { scrollYProgress: passing } = useScroll({ target: section, offset: ['start end', 'end start'] })
  const wallY = useTransform(passing, [0, 1], still ? ['0%', '0%'] : ['-8%', '8%'])

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
    <section className="ld-ops" id="operations" ref={section} aria-labelledby="ld-ops-title">
      <motion.div className="ld-ops-backdrop" style={{ y: wallY }} aria-hidden="true" />
      <ConsoleRow />
      <div className="ld-wrap">
        <div className="ld-ops-head" data-reveal>
          <div>
            <span className="ld-eyebrow">غرفة العمليات المركزية</span>
            <h2 id="ld-ops-title" className="ld-split">
              <span className="ld-l">
                <span>المحافظة أمامك.</span>
              </span>
            </h2>
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
                {/* fractal noise over the district fill reads as farmland and marsh from above */}
                <filter id="ld-terrain" x="0" y="0" width="100%" height="100%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.032" numOctaves="4" seed="7" result="noise" />
                  <feColorMatrix in="noise" type="saturate" values="0" result="grey" />
                  {/* squeeze the noise toward mid-grey so overlay only adds a gentle field texture */}
                  <feComponentTransfer in="grey" result="mono">
                    <feFuncR type="linear" slope="0.38" intercept="0.31" />
                    <feFuncG type="linear" slope="0.38" intercept="0.31" />
                    <feFuncB type="linear" slope="0.38" intercept="0.31" />
                  </feComponentTransfer>
                  <feBlend in="SourceGraphic" in2="mono" mode="overlay" result="mix" />
                  <feComposite in="mix" in2="SourceGraphic" operator="in" />
                </filter>
              </defs>
              <g filter="url(#ld-terrain)">
                {geo.districts.map((district, index) => (
                  <path key={district.name} className="ld-district" d={district.d} style={css({ '--s': index })} />
                ))}
              </g>
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
                  <circle className="ld-pin-pulse" r="10" style={css({ '--s': order })} />
                  <path d="M0 0 C-9 -12 -14 -19 -14 -27 A14 14 0 1 1 14 -27 C14 -19 9 -12 0 0Z" />
                  <circle cy="-27" r="5.5" fill="#fff" />
                  <rect x={-(label.length * 7 + 22) / 2} y="-72" width={label.length * 7 + 22} height="26" rx="13" />
                  <text x="0" y="-54.5">
                    {label}
                  </text>
                </g>
              ))}
            </svg>
            <span className="ld-scan" aria-hidden="true" />
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
                  <i style={css({ '--v': `${card.bars[0]}%` })} />
                  <i style={css({ '--v': `${card.bars[1]}%` })} />
                </span>
                <ChevronLeft aria-hidden="true" />
              </div>
            ))}
          </div>
        </motion.div>
        <p className="ld-demo">
          <Info aria-hidden="true" /> عرض توضيحي: المؤشرات تجريبية، وحدود الأقضية ومواقع الدوائر حقيقية.
        </p>
      </div>
    </section>
  )
}

/* ============================================================================================
   See how it works — the explainer video
   ============================================================================================ */
export function LandingHow() {
  const section = useRef<HTMLElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const { still } = useMotionPref()
  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState(false)
  const { scrollYProgress } = useScroll({ target: section, offset: ['start end', 'center center'] })
  const playerScale = useTransform(scrollYProgress, [0, 1], still ? [1, 1] : [0.86, 1])
  const playerTurn = useTransform(scrollYProgress, [0, 1], still ? [0, 0] : [-8, 0])

  // a silent preview loops while the player is on screen (never with motion paused or reduced)
  useEffect(() => {
    const element = video.current
    if (!element || started || still) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          element.muted = true
          element.loop = true
          element.play().catch(() => undefined)
        } else element.pause()
      },
      { threshold: 0.4 }
    )
    observer.observe(element)
    // only stop watching here: pausing would also cut off the full playback the visitor just started
    return () => observer.disconnect()
  }, [started, still])

  // pausing motion also stops a running preview
  useEffect(() => {
    if (still && !started) video.current?.pause()
  }, [still, started])

  const start = () => {
    const element = video.current
    setStarted(true)
    if (!element) return
    element.loop = false
    element.currentTime = 0
    // an interrupted play() (AbortError) is not a failure; anything else means the video can't run here
    element.play().catch((error: DOMException) => {
      if (error.name !== 'AbortError') setFailed(true)
    })
  }

  return (
    <section className="ld-how" id="how" ref={section} aria-labelledby="ld-how-title">
      <div className="ld-wrap ld-how-grid">
        <div className="ld-how-copy" data-reveal>
          <h2 id="ld-how-title" className="ld-split">
            <span className="ld-l">
              <span>شوف شلون</span>
            </span>
            <span className="ld-l" style={css({ '--l': 1 })}>
              <em>تشتغل.</em>
            </span>
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

        <motion.div
          className={`ld-player${started ? ' is-started' : ''}`}
          style={{ scale: playerScale, rotateY: playerTurn, transformPerspective: 1600 }}
        >
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
                muted
                poster="/brand/home/video-poster.jpg"
                onError={() => setFailed(true)}
                aria-label="فيديو تعريفي بمنصة ذي قار الرقمية"
              >
                <source src="/media/explainer.webm" type="video/webm" />
                <source src="/media/explainer.mp4" type="video/mp4" />
                <track kind="captions" srcLang="ar" label="العربية" src="/media/explainer.ar.vtt" default={started} />
              </video>
              {!started && (
                <button type="button" className="ld-play" onClick={start}>
                  <span className="ld-play-ring">
                    <Play aria-hidden="true" />
                  </span>
                  تعرّف على المنصة
                  <i className="ld-play-track" />
                </button>
              )}
            </>
          )}
        </motion.div>
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
          <img src="/brand/dhiqar-unified-logo.png" alt="" width={42} height={42} />
          <span>ذي قار الرقمية</span>
        </Link>
        <nav aria-label="روابط التذييل">
          <Link href="/privacy">الخصوصية</Link>
          <Link href="/directory">المساعدة</Link>
          <Link href="/citizen/feedback">تواصل معنا</Link>
        </nav>
      </div>
    </footer>
  )
}
