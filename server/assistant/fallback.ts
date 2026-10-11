import { db } from '../db.js'
import { paymentProvider } from '../payments/providers.js'
import { listCatalogServices, normalizeArabic, type CatalogService } from '../services/catalog.js'
import { expandQuery, PLACE_LABELS, placesIn, servicePlaces } from '../services/search.js'
import type { ChatTurn } from './chat.js'
import { platformHelp, type PlatformHelpTopic } from './knowledge.js'
import {
  citizenRequest,
  citizenRequests,
  feeNote,
  meaningfulWords,
  searchForCitizen,
  registrationSteps,
  serviceCard,
  serviceSteps,
  type ToolContext,
  type ToolUiPayload,
} from './tools.js'

/**
 * Deterministic answers used when no API key is configured (or the model is unavailable): the same catalog search,
 * registration steps and request lookups the model's tools use, phrased from templates. Never a broken widget.
 */
export type FallbackAnswer = { text: string; ui: ToolUiPayload[] }

/** Platform questions (not a service): keyword → get_platform_help topic. Order matters (first match wins). */
const HELP_ROUTES: Array<[RegExp, PlatformHelpTopic]> = [
  [/شكوى|شكاوى|اشتكي|مقترح|بلاغ|ابلغ/, 'complaints'],
  [/ادفع|الدفع|دفع الرسم|سداد|زين ?كاش|فلوس الرسم/, 'payments'],
  [/مناقص/, 'tenders'],
  [/(^| )(اخبار|الاخبار)( |$)/, 'news'],
  [/فيديو|فديو|فيديوهات تعليميه/, 'guides'],
  [/تحقق من (وثيقه|الوثيقه|شهاده)|qr|رمز الاستجابه|باركود/, 'verify_document'],
  [/خصوصيه|بياناتي|معلوماتي الشخصيه/, 'privacy'],
  [/(ما وصلني|ما يوصل|ما اجاني).*(رمز|كود)|تسجيل الدخول|ادخل لحسابي|نسيت/, 'sign_in'],
]

function helpAnswer(topic: PlatformHelpTopic): FallbackAnswer {
  const entry = platformHelp(topic, { onlinePayment: Boolean(paymentProvider()) })
  const facts = entry.facts.map(fact => `- ${fact}`).join('\n')
  const links = entry.links.map(link => `[${link.label}](${link.path})`).join(' · ')
  return { text: `**${entry.title}**\n${facts}\n\n${links}`, ui: [] }
}

/**
 * A whole request that names no service («أريد معاملة») → one question with common services as chips. Each chip is
 * the exact catalog title of the intended service, so tapping it answers with that service (see exactTitleMatch).
 */
const VAGUE_REQUEST = /^(اريد |ابي |ابغي |عندي |احتاج )?(معامله|خدمه|طلب|معامله حكوميه|سؤال)$/
export const COMMON_SERVICES = [
  'إصدار جواز السفر الإلكتروني (لأول مرة)',
  'حجز موعد إصدار البطاقة الوطنية الموحدة (لأول مرة)',
  'طلب إجازة بناء',
  'اعتراض على قائمة أجور الماء / تصحيح القراءة',
]

/**
 * The message is exactly the title of an active service (a tapped chip, or a pasted title) → that service, before
 * any keyword route: titles such as «بلاغ انقطاع ماء…» or «متابعة حالة بلاغ مجاري» would otherwise be caught by the
 * complaints / tracking routes. Several departments can share a title: the search order picks among them.
 */
function exactTitleMatch(text: string, message: string): CatalogService[] | null {
  if (text.length < 4) return null
  const matches = listCatalogServices().filter(service => normalizeArabic(service.title) === text)
  if (!matches.length) return null
  const ranked = searchForCitizen(message, 12).filter(hit => matches.some(service => service.key === hit.key))
  return [...ranked, ...matches.filter(service => !ranked.some(hit => hit.key === service.key))]
}

/** A follow-up question shown under an answer (its options are chips); it sits before the answer's action line. */
type FollowUp = { question: string; lead: string; options: string[] }

