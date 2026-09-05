import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  ArrowLeft,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  FileCheck2,
  FilePlus2,
  FileSearch,
  FileText,
  History,
  LockKeyhole,
  Map as MapIcon,
  MapPin,
  MessageSquareWarning,
  QrCode,
  Search,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react'
import { CircleMarker, MapContainer, TileLayer, Tooltip as LeafletTooltip } from 'react-leaflet'
import { api } from '../../api'
import { categoryIcons, services } from '../../data'
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

const journey = [
  { icon: Search, title: 'اختر الخدمة', text: 'ابحث عن الخدمة المناسبة' },
  { icon: ClipboardList, title: 'أكمل البيانات', text: 'املأ النموذج الإلكتروني' },
  { icon: Upload, title: 'ارفع المستندات', text: 'أرفق الوثائق المطلوبة' },
  { icon: FileSearch, title: 'تابع الطلب', text: 'تعرف على حالة معاملتك' },
  { icon: FileCheck2, title: 'استلم النتيجة', text: 'احصل على وثيقتك إلكترونياً' },
]

const capabilities = [
  { icon: FileText, label: 'معاملات إلكترونية' },
  { icon: Search, label: 'تتبع حالة الطلب' },
  { icon: Bell, label: 'إشعارات فورية' },
  { icon: ShieldCheck, label: 'وثائق قابلة للتحقق' },
  { icon: LockKeyhole, label: 'حماية البيانات' },
  { icon: History, label: 'سجل إلكتروني للمعاملة' },
]

