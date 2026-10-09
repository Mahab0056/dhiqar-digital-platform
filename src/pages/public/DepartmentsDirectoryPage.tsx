import { useEffect, useMemo, useState } from 'react'
import { Link } from 'wouter'
import { ArrowLeft, Building2, ExternalLink, MapPin, Search, ShieldCheck, X } from 'lucide-react'
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip as LeafletTooltip } from 'react-leaflet'
import { api } from '../../api'
import type { DepartmentDirectoryResponse, DepartmentSummary } from '../../types'
import { PublicHeader } from '../../components/public/PublicHeader'
import { Footer } from '../../components/public/Footer'
import { EmptyState, PageHeader } from '../../components/public/PageHeader'

export const categoryIconLabel = (category: string) => category.split(' ')[0]

export function DepartmentsDirectoryPage() {
  const [data, setData] = useState<DepartmentDirectoryResponse | null>(null)
  // filters can arrive in the link (the home page opens a district with ?district=)
  const [initial] = useState(() => new URLSearchParams(window.location.search))
  const [query, setQuery] = useState(() => initial.get('q') || '')
  const [category, setCategory] = useState(() => initial.get('category') || '')
  const [district, setDistrict] = useState(() => initial.get('district') || '')
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .listDepartments()
      .then(setData)
      .catch(err => setError((err as Error).message))
  }, [])

  const items = useMemo(() => {
    if (!data) return []
    const term = query.trim().toLowerCase()
    return data.items.filter(item => {
      if (category && item.category !== category) return false
      if (district && item.district !== district) return false
      if (!term) return true
      return `${item.name} ${item.nameEn || ''} ${item.category} ${item.district} ${item.parentMinistry || ''} ${item.services.join(' ')}`
        .toLowerCase()
        .includes(term)
    })
  }, [data, query, category, district])

  const located = items.filter(
    (item): item is DepartmentSummary & { lat: number; lng: number } =>
      typeof item.lat === 'number' && typeof item.lng === 'number'
  )
  const grouped = useMemo(() => {
    const map = new Map<string, DepartmentSummary[]>()
    for (const item of items) map.set(item.category, [...(map.get(item.category) || []), item])
    return [...map.entries()]
  }, [items])

  return (
    <div className="tq-page">
      <PublicHeader />
      <main id="main-content">
        <PageHeader
          crumbs={[{ label: 'الدوائر الحكومية' }]}
          kicker={
            <>
              <Building2 size={15} /> دليل الدوائر الحكومية
            </>
          }
          title="دوائر محافظة ذي قار ومديرياتها"
          description={
            data
              ? `${data.summary.total.toLocaleString('en-US')} جهة حكومية في ${data.summary.categories.toLocaleString('en-US')} قطاعاً. لكل جهة مصدرها الرسمي، ولا تُعرض أرقام هاتف أو مواقع غير موثقة.`
              : 'جارٍ تحميل السجل…'
          }
          aside={
            <dl className="tq-figures">
              <div>
                <dt>جهة مسجلة</dt>
                <dd>{data?.summary.total ?? '—'}</dd>
              </div>
              <div>
                <dt>بمصدر رسمي</dt>
                <dd>{data?.summary.verified ?? '—'}</dd>
              </div>
              <div>
                <dt>بموقع موثّق</dt>
                <dd>{data?.summary.gisComplete ?? '—'}</dd>
              </div>
            </dl>
          }
        >
          <div className="depts-toolbar">
            <label className="depts-search">
              <Search aria-hidden="true" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="ابحث باسم الدائرة أو الخدمة أو الوزارة"
                aria-label="بحث في الدوائر"
              />
            </label>
            <label className="tq-field">
              <span className="sr-only">القطاع</span>
              <select value={category} onChange={event => setCategory(event.target.value)} aria-label="القطاع">
                <option value="">كل القطاعات</option>
                {data?.categories.map(item => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="tq-field">
              <span className="sr-only">القضاء</span>
              <select value={district} onChange={event => setDistrict(event.target.value)} aria-label="القضاء">
                <option value="">كل الأقضية</option>
                {data?.districts.map(item => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </PageHeader>

        <section className="tq-content">
          <div className="tq-container tq-stack">
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}

            <div className="depts-map">
              <MapContainer center={[31.05, 46.25]} zoom={11} scrollWheelZoom={false} className="depts-leaflet">
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {located.map(item => (
                  <CircleMarker
                    key={item.id}
                    center={[item.lat, item.lng]}
                    radius={8}
                    pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#075e45', fillOpacity: 1 }}
                  >
                    <LeafletTooltip direction="top" offset={[0, -8]} opacity={1}>
                      {item.name}
                    </LeafletTooltip>
                    <Popup>
                      <div className="gis-popup">
                        <strong>{item.name}</strong>
                        <span>
                          {item.district} — {item.category}
                        </span>
                        <Link href={`/departments/${item.id}`}>صفحة الدائرة ←</Link>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
              <p>
                <MapPin aria-hidden="true" /> تُرسم فقط الجهات ذات الإحداثيات الموثقة (
                {located.length.toLocaleString('en-US')} من {items.length.toLocaleString('en-US')})، والبقية بانتظار
                إحداثيات رسمية.
              </p>
            </div>

            <div className="dir-results-head">
              <div>
                <h2 aria-live="polite">{items.length.toLocaleString('en-US')} جهة</h2>
                <p>
                  {category || 'كل القطاعات'}
                  {district ? ` · ${district}` : ''}
                  {query.trim() ? ` · «${query.trim()}»` : ''}
                </p>
              </div>
              {(query || category || district) && (
                <button
                  type="button"
                  className="button outline small"
                  onClick={() => {
                    setQuery('')
                    setCategory('')
                    setDistrict('')
                  }}
                >
                  <X /> إزالة التصفية
                </button>
              )}
            </div>

            {data && items.length === 0 && (
              <EmptyState icon={<Building2 />} title="لا توجد جهة مطابقة" text="جرّب كلمة أخرى أو أزل التصفية." />
            )}

            {grouped.map(([group, list]) => (
              <section className="depts-group" key={group} aria-label={group}>
                <header>
                  <h2>{group}</h2>
                  <span className="tq-badge">{list.length.toLocaleString('en-US')}</span>
                </header>
                <div className="depts-grid">
                  {list.map(item => (
                    <Link href={`/departments/${item.id}`} className="dept-card" key={item.id}>
                      <div className="dept-card-head">
                        <span className="dept-card-icon">
                          <Building2 />
                        </span>
                        <div>
                          <h3>{item.name}</h3>
                          <small>
                            <MapPin aria-hidden="true" /> {item.district}
                            {item.parentMinistry ? ` • ${item.parentMinistry}` : ''}
                          </small>
                        </div>
                      </div>
                      {item.services.length > 0 && (
                        <ul className="dept-card-services">
                          {item.services.slice(0, 3).map(service => (
                            <li key={service}>{service}</li>
                          ))}
                        </ul>
                      )}
                      <div className="dept-card-foot">
                        {item.dataStatus === 'VERIFIED_SOURCE' ? (
                          <span className="tq-badge is-success">
                            <ShieldCheck /> مصدر موثق
                          </span>
                        ) : (
                          <span className="tq-badge is-warning">بحاجة لتحقق</span>
                        )}
                        {item.digitalServices ? (
                          <span className="tq-badge is-info">{item.digitalServices} خدمة رقمية</span>
                        ) : null}
                        <ArrowLeft className="dept-card-arrow" aria-hidden="true" />
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ))}

            <p className="tq-note">
              <ExternalLink aria-hidden="true" />
              <span>
                جُمع هذا السجل من مصادر رسمية ومفتوحة (مواقع الوزارات، بوابة أور، OpenStreetMap). أي جهة موسومة «بحاجة
                لتحقق» تنتظر تأكيداً رسمياً من ديوان المحافظة قبل تشغيل معاملاتها.
              </span>
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
