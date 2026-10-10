import { z } from 'zod'
import type Anthropic from '@anthropic-ai/sdk'
import { db } from '../db.js'
import { listPublicDepartments } from '../departments.js'
import { getCatalogService, normalizeArabic, type CatalogService } from '../services/catalog.js'
import { searchCatalog } from '../services/search.js'

/**
 * Server-executed, read-only tools of the citizen assistant. The tool list is the SAME for every request (sorted by
 * name) so the cached prompt prefix (tools → system) is shared across all citizens; tools that need a signed-in
 * citizen answer with an error result instead of being hidden. No tool writes to the database: the request draft is
 * a preview the citizen reviews and submits through the normal service page.
 */
export type ToolContext = { citizenId: number | null }

export type ServiceCard = {
  key: string
  title: string
  departmentName: string
  category: string
  channel: CatalogService['channel']
  channelLabel: string
  feeLabel: string | null
  estimatedDuration: string | null
  documents: Array<{ label: string; required: boolean }>
}

export type RequestSummary = {
  reference: string
  serviceKey: string
  serviceName: string
  departmentName: string
  status: string
  statusLabel: string
  currentAction: string
  missingDocuments: string[]
  updatedAt: string
}

export type DraftPreview = {
  serviceKey: string
  serviceTitle: string
  departmentName: string
  answers: Array<{ key: string; label: string; value: string }>
  missingFields: string[]
  documents: Array<{ label: string; required: boolean }>
}

/** What the UI renders next to the text (cards), separate from what the model reads. */
export type ToolUiPayload =
  | { kind: 'services'; items: ServiceCard[] }
  | { kind: 'requests'; items: RequestSummary[] }
  | { kind: 'draft'; draft: DraftPreview }
  | { kind: 'registration' }

export type ToolOutcome = { content: unknown; isError?: boolean; ui?: ToolUiPayload }

const channelLabels: Record<CatalogService['channel'], string> = {
  ONLINE_SUBMISSION: 'تقديم إلكتروني كامل',
  APPOINTMENT_REQUIRED: 'تقديم إلكتروني ثم حضور بموعد',
  INFORMATION_ONLY: 'معلومات فقط — تُنجز بمراجعة الدائرة',
}

export const requestStatusLabels: Record<string, string> = {
  SUBMITTED: 'تم التقديم — بانتظار الدائرة',
  UNDER_REVIEW: 'قيد التدقيق',
  ACTION_REQUIRED: 'مطلوب منك استكمال نواقص',
  PAYMENT_PENDING: 'بانتظار سداد الرسم',
  APPOINTMENT_REQUESTED: 'بانتظار تأكيد الموعد',
  APPROVED: 'تمت المعاملة',
  REJECTED: 'مرفوض',
}

/** Fee wording that never invents an amount: only OFFICIAL fees carry a number. */
export function feeNote(service: CatalogService) {
  if (service.feeStatus === 'OFFICIAL' && service.feeIqd)
    return `${service.feeIqd.toLocaleString('en-US')} د.ع (رسم رسمي)`
  if (service.feeStatus === 'UNVERIFIED') return 'يوجد رسم غير مؤكد في بياناتنا — تؤكده الدائرة عند التدقيق'
  return 'لا يوجد رسم مسجل لهذه الخدمة في بيانات المنصة'
}

export function serviceCard(service: CatalogService): ServiceCard {
  return {
    key: service.key,
    title: service.title,
    departmentName: service.departmentName,
    category: service.category,
    channel: service.channel,
    channelLabel: channelLabels[service.channel] || service.channel,
    feeLabel:
      service.feeStatus === 'OFFICIAL' && service.feeIqd ? `${service.feeIqd.toLocaleString('en-US')} د.ع` : null,
    estimatedDuration: service.estimatedDuration,
    documents: service.requiredDocuments.slice(0, 8).map(doc => ({ label: doc.label, required: doc.required })),
  }
}

