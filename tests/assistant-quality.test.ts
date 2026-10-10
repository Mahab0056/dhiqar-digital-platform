// أفندي — مساعد ذي قار: the "answer repeated 3 times" regression, the platform knowledge tool, and an eval-style set
// of typical citizen questions (mocked model over the REAL tools and catalog, plus the no-key fallback) asserting one
// clean answer per question — no repeated paragraphs, no between-tools notes, and a real internal link when relevant.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf } from './helpers'
import type { AssistantModelClient, BetaMessage, ModelRequest, StreamHandlers } from '../server/assistant/client'
import type { AssistantEvent } from '../src/components/assistant/assistant-client'
import { dedupeParagraphs, replyFromEvents } from '../src/components/assistant/assistant-reducer'

configureTestEnv()

let app: Express
let citizen = ''

const assistant = async () => import('../server/assistant/client.ts')

const message = (content: unknown[], stopReason: string) =>
  ({
    id: 'msg_eval',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 },
  }) as unknown as BetaMessage

type Step = { text?: string; message: BetaMessage; fallbackAfter?: string }
/** A scripted model whose next turn may depend on what the tools returned (read from the request it receives). */
class DynamicClient implements AssistantModelClient {
  requests: ModelRequest[] = []
  constructor(private readonly next: (request: ModelRequest, call: number) => Step) {}
  async stream(req: ModelRequest, handlers: StreamHandlers) {
    this.requests.push(structuredClone(req))
    const step = this.next(req, this.requests.length - 1)
    if (step.fallbackAfter !== undefined) {
      for (const delta of chunks(step.fallbackAfter)) handlers.onText(delta)
      handlers.onFallback?.()
    }
    for (const delta of chunks(step.text || '')) handlers.onText(delta)
    return step.message
  }
  async create(): Promise<BetaMessage> {
    throw new Error('not used')
  }
}

/** Streams like the API: small deltas. */
const chunks = (text: string) => text.match(/[\s\S]{1,7}/g) || []

const parseEvents = (body: string) =>
  body
    .split('\n\n')
    .map(chunk => chunk.trim())
    .filter(chunk => chunk.startsWith('data: '))
    .map(chunk => JSON.parse(chunk.slice(6)) as AssistantEvent)

const chat = (text: string, cookie = '') => {
  const req = request(app).post('/api/assistant/chat')
  if (cookie) req.set('Cookie', cookie)
  return req.send({ messages: [{ role: 'user', text }] }).buffer(true)
}

/** The tool results the model received in its latest request, by tool name. */
function lastToolResults(req: ModelRequest) {
  const last = req.messages[req.messages.length - 1]
  const toolUses = new Map<string, string>()
  for (const turn of req.messages)
    if (turn.role === 'assistant' && Array.isArray(turn.content))
      for (const block of turn.content) if (block.type === 'tool_use') toolUses.set(block.id, block.name)
  const results: Record<string, unknown> = {}
  if (Array.isArray(last.content))
    for (const block of last.content)
      if (block.type === 'tool_result' && typeof block.content === 'string')
        results[toolUses.get(block.tool_use_id) || '?'] = JSON.parse(block.content)
  return results
}

const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input })

