import { departmentRegistry } from '../department-registry.js'
import type { DocumentModel, DocumentMode } from './render.js'
import { documentTitleFor, getTemplate } from './templates.js'
import { holderDigestOf, signDocument } from './token.js'

/**
 * Serial department code printed in every document number (TQD-<CODE>-<YYYY>-<SEQ>) and keying its counter, so it
 * must name exactly one issuing authority. Derived from the id ("dhiqar-health" → HEA, "nasiriyah-municipality" →
 * NM), with explicit codes where the derivation is ambiguous (Provincial Council vs Police Command, Shia vs Sunni
 * Endowment, Nasiriyah vs Nasr…). Codes are unique across the registry: a department added later whose derived code
 * is already taken gets a numeric suffix (tests/documents-review-crosscut pins that no suffix is needed today).
 */
const STOP = new Set(['dhi', 'qar', 'dhiqar', 'of', 'the', 'al', 'directorate', 'department', 'office', 'branch'])
export const DEPARTMENT_CODE_OVERRIDES: Readonly<Record<string, string>> = {
  'dhiqar-governorate': 'GOV',
  'dhi-qar-provincial-council': 'PC',
  'dhi-qar-police-command': 'POL',
  'nasiriyah-qaimaqamiya': 'NQ',
  'nasr-qaimaqamiya': 'NSQ',
  'fuhud-qaimaqamiya': 'FHQ',
  'fajr-qaimaqamiya': 'FJQ',
  'nasiriyah-municipality': 'NM',
  'nasr-municipality': 'NSM',
  'nasiriyah-museum': 'NMU',
  'shia-endowment-dhi-qar': 'SHE',
  'sunni-endowment-dhi-qar': 'SUE',
}