/**
 * The citizen's own recent words, read together: a short reply continues his previous request — «الشطرة» after
 * «إجازة بناء» (and «بأي قضاء؟»), «تجديد» after «جواز» (and «أول مرة لو تجديد؟»), «شنو الرسوم» after a service. The
 * reply joins the earlier request only when the joined search lands on a service of that request; otherwise it is a
 * new subject and stands alone («شهادة ميلاد» after «جواز»). Chains over the last few messages.
 */
export function withConversation(message: string, previous: ChatTurn[] = []) {
  const earlier = previous
    .filter(turn => turn.role === 'user')
    .slice(-3)
    .map(turn => turn.text)
  let topic = ''
  for (const text of [...earlier, message]) topic = continueTopic(topic, text)
  return topic
}

const contentWords = (text: string) =>
  normalizeArabic(text)
    .split(' ')
    .filter(word => word && !FALLBACK_FILLER.has(word))

function continueTopic(topic: string, text: string) {
  if (!topic.trim()) return text
  const words = contentWords(text)
  if (!words.length || words.length > 4) return text
  // a tapped chip (a full service title) names its service by itself
  if (listCatalogServices().some(service => normalizeArabic(service.title) === normalizeArabic(text))) return text
  const joined = `${topic} ${text}`
  const top = searchForCitizen(joined, 1)[0]
  // the joined request must still be the earlier request…
  if (!top || !searchForCitizen(topic, 40).some(service => service.key === top.key)) return text
  // …refined by the reply: a district («الشطرة»), a pure follow-up («شنو الرسوم») or words that point at the same
  // service on their own («تجديد»); «بطاقة تموينية» after «إجازة بناء» points elsewhere and stands alone
  if (expandQuery(text).placeOnly || !meaningfulWords(text).length) return joined
  const alone = searchForCitizen(text, 40)
  return !alone.length || alone.some(service => service.key === top.key) ? joined : text
}

/** The district on the signed-in citizen's account when it names a real Dhi Qar place (not «غير محدد»). */
function accountDistrict(citizenId: number | null) {
  if (!citizenId) return null
  try {
    const row = db.prepare('SELECT district FROM citizens WHERE id = ?').get(citizenId) as
      { district?: string | null } | undefined
    return placesIn(String(row?.district || ''), { relaxed: true })[0] || null
  } catch {
    return null
  }
}

const PASSPORT = /(^| )[وبل]?(ال)?(جواز|جوازي|جوازات|باسبورت)( |$)/
/** words that already say which passport service: first issue, renewal, lost/damaged, urgent, a child's, correction */
const PASSPORT_VARIANT =
  /(^| )[وبلف]?(ال)?(اول|جديد|تجديد|اجدد|جدد|منتهي|خلص|بدل|ضايع|ضاع|فاقد|مفقود|فقدان|تالف|مستعجل|يوم واحد|قاصر|طفل|اطفال|صغير|ابني|بنتي|تصحيح|بيانات)/
const PASSPORT_QUESTION = 'أول مرة لو تجديد؟'
/** title patterns of the passport chips, in the order offered: first issue, renewal, lost/damaged, a minor's */
const PASSPORT_CHOICES: Array<(title: string) => boolean> = [
  title => title.includes('اول مره') && !title.includes('قاصر'),
  title => title.includes('تجديد'),
  title => title.includes('بدل'),
  title => title.includes('قاصر'),
]

/** «جواز» without saying first issue or renewal → «أول مرة لو تجديد؟» with the real passport titles as chips. */
function passportFollowUp(query: string): FollowUp | null {
  const text = normalizeArabic(query)
  if (!PASSPORT.test(text) || PASSPORT_VARIANT.test(text)) return null
  const titles = [...new Set(searchForCitizen('جواز سفر', 12).map(service => service.title))]
  const options = PASSPORT_CHOICES.map(choice => titles.find(title => choice(normalizeArabic(title)))).filter(
    (title): title is string => Boolean(title)
  )
  if (options.length < 2) return null
  return {
    question: PASSPORT_QUESTION,
    lead: `**${PASSPORT_QUESTION}** المستمسكات تختلف؛ اختار من تحت حتى أعطيك الخدمة الصحيحة.`,
    options: [...new Set(options)],
  }
}

