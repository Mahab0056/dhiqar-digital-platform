import { listCatalogServices, normalizeArabic, type CatalogService } from './catalog.js'

/**
 * Smart catalog search: Arabic normalisation, Iraqi-dialect synonyms, prefix + fuzzy (bigram) token matching,
 * weighted fields and a stable ranking. Pure function over the in-memory catalog (a few hundred rows), so no index.
 */
const synonyms: Record<string, string[]> = {
  جنسيه: ['شهاده الجنسيه', 'الجنسيه العراقيه'],
  هويه: ['بطاقه', 'البطاقه الوطنيه', 'هويه الاحوال'],
  بطاقه: ['هويه', 'البطاقه الوطنيه'],
  طابو: ['التسجيل العقاري', 'سند', 'عقار'],
  عقار: ['التسجيل العقاري', 'طابو', 'سند'],
  اجازه: ['رخصه', 'ترخيص', 'اجازه'],
  رخصه: ['اجازه', 'ترخيص'],
  ضايع: ['ضائع', 'بدل فاقد', 'فقدان'],
  سواقه: ['سياقه', 'اجازه سياقه', 'المرور'],
  سوق: ['سياقه', 'اجازه سياقه'],
  سياقه: ['سواقه', 'المرور'],
  سياره: ['مركبه', 'المرور', 'تسجيل مركبه'],
  مركبه: ['سياره', 'المرور'],
  جواز: ['جوازات', 'جواز سفر'],
  باسبورت: ['جواز', 'جوازات'],
  كهرباء: ['توزيع كهرباء', 'مقياس', 'اشتراك كهرباء'],
  ماي: ['ماء', 'اشتراك ماء', 'مياه'],
  مياه: ['ماء'],
  ماء: ['مياه', 'ماي'],
  مجاري: ['صرف صحي', 'مجاري'],
  بلديه: ['بلديات', 'البلديه'],
  بناء: ['اجازه بناء', 'بناء', 'البلديات'],
  محل: ['اجازه محل', 'محلات', 'متجر'],
  شركه: ['تسجيل شركه', 'غرفه تجاره', 'الاعمال'],
  تقاعد: ['التقاعد', 'راتب تقاعدي', 'تقاعديه'],
  راتب: ['تقاعد', 'الرعايه الاجتماعيه', 'اعانه'],
  رعايه: ['الحمايه الاجتماعيه', 'اعانه', 'شمول'],
  اعانه: ['الحمايه الاجتماعيه', 'رعايه'],
  معاق: ['ذوي الاعاقه', 'الاعاقه', 'ذوي الاحتياجات'],
  اعاقه: ['ذوي الاعاقه', 'معاق'],
  ولاده: ['شهاده ولاده', 'قيد ولاده', 'المواليد'],
  وفاه: ['شهاده وفاه', 'قيد وفاه'],
  زواج: ['عقد زواج', 'الاحوال الشخصيه', 'المحكمه'],
  طلاق: ['الاحوال الشخصيه', 'المحكمه'],
  مدرسه: ['التربيه', 'نقل طالب', 'تسجيل'],
  طالب: ['التربيه', 'الجامعه', 'مدرسه'],
  جامعه: ['التعليم العالي', 'وثيقه تخرج', 'تصديق'],
  تخرج: ['وثيقه تخرج', 'الجامعه', 'تصديق'],
  شهاده: ['تصديق', 'وثيقه'],
  تصديق: ['شهاده', 'وثيقه', 'صحه صدور'],
  مستشفى: ['صحه', 'الصحه', 'تقرير طبي'],
  طبي: ['الصحه', 'لجنه طبيه', 'تقرير طبي'],
  عيادة: ['عياده', 'ترخيص عياده', 'الصحه'],
  صيدليه: ['الصحه', 'ترخيص صيدليه'],
  ارض: ['قطعه ارض', 'اراضي', 'السكن والاراضي'],
  قطعه: ['قطعه ارض', 'اراضي'],
  دار: ['سكن', 'اسكان', 'الدور'],
  سكن: ['اسكان', 'بطاقه سكن', 'الاسكان'],
  قرض: ['صندوق الاسكان', 'سلفه', 'قرض'],
  سلفه: ['قرض', 'صندوق الاسكان'],
  ضريبه: ['الضرائب', 'براءه ذمه', 'الهيئه العامه للضرائب'],
  براءه: ['براءه ذمه', 'الضرائب'],
  شكوى: ['شكاوى', 'مقترح', 'بلاغ'],
  بلاغ: ['شكوى', 'شكاوى'],
  زراعه: ['مزارع', 'الزراعه', 'بستان'],
  فلاح: ['الزراعه', 'مزارع'],
  حيوان: ['بيطري', 'البيطره', 'مواشي'],
  بيطري: ['البيطره', 'حيوان'],
  استثمار: ['هيئه الاستثمار', 'مشروع', 'رخصه استثمار'],
  مشروع: ['استثمار', 'مقاول', 'رخصه'],
  مقاول: ['تسجيل مقاول', 'مشروع'],
  عمل: ['العمل', 'اجازه عمل', 'التدريب المهني'],
  عامل: ['العمل', 'الضمان الاجتماعي'],
  ضمان: ['الضمان الاجتماعي', 'العمل'],
  تموين: ['البطاقه التموينيه', 'التموين', 'مركز التموين'],
  تموينيه: ['البطاقه التموينيه', 'التموين'],
  نفط: ['نفطيه', 'زيت الغاز', 'المنتجات النفطيه'],
  غاز: ['زيت الغاز', 'المنتجات النفطيه', 'كاز'],
  كاز: ['زيت الغاز', 'المنتجات النفطيه'],
  انترنت: ['انترنيت', 'الاتصالات', 'ftth'],
  انترنيت: ['انترنت', 'الاتصالات'],
  هاتف: ['الاتصالات', 'هاتف ارضي'],
  بريد: ['البريد', 'صندوق بريد', 'طرود'],
  حج: ['الحج والعمره', 'قرعه الحج'],
  عمره: ['الحج والعمره'],
  وقف: ['الوقف', 'مسجد', 'حسينيه'],
  مسجد: ['الوقف', 'جامع'],
  اثار: ['الاثار والتراث', 'المتحف'],
  رياضه: ['الشباب والرياضه', 'نادي', 'ملعب'],
  نادي: ['الشباب والرياضه', 'رياضه'],
  بيئه: ['البيئه', 'موافقه بيئيه', 'تلوث'],
  مرور: ['المرور', 'سياقه', 'مركبه'],
  شرطه: ['الشرطه', 'حسن سلوك', 'عدم محكوميه'],
  محكوميه: ['عدم محكوميه', 'الشرطه', 'حسن سلوك'],
  سلوك: ['حسن سلوك', 'عدم محكوميه'],
  دفاع: ['الدفاع المدني', 'سلامه', 'اطفاء'],
  حريق: ['الدفاع المدني', 'اطفاء', 'سلامه'],
  محكمه: ['القضاء', 'الاحوال الشخصيه', 'الاستئناف'],
  كفاله: ['المحكمه', 'القضاء'],
  حجه: ['حجه', 'المحكمه', 'الاحوال الشخصيه'],
  وكاله: ['كاتب العدل', 'وكاله عامه', 'وكاله خاصه'],
  عدل: ['كاتب العدل', 'وكاله', 'القضاء'],
  موعد: ['حجز موعد', 'مواعيد'],
  حجز: ['حجز موعد', 'موعد'],
  تسجيل: ['تسجيل', 'انتساب', 'تقديم'],
  تقديم: ['طلب', 'تسجيل'],
  تجديد: ['تجديد', 'استبدال', 'بدل تالف'],
  فقدان: ['بدل فاقد', 'بدل ضائع', 'فقدان'],
  فاقد: ['بدل فاقد', 'فقدان', 'مفقود'],
  ضائع: ['بدل فاقد', 'فقدان'],
  نقل: ['نقل', 'تحويل', 'انتقال'],
  تحويل: ['نقل', 'انتقال'],
}

