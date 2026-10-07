import { useEffect, useMemo, useState } from 'react'
import { Link } from 'wouter'
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  FileCheck2,
  FileText,
  Globe2,
  Info,
  LayoutGrid,
  X,
} from 'lucide-react'
import { departmentCount, documentCount, serviceCount } from '../../lib/arabic-count'
import { api } from '../../api'
import type { CatalogService, CatalogSummary, DepartmentSummary, ServiceChannel } from '../../types'
import { Footer } from '../../components/public/Footer'
import { OfficialGovernmentServiceCatalog } from '../../components/public/OfficialGovernmentServiceCatalog'
import { PublicHeader } from '../../components/public/PublicHeader'
import { SmartSearch } from '../../components/public/SmartSearch'
import { EmptyState, PageHeader } from '../../components/public/PageHeader'

const channelMeta: Record<ServiceChannel, { label: string; short: string; icon: typeof Globe2 }> = {
  ONLINE_SUBMISSION: { label: 'تقديم إلكتروني كامل', short: 'إلكترونية', icon: Globe2 },
  APPOINTMENT_REQUIRED: { label: 'تقديم إلكتروني ثم حضور لإكمال الإجراء', short: 'إلكترونية + حضور', icon: CalendarClock },
  INFORMATION_ONLY: { label: 'خدمة معلوماتية', short: 'معلوماتية', icon: Info },
}

const channelOrder: ServiceChannel[] = ['ONLINE_SUBMISSION', 'APPOINTMENT_REQUIRED', 'INFORMATION_ONLY']

function readParams() {
  const params = new URLSearchParams(window.location.search)
  return {
    q: params.get('q') || '',
    category: params.get('category') || '',
    department: params.get('department') || '',
    channel: (params.get('channel') as ServiceChannel | null) || ('' as const),
  }
}

// phones get shorter batches: a 437-service list is ~28k px tall at 60 cards per page
const pageSize = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 600px)').matches ? 20 : 60

