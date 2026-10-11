import { listCatalogServices, normalizeArabic, type CatalogService } from './catalog.js'

/**
 * Smart catalog search: Arabic normalisation, Iraqi-dialect synonyms, prefix + fuzzy (bigram) token matching,
 * weighted fields, then a phrase layer over the title (the exact title, the title starting with what was typed and
 * the typed words side by side outrank the same words scattered), a penalty for a variant the citizen did not ask
 * for («ترميم/إضافة» when he typed «إجازة بناء», «تجديد» when he typed «جواز») and a district layer (a query that
 * names a قضاء puts that district's office first). Pure function over the in-memory catalog (a few hundred rows).
 *
 * Keys are written as the citizen types them; they are normalised once, on first use (so «شكوى», «عيادة» match too).
 */
const rawSynonyms: Record<string, string[]> = {
  جنسيه: ['شهاده الجنسيه', 'الجنسيه العراقيه'],
  هويه: ['البطاقه الوطنيه', 'هويه الاحوال', 'بطاقه'],
  بطاقه: ['هويه', 'البطاقه الوطنيه'],
  طابو: ['التسجيل العقاري', 'سند', 'عقار'],
  عقار: ['التسجيل العقاري', 'طابو', 'سند'],
  اجازه: ['رخصه', 'ترخيص', 'اجازه'],
  رخصه: ['اجازه', 'ترخيص'],
  ضايع: ['ضائع', 'بدل فاقد', 'فقدان', 'مفقود', 'بدل'],
  سواقه: ['سياقه', 'اجازه سياقه', 'المرور'],
  سوق: ['سياقه', 'اجازه سياقه'],
  سياقه: ['سواقه', 'المرور'],
  قياده: ['سياقه', 'اجازه سياقه', 'المرور'],
  ميلاد: ['ولاده', 'شهاده الولاده'],
  مواليد: ['ولاده'],
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
  // Iraqi everyday words for the same needs
  ضاع: ['بدل فاقد', 'فقدان', 'ضائع', 'مفقود', 'بدل'],
  ضايعه: ['بدل فاقد', 'فقدان', 'ضائع', 'مفقود', 'بدل'],
  حسن_السلوك: ['عدم محكوميه', 'شهاده عدم محكوميه'],
  مفقود: ['بدل فاقد', 'فقدان'],
  اجدد: ['تجديد'],
  جدد: ['تجديد'],
  اول: ['اول مره'],
  جديد: ['اول مره'],
  جوازات: ['جواز', 'جواز سفر'],
  موحده: ['البطاقه الوطنيه الموحده', 'وطنيه'],
  كهربا: ['كهرباء', 'كهربائي'],
  مي: ['ماء', 'مياه'],
  مقطوع: ['انقطاع', 'عطل'],
  مقطوعه: ['انقطاع', 'عطل'],
  طافيه: ['انقطاع', 'عطل'],
  طافي: ['انقطاع', 'عطل'],
  ماكو: ['انقطاع'],
  بيت: ['دار', 'دار سكنيه', 'سكن'],
  دكان: ['محل', 'محلات'],
  متقاعد: ['تقاعد', 'راتب تقاعدي'],
  حمايه: ['الحمايه الاجتماعيه', 'اعانه'],
  فقر: ['الحمايه الاجتماعيه', 'اعانه'],
  حصه: ['البطاقه التموينيه', 'تموين'],
  مولود: ['ولاده'],
  اسجل: ['تسجيل', 'تقديم'],
}

/** Question and filler words (Iraqi and standard) that never name a service. Normalised once, lazily. */
const STOP_WORDS = [
  'في',
  'من',
  'على',
  'إلى',
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
  'رايد',
  'اكدر',
  'اقدر',
  'لازم',
  'شني',
  'شكد',
  'يمته',
  'منين',
  'عندي',
  'اللي',
  'هاي',
  'هذا',
  'هذه',
  'هذي',
  'يعني',
  'بس',
  'مال',
  'مالت',
  'مالتي',
]

