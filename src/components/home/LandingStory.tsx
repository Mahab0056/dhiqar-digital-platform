import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useLocation } from 'wouter'
import { motion, useScroll, useTransform } from 'framer-motion'
import {
  ArrowLeft,
  BadgeCheck,
  Bell,
  Check,
  FilePlus2,
  Fingerprint,
  Inbox,
  ListChecks,
  LogIn,
  MessagesSquare,
  QrCode,
  ScanFace,
  Search,
  SearchCheck,
  Send,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { api } from '../../api'
import { SmartSearch } from '../public/SmartSearch'
import { useMotionPref } from './motion-pref'

const css = (vars: Record<string, string | number>) => vars as CSSProperties

/** Fires once when the element is a quarter on screen (immediately when motion is still). */
function useOnScreen<T extends Element>(threshold = 0.25) {
  const ref = useRef<T>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setOn(true)
          observer.disconnect()
        }
      },
      { threshold }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [threshold])
  return [ref, on] as const
}

/** Counts up to `to` once `run` turns true. */
function CountUp({ to, run }: { to: number; run: boolean }) {
  const { still } = useMotionPref()
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!run || still) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1400)
      setValue(Math.round(to * (1 - Math.pow(1 - t, 3))))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [run, to, still])
  return <>{(still || !run ? to : value).toLocaleString('ar-IQ')}</>
}

/* ============================================================================================
   Scene 1 — every service in one place: a live search box, the counts, and the citizen app
   showing a search turn into a request
   ============================================================================================ */
const TYPED = 'اريد اطلع اجازة سوق'
const RESULTS = [
  { title: 'تجديد إجازة السياقة', dept: 'مديرية مرور ذي قار', channel: 'إلكترونية' },
  { title: 'إصدار إجازة السياقة لأول مرة', dept: 'مديرية مرور ذي قار', channel: 'إلكترونية + حضور' },
  { title: 'بدل فاقد لإجازة السياقة', dept: 'مديرية مرور ذي قار', channel: 'إلكترونية' },
]
const NEEDS = ['البطاقة الوطنية الموحدة', 'إجازة السياقة المنتهية', 'فحص النظر من مركز معتمد']

