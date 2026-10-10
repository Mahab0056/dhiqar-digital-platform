import { useEffect, useState } from 'react'
import { Gavel, Megaphone, Search } from 'lucide-react'
import { api } from '../../api'
import type { NewsListResponse, TenderListResponse, TenderStatus, TenderType } from '../../types'
import { PublicHeader } from '../../components/public/PublicHeader'
import { Footer } from '../../components/public/Footer'
import { EmptyState, LoadingBlock, PageHeader } from '../../components/public/PageHeader'
import { NewsNoticeList, TenderCard } from '../../components/news/NewsParts'
import { TENDER_STATUS } from '../../lib/news-format'

const STATUSES: Array<{ value: TenderStatus | ''; label: string }> = [
  { value: 'OPEN', label: 'المفتوحة' },
  { value: '', label: 'الكل' },
  { value: 'CLOSED', label: TENDER_STATUS.CLOSED.label },
  { value: 'AWARDED', label: TENDER_STATUS.AWARDED.label },
  { value: 'CANCELLED', label: TENDER_STATUS.CANCELLED.label },
]

/** Official tenders and auctions with filters, then tender announcements spotted in the news (unofficial). */
export function TendersPage() {
  const [initial] = useState(() => new URLSearchParams(window.location.search))
  const [query, setQuery] = useState(() => initial.get('q') || '')
  const [term, setTerm] = useState(() => initial.get('q') || '')
  const [status, setStatus] = useState<TenderStatus | ''>(() => (initial.get('status') as TenderStatus) ?? 'OPEN')
  const [type, setType] = useState<TenderType | ''>(() => (initial.get('type') as TenderType) || '')
  const [entity, setEntity] = useState(() => initial.get('department') || '')
  const [data, setData] = useState<TenderListResponse | null>(null)
  const [notices, setNotices] = useState<NewsListResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let alive = true
    api
      .listTenders({
        status: status || undefined,
        type: type || undefined,
        department: entity || undefined,
        q: term || undefined,
        limit: 100,
      })
      .then(result => {
        if (!alive) return
        setError('')
        setData(result)
      })
      .catch(err => alive && setError((err as Error).message))
    return () => {
      alive = false
    }
  }, [status, type, entity, term])

  useEffect(() => {
    api
      .getNews({ kind: 'TENDER', limit: 12 })
      .then(setNotices)
      .catch(() => setNotices(null))
  }, [])

  const openCount = data?.counts.OPEN ?? null

  return (
    <div className="tq-page nwp">
      <PublicHeader />
      <main id="main-content">
        <PageHeader
          crumbs={[{ label: 'المناقصات والمزادات' }]}
          kicker={
            <>
              <Megaphone size={15} /> للشركات والمقاولين
            </>
          }
          title="المناقصات والمزادات في ذي قار"
          description="الإعلانات الرسمية لدوائر المحافظة: رقم الإعلان، الجهة، موعد الغلق، الكلفة التخمينية ووثائق المناقصة. يُحسب الإغلاق تلقائياً عند حلول موعده."
          aside={
            <dl className="tq-figures">
              <div>
                <dt>مفتوحة الآن</dt>
                <dd>{openCount ?? '—'}</dd>
              </div>
              <div>
                <dt>جهة معلنة</dt>
                <dd>{data?.entities.length ?? '—'}</dd>
              </div>
            </dl>
          }
        >
          <div className="depts-toolbar nwp-toolbar">
            <label className="depts-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="ابحث برقم الإعلان أو العنوان أو الجهة"
                aria-label="بحث في المناقصات"
              />
            </label>
            <label className="tq-field">
              <span className="sr-only">النوع</span>
              <select value={type} onChange={event => setType(event.target.value as TenderType | '')} aria-label="النوع">
                <option value="">المناقصات والمزايدات</option>
                <option value="TENDER">المناقصات</option>
                <option value="AUCTION">المزايدات والمزادات</option>
              </select>
            </label>
            <label className="tq-field">
              <span className="sr-only">الجهة</span>
              <select value={entity} onChange={event => setEntity(event.target.value)} aria-label="الجهة">
                <option value="">كل الجهات</option>
                {data?.entities
                  .filter(item => item.id)
                  .map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="tq-chips nwp-chips" role="group" aria-label="الحالة">
            {STATUSES.map(item => (
              <button
                key={item.label}
                type="button"
                className="tq-chip"
                aria-pressed={status === item.value}
                onClick={() => setStatus(item.value)}
              >
                {item.label}
                {data && item.value && <b>{data.counts[item.value].toLocaleString('en-US')}</b>}
              </button>
            ))}
          </div>
        </PageHeader>

        <section className="tq-content">
          <div className="tq-container tq-stack">
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            {!data && !error ? (
              <LoadingBlock label="جارٍ تحميل الإعلانات…" />
            ) : data?.items.length ? (
              <>
                <div className="dir-results-head">
                  <div>
                    <h2 aria-live="polite">{data.total.toLocaleString('en-US')} إعلان</h2>
                    <p>المفتوحة أولاً حسب أقرب موعد غلق</p>
                  </div>
                </div>
                <div className="nwp-grid">
                  {data.items.map(item => (
                    <TenderCard key={item.id} tender={item} />
                  ))}
                </div>
              </>
            ) : (
              <EmptyState
                icon={type === 'AUCTION' ? <Gavel /> : <Megaphone />}
                title={status === 'OPEN' && !term && !entity ? 'لا توجد مناقصات منشورة حالياً' : 'لا توجد إعلانات مطابقة'}
                text={
                  status === 'OPEN'
                    ? 'تظهر الإعلانات الرسمية هنا فور نشرها من الدائرة المعنية. اعرض «الكل» لرؤية الإعلانات المغلقة.'
                    : 'غيّر التصفية أو كلمة البحث.'
                }
              />
            )}

            {Boolean(notices?.items.length) && (
              <div className="nwp-box">
                <h2 className="nwp-section-title">
                  إعلانات من الأخبار <small>تجميع غير رسمي — تحقق من المصدر والدائرة المعنية قبل التقديم</small>
                </h2>
                <NewsNoticeList items={notices!.items} />
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