export function GovernmentDirectoryPage() {
  const [initial] = useState(readParams)
  const [query, setQuery] = useState(initial.q)
  const [category, setCategory] = useState(initial.category)
  const [department, setDepartment] = useState(initial.department)
  const [channel, setChannel] = useState<ServiceChannel | ''>(initial.channel as ServiceChannel | '')
  const [services, setServices] = useState<CatalogService[]>([])
  const [summary, setSummary] = useState<CatalogSummary | null>(null)
  const [departments, setDepartments] = useState<DepartmentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [visible, setVisible] = useState(pageSize)

  useEffect(() => {
    let active = true
    Promise.all([
      api.listServices(),
      api.getServicesSummary(),
      api.listDepartments().then(body => body.items).catch(() => [] as DepartmentSummary[]),
    ])
      .then(([items, stats, dept]) => {
        if (!active) return
        setServices(items)
        setSummary(stats)
        setDepartments(dept)
      })
      .catch(() => {
        if (active) setServices([])
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (category) params.set('category', category)
    if (department) params.set('department', department)
    if (channel) params.set('channel', channel)
    const next = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${next ? `?${next}` : ''}`)
    setVisible(pageSize())
  }, [query, category, department, channel])

  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[ً-ْ]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()

  const [ranked, setRanked] = useState<CatalogService[] | null>(null)
  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setRanked(null)
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      api
        .searchServices(term, 40)
        .then(items => {
          if (active) setRanked(items)
        })
        .catch(() => {
          if (active) setRanked(null)
        })
    }, 180)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [query])

  const results = useMemo(() => {
    const tokens = normalize(query)
      .split(' ')
      .filter(token => token.length > 1)
    const applyFilters = (item: CatalogService) => {
      if (category && item.category !== category) return false
      if (department && item.departmentId !== department) return false
      if (channel && item.channel !== channel) return false
      return true
    }
    // server ranking (synonyms + fuzzy) wins when available; the client filter is the instant fallback
    if (tokens.length && ranked) return ranked.filter(applyFilters)
    const filtered = services.filter(item => {
      if (!applyFilters(item)) return false
      if (!tokens.length) return true
      const text = normalize(
        `${item.title} ${item.description} ${item.departmentName} ${item.category} ${item.requiredDocuments.map(doc => doc.label).join(' ')}`
      )
      return tokens.every(token => text.includes(token))
    })
    const channelRank: Record<ServiceChannel, number> = { ONLINE_SUBMISSION: 0, APPOINTMENT_REQUIRED: 1, INFORMATION_ONLY: 2 }
    const qualityRank = { OFFICIAL: 0, RELIABLE: 1, UNVERIFIED: 2 }
    return filtered.sort(
      (a, b) =>
        channelRank[a.channel] - channelRank[b.channel] ||
        qualityRank[a.sourceQuality] - qualityRank[b.sourceQuality] ||
        a.title.localeCompare(b.title, 'ar')
    )
  }, [services, ranked, query, category, department, channel])

  const departmentName = departments.find(item => item.id === department)?.name
  const activeFilters = [category, department, channel].filter(Boolean).length + (query.trim() ? 1 : 0)

  const resetFilters = () => {
    setQuery('')
    setCategory('')
    setDepartment('')
    setChannel('')
  }

  return (
    <div className="tq-page">
      <PublicHeader />
      <main id="main-content">
        <PageHeader
          crumbs={[{ label: 'دليل الخدمات' }]}
          kicker={
            <>
              <LayoutGrid size={15} /> دليل الخدمات الحكومية
            </>
          }
          title="ابحث عن خدمتك واعرف ما تحتاجه قبل أن تبدأ"
          description={
            summary
              ? `${serviceCount(summary.total)} من ${departmentCount(departments.length)} حكومية، لكل خدمة المستمسكات المطلوبة وطريقة التقديم ومصدرها الرسمي.`
              : 'ابحث باسم الخدمة أو الدائرة أو المستمسك.'
          }
          aside={
            summary ? (
              <dl className="tq-figures">
                <div>
                  <dt>إلكترونية بالكامل</dt>
                  <dd>{(summary.channels.ONLINE_SUBMISSION || 0).toLocaleString('en-US')}</dd>
                </div>
                <div>
                  <dt>إلكترونية + حضور</dt>
                  <dd>{(summary.channels.APPOINTMENT_REQUIRED || 0).toLocaleString('en-US')}</dd>
                </div>
                <div>
                  <dt>معلوماتية</dt>
                  <dd>{(summary.channels.INFORMATION_ONLY || 0).toLocaleString('en-US')}</dd>
                </div>
              </dl>
            ) : undefined
          }
        >
          <SmartSearch
            value={query}
            onChange={setQuery}
            variant="compact"
            placeholder="مثال: إجازة بناء، جواز سفر، تقاعد، عقد إيجار… أو اضغط الميكروفون وتكلّم"
            onSubmitQuery={() => undefined}
          />
          <div className="tq-chips dir-channels" role="group" aria-label="طريقة التقديم">
            <button
              type="button"
              className={channel === '' ? 'tq-chip is-active' : 'tq-chip'}
              aria-pressed={channel === ''}
              onClick={() => setChannel('')}
            >
              كل طرق التقديم
            </button>
            {channelOrder.map(item => {
              const Icon = channelMeta[item].icon
              return (
                <button
                  type="button"
                  className={channel === item ? 'tq-chip is-active' : 'tq-chip'}
                  aria-pressed={channel === item}
                  onClick={() => setChannel(item)}
                  key={item}
                >
                  <Icon size={14} /> {channelMeta[item].short}
                  {summary?.channels[item] ? <b>{summary.channels[item]?.toLocaleString('en-US')}</b> : null}
                </button>
              )
            })}
          </div>
        </PageHeader>

        <section className="tq-content">
          <div className="tq-container tq-layout is-aside-start">
            <aside className="dir-filters tq-sticky" aria-label="تصفية الخدمات">
              <div className="dir-filter-group">
                <h2>القطاع</h2>
                <ul>
                  <li>
                    <button
                      type="button"
                      className={category === '' ? 'is-active' : ''}
                      aria-pressed={category === ''}
                      onClick={() => setCategory('')}
                    >
                      <span>كل القطاعات</span>
                      <b>{summary?.total.toLocaleString('en-US')}</b>
                    </button>
                  </li>
                  {summary?.categories.map(item => (
                    <li key={item.label}>
                      <button
                        type="button"
                        className={category === item.label ? 'is-active' : ''}
                        aria-pressed={category === item.label}
                        onClick={() => setCategory(item.label)}
                      >
                        <span>{item.label}</span>
                        <b>{item.total.toLocaleString('en-US')}</b>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <label className="tq-field dir-filter-group">
                <span>الجهة</span>
                <select value={department} onChange={event => setDepartment(event.target.value)}>
                  <option value="">كل الجهات</option>
                  {departments.map(item => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <Link href="/departments" className="gov-link">
                دليل الدوائر الحكومية <ArrowLeft size={14} />
              </Link>
            </aside>

            <div className="dir-results">
              <header className="dir-results-head">
                <div>
                  <h2 aria-live="polite">
                    {loading ? 'جاري التحميل…' : `${results.length.toLocaleString('en-US')} خدمة`}
                    {departmentName ? ` — ${departmentName}` : category ? ` — ${category}` : ''}
                  </h2>
                  <p>
                    {channel ? channelMeta[channel].label : 'كل طرق التقديم'}
                    {query.trim() ? ` · نتائج البحث عن «${query.trim()}»` : ''}
                  </p>
                </div>
                {activeFilters > 0 && (
                  <button type="button" className="button outline small" onClick={resetFilters}>
                    <X /> إزالة التصفية
                  </button>
                )}
              </header>

              {loading && (
                <ul className="dir-list" aria-hidden="true">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <li className="dir-row is-skeleton" key={index}>
                      <div className="dir-row-main">
                        <i className="tq-skeleton w30" />
                        <i className="tq-skeleton w70 h20" />
                        <i className="tq-skeleton w90" />
                        <i className="tq-skeleton w50" />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {!loading && results.length === 0 && (
                <EmptyState
                  icon={<Building2 />}
                  title="لا توجد خدمة مطابقة"
                  text="جرّب كلمة أقصر أو أزل التصفية. إذا كانت الخدمة غير مسجلة بعد، راجع صفحة الجهة أو أرسل مقترحاً."
                  action={
                    <div className="tq-page-actions">
                      {activeFilters > 0 && (
                        <button type="button" className="button outline" onClick={resetFilters}>
                          إزالة التصفية
                        </button>
                      )}
                      <Link href="/citizen/feedback" className="button primary">
                        اقترح إضافة خدمة
                      </Link>
                    </div>
                  }
                />
              )}

              <ul className="dir-list">
                {results.slice(0, visible).map(item => {
                  const Icon = channelMeta[item.channel].icon
                  const requiredCount = item.requiredDocuments.filter(doc => doc.required).length
                  return (
                    <li key={item.key} className="dir-row">
                      <div className="dir-row-main">
                        <div className="dir-row-tags">
                          <span className={`tq-channel channel-${item.channel.toLowerCase()}`}>
                            <Icon size={12} /> {channelMeta[item.channel].short}
                          </span>
                          {item.sourceQuality === 'OFFICIAL' && <span className="tq-badge is-accent">مصدر رسمي</span>}
                          {item.sourceQuality === 'UNVERIFIED' && (
                            <span className="tq-badge">بانتظار تأكيد الدائرة</span>
                          )}
                        </div>
                        <h3>
                          <Link href={`/service/${item.key}`}>{item.title}</Link>
                        </h3>
                        {item.description && <p>{item.description}</p>}
                        <ul className="dir-row-meta">
                          <li>
                            <Building2 aria-hidden="true" />
                            <Link href={`/departments/${item.departmentId}`}>{item.departmentName}</Link>
                          </li>
                          <li>
                            <FileText aria-hidden="true" />
                            {requiredCount ? documentCount(requiredCount) : 'لا تحتاج مستمسكات'}
                          </li>
                          {item.feeStatus === 'OFFICIAL' && item.feeIqd ? (
                            <li>
                              <CircleDollarSign aria-hidden="true" />
                              {item.feeIqd.toLocaleString('en-US')} د.ع
                            </li>
                          ) : null}
                          {item.estimatedDuration && (
                            <li>
                              <Clock3 aria-hidden="true" />
                              {item.estimatedDuration}
                            </li>
                          )}
                        </ul>
                      </div>
                      <div className="dir-row-actions">
                        <Link
                          href={`/service/${item.key}`}
                          className={item.channel === 'INFORMATION_ONLY' ? 'button outline small' : 'button primary small'}
                        >
                          {item.channel === 'INFORMATION_ONLY' ? 'التفاصيل' : 'ابدأ الطلب'} <ArrowLeft />
                        </Link>
                        {item.sourceUrl && (
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="gov-link dir-source"
                            aria-label={`المصدر الرسمي: ${item.title}`}
                          >
                            <ExternalLink size={14} /> المصدر
                          </a>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
              {results.length > visible && (
                <div className="dir-more">
                  <button
                    type="button"
                    className="button outline"
                    onClick={() => setVisible(value => value + pageSize())}
                  >
                    عرض المزيد ({(results.length - visible).toLocaleString('en-US')} خدمة أخرى)
                  </button>
                </div>
              )}
              <p className="tq-note dir-note">
                <FileCheck2 aria-hidden="true" />
                <span>
                  الرسوم تُعرض فقط عندما تكون موثقة من مصدر رسمي. الخدمات المعلَّمة «بانتظار تأكيد الدائرة» جُمعت من
                  مصادر عامة وستُحدَّث عند اعتماد الدائرة لها داخل المنصة.
                </span>
              </p>
            </div>
          </div>
        </section>
        <section className="tq-section">
          <div className="tq-container">
            <OfficialGovernmentServiceCatalog query={query} />
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
