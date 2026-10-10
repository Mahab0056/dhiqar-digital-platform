/**
 * Text helpers for the news aggregator: Arabic normalisation, Dhi Qar relevance, tender classification,
 * excerpts and title keys for de-duplication. Pure functions (no I/O) so they are easy to test.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  zwnj: '‌',
  zwj: '‍',
  rlm: '',
  lrm: '',
}

/** Decodes XML/HTML character references (named, decimal and hex). Unknown names are left as they are. */
export function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ''
      try {
        return String.fromCodePoint(code)
      } catch {
        return ''
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()]
    return named === undefined ? match : named
  })
}

/** Removes tags, scripts and styles and collapses whitespace. The input may itself be entity-encoded HTML. */
export function stripHtml(value: string) {
  return decodeEntities(
    value
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h\d)>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/<[^>]*>/g, ' ')
    .replace(/[‎‏‪-‮]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Cuts at a word boundary and appends an ellipsis. */
export function makeExcerpt(value: string, max = 180) {
  const text = stripHtml(value)
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s،,.:;-]+$/, '')}…`
}

/** Arabic search form: no diacritics/tatweel, unified alef/yaa/taa marbuta, lower-case Latin. */
export function normalizeArabic(value: string) {
  return value
    .replace(/[ً-ٰٟۖ-ۭ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
}

/** Key for "same story from another link": letters and digits only, first 70 characters. */
export function titleKey(title: string) {
  return normalizeArabic(stripHtml(title))
    .replace(/^(عاجل|خاص|بالصور|بالفيديو|فيديو|صور)\s*[:|-]?\s*/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 70)
}

// Letters on either side mean another word (e.g. «جغرافية» contains «غراف»). Arabic proclitics
// (و ف ب ل ك + ال / لل) are allowed in front of a place name.
const LETTER_BEFORE = '(?<![\\p{L}])'
const LETTER_AFTER = '(?![\\p{L}])'
const PREFIX = '(?:[وفبلك])?(?:ال|ل)?'
const word = (base: string) => new RegExp(`${LETTER_BEFORE}${PREFIX}${base}${LETTER_AFTER}`, 'u')

/** Unambiguous names in the governorate (normalised spelling, without the article). */
const STRONG_PLACES = [
  'ذي ?قار',
  'ذيقار',
  'ناصريه',
  'شطره',
  'سوق الشيوخ',
  'جبايش',
  'غراف',
  'قلعه سكر',
  'دوايه',
  'بطحاء',
  'فهود',
  'سيد دخيل',
  'زقوره اور',
  'مدينه اور الاثريه',
].map(word)
const NASIRIYAH_PATTERN = STRONG_PLACES[2]

/**
 * Names that are also common words or surnames (النصر، الفجر، الإصلاح، الرفاعي، أور، الأهوار): they only
 * count with an administrative qualifier in front («قضاء الرفاعي»، «ناحية الفجر»).
 */
const QUALIFIED_PLACES = ['رفاعي', 'نصر', 'فجر', 'اصلاح', 'اور', 'كرمه بني سعيد', 'عكيكه', 'طار'].map(
  base => new RegExp(`(?:قضاء|ناحيه|مدينه|اهالي)\\s+(?:ال)?${base}${LETTER_AFTER}`, 'u')
)

/** «الناصرية» is also Nasserism: political-ideology context does not count as the city. */
const NASSERISM = /عبد ?الناصر|ناصريين|ناصريون|التيار الناصري|الحزب الناصري|القوميه|قرضاوي/u

/** True when the text names a place in Dhi Qar. */
export function mentionsDhiQar(text: string) {
  const normalized = normalizeArabic(stripHtml(text))
  const strong = STRONG_PLACES.filter(pattern => pattern.test(normalized))
  if (strong.length === 1 && strong[0] === NASIRIYAH_PATTERN && NASSERISM.test(normalized)) return false
  return strong.length > 0 || QUALIFIED_PLACES.some(p => p.test(normalized))
}

const TENDER_PATTERN = /مناقصه|مناقصات|مزايده|مزايدات|مزاد|دعوه عامه|اعلان دعوه|عطاءات/u

/** TENDER when the headline announces a tender, auction or call for bids; NEWS otherwise. */
export function classifyKind(title: string): 'NEWS' | 'TENDER' {
  return TENDER_PATTERN.test(normalizeArabic(stripHtml(title))) ? 'TENDER' : 'NEWS'
}

/** Accepts only absolute https URLs (images are shown on an https page; anything else is dropped). */
export function httpsUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(decodeEntities(value.trim()))
    if (url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

/** Absolute http(s) URL or null. */
export function webUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(decodeEntities(value.trim()))
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}
