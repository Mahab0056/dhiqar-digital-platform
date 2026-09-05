import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'wouter'
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  ExternalLink,
  FileCheck2,
  Globe2,
  Info,
  LayoutGrid,
  X,
} from 'lucide-react'
import { api } from '../../api'
import type { CatalogService, CatalogSummary, DepartmentSummary, ServiceChannel } from '../../types'
import { Footer } from '../../components/public/Footer'
import { OfficialGovernmentServiceCatalog } from '../../components/public/OfficialGovernmentServiceCatalog'
import { PublicHeader } from '../../components/public/PublicHeader'
import { SmartSearch } from '../../components/public/SmartSearch'

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
  const [visible, setVisible] = useState(60)

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
    setVisible(60)
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

  return (
    <div className="public-shell directory-page gov-directory-page">
      <PublicHeader />
      <main>
        <section className="gov-directory-hero">
          <div className="gov-container">
            <span className="gov-eyebrow">
              <LayoutGrid size={15} /> دليل الخدمات الحكومية في ذي قار
            </span>
            <h1>ابحث عن الخدمة، اعرف المستمسكات، وقدّم إلكترونياً</h1>
            <p>
              {summary
                ? `${summary.total.toLocaleString('en-US')} خدمة من ${departments.length.toLocaleString('en-US')} جهة حكومية — ${(
                    summary.channels.ONLINE_SUBMISSION || 0
                  ).toLocaleString('en-US')} خدمة تُقدَّم إلكترونياً بالكامل و${(summary.channels.APPOINTMENT_REQUIRED || 0).toLocaleString('en-US')} خدمة تُقدَّم إلكترونياً ثم تُستكمل بالحضور.`
                : 'ابحث باسم الخدمة أو الجهة أو المستمسك.'}
            </p>
            <SmartSearch
              value={query}
              onChange={setQuery}
              variant="compact"
              placeholder="مثال: إجازة بناء، جواز، تقاعد، رخصة سياقة، عقد إيجار… أو اضغط المايك وتكلّم"
              onSubmitQuery={() => undefined}
            />
            <div className="gov-directory-channels" role="group" aria-label="طريقة التقديم">
              <button className={channel === '' ? 'active' : ''} onClick={() => setChannel('')}>
                الكل
              </button>
              {channelOrder.map(item => (
                <button className={channel === item ? 'active' : ''} onClick={() => setChannel(item)} key={item}>
                  {channelMeta[item].short}
                  {summary?.channels[item] ? <b>{summary.channels[item]?.toLocaleString('en-US')}</b> : null}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="gov-container gov-directory-body">
          <aside className="gov-directory-side">
            <h2>القطاعات</h2>
            <ul>
              <li>
                <button className={category === '' ? 'active' : ''} onClick={() => setCategory('')}>
                  كل القطاعات <b>{summary?.total.toLocaleString('en-US')}</b>
                </button>
              </li>
              {summary?.categories.map(item => (
                <li key={item.label}>
                  <button className={category === item.label ? 'active' : ''} onClick={() => setCategory(item.label)}>
                    {item.label} <b>{item.total.toLocaleString('en-US')}</b>
                  </button>
                </li>
              ))}
            </ul>
            <h2>الجهة</h2>
            <select value={department} onChange={event => setDepartment(event.target.value)} aria-label="تصفية حسب الجهة">
              <option value="">كل الجهات</option>
              {departments.map(item => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <Link href="/departments" className="gov-link">
              دليل الجهات الحكومية <ArrowLeft size={14} />
            </Link>
          </aside>

          <div className="gov-directory-results">
            <header className="gov-directory-results-head">
              <div>
                <h2>
                  {loading ? 'جاري التحميل…' : `${results.length.toLocaleString('en-US')} خدمة`}
                  {departmentName ? ` — ${departmentName}` : category ? ` — ${category}` : ''}
                </h2>
                <p>
                  {channel ? channelMeta[channel].label : 'كل طرق التقديم'}
                  {query.trim() ? ` · نتائج البحث عن «${query.trim()}»` : ''}
                </p>
              </div>
              {activeFilters > 0 && (
                <button
                  className="gov-btn outline small"
                  onClick={() => {
                    setQuery('')
                    setCategory('')
                    setDepartment('')
                    setChannel('')
                  }}
                >
                  <X size={14} /> إزالة التصفية
                </button>
              )}
            </header>

            {loading && (
              <ul className="gov-service-cards" aria-hidden="true">
                {Array.from({ length: 6 }).map((_, index) => (
                  <li className="gov-service-card" key={index}>
                    <div className="skeleton" style={{ width: '40%' }} />
                    <div className="skeleton" style={{ width: '85%', minHeight: 20 }} />
                    <div className="skeleton" style={{ width: '100%', minHeight: 44 }} />
                    <div className="skeleton" style={{ width: '60%' }} />
                  </li>
                ))}
              </ul>
            )}
            {!loading && results.length === 0 && (
              <div className="gov-directory-empty">
                <Building2 />
                <h3>لا توجد خدمة مطابقة</h3>
                <p>جرّب كلمة أقصر أو أزل التصفية. إذا كانت الخدمة غير مسجلة بعد، راجع صفحة الجهة أو أرسل مقترحاً.</p>
                <Link href="/citizen/feedback" className="gov-btn outline">
                  اقترح إضافة خدمة
                </Link>
              </div>
            )}

            <ul className="gov-service-cards">
              {results.slice(0, visible).map((item, index) => {
                const Icon = channelMeta[item.channel].icon
                const requiredCount = item.requiredDocuments.filter(doc => doc.required).length
                return (
                  <li
                    key={item.key}
                    className={`gov-service-card channel-${item.channel.toLowerCase()}`}
                    style={{ '--i': index } as React.CSSProperties}
                  >
                    <div className="gov-service-card-top">
                      <span className={`gov-chip channel-${item.channel.toLowerCase()}`}>
                        <Icon size={13} /> {channelMeta[item.channel].short}
                      </span>
                      {item.sourceQuality === 'OFFICIAL' && <span className="gov-chip official">مصدر رسمي</span>}
                      {item.sourceQuality === 'UNVERIFIED' && <span className="gov-chip muted">بانتظار تأكيد الدائرة</span>}
                    </div>
                    <h3>
                      <Link href={`/service/${item.key}`}>{item.title}</Link>
                    </h3>
                    <p>{item.description}</p>
                    <dl>
                      <div>
                        <dt>الجهة</dt>
                        <dd>
                          <Link href={`/departments/${item.departmentId}`}>{item.departmentName}</Link>
                        </dd>
                      </div>
                      <div>
                        <dt>المستمسكات</dt>
                        <dd>
                          {requiredCount ? `${requiredCount.toLocaleString('en-US')} مطلوبة` : 'لا تحتاج مستمسكات'}
                        </dd>
                      </div>
                      {item.feeStatus === 'OFFICIAL' && item.feeIqd ? (
                        <div>
                          <dt>الرسوم</dt>
                          <dd>{item.feeIqd.toLocaleString('en-US')} د.ع</dd>
                        </div>
                      ) : null}
                      {item.estimatedDuration && (
                        <div>
                          <dt>المدة</dt>
                          <dd>{item.estimatedDuration}</dd>
                        </div>
                      )}
                    </dl>
                    <footer>
                      <Link href={`/service/${item.key}`} className="gov-btn primary small">
                        {item.channel === 'INFORMATION_ONLY' ? 'التفاصيل' : 'ابدأ الطلب'} <ArrowLeft size={14} />
                      </Link>
                      {item.sourceUrl && (
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="gov-link" aria-label={`المصدر الرسمي: ${item.title}`}>
                          <ExternalLink size={14} /> المصدر
                        </a>
                      )}
                    </footer>
                  </li>
                )
              })}
            </ul>
            {results.length > visible && (
              <div className="gov-center">
                <button className="gov-btn outline" onClick={() => setVisible(value => value + 60)}>
                  عرض المزيد ({(results.length - visible).toLocaleString('en-US')} خدمة أخرى)
                </button>
              </div>
            )}
            <div className="gov-directory-note">
              <FileCheck2 />
              <span>
                الرسوم تُعرض فقط عندما تكون موثقة من مصدر رسمي. الخدمات المعلَّمة «بانتظار تأكيد الدائرة» جُمعت من مصادر عامة
                وستُحدَّث عند اعتماد الدائرة لها داخل المنصة.
              </span>
            </div>
          </div>
        </section>
        <section className="gov-container">
          <OfficialGovernmentServiceCatalog query={query} />
        </section>
      </main>
      <Footer />
    </div>
  )
}