export function LandingPage() {
  const [, navigate] = useLocation()
  const [query, setQuery] = useState('')
  const [departments, setDepartments] = useState<DepartmentSummary[]>([])
  const [selectedDepartment, setSelectedDepartment] = useState<DepartmentSummary | null>(null)
  const [verifyId, setVerifyId] = useState('')

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

  const categories = useMemo(
    () =>
      Array.from(new Set(services.map(service => service.category))).map(label => ({
        label,
        Icon: categoryIcons[label as keyof typeof categoryIcons] || BriefcaseBusiness,
      })),
    []
  )

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
    ...services.slice(0, 3).map(service => ({ label: service.title, href: `/service/${service.key}` })),
    { label: 'الشكاوى', href: '/citizen/feedback' },
    { label: 'متابعة معاملة', href: '/citizen#my-requests' },
  ]

  const located = departments.filter(
    (item): item is DepartmentSummary & { lat: number; lng: number } =>
      typeof item.lat === 'number' && typeof item.lng === 'number'
  )

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
              <span className="gov-kicker">حكومة رقمية</span>
              <p>لمجتمع أفضل</p>
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
              <span className="gov-hero-tagline">ذي قار ..</span>
              <p>أرض الإنسان .. تصنع المستقبل</p>
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
            {categories.map(({ label, Icon }, index) => (
              <Link
                href={`/directory?q=${encodeURIComponent(label)}`}
                className={index === 0 ? 'gov-category is-active' : 'gov-category'}
                key={label}
              >
                <Icon />
                <span>{label}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* ---- capabilities / journey / map ------------------------------------------ */}
        <section className="gov-section gov-container gov-three">
          <article className="gov-panel">
            <header className="gov-panel-head">
              <h2>مزايا المنصة</h2>
              <p>خدمات حكومية رقمية موثوقة وآمنة</p>
            </header>
            <ul className="gov-capabilities">
              {capabilities.map(item => (
                <li key={item.label}>
                  <span>
                    <item.icon />
                  </span>
                  {item.label}
                </li>
              ))}
            </ul>
          </article>

          <article className="gov-panel">
            <header className="gov-panel-head">
              <h2>رحلة إنجاز معاملتك</h2>
            </header>
            <ol className="gov-journey">
              {journey.map((step, index) => (
                <li key={step.title}>
                  <span className="gov-journey-icon">
                    <step.icon />
                  </span>
                  <strong>{step.title}</strong>
                  <small>{step.text}</small>
                  {index < journey.length - 1 && <ArrowLeft className="gov-journey-arrow" aria-hidden="true" />}
                </li>
              ))}
            </ol>
          </article>

          <article className="gov-panel gov-map-panel">
            <header className="gov-panel-head">
              <h2>ذي قار على الخريطة</h2>
              <p>استكشف الجهات الحكومية والخدمات في المحافظة</p>
            </header>
            <div className="gov-map-frame">
              <MapContainer
                center={[31.052, 46.249]}
                zoom={12}
                scrollWheelZoom={false}
                zoomControl={false}
                attributionControl={false}
                className="gov-map"
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                {located.map(item => (
                  <CircleMarker
                    key={item.id}
                    center={[item.lat, item.lng]}
                    radius={selectedDepartment?.id === item.id ? 9 : 6}
                    pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#0b6b3a', fillOpacity: 1 }}
                    eventHandlers={{ click: () => setSelectedDepartment(item) }}
                  >
                    <LeafletTooltip direction="top" offset={[0, -6]} opacity={1}>
                      {item.name}
                    </LeafletTooltip>
                  </CircleMarker>
                ))}
              </MapContainer>
              {selectedDepartment && (
                <div className="gov-map-card">
                  <button type="button" aria-label="إغلاق" onClick={() => setSelectedDepartment(null)}>
                    <X size={14} />
                  </button>
                  <strong>{selectedDepartment.name}</strong>
                  <span className="gov-map-badge">
                    <MapPin size={11} /> {selectedDepartment.district}
                  </span>
                  <small>
                    الخدمات المسجلة{' '}
                    <b>{(selectedDepartment.services.length + (selectedDepartment.digitalServices || 0)).toLocaleString('en-US')} خدمة</b>
                  </small>
                  <Link href={`/departments/${selectedDepartment.id}`} className="gov-btn primary small">
                    عرض الجهة
                  </Link>
                </div>
              )}
              <Link href="/departments" className="gov-map-full">
                <MapIcon size={15} /> عرض الخريطة الكاملة
              </Link>
            </div>
          </article>
        </section>

        {/* ---- services / news / verify ---------------------------------------------- */}
        <section className="gov-section gov-container gov-three gov-three-bottom">
          <article className="gov-panel">
            <header className="gov-panel-head">
              <h2>الخدمات المتاحة إلكترونياً</h2>
              <Link href="/directory" className="gov-link">
                الكل <ArrowLeft size={14} />
              </Link>
            </header>
            <ul className="gov-service-list">
              {services.slice(0, 6).map(service => (
                <li key={service.key}>
                  <Link href={`/service/${service.key}`}>
                    <span className="gov-service-icon">
                      <FileText />
                    </span>
                    <span>
                      <strong>{service.title}</strong>
                      <small>{service.department}</small>
                    </span>
                    <ChevronLeft size={16} />
                  </Link>
                </li>
              ))}
            </ul>
          </article>

          <article className="gov-panel">
            <header className="gov-panel-head">
              <h2>آخر الأخبار والتحديثات</h2>
            </header>
            <ul className="gov-news-list">
              {dhiqarNews.slice(0, 4).map(item => (
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
          </article>

          <article className="gov-panel gov-verify-panel">
            <header className="gov-panel-head">
              <h2>تحقق من وثيقة</h2>
              <p>أدخل معرّف التحقق المطبوع على الوثيقة أو امسح رمز QR</p>
            </header>
            <form
              className="gov-verify-form"
              onSubmit={event => {
                event.preventDefault()
                if (verifyId.trim()) navigate(`/verify/${encodeURIComponent(verifyId.trim())}`)
              }}
            >
              <input
                value={verifyId}
                onChange={event => setVerifyId(event.target.value)}
                placeholder="مثال: TQD-XXXXXXXXXXXXXXXX"
                dir="ltr"
                aria-label="معرّف التحقق"
              />
              <button type="submit" className="gov-btn primary" disabled={!verifyId.trim()}>
                <CheckCircle2 size={16} /> تحقق
              </button>
            </form>
            <Link href="/verify" className="gov-verify-scan">
              <QrCode /> مسح رمز QR بالكاميرا
            </Link>
          </article>
        </section>
      </main>
      <Footer />
    </div>
  )
}
