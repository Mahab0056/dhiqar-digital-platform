import type React from 'react'
import { useMemo, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { ArrowLeft, Bell, BriefcaseBusiness, Building2, FileText, Fingerprint, Landmark, LogIn, MapPin, QrCode, Search, ShieldCheck } from 'lucide-react'
import { categoryIcons, services } from '../../data'
import { governmentEntities } from '../../government-directory'
import { dhiqarNews } from '../../news'
import { Footer } from '../../components/public/Footer'
import { NewsCarousel } from '../../components/public/NewsCarousel'
import { ProcurementSection } from '../../components/public/ProcurementSection'
import { PublicHeader } from '../../components/public/PublicHeader'

export function LandingPage() {
  const [, navigate] = useLocation()
  const [serviceQuery, setServiceQuery] = useState('')
  const [category, setCategory] = useState('الكل')
  const categories = Array.from(new Set(services.map(service => service.category))).map(label => ({
    label,
    Icon: categoryIcons[label as keyof typeof categoryIcons] || BriefcaseBusiness,
  }))
  const normalizeArabicSearch = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  const matchingServices = useMemo(() => {
    const queryTokens = normalizeArabicSearch(serviceQuery)
      .split(' ')
      .filter(token => token.length > 1)
    return services
      .filter(service => {
        if (category !== 'الكل' && service.category !== category) return false
        const indexedText = normalizeArabicSearch(
          `${service.title} ${service.description} ${service.department} ${service.category}`
        )
        return !queryTokens.length || queryTokens.every(token => indexedText.includes(token))
      })
      .slice(0, 6)
  }, [serviceQuery, category])
  const submitServiceSearch = (event: React.FormEvent) => {
    event.preventDefault()
    if (matchingServices[0]) navigate(`/service/${matchingServices[0].key}`)
  }
  const quickServices = [
    { key: 'building-permit', title: 'إجازة بناء', icon: Building2 },
    { key: 'store-license', title: 'إجازة فتح محل', icon: BriefcaseBusiness },
    { key: 'national-id', title: 'البطاقة الوطنية', icon: Fingerprint },
    { key: 'passport-application', title: 'الجواز الإلكتروني', icon: FileText },
  ]
    .map(item => ({ ...item, service: services.find(service => service.key === item.key) }))
    .filter(
      (
        item
      ): item is {
        key: string
        title: string
        icon: typeof Building2
        service: NonNullable<(typeof services)[number]>
      } => Boolean(item.service)
    )
  const indicators = [
    { value: services.length.toLocaleString('en-US'), label: 'خدمة ومسار في الدليل', icon: BriefcaseBusiness },
    { value: governmentEntities.length.toLocaleString('en-US'), label: 'جهة حكومية مدرجة', icon: Landmark },
    { value: dhiqarNews.length.toLocaleString('en-US'), label: 'خبر من مصدر معروض', icon: Bell },
    { value: 'QR', label: 'تحقق من الوثائق', icon: QrCode },
  ]
  const benefits = [
    { title: 'تقديم منظم', text: 'نماذج ومتطلبات واضحة لكل خدمة محلية.', icon: FileText },
    { title: 'متابعة فورية', text: 'تظهر حالة الطلب وطلبات النواقص في الحساب.', icon: Bell },
    { title: 'وثيقة قابلة للتحقق', text: 'تحقق من الأصل المؤرشف عبر رمز QR.', icon: QrCode },
    { title: 'حماية الوصول', text: 'جلسات محمية وصلاحيات محددة حسب الدور.', icon: ShieldCheck },
  ]
  return (
    <div className="public-shell reference-home civic-home">
      <PublicHeader />
      <main>
        <section className="civic-hero">
          <div className="container">
            <div className="civic-hero-top">
              <div className="civic-hero-copy">
                <span className="civic-eyebrow">
                  <Landmark /> محافظة ذي قار — بوابة الخدمات الرقمية
                </span>
                <h1>
                  خدماتك الحكومية
                  <br />
                  <em>بمسار أوضح.</em>
                </h1>
                <p>
                  بوابة موحدة للوصول إلى الخدمات المحلية، متابعة المعاملات، والانتقال إلى المسارات الرسمية للخدمات
                  الوطنية.
                </p>
                <div className="civic-hero-links">
                  <Link href="/directory" className="button primary">
                    استعرض كل الخدمات <ArrowLeft />
                  </Link>
                  <Link href="/login" className="button outline">
                    تسجيل الدخول <LogIn />
                  </Link>
                </div>
              </div>
              <figure className="civic-hero-visual">
                <img src="/brand/ur-heritage-hero.jpg" alt="معلم أثري في ذي قار" />
                <div className="civic-hero-visual-copy">
                  <span>ذي قار الرقمية</span>
                  <strong>إرث راسخ، خدمة أقرب</strong>
                </div>
                <div className="civic-hero-emblem">
                  <img src="/brand/dhiqar-unified-logo.png" alt="شعار محافظة ذي قار" />
                </div>
              </figure>
            </div>
            <form className="civic-search" onSubmit={submitServiceSearch}>
              <Search />
              <div>
                <label htmlFor="home-service-search">ابحث عن الخدمة</label>
                <input
                  id="home-service-search"
                  value={serviceQuery}
                  onChange={event => setServiceQuery(event.target.value)}
                  placeholder="مثال: إجازة بناء أو شكوى ماء"
                  aria-label="البحث عن خدمة أو جهة حكومية"
                />
              </div>
              <select
                value={category}
                onChange={event => setCategory(event.target.value)}
                aria-label="تصفية الخدمات حسب القطاع"
              >
                <option value="الكل">كل القطاعات</option>
                {categories.map(item => (
                  <option key={item.label} value={item.label}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={!matchingServices.length}>
                بحث <ArrowLeft />
              </button>
              {serviceQuery && (
                <div className="reference-search-results civic-search-results">
                  {matchingServices.length ? (
                    matchingServices.map(service => (
                      <Link href={`/service/${service.key}`} key={service.key} onClick={() => setServiceQuery('')}>
                        <div>
                          <strong>{service.title}</strong>
                          <small>{service.department}</small>
                        </div>
                        <ArrowLeft />
                      </Link>
                    ))
                  ) : (
                    <p>لا توجد خدمة مطابقة. جرّب اسماً آخر أو افتح دليل الخدمات.</p>
                  )}
                </div>
              )}
            </form>
          </div>
        </section>
        <section className="civic-quick-section" id="services">
          <div className="container">
            <div className="civic-section-heading">
              <div>
                <span className="section-kicker">ابدأ الآن</span>
                <h2>الخدمات الأكثر طلباً</h2>
              </div>
              <Link href="/directory">
                فتح الدليل الكامل <ArrowLeft />
              </Link>
            </div>
            <div className="civic-quick-grid">
              {quickServices.map(item => (
                <Link href={`/service/${item.key}`} key={item.key}>
                  <span>
                    <item.icon />
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.service.department}</small>
                  </div>
                  <ArrowLeft />
                </Link>
              ))}
              <Link href="/directory" className="directory-entry">
                <span>
                  <Building2 />
                </span>
                <div>
                  <strong>دليل الجهات</strong>
                  <small>ابحث حسب الخدمة أو الدائرة</small>
                </div>
                <ArrowLeft />
              </Link>
            </div>
          </div>
        </section>
        <section className="civic-facts">
          <div className="container">
            {indicators.map(item => (
              <article key={item.label}>
                <item.icon />
                <div>
                  <strong>{item.value}</strong>
                  <small>{item.label}</small>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="section container reference-popular">
          <header>
            <span className="section-kicker">الخدمات حسب القطاع</span>
            <h2>اختر الجهة التي تناسب معاملتك</h2>
            <Link href="/directory">
              عرض الجهات والخدمات <ArrowLeft />
            </Link>
          </header>
          <div className="reference-category-grid">
            {categories.map(({ label, Icon }) => (
              <Link href={`/directory?q=${encodeURIComponent(label)}`} key={label}>
                <span>
                  <Icon />
                </span>
                <div>
                  <strong>{label}</strong>
                  <small>استعرض الخدمات المتاحة ضمن هذا القطاع</small>
                </div>
                <ArrowLeft />
              </Link>
            ))}
          </div>
        </section>
        <section className="reference-benefits" id="about">
          <div className="container">
            <div className="reference-benefit-intro">
              <div className="reference-benefit-logo">
                <img src="/brand/dhiqar-unified-logo.png" alt="شعار ذي قار الرقمية" />
              </div>
              <div>
                <span className="section-kicker">منصة ذي قار الرقمية</span>
                <h2>وصول أوضح إلى الخدمة الحكومية</h2>
                <p>اختر الخدمة، أكمل بياناتك، وتابع المعاملة من حسابك ضمن مسار واحد منظم.</p>
              </div>
            </div>
            <div className="reference-benefit-list">
              {benefits.map(item => (
                <article key={item.title}>
                  <item.icon />
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.text}</small>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="reference-directory-band">
          <div className="container">
            <div>
              <MapPin />
              <span>
                <b>الجهات الحكومية في ذي قار</b>
                <small>ابحث حسب الجهة أو القضاء أو نوع الخدمة.</small>
              </span>
            </div>
            <Link href="/directory" className="button light">
              فتح دليل الجهات <ArrowLeft />
            </Link>
          </div>
        </section>
        <NewsCarousel />
        <ProcurementSection />
      </main>
      <Footer />
    </div>
  )
}