export function serviceSteps(service: CatalogService) {
  if (service.channel === 'INFORMATION_ONLY')
    return [
      'هذه الخدمة لا تُقدَّم إلكترونياً عبر المنصة؛ تُنجز بمراجعة الدائرة حضورياً.',
      `راجع ${service.departmentName} ومعك المستمسكات المذكورة (الأصل مع نسخة).`,
      'تأكد من أوقات الدوام والرسوم من الدائرة نفسها قبل المراجعة.',
    ]
  const steps = [
    'سجّل دخولك برقم هاتفك ووثّق هويتك مرة واحدة (إن لم تكن موثقاً).',
    'افتح صفحة الخدمة واملأ الاستمارة.',
    'ارفع صور المستمسكات المطلوبة بوضوح (صورة أو PDF).',
    'راجع البيانات واضغط إرسال، واحتفظ برقم المتابعة.',
    'تابع حالة الطلب من «معاملاتي»؛ إذا طلبت الدائرة نواقص ترفعها من صفحة الطلب نفسها.',
  ]
  if (service.channel === 'APPOINTMENT_REQUIRED')
    steps.push('بعد التدقيق تحدد الدائرة موعد حضورك؛ احضر بالموعد ومعك أصول المستمسكات.')
  return steps
}

export const registrationSteps = [
  'ادخل رقم هاتفك العراقي واطلب رمز التحقق (OTP) ثم اكتبه في المنصة — لا تعطِ الرمز لأي شخص، حتى لو قال إنه موظف أو المساعد.',
  'صوّر البطاقة الوطنية الموحدة (الوجه الأمامي ثم الخلفي) بالكاميرا مباشرة وبإضاءة جيدة.',
  'راجع البيانات المقروءة من البطاقة واكتب اسمك الثلاثي بالعربي كما في البطاقة.',
  'سجّل فيديو قصير للوجه (حوالي 7 ثوانٍ): انظر للكاميرا ثم أدر رأسك ببطء يميناً ثم يساراً (تحدي الحيوية).',
  'يطابق الذكاء الاصطناعي وجهك مع صورة البطاقة؛ عند التطابق تُوثَّق هويتك فوراً، وإلا يراجع طلبك موظف مختص.',
  'بعد التوثيق تقدر تقدم على كل خدمات المنصة بنفس الحساب، وتابع طلباتك من «معاملاتي».',
]

/** Question words citizens wrap around a service name ("شنو المستمسكات لـ…") that only add noise to the search. */
const FILLER = new Set(
  'شنو شلون اشلون كيف وين اريد ابي ابغي اطلع اسوي اسويلي احتاج محتاج ممكن لو سمحت رجاء عن حول بخصوص مستمسكات مستمسك المستمسكات اوراق الاوراق ورق مطلوب المطلوب المطلوبه المطلوبات شروط الشروط خطوات الخطوات طريقه الطريقه اجراءات الاجراءات رسوم الرسوم رسم معامله المعامله تقديم اقدم على شي شيء هي هو يحتاج تحتاج'.split(
    ' '
  )
)

/**
 * Catalog search tuned for chat messages: drops question/filler words and tries the words without the attached
 * "لـ" ("لجواز" → "جواز", "لإجازة" → "إجازة") before the raw text.
 */
export function searchForCitizen(query: string, limit = 6) {
  const words = normalizeArabic(query)
    .split(' ')
    .filter(word => word && !FILLER.has(word))
  const unprefixed = words.map(word => (word.length >= 4 && word.startsWith('ل') ? word.slice(1) : word))
  for (const candidate of [unprefixed.join(' '), words.join(' '), query]) {
    if (!candidate.trim()) continue
    const { hits } = searchCatalog(candidate, limit)
    if (hits.length) return hits.map(hit => hit.service)
  }
  return []
}

const NEEDS_SIGN_IN = {
  error: 'NOT_SIGNED_IN',
  message: 'هذه المعلومة تحتاج تسجيل دخول المواطن. اطلب منه تسجيل الدخول من /onboarding ثم يسأل مرة ثانية.',
}

// ---- input schemas (validated before every execution; strict tool schemas mirror them) ------------------------
const searchInput = z.object({ query: z.string().trim().min(1).max(160) })
const detailsInput = z.object({ service_key: z.string().trim().min(1).max(120) })
const departmentsInput = z.object({ query: z.string().trim().max(120), district: z.string().trim().max(60) })
const statusInput = z.object({ reference: z.string().trim().min(3).max(40) })
const draftInput = z.object({
  service_key: z.string().trim().min(1).max(120),
  answers: z.array(z.object({ field_key: z.string().trim().min(1).max(80), value: z.string().max(1000) })).max(40),
})
const emptyInput = z.object({}).strict()

