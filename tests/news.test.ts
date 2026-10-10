// Dhi Qar news aggregator: RSS parsing, relevance, tender classification, de-duplication, retention and the
// public/admin endpoints. The network is always mocked (fixture XML); the hourly timer never runs in tests.
import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()

let app: Express
let admin = ''

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toUTCString()

const shafaqFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Shafaq News</title>
<!-- <item><title>ذي قار مخفي في تعليق</title><link>https://shafaq.com/ar/hidden</link></item> -->
<item>
  <title><![CDATA[افتتاح جسر جديد في الناصرية & تخفيف الزخام]]></title>
  <link>https://shafaq.com/ar/a1</link>
  <description><![CDATA[<p>افتتحت محافظة <b>ذي قار</b> اليوم جسراً جديداً يربط ضفتي نهر الفرات في مركز مدينة الناصرية، بهدف تخفيف الزخام المروري الذي تشهده المدينة منذ سنوات طويلة، وسط حضور رسمي وشعبي واسع وتوقعات بأن يخدم آلاف المركبات يومياً.</p>]]></description>
  <pubDate>${hoursAgo(2)}</pubDate>
  <enclosure url="https://media.shafaq.com/media/arcella/bridge.webp" type="image/webp" length="0"/>
</item>
<item>
  <title>إعلان مناقصة عامة لتأهيل مشروع ماء الشطرة</title>
  <link>https://shafaq.com/ar/a2</link>
  <description>تعلن مديرية ماء ذي قار عن مناقصة&#x20;عامة &amp; دعوة للشركات.</description>
  <pubDate>${hoursAgo(5)}</pubDate>
  <media:content url="https://media.shafaq.com/media/arcella/water.jpg" medium="image"/>
</item>
<item>
  <title>البرلمان يناقش الموازنة الاتحادية</title>
  <link>https://shafaq.com/ar/a3</link>
  <description>جلسة في بغداد لمناقشة الجداول.</description>
  <pubDate>${hoursAgo(3)}</pubDate>
</item>
<item>
  <title>خبر قديم جداً عن ذي قار</title>
  <link>https://shafaq.com/ar/old</link>
  <pubDate>${hoursAgo(24 * 30)}</pubDate>
</item>
<item>
  <title>دراسة جغرافية عن السهول الرسوبية</title>
  <link>https://shafaq.com/ar/geo</link>
  <description>بحث في الجغرافية الطبيعية.</description>
  <pubDate>${hoursAgo(1)}</pubDate>
</item>
<item>
  <title>نادي النصر يفوز في الدوري</title>
  <link>https://shafaq.com/ar/sport</link>
  <pubDate>${hoursAgo(1)}</pubDate>
</item>
</channel></rss>`

const googleFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item>
  <title>افتتاح جسر جديد في الناصرية &amp; تخفيف الزخام - شفق نيوز</title>
  <link>https://news.google.com/rss/articles/CBMiAAA?oc=5</link>
  <description>&lt;a href="https://news.google.com/rss/articles/CBMiAAA"&gt;افتتاح جسر&lt;/a&gt;&amp;nbsp;&lt;font color="#6f6f6f"&gt;شفق نيوز&lt;/font&gt;</description>
  <pubDate>${hoursAgo(2)}</pubDate>
  <source url="https://shafaq.com">شفق نيوز</source>
</item>
<item>
  <title>حملة لإزالة التجاوزات في قضاء الرفاعي - المربد</title>
  <link>https://news.google.com/rss/articles/CBMiBBB?oc=5</link>
  <pubDate>${hoursAgo(4)}</pubDate>
  <source url="https://www.almirbad.com">المربد</source>
</item>
<item>
  <title>الفئات الأكثر عرضة لأمراض القلب - شبكة اخبار الناصرية</title>
  <link>https://news.google.com/rss/articles/CBMiDDD?oc=5</link>
  <pubDate>${hoursAgo(4)}</pubDate>
  <source url="https://nasiriyah.org">شبكة اخبار الناصرية</source>
</item>
<item>
  <title>وزير النفط يزور البصرة - الصباح</title>
  <link>https://news.google.com/rss/articles/CBMiCCC?oc=5</link>
  <pubDate>${hoursAgo(4)}</pubDate>
  <source url="https://alsabaah.iq">الصباح</source>
</item>
</channel></rss>`

