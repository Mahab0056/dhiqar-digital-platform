import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { ArrowRight, Building2, ExternalLink, Gauge, Globe, MapPin, Phone, ShieldCheck } from 'lucide-react'
import { CircleMarker, MapContainer, TileLayer } from 'react-leaflet'
import { api } from '../../api'
import type { DepartmentSummary } from '../../types'
import { useSession } from '../../lib/session'
import { PublicHeader } from '../../components/public/PublicHeader'
import { Footer } from '../../components/public/Footer'
import { services as platformServices } from '../../data'

export function DepartmentPublicPage({ id }: { id: string }) {
  const [item, setItem] = useState<DepartmentSummary | null>(null)
  const [error, setError] = useState('')
  const { session } = useSession()
  useEffect(() => {
    setItem(null)
    api
      .getDepartment(id)
      .then(setItem)
      .catch(err => setError((err as Error).message))
  }, [id])

  const digitalServices = item ? platformServices.filter(service => service.department === item.name) : []
  const canOpenDashboard =
    session &&
    session.role !== 'CITIZEN' &&
    (session.role === 'SUPER_ADMIN' || session.role === 'OPERATIONS' || session.departmentId === id)

  return (
    <div className="public-shell department-page">
      <PublicHeader />
      <main className="container">
        <Link href="/departments" className="back-link">
          <ArrowRight /> دليل الدوائر
        </Link>
        {error && <div className="form-error">{error}</div>}
        {item && (
          <>
            <section className="department-hero">
              <span className="department-hero-icon">
                <Building2 />
              </span>
              <div>
                <span className="section-kicker">{item.category}</span>
                <h1>{item.name}</h1>
                {item.nameEn && <p className="department-hero-en">{item.nameEn}</p>}
                <div className="department-hero-meta">
                  <span>
                    <MapPin size={14} /> {item.district}
                  </span>
                  {item.parentMinistry && <span>تابعة لـ {item.parentMinistry}</span>}
                  <span className={item.dataStatus === 'VERIFIED_SOURCE' ? 'status-pill on' : 'status-pill off'}>
                    <ShieldCheck size={12} /> {item.dataStatus === 'VERIFIED_SOURCE' ? 'مصدر موثق' : 'بحاجة لتحقق رسمي'}
                  </span>
                </div>
              </div>
              {canOpenDashboard && (
                <Link href={`/department/${item.id}`} className="button primary">
                  <Gauge /> لوحة الدائرة
                </Link>
              )}
            </section>

            <section className="department-columns">
              <div className="department-main">
                <article className="department-block">
                  <h2>الخدمات التي تقدمها الدائرة</h2>
                  <ul className="department-services">
                    {item.services.map(service => (
                      <li key={service}>{service}</li>
                    ))}
                  </ul>
                </article>
                {digitalServices.length > 0 && (
                  <article className="department-block">
                    <h2>خدمات متاحة رقمياً عبر المنصة</h2>
                    <div className="department-digital-services">
                      {digitalServices.map(service => (
                        <Link href={`/service/${service.key}`} key={service.key}>
                          <strong>{service.title}</strong>
                          <small>{service.description}</small>
                        </Link>
                      ))}
                    </div>
                  </article>
                )}
                {item.notes && (
                  <article className="department-block muted-block">
                    <h2>ملاحظات السجل</h2>
                    <p>{item.notes}</p>
                  </article>
                )}
              </div>
              <aside className="department-side">
                <article className="department-block">
                  <h2>معلومات الاتصال</h2>
                  <dl className="department-contact">
                    <dt>العنوان</dt>
                    <dd>{item.address || 'غير مسجل بعد'}</dd>
                    <dt>
                      <Phone size={13} /> الهاتف
                    </dt>
                    <dd dir="ltr">{item.phone || '—'}</dd>
                    <dt>
                      <Globe size={13} /> الموقع الرسمي
                    </dt>
                    <dd>
                      {item.website ? (
                        <a href={item.website} target="_blank" rel="noreferrer" dir="ltr">
                          {item.website.replace(/^https?:\/\//, '')} <ExternalLink size={12} />
                        </a>
                      ) : (
                        '—'
                      )}
                    </dd>
                    {item.facebook && (
                      <>
                        <dt>فيسبوك</dt>
                        <dd>
                          <a href={item.facebook} target="_blank" rel="noreferrer">
                            الصفحة الرسمية <ExternalLink size={12} />
                          </a>
                        </dd>
                      </>
                    )}
                    <dt>مصدر البيانات</dt>
                    <dd>
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer" dir="ltr">
                        {item.sourceUrl.replace(/^https?:\/\//, '').slice(0, 40)} <ExternalLink size={12} />
                      </a>
                    </dd>
                  </dl>
                </article>
                <article className="department-block department-map-block">
                  <h2>الموقع</h2>
                  {typeof item.lat === 'number' && typeof item.lng === 'number' ? (
                    <>
                      <MapContainer center={[item.lat, item.lng]} zoom={15} scrollWheelZoom={false} className="department-map">
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        <CircleMarker
                          center={[item.lat, item.lng]}
                          radius={10}
                          pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#0a8f50', fillOpacity: 1 }}
                        />
                      </MapContainer>
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${item.lat}&mlon=${item.lng}#map=17/${item.lat}/${item.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="button outline"
                      >
                        فتح في الخريطة <ExternalLink size={13} />
                      </a>
                    </>
                  ) : (
                    <p className="muted">لم تُسجل إحداثيات رسمية لهذه الجهة بعد.</p>
                  )}
                </article>
              </aside>
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}
