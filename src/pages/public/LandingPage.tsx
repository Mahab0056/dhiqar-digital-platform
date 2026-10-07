import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  Bus,
  ChevronLeft,
  ClipboardCheck,
  FileCheck2,
  FilePlus2,
  FileSearch,
  FileText,
  GraduationCap,
  HeartPulse,
  Home,
  LayoutGrid,
  Leaf,
  MapPin,
  MessageSquareWarning,
  Navigation,
  QrCode,
  Search,
  SearchCheck,
  ShieldCheck,
  Upload,
  UserRound,
  X,
  Zap,
} from 'lucide-react'
import { CircleMarker, MapContainer, TileLayer, Tooltip as LeafletTooltip, ZoomControl, useMap } from 'react-leaflet'
import { serviceCount } from '../../lib/arabic-count'
import { api } from '../../api'
import { services } from '../../data'
import { dhiqarNews } from '../../news'
import type { CatalogSummary, DepartmentSummary } from '../../types'
import { SmartSearch } from '../../components/public/SmartSearch'
import { useRevealOnScroll } from '../../lib/reveal'
import { Footer } from '../../components/public/Footer'
import { PublicHeader } from '../../components/public/PublicHeader'

const normalizeArabic = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

const quickActions = [
  { icon: FilePlus2, title: 'تقديم معاملة', text: 'ابدأ طلباً حكومياً جديداً', href: '/onboarding' },
  { icon: FileSearch, title: 'متابعة معاملة', text: 'اعرف أين وصل طلبك', href: '/citizen#my-requests' },
  { icon: BookOpen, title: 'دليل الخدمات', text: 'المستمسكات والرسوم وطريقة التقديم', href: '/directory' },
  { icon: MessageSquareWarning, title: 'شكوى أو مقترح', text: 'صوتك يصل إلى الدائرة المختصة', href: '/citizen/feedback' },
] as const

const homeCategories = [
  { label: 'الأعمال والتجارة', hint: 'إجازات المحلات والشركات', icon: BriefcaseBusiness, href: '/directory?category=المحلات والأعمال' },
  { label: 'السكن والعقار', hint: 'الأراضي والتسجيل العقاري', icon: Home, href: '/directory?category=السكن والأراضي' },
  { label: 'الماء والكهرباء', hint: 'الاشتراكات والبلاغات', icon: Zap, href: '/directory?q=ماء' },
  { label: 'البلديات', hint: 'إجازات البناء والخدمات', icon: Building2, href: '/directory?category=البناء والبلديات' },
  { label: 'الزراعة', hint: 'الإجازات والدعم الزراعي', icon: Leaf, href: '/directory?category=الزراعة' },
  { label: 'المرور والنقل', hint: 'الإجازات والمركبات', icon: Bus, href: '/directory?category=الأمن والمرور' },
  { label: 'التعليم', hint: 'الوثائق المدرسية والتصديق', icon: GraduationCap, href: '/directory?q=تعليم' },
  { label: 'الصحة', hint: 'الشهادات والخدمات الصحية', icon: HeartPulse, href: '/directory?category=الصحة' },
  { label: 'الوثائق الشخصية', hint: 'البطاقة الوطنية والجواز', icon: UserRound, href: '/directory?category=الوثائق الحكومية' },
]

const journeySteps = [
  { icon: Search, title: 'اختر الخدمة', text: 'ابحث في الدليل واعرف المستمسكات والرسوم قبل أن تبدأ.' },
  { icon: Upload, title: 'قدّم الطلب', text: 'وثّق هويتك مرة واحدة وارفع مستمسكاتك إلكترونياً.' },
  { icon: SearchCheck, title: 'التدقيق', text: 'تدقق الدائرة المختصة طلبك وتبلغك بأي نقص فوراً.' },
  { icon: ClipboardCheck, title: 'القرار', text: 'يصلك القرار بإشعار، وتسدد الرسوم إن كانت مطلوبة.' },
  { icon: FileCheck2, title: 'استلم الوثيقة', text: 'وثيقة رقمية تحمل رمز QR يمكن لأي جهة التحقق منه.' },
]

