// مساعد ذي قار الآلي — citizen chat: tools over the real catalog, scoping, SSE tool loop with a mocked model,
// refusal handling, the no-key fallback, rate limiting and the guarantee that the assistant never submits a request.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf } from './helpers'
import type { AssistantModelClient, BetaMessage, ModelRequest } from '../server/assistant/client'

configureTestEnv()

let app: Express
let citizen = ''
let otherCitizen = ''
let admin = ''
let ownReference = ''
let otherReference = ''

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)])
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])

const assistant = async () => import('../server/assistant/client.ts')
const db = async () => (await import('../server/db.ts')).db

type Field = { key: string; type: string; options?: string[] }
type ServiceShape = { fields: Field[]; requiredDocuments: Array<{ key: string }> }

async function citizenSession(phone: string) {
  const requested = await request(app).post('/api/onboarding/request-otp').send({ phone })
  const verified = await request(app)
    .post('/api/onboarding/verify-phone')
    .send({ phone, challengeId: requested.body.challengeId, otp: '246810' })
  return cookieOf(verified)
}

async function submit(serviceKey: string, cookie: string) {
  const service = (await request(app).get(`/api/services/${serviceKey}`)).body as ServiceShape
  const fill = (field: Field) =>
    field.options?.length ? field.options[0] : field.type === 'tel' ? '07701234567' : 'بيانات اختبار'
  let req = request(app)
    .post('/api/service-requests')
    .set('Cookie', cookie)
    .field('serviceKey', serviceKey)
    .field('data', JSON.stringify(Object.fromEntries(service.fields.map(field => [field.key, fill(field)]))))
    .field('faceConsent', 'true')
    .field('documentConsent', 'true')
  for (const doc of service.requiredDocuments)
    req = req.attach(`doc__${doc.key}`, doc.key.includes('id') ? jpeg : pdf, {
      filename: `${doc.key}.${doc.key.includes('id') ? 'jpg' : 'pdf'}`,
      contentType: doc.key.includes('id') ? 'image/jpeg' : 'application/pdf',
    })
  const response = await req.attach('faceVideo', webm, { filename: 'face.webm', contentType: 'video/webm' })
  expect(response.status).toBe(201)
  return response.body.reference as string
}

const message = (content: unknown[], stopReason: string) =>
  ({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
  }) as unknown as BetaMessage

/** Plays back a fixed script of model turns and records every request it received. */
class ScriptedClient implements AssistantModelClient {
  requests: ModelRequest[] = []
  constructor(private readonly script: Array<{ text?: string[]; message: BetaMessage }>) {}
  private next(req: ModelRequest) {
    this.requests.push(structuredClone(req))
    const step = this.script.shift()
    if (!step) throw new Error('script exhausted')
    return step
  }
  async stream(req: ModelRequest, handlers: { onText: (delta: string) => void }) {
    const step = this.next(req)
    for (const delta of step.text || []) handlers.onText(delta)
    return step.message
  }
  async create(req: ModelRequest) {
    return this.next(req).message
  }
}

type Event = { type: string; delta?: string; mode?: string; payload?: { kind: string; [key: string]: unknown } }
const events = (text: string) =>
  text
    .split('\n\n')
    .map(chunk => chunk.trim())
    .filter(chunk => chunk.startsWith('data: '))
    .map(chunk => JSON.parse(chunk.slice(6)) as Event)
const textOf = (list: Event[]) =>
  list
    .filter(event => event.type === 'text')
    .map(event => event.delta)
    .join('')

const chat = (text: string, cookie = '') => {
  const req = request(app).post('/api/assistant/chat')
  if (cookie) req.set('Cookie', cookie)
  return req.send({ messages: [{ role: 'user', text }] }).buffer(true)
}

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  const login = await request(app)
    .post('/api/auth/staff/login')
    .send({ username: 'admin', password: 'Bootstrap-Admin-Pass-2026!' })
  admin = cookieOf(login)
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', admin)
    .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Admin-Rotated-Pass-2026!' })
  citizen = await citizenSession('07801239201')
  otherCitizen = await citizenSession('07801239202')
  ;(await db()).prepare(`UPDATE citizens SET verification_status = 'VERIFIED_MANUAL'`).run()
  ownReference = await submit('water-bill-objection', citizen)
  otherReference = await submit('water-bill-objection', otherCitizen)
})

