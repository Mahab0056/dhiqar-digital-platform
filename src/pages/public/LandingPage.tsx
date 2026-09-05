import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  ArrowLeft,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  Bus,
  CheckCircle2,
  ChevronLeft,
  FileCheck2,
  FilePlus2,
  FileSearch,
  FileText,
  GraduationCap,
  HeartPulse,
  History,
  Home,
  Leaf,
  LockKeyhole,
  MapPin,
  MessageSquareWarning,
  Navigation,
  QrCode,
  Search,
  ShieldCheck,
  UserRound,
  X,
  Zap,
} from 'lucide-react'
import { CircleMarker, MapContainer, TileLayer, Tooltip as LeafletTooltip, ZoomControl, useMap } from 'react-leaflet'
import { api } from '../../api'
import { services } from '../../data'
import { dhiqarNews } from '../../news'
import type { DepartmentSummary } from '../../types'
import { Footer } from '../../components/public/Footer'
import { PublicHeader } from '../../components/public/PublicHeader'

const normalizeArabic = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

const quickActions = [
  {
    tone: 'green',
    icon: FilePlus2,
    title: 'تقديم معاملة',
    text: 'ابدأ طلباً حكومياً جديداً',
    href: '/onboarding',
  },
  {
    tone: 'blue',
    icon: FileSearch,
    title: 'متابعة معاملة',
    text: 'اعرف أين وصلت معاملتك',
    href: '/citizen#my-requests',
  },
  {
    tone: 'sand',
    icon: BookOpen,
    title: 'دليل الخدمات',
    text: 'اعثر على الخدمة المناسبة',
    href: '/directory',
  },
  {
    tone: 'red',
    icon: MessageSquareWarning,
    title: 'الشكاوى والمقترحات',
    text: 'تواصل مع الجهات الحكومية',
    href: '/citizen/feedback',
  },
] as const

const homeCategories = [
  { label: 'الأعمال والتجارة', icon: BriefcaseBusiness, query: 'المحلات والأعمال' },
  { label: 'السكن والعقار', icon: Home, query: 'السكن والأراضي' },
  { label: 'الطاقة والماء', icon: Zap, query: 'الماء' },
  { label: 'البلديات', icon: Building2, query: 'البلديات' },
  { label: 'الزراعة', icon: Leaf, query: 'الزراعة' },
  { label: 'النقل', icon: Bus, query: 'السياقة' },
  { label: 'التعليم', icon: GraduationCap, query: 'التربية والتعليم' },
  { label: 'الصحة', icon: HeartPulse, query: 'الصحة' },
  { label: 'الخدمات الشخصية', icon: UserRound, query: 'الوثائق الحكومية' },
]

const journeySteps = ['اختر الخدمة', 'قدّم الطلب', 'التدقيق', 'الموافقة', 'استلم النتيجة']

const trustItems = [
  { icon: ShieldCheck, label: 'منصة حكومية موحدة' },
  { icon: FileCheck2, label: 'وثائق قابلة للتحقق' },
  { icon: LockKeyhole, label: 'حماية البيانات' },
  { icon: Bell, label: 'إشعارات المعاملات' },
  { icon: History, label: 'سجل إلكتروني' },
]