const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
})

/** Deterministic tool list (sorted by name) — identical bytes on every request, so it caches with the system prompt. */
export const assistantTools: Anthropic.Beta.BetaTool[] = [
  {
    name: 'get_my_requests',
    description:
      'Lists the signed-in citizen\'s own service requests (reference, service, status, missing documents). Call it when the citizen asks about "معاملتي", "طلباتي", "شنو صار بطلبي" without giving a reference number. Returns NOT_SIGNED_IN for visitors.',
    input_schema: objectSchema({}, []),
  },
  {
    name: 'get_registration_help',
    description:
      'Returns the real steps to create and verify a citizen account on the platform (phone OTP, national card photos, name, face liveness video, AI face match or staff review). Call it for any question about registering, signing in, verification or account problems.',
    input_schema: objectSchema({}, []),
  },
  {
    name: 'get_request_status',
    description:
      "Returns the status, next action and missing documents of ONE request of the signed-in citizen by its reference number (e.g. TQS-2026-00123). Call it whenever the citizen gives a reference. Only the citizen's own requests are visible.",
    input_schema: objectSchema(
      { reference: { type: 'string', description: 'Request reference number exactly as the citizen wrote it' } },
      ['reference']
    ),
  },
  {
    name: 'get_service_details',
    description:
      'Returns the official data of one service: department, required documents (المستمسكات), fee status, online vs attendance, steps and the form fields. Call it before answering any question about documents, fees or procedure of a specific service. Use a key returned by search_services.',
    input_schema: objectSchema(
      { service_key: { type: 'string', description: 'Service key from search_services results' } },
      ['service_key']
    ),
  },
  {
    name: 'list_departments',
    description:
      'Searches Dhi Qar government departments (name, district, address, phone when officially recorded). Call it when the citizen asks where a department is or which office serves their district. Use empty strings when a filter is not needed.',
    input_schema: objectSchema(
      {
        query: { type: 'string', description: 'Words from the department name or service, or empty string' },
        district: { type: 'string', description: 'District (قضاء) name such as الناصرية or الشطرة, or empty string' },
      },
      ['query', 'district']
    ),
  },
  {
    name: 'prepare_request_draft',
    description:
      'Builds a DRAFT preview of a service request from answers the citizen gave in the chat. It does NOT submit anything: the citizen reviews the draft, attaches documents and submits it himself on the service page. Signed-in citizens only. Call it only after the citizen asked to start a request and gave the answers.',
    input_schema: objectSchema(
      {
        service_key: { type: 'string', description: 'Service key' },
        answers: {
          type: 'array',
          description: 'Form answers the citizen gave, using field keys from get_service_details',
          items: objectSchema({ field_key: { type: 'string' }, value: { type: 'string' } }, ['field_key', 'value']),
        },
      },
      ['service_key', 'answers']
    ),
  },
  {
    name: 'search_services',
    description:
      'Searches the official Dhi Qar e-services catalog (understands Iraqi dialect and synonyms, e.g. "جواز", "طابو", "اجازة بناء"). Call it first whenever the citizen mentions any service or need, then get_service_details for the best match.',
    input_schema: objectSchema(
      { query: { type: 'string', description: 'Short Arabic search words describing the service' } },
      ['query']
    ),
  },
].map(tool => ({ ...tool, strict: true }))

