import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'wouter'
import { ArrowLeft, Gavel, Megaphone, Newspaper, Pause, Play, RefreshCw } from 'lucide-react'
import { api } from '../../api'
import type { NewsListResponse, NewsTickerResponse, TenderListResponse, TenderType } from '../../types'
import { relativeTime, TENDER_TYPE } from '../../lib/news-format'
import { useMotionPref } from './motion-pref'
import { NewsCard, NewsNoticeList, TenderCard } from '../news/NewsParts'

const REFRESH_MS = 15 * 60 * 1000

export type HomeNewsData = {
  ticker: NewsTickerResponse | null
  news: NewsListResponse | null
  tenders: TenderListResponse | null
  tenderNews: NewsListResponse | null
}

/** News, ticker and tenders for the home page; refreshed every 15 minutes while the tab is visible. */
export function useHomeNews(): HomeNewsData {
  const [data, setData] = useState<HomeNewsData>({ ticker: null, news: null, tenders: null, tenderNews: null })
  useEffect(() => {
    let alive = true
    const load = () => {
      // each part fails on its own: an empty list renders the section's calm empty state
      const empty = { total: 0, items: [], sources: [], updatedAt: null }
      Promise.all([
        api.getNewsTicker().catch(() => ({ updatedAt: null, items: [] })),
        api.getNews({ limit: 12, kind: 'NEWS' }).catch(() => empty),
        api.listTenders({ limit: 24 }).catch(() => ({
          total: 0,
          items: [],
          entities: [],
          counts: { OPEN: 0, CLOSED: 0, CANCELLED: 0, AWARDED: 0 },
        })),
        api.getNews({ limit: 5, kind: 'TENDER' }).catch(() => empty),
      ]).then(([ticker, news, tenders, tenderNews]) => {
        if (alive) setData({ ticker, news, tenders, tenderNews })
      })
    }
    load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, REFRESH_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])
  return data
}

/* ============================================================================================
   Ticker — latest headlines under the header. Scrolls toward the reading direction (RTL), pauses on
   hover/focus or with its button, and becomes a plain scrollable row when motion is paused or reduced.
   ============================================================================================ */
