import { useEffect, useState } from 'react'
import { Newspaper, RefreshCw, Search } from 'lucide-react'
import { api } from '../../api'
import type { NewsItem, NewsKind, NewsListResponse } from '../../types'
import { PublicHeader } from '../../components/public/PublicHeader'
import { Footer } from '../../components/public/Footer'
import { EmptyState, LoadingBlock, PageHeader } from '../../components/public/PageHeader'
import { NewsCard } from '../../components/news/NewsParts'
import { relativeTime } from '../../lib/news-format'

const PAGE = 18

/** All aggregated Dhi Qar news: search, filter by publisher or kind, and load more. */
export function NewsPage() {
  const [query, setQuery] = useState('')
  const [term, setTerm] = useState('')
  const [source, setSource] = useState('')
  const [kind, setKind] = useState<NewsKind | ''>('')
  const [data, setData] = useState<NewsListResponse | null>(null)
  const [items, setItems] = useState<NewsItem[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  // typing settles for a moment before the list reloads
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let alive = true
    api
      .getNews({ limit: PAGE, q: term || undefined, source: source || undefined, kind: kind || undefined })
      .then(result => {
        if (!alive) return
        setError('')
        setData(result)
        setItems(result.items)
      })
      .catch(err => alive && setError((err as Error).message))
    return () => {
      alive = false
    }
  }, [term, source, kind])

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const result = await api.getNews({
        limit: PAGE,
        offset: items.length,
        q: term || undefined,
        source: source || undefined,
        kind: kind || undefined,
      })
      setItems(current => [...current, ...result.items.filter(item => !current.some(old => old.id === item.id))])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }

  const filtered = Boolean(term || source || kind)

  return (
    <div className="tq-page nwp">
      <PublicHeader />
      <main id="main-content">
        <PageHeader
          crumbs={[{ label: 'أخبار ذي قار' }]}
          kicker={
            <>
              <Newspaper size={15} /> من المحافظة
            </>
          }
          title="أخبار ذي قار"
          description="عناوين من وسائل الإعلام المحلية والوطنية عن المحافظة وأقضيتها ونواحيها، تُجمع تلقائياً كل ساعة. كل خبر يفتح من موقع ناشره."
          meta={
            data?.updatedAt ? (
              <span>
                <RefreshCw size={14} aria-hidden="true" /> آخر تحديث {relativeTime(data.updatedAt)}
              </span>
            ) : undefined
          }
        >
          <div className="depts-toolbar nwp-toolbar">
            <label className="depts-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="ابحث في العناوين، مثلاً: الشطرة أو الكهرباء"
                aria-label="بحث في الأخبار"
              />
            </label>
            <label className="tq-field">
              <span className="sr-only">المصدر</span>
              <select value={source} onChange={event => setSource(event.target.value)} aria-label="المصدر">
                <option value="">كل المصادر</option>
                {data?.sources.map(item => (
                  <option key={item.name} value={item.name}>
                    {item.name} ({item.count.toLocaleString('en-US')})
                  </option>
                ))}
              </select>
            </label>
            <label className="tq-field">
              <span className="sr-only">النوع</span>
              <select value={kind} onChange={event => setKind(event.target.value as NewsKind | '')} aria-label="النوع">
                <option value="">الأخبار والإعلانات</option>
                <option value="NEWS">الأخبار فقط</option>
                <option value="TENDER">إعلانات المناقصات والمزادات</option>
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
            {!data && !error ? (
              <LoadingBlock label="جارٍ تحميل الأخبار…" />
            ) : items.length ? (
              <>
                <div className="dir-results-head">
                  <div>
                    <h2 aria-live="polite">{(data?.total ?? items.length).toLocaleString('en-US')} خبر</h2>
                    <p>آخر 14 يوماً{filtered ? ' · حسب التصفية' : ''}</p>
                  </div>
                </div>
                <div className="nwp-grid">
                  {items.map((item, index) => (
                    <NewsCard key={item.id} item={item} eager={index < 3} />
                  ))}
                </div>
                {data && items.length < data.total && (
                  <div className="nwp-more">
                    <button type="button" className="button outline" onClick={() => void loadMore()} disabled={loadingMore}>
                      {loadingMore ? 'جارٍ التحميل…' : 'عرض المزيد'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <EmptyState
                icon={<Newspaper />}
                title={filtered ? 'لا توجد أخبار مطابقة' : 'لا توجد أخبار محدّثة الآن'}
                text={
                  filtered
                    ? 'جرّب كلمة أخرى أو أزل التصفية.'
                    : 'تجمع المنصة الأخبار من مصادرها كل ساعة؛ عُد بعد قليل.'
                }
              />
            )}
            <p className="nwp-note">
              المصادر: شفق نيوز، وكالة الأنباء العراقية، موقع محافظة ذي قار، وما تفهرسه أخبار Google من وسائل الإعلام. الأخبار
              ملك ناشريها؛ تعرض المنصة العنوان ومقتطفاً قصيراً مع رابط المصدر، ولا تعني إعادة النشر تبنّي محتواها.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
