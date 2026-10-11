// أفندي without a model (no key, budget spent, model down): the deterministic fallback reads the recent
// conversation, so a reply typed to a clarifying question continues the request it answers — «أي قضاء؟» → «الشطرة»
// lands on the Shatrah municipality, «أول مرة لو تجديد؟» → «تجديد» lands on the passport renewal — and it asks those
// two questions itself (district for per-district services, first issue or renewal for a passport).
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv } from './helpers'
import type { AssistantEvent } from '../src/components/assistant/assistant-client'
import { replyFromEvents, splitAction } from '../src/components/assistant/assistant-reducer'

configureTestEnv()

let app: Express
let fallback: typeof import('../server/assistant/fallback.ts')

type Turn = { role: 'user' | 'assistant'; text: string }
type Ui = { kind: string; items?: Array<{ key: string; title: string }>; question?: string; options?: string[] }

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  fallback = await import('../server/assistant/fallback.ts')
})

afterEach(async () => {
  ;(await import('../server/assistant/client.ts')).setAssistantClient(undefined)
})

const visitor = { citizenId: null }
const cardsOf = (answer: { ui: Ui[] }) => answer.ui.find(item => item.kind === 'services')?.items || []
const clarifyOf = (answer: { ui: Ui[] }) => answer.ui.find(item => item.kind === 'clarify')

/** Plays a conversation through the fallback: each user turn is answered with the turns before it as history. */
function play(messages: string[], context: { citizenId: number | null } = visitor) {
  const history: Turn[] = []
  let answer: ReturnType<typeof fallback.fallbackAnswer> = { text: '', ui: [] }
  for (const text of messages) {
    answer = fallback.fallbackAnswer(text, context, 'text', history)
    history.push({ role: 'user', text }, { role: 'assistant', text: answer.text })
  }
  return answer
}

const parseEvents = (body: string) =>
  body
    .split('\n\n')
    .map(chunk => chunk.trim())
    .filter(chunk => chunk.startsWith('data: '))
    .map(chunk => JSON.parse(chunk.slice(6)) as AssistantEvent)

const converse = async (messages: Turn[]) => {
  ;(await import('../server/assistant/client.ts')).setAssistantClient(null)
  const response = await request(app).post('/api/assistant/chat').send({ messages }).buffer(true)
  expect(response.status).toBe(200)
  return replyFromEvents(parseEvents(response.text))
}