export function LandingServices() {
  const { still } = useMotionPref()
  const [query, setQuery] = useState('')
  const [counts, setCounts] = useState({ services: 437, departments: 80 })
  const [ref, on] = useOnScreen<HTMLDListElement>(0.35)
  const [typed, setTyped] = useState(still ? TYPED.length : 0)
  const section = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: section, offset: ['start end', 'center center'] })
  const rise = useTransform(scrollYProgress, [0, 1], still ? ['0px', '0px'] : ['90px', '0px'])
  const turn = useTransform(scrollYProgress, [0, 1], still ? [0, 0] : [10, 0])

  useEffect(() => {
    api
      .getServicesSummary()
      .then(summary => setCounts(current => ({ ...current, services: summary.total })))
      .catch(() => undefined)
    api
      .listDepartments()
      .then(result => setCounts(current => ({ ...current, departments: result.items.length })))
      .catch(() => undefined)
  }, [])

  // the citizen types a request in their own words, then the matching services appear
  useEffect(() => {
    if (!on || still) return
    let index = 0
    const timer = window.setInterval(() => {
      index += 1
      setTyped(index)
      if (index >= TYPED.length) window.clearInterval(timer)
    }, 70)
    return () => window.clearInterval(timer)
  }, [on, still])
  const shown = still ? TYPED.length : typed
  const found = shown >= TYPED.length

  return (
    <section className="ld-services" id="services" ref={section} aria-labelledby="ld-services-title">
      <div className="ld-wrap ld-services-grid">
        <div className="ld-services-copy" data-reveal>
          <span className="ld-kicker">المشهد الأول</span>
          <h2 id="ld-services-title" className="ld-split">
            <span className="ld-l">
              <span>كل خدماتك،</span>
            </span>
            <span className="ld-l" style={css({ '--l': 1 })}>
              <em>بمكان واحد.</em>
            </span>
          </h2>
          <p>اكتب اللي تحتاجه بكلامك، تعرف المستمسكات المطلوبة والدائرة المسؤولة، وتبدأ طلبك من نفس الصفحة.</p>
          <ul className="ld-ticks">
            <li>
              <Search aria-hidden="true" /> ابحث بالعامية أو بالصوت
            </li>
            <li>
              <ListChecks aria-hidden="true" /> اعرف المتطلبات والرسوم قبل ما تبدي
            </li>
            <li>
              <Send aria-hidden="true" /> قدّم إلكترونياً وتابع من حسابك
            </li>
          </ul>
          <div className="ld-live-search">
            <SmartSearch
              value={query}
              onChange={setQuery}
              variant="compact"
              placeholder="جرّب: تجديد جواز، إجازة بناء…"
            />
          </div>
          <dl className="ld-counts" ref={ref}>
            <div>
              <dd>
                <CountUp to={counts.services} run={on} />
              </dd>
              <dt>خدمة حكومية</dt>
            </div>
            <div>
              <dd>
                <CountUp to={counts.departments} run={on} />
              </dd>
              <dt>دائرة وجهة</dt>
            </div>
            <div>
              <dd>
                <CountUp to={12} run={on} />
              </dd>
              <dt>قضاء</dt>
            </div>
          </dl>
        </div>

        <motion.div
          className="ld-app"
          style={{ y: rise, rotateX: turn, transformPerspective: 1400 }}
          data-found={found ? '' : undefined}
          aria-hidden="true"
        >
          <div className="ld-app-bar">
            <span />
            <span />
            <span />
            <b>thi-qar.gov.iq</b>
          </div>
          <div className="ld-app-body">
            <div className="ld-app-search">
              <Search />
              <span>
                {TYPED.slice(0, shown)}
                {!found && <i className="ld-caret" />}
              </span>
            </div>
            <ul className="ld-app-results">
              {RESULTS.map((item, index) => (
                <li key={item.title} className={index === 0 ? 'is-pick' : ''} style={css({ '--s': index })}>
                  <span className="ld-chip">{item.channel}</span>
                  <b>{item.title}</b>
                  <small>{item.dept}</small>
                </li>
              ))}
            </ul>
            <div className="ld-app-needs">
              <b>المستمسكات المطلوبة</b>
              {NEEDS.map((need, index) => (
                <span key={need} style={css({ '--s': index })}>
                  <Check /> {need}
                </span>
              ))}
              <span className="ld-app-cta">
                ابدأ الطلب <ArrowLeft />
              </span>
            </div>
          </div>
          <p className="ld-app-note">نموذج توضيحي لواجهة المواطن · نتائج البحث من دليل الخدمات الحقيقي</p>
        </motion.div>
      </div>
    </section>
  )
}

/* ============================================================================================
   Scene 3 — every department knows what is needed: the request lands in the right inbox,
   the employee checks the documents, the status updates and the citizen is told
   ============================================================================================ */
const QUEUE = [
  { ref: 'TQD-2026-0418', service: 'إصدار هوية سكنية', who: 'م.ع. ياسين', state: 'جديد', tone: 'is-new' },
  {
    ref: 'TQD-2026-0411',
    service: 'إجازة ترميم أو إضافة بناء',
    who: 'ح.ك. الركابي',
    state: 'قيد التدقيق',
    tone: 'is-wait',
  },
  {
    ref: 'TQD-2026-0397',
    service: 'إجازة ممارسة مهنة',
    who: 'ز.ج. الحسيني',
    state: 'بانتظار المواطن',
    tone: 'is-warn',
  },
  { ref: 'TQD-2026-0385', service: 'إجازة بناء دار سكنية', who: 'س.ف. الموسوي', state: 'تمت الموافقة', tone: 'is-ok' },
]
const CHECKS = ['البيانات مطابقة للهوية الموثّقة', 'هوية الأحوال المدنية واضحة ومقروءة', 'بطاقة السكن مطابقة للعنوان']