const entityFilters = [
  { key: 'all', label: 'الكل', categories: null },
  { key: 'municipal', label: 'بلديات', categories: ['بلديات'] },
  { key: 'health', label: 'صحة', categories: ['صحة'] },
  { key: 'education', label: 'تعليم', categories: ['تربية وتعليم', 'تعليم عالي'] },
  { key: 'utilities', label: 'خدمات', categories: ['ماء', 'مجاري', 'كهرباء', 'طرق وجسور', 'اتصالات وبريد', 'موارد مائية'] },
  {
    key: 'government',
    label: 'دوائر حكومية',
    categories: ['حكومة محلية', 'أحوال مدنية وجوازات', 'تسجيل عقاري', 'ضرائب ومالية', 'قضاء', 'أمن وشرطة'],
  },
] as const

const popularSearches = [
  { label: 'إجازة بناء', href: '/service/building-permit' },
  { label: 'إجازة محل', href: '/service/store-license' },
  { label: 'البطاقة الوطنية', href: '/directory?q=البطاقة الوطنية' },
  { label: 'جواز السفر', href: '/directory?q=جواز' },
  { label: 'الخدمات العقارية', href: '/directory?q=عقار' },
]

/** Pans the real map to the selected entity (no-op when it has no verified coordinates). */
function MapFocus({ target }: { target: DepartmentSummary | null }) {
  const map = useMap()
  useEffect(() => {
    if (target && typeof target.lat === 'number' && typeof target.lng === 'number')
      map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 14), { duration: 0.6 })
  }, [map, target])
  return null
}

