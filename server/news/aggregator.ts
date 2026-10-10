import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { db } from '../db.js'
import { extractOgImage, parseFeed, type FeedItem } from './rss.js'
import { NEWS_SOURCES, type NewsSource } from './sources.js'
import { classifyKind, makeExcerpt, mentionsDhiQar, normalizeArabic, stripHtml, titleKey } from './text.js'

/**
 * Hourly Dhi Qar news: reads public RSS feeds, keeps the items that name a place in the governorate, and stores
 * headline + short excerpt + image URL + publisher link. A failing source never blocks the others.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS news_items (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_name TEXT NOT NULL,
    title TEXT NOT NULL,
    title_key TEXT NOT NULL,
    link TEXT NOT NULL UNIQUE,
    excerpt TEXT NOT NULL DEFAULT '',
    image_url TEXT,
    og_checked INTEGER NOT NULL DEFAULT 0,
    published_at TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'NEWS',
    hidden INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_news_items_published ON news_items(published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_news_items_title_key ON news_items(title_key);
  CREATE TABLE IF NOT EXISTS news_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`)

export const NEWS_RETENTION_DAYS = 14
export const NEWS_MAX_ROWS = 400
export const NEWS_INTERVAL_MS = 60 * 60 * 1000
const SOURCE_TIMEOUT_MS = 10_000
const OG_TIMEOUT_MS = 6_000
const OG_MAX_PER_RUN = 8
const MAX_FEED_BYTES = 4 * 1024 * 1024
const USER_AGENT = 'Mozilla/5.0 (compatible; ThiQarDigitalNews/1.0; +https://thi-qar.com)'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>
let fetchImpl: FetchLike = (url, init) => fetch(url, init)

/** Tests (and only tests) replace the network. */
export function setNewsFetch(fn: FetchLike) {
  fetchImpl = fn
}

export type NewsKind = 'NEWS' | 'TENDER'
export type NewsItem = {
  id: string
  source: string
  sourceName: string
  title: string
  link: string
  excerpt: string
  imageUrl: string | null
  publishedAt: string
  kind: NewsKind
}
export type AdminNewsItem = NewsItem & { hidden: boolean; fetchedAt: string }

export type SourceResult = {
  id: string
  name: string
  ok: boolean
  parsed: number
  kept: number
  added: number
  error?: string
}
export type NewsRunSummary = {
  startedAt: string
  finishedAt: string
  durationMs: number
  added: number
  total: number
  images: number
  sources: SourceResult[]
}

async function fetchText(url: string, timeoutMs: number, accept: string) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
    headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'ar,en;q=0.5' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = await response.text()
  return text.length > MAX_FEED_BYTES ? text.slice(0, MAX_FEED_BYTES) : text
}

const idFor = (link: string) => `nws_${createHash('sha256').update(link).digest('hex').slice(0, 20)}`

/** Google News titles end with « - Publisher»; the publisher is shown separately. */
function cleanTitle(title: string, sourceName: string | null) {
  const text = stripHtml(title)
  if (sourceName) {
    const suffix = ` - ${sourceName}`
    if (text.endsWith(suffix)) return text.slice(0, -suffix.length).trim()
  }
  return text
}

function excerptFor(item: FeedItem, title: string, source: NewsSource) {
  // Google's description is just the linked title and the publisher again
  if (source.wrappedLinks) return ''
  const excerpt = makeExcerpt(item.description, 180)
  const plain = normalizeArabic(excerpt).replace(/[^\p{L}\p{N}]+/gu, '')
  const head = normalizeArabic(title).replace(/[^\p{L}\p{N}]+/gu, '')
  return !plain || plain === head || head.startsWith(plain) ? '' : excerpt
}

export function isRelevant(item: Pick<FeedItem, 'title' | 'description'>, source: Pick<NewsSource, 'mode'>) {
  if (source.mode === 'local') return true
  if (source.mode === 'query') return mentionsDhiQar(item.title)
  return mentionsDhiQar(item.title) || mentionsDhiQar(item.description)
}

