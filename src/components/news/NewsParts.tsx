import { useState } from 'react'
import { Link } from 'wouter'
import { Banknote, Building2, CalendarClock, ExternalLink, Gavel, Hash, MapPin, Megaphone } from 'lucide-react'
import type { NewsItem, Tender } from '../../types'
import {
  closingLabel,
  formatDate,
  formatIqd,
  isClosingSoon,
  linkHost,
  relativeTime,
  TENDER_STATUS,
  TENDER_TYPE,
} from '../../lib/news-format'

/**
 * Shared pieces of the news and tenders surfaces (home page, /news, /tenders). Styles: styles/ds/news.css.
 * News cards always link out to the publisher: the platform shows a headline, a short excerpt and the source.
 */

/** Publisher photo, hot-linked without a referrer; falls back to a branded tile when missing or broken. */
export function NewsImage({ src, label, eager = false }: { src: string | null; label: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed)
    return (
      <span className="nw-img is-fallback" aria-hidden="true">
        <img src="/brand/dhiqar-unified-logo.png" alt="" width={56} height={56} />
        <small>{label}</small>
      </span>
    )
  return (
    <span className="nw-img">
      <img
        src={src}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </span>
  )
}

export function NewsMeta({ item }: { item: Pick<NewsItem, 'sourceName' | 'publishedAt' | 'link'> }) {
  const host = linkHost(item.link)
  return (
    <span className="nw-meta">
      <span className="nw-source" title={host || undefined}>
        {item.sourceName}
      </span>
      <span aria-hidden="true">·</span>
      <time dateTime={item.publishedAt} title={formatDate(item.publishedAt, true)}>
        {relativeTime(item.publishedAt)}
      </time>
      <ExternalLink className="nw-out" aria-hidden="true" />
    </span>
  )
}

export function NewsCard({
  item,
  featured = false,
  eager = false,
}: {
  item: NewsItem
  featured?: boolean
  eager?: boolean
}) {
  return (
    <article className={featured ? 'nw-card is-featured' : 'nw-card'}>
      <a href={item.link} target="_blank" rel="noopener noreferrer" className="nw-card-link">
        <NewsImage src={item.imageUrl} label={item.sourceName} eager={eager} />
        <span className="nw-card-body">
          {item.kind === 'TENDER' && (
            <span className="nw-tag">
              <Megaphone aria-hidden="true" /> إعلان
            </span>
          )}
          <h3 className="nw-title">{item.title}</h3>
          {item.excerpt && <span className="nw-excerpt">{item.excerpt}</span>}
          <NewsMeta item={item} />
        </span>
        <span className="sr-only"> (يفتح موقع المصدر في نافذة جديدة)</span>
      </a>
    </article>
  )
}

export function TenderStatusChip({ tender }: { tender: Pick<Tender, 'status' | 'closingAt'> }) {
  const meta = TENDER_STATUS[tender.status]
  const soon = tender.status === 'OPEN' && isClosingSoon(tender.closingAt)
  return <span className={`nw-status is-${soon ? 'soon' : meta.tone}`}>{soon ? 'يغلق قريباً' : meta.label}</span>
}

export function TenderCard({ tender }: { tender: Tender }) {
  const cost = formatIqd(tender.estimatedCostIqd)
  const TypeIcon = tender.type === 'AUCTION' ? Gavel : Megaphone
  return (
    <article className={`nw-tender is-${TENDER_STATUS[tender.status].tone}`}>
      <div className="nw-tender-top">
        <span className="nw-type">
          <TypeIcon aria-hidden="true" />
          {TENDER_TYPE[tender.type].label}
        </span>
        <TenderStatusChip tender={tender} />
      </div>
      <h3 className="nw-tender-title">
        <Link href={`/tenders/${tender.id}`}>{tender.title}</Link>
      </h3>
      <dl className="nw-tender-facts">
        <div>
          <dt>
            <Hash aria-hidden="true" />
            <span className="sr-only">الرقم</span>
          </dt>
          <dd dir="auto">{tender.reference}</dd>
        </div>
        <div>
          <dt>
            <Building2 aria-hidden="true" />
            <span className="sr-only">الجهة</span>
          </dt>
          <dd>
            {tender.entityName}
            {tender.district ? <small> · {tender.district}</small> : null}
          </dd>
        </div>
        {cost && (
          <div>
            <dt>
              <Banknote aria-hidden="true" />
              <span className="sr-only">الكلفة التخمينية</span>
            </dt>
            <dd>{cost}</dd>
          </div>
        )}
      </dl>
      <p className="nw-tender-close">
        <CalendarClock aria-hidden="true" />
        <span>
          <strong>
            {tender.status === 'OPEN' ? closingLabel(tender.closingAt) : TENDER_STATUS[tender.status].label}
          </strong>
          <small>الغلق: {formatDate(tender.closingAt, true)}</small>
        </span>
      </p>
    </article>
  )
}

/** Tender announcements spotted in the news: unofficial, always with the publisher link. */
export function NewsNoticeList({ items }: { items: NewsItem[] }) {
  return (
    <ul className="nw-notices">
      {items.map(item => (
        <li key={item.id}>
          <a href={item.link} target="_blank" rel="noopener noreferrer">
            <span className="nw-notice-title">{item.title}</span>
            <NewsMeta item={item} />
          </a>
        </li>
      ))}
    </ul>
  )
}

export function DistrictLine({ district }: { district: string | null }) {
  if (!district) return null
  return (
    <span className="nw-district">
      <MapPin aria-hidden="true" /> {district}
    </span>
  )
}
