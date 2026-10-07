import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import {
  ArrowRight,
  ChevronLeft,
  ExternalLink,
  Gauge,
  Info,
  Landmark,
  LayoutGrid,
  MapPin,
  Navigation,
  Phone,
  ShieldCheck,
} from 'lucide-react'
import { CircleMarker, MapContainer, TileLayer } from 'react-leaflet'
import { documentCount } from '../../lib/arabic-count'
import { api } from '../../api'
import type { CatalogService, DepartmentSummary } from '../../types'
import { useSession } from '../../lib/session'
import { PublicHeader } from '../../components/public/PublicHeader'
import { Footer } from '../../components/public/Footer'
import { EmptyState, LoadingBlock, PageHeader } from '../../components/public/PageHeader'

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

  const [digitalServices, setDigitalServices] = useState<CatalogService[]>([])
  useEffect(() => {
    let active = true
    api
      .listServices({ department: id })
      .then(items => {
        if (active) setDigitalServices(items)
      })
      .catch(() => {
        if (active) setDigitalServices([])
      })
    return () => {
      active = false
    }
  }, [id])
  const canOpenDashboard =
    session &&
    session.role !== 'CITIZEN' &&
    (session.role === 'SUPER_ADMIN' || session.role === 'OPERATIONS' || session.departmentId === id)

  if (!item)
    return (
      <div className="tq-page">
        <PublicHeader />
        <main id="main-content" className="tq-content">
          <div className="tq-container">
            {error ? (
              <EmptyState
                tone="danger"
                title="تعذر فتح صفحة الجهة"
                text={error}
                action={
                  <Link href="/departments" className="button primary">
                    <ArrowRight /> دليل الدوائر
                  </Link>
                }
              />
            ) : (
              <LoadingBlock label="جاري تحميل بيانات الجهة…" />
            )}
          </div>
        </main>
        <Footer />
      </div>
    )

  const hasLocation = typeof item.lat === 'number' && typeof item.lng === 'number'

  return (
    <div className="tq-page">
      <PublicHeader />
      <main id="main-content">
        <PageHeader
          crumbs={[{ label: 'الدوائر الحكومية', href: '/departments' }, { label: item.name }]}
          kicker={item.category}
          title={item.name}
          description={item.nameEn ? <span dir="ltr">{item.nameEn}</span> : undefined}
          meta={
            <>
              <span>
                <MapPin /> {item.district}
              </span>
              {item.parentMinistry && (
                <span>
                  <Landmark /> تابعة لـ{item.parentMinistry}
                </span>
              )}
              {item.dataStatus === 'VERIFIED_SOURCE' ? (
                <span className="tq-badge is-success">
                  <ShieldCheck /> مصدر موثق
                </span>
              ) : (
                <span className="tq-badge is-warning">بحاجة لتحقق رسمي</span>
              )}
            </>
          }
          actions={
            canOpenDashboard || digitalServices.length > 0 ? (
              <>
                {digitalServices.length > 0 && (
                  <Link href={`/directory?department=${encodeURIComponent(id)}`} className="button primary">
                    <LayoutGrid /> خدمات الجهة ({digitalServices.length.toLocaleString('en-US')})
                  </Link>
                )}
                {canOpenDashboard && (
                  <Link href={`/department/${item.id}`} className="button outline">
                    <Gauge /> لوحة الدائرة
                  </Link>
                )}
              </>
            ) : undefined
          }
        />

        <section className="tq-content">
          <div className="tq-container tq-layout">
            <div className="tq-stack">
              {digitalServices.length > 0 ? (
                <article className="tq-panel">
                  <div className="tq-panel-head">
                    <div>
                      <h2>
                        <LayoutGrid /> خدمات الجهة على المنصة
                      </h2>
                      <p>{digitalServices.length.toLocaleString('en-US')} خدمة بمستمسكاتها وطريقة تقديمها</p>
                    </div>
                  </div>
                  <ul className="dept-services">
                    {digitalServices.map(service => (
                      <li key={service.key}>
                        <Link href={`/service/${service.key}`}>
                          <span className="dept-service-text">
                            <strong>{service.title}</strong>
                            <small>
                              {service.channel === 'ONLINE_SUBMISSION'
                                ? 'تقديم إلكتروني'
                                : service.channel === 'APPOINTMENT_REQUIRED'
                                  ? 'تقديم إلكتروني ثم حضور'
                                  : 'خدمة معلوماتية'}
                              {service.requiredDocuments.length
                                ? ` • ${documentCount(service.requiredDocuments.filter(doc => doc.required).length)} مطلوب`
                                : ''}
                            </small>
                          </span>
                          <ChevronLeft aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </article>
              ) : (
                <article className="tq-panel">
                  <h2>
                    <LayoutGrid /> الخدمات التي تقدمها الجهة
                  </h2>
                  {item.services.length ? (
                    <ul className="dept-plain-services">
                      {item.services.map(service => (
                        <li key={service}>{service}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>لم تُسجل خدمات لهذه الجهة بعد.</p>
                  )}
                </article>
              )}
              {item.notes && (
                <p className="tq-note is-info">
                  <Info aria-hidden="true" />
                  <span>{item.notes}</span>
                </p>
              )}
            </div>
            <aside className="tq-stack tq-sticky">
              <article className="tq-panel">
                <h2>
                  <Phone /> معلومات الاتصال
                </h2>
                <dl className="tq-dl is-stacked">
                  <div>
                    <dt>العنوان</dt>
                    <dd>{item.address || 'غير مسجل بعد'}</dd>
                  </div>
                  <div>
                    <dt>الهاتف</dt>
                    <dd dir="ltr" className="dept-ltr">
                      {item.phone || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>الموقع الرسمي</dt>
                    <dd>
                      {item.website ? (
                        <a href={item.website} target="_blank" rel="noreferrer" dir="ltr" className="gov-link">
                          {item.website.replace(/^https?:\/\//, '')} <ExternalLink size={13} />
                        </a>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                  {item.facebook && (
                    <div>
                      <dt>فيسبوك</dt>
                      <dd>
                        <a href={item.facebook} target="_blank" rel="noreferrer" className="gov-link">
                          الصفحة الرسمية <ExternalLink size={13} />
                        </a>
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>مصدر البيانات</dt>
                    <dd>
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer" dir="ltr" className="gov-link dept-source">
                        {item.sourceUrl.replace(/^https?:\/\//, '').slice(0, 40)} <ExternalLink size={13} />
                      </a>
                    </dd>
                  </div>
                </dl>
              </article>
              <article className="tq-panel">
                <h2>
                  <MapPin /> الموقع
                </h2>
                {hasLocation ? (
                  <>
                    <div className="dept-map">
                      <MapContainer
                        center={[item.lat as number, item.lng as number]}
                        zoom={15}
                        scrollWheelZoom={false}
                        className="dept-leaflet"
                      >
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        <CircleMarker
                          center={[item.lat as number, item.lng as number]}
                          radius={10}
                          pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#075e45', fillOpacity: 1 }}
                        />
                      </MapContainer>
                    </div>
                    <a
                      href={`https://www.openstreetmap.org/directions?to=${item.lat}%2C${item.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="button outline full"
                    >
                      <Navigation /> الاتجاهات إلى الجهة
                    </a>
                  </>
                ) : (
                  <p>لم تُسجل إحداثيات رسمية لهذه الجهة بعد.</p>
                )}
              </article>
            </aside>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
