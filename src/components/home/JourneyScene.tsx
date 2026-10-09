import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BadgeCheck,
  Banknote,
  CircleAlert,
  ClipboardList,
  FileCheck2,
  FileUp,
  Search,
  Send,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react'
import { useMotionPref } from './motion-pref'

type Stage = { key: string; title: string; text: string; conditional?: string; icon: typeof Search }

// the real lifecycle of an application on the platform, in order
const STAGES: Stage[] = [
  {
    key: 'pick',
    icon: Search,
    title: 'اختيار الخدمة',
    text: 'تكتب اللي تحتاجه بكلامك، والمنصة تطلعلك الخدمة الصحيحة والدائرة المسؤولة عنها.',
  },
  {
    key: 'form',
    icon: ClipboardList,
    title: 'تعبئة البيانات',
    text: 'استمارة مختصرة، بياناتك الأساسية تنملي تلقائياً من حسابك الموثّق.',
  },
  {
    key: 'docs',
    icon: FileUp,
    title: 'رفع المستمسكات',
    text: 'تصوّر المستمسك بالموبايل أو ترفعه، وتگدر تبدّله قبل الإرسال.',
  },
  { key: 'send', icon: Send, title: 'إرسال الطلب', text: 'يوصلك رقم معاملة، والطلب يروح مباشرة للدائرة المختصة.' },
  {
    key: 'review',
    icon: UserRoundCheck,
    title: 'تدقيق الموظف',
    text: 'الموظف المخوّل بالدائرة يدقق الطلب والمستمسكات، وأنت تشوف الحالة لحظة بلحظة.',
  },
  {
    key: 'fix',
    icon: CircleAlert,
    title: 'استكمال النواقص',
    text: 'إذا ناقص شي، يوصلك إشعار بالسبب بالضبط، وتكمله من نفس الطلب بدون ما تعيد التقديم.',
    conditional: 'عند الحاجة فقط',
  },
  {
    key: 'approve',
    icon: BadgeCheck,
    title: 'الموافقة',
    text: 'القرار يصدر من الجهة المخولة، ويتسجل باسم الموظف ووقته.',
  },
  {
    key: 'pay',
    icon: Banknote,
    title: 'الدفع',
    text: 'للخدمات اللي بيها رسوم، تدفع إلكترونياً ويوصلك وصل رسمي.',
    conditional: 'حسب الخدمة وعند تفعيل بوابة الدفع',
  },
  {
    key: 'issue',
    icon: FileCheck2,
    title: 'إصدار الوثيقة',
    text: 'وثيقة PDF رسمية برمز QR، أي جهة تگدر تتحقق من صحتها.',
  },
]

