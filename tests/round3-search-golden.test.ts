// Golden queries: what Iraqi citizens actually type into the service search (the hero box, the directory and أفندي's
// search_services tool all use the same ranking) must put the right service of the REAL catalog first. Covers the
// round-3 finding — «إجازة بناء» (the hero's own suggestion) listed six «ترميم أو إضافة بناء» permits before any
// building permit — plus Arabic normalisation (أ/إ/آ، ة/ه، ى/ي، tatweel, diacritics, Persian letters), Iraqi
// colloquial words and the district layer («… بالشطرة» → the Shatrah office first).
import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv } from './helpers'

configureTestEnv()

let app: Express
let search: typeof import('../server/services/search.ts')
let normalizeArabic: typeof import('../server/services/catalog.ts').normalizeArabic

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  search = await import('../server/services/search.ts')
  ;({ normalizeArabic } = await import('../server/services/catalog.ts'))
})

const results = (query: string, limit = 12) => search.searchCatalog(query, limit).hits.map(hit => hit.service)
const keys = (query: string, limit = 12) => results(query, limit).map(service => service.key)

const BUILDING = ['building-permit', 'muni-dir-building-permit-districts', 'nas-muni-building-permit']
const PASSPORT_FIRST = ['pass-new', 'civ-passport-new', 'e-passport']
const isBuildingPermit = (key: string) =>
  key === 'building-permit' || key.endsWith('building-permit-districts') || /-muni-building-permit$/.test(key)
const isRenovation = (key: string) => key.endsWith('renovation-permit')

type Golden = { query: string; top?: string[]; department?: string; topMatches?: (key: string) => boolean }

/** Typical queries → the acceptable first results (the same service can sit at two offices, e.g. pass-new). */
const GOLDEN: Golden[] = [
  // the hero's suggestions (src/components/home/Landing.tsx EXAMPLES)
  { query: 'إجازة بناء', top: BUILDING },
  { query: 'اريد اطلع جواز', top: PASSPORT_FIRST },
  { query: 'بطاقة سكن', top: ['civ-residence-card-new'] },
  { query: 'شكوى ماء', top: ['water-complaint', 'water-outage-leak-report', 'water-quality-complaint'] },
  // building and renovation are different services
  { query: 'اجازه بناء', top: BUILDING },
  { query: 'رخصة بناء', top: BUILDING },
  { query: 'اريد ابني بيت', topMatches: isBuildingPermit },
  { query: 'اجازة ترميم', topMatches: isRenovation },
  { query: 'ترميم', topMatches: key => isRenovation(key) || key === 'hf-renovation-loan' },
  // the district named in the query
  { query: 'إجازة بناء بالشطرة', top: ['sha-muni-building-permit'] },
  { query: 'اجازة بناء في الشطره', top: ['sha-muni-building-permit'] },
  { query: 'رخصة بناء في سوق الشيوخ', top: ['suq-muni-building-permit'] },
  { query: 'اجازة بناء قضاء النصر', top: ['nsr-muni-building-permit'] },
  { query: 'بطاقة سكن بالشطرة', top: ['shat-civ-residence-card'] },
  { query: 'البطاقه الموحده بالشطره', top: ['shat-civ-national-id'] },
  // passports: the first issue unless the citizen said otherwise
  { query: 'جواز', top: PASSPORT_FIRST },
  { query: 'جواز سفر', top: ['pass-new', 'civ-passport-new'] },
  { query: 'تجديد جواز', top: ['pass-renew'] },
  { query: 'جوازي ضاع', top: ['pass-lost-damaged'] },
  { query: 'بدل ضائع جواز', top: ['pass-lost-damaged'] },
  // national ID
  { query: 'بطاقة موحدة', top: ['nid-first-issue', 'national-id', 'civ-national-id-booking'] },
  { query: 'هويتي ضايعة', top: ['nid-replacement'] },
  { query: 'بدل ضائع هوية', top: ['nid-replacement'] },
  // shops, water, electricity
  { query: 'فتح محل', top: ['store-license'] },
  { query: 'ماكو ماي', top: ['water-outage-leak-report', 'water-complaint'] },
  { query: 'اشتراك ماء', top: ['water-new-subscription'] },
  { query: 'كهرباء', department: 'dhiqar-electricity' },
  { query: 'الكهربا مقطوعة', top: ['elec-fault-report'] },
  { query: 'براءة ذمة كهرباء', top: ['elec-bill-payment-request'] },
  // pensions, welfare, ration card
  { query: 'تقاعد', department: 'dhi-qar-pension-directorate' },
  { query: 'راتب تقاعدي', top: ['pension-confirmation', 'pension-salary-inquiry'] },
  { query: 'رعاية اجتماعية', top: ['spa-register', 'spa-north-register'] },
  { query: 'تموينية', department: 'main-supply-center-dhi-qar' },
  { query: 'بطاقة تموينية', top: ['supply-ration-card-new'] },
  { query: 'اضافة مولود للتموينية', top: ['supply-ration-card-add-member'] },
  // certificates
  { query: 'شهادة ميلاد', top: ['health-birth-certificate'] },
  { query: 'شهادة وفاة', top: ['health-death-certificate'] },
  { query: 'حسن سلوك', top: ['police-non-conviction', 'forensic-non-conviction-internal'] },
  { query: 'اجازة سوق', top: ['driving-license', 'traffic-driving-license-first'] },
]