const inaFeed = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>محافظ ذي قار يتفقد مستشفى سوق الشيوخ</title><link>https://www.ina.iq/1.html</link>
<description>زيارة ميدانية</description><pubDate>${hoursAgo(6)}</pubDate></item>
</channel></rss>`

const articlePage = `<html><head><meta property="og:image" content="https://www.ina.iq/img/visit.jpg"></head><body>…</body></html>`

const calls: string[] = []
const mockFetch = async (url: string) => {
  calls.push(url)
  const ok = (body: string) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/xml' } })
  if (url.startsWith('https://news.google.com/rss/search')) return ok(googleFeed)
  if (url === 'https://shafaq.com/rss/ar') return ok(shafaqFeed)
  if (url === 'https://www.ina.iq/rss.xml') return ok(inaFeed)
  if (url === 'https://www.ina.iq/1.html') return ok(articlePage)
  if (url.startsWith('https://thiqar.gov.iq')) throw new Error('getaddrinfo ENOTFOUND thiqar.gov.iq')
  return new Response('not found', { status: 404 })
}

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  const { setNewsFetch } = await import('../server/news/aggregator.ts')
  setNewsFetch(mockFetch as never)
  app = createPlatformServer({ serveStatic: false }).app
  const login = await request(app)
    .post('/api/auth/staff/login')
    .send({ username: 'admin', password: 'Bootstrap-Admin-Pass-2026!' })
  admin = cookieOf(login)
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', admin)
    .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Admin-Rotated-Pass-2026!' })
})

describe('RSS parsing', () => {
  it('reads CDATA, entities, enclosure and media:content, and ignores commented-out items', async () => {
    const { parseFeed } = await import('../server/news/rss.ts')
    const items = parseFeed(shafaqFeed)
    expect(items).toHaveLength(6)
    expect(items[0].title).toBe('افتتاح جسر جديد في الناصرية & تخفيف الزخام')
    expect(items[0].imageUrl).toBe('https://media.shafaq.com/media/arcella/bridge.webp')
    expect(items[1].imageUrl).toBe('https://media.shafaq.com/media/arcella/water.jpg')
    expect(items[1].description).toContain('مناقصة عامة & دعوة')
    expect(items[0].publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(items.some(item => item.link.endsWith('/hidden'))).toBe(false)
  })

  it('reads the publisher from <source>, images from media:thumbnail and <img>, and Atom entries', async () => {
    const { parseFeed, extractOgImage } = await import('../server/news/rss.ts')
    expect(parseFeed(googleFeed)[1].sourceName).toBe('المربد')
    const thumb = parseFeed(
      `<rss><channel><item><title>t</title><link>https://a.example/1</link><media:thumbnail url="https://a.example/t.jpg"/></item>
       <item><title>u</title><link>https://a.example/2</link><description>&lt;img src="https://a.example/u.png"&gt; text</description></item>
       <item><title>insecure</title><link>https://a.example/3</link><enclosure url="http://a.example/x.jpg" type="image/jpeg"/></item></channel></rss>`
    )
    expect(thumb.map(item => item.imageUrl)).toEqual(['https://a.example/t.jpg', 'https://a.example/u.png', null])
    const atom = parseFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">خبر &amp; ذي قار</title>
       <link rel="alternate" href="https://b.example/e1"/><updated>2026-10-09T10:00:00Z</updated><summary>ملخص</summary></entry></feed>`
    )
    expect(atom[0]).toMatchObject({ title: 'خبر & ذي قار', link: 'https://b.example/e1', description: 'ملخص' })
    expect(parseFeed('<html>not a feed</html>')).toEqual([])
    expect(extractOgImage(articlePage)).toBe('https://www.ina.iq/img/visit.jpg')
  })
})

describe('relevance and classification', () => {
  it('keeps Dhi Qar places, including proclitics, and rejects lookalikes and bare ambiguous names', async () => {
    const { mentionsDhiQar } = await import('../server/news/text.ts')
    expect(mentionsDhiQar('أمطار غزيرة في ذي قار')).toBe(true)
    expect(mentionsDhiQar('والناصرية تستقبل')).toBe(true)
    expect(mentionsDhiQar('بالشطرة')).toBe(true)
    expect(mentionsDhiQar('مشروع في قضاء الرفاعي')).toBe(true)
    expect(mentionsDhiQar('ناحية الفجر')).toBe(true)
    expect(mentionsDhiQar('أهوار الجبايش')).toBe(true)
    expect(mentionsDhiQar('دراسة جغرافية')).toBe(false)
    expect(mentionsDhiQar('نادي النصر يفوز')).toBe(false)
    expect(mentionsDhiQar('الشاعر أحمد الرفاعي')).toBe(false)
    // Nasserism, not the city
    expect(mentionsDhiQar('الإمام القرضاوي والناصرية: قراءة في الحلول المستوردة')).toBe(false)
    expect(mentionsDhiQar('التيار الناصري يعقد مؤتمره في الناصرية')).toBe(false)
    expect(mentionsDhiQar('مؤتمر في الناصرية بذي قار عن القومية')).toBe(true)
  })

  it('classifies tenders and auctions', async () => {
    const { classifyKind, titleKey } = await import('../server/news/text.ts')
    expect(classifyKind('إعلان مناقصة عامة لتأهيل مدرسة')).toBe('TENDER')
    expect(classifyKind('مزايدة علنية لتأجير محال')).toBe('TENDER')
    expect(classifyKind('مزاد لبيع العجلات المستهلكة')).toBe('TENDER')
    expect(classifyKind('دعوة عامة لتقديم العطاءات')).toBe('TENDER')
    expect(classifyKind('افتتاح جسر جديد')).toBe('NEWS')
    expect(titleKey('عاجل: افتتاحُ جسرٍ — جديد!')).toBe(titleKey('افتتاح جسر جديد'))
  })
})

describe('aggregator run', () => {
  it('fetches every source, survives a failing one, filters, dedupes and enriches images', async () => {
    const { refreshNews } = await import('../server/news/aggregator.ts')
    const lines: string[] = []
    const summary = await refreshNews({ log: line => lines.push(line) })
    const bySource = Object.fromEntries(summary.sources.map(item => [item.id, item]))
    expect(bySource['thiqar-gov'].ok).toBe(false)
    expect(bySource.shafaq).toMatchObject({ ok: true, parsed: 6, kept: 2, added: 2 })
    // the bridge story already came from Shafaq: Google's copy is the same title → not stored twice
    expect(bySource['google-news']).toMatchObject({ ok: true, kept: 2, added: 1 })
    expect(bySource.ina.added).toBe(1)
    expect(summary.added).toBe(4)
    expect(summary.images).toBe(1)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^\[news\] .*thiqar-gov failed/)

    // a second run adds nothing
    const again = await refreshNews({ log: () => {} })
    expect(again.added).toBe(0)
    expect(calls.filter(url => url === 'https://www.ina.iq/1.html')).toHaveLength(1)
  })

  it('applies retention by age and row cap', async () => {
    const { applyRetention } = await import('../server/news/aggregator.ts')
    const { db } = await import('../server/db.ts')
    db.prepare(
      `INSERT INTO news_items (id, source, source_name, title, title_key, link, published_at, fetched_at) VALUES ('nws_old', 'x', 'x', 'قديم', 'قديم', 'https://x.example/old', ?, ?)`
    ).run(new Date(Date.now() - 20 * 86_400_000).toISOString(), new Date().toISOString())
    applyRetention()
    expect(db.prepare(`SELECT 1 FROM news_items WHERE id = 'nws_old'`).get()).toBeUndefined()
  })
})

describe('news endpoints', () => {
  it('lists news with sources, a ticker, and the tender kind; cached publicly', async () => {
    const list = await request(app).get('/api/news?limit=10')
    expect(list.status).toBe(200)
    expect(list.headers['cache-control']).toBe('public, max-age=300')
    expect(list.body.total).toBe(4)
    expect(list.body.updatedAt).toBeTruthy()
    const first = list.body.items[0]
    expect(Object.keys(first).sort()).toEqual(
      ['excerpt', 'id', 'imageUrl', 'kind', 'link', 'publishedAt', 'source', 'sourceName', 'title'].sort()
    )
    expect(list.body.items.every((item: { excerpt: string }) => item.excerpt.length <= 181)).toBe(true)
    expect(list.body.sources.map((item: { name: string }) => item.name)).toContain('المربد')
    const google = list.body.items.find((item: { source: string }) => item.source === 'google-news')
    expect(google.title).toBe('حملة لإزالة التجاوزات في قضاء الرفاعي')
    expect(google.sourceName).toBe('المربد')

    const tenders = await request(app).get('/api/news?kind=TENDER')
    expect(tenders.body.items).toHaveLength(1)
    expect(tenders.body.items[0].title).toContain('مناقصة')

    const search = await request(app).get('/api/news?q=' + encodeURIComponent('سوق الشيوخ'))
    expect(search.body.items).toHaveLength(1)
    expect(search.body.items[0].imageUrl).toBe('https://www.ina.iq/img/visit.jpg')

    const ticker = await request(app).get('/api/news/ticker')
    expect(ticker.status).toBe(200)
    expect(ticker.body.items.length).toBeLessThanOrEqual(12)
    expect(Object.keys(ticker.body.items[0]).sort()).toEqual(
      ['id', 'kind', 'link', 'publishedAt', 'sourceName', 'title'].sort()
    )
  })

  it('lets only the super admin hide an item or refresh, with an audit trail', async () => {
    const list = await request(app).get('/api/news')
    const id = list.body.items[0].id as string
    expect((await request(app).patch(`/api/admin/news/${id}`).send({ hidden: true })).status).toBe(401)
    expect((await request(app).post('/api/admin/news/refresh')).status).toBe(401)

    const hidden = await request(app).patch(`/api/admin/news/${id}`).set('Cookie', admin).send({ hidden: true })
    expect(hidden.status).toBe(200)
    expect(hidden.body.hidden).toBe(true)
    const after = await request(app).get('/api/news')
    expect(after.body.items.some((item: { id: string }) => item.id === id)).toBe(false)
    const moderation = await request(app).get('/api/admin/news').set('Cookie', admin)
    expect(moderation.body.items.find((item: { id: string }) => item.id === id).hidden).toBe(true)
    expect(moderation.body.status.lastRun.sources).toHaveLength(4)

    const refreshed = await request(app).post('/api/admin/news/refresh').set('Cookie', admin)
    expect(refreshed.status).toBe(200)
    expect(refreshed.body.sources).toHaveLength(4)
    // hiding survives a refresh (the same story is not re-added)
    expect((await request(app).get('/api/news')).body.items.some((item: { id: string }) => item.id === id)).toBe(false)

    const { db } = await import('../server/db.ts')
    const actions = (
      db.prepare(`SELECT action FROM audit_logs WHERE entity_type IN ('NewsItem', 'NewsFeed')`).all() as Array<{
        action: string
      }>
    ).map(row => row.action)
    expect(actions).toEqual(expect.arrayContaining(['NEWS_ITEM_HIDDEN', 'NEWS_REFRESHED']))
  })
})
