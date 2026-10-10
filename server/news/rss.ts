import { decodeEntities, httpsUrl, stripHtml, webUrl } from './text.js'

/**
 * A small, dependency-free RSS 2.0 / Atom reader. Feeds are untrusted input: nothing here evaluates markup,
 * every field is optional, and a malformed item is skipped instead of failing the feed.
 */
export type FeedItem = {
  title: string
  link: string
  /** raw description/summary (may contain HTML) */
  description: string
  publishedAt: string | null
  /** publisher named by the feed item (Google News <source>), if any */
  sourceName: string | null
  imageUrl: string | null
}

const escapeName = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Inner text of a CDATA section or an entity-encoded text node. */
function textOf(raw: string) {
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/)
  if (cdata) return cdata[1]
  // mixed CDATA chunks
  if (raw.includes('<![CDATA[')) return raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  return decodeEntities(raw)
}

/** First <name ...>content</name> (or self-closing) in the block. */
function element(block: string, name: string) {
  const pattern = new RegExp(`<${escapeName(name)}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${escapeName(name)}\\s*>)`, 'i')
  const match = block.match(pattern)
  if (!match) return null
  return { attrs: parseAttributes(match[1] || ''), inner: match[2] ?? '' }
}

function elements(block: string, name: string) {
  const pattern = new RegExp(`<${escapeName(name)}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${escapeName(name)}\\s*>)`, 'gi')
  const found: Array<{ attrs: Record<string, string>; inner: string }> = []
  for (const match of block.matchAll(pattern))
    found.push({ attrs: parseAttributes(match[1] || ''), inner: match[2] ?? '' })
  return found
}

function parseAttributes(raw: string) {
  const attrs: Record<string, string> = {}
  for (const match of raw.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? '')
  return attrs
}

const IMAGE_EXT = /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i
const looksLikeImage = (attrs: Record<string, string>) =>
  (attrs.type || '').toLowerCase().startsWith('image/') ||
  (attrs.medium || '').toLowerCase() === 'image' ||
  IMAGE_EXT.test(attrs.url || '')

function firstImgSrc(html: string) {
  const decoded = html.includes('&lt;') ? decodeEntities(html) : html
  const match = decoded.match(/<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i)
  return match ? httpsUrl(match[1] ?? match[2]) : null
}

function imageOf(block: string, description: string, content: string) {
  for (const name of ['enclosure', 'media:content', 'media:thumbnail']) {
    for (const entry of elements(block, name)) {
      const url = httpsUrl(entry.attrs.url)
      if (url && (name === 'media:thumbnail' || looksLikeImage(entry.attrs))) return url
    }
  }
  // <media:group><media:content …/></media:group> is covered above; then images inside the HTML
  return firstImgSrc(content) || firstImgSrc(description)
}

function dateOf(value: string | null | undefined) {
  if (!value) return null
  const time = Date.parse(stripHtml(value))
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function parseRssItem(block: string): FeedItem | null {
  const title = stripHtml(textOf(element(block, 'title')?.inner ?? ''))
  const linkRaw = textOf(element(block, 'link')?.inner ?? '').trim()
  const guid = element(block, 'guid')
  const link =
    webUrl(linkRaw) ||
    (guid && guid.attrs.ispermalink !== 'false' ? webUrl(textOf(guid.inner).trim()) : null) ||
    webUrl(element(block, 'feedburner:origLink')?.inner)
  if (!title || !link) return null
  const description = textOf(element(block, 'description')?.inner ?? '')
  const content = textOf(element(block, 'content:encoded')?.inner ?? '')
  const source = element(block, 'source')
  return {
    title,
    link,
    description,
    publishedAt: dateOf(
      element(block, 'pubDate')?.inner ?? element(block, 'dc:date')?.inner ?? element(block, 'published')?.inner
    ),
    sourceName: source ? stripHtml(textOf(source.inner)) || null : null,
    imageUrl: imageOf(block, description, content),
  }
}

function parseAtomEntry(block: string): FeedItem | null {
  const title = stripHtml(textOf(element(block, 'title')?.inner ?? ''))
  const links = elements(block, 'link')
  const alternate = links.find(item => !item.attrs.rel || item.attrs.rel === 'alternate') || links[0]
  const link = webUrl(alternate?.attrs.href)
  if (!title || !link) return null
  const description = textOf(element(block, 'summary')?.inner ?? '')
  const content = textOf(element(block, 'content')?.inner ?? '')
  const enclosure = links.find(
    item => item.attrs.rel === 'enclosure' && looksLikeImage({ ...item.attrs, url: item.attrs.href })
  )
  return {
    title,
    link,
    description: description || content,
    publishedAt: dateOf(element(block, 'published')?.inner ?? element(block, 'updated')?.inner),
    sourceName: null,
    imageUrl: httpsUrl(enclosure?.attrs.href) || imageOf(block, description, content),
  }
}

/** Parses an RSS 2.0 or Atom document. Returns [] for anything that is not a feed. */
export function parseFeed(xml: string): FeedItem[] {
  if (typeof xml !== 'string' || !xml) return []
  // comments may hide fake items
  const source = xml.replace(/<!--[\s\S]*?-->/g, '')
  const items: FeedItem[] = []
  const rssBlocks = source.match(/<item\b[^>]*>[\s\S]*?<\/item\s*>/gi) || []
  for (const block of rssBlocks) {
    try {
      const item = parseRssItem(block)
      if (item) items.push(item)
    } catch {
      /* a malformed item never fails the feed */
    }
  }
  if (rssBlocks.length) return items
  for (const block of source.match(/<entry\b[^>]*>[\s\S]*?<\/entry\s*>/gi) || []) {
    try {
      const item = parseAtomEntry(block)
      if (item) items.push(item)
    } catch {
      /* skip */
    }
  }
  return items
}

/** Reads og:image / twitter:image from an article page's <head>. */
export function extractOgImage(html: string) {
  const head = html.slice(0, 200_000)
  for (const meta of head.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = parseAttributes(meta)
    const key = (attrs.property || attrs.name || '').toLowerCase()
    if (key === 'og:image' || key === 'og:image:secure_url' || key === 'twitter:image') {
      const url = httpsUrl(attrs.content)
      if (url) return url
    }
  }
  return null
}