afterEach(async () => {
  ;(await assistant()).setAssistantClient(undefined)
})

describe('assistant tools', () => {
  it('search_services returns real catalog keys and get_service_details lists the documents', async () => {
    const { executeTool } = await import('../server/assistant/tools.ts')
    const { getCatalogService } = await import('../server/services/catalog.ts')
    const search = executeTool('search_services', { query: 'جواز سفر' }, { citizenId: null })
    const results = (search.content as { results: Array<{ key: string }> }).results
    expect(results.length).toBeGreaterThan(0)
    for (const item of results) expect(getCatalogService(item.key)).not.toBeNull()
    expect(search.ui?.kind).toBe('services')

    const details = executeTool('get_service_details', { service_key: 'water-bill-objection' }, { citizenId: null })
    const content = details.content as {
      requiredDocuments: Array<{ label: string; required: boolean }>
      steps: string[]
      formFields: Array<{ key: string }>
      servicePage: string
    }
    expect(content.requiredDocuments.length).toBeGreaterThan(0)
    expect(content.requiredDocuments.every(doc => doc.label.length > 0)).toBe(true)
    expect(content.steps.length).toBeGreaterThan(2)
    expect(content.formFields.map(field => field.key)).toContain('subscriptionNumber')
    expect(content.servicePage).toBe('/service/water-bill-objection')
  })

  it('validates input and never invents unknown services', async () => {
    const { executeTool, assistantTools } = await import('../server/assistant/tools.ts')
    expect(executeTool('search_services', {}, { citizenId: null }).isError).toBe(true)
    expect(executeTool('get_service_details', { service_key: 'no-such-service' }, { citizenId: null }).isError).toBe(
      true
    )
    expect(executeTool('drop_database', {}, { citizenId: null }).isError).toBe(true)
    // deterministic, sorted, strict tool list (cache-friendly)
    const names = assistantTools.map(tool => tool.name)
    expect(names).toEqual([...names].sort())
    expect(assistantTools.every(tool => tool.strict === true)).toBe(true)
  })

  it('registration help returns the real onboarding steps', async () => {
    const { executeTool } = await import('../server/assistant/tools.ts')
    const help = executeTool('get_registration_help', {}, { citizenId: null }).content as { steps: string[] }
    const all = help.steps.join(' ')
    expect(all).toContain('OTP')
    expect(all).toContain('البطاقة الوطنية')
    expect(all).toContain('أدر رأسك')
  })

  it("citizen tools need a session and only see the citizen's own requests", async () => {
    const { executeTool } = await import('../server/assistant/tools.ts')
    const { db } = await import('../server/db.ts')
    const id = (reference: string) =>
      Number(
        (
          db.prepare('SELECT citizen_id FROM service_requests WHERE reference = ?').get(reference) as {
            citizen_id: number
          }
        ).citizen_id
      )
    const me = id(ownReference)
    expect(executeTool('get_my_requests', {}, { citizenId: null }).isError).toBe(true)
    expect(executeTool('get_request_status', { reference: ownReference }, { citizenId: null }).isError).toBe(true)
    const mine = executeTool('get_my_requests', {}, { citizenId: me }).content as {
      requests: Array<{ reference: string }>
    }
    expect(mine.requests.map(item => item.reference)).toContain(ownReference)
    expect(mine.requests.map(item => item.reference)).not.toContain(otherReference)
    expect(executeTool('get_request_status', { reference: ownReference }, { citizenId: me }).isError).toBeFalsy()
    const foreign = executeTool('get_request_status', { reference: otherReference }, { citizenId: me })
    expect(foreign.isError).toBe(true)
    expect((foreign.content as { error: string }).error).toBe('NOT_FOUND')
  })
})

