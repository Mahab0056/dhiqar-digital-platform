import { normalizeArabic } from '../services/catalog.js'
import {
  citizenRequest,
  citizenRequests,
  feeNote,
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

const REFERENCE = /\b(TQS|APP|SR)[-\s]?\d{4}[-\s]?\d{3,6}\b/i
const has = (text: string, pattern: RegExp) => pattern.test(text)

export function fallbackAnswer(message: string, context: ToolContext): FallbackAnswer {
  const text = normalizeArabic(message)
  const reference = message.match(REFERENCE)?.[0]

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
    if (!items.length) return { text: 'ما عندك طلبات بعد. قلّي شنو الخدمة اللي تحتاجها وأدلك عليها.', ui: [] }
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
      text: 'هلا بيك! آني مساعد ذي قار الآلي. اكتب اسم الخدمة اللي تحتاجها (مثلاً: جواز، إجازة بناء، شهادة ولادة) وأطلعلك المستمسكات والخطوات.',
      ui: [],
    }

  const hits = searchForCitizen(message, 4)
  if (!hits.length)
    return {
      text: 'ما لقيت خدمة مطابقة لكلامك. جرّب تكتبها بكلمات ثانية (مثلاً: «بدل ضائع هوية» أو «اشتراك ماء»)، أو تصفح [دليل الخدمات](/directory).',
      ui: [],
    }
  const top = hits[0]
  const documents = top.requiredDocuments.length
    ? top.requiredDocuments
        .slice(0, 8)
        .map(doc => `- ${doc.label}${doc.required ? '' : ' (اختياري)'}`)
        .join('\n')
    : '- لا توجد مستمسكات مسجلة لهذه الخدمة — راجع الدائرة للتأكد.'
  const steps = serviceSteps(top)
    .slice(0, 4)
    .map((step, index) => `${index + 1}. ${step}`)
    .join('\n')
  const nearby = [...new Set(hits.slice(1).map(service => service.title))].filter(title => title !== top.title)
  const others = nearby.length ? `\n\nخدمات قريبة: ${nearby.join('، ')}.` : ''
  return {
    text: `أقرب خدمة لطلبك: **${top.title}** — ${top.departmentName}.\n\n**المستمسكات:**\n${documents}\n\n**الرسم:** ${feeNote(top)}\n\n**الخطوات:**\n${steps}${others}`,
    ui: [{ kind: 'services', items: hits.slice(0, 3).map(serviceCard) }],
  }
}
