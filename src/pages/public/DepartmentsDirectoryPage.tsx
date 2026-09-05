import { useEffect, useMemo, useState } from 'react'
import { Link } from 'wouter'
import { ArrowLeft, Building2, ExternalLink, Filter, MapPin, Search, ShieldCheck } from 'lucide-react'
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip as LeafletTooltip } from 'react-leaflet'
import { api } from '../../api'
import type { DepartmentDirectoryResponse, DepartmentSummary } from '../../types'
import { PublicHeader } from '../../components/public/PublicHeader'
import { Footer } from '../../components/public/Footer'

export const categoryIconLabel = (category: string) => category.split(' ')[0]

export function DepartmentsDirectoryPage() {
  const [data, setData] = useState<DepartmentDirectoryResponse | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [district, setDistrict] = useState('')
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
    <div className="public-shell departments-page">
      <PublicHeader />
      <main className="container">
        <section className="departments-hero">
          <div>
            <span className="section-kicker">
              <Building2 size={14} /> دليل الدوائر الحكومية
            </span>
            <h1>كل دوائر ومديريات محافظة ذي قار في مكان واحد</h1>
            <p>
              {data
                ? `${data.summary.total.toLocaleString('en-US')} جهة حكومية في ${data.summary.categories.toLocaleString('en-US')} قطاعاً، منها ${data.summary.gisComplete.toLocaleString('en-US')} بموقع جغرافي موثق. المصدر مذكور لكل جهة، ولا تُعرض أرقام أو مواقع غير موثقة.`
                : 'جارٍ تحميل السجل...'}
            </p>
          </div>
          <div className="departments-hero-stats">
            <div>
              <strong>{data?.summary.total ?? '—'}</strong>
              <small>جهة مسجلة</small>
            </div>
            <div>
              <strong>{data?.summary.verified ?? '—'}</strong>
              <small>بمصدر رسمي</small>
            </div>
            <div>
              <strong>{data?.summary.gisComplete ?? '—'}</strong>
              <small>بموقع موثق</small>
            </div>
          </div>
        </section>

        <section className="departments-toolbar">
          <label className="departments-search">
            <Search />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="ابحث باسم الدائرة أو الخدمة أو الوزارة"
              aria-label="بحث في الدوائر"
            />
          </label>
          <label>
            <Filter size={14} /> القطاع
            <select value={category} onChange={event => setCategory(event.target.value)}>
              <option value="">كل القطاعات</option>
              {data?.categories.map(item => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            <MapPin size={14} /> القضاء
            <select value={district} onChange={event => setDistrict(event.target.value)}>
              <option value="">كل الأقضية</option>
              {data?.districts.map(item => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <span className="departments-count">{items.length.toLocaleString('en-US')} نتيجة</span>
        </section>

        {error && <div className="form-error">{error}</div>}

        <section className="departments-map-card">
          <MapContainer center={[31.05, 46.25]} zoom={11} scrollWheelZoom={false} className="departments-map">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {located.map(item => (
              <CircleMarker
                key={item.id}
                center={[item.lat, item.lng]}
                radius={8}
                pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#0a8f50', fillOpacity: 1 }}
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
          <small>
            تُرسم فقط الجهات ذات الإحداثيات الموثقة ({located.length.toLocaleString('en-US')} من{' '}
            {items.length.toLocaleString('en-US')}). البقية مسجلة بانتظار إحداثيات رسمية.
          </small>
        </section>

        {grouped.map(([group, list]) => (
          <section className="departments-group" key={group}>
            <header>
              <h2>{group}</h2>
              <span>{list.length.toLocaleString('en-US')}</span>
            </header>
            <div className="departments-grid">
              {list.map(item => (
                <Link href={`/departments/${item.id}`} className="department-card" key={item.id}>
                  <div className="department-card-head">
                    <span className="department-card-icon">
                      <Building2 />
                    </span>
                    <div>
                      <h3>{item.name}</h3>
                      <small>
                        {item.district}
                        {item.parentMinistry ? ` • ${item.parentMinistry}` : ''}
                      </small>
                    </div>
                  </div>
                  <ul>
                    {item.services.slice(0, 3).map(service => (
                      <li key={service}>{service}</li>
                    ))}
                  </ul>
                  <div className="department-card-foot">
                    <span className={item.dataStatus === 'VERIFIED_SOURCE' ? 'status-pill on' : 'status-pill off'}>
                      <ShieldCheck size={12} /> {item.dataStatus === 'VERIFIED_SOURCE' ? 'مصدر موثق' : 'بحاجة لتحقق'}
                    </span>
                    {item.gisStatus === 'COORDINATES_VERIFIED' && (
                      <span className="status-pill on">
                        <MapPin size={12} /> موقع موثق
                      </span>
                    )}
                    {item.digitalServices ? (
                      <span className="status-pill on">{item.digitalServices} خدمة رقمية</span>
                    ) : null}
                    <ArrowLeft className="department-card-arrow" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}

        <section className="departments-note">
          <ExternalLink />
          <p>
            جُمع هذا السجل من مصادر رسمية ومفتوحة (مواقع الوزارات، بوابة أور، OpenStreetMap). أي جهة موسومة «بحاجة لتحقق»
            تنتظر تأكيداً رسمياً من ديوان المحافظة قبل تشغيل معاملاتها. لا تُعرض أرقام هاتف غير موثقة.
          </p>
        </section>
      </main>
      <Footer />
    </div>
  )
}