/** Paragraphs (≥ 25 chars, markdown/spacing ignored) that appear more than once. */
function repeatedParagraphs(text: string) {
  const counts = new Map<string, number>()
  for (const paragraph of text.split(/\n{2,}/)) {
    const key = paragraph
      .replace(/[*_`>#]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (key.length >= 25) counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts].filter(([, count]) => count > 1).map(([key]) => key)
}

const internalLinks = (text: string) => [...text.matchAll(/\]\((\/[^)\s]*)\)/g)].map(match => match[1])

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  const requested = await request(app).post('/api/onboarding/request-otp').send({ phone: '07801239301' })
  const verified = await request(app)
    .post('/api/onboarding/verify-phone')
    .send({ phone: '07801239301', challengeId: requested.body.challengeId, otp: '246810' })
  citizen = cookieOf(verified)
})

afterEach(async () => {
  ;(await assistant()).setAssistantClient(undefined)
})

describe('regression: the answer was shown three times', () => {
  // What production did with a real key: the model wrote (part of) its answer before each tool call, and the server
  // streamed every tool round's text into the same bubble joined by blank lines — the citizen read the answer 3×.
  const ANSWER_LINE = 'لإصدار جواز السفر تحتاج البطاقة الوطنية الموحدة وبطاقة السكن.'
  const script = (): Step[] => [
    {
      text: `${ANSWER_LINE}\n\nخلني أتأكد من دليل الخدمات.`,
      message: message(
        [
          { type: 'thinking', thinking: '', signature: 's1' },
          { type: 'text', text: `${ANSWER_LINE}\n\nخلني أتأكد من دليل الخدمات.` },
          toolUse('toolu_a', 'search_services', { query: 'جواز سفر' }),
        ],
        'tool_use'
      ),
    },
    {
      text: `${ANSWER_LINE}\n\nأجيبلك التفاصيل.`,
      message: message(
        [{ type: 'text', text: ANSWER_LINE }, toolUse('toolu_b', 'get_platform_help', { topic: 'payments' })],
        'tool_use'
      ),
    },
    {
      text: `${ANSWER_LINE}\n\n- البطاقة الوطنية الموحدة\n- بطاقة السكن\n\n[افتح الخدمة](/service/e-passport)`,
      message: message([{ type: 'text', text: ANSWER_LINE }], 'end_turn'),
    },
  ]

  it('streams one answer: text written before tool calls is retracted as an interim note', async () => {
    const steps = script()
    const client = new DynamicClient(() => steps.shift() as Step)
    ;(await assistant()).setAssistantClient(client)
    const events = parseEvents((await chat('أريد أطلع جواز')).text)
    expect(client.requests).toHaveLength(3)
    expect(events.filter(event => event.type === 'interim')).toHaveLength(2)
    const reply = replyFromEvents(events)
    expect(reply.text.split(ANSWER_LINE).length - 1).toBe(1)
    expect(repeatedParagraphs(reply.text)).toEqual([])
    expect(reply.text).not.toContain('خلني أتأكد')
    expect(reply.text).toContain('[افتح الخدمة](/service/e-passport)')
    expect(reply.ui.some(item => item.kind === 'services')).toBe(true)
    // the old behaviour (every text delta appended) really did repeat it — this is what the citizen saw
    const naive = events
      .filter(event => event.type === 'text')
      .map(event => (event as { delta: string }).delta)
      .join('')
    expect(naive.split(ANSWER_LINE).length - 1).toBe(3)
  })

  it('a server-side fallback mid-stream supersedes the declining model text', async () => {
    const client = new DynamicClient(() => ({
      fallbackAfter: 'نص ناقص من النموذج الأول',
      text: 'جواب النموذج البديل الكامل عن الخدمة المطلوبة.',
      message: message([{ type: 'text', text: 'جواب النموذج البديل الكامل عن الخدمة المطلوبة.' }], 'end_turn'),
    }))
    ;(await assistant()).setAssistantClient(client)
    const reply = replyFromEvents(parseEvents((await chat('سؤال عن خدمة')).text))
    expect(reply.text).toBe('جواب النموذج البديل الكامل عن الخدمة المطلوبة.')
  })

  it('when the tool budget runs out it answers from the catalog instead of a dead end', async () => {
    let id = 0
    const client = new DynamicClient(() => ({
      message: message([toolUse(`toolu_${id++}`, 'search_services', { query: 'جواز' })], 'tool_use'),
    }))
    ;(await assistant()).setAssistantClient(client)
    const reply = replyFromEvents(parseEvents((await chat('جواز سفر')).text))
    expect(client.requests).toHaveLength(6)
    expect(reply.text).toContain('المستمسكات')
    expect(repeatedParagraphs(reply.text)).toEqual([])
  })

  it('the client reducer drops a paragraph repeated inside the final answer', () => {
    const repeated = 'تحتاج البطاقة الوطنية الموحدة وبطاقة السكن لهذه الخدمة.'
    expect(dedupeParagraphs(`${repeated}\n\n- صورة\n\n${repeated}\n\n- صورة`)).toBe(`${repeated}\n\n- صورة\n\n- صورة`)
  })

  it('asks for medium effort, keeps thinking hidden, and tells the model to answer once after the tools', async () => {
    const { chatRequest } = await import('../server/assistant/chat.ts')
    const req = chatRequest([{ role: 'user', content: 'هلا' }])
    expect(req.output_config?.effort).toBe('medium')
    expect('thinking' in req).toBe(false)
    const system = JSON.stringify(req.system)
    expect(system).toContain('أفندي')
    expect(system).toContain('write the answer ONCE')
    expect(req.tools?.map(tool => (tool as { name: string }).name)).toContain('get_platform_help')
  })
})

describe('get_platform_help (platform knowledge)', () => {
  it('answers every topic with facts and internal links only', async () => {
    const { executeTool } = await import('../server/assistant/tools.ts')
    const { PLATFORM_HELP_TOPICS } = await import('../server/assistant/knowledge.ts')
    for (const topic of PLATFORM_HELP_TOPICS) {
      const outcome = executeTool('get_platform_help', { topic }, { citizenId: null })
      expect(outcome.isError).toBeFalsy()
      const content = outcome.content as { facts: string[]; links: Array<{ path: string }> }
      expect(content.facts.length).toBeGreaterThan(0)
      expect(content.links.length).toBeGreaterThan(0)
      for (const link of content.links) expect(link.path).toMatch(/^\/(?!\/)/)
    }
    expect(executeTool('get_platform_help', { topic: 'hack' }, { citizenId: null }).isError).toBe(true)
    const registration = JSON.stringify(
      executeTool('get_platform_help', { topic: 'registration' }, { citizenId: null })
    )
    expect(registration).toContain('البطاقة الوطنية الموحدة')
    expect(registration).toContain('الحيوية')
    const otp = JSON.stringify(executeTool('get_platform_help', { topic: 'otp_safety' }, { citizenId: null }))
    expect(otp).toContain('لا الموظف ولا المساعد')
  })

  it('service details carry links, the department contact and online-vs-attendance', async () => {
    const { executeTool } = await import('../server/assistant/tools.ts')
    const details = executeTool('get_service_details', { service_key: 'water-bill-objection' }, { citizenId: null })
      .content as {
      links: { servicePage: string; startForVisitor: string }
      departmentContact?: { name: string; page: string }
      canApplyOnline: boolean
    }
    expect(details.links.servicePage).toBe('/service/water-bill-objection')
    expect(details.links.startForVisitor).toContain('/onboarding?continue=')
    expect(details.departmentContact?.page).toMatch(/^\/departments\//)
    expect(typeof details.canApplyOnline).toBe('boolean')
  })
})

// ---- eval set ------------------------------------------------------------------------------------------------
type EvalCase = {
  question: string
  signedIn?: boolean
  /** the tool chain a good model runs; later inputs may read earlier results */
  chain: Array<(previous: Record<string, unknown>) => { name: string; input: Record<string, unknown> }>
  /** the final answer, written from the tool results */
  answer: (results: Record<string, unknown>) => string
  expectServiceCards?: boolean
  expectLink: boolean
}

type SearchResult = { results: Array<{ key: string; title: string; servicePage: string; requiredDocuments: string[] }> }
type HelpResult = { title: string; facts: string[]; links: Array<{ label: string; path: string }> }

const firstKey = (results: Record<string, unknown>) => (results.search_services as SearchResult).results[0].key
const serviceAnswer = (results: Record<string, unknown>) => {
  const details = results.get_service_details as {
    title: string
    requiredDocuments: Array<{ label: string }>
    links: { servicePage: string }
  }
  return `**${details.title}** تگدر تقدّم عليها من المنصة.\n\n${details.requiredDocuments
    .slice(0, 4)
    .map(doc => `- ${doc.label}`)
    .join('\n')}\n\n[افتح الخدمة](${details.links.servicePage})`
}
const helpAnswer = (results: Record<string, unknown>) => {
  const help = results.get_platform_help as HelpResult
  return `**${help.title}**\n\n${help.facts
    .slice(0, 3)
    .map(fact => `- ${fact}`)
    .join('\n')}\n\n[${help.links[0].label}](${help.links[0].path})`
}
const serviceChain: EvalCase['chain'] = [
  () => ({ name: 'search_services', input: { query: '' } }),
  previous => ({ name: 'get_service_details', input: { service_key: firstKey(previous) } }),
]
const searchFor = (query: string): EvalCase['chain'] => [
  () => ({ name: 'search_services', input: { query } }),
  serviceChain[1],
]
const help = (topic: string): EvalCase['chain'] => [() => ({ name: 'get_platform_help', input: { topic } })]

const EVAL: EvalCase[] = [
  {
    question: 'أريد أطلع جواز سفر شنو أحتاج',
    chain: searchFor('جواز سفر'),
    answer: serviceAnswer,
    expectServiceCards: true,
    expectLink: true,
  },
  {
    question: 'شنو المستمسكات لإجازة بناء',
    chain: searchFor('إجازة بناء'),
    answer: serviceAnswer,
    expectServiceCards: true,
    expectLink: true,
  },
  {
    question: 'اعتراض على قائمة الماء',
    chain: searchFor('اعتراض قائمة ماء'),
    answer: serviceAnswer,
    expectServiceCards: true,
    expectLink: true,
  },
  { question: 'كيف أسجل بالمنصة؟', chain: help('registration'), answer: helpAnswer, expectLink: true },
  { question: 'ما وصلني رمز التحقق شسوي', chain: help('sign_in'), answer: helpAnswer, expectLink: true },
  { question: 'شلون أدفع الرسم؟', chain: help('payments'), answer: helpAnswer, expectLink: true },
  { question: 'أريد أقدم شكوى على تأخير معاملتي', chain: help('complaints'), answer: helpAnswer, expectLink: true },
  { question: 'وين أشوف المناقصات', chain: help('tenders'), answer: helpAnswer, expectLink: true },
  {
    question: 'وين دائرة الأحوال المدنية بالناصرية',
    chain: [() => ({ name: 'list_departments', input: { query: 'الأحوال المدنية', district: '' } })],
    answer: results => {
      const found = (results.list_departments as { results: Array<{ name: string; page: string }> }).results
      return found.length
        ? `**${found[0].name}**\n\n[صفحة الدائرة](${found[0].page})`
        : 'ما لقيت الدائرة.\n\n[دليل الدوائر](/departments)'
    },
    expectLink: true,
  },
  {
    question: 'شنو صار بطلبي',
    signedIn: true,
    chain: [() => ({ name: 'get_my_requests', input: {} })],
    answer: () => 'ما عندك طلبات بعد بحسابك.\n\n[معاملاتي](/citizen)',
    expectLink: true,
  },
]

function evalClient(test: EvalCase) {
  const results: Record<string, unknown> = {}
  return new DynamicClient((req, call) => {
    Object.assign(results, call ? lastToolResults(req) : {})
    if (call < test.chain.length) {
      const next = test.chain[call](results)
      const input = next.name === 'search_services' && !next.input.query ? { query: test.question } : next.input
      // the bad habit we guard against: a note (or a draft answer) before every tool call
      const note = call === 0 ? 'خلني أدورلك على هذا بدليل المنصة.' : 'لقيت شي، أجيبلك التفاصيل الكاملة هسه.'
      return {
        text: note,
        message: message([{ type: 'text', text: note }, toolUse(`toolu_${call}`, next.name, input)], 'tool_use'),
      }
    }
    const text = test.answer(results)
    return { text, message: message([{ type: 'text', text }], 'end_turn') }
  })
}

describe('eval: typical citizen questions', () => {
  for (const test of EVAL)
    it(`AI: «${test.question}» → one clean, grounded answer`, async () => {
      const client = evalClient(test)
      ;(await assistant()).setAssistantClient(client)
      const events = parseEvents((await chat(test.question, test.signedIn ? citizen : '')).text)
      expect(events.at(-1)?.type).toBe('done')
      expect(client.requests).toHaveLength(test.chain.length + 1)
      const reply = replyFromEvents(events)
      expect(reply.text.length).toBeGreaterThan(10)
      expect(repeatedParagraphs(reply.text)).toEqual([])
      expect(reply.text).not.toContain('خلني أدورلك')
      expect(reply.text).not.toContain('أجيبلك التفاصيل')
      if (test.expectLink) expect(internalLinks(reply.text).length).toBeGreaterThan(0)
      if (test.expectServiceCards) {
        const cards = reply.ui.find(item => item.kind === 'services')
        expect(cards).toBeTruthy()
        // the link in the answer is a real service the tools returned
        const keys = (cards as { items: Array<{ key: string }> }).items.map(item => item.key)
        expect(keys.some(key => internalLinks(reply.text).includes(`/service/${key}`))).toBe(true)
      }
    })

  for (const test of EVAL)
    it(`fallback (no key): «${test.question}» → useful answer with a next step`, async () => {
      ;(await assistant()).setAssistantClient(null)
      const reply = replyFromEvents(parseEvents((await chat(test.question, test.signedIn ? citizen : '')).text))
      expect(reply.text.length).toBeGreaterThan(10)
      expect(repeatedParagraphs(reply.text)).toEqual([])
      if (test.expectLink) expect(internalLinks(reply.text).length).toBeGreaterThan(0)
      if (test.expectServiceCards) expect(reply.ui.some(item => item.kind === 'services')).toBe(true)
    })
})