const stopWords = new Set([
  'في',
  'من',
  'على',
  'الى',
  'عن',
  'او',
  'و',
  'ال',
  'ما',
  'هو',
  'هي',
  'كيف',
  'اريد',
  'ابي',
  'ابغي',
  'اسوي',
  'اسويلي',
  'اخذ',
  'احصل',
  'اطلع',
  'استخرج',
  'اعمل',
  'بدي',
  'محتاج',
  'احتاج',
  'اشلون',
  'شلون',
  'وين',
  'شنو',
  'ممكن',
  'لو',
  'سمحت',
  'رجاء',
  'بخصوص',
  'طلب',
  'خدمه',
  'معامله',
])

const stripAl = (token: string) => (token.length > 4 && token.startsWith('ال') ? token.slice(2) : token)

function bigrams(value: string) {
  const set = new Set<string>()
  for (let index = 0; index < value.length - 1; index++) set.add(value.slice(index, index + 2))
  return set
}

function similarity(left: string, right: string) {
  if (left === right) return 1
  if (left.length < 3 || right.length < 3) return 0
  const a = bigrams(left)
  const b = bigrams(right)
  let shared = 0
  for (const gram of a) if (b.has(gram)) shared++
  return (2 * shared) / (a.size + b.size)
}

export function expandQuery(query: string) {
  const tokens = normalizeArabic(query)
    .split(' ')
    .map(stripAl)
    .filter(token => token.length > 1 && !stopWords.has(token))
  const groups = tokens.map(token => {
    const aliases: string[][] = []
    for (const alias of synonyms[token] || []) {
      const parts = normalizeArabic(alias)
        .split(' ')
        .map(stripAl)
        .filter(part => part.length > 1)
      if (parts.length && !(parts.length === 1 && parts[0] === token)) aliases.push(parts)
    }
    return { token, aliases }
  })
  return { tokens, groups, expanded: [...new Set(groups.flatMap(group => [group.token, ...group.aliases.flat()]))] }
}