/**
 * The best services are one per district (the same title at several municipalities / offices) and neither the
 * question nor the account names a district → «بأي قضاء؟» with district chips; the reply joins the request.
 */
function districtFollowUp(hits: CatalogService[], query: string, district: string | null): FollowUp | null {
  if (district || placesIn(query).length) return null
  const all = listCatalogServices()
  for (const hit of hits.slice(0, 3)) {
    const title = normalizeArabic(hit.title)
    const labels = [
      ...new Set(all.filter(service => normalizeArabic(service.title) === title).flatMap(servicePlaces)),
    ].sort((a, b) => PLACE_LABELS.indexOf(a) - PLACE_LABELS.indexOf(b))
    if (labels.length >= 2)
      return {
        question: 'بأي قضاء؟',
        lead: '**بأي قضاء؟** كل قضاء إله دائرته؛ اختار قضاءك أو اكتب اسمه حتى أوجهك لدائرته.',
        options: labels.slice(0, 4),
      }
  }
  return null
}

/**
 * One generic word that matches several different services («هوية», «اجازة») → ask which one, with the real
 * service titles as chips (each chip is a full title, so the next fallback answer lands on it exactly).
 */
function clarifyFallback(text: string, message: string): FallbackAnswer | null {
  if (VAGUE_REQUEST.test(text))
    return {
      text: 'أكيد، بس شنو المعاملة اللي تحتاجها؟',
      ui: [{ kind: 'clarify', question: 'أكيد، بس شنو المعاملة اللي تحتاجها؟', options: COMMON_SERVICES }],
    }
  const words = text.split(' ').filter(word => word && !FALLBACK_FILLER.has(word))
  if (words.length !== 1) return null
  const titles = [...new Set(searchForCitizen(message, 6).map(service => service.title))]
  if (titles.length < 3) return null
  const question = 'عندنا أكثر من خدمة بهذا الاسم. أي وحدة تقصد؟'
  return { text: question, ui: [{ kind: 'clarify', question, options: titles.slice(0, 4) }] }
}
const FALLBACK_FILLER = new Set('اريد ابي ابغي احتاج شنو شلون كيف عن بخصوص معامله'.split(' '))

const REFERENCE = /\b(TQS|APP|SR)[-\s]?\d{4}[-\s]?\d{3,6}\b/i
const has = (text: string, pattern: RegExp) => pattern.test(text)

/**
 * `previous`: the conversation before this message (oldest first), so a short reply to a clarifying question
 * («الشطرة», «تجديد») continues the request it answers instead of being searched alone.
 */
