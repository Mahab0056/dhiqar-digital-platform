// Document titles derived from service titles: never a duplicated word («شهادة الشهادة …») and never a phrase cut
// at a slash or a length limit so that it ends on a preposition («موافقة نقل الأثاث من»). Checked over every catalog
// service with every template a department may assign, not only the default one.
import { beforeAll, describe, expect, it } from 'vitest'
import { configureTestEnv } from './helpers'

configureTestEnv()

type Service = { key: string; title: string; category: string }
type Templates = typeof import('../server/documents/templates.ts')
let services: Service[] = []
let t: Templates

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  createPlatformServer({ serveStatic: false })
  const catalog = await import('../server/services/catalog.ts')
  services = catalog.listCatalogServices({ activeOnly: false }) as Service[]
  t = await import('../server/documents/templates.ts')
})

const PREPOSITIONS = ['من', 'إلى', 'الى', 'في', 'على', 'عن']
const words = (title: string) => title.trim().split(/\s+/)
const endsOnPreposition = (title: string) => PREPOSITIONS.includes(words(title).at(-1) || '')
/** «شهادة شهادة» or «شهادة الشهادة»: the same word twice in a row, with or without the article. */
const repeatedWord = (title: string) => {
  const list = words(title)
  return list.some((word, index) => {
    const next = list[index + 1]
    if (!next) return false
    return word === next || (word.length > 2 && next.length > 2 && word.replace(/^ال/, '') === next.replace(/^ال/, ''))
  })
}

describe('document titles of every catalog service', () => {
  it('no derived title ends on a dangling preposition or repeats a word, whatever template is assigned', () => {
    expect(services.length).toBeGreaterThan(300)
    const bad: Array<{ key: string; template: string; title: string }> = []
    for (const service of services) {
      const assignable = new Set([t.inferTemplateId(service), ...t.documentTemplates.map(item => item.id)])
      for (const id of assignable) {
        const title = t.documentTitleFor(t.getTemplate(id), service.title)
        if (!title.trim() || endsOnPreposition(title) || repeatedWord(title) || title.length > t.DOCUMENT_TITLE_MAX)
          bad.push({ key: service.key, template: id, title })
      }
    }
    expect(bad).toEqual([])
  })

  it('the reported titles: no «شهادة الشهادة», no «… الأثاث من»', () => {
    const byKey = new Map(services.map(service => [service.key, service]))
    const titleOf = (key: string) => {
      const service = byKey.get(key) as Service
      return t.documentTitleFor(t.getTemplate(t.inferTemplateId(service)), service.title)
    }
    expect(titleOf('health-food-handler-certificate')).toBe('الشهادة الصحية للعاملين في المحال الغذائية')
    expect(titleOf('gov-furniture-transfer-approval')).toBe('موافقة نقل الأثاث من وإلى المحافظة')
    // a slash inside one phrase lists alternatives: kept, not cut at the slash
    expect(titleOf('health-shop-sanitary-approval')).toBe('الموافقة الصحية لفتح أو تجديد إجازة محل تجاري أو غذائي')
    expect(titleOf('mod-crossing-permit')).toBe('موافقة على عبور أو إنشاء ضمن حرم المصب العام أو المبازل')
    // unchanged where they were already right
    expect(titleOf('forensic-non-conviction-internal')).toBe('شهادة عدم المحكومية')
    expect(titleOf('health-death-certificate')).toBe('شهادة الوفاة')
    expect(titleOf('mowr-well-drilling-license')).toBe('إجازة حفر بئر مائي')
  })
})

describe('title derivation rules', () => {
  const certificate = () => t.getTemplate('certificate')
  const approval = () => t.getTemplate('technical-approval')
  const licence = () => t.getTemplate('general-licence')

  it('drops the request words in front and does not repeat the framing word', () => {
    expect(t.documentTitleFor(certificate(), 'طلب إصدار شهادة الجنسية العراقية')).toBe('شهادة الجنسية العراقية')
    expect(t.documentTitleFor(certificate(), 'الشهادة المدرسية')).toBe('الشهادة المدرسية')
    expect(t.documentTitleFor(certificate(), 'عدم المحكومية')).toBe('شهادة عدم المحكومية')
    expect(t.documentTitleFor(approval(), 'الموافقة البيئية لإقامة مشروع')).toBe('الموافقة البيئية لإقامة مشروع')
    expect(t.documentTitleFor(approval(), 'نصب مولدة أهلية')).toBe('كتاب موافقة — نصب مولدة أهلية')
    expect(t.documentTitleFor(licence(), 'طلب الحصول على إجازة استثمار')).toBe('إجازة استثمار')
  })

  it('falls back to the whole service title, then to the template title, instead of cutting mid-phrase', () => {
    // the first alternative ends on «من»: the whole title is used
    expect(t.documentTitleFor(approval(), 'موافقة نقل من / إلى المحافظة')).toBe('موافقة نقل من وإلى المحافظة')
    expect(t.documentTitleFor(licence(), 'إجازة نقل مواد من / إجازة نقل مواد إلى المحافظة')).toBe(
      'إجازة نقل مواد من أو إجازة نقل مواد إلى المحافظة'
    )
    // nothing usable in the service title: the template's own title
    expect(t.documentTitleFor(licence(), 'طلب')).toBe('إجازة / ترخيص')
    expect(t.documentTitleFor(licence(), '(تجديد)')).toBe('إجازة / ترخيص')
    // templates that do not follow the service keep their title
    expect(t.documentTitleFor(t.getTemplate('shop-licence'), 'الشهادة الشهادة من')).toBe('إجازة فتح محل')
  })

  it('a long title is clipped at a word boundary and never ends on a preposition', () => {
    const long = `إجازة ${'نقل مواد البناء '.repeat(6)}من المحافظة إلى الأقضية والنواحي التابعة لها في محافظة ذي قار`
    const title = t.documentTitleFor(licence(), long)
    expect(title.length).toBeLessThanOrEqual(t.DOCUMENT_TITLE_MAX)
    expect(long.startsWith(title)).toBe(true)
    expect(endsOnPreposition(title)).toBe(false)
    expect(repeatedWord(title)).toBe(false)
  })

  it('a custom title is printed as typed, clipped at a word boundary', () => {
    expect(t.documentTitleFor(certificate(), 'أي خدمة', '  شهادة شمول بالسكن واطئ الكلفة ')).toBe(
      'شهادة شمول بالسكن واطئ الكلفة'
    )
    const custom = `${'كلمة '.repeat(30)}أخيرة`
    const clipped = t.documentTitleFor(certificate(), 'أي خدمة', custom)
    expect(clipped.length).toBeLessThanOrEqual(t.DOCUMENT_TITLE_MAX)
    expect(clipped.split(' ').every(word => word === 'كلمة')).toBe(true)
  })
})