export function NewsTicker({ data }: { data: NewsTickerResponse | null }) {
  const { still } = useMotionPref()
  const [paused, setPaused] = useState(false)
  const items = data?.items ?? []
  const chars = items.reduce((sum, item) => sum + item.title.length + item.sourceName.length + 12, 0)
  if (!items.length) return null
  const moving = !still
  const list = (copy: boolean) => (
    <ul className="ld-ticker-list" aria-hidden={copy || undefined}>
      {items.map(item => (
        <li key={item.id}>
          <a href={item.link} target="_blank" rel="noopener noreferrer" tabIndex={copy ? -1 : undefined}>
            {item.kind === 'TENDER' && <Megaphone aria-hidden="true" />}
            <span className="ld-ticker-title">{item.title}</span>
            <small>
              {item.sourceName} · {relativeTime(item.publishedAt)}
            </small>
          </a>
        </li>
      ))}
    </ul>
  )
  return (
    <div
      className="ld-ticker"
      role="region"
      aria-label="شريط الأخبار"
      data-moving={moving ? 'on' : 'off'}
      data-paused={paused ? 'true' : undefined}
    >
      <span className="ld-ticker-label">
        <span className="ld-ticker-dot" aria-hidden="true" />
        آخر الأخبار
      </span>
      <div className="ld-ticker-viewport">
        <div
          className="ld-ticker-track"
          style={{ '--ld-ticker-dur': `${Math.max(40, Math.round(chars * 0.16))}s` } as CSSProperties}
        >
          {list(false)}
          {moving && list(true)}
        </div>
      </div>
      {moving && (
        <button
          type="button"
          className="ld-ticker-btn"
          onClick={() => setPaused(current => !current)}
          aria-pressed={paused}
          aria-label={paused ? 'تشغيل شريط الأخبار' : 'إيقاف شريط الأخبار'}
          title={paused ? 'تشغيل' : 'إيقاف'}
        >
          {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
        </button>
      )}
    </div>
  )
}

function SectionTop({
  id,
  kicker,
  title,
  lead,
  action,
}: {
  id: string
  kicker: string
  title: string
  lead: string
  action: { label: string; href: string }
}) {
  return (
    <div className="ld-sec-head" data-reveal>
      <div>
        <span className="ld-kicker">{kicker}</span>
        <h2 id={id}>{title}</h2>
        <p>{lead}</p>
      </div>
      <Link href={action.href} className="ld-more">
        {action.label} <ArrowLeft aria-hidden="true" />
      </Link>
    </div>
  )
}

/* ============================================================================================
   News — one featured story and the latest headlines, each linking to its publisher
   ============================================================================================ */
export function PortalNews({ data }: { data: NewsListResponse | null }) {
  const items = data?.items ?? []
  // lead with the newest story that has a photo (Google News items never carry one)
  const featured = items.slice(0, 8).find(item => item.imageUrl) ?? items[0]
  const rest = items.filter(item => item !== featured)
  return (
    <section className="ld-sec is-tint ld-news" id="news" aria-labelledby="ld-news-title">
      <div className="ld-wrap">
        <SectionTop
          id="ld-news-title"
          kicker="من المحافظة"
          title="أخبار ذي قار"
          lead="عناوين من وسائل الإعلام المحلية والوطنية عن المحافظة وأقضيتها، تُجمع كل ساعة. اضغط الخبر لقراءته كاملاً من مصدره."
          action={{ label: 'كل الأخبار', href: '/news' }}
        />
        {data?.updatedAt && (
          <p className="ld-news-updated">
            <RefreshCw aria-hidden="true" /> آخر تحديث {relativeTime(data.updatedAt)}
          </p>
        )}
        {!data ? (
          <div className="ld-news-grid" aria-busy="true" aria-label="جارٍ تحميل الأخبار">
            <div className="ld-skeleton nw-skel is-featured" />
            {[0, 1, 2, 3].map(index => (
              <div key={index} className="ld-skeleton nw-skel" />
            ))}
          </div>
        ) : featured ? (
          <div className="ld-news-grid">
            <NewsCard item={featured} featured eager />
            {rest.slice(0, 5).map(item => (
              <NewsCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="ld-news-empty" data-reveal>
            <Newspaper aria-hidden="true" />
            <div>
              <strong>لا توجد أخبار محدّثة في هذه اللحظة</strong>
              <p>تجمع المنصة أخبار ذي قار من مصادرها كل ساعة. عُد بعد قليل، أو تابع الأخبار على صفحة الأخبار.</p>
            </div>
            <Link href="/news" className="ld-more">
              صفحة الأخبار <ArrowLeft aria-hidden="true" />
            </Link>
          </div>
        )}
        {featured && (
          <p className="ld-news-note">
            الأخبار ملك ناشريها؛ تعرض المنصة العنوان ومقتطفاً قصيراً مع رابط المصدر، ولا تعني إعادة النشر تبنّي محتواها.
          </p>
        )}
      </div>
    </section>
  )
}

/* ============================================================================================
   Tenders & auctions — official announcements first, then unofficial ones spotted in the news
   ============================================================================================ */
export function PortalTenders({
  tenders,
  tenderNews,
}: {
  tenders: TenderListResponse | null
  tenderNews: NewsListResponse | null
}) {
  const [tab, setTab] = useState<TenderType>('TENDER')
  const all = tenders?.items ?? []
  const count = (type: TenderType) => all.filter(item => item.type === type && item.status === 'OPEN').length
  const shown = all.filter(item => item.type === tab).slice(0, 6)
  const notices = tenderNews?.items ?? []
  return (
    <section className="ld-sec ld-tenders" id="tenders" aria-labelledby="ld-tenders-title">
      <div className="ld-wrap">
        <SectionTop
          id="ld-tenders-title"
          kicker="للشركات والمقاولين"
          title="المناقصات والمزادات"
          lead="ما تعلنه دوائر محافظة ذي قار من مناقصات ومزايدات، بمواعيد الغلق والكلف التخمينية وروابط الوثائق."
          action={{ label: 'كل المناقصات', href: '/tenders' }}
        />
        <div className="ld-tender-tabs" role="tablist" aria-label="نوع الإعلان">
          {(['TENDER', 'AUCTION'] as TenderType[]).map(type => (
            <button
              key={type}
              type="button"
              role="tab"
              id={`ld-tab-${type}`}
              aria-selected={tab === type}
              aria-controls="ld-tender-panel"
              onClick={() => setTab(type)}
            >
              {type === 'AUCTION' ? <Gavel aria-hidden="true" /> : <Megaphone aria-hidden="true" />}
              {TENDER_TYPE[type].plural}
              {tenders && <b>{count(type).toLocaleString('en-US')}</b>}
            </button>
          ))}
        </div>
        <div id="ld-tender-panel" role="tabpanel" aria-labelledby={`ld-tab-${tab}`}>
          {!tenders ? (
            <div className="ld-tender-grid" aria-busy="true">
              {[0, 1, 2].map(index => (
                <div key={index} className="ld-skeleton" />
              ))}
            </div>
          ) : shown.length ? (
            <div className="ld-tender-grid">
              {shown.map(item => (
                <TenderCard key={item.id} tender={item} />
              ))}
            </div>
          ) : (
            <div className="ld-news-empty is-tender">
              {tab === 'AUCTION' ? <Gavel aria-hidden="true" /> : <Megaphone aria-hidden="true" />}
              <div>
                <strong>{tab === 'AUCTION' ? 'لا توجد مزايدات منشورة حالياً' : 'لا توجد مناقصات منشورة حالياً'}</strong>
                <p>تُنشر الإعلانات الرسمية هنا فور إدخالها من الدائرة المعنية.</p>
              </div>
            </div>
          )}
        </div>
        {notices.length > 0 && (
          <div className="ld-tender-news">
            <h3>
              إعلانات من الأخبار <small>تجميع غير رسمي — راجع المصدر والدائرة المعنية قبل التقديم</small>
            </h3>
            <NewsNoticeList items={notices} />
          </div>
        )}
      </div>
    </section>
  )
}