export function fallbackAnswer(
  message: string,
  context: ToolContext,
  channel: 'text' | 'voice' = 'text',
  previous: ChatTurn[] = []
): FallbackAnswer {
  const text = normalizeArabic(message)
  const reference = message.match(REFERENCE)?.[0]
  // the signed-in citizen's district ranks his district's office first, and is never asked for
  const district = accountDistrict(context.citizenId)

  if (has(text, /حريق|طوارئ|طارئ|اسعاف|حادث|نجده|انفجار|غريق/))
    return {
      text: 'إذا أكو خطر على الحياة اتصل فوراً:\n- **الشرطة 104**\n- **الإسعاف 122**\n- **الدفاع المدني 115**\n\nبعدها إذا تحتاج خدمة من المنصة آني حاضر.',
      ui: [],
    }

  if (has(text, /otp|رمز|كود|باسورد|كلمه السر|كلمه المرور/) && has(text, /\d{4,}/))
    return {
      text: 'لا تشارك رمز التحقق أو كلمة المرور بالمحادثة أبداً. المنصة ما تطلبها منك هنا؛ الرمز يُكتب بصفحة الدخول فقط.',
      ui: [],
    }

  // a chip (or a pasted title) names one service exactly: answer with it before any keyword route
  const titled = exactTitleMatch(text, district ? `${message} ${district}` : message)
  if (titled) {
    const nearby = searchForCitizen(message, 4).filter(hit => !titled.some(service => service.key === hit.key))
    const hits = [...titled, ...nearby].slice(0, 4)
    return serviceAnswer(hits, context, channel, districtFollowUp(hits, message, district))
  }

  if (reference || has(text, /معاملتي|معاملاتي|طلبي|طلباتي|تابع|متابعه|شصار|شنو صار|وين وصل|حاله الطلب/)) {
    if (!context.citizenId)
      return {
        text: 'حتى أتابع معاملتك لازم تسجّل دخولك أولاً برقم هاتفك.\n\n[سجّل الدخول](/onboarding) وبعدها اسألني عن رقم الطلب، أو افتح [معاملاتي](/citizen).',
        ui: [],
      }
    if (reference) {
      const item = citizenRequest(context.citizenId, reference.replace(/\s+/g, '-'))
      if (!item)
        return {
          text: `ما لقيت طلب برقم **${reference}** ضمن حسابك. تأكد من الرقم أو افتح [معاملاتي](/citizen).`,
          ui: [],
        }
      const missing = item.missingDocuments.length ? `\n\nناقصة بس: ${item.missingDocuments.join('، ')}.` : ''
      return {
        text: `طلبك **${item.reference}** (${item.serviceName}): **${item.statusLabel}**.\n${item.currentAction}${missing}`,
        ui: [{ kind: 'requests', items: [item] }],
      }
    }
    const items = citizenRequests(context.citizenId, 5)
    if (!items.length)
      return {
        text: 'ما عندك طلبات بعد. قلّي شنو الخدمة اللي تحتاجها وأدلك عليها، أو تصفح [دليل الخدمات](/directory).',
        ui: [],
      }
    return {
      text: `عندك ${items.length.toLocaleString('en-US')} طلبات حديثة. هذي حالتها:`,
      ui: [{ kind: 'requests', items }],
    }
  }

  if (
    has(
      text,
      /(كيف|شلون|اشلون|اريد|ابي|ممكن).*(اسجل|سجل|حساب|اوثق|توثيق)|انشاء حساب|تسجيل الدخول|توثيق الهويه|ما يقبل الرمز|ما وصلني الرمز/
    ) ||
    text === 'كيف اسجل' ||
    text === 'التسجيل'
  )
    return {
      text: `خطوات التسجيل بالمنصة:\n${registrationSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n\n[ابدأ التسجيل](/onboarding)`,
      ui: [{ kind: 'registration' }],
    }

  if (text.split(' ').length <= 3 && has(text, /^(هلا|اهلا|مرحبا|السلام|سلام|هاي|صباح|مساء|شلونك)/))
    return {
      text: 'هلا بيك! آني **أفندي**، مساعد منصة ذي قار الرقمية. اكتب اسم الخدمة اللي تحتاجها (مثلاً: جواز، إجازة بناء، شهادة ولادة) وأطلعلك المستمسكات والخطوات.',
      ui: [],
    }

  const help = HELP_ROUTES.find(([pattern]) => has(text, pattern))
  if (help) return helpAnswer(help[1])

  // from here on the request is read with the conversation: «الشطرة» after «إجازة بناء» is «إجازة بناء الشطرة»
  const query = withConversation(message, previous)

  const passport = passportFollowUp(query)
  if (passport && contentWords(query).length === 1)
    return {
      text: passport.question,
      ui: [{ kind: 'clarify', question: passport.question, options: passport.options }],
    }

  const clarify = passport ? null : clarifyFallback(normalizeArabic(query), query)
  if (clarify) return clarify

  const hits = searchForCitizen(district && !placesIn(query).length ? `${query} ${district}` : query, 4)
  if (!hits.length)
    return {
      text: 'ما لقيت خدمة مطابقة لكلامك. جرّب تكتبها بكلمات ثانية (مثلاً: «بدل ضائع هوية» أو «اشتراك ماء»)، أو تصفح [دليل الخدمات](/directory).',
      ui: [],
    }
  return serviceAnswer(hits, context, channel, passport || districtFollowUp(hits, query, district))
}