describe('POST /api/assistant/chat', () => {
  it('streams text and runs a server-side tool round with a mocked model', async () => {
    const client = new ScriptedClient([
      {
        text: ['خلني ', 'أدورلك.'],
        message: message(
          [
            { type: 'thinking', thinking: '', signature: 'sig' },
            { type: 'text', text: 'خلني أدورلك.' },
            { type: 'tool_use', id: 'toolu_1', name: 'search_services', input: { query: 'اعتراض ماء' } },
          ],
          'tool_use'
        ),
      },
      {
        text: ['المستمسكات: ', '**قائمة الماء** والبطاقة الوطنية.'],
        message: message([{ type: 'text', text: 'المستمسكات: **قائمة الماء** والبطاقة الوطنية.' }], 'end_turn'),
      },
    ])
    ;(await assistant()).setAssistantClient(client)
    const response = await chat('أريد أعترض على قائمة الماء')
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/event-stream')
    const list = events(response.text)
    expect(list[0]).toMatchObject({ type: 'meta', mode: 'ai', signedIn: false })
    expect(list.some(event => event.type === 'status')).toBe(true)
    const cards = list.find(event => event.type === 'ui' && event.payload?.kind === 'services')
    expect(cards).toBeTruthy()
    expect(textOf(list)).toContain('قائمة الماء')
    expect(list[list.length - 1].type).toBe('done')

    // request shape: cached stable prefix, low effort, strict tools, auto tool choice, server-side fallbacks
    const first = client.requests[0]
    expect(first.model).toBe('claude-opus-5-5')
    expect(first.output_config?.effort).toBe('low')
    expect(first.tool_choice).toEqual({ type: 'auto' })
    expect('thinking' in first).toBe(false)
    expect(first.fallbacks).toBe('default')
    expect(first.betas).toContain('server-side-fallback-2026-07-01')
    expect(Array.isArray(first.system) && first.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(JSON.stringify(first.system)).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    // the tool result went back with the matching id, and the assistant turn was echoed unmodified
    const second = client.requests[1]
    const toolTurn = second.messages[second.messages.length - 1]
    expect(toolTurn.role).toBe('user')
    expect(JSON.stringify(toolTurn.content)).toContain('toolu_1')
    const echoed = second.messages[second.messages.length - 2]
    expect(JSON.stringify(echoed.content)).toContain('"signature":"sig"')
    // the prefix is identical across the two calls of the loop
    expect(JSON.stringify(second.tools)).toBe(JSON.stringify(first.tools))
    expect(JSON.stringify(second.system)).toBe(JSON.stringify(first.system))
  })

  it('never submits a request: a draft is a preview only', async () => {
    const { db } = await import('../server/db.ts')
    const count = () => (db.prepare('SELECT COUNT(*) AS n FROM service_requests').get() as { n: number }).n
    const before = count()
    const client = new ScriptedClient([
      {
        message: message(
          [
            {
              type: 'tool_use',
              id: 'toolu_d',
              name: 'prepare_request_draft',
              input: {
                service_key: 'water-bill-objection',
                answers: [
                  { field_key: 'subscriptionNumber', value: '12345' },
                  { field_key: 'unknownField', value: 'x' },
                ],
              },
            },
          ],
          'tool_use'
        ),
      },
      { text: ['جهزت المسودة.'], message: message([{ type: 'text', text: 'جهزت المسودة.' }], 'end_turn') },
    ])
    ;(await assistant()).setAssistantClient(client)
    const list = events((await chat('قدملي اعتراض ماء رقم الاشتراك 12345', citizen)).text)
    const draft = list.find(event => event.type === 'ui' && event.payload?.kind === 'draft')?.payload as {
      draft: { serviceKey: string; answers: Array<{ key: string }>; missingFields: string[] }
    }
    expect(draft.draft.serviceKey).toBe('water-bill-objection')
    expect(draft.draft.answers.map(item => item.key)).toEqual(['subscriptionNumber'])
    expect(draft.draft.missingFields.length).toBeGreaterThan(0)
    expect(count()).toBe(before)
    const toolResult = JSON.stringify(client.requests[1].messages.at(-1)?.content)
    expect(toolResult).toContain('submitted')
  })

  it('a visitor asking for a draft gets NOT_SIGNED_IN, not a draft', async () => {
    const client = new ScriptedClient([
      {
        message: message(
          [
            {
              type: 'tool_use',
              id: 'toolu_v',
              name: 'prepare_request_draft',
              input: { service_key: 'water-bill-objection', answers: [] },
            },
          ],
          'tool_use'
        ),
      },
      { text: ['سجل دخولك أولاً.'], message: message([{ type: 'text', text: 'سجل دخولك أولاً.' }], 'end_turn') },
    ])
    ;(await assistant()).setAssistantClient(client)
    const list = events((await chat('قدملي اعتراض ماء')).text)
    expect(list.some(event => event.payload?.kind === 'draft')).toBe(false)
    expect(JSON.stringify(client.requests[1].messages.at(-1)?.content)).toContain('NOT_SIGNED_IN')
  })

  it('a refusal discards the partial answer', async () => {
    const client = new ScriptedClient([{ text: ['جزء'], message: message([{ type: 'text', text: 'جزء' }], 'refusal') }])
    ;(await assistant()).setAssistantClient(client)
    const list = events((await chat('سؤال')).text)
    const reset = list.findIndex(event => event.type === 'reset')
    expect(reset).toBeGreaterThan(0)
    expect(
      list
        .slice(reset)
        .filter(event => event.type === 'text')
        .map(event => event.delta)
        .join('')
    ).toContain('ما أكدر أساعد')
  })

  it('without an API key it answers deterministically from the catalog search', async () => {
    ;(await assistant()).setAssistantClient(null)
    const config = await request(app).get('/api/assistant/config')
    expect(config.body.mode).toBe('fallback')
    const list = events((await chat('شنو المستمسكات لاعتراض على قائمة الماء')).text)
    expect(list[0]).toMatchObject({ type: 'meta', mode: 'fallback' })
    expect(textOf(list)).toContain('المستمسكات')
    expect(list.some(event => event.payload?.kind === 'services')).toBe(true)
    const registration = textOf(events((await chat('كيف أسجل بالمنصة؟')).text))
    expect(registration).toContain('/onboarding')
    const track = textOf(events((await chat(`شنو صار بطلبي ${ownReference}`, citizen)).text))
    expect(track).toContain(ownReference)
    const foreign = textOf(events((await chat(`شنو صار بطلبي ${otherReference}`, citizen)).text))
    expect(foreign).toContain('ما لقيت')
  })

  it('falls back to search when the model call fails before any text', async () => {
    const failing: AssistantModelClient = {
      stream: async () => {
        throw new Error('network down')
      },
      create: async () => {
        throw new Error('network down')
      },
    }
    ;(await assistant()).setAssistantClient(failing)
    const list = events((await chat('جواز سفر')).text)
    expect(list.some(event => event.type === 'notice')).toBe(true)
    expect(list.some(event => event.payload?.kind === 'services')).toBe(true)
  })

  it('rejects malformed bodies', async () => {
    expect((await request(app).post('/api/assistant/chat').send({})).status).toBe(400)
    expect(
      (
        await request(app)
          .post('/api/assistant/chat')
          .send({ messages: [{ role: 'assistant', text: 'هلا' }] })
      ).status
    ).toBe(400)
  })

  it('rate-limits a session to 30 messages per 10 minutes', async () => {
    ;(await assistant()).setAssistantClient(null)
    process.env.RATE_LIMIT_ENABLED = 'true'
    try {
      const statuses: number[] = []
      for (let index = 0; index < 31; index++) statuses.push((await chat('هلا', otherCitizen)).status)
      expect(statuses.slice(0, 30).every(status => status === 200)).toBe(true)
      expect(statuses[30]).toBe(429)
    } finally {
      delete process.env.RATE_LIMIT_ENABLED
    }
  })
})

describe('GET /api/assistant/status', () => {
  it('is super-admin only and reports usage counters', async () => {
    expect((await request(app).get('/api/assistant/status').set('Cookie', citizen)).status).toBe(401)
    const status = await request(app).get('/api/assistant/status').set('Cookie', admin)
    expect(status.status).toBe(200)
    expect(status.body).toMatchObject({ model: 'claude-opus-5-5', documentReview: false })
    expect(status.body.usage.total.requests).toBeGreaterThan(0)
    expect(status.body.usage.total.cacheReadTokens).toBeGreaterThan(0)
  })
})