const parseChecklist = (
  value: unknown
): Array<{ label: string; required: boolean; status: string; mediaId: string | null }> => {
  try {
    const parsed = value ? JSON.parse(String(value)) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const requestSql = `SELECT sr.reference, sr.service_id, sr.status, sr.current_action, sr.document_checklist, sr.updated_at, sr.required_document,
  sc.name AS service_name, d.name AS department_name
  FROM service_requests sr JOIN service_catalog sc ON sc.id = sr.service_id JOIN departments d ON d.id = sr.department_id`

function summarizeRequest(row: Record<string, unknown>): RequestSummary {
  const checklist = parseChecklist(row.document_checklist)
  const missing = checklist
    .filter(item => item.status === 'REJECTED' || (item.required && (item.status === 'MISSING' || !item.mediaId)))
    .map(item => item.label)
  if (row.required_document && String(row.status) === 'ACTION_REQUIRED') missing.push(String(row.required_document))
  const status = String(row.status)
  return {
    reference: String(row.reference),
    serviceKey: String(row.service_id),
    serviceName: String(row.service_name),
    departmentName: String(row.department_name),
    status,
    statusLabel: requestStatusLabels[status] || status,
    currentAction: String(row.current_action || ''),
    missingDocuments: [...new Set(missing)],
    updatedAt: String(row.updated_at),
  }
}

export function citizenRequests(citizenId: number, limit = 10) {
  return (
    db
      .prepare(`${requestSql} WHERE sr.citizen_id = ? ORDER BY sr.updated_at DESC LIMIT ?`)
      .all(citizenId, limit) as Array<Record<string, unknown>>
  ).map(summarizeRequest)
}

export function citizenRequest(citizenId: number, reference: string) {
  const normalized = reference.trim().toUpperCase().replace(/\s+/g, '')
  const row = db.prepare(`${requestSql} WHERE sr.reference = ? AND sr.citizen_id = ?`).get(normalized, citizenId) as
    Record<string, unknown> | undefined
  return row ? summarizeRequest(row) : null
}

export function serviceDetails(service: CatalogService) {
  return {
    key: service.key,
    title: service.title,
    description: service.description,
    department: service.departmentName,
    category: service.category,
    channel: channelLabels[service.channel],
    canApplyOnline: service.channel !== 'INFORMATION_ONLY',
    fee: feeNote(service),
    estimatedDuration: service.estimatedDuration || 'غير محددة في البيانات',
    requiredDocuments: service.requiredDocuments.map(doc => ({
      label: doc.label,
      required: doc.required,
      note: doc.description || undefined,
    })),
    steps: serviceSteps(service),
    formFields: service.fields.map(field => ({
      key: field.key,
      label: field.label,
      required: Boolean(field.required),
      options: field.options?.length ? field.options : undefined,
    })),
    notes: service.notes || undefined,
    servicePage: `/service/${service.key}`,
  }
}

function activeService(key: string) {
  const service = getCatalogService(key)
  return service && service.active ? service : null
}

export function buildDraft(
  service: CatalogService,
  answers: Array<{ field_key: string; value: string }>
): DraftPreview {
  const fields = new Map(service.fields.map(field => [field.key, field]))
  const accepted: DraftPreview['answers'] = []
  for (const answer of answers) {
    const field = fields.get(answer.field_key)
    const value = answer.value.trim().slice(0, field?.maxLength || 1000)
    if (!field || !value || accepted.some(item => item.key === field.key)) continue
    // a select only accepts one of its official options
    if (field.options?.length && !field.options.includes(value)) continue
    accepted.push({ key: field.key, label: field.label, value })
  }
  const answered = new Set(accepted.map(item => item.key))
  return {
    serviceKey: service.key,
    serviceTitle: service.title,
    departmentName: service.departmentName,
    answers: accepted,
    missingFields: service.fields.filter(field => field.required && !answered.has(field.key)).map(field => field.label),
    documents: service.requiredDocuments.map(doc => ({ label: doc.label, required: doc.required })),
  }
}

const invalid = (issues: string) => ({ content: { error: 'INVALID_INPUT', message: issues }, isError: true })

/** Executes one tool call. Never throws: errors come back as tool results the model can recover from. */
export function executeTool(name: string, rawInput: unknown, context: ToolContext): ToolOutcome {
  try {
    switch (name) {
      case 'search_services': {
        const input = searchInput.safeParse(rawInput)
        if (!input.success) return invalid('query is required')
        const services = searchForCitizen(input.data.query, 6)
        return {
          content: {
            results: services.map(service => ({
              key: service.key,
              title: service.title,
              department: service.departmentName,
              channel: channelLabels[service.channel],
              fee: feeNote(service),
              requiredDocuments: service.requiredDocuments.slice(0, 8).map(doc => doc.label),
            })),
            note: services.length ? undefined : 'لا توجد خدمة مطابقة في الكتالوج. اقترح كلمات أخرى أو مراجعة الدائرة.',
          },
          ui: services.length ? { kind: 'services', items: services.slice(0, 3).map(serviceCard) } : undefined,
        }
      }
      case 'get_service_details': {
        const input = detailsInput.safeParse(rawInput)
        if (!input.success) return invalid('service_key is required')
        const service = activeService(input.data.service_key)
        if (!service)
          return {
            content: { error: 'NOT_FOUND', message: 'لا توجد خدمة بهذا المفتاح. استعمل search_services.' },
            isError: true,
          }
        return { content: serviceDetails(service), ui: { kind: 'services', items: [serviceCard(service)] } }
      }
      case 'get_registration_help': {
        if (!emptyInput.safeParse(rawInput ?? {}).success) return invalid('no input expected')
        return {
          content: {
            steps: registrationSteps,
            startPage: '/onboarding',
            privacy: 'لا تُطلب كلمة مرور. رمز التحقق يُكتب في المنصة فقط ولا يُرسل لأي أحد.',
          },
          ui: { kind: 'registration' },
        }
      }
      case 'list_departments': {
        const input = departmentsInput.safeParse(rawInput)
        if (!input.success) return invalid('query and district must be strings')
        const query = normalizeArabic(input.data.query)
        const district = normalizeArabic(input.data.district)
        const tokens = query.split(' ').filter(token => token.length > 1)
        const items = listPublicDepartments()
          .filter(item => !district || normalizeArabic(item.district).includes(district))
          .filter(item => {
            if (!tokens.length) return true
            const text = normalizeArabic(`${item.name} ${item.category} ${item.district} ${item.parentMinistry || ''}`)
            return tokens.every(token => text.includes(token))
          })
          .slice(0, 8)
          .map(item => ({
            id: item.id,
            name: item.name,
            district: item.district,
            category: item.category,
            address: item.address || 'العنوان غير مسجل في بياناتنا',
            phone: item.phone || 'لا يوجد رقم رسمي مسجل',
            onlineServices: item.digitalServices,
            page: `/departments/${item.id}`,
          }))
        return { content: { results: items } }
      }
      case 'get_my_requests': {
        if (!context.citizenId) return { content: NEEDS_SIGN_IN, isError: true }
        const items = citizenRequests(context.citizenId)
        return {
          content: { requests: items, note: items.length ? undefined : 'لا توجد طلبات في حساب المواطن.' },
          ui: items.length ? { kind: 'requests', items: items.slice(0, 5) } : undefined,
        }
      }
      case 'get_request_status': {
        if (!context.citizenId) return { content: NEEDS_SIGN_IN, isError: true }
        const input = statusInput.safeParse(rawInput)
        if (!input.success) return invalid('reference is required')
        const item = citizenRequest(context.citizenId, input.data.reference)
        // another citizen's reference answers exactly like a missing one
        if (!item)
          return {
            content: { error: 'NOT_FOUND', message: 'لا يوجد طلب بهذا الرقم ضمن حساب المواطن.' },
            isError: true,
          }
        return { content: { request: item }, ui: { kind: 'requests', items: [item] } }
      }
      case 'prepare_request_draft': {
        if (!context.citizenId) return { content: NEEDS_SIGN_IN, isError: true }
        const input = draftInput.safeParse(rawInput)
        if (!input.success) return invalid('service_key and answers[] are required')
        const service = activeService(input.data.service_key)
        if (!service) return { content: { error: 'NOT_FOUND', message: 'الخدمة غير موجودة.' }, isError: true }
        if (service.channel === 'INFORMATION_ONLY')
          return {
            content: { error: 'NOT_ONLINE', message: 'هذه الخدمة لا تُقدَّم إلكترونياً؛ تُنجز بمراجعة الدائرة.' },
            isError: true,
          }
        const draft = buildDraft(service, input.data.answers)
        return {
          content: {
            draft,
            submitted: false,
            instruction:
              'هذه مسودة فقط ولم يُرسل أي شيء. قل للمواطن يراجعها ويضغط «مراجعة وإرسال» ليكمل المرفقات ويرسل الطلب بنفسه من صفحة الخدمة.',
          },
          ui: { kind: 'draft', draft },
        }
      }
      default:
        return { content: { error: 'UNKNOWN_TOOL', message: `No tool named ${name}` }, isError: true }
    }
  } catch (error) {
    console.error('[assistant] tool failed', name, error)
    return { content: { error: 'TOOL_FAILED', message: 'تعذر جلب البيانات الآن.' }, isError: true }
  }
}