/** Generic first words of a title («إصدار…», «حجز موعد…», «التقديم على…»): the title "starts" after them. */
const LEAD_WORDS = ['إصدار', 'حجز', 'موعد', 'التقديم', 'تقديم', 'استخراج', 'منح', 'خدمات']

/**
 * Words that make a title a variant of a service. A title with a variant the citizen did not ask for is pushed down
 * (one penalty per group): «إجازة بناء» → the building permit before «إجازة ترميم أو إضافة بناء», «جواز» → the first
 * issue before the renewal, the lost-passport and the minor's passport.
 */
const VARIANT_GROUPS = [
  ['تجديد', 'تمديد'],
  ['بدل', 'فاقد', 'مفقود', 'ضائع', 'تالف', 'فقدان'],
  ['تصحيح', 'تعديل', 'تحديث', 'تغيير'],
  ['إلغاء'],
  ['نقل', 'تحويل', 'انتقال'],
  ['اعتراض', 'تظلم'],
  ['ترميم', 'إضافة', 'إكمال', 'توسيع'],
  ['هدم'],
  ['متابعة', 'استعلام', 'استلام'],
  ['القاصر', 'قاصر', 'القاصرين'],
  ['المستعجلة', 'مستعجل', 'مستعجلة'],
  ['حذف'],
  ['تقسيط'],
  ['ورثة', 'الورثة'],
  ['دولية'],
  ['المبكر', 'مبكر'],
  ['خارجية'],
  ['العجز', 'الإصابة'],
]

type Place = { key: string; label: string; ambiguous?: boolean; parent?: string }

/**
 * Districts (أقضية) and subdistricts of Dhi Qar as they appear after normalisation. Multi-word names are joined into
 * one token (see `compounds`). Names that are also everyday words («النصر», «الإصلاح», «الفجر»…) count as a place
 * only with «قضاء/ناحية» before them or written «بالنصر/في النصر».
 */
const PLACES: Place[] = [
  { key: 'ناصريه', label: 'الناصرية' },
  { key: 'شطره', label: 'الشطرة' },
  { key: '_سوق_الشيوخ', label: 'سوق الشيوخ' },
  { key: 'رفاعي', label: 'الرفاعي' },
  { key: 'جبايش', label: 'الجبايش' },
  { key: '_قلعه_سكر', label: 'قلعة سكر' },
  { key: 'فهود', label: 'الفهود' },
  { key: 'غراف', label: 'الغراف' },
  { key: 'دوايه', label: 'الدواية' },
  { key: '_سيد_دخيل', label: 'سيد دخيل' },
  { key: 'بطحاء', label: 'البطحاء' },
  { key: 'نصر', label: 'النصر', ambiguous: true },
  { key: 'اصلاح', label: 'الإصلاح', ambiguous: true },
  { key: 'فجر', label: 'الفجر', ambiguous: true },
  { key: 'عكيكه', label: 'العكيكة', parent: '_سوق_الشيوخ' },
  { key: '_كرمه_بني_سعد', label: 'كرمة بني سعد' },
  { key: 'فضليه', label: 'الفضلية' },
  { key: 'طار', label: 'الطار', ambiguous: true },
  { key: 'منار', label: 'المنار', ambiguous: true },
  { key: 'اور', label: 'أور', ambiguous: true },
]
const placeByKey = new Map(PLACES.map(place => [place.key, place]))
/** District labels, the centre and the largest districts first (the order district chips are offered in). */
export const PLACE_LABELS = PLACES.map(place => place.label)
const QUALIFIER = /^[وفب]?(?:ال)?(?:قضاء|ناحيه|مركز)$/