describe('golden queries: the expected service comes first', () => {
  it('covers at least twenty typical queries', () => expect(GOLDEN.length).toBeGreaterThanOrEqual(20))

  it.each(GOLDEN.map(golden => [golden.query, golden] as const))('«%s»', (_query, golden) => {
    const [first] = results(golden.query)
    expect(first, `no result for «${golden.query}»`).toBeTruthy()
    if (golden.top) expect(golden.top).toContain(first.key)
    if (golden.department) expect(first.departmentId).toBe(golden.department)
    if (golden.topMatches) expect(golden.topMatches(first.key)).toBe(true)
  })
})

describe('«إجازة بناء»: building permits before renovation permits', () => {
  it('the dropdown (7 results) lists only building permits, no «ترميم أو إضافة بناء»', () => {
    const found = keys('إجازة بناء', 7)
    expect(found.length).toBe(7)
    expect(found.filter(isRenovation)).toEqual([])
    expect(found.every(isBuildingPermit)).toBe(true)
  })

  it('every building permit ranks above every renovation permit (no district named)', () => {
    const found = keys('إجازة بناء', 40)
    const lastBuilding = Math.max(...found.map((key, index) => (isBuildingPermit(key) ? index : -1)))
    const firstRenovation = found.findIndex(isRenovation)
    expect(lastBuilding).toBeGreaterThanOrEqual(0)
    if (firstRenovation >= 0) expect(firstRenovation).toBeGreaterThan(lastBuilding)
  })

  it('«إجازة بناء بالشطرة»: Shatrah municipality first, its renovation permit below the building permits', () => {
    const found = keys('إجازة بناء بالشطرة', 12)
    expect(found[0]).toBe('sha-muni-building-permit')
    expect(found.indexOf('sha-muni-renovation-permit')).toBeGreaterThan(found.indexOf('building-permit'))
    // another district's municipality never outranks the general (governorate-wide) permits
    const otherDistrict = found.findIndex(key => /^(nas|suq|rif|chb|nsr)-muni-/.test(key))
    if (otherDistrict >= 0) expect(otherDistrict).toBeGreaterThan(found.indexOf('building-permit'))
  })

  it('the hero box route (/api/services/search) returns the same order', async () => {
    const response = await request(app).get('/api/services/search').query({ q: 'إجازة بناء', limit: 7 })
    expect(response.status).toBe(200)
    const found = (response.body.items as Array<{ key: string }>).map(item => item.key)
    expect(BUILDING).toContain(found[0])
    expect(found.filter(isRenovation)).toEqual([])
    const district = await request(app).get('/api/services/search').query({ q: 'إجازة بناء بالشطرة', limit: 7 })
    expect(district.body.items[0].key).toBe('sha-muni-building-permit')
  })

  it("أفندي's search_services tool ranks the same way", async () => {
    const { executeTool } = await import('../server/assistant/tools.ts')
    const plain = executeTool('search_services', { query: 'شنو المستمسكات لإجازة بناء' }, { citizenId: null })
    const plainKeys = (plain.content as { results: Array<{ key: string }> }).results.map(item => item.key)
    expect(BUILDING).toContain(plainKeys[0])
    expect(plainKeys.slice(0, 3).filter(isRenovation)).toEqual([])
    const district = executeTool('search_services', { query: 'إجازة بناء بالشطرة' }, { citizenId: null })
    expect((district.content as { results: Array<{ key: string }> }).results[0].key).toBe('sha-muni-building-permit')
  })
})