const entityFilters = [
  { key: 'all', label: 'الكل', categories: null },
  { key: 'municipal', label: 'بلديات', categories: ['بلديات'] },
  { key: 'health', label: 'صحة', categories: ['صحة'] },
  { key: 'education', label: 'تعليم', categories: ['تربية وتعليم', 'تعليم عالي'] },
  { key: 'utilities', label: 'خدمات', categories: ['ماء', 'مجاري', 'كهرباء', 'طرق وجسور', 'اتصالات وبريد', 'موارد مائية'] },
  { key: 'government', label: 'دوائر حكومية', categories: ['حكومة محلية', 'أحوال مدنية وجوازات', 'تسجيل عقاري', 'ضرائب ومالية', 'قضاء', 'أمن وشرطة'] },
] as const

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
  const [, navigate] = useLocation()
  const [query, setQuery] = useState('')
  const [departments, setDepartments] = useState<DepartmentSummary[]>([])
  const [selectedDepartment, setSelectedDepartment] = useState<DepartmentSummary | null>(null)
  const [verifyId, setVerifyId] = useState('')
  const [entityQuery, setEntityQuery] = useState('')
  const [entityFilter, setEntityFilter] = useState<(typeof entityFilters)[number]['key']>('all')

  useEffect(() => {
    api
      .listDepartments()
      .then(result => {
        setDepartments(result.items)
        setSelectedDepartment(
          result.items.find(item => item.id === 'dhiqar-municipalities' && item.lat !== null) ||
            result.items.find(item => item.lat !== null) ||
            null
        )
      })
      .catch(() => setDepartments([]))
  }, [])

  const results = useMemo(() => {
    const tokens = normalizeArabic(query)
      .split(' ')
      .filter(token => token.length > 1)
    if (!tokens.length) return []
    return services
      .filter(service => {
        const text = normalizeArabic(`${service.title} ${service.description} ${service.department} ${service.category}`)
        return tokens.every(token => text.includes(token))
      })
      .slice(0, 6)
  }, [query])

  const suggestions = [
    { label: 'إجازة بناء', href: '/service/building-permit' },
    { label: 'إجازة محل', href: '/service/store-license' },
    { label: 'خدمات البلدية', href: '/service/municipality-service' },
    { label: 'الخدمات العقارية', href: '/directory?q=عقار' },
    { label: 'متابعة معاملة', href: '/citizen#my-requests' },
    { label: 'الشكاوى', href: '/citizen/feedback' },
  ]

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

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault()
    if (results.length === 1) navigate(`/service/${results[0].key}`)
    else navigate(`/directory${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`)
  }

  return (
    <div className="gov-home">
      <PublicHeader />
      <main>
        {/* ---- hero ------------------------------------------------------------------ */}
        <section className="gov-hero">
          <div className="gov-hero-art gov-hero-art-right" aria-hidden="true" />
          <div className="gov-hero-art gov-hero-art-left" aria-hidden="true" />
          <div className="gov-container gov-hero-inner">
            <aside className="gov-hero-side gov-hero-side-right" aria-hidden="true">
              <span className="gov-hero-tagline">ذي قار..</span>
              <p>
                أرض الإنسان..
                <br />
                تصنع المستقبل
              </p>
            </aside>
            <div className="gov-hero-center">
              <span className="gov-hero-eyebrow">المنصة الحكومية الموحدة لمحافظة ذي قار</span>
              <h1>
                كل خدمات ذي قار
                <em>في مكان واحد</em>
              </h1>
              <p>قدّم معاملاتك الحكومية، تابع الطلبات، واستلم الوثائق إلكترونياً من خلال منصة حكومية موحدة وآمنة.</p>
              <form className="gov-search" onSubmit={submitSearch} role="search">
                <Search className="gov-search-icon" aria-hidden="true" />
                <input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="ما الخدمة التي تريد إنجازها؟"
                  aria-label="ابحث عن خدمة"
                  autoComplete="off"
                />
                {query && (
                  <button type="button" className="gov-search-clear" onClick={() => setQuery('')} aria-label="مسح">
                    <X size={16} />
                  </button>
                )}
                <button type="submit" className="gov-search-submit" aria-label="بحث">
                  <Search />
                </button>
                {results.length > 0 && (
                  <ul className="gov-search-results" role="listbox">
                    {results.map(service => (
                      <li key={service.key}>
                        <Link href={`/service/${service.key}`} onClick={() => setQuery('')}>
                          <strong>{service.title}</strong>
                          <small>
                            {service.department} • {service.category}
                          </small>
                          <ChevronLeft size={16} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </form>
              <div className="gov-suggestions">
                <span>اقتراحات سريعة:</span>
                {suggestions.map(item => (
                  <Link href={item.href} key={item.label}>
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
            <aside className="gov-hero-side gov-hero-side-left" aria-hidden="true">
              <span className="gov-hero-tagline">هويتنا</span>
              <p>
                تراث عريق..
                <br />
                ومستقبل رقمي
              </p>
            </aside>
          </div>

          <div className="gov-container">
            <div className="gov-quick-actions">
              {quickActions.map(action => (
                <Link href={action.href} className={`gov-quick-action ${action.tone}`} key={action.title}>
                  <span className="gov-quick-icon">
                    <action.icon />
                  </span>
                  <span className="gov-quick-text">
                    <strong>{action.title}</strong>
                    <small>{action.text}</small>
                  </span>
                  <ChevronLeft className="gov-quick-arrow" />
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ---- categories ------------------------------------------------------------ */}
        <section className="gov-section gov-container" id="services">
          <header className="gov-section-head">
            <div>
              <h2>ماذا تريد أن تنجز اليوم؟</h2>
              <p>اختر الفئة المناسبة للوصول إلى الخدمات التي تحتاجها</p>
            </div>
            <Link href="/directory" className="gov-link">
              عرض جميع الفئات <ArrowLeft size={15} />
            </Link>
          </header>
          <div className="gov-categories">
            {homeCategories.map((item, index) => (
              <Link
                href={`/directory?q=${encodeURIComponent(item.query)}`}
                className={index === 1 ? 'gov-category is-active' : 'gov-category'}
                key={item.label}
              >
                <item.icon />
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* ---- capabilities / journey / map ------------------------------------------ */}
        {/* ---- GIS explorer ---------------------------------------------------------- */}
        <section className="gov-band gov-band-green" id="gis">
          <div className="gov-container">
            <header className="gov-band-head">
              <h2>اكتشف ذي قار رقمياً</h2>
              <p>استكشف الجهات الحكومية والخدمات المتاحة في محافظة ذي قار من خلال الخريطة الرقمية.</p>
            </header>
            <div className="gov-gis">
              <aside className="gov-gis-browser">
                <label className="gov-gis-search">
                  <Search size={17} />
                  <input
                    value={entityQuery}
                    onChange={event => setEntityQuery(event.target.value)}
                    placeholder="ابحث عن جهة حكومية"
                    aria-label="ابحث عن جهة حكومية"
                  />
                </label>
                <div className="gov-gis-filters" role="tablist" aria-label="تصفية الجهات">
                  {entityFilters.map(filter => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={entityFilter === filter.key}
                      className={entityFilter === filter.key ? 'is-active' : ''}
                      onClick={() => setEntityFilter(filter.key)}
                      key={filter.key}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
                <ul className="gov-gis-list" aria-label="قائمة الجهات">
                  {filteredEntities.slice(0, 40).map(item => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={selectedDepartment?.id === item.id ? 'is-active' : ''}
                        onClick={() => setSelectedDepartment(item)}
                      >
                        <span className="gov-gis-logo">
                          <Building2 />
                        </span>
                        <span className="gov-gis-meta">
                          <strong>{item.name}</strong>
                          <small>
                            <MapPin size={11} /> {item.district}
                            {' • '}
                            {(item.services.length + (item.digitalServices || 0)).toLocaleString('en-US')} خدمة
                          </small>
                        </span>
                        <span className={item.dataStatus === 'VERIFIED_SOURCE' ? 'gov-gis-status on' : 'gov-gis-status'}>
                          {item.dataStatus === 'VERIFIED_SOURCE' ? 'موثقة' : 'قيد التحقق'}
                        </span>
                      </button>
                    </li>
                  ))}
                  {!filteredEntities.length && <li className="gov-gis-empty">لا توجد جهة مطابقة.</li>}
                </ul>
                <Link href="/departments" className="gov-link">
                  دليل الجهات الحكومية الكامل <ArrowLeft size={14} />
                </Link>
              </aside>
              <div className="gov-gis-map-wrap">
                <MapContainer
                  center={[31.05, 46.25]}
                  zoom={12}
                  scrollWheelZoom={false}
                  zoomControl={false}
                  attributionControl={false}
                  className="gov-gis-map"
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
                        fillColor: selectedDepartment?.id === item.id ? '#c8102e' : '#087a55',
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
                  <div className="gov-gis-panel" role="dialog" aria-label={selectedDepartment.name}>
                    <button type="button" className="gov-gis-close" aria-label="إغلاق" onClick={() => setSelectedDepartment(null)}>
                      <X size={15} />
                    </button>
                    <span className="gov-gis-panel-kicker">{selectedDepartment.category}</span>
                    <h3>{selectedDepartment.name}</h3>
                    <dl>
                      <dt>العنوان</dt>
                      <dd>{selectedDepartment.address || `${selectedDepartment.district} — العنوان التفصيلي غير مسجل بعد`}</dd>
                      <dt>الخدمات المتاحة</dt>
                      <dd>
                        {selectedDepartment.services.slice(0, 4).join('، ')}
                        {selectedDepartment.services.length > 4 ? ' …' : ''}
                        {selectedDepartment.digitalServices ? (
                          <b> — {selectedDepartment.digitalServices.toLocaleString('en-US')} خدمة إلكترونية على المنصة</b>
                        ) : null}
                      </dd>
                    </dl>
                    <div className="gov-gis-panel-actions">
                      <Link href={`/departments/${selectedDepartment.id}`} className="gov-btn primary small">
                        عرض الجهة
                      </Link>
                      {typeof selectedDepartment.lat === 'number' && typeof selectedDepartment.lng === 'number' && (
                        <a
                          className="gov-btn outline small"
                          href={`https://www.openstreetmap.org/directions?to=${selectedDepartment.lat}%2C${selectedDepartment.lng}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Navigation size={14} /> الحصول على الاتجاهات
                        </a>
                      )}
                    </div>
                    {selectedDepartment.gisStatus !== 'COORDINATES_VERIFIED' && (
                      <small className="gov-gis-note">الموقع الجغرافي لهذه الجهة بانتظار إحداثيات رسمية.</small>
                    )}
                  </div>
                )}
                <span className="gov-gis-count">
                  <MapPin size={13} /> {located.length.toLocaleString('en-US')} جهة بموقع موثق من {departments.length.toLocaleString('en-US')}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ---- journey ----------------------------------------------------------------- */}
        <section className="gov-band" id="journey">
          <div className="gov-container gov-journey-section">
            <span className="gov-eyebrow-center">من الطلب إلى الإنجاز</span>
            <h2>معاملتك الحكومية بخطوات واضحة</h2>
            <ol className="gov-steps">
              {journeySteps.map((step, index) => (
                <li key={step}>
                  <span className="gov-step-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="gov-step-label">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---- verification ------------------------------------------------------------ */}
        <section className="gov-band gov-band-mint" id="verify">
          <div className="gov-container gov-verify">
            <div className="gov-verify-copy">
              <h2>التحقق من وثيقة حكومية</h2>
              <p>تحقق من صحة الوثائق الصادرة إلكترونياً من منصة ذي قار الرقمية.</p>
              <form
                className="gov-verify-row"
                onSubmit={event => {
                  event.preventDefault()
                  if (verifyId.trim()) navigate(`/verify/${encodeURIComponent(verifyId.trim())}`)
                }}
              >
                <label>
                  <span>رقم الوثيقة</span>
                  <input
                    value={verifyId}
                    onChange={event => setVerifyId(event.target.value)}
                    placeholder="TQD-XXXXXXXXXXXXXXXX"
                    dir="ltr"
                  />
                </label>
                <button type="submit" className="gov-btn primary" disabled={!verifyId.trim()}>
                  تحقق الآن
                </button>
                <Link href="/verify" className="gov-btn outline">
                  <QrCode size={16} /> مسح QR
                </Link>
              </form>
            </div>
            <div className="gov-verify-visual" aria-hidden="true">
              <div className="gov-doc-sheet">
                <span className="gov-doc-seal">
                  <ShieldCheck />
                </span>
                <i className="gov-doc-line w60" />
                <i className="gov-doc-line w80" />
                <i className="gov-doc-line w45" />
                <i className="gov-doc-line w70" />
                <span className="gov-doc-qr">
                  <QrCode />
                </span>
              </div>
              <span className="gov-doc-badge">
                <CheckCircle2 size={14} /> وثيقة موثقة رقمياً
              </span>
            </div>
          </div>
        </section>

        {/* ---- services ----------------------------------------------------------------- */}
        <section className="gov-band" id="e-services">
          <div className="gov-container">
            <header className="gov-band-head">
              <h2>خدمات حكومية إلكترونية</h2>
              <p>ابدأ معاملتك إلكترونياً دون الحاجة إلى مراجعة الدائرة في الخطوات المتاحة رقمياً.</p>
            </header>
            <ul className="gov-services-two">
              {services.slice(0, 8).map(service => (
                <li key={service.key}>
                  <Link href={`/service/${service.key}`}>
                    <span className="gov-service-icon">
                      <FileText />
                    </span>
                    <span className="gov-service-text">
                      <strong>{service.title}</strong>
                      <small>{service.department}</small>
                    </span>
                    <span className="gov-service-status">متاحة إلكترونياً</span>
                    <ChevronLeft size={16} />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="gov-center">
              <Link href="/directory" className="gov-btn outline">
                استعراض جميع الخدمات <ArrowLeft size={15} />
              </Link>
            </div>
          </div>
        </section>

        {/* ---- trust strip ---------------------------------------------------------------- */}
        <section className="gov-band gov-band-neutral gov-trust">
          <ul className="gov-container gov-trust-list">
            {trustItems.map(item => (
              <li key={item.label}>
                <item.icon />
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ---- news ---------------------------------------------------------------------- */}
        <section className="gov-band" id="news">
          <div className="gov-container">
            <header className="gov-band-head">
              <h2>آخر أخبار المحافظة</h2>
              <p>عناوين من مصادر إخبارية معروفة؛ كل خبر يفتح عند مصدره الأصلي.</p>
            </header>
            <div className="gov-news">
              {dhiqarNews[0] && (
                <a className="gov-news-featured" href={dhiqarNews[0].sourceUrl} target="_blank" rel="noreferrer">
                  <img src={dhiqarNews[0].image} alt="" />
                  <span className="gov-news-featured-text">
                    <small>
                      {dhiqarNews[0].category} • {dhiqarNews[0].source}
                    </small>
                    <strong>{dhiqarNews[0].title}</strong>
                  </span>
                </a>
              )}
              <ul className="gov-news-side">
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
      </main>
      <Footer />
    </div>
  )
}