// Multi-word names are kept as one token on both sides (marked so prefix/fuzzy matching on a first word that is
// also an everyday word can't reach it: «اجازة سوق» = driving licence, not سوق الشيوخ). A leading «و/ف/ب/ل» is dropped.
const compounds: Array<[RegExp, string]> = [
  [/(^| )[وفبل]?سوق (?:ال)?شيوخ(?= |$)/g, '$1_سوق_الشيوخ'],
  [/(^| )[وفبل]?قلعه سكر(?= |$)/g, '$1_قلعه_سكر'],
  [/(^| )[وفبل]?سيد دخيل(?= |$)/g, '$1_سيد_دخيل'],
  [/(^| )[وفبل]?كرمه بني سعي?د(?= |$)/g, '$1_كرمه_بني_سعد'],
  // «أول مرة» / «لأول مرة» (first issue) is one idea: titles write it «(لأول مرة)»
  [/(^| )[وف]?(?:ل|ال)?اول مره(?= |$)/g, '$1_اول_مره'],
  // «حسن السلوك» is the everyday name of «عدم المحكومية»; «أبني بيت» (I build a house) is a building permit
  [/(^| )[وفبل]?(?:ال)?حسن (?:ال)?سلوك(?= |$)/g, '$1_حسن_السلوك'],
  [/(^| )(?:ابني|نبني|ابنيلي|اعمر|نعمر) (?:بيت|بيتي|دار|داري)(?= |$)/g, '$1بناء دار'],
]

const stripAl = (token: string) => (token.length > 4 && token.startsWith('ال') ? token.slice(2) : token)
/** «للقاصر» → «قاصر», «بالشطره» → «شطره», «والكهرباء» → «كهرباء» (only when a real word is left). */
const peel = (token: string) => {
  if (token.startsWith('لل') && token.length >= 6) return token.slice(2)
  if (/^[وبفك]ال/.test(token) && token.length >= 7) return token.slice(3)
  return token
}

function rawTokens(text: string) {
  let value = normalizeArabic(text)
  for (const [pattern, joined] of compounds) value = value.replace(pattern, joined)
  return value.split(' ').filter(Boolean)
}

const words = (text: string) => rawTokens(text).map(token => peel(stripAl(token)))

/** The place a token names («الشطرة», «بالشطره», «للناصريه», «قضاء النصر»), or undefined. */
function matchPlace(token: string, previous: string | undefined, relaxed: boolean): Place | undefined {
  const qualified = previous !== undefined && QUALIFIER.test(previous)
  for (const conj of ['', 'و', 'ف'])
    for (const prep of ['', 'ب', 'ل', 'ك']) {
      const head = conj + prep
      if (!token.startsWith(head)) continue
      let rest = token.slice(head.length)
      let article = false
      if (rest.startsWith('ال')) {
        article = true
        rest = rest.slice(2)
      } else if (prep === 'ل' && rest.startsWith('ل')) {
        // «للشطره» = لـ + الشطره (the alif of the article is dropped)
        article = true
        rest = rest.slice(1)
      }
      const place = placeByKey.get(rest)
      if (!place) continue
      if (!place.ambiguous || qualified) return place
      if (article && (relaxed || prep !== '' || previous === 'في' || previous === 'من')) return place
    }
  return undefined
}

function placesOf(text: string, relaxed: boolean) {
  const tokens = rawTokens(text)
  const found: Place[] = []
  tokens.forEach((token, index) => {
    const place = matchPlace(token, tokens[index - 1], relaxed)
    if (place && !found.includes(place)) found.push(place)
  })
  return found
}

/** Labels of the Dhi Qar districts a text names («إجازة بناء بالشطرة» → ['الشطرة']). */
export function placesIn(text: string, options: { relaxed?: boolean } = {}) {
  return placesOf(text, Boolean(options.relaxed)).map(place => place.label)
}

/** Places a service is local to: its department's name («مديرية بلدية الشطرة») or its own title («(قضاء الشطرة)»). */
function servicePlaceList(service: CatalogService) {
  const found = placesOf(service.departmentName, true)
  for (const place of placesOf(service.title, false)) if (!found.includes(place)) found.push(place)
  return found
}

/** Labels of the districts a service is local to (empty for a governorate-wide service). */
export function servicePlaces(service: CatalogService) {
  return servicePlaceList(service).map(place => place.label)
}

type Lexicon = {
  synonyms: Map<string, string[][]>
  stop: Set<string>
  lead: Set<string>
  variants: Array<Set<string>>
}
let lexicon: Lexicon | null = null

