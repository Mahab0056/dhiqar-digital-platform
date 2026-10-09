// Catalog search quality: real citizen phrasings must find the right service first, nonsense must find nothing.
import { beforeAll, describe, expect, it } from 'vitest'
import { configureTestEnv } from './helpers'

configureTestEnv()

let searchCatalog: typeof import('../server/services/search.ts').searchCatalog

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  createPlatformServer({ serveStatic: false })
  ;({ searchCatalog } = await import('../server/services/search.ts'))
})

const titles = (query: string) => searchCatalog(query, 12).hits.map(hit => hit.service.title)

describe('catalog search', () => {
  it.each([
    ['رخصة قيادة', 'السياقة'],
    ['اريد اطلع اجازة سوق لابني', 'السياقة'],
    ['تجديد اجازة السوق منتهية من سنتين', 'تجديد إجازة السياقة'],
    ['شهادة وفاة', 'شهادة الوفاة'],
    ['شهاده ميلاد', 'شهادة الولادة'],
    ['جواز سفر', 'جواز السفر'],
    ['جوار سفر', 'جواز السفر'],
    ['كهرباء انقطاع في الشطرة', 'عطل كهربائي'],
    ['اجازة فتح محل تجاري', 'إجازة فتح محل'],
  ])('"%s" finds "%s" first', (query, expected) => {
    expect(titles(query)[0]).toContain(expected)
  })

  it('still finds a district by its full name', () => {
    expect(titles('بناء سوق الشيوخ').length).toBeGreaterThan(0)
  })

  it.each(['رخصة قيادة طائرة فضائية', 'زراعة نخيل عالي جدا ازرق', 'قطة'])('"%s" finds nothing', query => {
    expect(titles(query)).toEqual([])
  })

  it('does not confuse similar-looking words (قيادة ≠ عيادة)', () => {
    expect(titles('رخصة قيادة').some(title => title.includes('عيادة'))).toBe(false)
  })

  it('drops weak tail hits that share only a generic word', () => {
    expect(titles('اريد اطلع اجازة سوق لابني').some(title => title.includes('بناء'))).toBe(false)
  })
})
