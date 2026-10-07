import { useEffect, useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  Bus,
  ChevronLeft,
  FilePlus2,
  FileSearch,
  FileText,
  GraduationCap,
  HeartPulse,
  Home,
  LayoutGrid,
  Leaf,
  MessageSquareWarning,
  QrCode,
  SearchCheck,
  ShieldCheck,
  UserRound,
  Zap,
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
  { icon: FilePlus2, title: 'تقديم معاملة', text: 'ابدأ طلباً حكومياً جديداً', href: '/onboarding' },
  { icon: FileSearch, title: 'متابعة معاملة', text: 'اعرف أين وصل طلبك', href: '/citizen#my-requests' },
  { icon: BookOpen, title: 'دليل الخدمات', text: 'المستمسكات والرسوم لكل خدمة', href: '/directory' },
  { icon: QrCode, title: 'التحقق من وثيقة', text: 'امسح رمز QR للتأكد من صحتها', href: '/verify' },
] as const

const homeCategories = [
  { label: 'الأعمال والتجارة', icon: BriefcaseBusiness, href: '/directory?category=المحلات والأعمال' },
  { label: 'السكن والعقار', icon: Home, href: '/directory?category=السكن والأراضي' },
  { label: 'الماء والكهرباء', icon: Zap, href: '/directory?q=ماء' },
  { label: 'البلديات', icon: Building2, href: '/directory?category=البناء والبلديات' },
  { label: 'الزراعة', icon: Leaf, href: '/directory?category=الزراعة' },
  { label: 'المرور والنقل', icon: Bus, href: '/directory?category=الأمن والمرور' },
  { label: 'التعليم', icon: GraduationCap, href: '/directory?q=تعليم' },
  { label: 'الصحة', icon: HeartPulse, href: '/directory?category=الصحة' },
  { label: 'الوثائق الشخصية', icon: UserRound, href: '/directory?category=الوثائق الحكومية' },
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

  // real figures only — nothing renders until the catalogue answers
  const stats = summary
    ? [
        { value: summary.total, label: 'خدمة حكومية' },
        { value: departmentTotal, label: 'دائرة وجهة' },
        { value: summary.channels.ONLINE_SUBMISSION || 0, label: 'تُنجز إلكترونياً بالكامل' },
      ].filter(item => item.value > 0)
    : []

  return (
    <div className="tq-page is-home">
      <PublicHeader />
      <main id="main-content">
        {/* ---- hero ------------------------------------------------------------------------ */}
        <section className="home-hero" aria-labelledby="home-hero-title">
          <div className="tq-container home-hero-inner">
            <span className="home-hero-eyebrow">من أرض الحضارة الأولى</span>
            <h1 id="home-hero-title">
              كل خدمات ذي قار
              <span>في مكان واحد</span>
            </h1>
            <p>البوابة الحكومية الرسمية للمحافظة — قدّم معاملتك، تابعها، واستلم وثيقتك إلكترونياً بثقة وأمان.</p>
            <div className="home-search">
              <SmartSearch
                value={query}
                onChange={setQuery}
                autoFocus={false}
                placeholder="ابحث عن خدمة… إجازة بناء، جواز سفر، البطاقة الوطنية"
              />
            </div>
            <div className="home-popular">
              <span>الأكثر طلباً</span>
              {popularSearches.map(item => (
                <Link href={item.href} key={item.label}>
                  {item.label}
                </Link>
              ))}
            </div>
            {stats.length > 0 && (
              <dl className="home-stats">
                {stats.map(item => (
                  <div key={item.label}>
                    <dd>{item.value.toLocaleString('en-US')}</dd>
                    <dt>{item.label}</dt>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <div className="tq-container">
            <nav className="home-actions" aria-label="إجراءات سريعة">
              {quickActions.map(action => (
                <Link href={action.href} className="home-action" key={action.title}>
                  <span className="home-action-icon">
                    <action.icon />
                  </span>
                  <strong>{action.title}</strong>
                  <small>{action.text}</small>
                  <ChevronLeft className="home-action-arrow" aria-hidden="true" />
                </Link>
              ))}
            </nav>
          </div>
        </section>

        {/* ---- categories --------------------------------------------------------------------- */}
        <section className="home-section" id="services" aria-labelledby="home-categories-title" data-reveal>
          <div className="tq-container">
            <header className="home-head">
              <span className="home-kicker">تصفّح حسب الموضوع</span>
              <h2 id="home-categories-title">ماذا تريد أن تنجز اليوم؟</h2>
            </header>
            <div className="home-categories">
              {homeCategories.map(item => (
                <Link href={item.href} className="home-category" key={item.label}>
                  <span className="home-category-icon">
                    <item.icon />
                  </span>
                  <strong>{item.label}</strong>
                </Link>
              ))}
              <Link href="/directory" className="home-category is-all">
                <span className="home-category-icon">
                  <LayoutGrid />
                </span>
                <strong>كل الخدمات</strong>
              </Link>
            </div>
          </div>
        </section>

        {/* ---- e-services --------------------------------------------------------------------- */}
        <section className="home-section is-alt" id="e-services" aria-labelledby="home-eservices-title" data-reveal>
          <div className="tq-container">
            <header className="home-head is-row">
              <div>
                <span className="home-kicker">خدمات إلكترونية بالكامل</span>
                <h2 id="home-eservices-title">ابدأ معاملتك من بيتك</h2>
              </div>
              <Link href="/directory?channel=ONLINE_SUBMISSION" className="home-more">
                كل الخدمات الإلكترونية <ArrowLeft size={16} />
              </Link>
            </header>
            <ul className="home-services">
              {services.slice(0, 6).map(service => (
                <li key={service.key}>
                  <Link href={`/service/${service.key}`}>
                    <span className="home-service-icon">
                      <FileText />
                    </span>
                    <span className="home-service-text">
                      <strong>{service.title}</strong>
                      <small>{service.department}</small>
                    </span>
                    <ChevronLeft className="home-service-arrow" aria-hidden="true" />
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
                <span className="home-kicker">للمواطنين والجهات</span>
                <h2 id="home-verify-title">تحقق من صحة أي وثيقة صادرة من المنصة</h2>
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
                  <button type="submit" className="button primary" disabled={!verifyId.trim()}>
                    <SearchCheck /> تحقق
                  </button>
                  <Link href="/verify" className="button outline">
                    <QrCode /> مسح الرمز
                  </Link>
                </form>
              </div>
              <div className="home-verify-seal" aria-hidden="true">
                <ShieldCheck />
                <span>
                  <BadgeCheck /> وثيقة صحيحة
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ---- news --------------------------------------------------------------------------- */}
        {dhiqarNews.length > 0 && (
          <section className="home-section is-alt" id="news" aria-labelledby="home-news-title" data-reveal>
            <div className="tq-container">
              <header className="home-head is-row">
                <div>
                  <span className="home-kicker">من المحافظة</span>
                  <h2 id="home-news-title">آخر الأخبار</h2>
                </div>
                <Link href="/departments" className="home-more">
                  دليل الدوائر والخريطة <ArrowLeft size={16} />
                </Link>
              </header>
              <div className="home-news">
                {dhiqarNews.slice(0, 3).map((item, index) => (
                  <a
                    className={index === 0 ? 'home-news-card is-featured' : 'home-news-card'}
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    key={item.sourceUrl}
                  >
                    <img src={item.image} alt="" loading={index === 0 ? 'eager' : 'lazy'} />
                    <span>
                      <small>
                        {item.category} • {item.source}
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
        <section className="home-cta" data-reveal>
          <div className="tq-container home-cta-inner">
            <div>
              <h2>جاهز تبدأ معاملتك؟</h2>
              <p>سجّل برقم هاتفك ووثّق هويتك مرة واحدة، ثم قدّم أي خدمة من مكانك.</p>
            </div>
            <div className="home-cta-actions">
              <Link href="/onboarding" className="button primary">
                <FilePlus2 /> ابدأ الآن
              </Link>
              <Link href="/citizen/feedback" className="button outline">
                <MessageSquareWarning /> شكوى أو مقترح
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