/** Normalised word lists, built on first use (normalizeArabic lives in catalog.ts, which imports this module). */
function lex(): Lexicon {
  if (lexicon) return lexicon
  const synonyms = new Map<string, string[][]>()
  for (const [key, aliases] of Object.entries(rawSynonyms)) {
    const token = words(key)[0]
    if (!token) continue
    const list = synonyms.get(token) || []
    for (const alias of aliases) {
      const parts = words(alias).filter(part => part.length > 1)
      if (!parts.length || (parts.length === 1 && parts[0] === token)) continue
      if (!list.some(existing => existing.join(' ') === parts.join(' '))) list.push(parts)
    }
    synonyms.set(token, list)
  }
  const normalised = (list: string[]) => new Set(list.flatMap(word => words(word)))
  lexicon = {
    synonyms,
    stop: normalised(STOP_WORDS),
    lead: normalised(LEAD_WORDS),
    variants: VARIANT_GROUPS.map(normalised),
  }
  return lexicon
}

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

/** Possessive / object endings of colloquial queries: «جوازي», «هويتي», «بطاقتنا», «بطاقته», «أجدده». */
const POSSESSIVE: Array<[string, string]> = [
  ['تي', 'ه'],
  ['تنا', 'ه'],
  ['ته', 'ه'],
  ['ي', ''],
  ['نا', ''],
  ['ه', ''],
]

/**
 * A query word as the catalog writes it: article and attached «و/ف/ب/ل/ك» dropped, possessive ending removed — each
 * only when what is left is a word the catalog (or the synonym list) knows, so «بطاقه» never becomes «طاقه».
 */
function canonical(token: string, known: (word: string) => boolean) {
  const plain = peel(stripAl(token))
  if (token.startsWith('_') || known(plain)) return plain
  const stems = [plain]
  for (const prefix of ['و', 'ف', 'ب', 'ل', 'ك'])
    if (plain.startsWith(prefix)) stems.push(stripAl(plain.slice(prefix.length)))
  for (const stem of stems) {
    if (stem !== plain && stem.length >= 3 && known(stem)) return stem
    for (const [suffix, replacement] of POSSESSIVE) {
      if (!stem.endsWith(suffix)) continue
      const base = stem.slice(0, -suffix.length) + replacement
      if (base.length >= 3 && known(base)) return base
    }
  }
  return plain
}

/** One typed word: its synonyms, the single-word ones among them, and whether it only names a variant («بدل», «تجديد»). */
type Group = { token: string; aliases: string[][]; equivalents: Set<string>; modifier: boolean }

type Indexed = {
  service: CatalogService
  title: string[]
  category: string[]
  department: string[]
  docs: string[]
  description: string[]
  /** title words without stop words, and how many generic lead words («إصدار», «حجز موعد») open it */
  titleCore: string[]
  lead: number
  /** VARIANT_GROUPS present in the title */
  variants: Set<number>
  places: Place[]
}

let cache: { at: number; items: Indexed[]; vocabulary: Set<string> } | null = null

function index() {
  if (cache && Date.now() - cache.at < 60_000) return cache
  const { stop, lead, variants } = lex()
  const vocabulary = new Set<string>()
  const items = listCatalogServices().map(service => {
    const title = words(service.title)
    const titleCore = title.filter(word => !stop.has(word))
    let leading = 0
    while (leading < titleCore.length - 1 && lead.has(titleCore[leading])) leading++
    const item: Indexed = {
      service,
      title,
      category: words(service.category),
      department: words(service.departmentName),
      docs: words(service.requiredDocuments.map(doc => doc.label).join(' ')),
      description: words(service.description),
      titleCore,
      lead: leading,
      variants: new Set(variants.flatMap((group, position) => (title.some(word => group.has(word)) ? [position] : []))),
      places: servicePlaceList(service),
    }
    for (const list of [item.title, item.category, item.department, item.docs, item.description])
      for (const word of list) vocabulary.add(word)
    return item
  })
  cache = { at: Date.now(), items, vocabulary }
  return cache
}

export function invalidateSearchIndex() {
  cache = null
}