describe('a reply to «أي قضاء؟» continues the request', () => {
  it('«إجازة بناء» → building permit + «بأي قضاء؟» with district chips → «الشطرة» → Shatrah municipality', () => {
    const first = play(['إجازة بناء'])
    expect(cardsOf(first)[0].key).toMatch(/building-permit/)
    expect(cardsOf(first).some(card => card.key.endsWith('renovation-permit'))).toBe(false)
    const question = clarifyOf(first)
    expect(question?.question).toBe('بأي قضاء؟')
    expect(question?.options).toEqual(expect.arrayContaining(['الناصرية', 'الشطرة']))
    expect(first.text).toContain('بأي قضاء؟')
    // the action stays the last line (the client turns it into the action card)
    expect(splitAction(first.text).action?.path).toMatch(/^\//)

    const answer = play(['إجازة بناء', 'الشطرة'])
    expect(cardsOf(answer)[0].key).toBe('sha-muni-building-permit')
    expect(answer.text).toContain('مديرية بلدية الشطرة')
    expect(clarifyOf(answer)).toBeUndefined()
  })

  it('works when the model asked the question and the fallback answers the reply (typed, with a preposition)', () => {
    const history: Turn[] = [
      { role: 'user', text: 'شنو المستمسكات لإجازة بناء' },
      { role: 'assistant', text: 'أي قضاء؟ كل بلدية إلها إجازتها.' },
    ]
    const answer = fallback.fallbackAnswer('بسوق الشيوخ', visitor, 'text', history)
    expect(cardsOf(answer)[0].key).toBe('suq-muni-building-permit')
  })

  it('a district typed with the request needs no question', () => {
    const answer = play(['إجازة بناء بالشطرة'])
    expect(cardsOf(answer)[0].key).toBe('sha-muni-building-permit')
    expect(clarifyOf(answer)).toBeUndefined()
  })

  it('a signed-in citizen is never asked: his account district ranks his office first', async () => {
    const { db } = await import('../server/db.ts')
    const now = new Date().toISOString()
    const id = Number(
      db
        .prepare(
          `INSERT INTO citizens (full_name, national_id_masked, phone_masked, verification_status, district, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run('حسن علي جبار', '****4321', '0781***4321', 'VERIFIED', 'الرفاعي', now, now).lastInsertRowid
    )
    const answer = play(['إجازة بناء'], { citizenId: id })
    expect(cardsOf(answer)[0].key).toBe('rif-muni-building-permit')
    expect(clarifyOf(answer)).toBeUndefined()
  })

  it('the HTTP chat passes the conversation to the fallback', async () => {
    const first = await converse([{ role: 'user', text: 'اريد إجازة بناء' }])
    expect(first.ui.some(item => item.kind === 'clarify')).toBe(true)
    const reply = await converse([
      { role: 'user', text: 'اريد إجازة بناء' },
      { role: 'assistant', text: first.text },
      { role: 'user', text: 'الشطرة' },
    ])
    const cards = reply.ui.find(item => item.kind === 'services') as { items: Array<{ key: string }> } | undefined
    expect(cards?.items[0].key).toBe('sha-muni-building-permit')
  })
})

describe('passport: «أول مرة لو تجديد؟»', () => {
  it('«جواز» alone → the question, with the real passport services as chips', () => {
    const answer = play(['جواز'])
    expect(answer.text).toBe('أول مرة لو تجديد؟')
    expect(cardsOf(answer)).toEqual([])
    const options = clarifyOf(answer)?.options || []
    expect(options).toEqual(
      expect.arrayContaining(['إصدار جواز السفر الإلكتروني (لأول مرة)', 'تجديد جواز السفر الإلكتروني'])
    )
    // every chip is a full title, so tapping it answers with exactly that service
    for (const option of options) expect(cardsOf(play(['جواز', option]))[0].title).toBe(option)
  })

  it.each([
    ['تجديد', 'pass-renew'],
    ['أجدده', 'pass-renew'],
    ['بدل ضائع', 'pass-lost-damaged'],
  ])('typed reply «%s» → %s', (reply, key) => {
    expect(cardsOf(play(['جواز', reply]))[0].key).toBe(key)
  })

  it('typed reply «أول مرة» → the first issue', () => {
    expect(['pass-new', 'civ-passport-new']).toContain(cardsOf(play(['اريد اطلع جواز', 'أول مرة']))[0].key)
  })

  it("the model's own wording of the question works too", () => {
    const history: Turn[] = [
      { role: 'user', text: 'أريد جواز' },
      { role: 'assistant', text: 'تقصد إصدار جواز لأول مرة لو تجديد؟' },
    ]
    expect(cardsOf(fallback.fallbackAnswer('تجديد', visitor, 'text', history))[0].key).toBe('pass-renew')
  })

  it('a longer request without first/renewal → the first-issue answer AND the question under it', () => {
    const answer = play(['أريد أطلع جواز سفر شنو أحتاج'])
    expect(['pass-new', 'civ-passport-new']).toContain(cardsOf(answer)[0].key)
    expect(clarifyOf(answer)?.question).toBe('أول مرة لو تجديد؟')
    expect(answer.text).toContain('أول مرة لو تجديد؟')
    expect(answer.text).toContain('**المستمسكات:**')
    expect(splitAction(answer.text).action?.path).toMatch(/^\//)
  })

  it('no question when the citizen already said which passport', () => {
    for (const query of ['تجديد جواز', 'جوازي ضاع', 'جواز لأول مرة', 'جواز لابني القاصر']) {
      const answer = play([query])
      expect(clarifyOf(answer), query).toBeUndefined()
      expect(cardsOf(answer)[0].key, query).toMatch(/^(pass|civ-passport)-/)
    }
  })

  it('voice answers keep the question short and the action last', () => {
    const answer = fallback.fallbackAnswer('أريد أطلع جواز سفر', visitor, 'voice', [])
    expect(answer.text).toContain('أول مرة لو تجديد؟ اختار من تحت.')
    expect(splitAction(answer.text).action).not.toBeNull()
  })
})

describe('reading the conversation', () => {
  it('a new subject after a question stands alone', () => {
    expect(cardsOf(play(['جواز', 'شهادة ميلاد']))[0].key).toBe('health-birth-certificate')
    expect(cardsOf(play(['إجازة بناء', 'بطاقة تموينية']))[0].key).toBe('supply-ration-card-new')
  })

  it('a follow-up about the same service keeps it («شنو الرسوم» after a district answer)', () => {
    expect(cardsOf(play(['إجازة بناء', 'الشطرة', 'شنو الرسوم']))[0].key).toBe('sha-muni-building-permit')
  })

  it('withConversation joins only replies that refine the earlier request', () => {
    const turns = (...texts: string[]): Turn[] => texts.map(text => ({ role: 'user', text }))
    expect(fallback.withConversation('الشطرة', turns('إجازة بناء'))).toBe('إجازة بناء الشطرة')
    expect(fallback.withConversation('تجديد', turns('جواز'))).toBe('جواز تجديد')
    expect(fallback.withConversation('شهادة ميلاد', turns('جواز'))).toBe('شهادة ميلاد')
    expect(fallback.withConversation('هلا', [])).toBe('هلا')
    // a long message is a request of its own
    expect(fallback.withConversation('اريد اعرف شنو المستمسكات المطلوبة لشهادة الوفاة', turns('جواز'))).toBe(
      'اريد اعرف شنو المستمسكات المطلوبة لشهادة الوفاة'
    )
  })

  it('emergency, tracking and sign-in routes still read the message itself', () => {
    expect(play(['جواز', 'حريق']).text).toContain('115')
    expect(play(['جواز', 'كيف اسجل']).ui.some(item => item.kind === 'registration')).toBe(true)
  })
})
