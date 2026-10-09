import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useLocation } from 'wouter'
import { motion, useInView, useScroll, useTransform } from 'framer-motion'
import {
  ArrowLeft,
  BadgeCheck,
  Bell,
  Building2,
  CheckCircle2,
  FilePlus2,
  Fingerprint,
  Info,
  ListChecks,
  LogIn,
  MessagesSquare,
  Play,
  QrCode,
  ScanFace,
  Search,
  SearchCheck,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { SmartSearch } from '../public/SmartSearch'
import { useMotionPref } from './motion-pref'
import geo from './dhiqar-geo.json'

const css = (vars: Record<string, string | number>) => vars as CSSProperties

/** Adds data-on once the block is on screen; CSS runs the staged sequence from there. */
function useStage<T extends Element>(amount = 0.35) {
  const ref = useRef<T>(null)
  const inView = useInView(ref, { once: true, amount })
  return [ref, inView ? '' : undefined] as const
}

/* ============================================================================================
   Scene 1 — all your services in one place
   ============================================================================================ */
const popular = [
  { label: 'إجازة بناء', href: '/service/building-permit' },
  { label: 'إجازة محل', href: '/service/store-license' },
  { label: 'البطاقة الوطنية', href: '/directory?q=البطاقة الوطنية' },
  { label: 'جواز السفر', href: '/directory?q=جواز' },
]
const TYPED = 'اريد افتح محل'

export function ServicesScene() {
  const [query, setQuery] = useState('')
  const [ref, on] = useStage<HTMLDivElement>()
  const { still } = useMotionPref()
  const [typed, setTyped] = useState(0)
  useEffect(() => {
    if (on === undefined || still) return
    const timer = window.setInterval(() => setTyped(count => (count >= TYPED.length ? count : count + 1)), 90)
    return () => window.clearInterval(timer)
  }, [on, still])

  return (
    <section className="st-scene st-services" id="story" aria-labelledby="st-services-title">
      <div className="st-wrap st-split">
        <div className="st-copy">
          <header className="st-head" data-reveal>
            <span className="st-eyebrow">المشهد الأول</span>
            <h2 id="st-services-title">
              كل خدماتك، <em>بمكان واحد.</em>
            </h2>
            <p>دوائر المحافظة كلها بواجهة وحدة. ابحث، اعرف المطلوب، وابدأ — قبل ما تطلع من البيت.</p>
          </header>
          <ol className="st-points" data-reveal>
            <li>
              <Search aria-hidden="true" />
              <span>
                <b>ابحث بكلامك</b>
                <small>البحث يفهم العامية والمرادفات، وتگدر تحچي بالمايك.</small>
              </span>
            </li>
            <li>
              <ListChecks aria-hidden="true" />
              <span>
                <b>اعرف المتطلبات مسبقاً</b>
                <small>المستمسكات، الرسوم، والمدة المتوقعة لكل خدمة.</small>
              </span>
            </li>
            <li>
              <FilePlus2 aria-hidden="true" />
              <span>
                <b>ابدأ الطلب مباشرة</b>
                <small>الخدمات الإلكترونية تتقدم من نفس الصفحة.</small>
              </span>
            </li>
          </ol>
          <div className="st-live-search" data-reveal>
            <span className="st-try">جرّب هسه:</span>
            <SmartSearch
              value={query}
              onChange={setQuery}
              autoFocus={false}
              placeholder="شنو المعاملة اللي تحتاجها؟ مثلاً: إجازة بناء"
            />
            <div className="st-popular">
              {popular.map(item => (
                <Link href={item.href} key={item.label}>
                  {item.label}
                </Link>
              ))}
              <Link href="/directory" className="is-all">
                كل الخدمات <ArrowLeft aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>

        <div className="st-window" ref={ref} data-on={on} aria-hidden="true">
          <div className="st-window-bar">
            <i />
            <i />
            <i />
            <span>thi-qar.com/directory</span>
          </div>
          <div className="st-window-body">
            <div className="st-search-mock is-typing">
              <Search />
              <span>
                {TYPED.slice(0, still ? TYPED.length : typed)}
                <b className="st-caret" />
              </span>
            </div>
            <div className="st-svc st-seq" style={css({ '--s': 1 })}>
              <div className="st-svc-head">
                <Building2 />
                <span>
                  <b>إجازة فتح محل تجاري</b>
                  <small>بلدية الناصرية · خدمة إلكترونية</small>
                </span>
              </div>
              <ul>
                <li className="st-seq" style={css({ '--s': 2 })}>
                  <CheckCircle2 /> البطاقة الوطنية الموحدة
                </li>
                <li className="st-seq" style={css({ '--s': 3 })}>
                  <CheckCircle2 /> بطاقة السكن
                </li>
                <li className="st-seq" style={css({ '--s': 4 })}>
                  <CheckCircle2 /> عقد إيجار أو سند ملكية المحل
                </li>
              </ul>
              <div className="st-svc-foot st-seq" style={css({ '--s': 5 })}>
                <span>المدة المتوقعة: ٥ أيام عمل</span>
                <b>ابدأ الطلب</b>
              </div>
            </div>
          </div>
          <p className="st-device-note">مثال توضيحي — المتطلبات الفعلية تظهر في صفحة كل خدمة</p>
        </div>
      </div>
    </section>
  )
}

/* ============================================================================================
   Scene 3 — every department knows what is needed
   ============================================================================================ */
const queue = [
  { ref: 'TQ-048213', name: 'إجازة فتح محل تجاري', who: 'علي حسين', sla: 'جديد', tone: 'new' },
  { ref: 'TQ-048190', name: 'إجازة بناء سكني', who: 'زينب كاظم', sla: 'يومان متبقيان', tone: 'ok' },
  { ref: 'TQ-048171', name: 'تجديد إجازة محل', who: 'مرتضى عباس', sla: 'اليوم', tone: 'warn' },
  { ref: 'TQ-048102', name: 'إجازة رصيف', who: 'حيدر سالم', sla: 'متأخر يوم', tone: 'late' },
]

export function DepartmentScene() {
  const [ref, on] = useStage<HTMLDivElement>(0.3)
  return (
    <section className="st-scene st-dept" id="department" aria-labelledby="st-dept-title">
      <div className="st-wrap">
        <header className="st-head is-center" data-reveal>
          <span className="st-eyebrow">المشهد الثالث</span>
          <h2 id="st-dept-title">
            كل دائرة <em>تعرف المطلوب.</em>
          </h2>
          <p>
            الطلب يوصل للدائرة المختصة تلقائياً، ويدخل قائمة عمل الموظف المخوّل، وكل تحديث يوصل للمواطن بنفس اللحظة.
          </p>
        </header>

        <div className="st-flow" ref={ref} data-on={on} aria-hidden="true">
          <div className="st-flow-route">
            <span className="st-flow-end">
              <UserRound />
              <b>المواطن</b>
              <small>أرسل الطلب</small>
            </span>
            <span className="st-flow-wire">
              <i className="st-flow-packet" />
            </span>
            <span className="st-flow-end is-dept">
              <Building2 />
              <b>بلدية الناصرية</b>
              <small>قسم الإجازات</small>
            </span>
          </div>

          <div className="st-flow-panels">
            <div className="st-panel">
              <div className="st-panel-head">
                <b>قائمة عمل الموظف</b>
                <small>قسم الإجازات · ٤ طلبات</small>
              </div>
              <ul className="st-queue">
                {queue.map((row, index) => (
                  <li key={row.ref} className={`st-seq is-${row.tone}`} style={css({ '--s': index + 1 })}>
                    <code>{row.ref}</code>
                    <span>
                      <b>{row.name}</b>
                      <small>{row.who}</small>
                    </span>
                    <em>{row.sla}</em>
                  </li>
                ))}
              </ul>
            </div>

            <div className="st-panel">
              <div className="st-panel-head">
                <b>تدقيق المستمسكات</b>
                <small>TQ-048213</small>
              </div>
              <ul className="st-checks">
                <li className="st-seq" style={css({ '--s': 4 })}>
                  <ScanFace /> مطابقة الوجه مع صورة الهوية <BadgeCheck className="st-tick" />
                </li>
                <li className="st-seq" style={css({ '--s': 5 })}>
                  <Fingerprint /> الاسم يطابق الوثيقة <BadgeCheck className="st-tick" />
                </li>
                <li className="st-seq" style={css({ '--s': 6 })}>
                  <ListChecks /> عقد الإيجار مرفق <BadgeCheck className="st-tick" />
                </li>
              </ul>
              <div className="st-status-swap st-seq" style={css({ '--s': 7 })}>
                <span className="st-pill is-wait">قيد التدقيق</span>
                <ArrowLeft />
                <span className="st-pill is-ok">بانتظار الكشف الموقعي</span>
              </div>
            </div>

            <div className="st-panel is-phone">
              <div className="st-panel-head">
                <b>جهاز المواطن</b>
                <small>إشعار فوري</small>
              </div>
              <div className="st-toast st-seq" style={css({ '--s': 8 })}>
                <Bell />
                <span>
                  <b>تحديث على معاملتك</b>
                  <small>موعد الكشف الموقعي: الثلاثاء ١٠:٠٠ ص</small>
                </span>
              </div>
            </div>
          </div>
          <p className="st-device-note">نماذج من واجهات المنصة بأسماء وأرقام تجريبية</p>
        </div>
      </div>
    </section>
  )
}

/* ============================================================================================
   Scene 4 — the governorate in front of you (operations room)
   ============================================================================================ */
type GeoPoint = { n: string; c: string; d: string; p: [number, number] }
const points = geo.points as GeoPoint[]
// illustrative states for a handful of real department locations
const LATE = new Set([3, 11, 27])
// one labelled pin per sector, picked from the verified locations (first match of each category)
const LABELLED = ['بلديات', 'صحة', 'تربية وتعليم', 'زراعة', 'موارد مائية']
  .map(category => points.findIndex(point => point.c === category))
  .filter(index => index >= 0)
const sectorLabel: Record<string, string> = {
  بلديات: 'دائرة البلدية',
  صحة: 'دائرة الصحة',
  'تربية وتعليم': 'دائرة التربية',
  زراعة: 'دائرة الزراعة',
  'موارد مائية': 'الموارد المائية',
}
const kpis = [
  { label: 'معاملات اليوم', value: 1308, suffix: '' },
  { label: 'معدل الإنجاز', value: 4.2, suffix: ' يوم', decimals: 1 },
  { label: 'معاملات متأخرة', value: 37, suffix: '', tone: 'late' },
  { label: 'إيرادات الشهر', value: 186, suffix: ' مليون د.ع' },
]
const perf = [
  { name: 'البلديات', v: 92 },
  { name: 'الأحوال المدنية', v: 88 },
  { name: 'التربية', v: 81 },
  { name: 'الموارد المائية', v: 74 },
  { name: 'الصحة', v: 69 },
]

function CountUp({ to, decimals = 0, run }: { to: number; decimals?: number; run: boolean }) {
  const { still } = useMotionPref()
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!run || still) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1400)
      setValue(to * (1 - Math.pow(1 - t, 3)))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [run, to, still])
  return (
    <>
      {(still && run ? to : value).toLocaleString('ar-IQ', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
    </>
  )
}

export function OperationsScene() {
  const [ref, on] = useStage<HTMLDivElement>(0.25)
  const [hover, setHover] = useState<GeoPoint | null>(null)
  const { still } = useMotionPref()
  // the board starts tilted back like a wall of screens and settles flat as it scrolls into view
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start 0.25'] })
  const tilt = useTransform(scrollYProgress, [0, 1], still ? [0, 0] : [22, 0])
  const scale = useTransform(scrollYProgress, [0, 1], still ? [1, 1] : [0.88, 1])
  return (
    <section className="st-scene st-ops" id="operations" aria-labelledby="st-ops-title">
      <div className="st-wrap">
        <header className="st-head is-light" data-reveal>
          <span className="st-eyebrow is-light">المشهد الرابع · غرفة العمليات المركزية</span>
          <h2 id="st-ops-title">
            المحافظة <em>أمامك.</em>
          </h2>
          <p>خريطة حية للدوائر، مؤشرات الإنجاز والتأخير، والإيرادات — رؤية وحدة لقرار أوضح.</p>
        </header>

        <motion.div
          className="st-ops-board"
          ref={ref}
          data-on={on}
          style={{ rotateX: tilt, scale, transformPerspective: 1400 }}
        >
          <span className="st-demo-badge">
            <Info aria-hidden="true" /> بيانات تجريبية للعرض — ليست أرقاماً حقيقية
          </span>
          <div className="st-ops-kpis">
            {kpis.map((kpi, index) => (
              <div
                key={kpi.label}
                className={`st-kpi st-seq${kpi.tone ? ` is-${kpi.tone}` : ''}`}
                style={css({ '--s': index + 1 })}
              >
                <small>{kpi.label}</small>
                <b>
                  <CountUp to={kpi.value} decimals={kpi.decimals} run={on !== undefined} />
                  {kpi.suffix}
                </b>
              </div>
            ))}
          </div>

          <div className="st-ops-main">
            <div className="st-ops-map">
              <svg
                viewBox={`0 0 ${geo.W} ${geo.H}`}
                role="img"
                aria-label="خريطة أقضية محافظة ذي قار ومواقع الدوائر الحكومية"
              >
                <defs>
                  <linearGradient id="st-district-fill" x1="0" y1="0" x2="0.4" y2="1">
                    <stop offset="0%" stopColor="#2a6b45" />
                    <stop offset="100%" stopColor="#123a26" />
                  </linearGradient>
                </defs>
                {geo.districts.map((district, index) => (
                  <path key={district.name} className="st-district" d={district.d} style={css({ '--s': index })} />
                ))}
                <path className="st-gov" d={geo.gov} />
                {geo.districts.map(district => (
                  <text key={`t-${district.name}`} className="st-district-name" x={district.c[0]} y={district.c[1]}>
                    {district.name}
                  </text>
                ))}
                {points.map((point, index) => (
                  <g
                    key={point.n}
                    className={`st-pin${LATE.has(index) ? ' is-late' : ''}`}
                    style={css({ '--s': index })}
                    transform={`translate(${point.p[0]} ${point.p[1]})`}
                    onMouseEnter={() => setHover(point)}
                    onMouseLeave={() => setHover(null)}
                  >
                    {LATE.has(index) && <circle className="st-pin-ring" r="12" />}
                    <circle r="4.2" />
                    <title>{point.n}</title>
                  </g>
                ))}
                {LABELLED.map((index, order) => {
                  const point = points[index]
                  const label = sectorLabel[point.c]
                  return (
                    <g
                      key={`l-${point.n}`}
                      className="st-tag-pin"
                      style={css({ '--s': order })}
                      transform={`translate(${point.p[0]} ${point.p[1]})`}
                    >
                      <path
                        className="st-drop"
                        d="M0 0 C-9 -12 -13 -18 -13 -25 A13 13 0 1 1 13 -25 C13 -18 9 -12 0 0Z"
                      />
                      <circle cy="-25" r="5" fill="#fff" />
                      <rect x={-label.length * 7.2 - 22} y="-40" width={label.length * 7.2 + 4} height="26" rx="13" />
                      <text x={-20} y="-22">
                        {label}
                      </text>
                    </g>
                  )
                })}
              </svg>
              <div className="st-map-caption">
                {hover ? (
                  <>
                    <b>{hover.n}</b>
                    <small>
                      {hover.c} · {hover.d}
                    </small>
                  </>
                ) : (
                  <>
                    <b>{points.length.toLocaleString('ar-IQ')} دائرة بمواقعها الحقيقية</b>
                    <small>حدود الأقضية ومواقع الدوائر من OpenStreetMap · مرّر على أي نقطة</small>
                  </>
                )}
              </div>
            </div>

            <div className="st-ops-side">
              <div className="st-panel is-dark">
                <div className="st-panel-head">
                  <b>نسبة الإنجاز حسب القطاع</b>
                </div>
                <ul className="st-bars">
                  {perf.map((row, index) => (
                    <li key={row.name} className="st-seq" style={css({ '--s': index + 3, '--v': `${row.v}%` })}>
                      <span>{row.name}</span>
                      <i>
                        <em />
                      </i>
                      <b>{row.v.toLocaleString('ar-IQ')}٪</b>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="st-panel is-dark">
                <div className="st-panel-head">
                  <b>تنبيهات</b>
                </div>
                <ul className="st-alerts">
                  <li className="st-seq is-late" style={css({ '--s': 8 })}>
                    ٣ دوائر تجاوزت المدة المحددة للإنجاز
                  </li>
                  <li className="st-seq" style={css({ '--s': 9 })}>
                    دائرة بدون موظف مناوب — تم إشعار المدير
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

/* ============================================================================================
   Scene 5 — smart help at every step
   ============================================================================================ */
export function AssistantScene() {
  const [ref, on] = useStage<HTMLDivElement>(0.3)
  return (
    <section className="st-scene st-assist" id="assistant" aria-labelledby="st-assist-title">
      <div className="st-wrap">
        <header className="st-head is-center" data-reveal>
          <span className="st-eyebrow">المشهد الخامس</span>
          <h2 id="st-assist-title">
            مساعدة ذكية <em>بكل خطوة.</em>
          </h2>
          <p>يساعد المواطن يوصل للخدمة الصحيحة، ويختصر على الموظف وقت التدقيق — والقرار يبقى للجهة المخولة.</p>
        </header>

        <div className="st-assist-grid" ref={ref} data-on={on}>
          <div className="st-panel">
            <div className="st-panel-head">
              <b>
                <MessagesSquare aria-hidden="true" /> للمواطن
              </b>
              <span className="st-tag is-concept">تصوّر لميزة قادمة</span>
            </div>
            <div className="st-chat" aria-hidden="true">
              <p className="st-msg is-me st-seq" style={css({ '--s': 1 })}>
                اريد افتح محل مواد غذائية بالناصرية، شنو أحتاج؟
              </p>
              <p className="st-msg st-seq" style={css({ '--s': 3 })}>
                تحتاج خدمة <b>إجازة فتح محل تجاري</b> من بلدية الناصرية. المتطلبات: البطاقة الوطنية، بطاقة السكن، وعقد
                إيجار المحل.
              </p>
              <p className="st-msg is-warn st-seq" style={css({ '--s': 5 })}>
                لاحظت إن <b>عقد الإيجار</b> ما مرفوع بعد بطلبك. ارفعه حتى ما يتأخر التدقيق.
              </p>
            </div>
            <p className="st-fine">
              المساعد يعتمد فقط على دليل الخدمات المعتمد، وما يعطي موافقة أو يحدد رسوماً من عنده.
            </p>
          </div>

          <div className="st-panel">
            <div className="st-panel-head">
              <b>
                <Sparkles aria-hidden="true" /> للموظف
              </b>
              <span className="st-tag is-live">مفعّل حالياً</span>
            </div>
            <div className="st-summary" aria-hidden="true">
              <div className="st-seq" style={css({ '--s': 2 })}>
                <ScanFace /> <span>الوجه مطابق لصورة الهوية</span>
              </div>
              <div className="st-seq" style={css({ '--s': 3 })}>
                <Fingerprint /> <span>الاسم المكتوب يطابق الاسم على الوثيقة</span>
              </div>
              <div className="st-seq is-ok" style={css({ '--s': 4 })}>
                <BadgeCheck /> <span>جاهز للاعتماد — النتائج الآلية متطابقة</span>
              </div>
            </div>
            <p className="st-fine">
              ملخص التحقق الآلي (قراءة الوثيقة ومطابقة الوجه) يساعد الموظف فقط — <b>القرار النهائي للموظف المخوّل</b>.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ============================================================================================
   Explainer video
   ============================================================================================ */
export function VideoScene() {
  const video = useRef<HTMLVideoElement>(null)
  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState(false)
  const start = () => {
    setStarted(true)
    requestAnimationFrame(() => video.current?.play().catch(() => undefined))
  }
  return (
    <section className="st-scene st-video" id="video" aria-labelledby="st-video-title">
      <div className="st-wrap st-split is-video">
        <header className="st-head" data-reveal>
          <span className="st-eyebrow">فيديو تعريفي · ٤٠ ثانية</span>
          <h2 id="st-video-title">
            شوف شلون <em>تشتغل.</em>
          </h2>
          <p>
            رحلة معاملة كاملة: من المواطن، للدائرة، لغرفة العمليات — بواجهات المنصة نفسها. بدون صوت، والشرح مكتوب على
            الشاشة.
          </p>
          <div className="st-cta-row">
            <Link href="/onboarding" className="st-btn is-dark">
              إنشاء حساب <ArrowLeft aria-hidden="true" />
            </Link>
            <Link href="/directory" className="st-btn is-outline">
              استعراض الخدمات
            </Link>
          </div>
        </header>
        <div className="st-player" data-reveal>
          {failed ? (
            <div className="st-player-fallback">
              <img src="/media/explainer-poster.jpg" alt="" />
              <p>تعذّر تشغيل الفيديو على هذا الجهاز. المحتوى نفسه موجود بالمشاهد فوق.</p>
            </div>
          ) : (
            <>
              <video
                ref={video}
                controls={started}
                preload="none"
                playsInline
                poster="/media/explainer-poster.jpg"
                onError={() => setFailed(true)}
                aria-label="فيديو تعريفي بمنصة ذي قار الرقمية"
              >
                <source src="/media/explainer.webm" type="video/webm" />
                <source src="/media/explainer.mp4" type="video/mp4" />
                <track kind="captions" srcLang="ar" label="العربية" src="/media/explainer.ar.vtt" default />
              </video>
              {!started && (
                <button type="button" className="st-play" onClick={start}>
                  <span>
                    <Play aria-hidden="true" />
                  </span>
                  تعرّف على المنصة
                  <small>تشغيل الفيديو · ٠:٤٠</small>
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
   Scene 6 — start now
   ============================================================================================ */
export function StartScene() {
  const [, navigate] = useLocation()
  const [verifyId, setVerifyId] = useState('')
  return (
    <section className="st-scene st-start" id="start" aria-labelledby="st-start-title">
      <div className="st-wrap">
        <div className="st-start-card" data-reveal>
          <div>
            <span className="st-eyebrow is-light">ابدأ الآن</span>
            <h2 id="st-start-title">معاملتك الجاية، من بيتك.</h2>
            <p>سجّل برقم هاتفك ووثّق هويتك مرة وحدة، وبعدها كل دوائر المحافظة بمكان واحد.</p>
          </div>
          <div className="st-start-actions">
            <Link href="/onboarding" className="st-btn is-light">
              <FilePlus2 aria-hidden="true" /> إنشاء حساب
            </Link>
            <Link href="/login" className="st-btn is-line">
              <LogIn aria-hidden="true" /> تسجيل الدخول
            </Link>
            <Link href="/directory" className="st-btn is-line">
              <SearchCheck aria-hidden="true" /> استعراض الخدمات
            </Link>
          </div>
          <form
            className="st-verify"
            onSubmit={event => {
              event.preventDefault()
              if (verifyId.trim()) navigate(`/verify/${encodeURIComponent(verifyId.trim())}`)
            }}
          >
            <label htmlFor="st-verify-id">
              <QrCode aria-hidden="true" /> تحقق من صحة وثيقة حكومية
            </label>
            <div>
              <input
                id="st-verify-id"
                value={verifyId}
                onChange={event => setVerifyId(event.target.value)}
                placeholder="TQD-XXXX-XXXX"
                dir="ltr"
                autoComplete="off"
              />
              <button type="submit">تحقق</button>
              <Link href="/verify">مسح الرمز</Link>
            </div>
          </form>
        </div>
      </div>
    </section>
  )
}