/** Query → content words (with their synonyms) and the districts it names. */
function parseQuery(query: string) {
  const { synonyms, stop, variants } = lex()
  const { vocabulary } = index()
  const known = (word: string) => vocabulary.has(word) || synonyms.has(word)
  const raw = rawTokens(query)
  const places: Place[] = []
  const placeTokens = new Set<number>()
  raw.forEach((token, position) => {
    const place = matchPlace(token, raw[position - 1], false)
    if (!place) return
    if (!places.includes(place)) places.push(place)
    placeTokens.add(position)
    if (position > 0 && QUALIFIER.test(raw[position - 1])) placeTokens.add(position - 1)
  })
  let tokens = raw
    .filter((_, position) => !placeTokens.has(position))
    .map(token => canonical(token, known))
    .filter(token => token.length > 1 && !stop.has(token))
  // only a district was typed («الشطرة»): its offices are the answer
  const placeOnly = !tokens.length && places.length > 0
  if (placeOnly) tokens = places.map(place => place.key)
  const groups: Group[] = tokens.map(token => {
    const aliases = synonyms.get(token) || []
    return {
      token,
      aliases,
      equivalents: new Set(aliases.filter(alias => alias.length === 1).map(alias => alias[0])),
      modifier: variants.some(group => group.has(token)),
    }
  })
  return { tokens, groups, places, placeOnly }
}

export function expandQuery(query: string) {
  const { tokens, groups, places, placeOnly } = parseQuery(query)
  return {
    tokens,
    groups,
    places: places.map(place => place.label),
    /** the query names a district and nothing else («الشطرة», «بسوق الشيوخ») */
    placeOnly,
    expanded: [...new Set(groups.flatMap(group => [group.token, ...group.aliases.flat()]))],
  }
}

function fieldScore(words: string[], token: string, weight: number) {
  let best = 0
  for (const word of words) {
    if (word === token) best = Math.max(best, 1)
    else if (Math.min(word.length, token.length) >= 3 && (word.startsWith(token) || token.startsWith(word)))
      best = Math.max(best, 0.6)
    // fuzzy only between words that start alike: typos rarely hit the first letter, while
    // "قياده"/"عياده" share every other bigram and mean unrelated things
    else if (word[0] === token[0]) {
      const score = similarity(word, token)
      if (score >= 0.66) best = Math.max(best, score * 0.5)
    }
    if (best === 1) break
  }
  return best * weight
}

/** How well one title word stands for one query word: 1 same word, 0.8 a synonym, 0.6 a typo of it. */
function wordMatch(word: string, group: Group) {
  const { token } = group
  if (word === token) return 1
  if (
    Math.min(word.length, token.length) >= 4 &&
    Math.abs(word.length - token.length) <= 2 &&
    (word.startsWith(token) || token.startsWith(word))
  )
    return 1
  if (group.equivalents.has(word)) return 0.8
  if (word[0] === token[0] && similarity(word, token) >= 0.66) return 0.6
  return 0
}

/**
 * Phrase layer over the title: the exact title (+8), the title starting with the typed words in order (+3.5), the
 * typed words side by side anywhere in it (+2) — partial runs pro rata. One title word may sit inside the run
 * («البطاقة الوطنية الموحدة» for «بطاقة موحدة»). A single word only earns a bonus when it opens the title.
 */
function titleBonus(item: Indexed, groups: Group[]) {
  const title = item.titleCore
  const n = groups.length
  if (!n || !title.length) return 0
  if (n === 1) {
    const quality = item.lead < title.length ? wordMatch(title[item.lead], groups[0]) : 0
    return quality ? (title.length - item.lead === 1 ? 3 : 1) * quality : 0
  }
  let best = 0
  for (let start = 0; start < title.length; start++)
    for (let first = 0; first < n - 1; first++) {
      let next = first
      let position = start
      let quality = 1
      let gaps = 0
      let content = false
      while (next < n && position < title.length) {
        const here = wordMatch(title[position], groups[next])
        if (here) {
          quality = Math.min(quality, here)
          content ||= !groups[next].modifier
          next++
          position++
          continue
        }
        const skipped = next > first && gaps === 0 && position + 1 < title.length
        const after = skipped ? wordMatch(title[position + 1], groups[next]) : 0
        if (!after) break
        quality = Math.min(quality, after)
        content ||= !groups[next].modifier
        gaps++
        next++
        position += 2
      }
      const run = next - first
      // a run of variant words only («بدل ضائع») says nothing about which document
      if (run < 2 || !content) continue
      const atStart = start === item.lead || start === 0
      const exact = run === n && atStart && position === title.length && gaps === 0
      const value = exact ? 8 : (atStart && first === 0 ? 3.5 : 2) * (run / n) * (gaps ? 0.9 : 1)
      best = Math.max(best, value * quality)
    }
  return best
}

