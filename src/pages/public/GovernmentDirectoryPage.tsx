import { useMemo, useState } from 'react'
import { Link } from 'wouter'
import { ArrowLeft, Building2, ExternalLink, Network, Search, X } from 'lucide-react'
import { availabilityLabels, entityTypeLabels, governmentEntities, integrationStatusLabels } from '../../government-directory'
import { Footer } from '../../components/public/Footer'
import { OfficialGovernmentServiceCatalog } from '../../components/public/OfficialGovernmentServiceCatalog'
import { PublicHeader } from '../../components/public/PublicHeader'

export function GovernmentDirectoryPage() {
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q') || '')
  const [typeFilter, setTypeFilter] = useState<'ALL' | import('../../government-directory').GovernmentEntityType>('ALL')
  const normalizedQuery = query.trim().toLowerCase()
  const entities = useMemo(
    () =>
      governmentEntities
        .filter(entity => typeFilter === 'ALL' || entity.type === typeFilter)
        .filter(
          entity =>
            !normalizedQuery ||
            `${entity.name} ${entity.nameEn} ${entity.parentAuthority} ${entity.district} ${entity.summary} ${entity.services.flatMap(service => [service.name, service.description, ...service.keywords]).join(' ')}`
              .toLowerCase()
              .includes(normalizedQuery)
        ),
    [normalizedQuery, typeFilter]
  )
  const matchingServices = useMemo(
    () =>
      entities.flatMap(entity =>
        entity.services
          .filter(
            service =>
              !normalizedQuery ||
              `${entity.name} ${service.name} ${service.description} ${service.keywords.join(' ')}`
                .toLowerCase()
                .includes(normalizedQuery)
          )
          .map(service => ({ entity, service }))
      ),
    [entities, normalizedQuery]
  )
  return (
    <div className="public-shell directory-page">
      <PublicHeader />
      <main>
        <section className="directory-hero">
          <div className="container">
            <span className="eyebrow">
              <Network size={16} /> دليل الخدمات والجهات الحكومية
            </span>
            <h1>
              الوصول إلى الخدمة الحكومية
              <br />
              <em>بمسار واضح.</em>
            </h1>
            <p>
              ابحث باسم الخدمة أو الجهة الحكومية. يوضح الدليل الجهة المسؤولة، وحالة الإتاحة، والمسار الإلكتروني المناسب.
            </p>
            <div className="directory-search">
              <Search />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="مثال: إجازة بناء، خدمات المياه، البطاقة الوطنية، طلب قطعة أرض"
                aria-label="البحث في دليل خدمات ذي قار"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="مسح البحث">
                  <X />
                </button>
              )}
            </div>
            <div className="directory-search-hints">
              <span>أمثلة للبحث:</span>
              {['خدمات المياه', 'خدمات المجاري', 'إجازة فتح محل', 'إجازة بناء', 'البطاقة الوطنية'].map(hint => (
                <button key={hint} onClick={() => setQuery(hint)}>
                  {hint}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="section container directory-body">
          <div className="directory-overview">
            <div>
              <span className="section-kicker">دليل موحد</span>
              <h2>الخدمات مرتبة حسب الجهة والقطاع</h2>
              <p>
                يجمع الدليل الجهات المحلية والاتحادية والهيئات المستقلة المسجلة في المحافظة، مع بيان الجهة الأم لكل سجل.
              </p>
            </div>
            <div className="directory-count">
              <strong>{governmentEntities.length.toLocaleString('en-US')}</strong>
              <span>جهة مسجلة في الدليل</span>
            </div>
          </div>
          <nav className="directory-filters" aria-label="تصفية الجهات">
            <button className={typeFilter === 'ALL' ? 'active' : ''} onClick={() => setTypeFilter('ALL')}>
              الكل
            </button>
            {(Object.keys(entityTypeLabels) as Array<import('../../government-directory').GovernmentEntityType>).map(
              type => (
                <button className={typeFilter === type ? 'active' : ''} onClick={() => setTypeFilter(type)} key={type}>
                  {entityTypeLabels[type]}
                </button>
              )
            )}
          </nav>
          {normalizedQuery && (
            <section className="directory-results">
              <header>
                <span className="section-kicker">نتائج حسب الحاجة</span>
                <h2>{matchingServices.length ? 'هذه المسارات تناسب بحثك' : 'لم نجد مساراً مطابقاً بعد'}</h2>
                <p>
                  {matchingServices.length
                    ? 'اختر الخدمة لبدء المسار المتاح، أو راجع مصدر الجهة للخدمات التي تنتظر الربط.'
                    : 'جرّب وصفاً أقصر للمشكلة أو اسم الجهة. ستظهر الخدمات المعتمدة مع توسع الدليل.'}
                </p>
              </header>
              {matchingServices.length > 0 && (
                <div className="directory-result-list">
                  {matchingServices.map(({ entity, service }) => (
                    <article key={`${entity.id}-${service.name}`}>
                      <span className={`availability ${service.availability.toLowerCase()}`}>
                        {availabilityLabels[service.availability]}
                      </span>
                      <div>
                        <small>
                          {entity.name} • {entityTypeLabels[entity.type]}
                        </small>
                        <h3>{service.name}</h3>
                        <p>{service.description}</p>
                      </div>
                      {service.serviceKey ? (
                        <Link href={`/service/${service.serviceKey}`} className="button primary">
                          ابدأ المسار <ArrowLeft />
                        </Link>
                      ) : (
                        <a href={entity.sourceUrl} target="_blank" rel="noreferrer" className="button outline">
                          المصدر الرسمي <ExternalLink />
                        </a>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
          <OfficialGovernmentServiceCatalog query={query} />
          <section className="directory-entity-section">
            <div className="section-heading">
              <div>
                <span className="section-kicker">الجهات الحكومية</span>
                <h2>استعرض الجهات حسب الاختصاص</h2>
              </div>
              <p>تعرض تفاصيل الخدمة والرسوم والمستمسكات عند توفر مصدر موثق من الجهة المختصة.</p>
            </div>
            {entities.length ? (
              <div className="directory-entity-grid">
                {entities.map(entity => (
                  <article className="directory-entity-card" key={entity.id}>
                    <header>
                      <span className="entity-mark">
                        <Building2 />
                      </span>
                      <div>
                        <span
                          className={`directory-verification ${entity.verification === 'VERIFIED_SOURCE' ? 'verified' : 'pending'}`}
                        >
                          {entity.verification === 'VERIFIED_SOURCE' ? 'مصدر موثق' : 'بيانات قيد التحقق'}
                        </span>
                        <h3>{entity.name}</h3>
                        <small>{entity.nameEn}</small>
                      </div>
                    </header>
                    <dl>
                      <div>
                        <dt>نوع الجهة</dt>
                        <dd>{entityTypeLabels[entity.type]}</dd>
                      </div>
                      <div>
                        <dt>الجهة الأم</dt>
                        <dd>{entity.parentAuthority}</dd>
                      </div>
                      <div>
                        <dt>النطاق</dt>
                        <dd>{entity.district}</dd>
                      </div>
                    </dl>
                    <p>{entity.summary}</p>
                    <div className="directory-card-services">
                      {entity.services.map(service => (
                        <span key={service.name}>{service.name}</span>
                      ))}
                    </div>
                    <footer>
                      <span className="integration-status">{integrationStatusLabels[entity.integrationStatus]}</span>
                      <div>
                        {entity.services.some(service => service.serviceKey) && (
                          <Link href={`/service/${entity.services.find(service => service.serviceKey)?.serviceKey}`}>
                            عرض الخدمة <ArrowLeft />
                          </Link>
                        )}
                        <a
                          href={entity.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`فتح مصدر ${entity.name}`}
                        >
                          <ExternalLink />
                        </a>
                      </div>
                    </footer>
                  </article>
                ))}
              </div>
            ) : (
              <div className="directory-empty">
                <Building2 />
                <h3>لا توجد جهة مطابقة</h3>
                <p>غيّر كلمة البحث أو أزل التصفية لعرض الدليل كاملاً.</p>
              </div>
            )}
          </section>
        </section>
      </main>
      <Footer />
    </div>
  )
}