export function LandingPage() {
  useRevealOnScroll()
  const [, navigate] = useLocation()
  const [query, setQuery] = useState('')
  const [departments, setDepartments] = useState<DepartmentSummary[]>([])
  const [summary, setSummary] = useState<CatalogSummary | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState<DepartmentSummary | null>(null)
  const [verifyId, setVerifyId] = useState('')
  const [entityQuery, setEntityQuery] = useState('')
  const [entityFilter, setEntityFilter] = useState<(typeof entityFilters)[number]['key']>('all')

  useEffect(() => {
    api
      .listDepartments()
      // the map opens clean: the details panel appears only after the visitor picks a department
      .then(result => setDepartments(result.items))
      .catch(() => setDepartments([]))
    api
      .getServicesSummary()
      .then(setSummary)
      .catch(() => setSummary(null))
  }, [])

  const located = departments.filter(
    (item): item is DepartmentSummary & { lat: number; lng: number } =>
      typeof item.lat === 'number' && typeof item.lng === 'number'
  )

  const filteredEntities = useMemo(() => {
    const filter = entityFilters.find(item => item.key === entityFilter)
    const term = normalizeArabic(entityQuery)
    return departments.filter(item => {
      if (filter?.categories && !(filter.categories as readonly string[]).includes(item.category)) return false
      if (!term) return true
      return normalizeArabic(`${item.name} ${item.category} ${item.district} ${item.services.join(' ')}`).includes(term)
    })
  }, [departments, entityFilter, entityQuery])

  // real figures only — the row stays hidden until the catalogue answers
  const stats = summary
    ? [
        { value: summary.total, label: 'خدمة حكومية في الدليل' },
        { value: departments.length, label: 'جهة ودائرة حكومية' },
        { value: summary.channels.ONLINE_SUBMISSION || 0, label: 'خدمة تُنجز إلكترونياً بالكامل' },
      ].filter(item => item.value > 0)
    : []

  return (
    <div className="tq-page">
      <PublicHeader />
      <main id="main-content">
        {/* ---- hero ---------------------------------------------------------------------- */}
        <section className="home-hero" aria-labelledby="home-hero-title">
          <div className="tq-container home-hero-inner">
            <div className="home-hero-copy">
              <span className="home-hero-eyebrow">
                <ShieldCheck aria-hidden="true" /> البوابة الرسمية للخدمات الحكومية في محافظة ذي قار
              </span>
              <h1 id="home-hero-title">
                كل خدمات ذي قار <span>في مكان واحد</span>
              </h1>
              <p>قدّم معاملتك الحكومية، تابع طلبك لحظة بلحظة، واستلم وثيقتك إلكترونياً من منصة واحدة آمنة.</p>
              <SmartSearch value={query} onChange={setQuery} autoFocus={false} />
              <div className="home-popular">
                <span>الأكثر طلباً:</span>
                {popularSearches.map(item => (
                  <Link href={item.href} key={item.label}>
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
            {stats.length > 0 && (
              <dl className="home-stats">
                {stats.map(item => (
                  <div key={item.label}>
                    <dt>{item.label}</dt>
                    <dd>{item.value.toLocaleString('en-US')}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </section>

        {/* ---- quick actions ------------------------------------------------------------- */}
        <section className="tq-container home-actions" aria-label="إجراءات سريعة">
          {quickActions.map(action => (
            <Link href={action.href} className="home-action" key={action.title}>
              <span className="home-action-icon">
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

        {/* ---- categories ---------------------------------------------------------------- */}
        <section className="tq-section" id="services" aria-labelledby="home-categories-title" data-reveal>
          <div className="tq-container">
            <header className="tq-section-head">
              <div>
                <span className="section-kicker">تصفّح حسب الموضوع</span>
                <h2 id="home-categories-title">ماذا تريد أن تنجز اليوم؟</h2>
                <p>اختر المجال للوصول إلى خدماته والمستمسكات المطلوبة لكل خدمة.</p>
              </div>
              <Link href="/directory" className="gov-link">
                كل الخدمات <ArrowLeft size={16} />
              </Link>
            </header>
            <div className="home-categories">
              {homeCategories.map(item => (
                <Link href={item.href} className="home-category" key={item.label}>
                  <span className="home-category-icon">
                    <item.icon />
                  </span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </span>
                </Link>
              ))}
              <Link href="/directory" className="home-category is-all">
                <span className="home-category-icon">
                  <LayoutGrid />
                </span>
                <span>
                  <strong>كل الخدمات</strong>
                  <small>{summary ? serviceCount(summary.total) : 'الدليل الكامل'}</small>
                </span>
              </Link>
            </div>
          </div>
        </section>

        {/* ---- e-services ---------------------------------------------------------------- */}
        <section className="tq-section is-tinted" id="e-services" aria-labelledby="home-eservices-title" data-reveal>
          <div className="tq-container">
            <header className="tq-section-head">
              <div>
                <span className="section-kicker">خدمات إلكترونية</span>
                <h2 id="home-eservices-title">ابدأ معاملتك من بيتك</h2>
                <p>خدمات تقدّم طلبها كاملاً عبر المنصة وتتابعها حتى صدور الوثيقة.</p>
              </div>
              <Link href="/directory?channel=ONLINE_SUBMISSION" className="gov-link">
                كل الخدمات الإلكترونية <ArrowLeft size={16} />
              </Link>
            </header>
            <ul className="home-services">
              {services.slice(0, 8).map(service => (
                <li key={service.key}>
                  <Link href={`/service/${service.key}`}>
                    <span className="home-service-icon">
                      <FileText />
                    </span>
                    <span className="home-service-text">
                      <strong>{service.title}</strong>
                      <small>{service.department}</small>
                    </span>
                    <span className="tq-badge is-success">
                      <BadgeCheck /> إلكترونية
                    </span>
                    <ChevronLeft className="home-service-arrow" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---- journey ------------------------------------------------------------------- */}
        <section className="tq-section" id="journey" aria-labelledby="home-journey-title" data-reveal>
          <div className="tq-container">
            <header className="tq-section-head is-center">
              <div>
                <span className="section-kicker">كيف تعمل المنصة</span>
                <h2 id="home-journey-title">من الطلب إلى الوثيقة بخمس خطوات</h2>
              </div>
            </header>
            <ol className="home-steps">
              {journeySteps.map((step, index) => (
                <li key={step.title}>
                  <span className="home-step-icon">
                    <step.icon />
                    <b>{index + 1}</b>
                  </span>
                  <strong>{step.title}</strong>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---- verification -------------------------------------------------------------- */}
        <section className="tq-section is-tight" id="verify" aria-labelledby="home-verify-title" data-reveal>
          <div className="tq-container">
            <div className="home-verify">
              <div className="home-verify-copy">
                <span className="section-kicker">للمواطنين والجهات</span>
                <h2 id="home-verify-title">تحقق من وثيقة حكومية</h2>
                <p>أدخل رقم الوثيقة أو امسح رمز QR المطبوع عليها للتأكد من صحتها وحالتها لدى الجهة المصدرة.</p>
                <form
                  className="home-verify-form"
                  onSubmit={event => {
                    event.preventDefault()
                    if (verifyId.trim()) navigate(`/verify/${encodeURIComponent(verifyId.trim())}`)
                  }}
                >
                  <label className="tq-field">
                    <span>رقم الوثيقة</span>
                    <input
                      value={verifyId}
                      onChange={event => setVerifyId(event.target.value)}
                      placeholder="TQD-XXXX-XXXX"
                      dir="ltr"
                      autoComplete="off"
                    />
                  </label>
                  <button type="submit" className="button primary" disabled={!verifyId.trim()}>
                    <SearchCheck /> تحقق الآن
                  </button>
                  <Link href="/verify" className="button outline">
                    <QrCode /> مسح الرمز
                  </Link>
                </form>
              </div>
              <div className="home-verify-visual" aria-hidden="true">
                <div className="home-doc">
                  <div className="home-doc-head">
                    <img src="/brand/iraq-coat-of-arms.png" alt="" />
                    <span>
                      <i />
                      <i />
                    </span>
                    <img src="/brand/dhiqar-unified-logo.png" alt="" />
                  </div>
                  <i className="home-doc-line w80" />
                  <i className="home-doc-line w60" />
                  <i className="home-doc-line w70" />
                  <i className="home-doc-line w45" />
                  <div className="home-doc-foot">
                    <QrCode />
                    <span className="tq-badge is-success">
                      <BadgeCheck /> وثيقة صحيحة
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---- GIS explorer -------------------------------------------------------------- */}
        <section className="tq-section is-tinted" id="gis" aria-labelledby="home-gis-title" data-reveal>
          <div className="tq-container">
            <header className="tq-section-head">
              <div>
                <span className="section-kicker">الخريطة الحكومية</span>
                <h2 id="home-gis-title">اعثر على الدائرة الأقرب إليك</h2>
                <p>مواقع الدوائر الحكومية في المحافظة وخدماتها، مع الاتجاهات إليها.</p>
              </div>
              <Link href="/departments" className="gov-link">
                دليل الدوائر الكامل <ArrowLeft size={16} />
              </Link>
            </header>
            <div className="home-gis">
              <aside className="home-gis-browser">
                <label className="home-gis-search">
                  <Search aria-hidden="true" />
                  <input
                    value={entityQuery}
                    onChange={event => setEntityQuery(event.target.value)}
                    placeholder="ابحث عن دائرة حكومية"
                    aria-label="ابحث عن دائرة حكومية"
                  />
                </label>
                <div className="tq-chips" role="tablist" aria-label="تصفية الجهات">
                  {entityFilters.map(filter => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={entityFilter === filter.key}
                      className={entityFilter === filter.key ? 'tq-chip is-active' : 'tq-chip'}
                      onClick={() => setEntityFilter(filter.key)}
                      key={filter.key}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
                <ul className="home-gis-list" aria-label="قائمة الجهات">
                  {filteredEntities.slice(0, 40).map(item => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={selectedDepartment?.id === item.id ? 'is-active' : ''}
                        onClick={() => setSelectedDepartment(item)}
                      >
                        <span className="home-gis-icon">
                          <Building2 />
                        </span>
                        <span className="home-gis-meta">
                          <strong>{item.name}</strong>
                          <small>
                            <MapPin aria-hidden="true" /> {item.district} •{' '}
                            {serviceCount(item.services.length + (item.digitalServices || 0))}
                          </small>
                        </span>
                        {item.dataStatus !== 'VERIFIED_SOURCE' && <span className="tq-badge">قيد التحقق</span>}
                      </button>
                    </li>
                  ))}
                  {!filteredEntities.length && <li className="home-gis-empty">لا توجد جهة مطابقة.</li>}
                </ul>
              </aside>
              <div className="home-gis-map">
                <MapContainer
                  center={[31.05, 46.25]}
                  zoom={12}
                  scrollWheelZoom={false}
                  zoomControl={false}
                  attributionControl={false}
                  className="home-gis-leaflet"
                >
                  <ZoomControl position="bottomleft" />
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <MapFocus target={selectedDepartment} />
                  {located.map(item => (
                    <CircleMarker
                      key={item.id}
                      center={[item.lat, item.lng]}
                      radius={selectedDepartment?.id === item.id ? 10 : 7}
                      pathOptions={{
                        color: '#ffffff',
                        weight: 2,
                        fillColor: selectedDepartment?.id === item.id ? '#a98032' : '#075e45',
                        fillOpacity: 1,
                      }}
                      eventHandlers={{ click: () => setSelectedDepartment(item) }}
                    >
                      <LeafletTooltip direction="top" offset={[0, -8]} opacity={1}>
                        {item.name}
                      </LeafletTooltip>
                    </CircleMarker>
                  ))}
                </MapContainer>
                {selectedDepartment && (
                  <div className="home-gis-panel" role="dialog" aria-label={selectedDepartment.name}>
                    <button
                      type="button"
                      className="icon-button home-gis-close"
                      aria-label="إغلاق"
                      onClick={() => setSelectedDepartment(null)}
                    >
                      <X />
                    </button>
                    <span className="section-kicker">{selectedDepartment.category}</span>
                    <h3>{selectedDepartment.name}</h3>
                    <dl>
                      <dt>العنوان</dt>
                      <dd>
                        {selectedDepartment.address ||
                          `${selectedDepartment.district} — العنوان التفصيلي غير مسجل بعد`}
                      </dd>
                      <dt>الخدمات المتاحة</dt>
                      <dd>
                        {selectedDepartment.services.slice(0, 4).join('، ')}
                        {selectedDepartment.services.length > 4 ? ' …' : ''}
                        {selectedDepartment.digitalServices ? (
                          <b>
                            {' '}
                            — {selectedDepartment.digitalServices.toLocaleString('en-US')} خدمة إلكترونية على المنصة
                          </b>
                        ) : null}
                      </dd>
                    </dl>
                    <div className="home-gis-actions">
                      <Link href={`/departments/${selectedDepartment.id}`} className="button primary small">
                        صفحة الجهة
                      </Link>
                      {typeof selectedDepartment.lat === 'number' && typeof selectedDepartment.lng === 'number' && (
                        <a
                          className="button outline small"
                          href={`https://www.openstreetmap.org/directions?to=${selectedDepartment.lat}%2C${selectedDepartment.lng}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Navigation /> الاتجاهات
                        </a>
                      )}
                    </div>
                    {selectedDepartment.gisStatus !== 'COORDINATES_VERIFIED' && (
                      <small className="home-gis-note">الموقع الجغرافي لهذه الجهة بانتظار إحداثيات رسمية.</small>
                    )}
                  </div>
                )}
                <span className="home-gis-count">
                  <MapPin aria-hidden="true" /> {located.length.toLocaleString('en-US')} جهة بموقع موثّق من{' '}
                  {departments.length.toLocaleString('en-US')}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ---- news ---------------------------------------------------------------------- */}
        {dhiqarNews.length > 0 && (
          <section className="tq-section" id="news" aria-labelledby="home-news-title" data-reveal>
            <div className="tq-container">
              <header className="tq-section-head">
                <div>
                  <span className="section-kicker">من المحافظة</span>
                  <h2 id="home-news-title">آخر الأخبار</h2>
                  <p>عناوين من مصادر إخبارية معروفة؛ كل خبر يفتح لدى مصدره الأصلي.</p>
                </div>
              </header>
              <div className="home-news">
                <a className="home-news-featured" href={dhiqarNews[0].sourceUrl} target="_blank" rel="noreferrer">
                  <img src={dhiqarNews[0].image} alt="" />
                  <span>
                    <small>
                      {dhiqarNews[0].category} • {dhiqarNews[0].source}
                    </small>
                    <strong>{dhiqarNews[0].title}</strong>
                  </span>
                </a>
                <ul className="home-news-list">
                  {dhiqarNews.slice(1, 4).map(item => (
                    <li key={item.sourceUrl}>
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                        <img src={item.image} alt="" loading="lazy" />
                        <span>
                          <small>
                            {item.category} • {item.source}
                          </small>
                          <strong>{item.title}</strong>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  )
}