describe('Arabic normalisation', () => {
  it('folds hamza forms, taa marbuta, alif maqsura, tatweel, diacritics and Persian keyboard letters', () => {
    expect(normalizeArabic('إجازة')).toBe(normalizeArabic('اجازه'))
    expect(normalizeArabic('أجازة')).toBe('اجازه')
    expect(normalizeArabic('آثار')).toBe('اثار')
    expect(normalizeArabic('شكوى')).toBe('شكوي')
    expect(normalizeArabic('جـــواز')).toBe('جواز')
    expect(normalizeArabic('جَوَازُ السَّفَرِ')).toBe('جواز السفر')
    expect(normalizeArabic('باسپورت')).toBe('باسبورت')
    expect(normalizeArabic('اگدر')).toBe('اكدر')
  })

  it.each([
    ['جـــواز سفر', 'جواز سفر'],
    ['إجـازة بنـاء', 'اجازه بناء'],
    ['أجازة بناء', 'اجازة بناء'],
    ['شَهادة مِيلاد', 'شهاده ميلاد'],
    ['بطاقه سكن', 'بطاقة سكن'],
  ])('«%s» ranks like «%s»', (written, plain) => {
    expect(keys(written, 5)).toEqual(keys(plain, 5))
  })

  it('synonym keys written with ى / ة match the normalised query («شكوى» → بلاغ)', () => {
    expect(search.expandQuery('شكوى').expanded).toContain('بلاغ')
    expect(search.expandQuery('عيادة').expanded.length).toBeGreaterThan(1)
  })

  it('attached prepositions and possessive endings: «بالشطره», «للتموينية», «جوازي», «هويتي»', () => {
    expect(search.expandQuery('اضافة مولود للتموينية').tokens).toContain('تموينيه')
    expect(search.expandQuery('جوازي').tokens).toEqual(['جواز'])
    expect(search.expandQuery('هويتي').tokens).toEqual(['هويه'])
    const district = search.expandQuery('اجازة بناء بالشطره')
    expect(district.tokens).toEqual(['اجازه', 'بناء'])
    expect(district.places).toEqual(['الشطرة'])
  })
})

describe('district detection', () => {
  it('finds districts with their article, a preposition or «قضاء/ناحية»', () => {
    expect(search.placesIn('اجازة بناء بالشطرة')).toEqual(['الشطرة'])
    expect(search.placesIn('في سوق الشيوخ')).toEqual(['سوق الشيوخ'])
    expect(search.placesIn('بطاقة سكن للرفاعي')).toEqual(['الرفاعي'])
    expect(search.placesIn('قضاء النصر')).toEqual(['النصر'])
    expect(search.placesIn('ناحية الإصلاح')).toEqual(['الإصلاح'])
  })

  it('does not take everyday words for a district («اصلاح عطل», «نصر», «اجازة سوق»)', () => {
    expect(search.placesIn('اصلاح عطل كهرباء')).toEqual([])
    expect(search.placesIn('نصر')).toEqual([])
    expect(search.placesIn('اجازة سوق')).toEqual([])
  })

  it('knows which district a service belongs to (from its department or title)', () => {
    const shatrah = results('إجازة بناء بالشطرة')[0]
    expect(search.servicePlaces(shatrah)).toEqual(['الشطرة'])
    const general = results('جواز سفر')[0]
    expect(search.servicePlaces(general)).toEqual([])
  })

  it('a district alone lists that district’s offices', () => {
    const found = results('الشطرة', 6)
    expect(found.length).toBeGreaterThan(0)
    expect(found.every(service => search.servicePlaces(service).includes('الشطرة'))).toBe(true)
  })
})