/**
 * The practical answer about the best hit (steps, documents, where to go, one action); `hits[0]` is the service.
 * A follow-up question («بأي قضاء؟», «أول مرة لو تجديد؟») goes right before the action line, its options as chips.
 */
function serviceAnswer(
  hits: CatalogService[],
  context: ToolContext,
  channel: 'text' | 'voice',
  followUp: FollowUp | null = null
): FallbackAnswer {
  const top = hits[0]
  const ask = followUp ? `${channel === 'voice' ? `${followUp.question} اختار من تحت.` : followUp.lead}\n\n` : ''
  const chips: ToolUiPayload[] = followUp
    ? [{ kind: 'clarify', question: followUp.question, options: followUp.options }]
    : []
  const documents = top.requiredDocuments.length
    ? top.requiredDocuments
        .slice(0, 8)
        .map(doc => `- ${doc.label}${doc.required ? '' : ' (اختياري)'}`)
        .join('\n')
    : '- لا توجد مستمسكات مسجلة لهذه الخدمة — راجع الدائرة للتأكد.'
  // at most 5 steps; an appointment service keeps its last step (the attendance) instead of «تابع من معاملاتي»
  const allSteps = serviceSteps(top)
  const shownSteps = allSteps.length > 5 ? [...allSteps.slice(0, 4), allSteps[allSteps.length - 1]] : allSteps
  const steps = shownSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')
  const official = top.feeStatus === 'OFFICIAL' && top.feeIqd ? `\n**الرسم:** ${feeNote(top)}` : ''
  const duration = top.estimatedDuration ? `\n**المدة:** ${top.estimatedDuration}` : ''
  const where =
    top.channel === 'INFORMATION_ONLY'
      ? `**وين تراجع:** ${top.departmentName}`
      : top.channel === 'APPOINTMENT_REQUIRED'
        ? `**وين تراجع:** تقديم إلكتروني من المنصة، ثم حضور بموعد في ${top.departmentName}`
        : `**وين تراجع:** إلكترونياً من المنصة`
  const nearby = [...new Set(hits.slice(1).map(service => service.title))].filter(title => title !== top.title)
  const others = nearby.length ? `\n\nخدمات قريبة: ${nearby.join('، ')}.` : ''
  const servicePath = `/service/${top.key}`
  const next =
    top.channel === 'INFORMATION_ONLY'
      ? `[تفاصيل الخدمة](${servicePath})`
      : context.citizenId
        ? `[افتح الخدمة وقدّم](${servicePath})`
        : `[سجّل وابدأ الطلب](/onboarding?continue=${encodeURIComponent(servicePath)})`
  if (channel === 'voice') {
    // read aloud: a few short sentences; the card under the answer carries the full list
    const how =
      top.channel === 'INFORMATION_ONLY'
        ? 'تنجزها بمراجعة الدائرة نفسها.'
        : top.channel === 'APPOINTMENT_REQUIRED'
          ? 'تقدّم عليها إلكترونياً وبعدها تراجع بموعد.'
          : 'تقدّم عليها إلكترونياً من المنصة.'
    const main = top.requiredDocuments
      .filter(doc => doc.required)
      .slice(0, 3)
      .map(doc => doc.label)
    const docs = main.length ? ` أهم المستمسكات: ${main.join('، ')}.` : ''
    const fee = official ? ` الرسم ${feeNote(top)}.` : ''
    return {
      text: `أقرب خدمة لطلبك **${top.title}** من ${top.departmentName}. ${how}${docs}${fee} التفاصيل بالبطاقة تحت.\n\n${ask}${next}`,
      ui: [{ kind: 'services', items: hits.slice(0, 3).map(serviceCard) }, ...chips],
    }
  }
  return {
    text: `أقرب خدمة لطلبك: **${top.title}** — ${top.departmentName}.\n\n**الخطوات:**\n${steps}\n\n**المستمسكات:**\n${documents}\n\n${where}${official}${duration}${others}\n\n${ask}${next}`,
    ui: [{ kind: 'services', items: hits.slice(0, 3).map(serviceCard) }, ...chips],
  }
}