/** District layer: the named district's office first, other districts' offices down, governorate-wide untouched. */
function placeAdjustment(item: Indexed, places: Place[]) {
  if (!places.length)
    // nothing named: the governorate-wide service and the centre (الناصرية) before another district's office
    return item.places.length && !item.places.some(place => place.key === 'ناصريه') ? -0.3 : 0
  if (item.places.some(place => places.includes(place))) return 4.5
  if (!item.places.length) return 0
  // a ناحية was named: its قضاء's office is the next best; a قضاء was named: its نواحي are not "another district"
  if (item.places.some(place => places.some(named => named.parent === place.key))) return 3
  if (item.places.some(place => place.parent && places.some(named => named.key === place.parent))) return 0
  return -4
}

export type SearchHit = { service: CatalogService; score: number }

export function searchCatalog(query: string, limit = 12): { hits: SearchHit[]; tokens: string[] } {
  const { tokens, groups, places } = parseQuery(query)
  if (!tokens.length) return { hits: [], tokens }
  const { variants } = lex()
  // variants the citizen asked for (a typed word or one of its synonyms is in the group)
  const asked = new Set<number>()
  for (const word of groups.flatMap(group => [group.token, ...group.aliases.flat()]))
    variants.forEach((group, position) => group.has(word) && asked.add(position))
  const hits: SearchHit[] = []
  const scoreToken = (item: Indexed, token: string) =>
    fieldScore(item.title, token, 5) +
    fieldScore(item.category, token, 2) +
    fieldScore(item.department, token, 2.5) +
    fieldScore(item.docs, token, 1.2) +
    fieldScore(item.description, token, 1)
  for (const item of index().items) {
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
        // «بدل ضائع هوية»: the document (هوية) decides the service, the variant words are shared by many titles
        score += group.modifier ? best * 0.5 : best
        matched++
      }
    }
    if (score <= 0) continue
    // Every word the citizen typed (or one of its synonyms) must hit somewhere when the query is short;
    // long queries need a strict majority, so "رخصة قيادة طائرة فضائية" doesn't ride on its first two words.
    const required = tokens.length <= 2 ? tokens.length : Math.floor(tokens.length / 2) + 1
    if (matched < required) continue
    // a hit that only brushes the description with a weak fuzzy match is noise, not a result
    if (score < 1) continue
    score += titleBonus(item, groups)
    // a variant the citizen did not ask for («ترميم» for «إجازة بناء»); a title that also carries the variant he
    // did ask for («تجديد البطاقة الوطنية / بدل تالف» for «بدل ضائع») is that service, not a wrong variant
    if (![...item.variants].some(position => asked.has(position))) score -= Math.min(item.variants.size, 2) * 2.5
    score += placeAdjustment(item, places)
    if (item.service.channel === 'ONLINE_SUBMISSION') score += 0.6
    if (item.service.sourceQuality === 'OFFICIAL') score += 0.4
    if (item.service.mode !== 'CATALOG') score += 0.3
    hits.push({ service: item.service, score })
  }
  hits.sort((a, b) => b.score - a.score || a.service.title.localeCompare(b.service.title, 'ar'))
  // drop the long tail that only shares a generic word with the query (e.g. "اجازة" alone)
  const floor = hits.length ? hits[0].score * 0.4 : 0
  return { hits: hits.filter(hit => hit.score >= floor).slice(0, limit), tokens }
}
