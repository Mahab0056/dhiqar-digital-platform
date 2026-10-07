import { useEffect, useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  Building2,
  ChevronLeft,
  FilePlus2,
  FileSearch,
  FileText,
  MessageSquareWarning,
  QrCode,
  SearchCheck,
  ShieldCheck,
} from 'lucide-react'
import { api } from '../../api'
import { services } from '../../data'
import { dhiqarNews } from '../../news'
import type { CatalogSummary } from '../../types'
import { SmartSearch } from '../../components/public/SmartSearch'
import { useRevealOnScroll } from '../../lib/reveal'
import { Footer } from '../../components/public/Footer'
import { PublicHeader } from '../../components/public/PublicHeader'

const quickActions = [
  { icon: FilePlus2, tone: 'green', title: 'تقديم معاملة', text: 'ابدأ طلباً حكومياً جديداً', href: '/onboarding' },
  { icon: FileSearch, tone: 'blue', title: 'متابعة معاملة', text: 'اعرف أين وصل طلبك', href: '/citizen#my-requests' },
  { icon: QrCode, tone: 'amber', title: 'التحقق من وثيقة', text: 'تأكد من صحة أي وثيقة', href: '/verify' },
  {
    icon: MessageSquareWarning,
    tone: 'rose',
    title: 'شكوى أو مقترح',
    text: 'صوتك يصل إلى الدائرة',
    href: '/citizen/feedback',
  },
] as const

// photo cards: "your guide to Dhi Qar" — real local photographs, one per service area
const guideCards = [
  {
    title: 'البلديات والبناء',
    text: 'إجازات البناء، الأراضي، خدمات البلدية وتراخيص المحلات',
    image: '/news/souq-shuyoukh-project.jpg',
    href: '/directory?category=البناء والبلديات',
  },
  {
    title: 'الماء والمجاري',
    text: 'الاشتراكات، البلاغات، ومتابعة مشاريع شبكات المياه',
    image: '/news/water-project.jpg',
    href: '/directory?category=الماء والمجاري',
  },
  {
    title: 'الكهرباء والطاقة',
    text: 'الاشتراكات الجديدة، البلاغات، وتسديد الفواتير',
    image: '/news/power-station.jpg',
    href: '/directory?q=كهرباء',
  },
  {
    title: 'الوثائق الحكومية',
    text: 'البطاقة الوطنية، الجواز، الشهادات والتصديقات',
    image: '/news/dhiqar-governorate.jpg',
    href: '/directory?category=الوثائق الحكومية',
  },
  {
    title: 'السكن والأراضي',
    text: 'التسجيل العقاري، قطع الأراضي، وتخصيص السكن',
    image: '/brand/hero-ur-right.jpg',
    href: '/directory?category=السكن والأراضي',
  },
  {
    title: 'الزراعة والأهوار',
    text: 'الإجازات الزراعية، الدعم، وخدمات الموارد المائية',
    image: '/brand/hero-marsh-left.jpg',
    href: '/directory?category=الزراعة',
  },
]

const popularSearches = [
  { label: 'إجازة بناء', href: '/service/building-permit' },
  { label: 'إجازة محل', href: '/service/store-license' },
  { label: 'البطاقة الوطنية', href: '/directory?q=البطاقة الوطنية' },
  { label: 'جواز السفر', href: '/directory?q=جواز' },
]