/** The code an id gets on its own (override, else initials), before registry-wide de-duplication. */
export function derivedDepartmentCode(departmentId: string | null | undefined) {
  if (departmentId && DEPARTMENT_CODE_OVERRIDES[departmentId]) return DEPARTMENT_CODE_OVERRIDES[departmentId]
  const parts = String(departmentId || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(part => part && !STOP.has(part))
  if (!parts.length) return 'TQ'
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase()
  return parts
    .slice(0, 4)
    .map(part => part[0])
    .join('')
    .toUpperCase()
}

let registryCodes: Map<string, string> | null = null
/** Registry order decides who keeps a contested code, so existing departments never change code. */
function codesOfRegistry() {
  if (registryCodes) return registryCodes
  const codes = new Map<string, string>()
  const taken = new Set<string>()
  for (const item of departmentRegistry) {
    const base = derivedDepartmentCode(item.id)
    let code = base
    for (let suffix = 2; taken.has(code); suffix += 1) code = `${base}${suffix}`
    taken.add(code)
    codes.set(item.id, code)
  }
  registryCodes = codes
  return codes
}

export function departmentCode(departmentId: string | null | undefined) {
  return (departmentId && codesOfRegistry().get(departmentId)) || derivedDepartmentCode(departmentId)
}

type SampleSeed = {
  departmentId: string
  departmentName: string
  serviceName: string
  details: Array<{ label: string; value: string }>
  title?: string
  reason?: string
  referralTo?: string
  appointment?: boolean
}

const SAMPLES: Record<string, SampleSeed> = {
  'shop-licence': {
    departmentId: 'nasiriyah-municipality',
    departmentName: 'مديرية بلدية الناصرية',
    serviceName: 'إجازة فتح محل تجاري',
    details: [
      { label: 'اسم المحل', value: 'أسواق الفرات للمواد الغذائية' },
      { label: 'نوع النشاط', value: 'بيع المواد الغذائية بالمفرد' },
      { label: 'نوع الإشغال', value: 'إيجار' },
    ],
  },
  'profession-licence': {
    departmentId: 'nasr-municipality',
    departmentName: 'مديرية بلدية النصر',
    serviceName: 'إجازة ممارسة مهنة (محل تجاري/صناعي/فندق)',
    details: [
      { label: 'المهنة', value: 'صيانة الأجهزة الإلكترونية والهواتف' },
      { label: 'اسم المحل', value: 'ورشة النور للصيانة' },
    ],
  },
  'building-permit': {
    departmentId: 'nasr-municipality',
    departmentName: 'مديرية بلدية النصر',
    serviceName: 'إجازة بناء دار سكنية / بناء جديد',
    details: [
      { label: 'رقم القطعة والمقاطعة', value: '1452 / م 27 النصر' },
      { label: 'مساحة القطعة', value: '200 م2' },
      { label: 'عدد الطوابق', value: 'طابقان (أرضي + أول)' },
    ],
  },
  'renovation-permit': {
    departmentId: 'shatrah-municipality',
    departmentName: 'مديرية بلدية الشطرة',
    serviceName: 'إجازة ترميم أو إضافة بناء',
    details: [
      { label: 'نوع الأعمال', value: 'إضافة طابق أول وترميم الواجهة' },
      { label: 'المساحة المضافة', value: '120 م2' },
    ],
  },
  'general-licence': {
    departmentId: 'dhiqar-health',
    departmentName: 'دائرة صحة ذي قار',
    serviceName: 'ترخيص صيدلية أهلية (فتح / تجديد)',
    details: [
      { label: 'اسم الصيدلية', value: 'صيدلية الشفاء' },
      { label: 'الصيدلاني المسؤول', value: 'د. زينب عبد الأمير' },
    ],
  },
  'preliminary-approval': {
    departmentId: 'dhiqar-investment',
    departmentName: 'هيئة استثمار ذي قار',
    serviceName: 'طلب موافقة مبدئية على تخصيص أرض للمشروع',
    details: [
      { label: 'نوع المشروع', value: 'مجمع سكني استثماري' },
      { label: 'المساحة المطلوبة', value: '2 دونم' },
    ],
  },
  'technical-approval': {
    departmentId: 'dhi-qar-civil-defense-directorate',
    departmentName: 'مديرية الدفاع المدني في ذي قار',
    serviceName: 'كتاب سلامة (موافقة الدفاع المدني) لمحل تجاري أو مشروع',
    details: [
      { label: 'نوع النشاط', value: 'مطعم ومشويات' },
      { label: 'نتيجة الكشف', value: 'مطابق لشروط السلامة ومعدات الإطفاء متوفرة' },
    ],
  },
  'endorsement-letter': {
    departmentId: 'nasiriyah-qaimaqamiya',
    departmentName: 'قائممقامية قضاء الناصرية',
    serviceName: 'تصديق تأييد السكن',
    details: [
      { label: 'محل السكن', value: 'الناصرية — حي أور، محلة 213' },
      { label: 'مدة السكن', value: 'منذ عام 2015' },
    ],
  },
  certificate: {
    departmentId: 'dhiqar-health',
    departmentName: 'دائرة صحة ذي قار',
    serviceName: 'شهادة اللياقة الصحية (للتوظيف أو السفر أو الدراسة)',
    details: [
      { label: 'الغرض', value: 'التعيين في دائرة حكومية' },
      { label: 'نتيجة الفحص', value: 'لائق صحياً' },
    ],
  },
  clearance: {
    departmentId: 'tax-authority-dhi-qar-branch',
    departmentName: 'الهيئة العامة للضرائب – فرع ذي قار',
    serviceName: 'براءة ذمة ضريبية',
    details: [
      { label: 'الغرض', value: 'تجديد إجازة محل' },
      { label: 'السنة الضريبية', value: '2026' },
    ],
  },
  receipt: {
    departmentId: 'dhiqar-water',
    departmentName: 'مديرية ماء ذي قار',
    serviceName: 'طلب نصب عداد (مقياس) مائي على الاشتراك',
    details: [
      { label: 'المستمسكات المستلمة', value: '4 مستمسكات' },
      { label: 'الإنجاز المتوقع', value: 'خلال 5 أيام عمل' },
    ],
  },
  'appointment-notice': {
    departmentId: 'dhi-qar-passports-directorate',
    departmentName: 'مديرية جوازات ذي قار',
    serviceName: 'تجديد جواز السفر الإلكتروني',
    details: [],
    appointment: true,
  },
  'rejection-decision': {
    departmentId: 'nasiriyah-municipality',
    departmentName: 'مديرية بلدية الناصرية',
    serviceName: 'إجازة ترميم أو إضافة بناء',
    details: [],
    reason:
      'عدم مطابقة سند العائدية لموقع العقار المثبت في الطلب، وعدم إرفاق مخطط هندسي مصدّق من نقابة المهندسين العراقيين.',
  },
  'referral-letter': {
    departmentId: 'dhiqar-governorate',
    departmentName: 'ديوان محافظة ذي قار',
    serviceName: 'طلب إفادة حكومية (تأييد رسمي)',
    details: [{ label: 'سبب الإحالة', value: 'استكمال إجراءات التأييد العقاري' }],
    referralTo: 'مديرية التسجيل العقاري الأولى في ذي قار',
  },
  'allocation-decision': {
    departmentId: 'dhiqar-governorate',
    departmentName: 'ديوان محافظة ذي قار',
    serviceName: 'التقديم على قطع الأراضي السكنية',
    details: [
      { label: 'رقم القطعة', value: '87 / حي الشهداء' },
      { label: 'المساحة', value: '200 م2' },
    ],
  },
  'completion-notice': {
    departmentId: 'main-supply-center-dhi-qar',
    departmentName: 'مركز التموين الرئيسي – فرع ذي قار',
    serviceName: 'إضافة فرد (مولود جديد / زوجة) إلى البطاقة التموينية',
    details: [{ label: 'نتيجة المعاملة', value: 'تمت إضافة الفرد إلى البطاقة التموينية' }],
  },
  'id-card': {
    departmentId: 'nasiriyah-chamber-of-commerce',
    departmentName: 'غرفة تجارة الناصرية',
    serviceName: 'تجديد هوية غرفة التجارة',
    details: [],
    title: 'هوية عضوية غرفة التجارة',
  },
}

export type SampleOverrides = {
  departmentId?: string | null
  departmentName?: string | null
  serviceName?: string | null
  title?: string | null
  conditions?: string[] | null
  validityDays?: number | null
  signerTitle?: string | null
  /** named signer configured by the department; without one the sample prints the title alone, as issued ones do */
  signerName?: string | null
  mode?: DocumentMode
}

const addDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86_400_000).toISOString()