export function LandingDepartment() {
  const { still } = useMotionPref()
  const [ref, on] = useOnScreen<HTMLDivElement>(0.3)
  const [step, setStep] = useState(still ? 5 : 0)
  const section = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: section, offset: ['start end', 'center center'] })
  // the request travels along the route from the citizen to the department as the scene arrives
  const route = useTransform(scrollYProgress, [0.1, 0.9], still ? [1, 1] : [0, 1])

  // a short timeline once the inbox is on screen: arrive → open → check ×3 → approve → notify
  useEffect(() => {
    if (!on || still) return
    const timers = [400, 1200, 1900, 2600, 3300, 4100].map((delay, index) =>
      window.setTimeout(() => setStep(index + 1), delay)
    )
    return () => timers.forEach(window.clearTimeout)
  }, [on, still])
  const shown = still ? 6 : step

  return (
    <section className="ld-dept" id="department" ref={section} aria-labelledby="ld-dept-title">
      <div className="ld-wrap">
        <div className="ld-dept-head" data-reveal>
          <span className="ld-kicker">المشهد الثالث</span>
          <h2 id="ld-dept-title" className="ld-split">
            <span className="ld-l">
              <span>
                كل دائرة <em>تعرف المطلوب.</em>
              </span>
            </span>
          </h2>
          <p>الطلب يوصل للدائرة المختصة تلقائياً، يدخل قائمة عمل الموظف المخوّل، وكل تحديث يوصل للمواطن بنفس اللحظة.</p>
        </div>

        <div className="ld-route" aria-hidden="true">
          <span className="ld-route-end">
            <UserRound /> المواطن
          </span>
          <svg viewBox="0 0 600 40" preserveAspectRatio="none">
            <path className="ld-route-track" d="M600 20 C450 20 420 4 300 4 S150 36 0 20" />
            <motion.path
              className="ld-route-line"
              d="M600 20 C450 20 420 4 300 4 S150 36 0 20"
              style={{ pathLength: route }}
            />
          </svg>
          <span className="ld-route-end is-dept">
            <Inbox /> بلدية الناصرية
          </span>
        </div>

        <div className="ld-desk" ref={ref} data-step={shown} aria-hidden="true">
          <div className="ld-inbox">
            <div className="ld-panel-head">
              <b>
                <Inbox /> قائمة العمل — قسم الإجازات
              </b>
              <span className="ld-pill is-new">{shown >= 1 ? '١ جديد' : 'لا جديد'}</span>
            </div>
            <ul>
              {QUEUE.map((row, index) => (
                <li
                  key={row.ref}
                  className={`${index === 0 ? 'is-incoming' : ''}${index === 0 && shown >= 2 ? ' is-open' : ''}`}
                >
                  <span className="ld-ref">{row.ref}</span>
                  <b>{row.service}</b>
                  <small>{row.who}</small>
                  <span
                    className={`ld-pill ${index === 0 && shown >= 5 ? 'is-ok' : index === 0 && shown >= 2 ? 'is-wait' : row.tone}`}
                  >
                    {index === 0 && shown >= 5 ? 'تمت الموافقة' : index === 0 && shown >= 2 ? 'قيد التدقيق' : row.state}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="ld-review">
            <div className="ld-panel-head">
              <b>
                <ListChecks /> تدقيق المستمسكات
              </b>
              <span className="ld-ref">TQD-2026-0418</span>
            </div>
            <ul className="ld-review-list">
              {CHECKS.map((check, index) => (
                <li key={check} className={shown >= index + 2 ? 'is-done' : shown === index + 1 ? 'is-run' : ''}>
                  <span>{shown >= index + 2 ? <Check /> : null}</span>
                  {check}
                </li>
              ))}
            </ul>
            <div className="ld-review-actions">
              <span className={`ld-approve${shown >= 5 ? ' is-done' : ''}`}>
                {shown >= 5 ? (
                  <>
                    <BadgeCheck /> تمت الموافقة
                  </>
                ) : (
                  'موافقة'
                )}
              </span>
              <span className="ld-ask">طلب استكمال</span>
            </div>
            <p className="ld-fine">القرار للموظف المخوّل فقط، ويُسجَّل باسمه ووقته في سجل التدقيق.</p>
          </div>

          <div className={`ld-toast${shown >= 6 ? ' is-on' : ''}`}>
            <Bell />
            <span>
              <b>وصل إشعار للمواطن</b>
              <small>«تمت الموافقة على طلبك TQD-2026-0418»</small>
            </span>
          </div>
        </div>
        <p className="ld-note">نموذج توضيحي متناسق مع بوابة الموظف الحقيقية · الأسماء مختصرة ومموّهة</p>
      </div>
    </section>
  )
}

/* ============================================================================================
   Scene 5 — smart help at every step
   ============================================================================================ */
export function LandingAssistant() {
  const { still } = useMotionPref()
  const [ref, on] = useOnScreen<HTMLDivElement>(0.3)
  const [shown, setShown] = useState(still ? 9 : 0)
  useEffect(() => {
    if (!on || still) return
    const timers = [300, 1300, 2300, 3300, 3900, 4500, 5100].map((delay, index) =>
      window.setTimeout(() => setShown(index + 1), delay)
    )
    return () => timers.forEach(window.clearTimeout)
  }, [on, still])
  const n = still ? 9 : shown
  return (
    <section className="ld-assist" id="assistant" aria-labelledby="ld-assist-title">
      <div className="ld-wrap">
        <div className="ld-assist-head" data-reveal>
          <span className="ld-kicker">المشهد الخامس</span>
          <h2 id="ld-assist-title" className="ld-split">
            <span className="ld-l">
              <span>
                مساعدة ذكية <em>بكل خطوة.</em>
              </span>
            </span>
          </h2>
          <p>يساعد المواطن يوصل للخدمة الصحيحة ويكتشف النواقص، ويختصر على الموظف وقت التدقيق.</p>
        </div>

        <div className="ld-assist-grid" ref={ref} aria-hidden="true">
          <div className="ld-card">
            <div className="ld-panel-head">
              <b>
                <MessagesSquare /> للمواطن
              </b>
              <span className="ld-tag">تصوّر لميزة قادمة</span>
            </div>
            <div className="ld-chat">
              {n >= 1 && <p className="ld-msg is-me">اريد افتح محل مواد غذائية بالناصرية، شنو أحتاج؟</p>}
              {n === 1 && (
                <p className="ld-msg is-typing">
                  <i />
                  <i />
                  <i />
                </p>
              )}
              {n >= 2 && (
                <p className="ld-msg">
                  تحتاج خدمة <b>إجازة فتح محل تجاري</b> من بلدية الناصرية. المتطلبات: البطاقة الوطنية، بطاقة السكن، وعقد
                  إيجار المحل.
                </p>
              )}
              {n === 2 && (
                <p className="ld-msg is-typing">
                  <i />
                  <i />
                  <i />
                </p>
              )}
              {n >= 3 && (
                <p className="ld-msg is-warn">
                  لاحظت إن <b>عقد الإيجار</b> ما مرفوع بعد بطلبك. ارفعه حتى ما يتأخر التدقيق.
                </p>
              )}
            </div>
          </div>

          <div className="ld-card">
            <div className="ld-panel-head">
              <b>
                <Sparkles /> للموظف
              </b>
              <span className="ld-tag is-live">مفعّل حالياً</span>
            </div>
            <div className="ld-summary-list">
              <div className={n >= 4 ? 'is-on' : ''}>
                <ScanFace /> الوجه مطابق لصورة الهوية
              </div>
              <div className={n >= 5 ? 'is-on' : ''}>
                <Fingerprint /> الاسم المكتوب يطابق الاسم على الوثيقة
              </div>
              <div className={n >= 6 ? 'is-on is-ok' : ''}>
                <BadgeCheck /> النتائج الآلية متطابقة — جاهز للقرار
              </div>
            </div>
            <p className="ld-decide">
              <b>القرار الإداري النهائي يبقى للجهة المخوّلة.</b> الملخص الآلي يساعد الموظف فقط ولا يوافق أو يرفض من
              عنده.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ============================================================================================
   Scene 6 — start now
   ============================================================================================ */
export function LandingStart() {
  const [, navigate] = useLocation()
  const [verifyId, setVerifyId] = useState('')
  return (
    <section className="ld-start" id="start" aria-labelledby="ld-start-title">
      <div className="ld-wrap">
        <div className="ld-start-card" data-reveal>
          <img className="ld-start-mark" src="/brand/dhiqar-unified-logo.png" alt="" width={84} height={84} />
          <div className="ld-start-copy">
            <span className="ld-kicker is-light">ابدأ الآن</span>
            <h2 id="ld-start-title">معاملتك الجاية، من بيتك.</h2>
            <p>سجّل برقم هاتفك ووثّق هويتك مرة وحدة، وبعدها كل دوائر المحافظة بمكان واحد.</p>
          </div>
          <div className="ld-start-actions">
            <Link href="/onboarding" className="ld-btn is-light">
              <FilePlus2 aria-hidden="true" /> إنشاء حساب
            </Link>
            <Link href="/login" className="ld-btn is-line">
              <LogIn aria-hidden="true" /> تسجيل الدخول
            </Link>
            <Link href="/directory" className="ld-btn is-line">
              <SearchCheck aria-hidden="true" /> استعراض الخدمات
            </Link>
          </div>
          <form
            className="ld-verify"
            onSubmit={event => {
              event.preventDefault()
              if (verifyId.trim()) navigate(`/verify/${encodeURIComponent(verifyId.trim())}`)
            }}
          >
            <label htmlFor="ld-verify-id">
              <QrCode aria-hidden="true" /> تحقق من صحة وثيقة حكومية
            </label>
            <div>
              <input
                id="ld-verify-id"
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