/** Stores one source's items. Returns how many were relevant and how many were new. */
export function storeFeedItems(source: NewsSource, items: FeedItem[], now = new Date()) {
  const fetchedAt = now.toISOString()
  const oldest = now.getTime() - NEWS_RETENTION_DAYS * 86_400_000
  const insert = db.prepare(
    `INSERT OR IGNORE INTO news_items (id, source, source_name, title, title_key, link, excerpt, image_url, published_at, fetched_at, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const sameTitle = db.prepare(`SELECT 1 FROM news_items WHERE title_key = ? LIMIT 1`)
  let kept = 0
  let added = 0
  for (const item of items) {
    // judge the headline without « - Publisher» (e.g. «شبكة أخبار الناصرية» would always match)
    const title = cleanTitle(item.title, item.sourceName)
    if (!isRelevant({ title, description: item.description }, source)) continue
    const key = titleKey(title)
    if (key.length < 8) continue
    let published = item.publishedAt ? Date.parse(item.publishedAt) : now.getTime()
    if (!Number.isFinite(published) || published > now.getTime() + 60 * 60 * 1000) published = now.getTime()
    if (published < oldest) continue
    kept++
    if (sameTitle.get(key)) continue
    const result = insert.run(
      idFor(item.link),
      source.id,
      (item.sourceName || source.name).slice(0, 80),
      title.slice(0, 300),
      key,
      item.link,
      excerptFor(item, title, source),
      item.imageUrl,
      new Date(published).toISOString(),
      fetchedAt,
      classifyKind(title)
    )
    if (result.changes) added++
  }
  return { kept, added }
}

/** Never ask an internal address for a page (links come from third-party feeds). */
function publicHttpsUrl(link: string) {
  try {
    const url = new URL(link)
    if (url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    if (!host.includes('.') || isIP(host.replace(/^\[|\]$/g, '')) || host === 'localhost' || host.endsWith('.local'))
      return null
    if (/(^|\.)(localhost|internal|lan|home|corp)$/.test(host)) return null
    return url.toString()
  } catch {
    return null
  }
}

/** Fills missing images from the article's og:image (non-wrapped links only, a few per run). */
async function enrichImages() {
  const wrapped = NEWS_SOURCES.filter(source => source.wrappedLinks).map(source => source.id)
  const rows = db
    .prepare(
      `SELECT id, link FROM news_items WHERE image_url IS NULL AND og_checked = 0 AND hidden = 0
       ${wrapped.length ? `AND source NOT IN (${wrapped.map(() => '?').join(',')})` : ''}
       ORDER BY published_at DESC LIMIT ?`
    )
    .all(...wrapped, OG_MAX_PER_RUN) as Array<{ id: string; link: string }>
  let found = 0
  await Promise.allSettled(
    rows.map(async row => {
      let image: string | null = null
      const url = publicHttpsUrl(row.link)
      if (url) {
        try {
          image = extractOgImage(await fetchText(url, OG_TIMEOUT_MS, 'text/html'))
        } catch {
          image = null
        }
      }
      db.prepare(`UPDATE news_items SET og_checked = 1, image_url = COALESCE(image_url, ?) WHERE id = ?`).run(
        image,
        row.id
      )
      if (image) found++
    })
  )
  return found
}

export function applyRetention(now = new Date()) {
  const cutoff = new Date(now.getTime() - NEWS_RETENTION_DAYS * 86_400_000).toISOString()
  db.prepare(`DELETE FROM news_items WHERE published_at < ?`).run(cutoff)
  db.prepare(
    `DELETE FROM news_items WHERE id IN (SELECT id FROM news_items ORDER BY published_at DESC LIMIT -1 OFFSET ?)`
  ).run(NEWS_MAX_ROWS)
}

const setMeta = (key: string, value: unknown) =>
  db
    .prepare(`INSERT INTO news_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, JSON.stringify(value))
const getMeta = <T>(key: string): T | null => {
  const row = db.prepare(`SELECT value FROM news_meta WHERE key = ?`).get(key) as { value: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value) as T
  } catch {
    return null
  }
}

let running: Promise<NewsRunSummary> | null = null

/** One fetch of every source. Concurrent callers share the run in progress. */
export function refreshNews(options: { sources?: NewsSource[]; now?: () => Date; log?: (line: string) => void } = {}) {
  if (running) return running
  running = runOnce(options).finally(() => {
    running = null
  })
  return running
}