export function LandingPage() {
  useRevealOnScroll()
  const [, navigate] = useLocation()
  const [query, setQuery] = useState('')
  const [summary, setSummary] = useState<CatalogSummary | null>(null)
  const [departmentTotal, setDepartmentTotal] = useState(0)
  const [verifyId, setVerifyId] = useState('')

  useEffect(() => {
    api
      .getServicesSummary()
      .then(setSummary)
      .catch(() => setSummary(null))
    api
      .listDepartments()
      .then(result => setDepartmentTotal(result.items.length))
      .catch(() => setDepartmentTotal(0))
  }, [])

  return (
    <div className="tq-page is-home">
      <PublicHeader />
      <main id="main-content">
        {/* ---- hero ------------------------------------------------------------------------ */}
        <section className="home-hero" aria-labelledby="home-hero-title">
          <div className="tq-container home-hero-grid">
            <div className="home-hero-copy">
              <span className="home-eyebrow">
                <ShieldCheck aria-hidden="true" /> المنصة الرسمية لحكومة محافظة ذي قار
              </span>
              <h1 id="home-hero-title">
                خدماتك الحكومية
                <span>أسهل وأقرب إليك</span>
              </h1>
              <p>قدّم معاملتك، تابعها لحظة بلحظة، واستلم وثيقتك الرسمية إلكترونياً — من بيتك وبدون مراجعات.</p>
              <div className="home-search">
                <SmartSearch
                  value={query}
                  onChange={setQuery}
                  autoFocus={false}
                  placeholder="ما الخدمة التي تحتاجها؟ مثلاً: إجازة بناء"
                />
              </div>
              <div className="home-popular">
                <span>الأكثر طلباً:</span>
                {popularSearches.map(item => (
                  <Link href={item.href} key={item.label}>
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="home-hero-visual" aria-hidden="true">
              <div className="home-hero-photo">
                <img src="/brand/ur-heritage-hero.jpg" alt="" />
              </div>
              {summary && (
                <div className="home-float is-top">
                  <span className="home-float-icon">
                    <BookOpen />
                  </span>
                  <span>
                    <b>{summary.total.toLocaleString('en-US')} خدمة حكومية</b>
                    <small>من {departmentTotal ? departmentTotal.toLocaleString('en-US') : '—'} دائرة وجهة</small>
                  </span>
                </div>
              )}
              <div className="home-float is-bottom">
                <span className="home-float-icon is-green">
                  <BadgeCheck />
                </span>
                <span>
                  <b>وثائق رسمية قابلة للتحقق</b>
                  <small>برمز QR لكل وثيقة صادرة</small>
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ---- quick actions -------------------------------------------------------------------- */}
        <section className="tq-container home-actions" aria-label="إجراءات سريعة">
          {quickActions.map(action => (
            <Link href={action.href} className="home-action" key={action.title}>
              <span className={`home-action-icon is-${action.tone}`}>
                <action.icon />
              </span>
              <span className="home-action-text">
                <strong>{action.title}</strong>
                <small>{action.text}</small>
              </span>
              <ChevronLeft className="home-action-arrow" aria-hidden="true" />
            </Link>
          ))}
        </section>

        {/* ---- guide (photo cards) ------------------------------------------------------------ */}
        <section className="home-section" id="services" aria-labelledby="home-guide-title" data-reveal>
          <div className="tq-container">
            <header className="home-head">
              <h2 id="home-guide-title">دليلك إلى خدمات ذي قار</h2>
              <Link href="/directory" className="button outline small">
                عرض كل الخدمات <ArrowLeft />
              </Link>
            </header>
            <div className="home-guide">
              {guideCards.map(card => (
                <Link href={card.href} className="home-guide-card" key={card.title}>
                  <span className="home-guide-photo">
                    <img src={card.image} alt="" loading="lazy" />
                  </span>
                  <span className="home-guide-text">
                    <strong>{card.title}</strong>
                    <small>{card.text}</small>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ---- most used services ------------------------------------------------------------- */}
        <section className="home-section is-band" id="e-services" aria-labelledby="home-eservices-title" data-reveal>
          <div className="tq-container">
            <header className="home-head">
              <h2 id="home-eservices-title">الخدمات الأكثر استخداماً</h2>
              <Link href="/directory?channel=ONLINE_SUBMISSION" className="button outline small">
                كل الخدمات الإلكترونية <ArrowLeft />
              </Link>
            </header>
            <ul className="home-services">
              {services.slice(0, 8).map(service => (
                <li key={service.key}>
                  <Link href={`/service/${service.key}`}>
                    <span className="home-service-icon">
                      <FileText />
                    </span>
                    <strong>{service.title}</strong>
                    <small>{service.department}</small>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---- verification ------------------------------------------------------------------- */}
        <section className="home-section" id="verify" aria-labelledby="home-verify-title" data-reveal>
          <div className="tq-container">
            <div className="home-verify">
              <div className="home-verify-copy">
                <h2 id="home-verify-title">تحقق من صحة وثيقة حكومية</h2>
                <p>أدخل رقم الوثيقة أو امسح رمز QR المطبوع عليها لمعرفة صحتها وحالتها لدى الجهة المصدرة.</p>
                <form
                  className="home-verify-form"
                  onSubmit={event => {
                    event.preventDefault()
                    if (verifyId.trim()) navigate(`/verify/${encodeURIComponent(verifyId.trim())}`)
                  }}
                >
                  <input
                    value={verifyId}
                    onChange={event => setVerifyId(event.target.value)}
                    placeholder="TQD-XXXX-XXXX"
                    aria-label="رقم الوثيقة"
                    dir="ltr"
                    autoComplete="off"
                  />
                  <button type="submit" className="button primary">
                    <SearchCheck /> تحقق الآن
                  </button>
                  <Link href="/verify" className="button outline">
                    <QrCode /> مسح الرمز
                  </Link>
                </form>
              </div>
              <div className="home-verify-art" aria-hidden="true">
                <span>
                  <QrCode />
                </span>
                <b>
                  <BadgeCheck /> وثيقة صحيحة
                </b>
              </div>
            </div>
          </div>
        </section>

        {/* ---- news --------------------------------------------------------------------------- */}
        {dhiqarNews.length > 0 && (
          <section className="home-section is-band" id="news" aria-labelledby="home-news-title" data-reveal>
            <div className="tq-container">
              <header className="home-head">
                <h2 id="home-news-title">آخر أخبار المحافظة</h2>
                <Link href="/departments" className="button outline small">
                  <Building2 /> دليل الدوائر
                </Link>
              </header>
              <div className="home-news">
                {dhiqarNews.slice(0, 3).map(item => (
                  <a className="home-news-card" href={item.sourceUrl} target="_blank" rel="noreferrer" key={item.sourceUrl}>
                    <span className="home-news-photo">
                      <img src={item.image} alt="" loading="lazy" />
                    </span>
                    <span className="home-news-text">
                      <small>
                        {item.category} | {item.source}
                      </small>
                      <strong>{item.title}</strong>
                    </span>
                  </a>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ---- closing call to action -------------------------------------------------------- */}
        <section className="home-section" data-reveal>
          <div className="tq-container">
            <div className="home-cta">
              <div>
                <h2>جاهز تبدأ معاملتك؟</h2>
                <p>سجّل برقم هاتفك ووثّق هويتك مرة واحدة، ثم قدّم أي خدمة من مكانك.</p>
              </div>
              <div className="home-cta-actions">
                <Link href="/onboarding" className="button">
                  <FilePlus2 /> ابدأ الآن
                </Link>
                <Link href="/directory" className="button is-ghost-light">
                  تصفّح الخدمات
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