/** A complete, clearly-fake model for the gallery/samples (watermarked SAMPLE unless told otherwise). */
export function sampleModel(templateId: string, overrides: SampleOverrides = {}): DocumentModel {
  const template = getTemplate(templateId)
  const seed = SAMPLES[template.id] || SAMPLES['completion-notice']
  const issuedAt = '2026-10-10T08:30:00.000Z'
  const validity = overrides.validityDays === undefined ? template.defaultValidityDays : overrides.validityDays
  const expiresAt = validity ? addDays(issuedAt, validity) : null
  const departmentId = overrides.departmentId || seed.departmentId
  const serviceName = overrides.serviceName || seed.serviceName
  const documentNumber = `TQD-${departmentCode(departmentId)}-2026-000184`
  const signed = signDocument({
    docKey: 'SAMPLE2026XQ7KTD'.slice(0, 16).replace(/[01IO]/g, 'X'),
    documentNumber,
    templateId: template.id,
    departmentId,
    issuedAt,
    expiresAt,
    holderDigest: holderDigestOf(0, 'sample'),
  })
  return {
    template,
    title: documentTitleFor(template, serviceName, overrides.title || seed.title),
    serviceName,
    departmentName: overrides.departmentName || seed.departmentName,
    holderName: 'علي حسين كاظم الركابي',
    holderIdLast4: '4821',
    reference: 'SR-2026-000184',
    district: 'الناصرية',
    location: 'الناصرية — حي الشموخ، شارع 20، محلة 211',
    details: seed.details,
    conditions: overrides.conditions?.length ? overrides.conditions : template.defaultConditions,
    fees: { amountIqd: template.family === 'RECEIPT' ? 25000 : 50000, receiptNumber: '004571' },
    signerTitle: overrides.signerTitle || template.defaultSignerTitle,
    signerName: overrides.signerName || null,
    documentNumber,
    issuedAt,
    expiresAt,
    token: signed.token,
    manualCode: signed.manualCode,
    appointment: seed.appointment
      ? { date: '2026-10-13', time: '09:30', place: 'الطابق الأرضي — شعبة الإصدار، الشباك 3' }
      : null,
    reason: seed.reason || null,
    referralTo: seed.referralTo || null,
    mode: overrides.mode || 'SAMPLE',
  }
}