async function runOnce({
  sources = NEWS_SOURCES,
  now = () => new Date(),
  log = (line: string) => console.log(line),
}: {
  sources?: NewsSource[]
  now?: () => Date
  log?: (line: string) => void
}): Promise<NewsRunSummary> {
  const started = now()
  // fetch in parallel, store in a fixed order: publishers' own feeds (direct links, images) before the
  // Google News copies of the same stories, so the de-duplication keeps the richer version
  const fetched = await Promise.all(
    sources.map(async source => {
      try {
        const xml = await fetchText(source.url, SOURCE_TIMEOUT_MS, 'application/rss+xml, application/xml, text/xml')
        return { source, items: parseFeed(xml), error: null }
      } catch (error) {
        const message =
          error instanceof Error ? (error.name === 'TimeoutError' ? 'timeout' : error.message) : String(error)
        return { source, items: [] as FeedItem[], error: message.slice(0, 120) }
      }
    })
  )
  const storeOrder = [...fetched].sort(
    (a, b) => Number(a.source.wrappedLinks ?? 0) - Number(b.source.wrappedLinks ?? 0)
  )
  const stored = new Map<string, SourceResult>()
  for (const { source, items, error } of storeOrder) {
    if (error) {
      stored.set(source.id, { id: source.id, name: source.name, ok: false, parsed: 0, kept: 0, added: 0, error })
      continue
    }
    try {
      const { kept, added } = storeFeedItems(source, items, now())
      stored.set(source.id, { id: source.id, name: source.name, ok: true, parsed: items.length, kept, added })
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure)
      stored.set(source.id, {
        id: source.id,
        name: source.name,
        ok: false,
        parsed: items.length,
        kept: 0,
        added: 0,
        error: message.slice(0, 120),
      })
    }
  }
  const results = sources.map(source => stored.get(source.id)!)
  let images = 0
  try {
    images = await enrichImages()
  } catch {
    images = 0
  }
  applyRetention(now())
  const finished = now()
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM news_items`).get() as { n: number }).n
  const summary: NewsRunSummary = {
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    added: results.reduce((sum, item) => sum + item.added, 0),
    total,
    images,
    sources: results,
  }
  setMeta('lastRun', summary)
  if (results.some(item => item.ok)) setMeta('lastSuccessAt', summary.finishedAt)
  log(
    `[news] ${results
      .map(item =>
        item.ok ? `${item.id} ${item.kept}/${item.parsed} +${item.added}` : `${item.id} failed (${item.error})`
      )
      .join(
        ', '
      )} · ${summary.added} new, ${images} images, ${total} stored (${(summary.durationMs / 1000).toFixed(1)}s)`
  )
  return summary
}

/** Boot fetch shortly after the server starts, then hourly. Timers never keep the process alive. */
export function startNewsScheduler(log: (line: string) => void = line => console.log(line)) {
  const run = () => {
    refreshNews({ log }).catch(error => console.error('[news] run failed', error))
  }
  const boot = setTimeout(run, 4_000)
  boot.unref()
  const timer = setInterval(run, NEWS_INTERVAL_MS)
  timer.unref()
  return () => {
    clearTimeout(boot)
    clearInterval(timer)
  }
}

// ---- reads -------------------------------------------------------------------------------------

type Row = Record<string, unknown>
const mapItem = (row: Row): NewsItem => ({
  id: String(row.id),
  source: String(row.source),
  sourceName: String(row.source_name),
  title: String(row.title),
  link: String(row.link),
  excerpt: String(row.excerpt || ''),
  imageUrl: row.image_url ? String(row.image_url) : null,
  publishedAt: String(row.published_at),
  kind: String(row.kind) === 'TENDER' ? 'TENDER' : 'NEWS',
})

export function listNews(
  options: {
    limit?: number
    offset?: number
    kind?: NewsKind
    source?: string
    q?: string
    includeHidden?: boolean
  } = {}
) {
  const where: string[] = []
  const params: Array<string | number> = []
  if (!options.includeHidden) where.push('hidden = 0')
  if (options.kind) {
    where.push('kind = ?')
    params.push(options.kind)
  }
  if (options.source) {
    where.push('source_name = ?')
    params.push(options.source)
  }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  let rows = db.prepare(`SELECT * FROM news_items ${sql} ORDER BY published_at DESC`).all(...params) as Row[]
  const term = options.q ? normalizeArabic(options.q.trim()) : ''
  if (term) rows = rows.filter(row => normalizeArabic(`${row.title} ${row.excerpt} ${row.source_name}`).includes(term))
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)
  const offset = Math.max(options.offset ?? 0, 0)
  return {
    total: rows.length,
    items: rows
      .slice(offset, offset + limit)
      .map(row =>
        options.includeHidden
          ? ({ ...mapItem(row), hidden: Boolean(row.hidden), fetchedAt: String(row.fetched_at) } as AdminNewsItem)
          : mapItem(row)
      ),
  }
}

export function newsSourceCounts() {
  return (
    db
      .prepare(
        `SELECT source_name AS name, COUNT(*) AS count FROM news_items WHERE hidden = 0 GROUP BY source_name ORDER BY count DESC, name`
      )
      .all() as Array<{ name: string; count: number }>
  ).map(row => ({ name: String(row.name), count: Number(row.count) }))
}

export function newsStatus() {
  return {
    lastRun: getMeta<NewsRunSummary>('lastRun'),
    updatedAt: getMeta<string>('lastSuccessAt'),
  }
}

export function getNewsItem(id: string) {
  const row = db.prepare(`SELECT * FROM news_items WHERE id = ?`).get(id) as Row | undefined
  return row ? { ...mapItem(row), hidden: Boolean(row.hidden), fetchedAt: String(row.fetched_at) } : null
}

export function setNewsHidden(id: string, hidden: boolean) {
  const result = db.prepare(`UPDATE news_items SET hidden = ? WHERE id = ?`).run(hidden ? 1 : 0, id)
  return result.changes > 0 ? getNewsItem(id) : null
}
