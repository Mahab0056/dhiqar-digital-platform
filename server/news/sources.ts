/**
 * Where Dhi Qar news comes from. Every source is public RSS; we keep the headline, a short excerpt, the image
 * URL and a link back to the publisher — never the article body.
 */
export type NewsSource = {
  id: string
  /** shown when the item itself does not name its publisher */
  name: string
  url: string
  /**
   * 'query' — the feed is already a Dhi Qar search (Google News): the headline must still name a place.
   * 'filter' — a national feed: keep items whose headline or description names a place.
   * 'local' — the governorate's own site: every item is relevant.
   */
  mode: 'query' | 'filter' | 'local'
  /** links are redirect wrappers (no article page to read an image from) */
  wrappedLinks?: boolean
  /** expected to fail sometimes; failures are logged quietly */
  optional?: boolean
}

const GOOGLE_QUERY = '"ذي قار" OR الناصرية OR الشطرة OR "سوق الشيوخ" OR الرفاعي OR الجبايش when:3d'

export const NEWS_SOURCES: NewsSource[] = [
  {
    id: 'google-news',
    name: 'أخبار Google',
    url: `https://news.google.com/rss/search?q=${encodeURIComponent(GOOGLE_QUERY)}&hl=ar&gl=IQ&ceid=IQ:ar`,
    mode: 'query',
    wrappedLinks: true,
  },
  { id: 'shafaq', name: 'شفق نيوز', url: 'https://shafaq.com/rss/ar', mode: 'filter' },
  { id: 'ina', name: 'وكالة الأنباء العراقية', url: 'https://www.ina.iq/rss.xml', mode: 'filter' },
  { id: 'thiqar-gov', name: 'محافظة ذي قار', url: 'https://thiqar.gov.iq/rss.xml', mode: 'local', optional: true },
]