type Indexed = {
  service: CatalogService
  title: string[]
  category: string[]
  department: string[]
  docs: string[]
  description: string[]
}

let cache: { at: number; items: Indexed[] } | null = null

function index(): Indexed[] {
  if (cache && Date.now() - cache.at < 60_000) return cache.items
  const items = listCatalogServices().map(service => ({
    service,
    title: normalizeArabic(service.title).split(' ').map(stripAl),
    category: normalizeArabic(service.category).split(' ').map(stripAl),
    department: normalizeArabic(service.departmentName).split(' ').map(stripAl),
    docs: normalizeArabic(service.requiredDocuments.map(doc => doc.label).join(' '))
      .split(' ')
      .map(stripAl),
    description: normalizeArabic(service.description).split(' ').map(stripAl),
  }))
  cache = { at: Date.now(), items }
  return items
}

export function invalidateSearchIndex() {
  cache = null
}

function fieldScore(words: string[], token: string, weight: number) {
  let best = 0
  for (const word of words) {
    if (word === token) best = Math.max(best, 1)
    else if (word.startsWith(token) || token.startsWith(word)) best = Math.max(best, 0.6)
    else {
      const score = similarity(word, token)
      if (score >= 0.66) best = Math.max(best, score * 0.5)
    }
    if (best === 1) break
  }
  return best * weight
}

export type SearchHit = { service: CatalogService; score: number }

export function searchCatalog(query: string, limit = 12): { hits: SearchHit[]; tokens: string[] } {
  const { tokens, groups } = expandQuery(query)
  if (!tokens.length) return { hits: [], tokens }
  const hits: SearchHit[] = []
  const scoreToken = (item: Indexed, token: string) =>
    fieldScore(item.title, token, 5) +
    fieldScore(item.category, token, 2) +
    fieldScore(item.department, token, 2.5) +
    fieldScore(item.docs, token, 1.2) +
    fieldScore(item.description, token, 1)
  for (const item of index()) {
    let score = 0
    let matched = 0
    for (const group of groups) {
      let best = scoreToken(item, group.token)
      group.aliases.forEach((alias, position) => {
        // multi-word aliases (e.g. "اجازه سياقه") only count when every word hits the same service;
        // earlier aliases in the synonym list are the closer meanings and weigh more
        const partScores = alias.map(part => scoreToken(item, part))
        const weight = position === 0 ? 0.7 : position === 1 ? 0.55 : 0.45
        if (partScores.every(value => value > 0))
          best = Math.max(best, (partScores.reduce((sum, value) => sum + value, 0) / alias.length) * weight)
      })
      if (best > 0) {
        score += best
        matched++
      }
    }
    if (score <= 0) continue
    // Every word the citizen typed (or one of its synonyms) must hit somewhere when the query is short;
    // long queries need at least half of the words.
    const required = tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length / 2)
    if (matched < required) continue
    if (item.service.channel === 'ONLINE_SUBMISSION') score += 0.6
    if (item.service.sourceQuality === 'OFFICIAL') score += 0.4
    if (item.service.mode !== 'CATALOG') score += 0.3
    hits.push({ service: item.service, score })
  }
  hits.sort((a, b) => b.score - a.score || a.service.title.localeCompare(b.service.title, 'ar'))
  return { hits: hits.slice(0, limit), tokens }
}