/** Sticky storytelling: the application screen stays in view while each stage scrolls past beside it. */
export function JourneyScene() {
  const [active, setActive] = useState(0)
  const { still } = useMotionPref()
  const stepRefs = useRef<(HTMLLIElement | null)[]>([])

  useEffect(() => {
    // the stage whose text crosses the middle of the viewport drives the screen
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.index))
        }
      },
      { rootMargin: '-48% 0px -48% 0px' }
    )
    for (const element of stepRefs.current) if (element) observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <section className="st-scene st-journey" id="journey" aria-labelledby="st-journey-title">
      <div className="st-wrap">
        <header className="st-head" data-reveal>
          <span className="st-eyebrow">المشهد الثاني</span>
          <h2 id="st-journey-title">
            من الطلب <em>إلى الإنجاز.</em>
          </h2>
          <p>تسع محطات واضحة، وكل وحدة تعرف وين وصلت بيها معاملتك.</p>
        </header>

        <div className="st-journey-grid">
          <ol className="st-steps">
            {STAGES.map((stage, index) => (
              <li
                key={stage.key}
                ref={element => {
                  stepRefs.current[index] = element
                }}
                data-index={index}
                className={index === active ? 'is-active' : index < active ? 'is-done' : ''}
                aria-current={index === active ? 'step' : undefined}
              >
                <span className="st-step-num">{(index + 1).toLocaleString('ar-IQ')}</span>
                <div>
                  <h3>
                    {stage.title}
                    {stage.conditional && <small className="st-cond">{stage.conditional}</small>}
                  </h3>
                  <p>{stage.text}</p>
                  {/* phones get each screen inline instead of the sticky device */}
                  <div className="st-step-inline" aria-hidden="true">
                    <AppScreen stage={index} />
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <div className="st-device-col" aria-hidden="true">
            <div className="st-device-back">
              <span className="st-big-ico is-ok">
                <BadgeCheck />
              </span>
              <b>تم استلام الطلب</b>
              <small>يوصلك إشعار بكل مرحلة عبر حسابك بالمنصة</small>
              <span className="st-mini-btn">متابعة الطلب</span>
              <i />
              <i />
              <i />
            </div>
            <div className="st-device">
              <div className="st-device-bar">
                <span>طلب إجازة فتح محل تجاري</span>
                <b>TQ-2026-048213</b>
              </div>
              <div className="st-rail">
                {STAGES.map((stage, index) => (
                  <i key={stage.key} className={index < active ? 'is-done' : index === active ? 'is-on' : ''} />
                ))}
              </div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={active}
                  className="st-device-body"
                  initial={still ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={still ? undefined : { opacity: 0, y: -10 }}
                  transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  <AppScreen stage={active} />
                </motion.div>
              </AnimatePresence>
            </div>
            <p className="st-device-note">نموذج توضيحي لواجهة المواطن</p>
          </div>
        </div>
      </div>
    </section>
  )
}

const Field = ({ label, value, on }: { label: string; value: string; on?: boolean }) => (
  <div className={`st-field${on ? ' is-on' : ''}`}>
    <small>{label}</small>
    <span>{value}</span>
  </div>
)

const Doc = ({ name, state }: { name: string; state: 'ok' | 'up' | 'bad' }) => (
  <div className={`st-doc is-${state}`}>
    <span className="st-doc-ico">PDF</span>
    <span>
      <b>{name}</b>
      <small>{state === 'ok' ? 'تم الرفع' : state === 'up' ? 'جاري الرفع…' : 'الصورة غير واضحة'}</small>
    </span>
    {state === 'up' && <i className="st-doc-bar" />}
  </div>
)

const Status = ({ tone, children }: { tone: 'ok' | 'wait' | 'warn' | 'info'; children: ReactNode }) => (
  <span className={`st-pill is-${tone}`}>{children}</span>
)

function AppScreen({ stage }: { stage: number }) {
  switch (STAGES[stage].key) {
    case 'pick':
      return (
        <div className="st-screen">
          <div className="st-search-mock">
            <Search /> اريد افتح محل بالناصرية
          </div>
          <div className="st-result is-on">
            <b>إجازة فتح محل تجاري</b>
            <small>بلدية الناصرية · إلكترونية</small>
          </div>
          <div className="st-result">
            <b>تجديد إجازة محل</b>
            <small>بلدية الناصرية</small>
          </div>
          <div className="st-result">
            <b>إجازة ممارسة مهنة</b>
            <small>غرفة تجارة ذي قار</small>
          </div>
        </div>
      )
    case 'form':
      return (
        <div className="st-screen">
          <Field label="الاسم الكامل" value="علي حسين جاسم" />
          <Field label="نوع النشاط" value="محل مواد غذائية" on />
          <Field label="العنوان" value="الناصرية — حي الشموخ" />
          <Field label="مساحة المحل" value="٣٦ م²" />
          <span className="st-saved">
            <ShieldCheck /> تم حفظ المسودة
          </span>
        </div>
      )
    case 'docs':
      return (
        <div className="st-screen">
          <Doc name="البطاقة الوطنية الموحدة" state="ok" />
          <Doc name="بطاقة السكن" state="ok" />
          <Doc name="عقد إيجار المحل" state="up" />
        </div>
      )
    case 'send':
      return (
        <div className="st-screen is-center">
          <span className="st-big-ico is-ok">
            <Send />
          </span>
          <b>تم إرسال طلبك</b>
          <small>رقم المعاملة</small>
          <code>TQ-2026-048213</code>
          <Status tone="info">وصل إلى بلدية الناصرية — قسم الإجازات</Status>
        </div>
      )
    case 'review':
      return (
        <div className="st-screen">
          <Status tone="wait">قيد التدقيق</Status>
          <ul className="st-timeline">
            <li className="is-done">تم الاستلام · الأحد ٩:١٤ ص</li>
            <li className="is-on">تدقيق المستمسكات · موظف قسم الإجازات</li>
            <li>القرار</li>
          </ul>
        </div>
      )
    case 'fix':
      return (
        <div className="st-screen">
          <div className="st-alert">
            <CircleAlert />
            <span>
              <b>مطلوب استكمال</b>
              <small>صورة عقد الإيجار غير واضحة — يرجى رفع نسخة أوضح.</small>
            </span>
          </div>
          <Doc name="عقد إيجار المحل" state="bad" />
          <span className="st-mini-btn">رفع نسخة جديدة</span>
        </div>
      )
    case 'approve':
      return (
        <div className="st-screen is-center">
          <span className="st-big-ico is-ok">
            <BadgeCheck />
          </span>
          <b>تمت الموافقة على طلبك</b>
          <small>بلدية الناصرية · قسم الإجازات</small>
        </div>
      )
    case 'pay':
      return (
        <div className="st-screen">
          <div className="st-pay">
            <small>رسوم الإجازة</small>
            <b>٢٥٬٠٠٠ د.ع</b>
          </div>
          <div className="st-result is-on">
            <b>بطاقة مصرفية</b>
            <small>دفع آمن عبر بوابة الدفع</small>
          </div>
          <span className="st-mini-btn">ادفع الآن</span>
        </div>
      )
    default:
      return (
        <div className="st-screen st-issued">
          <div className="st-paper">
            <small>جمهورية العراق · محافظة ذي قار</small>
            <b>إجازة فتح محل تجاري</b>
            <i />
            <i />
            <i className="is-short" />
            <QrMark />
          </div>
          <Status tone="ok">وثيقة موثّقة — تحقق عبر QR</Status>
        </div>
      )
  }
}

// a QR-like mark for the illustration (the real documents carry a scannable code)
function QrMark() {
  const cells: [number, number][] = []
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let y = 0; y < 15; y++)
    for (let x = 0; x < 15; x++) {
      const finder = (x < 5 && y < 5) || (x > 9 && y < 5) || (x < 5 && y > 9)
      if (finder ? x % 4 === 0 || y % 4 === 0 || (x % 5 === 2 && y % 5 === 2) || (x === 12 && y === 2) : rnd() > 0.52)
        cells.push([x, y])
    }
  return (
    <svg className="st-qr" viewBox="0 0 15 15" style={{ '--n': cells.length } as CSSProperties}>
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />
      ))}
    </svg>
  )
}
