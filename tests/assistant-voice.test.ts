// أفندي — voice and «asks before answering»: the clarification flow (ambiguous → one question with chips → answer),
// no duplicated content, the session memory note, voice-channel answers that stay short when spoken, the speech
// helpers (speakable text, sentence streaming, Arabic voice choice, VAD) and the /api/assistant/transcribe endpoint
// with a mocked provider (501 without one, size / duration / format limits, rate limit, nothing stored).
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv } from './helpers'
import type { AssistantModelClient, BetaMessage, ModelRequest, StreamHandlers } from '../server/assistant/client'
import type { SpeechProvider, TranscribeInput } from '../server/assistant/speech'
import type { AssistantEvent } from '../src/components/assistant/assistant-client'
import { replyFromEvents, splitAction } from '../src/components/assistant/assistant-reducer'
import {
  createVad,
  frameEnergy,
  pickArabicVoice,
  speakableText,
  takeSentences,
  voiceSummary,
} from '../src/components/assistant/voice/speech-text'
import { spokenOptions } from '../src/components/assistant/voice/useVoiceConversation'

configureTestEnv()

let app: Express

const assistant = async () => import('../server/assistant/client.ts')
const speech = async () => import('../server/assistant/speech.ts')

const message = (content: unknown[], stopReason: string) =>
  ({
    id: 'msg_voice',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 90, output_tokens: 20, cache_read_input_tokens: 700, cache_creation_input_tokens: 0 },
  }) as unknown as BetaMessage

const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input })
const chunks = (text: string) => text.match(/[\s\S]{1,7}/g) || []

type Step = { text?: string; message: BetaMessage }
class DynamicClient implements AssistantModelClient {
  requests: ModelRequest[] = []
  constructor(private readonly next: (request: ModelRequest, call: number) => Step) {}
  async stream(req: ModelRequest, handlers: StreamHandlers) {
    this.requests.push(structuredClone(req))
    const step = this.next(req, this.requests.length - 1)
    for (const delta of chunks(step.text || '')) handlers.onText(delta)
    return step.message
  }
  async create(): Promise<BetaMessage> {
    throw new Error('not used')
  }
}

const parseEvents = (body: string) =>
  body
    .split('\n\n')
    .map(chunk => chunk.trim())
    .filter(chunk => chunk.startsWith('data: '))
    .map(chunk => JSON.parse(chunk.slice(6)) as AssistantEvent)

const converse = (messages: Array<{ role: 'user' | 'assistant'; text: string }>, channel?: 'text' | 'voice') =>
  request(app)
    .post('/api/assistant/chat')
    .send(channel ? { messages, channel } : { messages })
    .buffer(true)

const paragraphsRepeated = (text: string) => {
  const seen = new Set<string>()
  const repeated: string[] = []
  for (const paragraph of text
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(part => part.length >= 25)) {
    if (seen.has(paragraph)) repeated.push(paragraph)
    seen.add(paragraph)
  }
  return repeated
}

const systemNote = (req: ModelRequest) =>
  req.messages
    .filter(turn => turn.role === ('system' as never))
    .map(turn => String(turn.content))
    .join(' ')

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
})

afterEach(async () => {
  ;(await assistant()).setAssistantClient(undefined)
  ;(await speech()).setSpeechProvider(undefined)
  delete process.env.ASSISTANT_SERVER_TTS
})

// ---- clarification ----------------------------------------------------------------------------------------
describe('asks before answering', () => {
  const QUESTION = 'تقصد إصدار جواز لأول مرة لو تجديد؟'
  const OPTIONS = ['أول مرة', 'تجديد', 'بدل ضائع']

  it('ambiguous → ONE question with chips, the turn ends without another model call', async () => {
    const client = new DynamicClient(() => ({
      message: message([toolUse('toolu_q', 'ask_clarification', { question: QUESTION, options: OPTIONS })], 'tool_use'),
    }))
    ;(await assistant()).setAssistantClient(client)
    const events = parseEvents((await converse([{ role: 'user', text: 'أريد جواز' }])).text)
    expect(client.requests).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('done')
    const reply = replyFromEvents(events)
    expect(reply.text).toBe(QUESTION)
    expect(reply.ui).toEqual([{ kind: 'clarify', question: QUESTION, options: OPTIONS }])
    // the clarification tool is offered to the model and the prompt tells it when to use it
    const tools = client.requests[0].tools?.map(tool => (tool as { name: string }).name) || []
    expect(tools).toContain('ask_clarification')
    expect(JSON.stringify(client.requests[0].system)).toContain('ask_clarification')
  })

  it('the chip answer comes back with the history: the model answers without asking again', async () => {
    const answer =
      'تجديد الجواز تقدّم عليه من المنصة ثم تراجع بموعد.\n\n**الخطوات:**\n1. افتح الخدمة واملأ الاستمارة.\n2. ارفع المستمسكات.\n\n**المستمسكات:**\n- البطاقة الوطنية الموحدة\n- الجواز القديم\n\n[افتح الخدمة](/service/e-passport)'
    const client = new DynamicClient((_req, call) =>
      call === 0
        ? { message: message([toolUse('toolu_s', 'search_services', { query: 'تجديد جواز' })], 'tool_use') }
        : { text: answer, message: message([{ type: 'text', text: answer }], 'end_turn') }
    )
    ;(await assistant()).setAssistantClient(client)
    const events = parseEvents(
      (
        await converse([
          { role: 'user', text: 'أريد جواز' },
          { role: 'assistant', text: QUESTION },
          { role: 'user', text: 'تجديد' },
        ])
      ).text
    )
    // conversation memory: the model saw its own question and the citizen's chip
    const first = JSON.stringify(client.requests[0].messages)
    expect(first).toContain(QUESTION)
    expect(first).toContain('تجديد')
    const reply = replyFromEvents(events)
    expect(reply.ui.some(item => item.kind === 'clarify')).toBe(false)
    expect(paragraphsRepeated(reply.text)).toEqual([])
    // one primary action, split off as the CTA card
    const { body, action } = splitAction(reply.text)
    expect(action).toEqual({ label: 'افتح الخدمة', path: '/service/e-passport' })
    expect(body).not.toContain('](/')
    expect(body).toContain('**الخطوات:**')
  })

  it('an invalid clarification goes back to the model as a tool error (no broken chips)', async () => {
    const client = new DynamicClient((_req, call) =>
      call === 0
        ? {
            message: message(
              [toolUse('toolu_bad', 'ask_clarification', { question: 'أي خدمة؟', options: ['وحدة'] })],
              'tool_use'
            ),
          }
        : { text: 'شنو الخدمة اللي تحتاجها؟', message: message([{ type: 'text', text: 'x' }], 'end_turn') }
    )
    ;(await assistant()).setAssistantClient(client)
    const events = parseEvents((await converse([{ role: 'user', text: 'معاملة' }])).text)
    expect(client.requests).toHaveLength(2)
    expect(JSON.stringify(client.requests[1].messages.at(-1)?.content)).toContain('INVALID_INPUT')
    expect(replyFromEvents(events).ui.some(item => item.kind === 'clarify')).toBe(false)
  })

  it('text before the clarifying call is retracted: the question is shown once', async () => {
    const client = new DynamicClient(() => ({
      text: 'خلني أفهم طلبك.',
      message: message(
        [
          { type: 'text', text: 'خلني أفهم طلبك.' },
          toolUse('toolu_q2', 'ask_clarification', { question: QUESTION, options: OPTIONS }),
        ],
        'tool_use'
      ),
    }))
    ;(await assistant()).setAssistantClient(client)
    const reply = replyFromEvents(parseEvents((await converse([{ role: 'user', text: 'جواز' }])).text))
    expect(reply.text).toBe(QUESTION)
    expect(reply.text.split(QUESTION).length - 1).toBe(1)
  })

  it('fallback (no key): a request that names no service gets one question with service chips', async () => {
    ;(await assistant()).setAssistantClient(null)
    const reply = replyFromEvents(parseEvents((await converse([{ role: 'user', text: 'أريد معاملة' }])).text))
    const clarify = reply.ui.find(item => item.kind === 'clarify') as { options: string[] } | undefined
    expect(clarify?.options.length).toBeGreaterThanOrEqual(2)
    expect(reply.text).toContain('شنو المعاملة')
    // tapping a chip gives a full, actionable answer
    const next = replyFromEvents(parseEvents((await converse([{ role: 'user', text: clarify!.options[0] }])).text))
    expect(next.text).toContain('**المستمسكات:**')
    expect(next.text).toContain('**الخطوات:**')
    expect(splitAction(next.text).action?.path).toMatch(/^\//)
    expect(paragraphsRepeated(next.text)).toEqual([])
  })

  it('fallback answers are practical: steps ≤ 5, documents, where to go, one action, fee only if official', async () => {
    ;(await assistant()).setAssistantClient(null)
    const reply = replyFromEvents(
      parseEvents((await converse([{ role: 'user', text: 'شنو المستمسكات لاعتراض على قائمة الماء' }])).text)
    )
    const steps = reply.text.match(/^\d\. /gm) || []
    expect(steps.length).toBeGreaterThan(0)
    expect(steps.length).toBeLessThanOrEqual(5)
    expect(reply.text).toContain('**وين تراجع:**')
    expect(reply.text).not.toContain('رسم غير مؤكد')
    expect(splitAction(reply.text).action).not.toBeNull()
  })
})

// ---- session memory and the voice channel ----------------------------------------------------------------------
describe('voice channel and session memory', () => {
  it('a spoken question tells the model to answer in the short voice shape', async () => {
    const short =
      'تكدر تجدد جوازك من المنصة وتراجع بموعد. جيب البطاقة الوطنية والجواز القديم.\n[افتح الخدمة](/service/e-passport)'
    const client = new DynamicClient(() => ({
      text: short,
      message: message([{ type: 'text', text: short }], 'end_turn'),
    }))
    ;(await assistant()).setAssistantClient(client)
    await converse([{ role: 'user', text: 'أريد أجدد جوازي' }], 'voice')
    expect(systemNote(client.requests[0])).toContain('Channel: VOICE')
    const system = JSON.stringify(client.requests[0].system)
    expect(system).toContain('Answer shape (voice)')
    expect(system).toContain('2 to 4 short conversational sentences')
    await converse([{ role: 'user', text: 'أريد أجدد جوازي' }], 'text')
    expect(systemNote(client.requests[1])).toContain('Channel: text')
  })

  it('rejects an unknown channel', async () => {
    const response = await request(app)
      .post('/api/assistant/chat')
      .send({ messages: [{ role: 'user', text: 'هلا' }], channel: 'telepathy' })
    expect(response.status).toBe(400)
  })

  it('the session note carries the signed-in citizen first name and district (not asked again)', async () => {
    const { db } = await import('../server/db.ts')
    const now = new Date().toISOString()
    const id = Number(
      db
        .prepare(
          `INSERT INTO citizens (full_name, national_id_masked, phone_masked, verification_status, district, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run('علي حسين كاظم', '****1234', '0780***1234', 'VERIFIED', 'الشطرة', now, now).lastInsertRowid
    )
    const { sessionNote } = await import('../server/assistant/chat.ts')
    const note = sessionNote({ citizenId: id }, 'voice')
    expect(note).toContain('علي')
    expect(note).not.toContain('كاظم')
    expect(note).toContain('الشطرة')
    expect(note).toContain('Channel: VOICE')
    expect(sessionNote({ citizenId: null })).toContain('visitor')
  })

  it('what is read aloud stays short, with no markdown, links or the action line', async () => {
    ;(await assistant()).setAssistantClient(null)
    const reply = replyFromEvents(
      parseEvents((await converse([{ role: 'user', text: 'شنو المستمسكات لاعتراض على قائمة الماء' }], 'voice')).text)
    )
    const { body, action } = splitAction(reply.text)
    expect(action?.path).toMatch(/^\//)
    // a voice answer is a few sentences (no step list); the card under it carries the full documents
    expect(body).not.toMatch(/^\d\. /m)
    expect(reply.ui.some(item => item.kind === 'services')).toBe(true)
    const { sentences } = takeSentences(body, 0, true)
    expect(sentences.length).toBeGreaterThanOrEqual(2)
    expect(sentences.length).toBeLessThanOrEqual(5)
    const spoken = voiceSummary(sentences.map(speakableText))
    expect(spoken.truncated).toBe(false)
    const said = spoken.sentences.join(' ')
    expect(said.length).toBeLessThanOrEqual(420)
    expect(said).not.toMatch(/\*\*|\]\(|\/service\/|https?:/)
    // the same question typed gets the full practical answer
    const typed = replyFromEvents(
      parseEvents((await converse([{ role: 'user', text: 'شنو المستمسكات لاعتراض على قائمة الماء' }], 'text')).text)
    )
    expect(typed.text.length).toBeGreaterThan(body.length)
    expect(typed.text).toContain('**الخطوات:**')
  })
})

// ---- speech helpers ----------------------------------------------------------------------------------------
describe('speech helpers', () => {
  it('speakableText strips markdown, links and list markers', () => {
    expect(speakableText('**المستمسكات:**\n- البطاقة الوطنية\n1. افتح [الخدمة](/service/x) https://x.y')).toBe(
      'المستمسكات:\nالبطاقة الوطنية\nافتح الخدمة'
    )
  })

  it('takeSentences speaks complete sentences while streaming, the rest at the end, nothing twice', () => {
    const streamed = 'تكدر تقدّم من المنصة. جيب البطاقة'
    const first = takeSentences(streamed, 0)
    expect(first.sentences).toEqual(['تكدر تقدّم من المنصة.'])
    const full = `${streamed} الوطنية؟ وبعدها راجع`
    const second = takeSentences(full, first.next)
    expect(second.sentences).toEqual(['جيب البطاقة الوطنية؟'])
    const last = takeSentences(full, second.next, true)
    expect(last.sentences).toEqual(['وبعدها راجع'])
    expect([...first.sentences, ...second.sentences, ...last.sentences].join(' ')).toBe(full)
  })

  it('voiceSummary keeps a long answer short and says it was cut', () => {
    const long = Array.from({ length: 12 }, (_, index) => `هذه جملة رقم ${index + 1} من جواب طويل جداً عن الخدمة.`)
    const summary = voiceSummary(long)
    expect(summary.truncated).toBe(true)
    expect(summary.sentences.join(' ').length).toBeLessThanOrEqual(420)
  })

  it('spokenOptions reads the chips as one sentence', () => {
    expect(spokenOptions(['أول مرة', 'تجديد', 'بدل ضائع'])).toBe('مثلاً: أول مرة، تجديد، أو بدل ضائع.')
  })

  it('pickArabicVoice prefers Iraqi / Saudi / Egyptian neural voices and ignores non-Arabic ones', () => {
    const voices = [
      { name: 'Google US English', lang: 'en-US' },
      { name: 'Maged (compact)', lang: 'ar-SA' },
      { name: 'Microsoft Salma Online (Natural) - Arabic (Egypt)', lang: 'ar-EG' },
      { name: 'Microsoft Hamed Online (Natural) - Arabic (Saudi Arabia)', lang: 'ar-SA' },
    ]
    expect(pickArabicVoice(voices)?.name).toContain('Hamed')
    expect(pickArabicVoice([...voices, { name: 'Microsoft Bassel Online (Natural)', lang: 'ar-IQ' }])?.lang).toBe(
      'ar-IQ'
    )
    expect(pickArabicVoice([{ name: 'Samantha', lang: 'en-US' }])).toBeNull()
  })

  it('the energy VAD stops 1.2 s after speech and reports no-speech when nobody talks', () => {
    const vad = createVad()
    let t = 0
    for (; t < 300; t += 30) expect(vad.push(0.005, t)).toBe('quiet')
    for (; t < 1200; t += 30) vad.push(0.2, t)
    expect(vad.heard).toBe(true)
    let state = ''
    for (; t < 2300; t += 30) state = vad.push(0.004, t)
    expect(state).toBe('quiet')
    for (; t < 2500; t += 30) state = vad.push(0.004, t)
    expect(state).toBe('silence')
    const silent = createVad({ noSpeechMs: 1000 })
    let result = ''
    for (let time = 0; time <= 1100; time += 50) result = silent.push(0.003, time)
    expect(result).toBe('no-speech')
    expect(frameEnergy(new Uint8Array([128, 128, 128]))).toBe(0)
  })
})

// ---- /api/assistant/transcribe -----------------------------------------------------------------------------------
const webm = (size = 2048) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(size, 7)])

class FakeSpeech implements SpeechProvider {
  readonly name = 'fake'
  received: TranscribeInput[] = []
  async transcribe(input: TranscribeInput) {
    this.received.push({ ...input, audio: Buffer.from(input.audio) })
    return '  أريد أجدد جوازي  '
  }
  async speak(text: string) {
    return Buffer.from(`ID3-${text}`)
  }
}

const transcribe = (audio: Buffer, options: { type?: string; durationMs?: number; name?: string } = {}) =>
  request(app)
    .post('/api/assistant/transcribe')
    .field('durationMs', String(options.durationMs ?? 3200))
    .attach('audio', audio, { filename: options.name || 'speech.webm', contentType: options.type || 'audio/webm' })

describe('POST /api/assistant/transcribe', () => {
  it('answers 501 (type instead) when no speech provider is configured, and config says so', async () => {
    ;(await speech()).setSpeechProvider(null)
    const response = await transcribe(webm())
    expect(response.status).toBe(501)
    expect(response.body.message).toContain('الكتابة متاحة')
    const config = await request(app).get('/api/assistant/config')
    expect(config.body.voice).toEqual({ transcribe: false, serverTts: false, provider: null })
  })

  it('transcribes with the provider (Arabic text back), trimmed; config advertises it', async () => {
    const provider = new FakeSpeech()
    ;(await speech()).setSpeechProvider(provider)
    const response = await transcribe(webm(), { type: 'audio/webm;codecs=opus' })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ text: 'أريد أجدد جوازي' })
    expect(provider.received).toHaveLength(1)
    expect(provider.received[0].mimeType).toBe('audio/webm')
    expect(provider.received[0].filename).toBe('speech.webm')
    expect((await request(app).get('/api/assistant/config')).body.voice).toMatchObject({
      transcribe: true,
      provider: 'fake',
    })
    // iOS Safari records mp4/aac
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(512, 1)])
    const ios = await transcribe(mp4, { type: 'audio/mp4', name: 'speech.mp4' })
    expect(ios.status).toBe(200)
    expect(provider.received[1].filename).toBe('speech.mp4')
  })

  it('enforces the limits: format, missing clip, 60 s and 10 MB', async () => {
    const provider = new FakeSpeech()
    ;(await speech()).setSpeechProvider(provider)
    expect((await transcribe(Buffer.from('not audio at all, just text'), { type: 'audio/webm' })).status).toBe(415)
    expect((await transcribe(webm(), { type: 'image/png' })).status).toBe(415)
    expect((await request(app).post('/api/assistant/transcribe').field('durationMs', '1000')).status).toBe(400)
    expect((await transcribe(webm(), { durationMs: 75_000 })).status).toBe(413)
    expect((await transcribe(webm(10 * 1024 * 1024 + 10))).status).toBe(413)
    expect(provider.received).toHaveLength(0)
  })

  it('a provider failure is a clean 502 in Arabic', async () => {
    ;(await speech()).setSpeechProvider({
      name: 'broken',
      transcribe: async () => {
        throw new Error('down')
      },
    })
    const response = await transcribe(webm())
    expect(response.status).toBe(502)
    expect(response.body.message).toContain('تعذر تحويل الكلام')
  })

  it('rate-limits voice to 20 clips per 10 minutes', async () => {
    ;(await speech()).setSpeechProvider(new FakeSpeech())
    process.env.RATE_LIMIT_ENABLED = 'true'
    try {
      const statuses: number[] = []
      for (let index = 0; index < 21; index++) statuses.push((await transcribe(webm(64))).status)
      expect(statuses.slice(0, 20).every(status => status === 200)).toBe(true)
      expect(statuses[20]).toBe(429)
    } finally {
      delete process.env.RATE_LIMIT_ENABLED
    }
  })

  it('the server voice is off by default and works only behind ASSISTANT_SERVER_TTS', async () => {
    ;(await speech()).setSpeechProvider(new FakeSpeech())
    expect((await request(app).post('/api/assistant/speak').send({ text: 'هلا' })).status).toBe(501)
    process.env.ASSISTANT_SERVER_TTS = 'true'
    const response = await request(app).post('/api/assistant/speak').send({ text: 'هلا بيك' }).buffer(true)
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('audio/mpeg')
    expect(
      (
        await request(app)
          .post('/api/assistant/speak')
          .send({ text: 'x'.repeat(700) })
      ).status
    ).toBe(400)
  })
})

// ---- review regressions: the server enforces the clip limits itself ------------------------------------------------
/** A minimal MediaRecorder-style webm (unknown-size segment and clusters), one block per cluster timestamp (ms). */
const webmSpanning = (timestamps: number[]) => {
  const unknown = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]
  const bytes: number[] = [0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, ...unknown]
  for (const time of timestamps) {
    bytes.push(0x1f, 0x43, 0xb6, 0x75, ...unknown)
    bytes.push(0xe7, 0x84, (time >>> 24) & 0xff, (time >>> 16) & 0xff, (time >>> 8) & 0xff, time & 0xff)
    // SimpleBlock: track 1, relative time 0, keyframe, 40 bytes of "audio"
    bytes.push(0xa3, 0x80 | 44, 0x81, 0x00, 0x00, 0x80, ...new Array<number>(40).fill(7))
  }
  return Buffer.from(bytes)
}

const oggPage = (granule: bigint, body: Buffer) => {
  const header = Buffer.alloc(27)
  header.write('OggS', 0, 'latin1')
  header.writeBigInt64LE(granule, 6)
  header[26] = 1
  return Buffer.concat([header, Buffer.from([body.length]), body])
}

describe('POST /api/assistant/transcribe — limits the browser cannot lie about', () => {
  it('requires a positive declared duration: omitted, negative or nonsense is refused before the provider', async () => {
    const provider = new FakeSpeech()
    ;(await speech()).setSpeechProvider(provider)
    const noDuration = await request(app)
      .post('/api/assistant/transcribe')
      .attach('audio', webm(), { filename: 'speech.webm', contentType: 'audio/webm' })
    expect(noDuration.status).toBe(400)
    for (const durationMs of ['-1', '0', 'abc', '1e9'])
      expect(
        (
          await request(app)
            .post('/api/assistant/transcribe')
            .field('durationMs', durationMs)
            .attach('audio', webm(), { filename: 'speech.webm', contentType: 'audio/webm' })
        ).status
      ).toBeGreaterThanOrEqual(400)
    expect(provider.received).toHaveLength(0)
  })

  it('a clip with more bytes than its declared seconds can hold is refused (no 40-minute clip as «3 s»)', async () => {
    const provider = new FakeSpeech()
    ;(await speech()).setSpeechProvider(provider)
    expect((await transcribe(webm(900 * 1024), { durationMs: 3200 })).status).toBe(413)
    // the whole clip is capped well below the old 10 MB
    expect((await transcribe(webm(1100 * 1024), { durationMs: 60_000 })).status).toBe(413)
    expect(provider.received).toHaveLength(0)
  })

  it('reads the real length from the container: a 90 s webm declared as 3 s is refused, a 4 s one passes', async () => {
    const provider = new FakeSpeech()
    const voice = await speech()
    voice.setSpeechProvider(provider)
    expect(voice.audioDurationMs(webmSpanning([0, 2000, 4000]))).toBe(4000)
    expect((await transcribe(webmSpanning([0, 30_000, 90_000]), { durationMs: 3200 })).status).toBe(413)
    expect(provider.received).toHaveLength(0)
    expect((await transcribe(webmSpanning([0, 2000, 4000]), { durationMs: 4100 })).status).toBe(200)
    expect(provider.received).toHaveLength(1)
    // ogg (opus granules at 48 kHz) and wav (data bytes / byte rate) are measured too
    const opusHead = Buffer.concat([Buffer.from('OpusHead', 'latin1'), Buffer.alloc(11)])
    const ogg = Buffer.concat([
      oggPage(0n, opusHead),
      oggPage(48_000n, Buffer.alloc(8)),
      oggPage(48_000n * 91n, Buffer.alloc(8)),
    ])
    expect(voice.audioDurationMs(ogg)).toBe(90_000)
    const wav = Buffer.alloc(44 + 32_000)
    wav.write('RIFF', 0, 'latin1')
    wav.write('WAVE', 8, 'latin1')
    wav.write('fmt ', 12, 'latin1')
    wav.writeUInt32LE(16, 16)
    wav.writeUInt32LE(16_000, 28)
    wav.write('data', 36, 'latin1')
    wav.writeUInt32LE(32_000, 40)
    expect(voice.audioDurationMs(wav)).toBe(2000)
    expect(voice.audioDurationMs(webm())).toBeNull()
  })

  it('a daily cap stops paid transcription (503 «اكتب سؤالك») without calling the provider', async () => {
    const provider = new FakeSpeech()
    const voice = await speech()
    voice.setSpeechProvider(provider)
    const { voiceUsageToday } = await import('../server/assistant/store.ts')
    process.env.ASSISTANT_DAILY_STT_LIMIT = String(voiceUsageToday().clips + 1)
    try {
      expect((await transcribe(webm())).status).toBe(200)
      const refused = await transcribe(webm())
      expect(refused.status).toBe(503)
      expect(refused.body.code).toBe('STT_BUDGET')
      expect(refused.body.message).toContain('اكتب')
      expect(provider.received).toHaveLength(1)
    } finally {
      delete process.env.ASSISTANT_DAILY_STT_LIMIT
    }
    expect(voice.dailyTranscribeLimit()).toBe(1000)
    process.env.ASSISTANT_DAILY_STT_LIMIT = 'unlimited'
    expect(voice.dailyTranscribeLimit()).toBeNull()
    delete process.env.ASSISTANT_DAILY_STT_LIMIT
  })

  it('the server voice has its own limiter (a call per sentence) and passes an abort signal to the provider', async () => {
    const signals: Array<AbortSignal | undefined> = []
    ;(await speech()).setSpeechProvider({
      name: 'fake',
      transcribe: async () => '',
      speak: async (text: string, signal?: AbortSignal) => {
        signals.push(signal)
        return Buffer.from(`ID3-${text}`)
      },
    })
    process.env.ASSISTANT_SERVER_TTS = 'true'
    process.env.RATE_LIMIT_ENABLED = 'true'
    try {
      // the clip limiter of this client is already spent by the rate-limit test above: speaking still works
      const statuses: number[] = []
      for (let index = 0; index < 30; index++)
        statuses.push((await request(app).post('/api/assistant/speak').send({ text: 'جملة قصيرة.' })).status)
      expect(statuses.every(status => status === 200)).toBe(true)
      expect(signals.every(signal => signal instanceof AbortSignal)).toBe(true)
    } finally {
      delete process.env.RATE_LIMIT_ENABLED
    }
  })
})

// ---- review regressions: the session note never passes placeholders as facts --------------------------------------
describe('session note: only real names and districts', () => {
  const insertCitizen = async (name: string, status: string, district: string) => {
    const { db } = await import('../server/db.ts')
    const now = new Date().toISOString()
    return Number(
      db
        .prepare(
          `INSERT INTO citizens (full_name, national_id_masked, phone_masked, verification_status, district, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(name, '****0000', '0780***0000', status, district, now, now).lastInsertRowid
    )
  }

  it('a new phone-only account («مواطن جديد», «غير محدد») gets no name and no "do not ask the district"', async () => {
    const { sessionNote } = await import('../server/assistant/chat.ts')
    const note = sessionNote({ citizenId: await insertCitizen('مواطن جديد', 'PHONE_VERIFIED', 'غير محدد') })
    expect(note).toContain('signed in')
    expect(note).not.toContain('مواطن')
    expect(note).not.toContain('غير محدد')
    expect(note).not.toContain('do not ask')
    expect(note).not.toContain('first name')
  })

  it('an unverified name is not used; a verified one is, and only a real Dhi Qar district is "known"', async () => {
    const { sessionNote, knownDistrict } = await import('../server/assistant/chat.ts')
    const pending = sessionNote({ citizenId: await insertCitizen('حسن علي', 'PENDING_REVIEW', 'الناصرية') })
    expect(pending).not.toContain('حسن')
    expect(pending).toContain('الناصرية')
    const unknown = sessionNote({ citizenId: await insertCitizen('زينب كريم', 'VERIFIED', 'غير محدد') })
    expect(unknown).toContain('زينب')
    expect(unknown).not.toContain('District')
    expect(knownDistrict('قضاء الرفاعي')).toBeTruthy()
    expect(knownDistrict('ناحية الإصلاح')).toBeTruthy()
    expect(knownDistrict('سوق الشيوخ')).toBeTruthy()
    expect(knownDistrict('بغداد')).toBeNull()
    expect(knownDistrict('')).toBeNull()
  })
})

// ---- review regressions: fallback answers land where the citizen pointed ---------------------------------------------
describe('fallback: chips and appointment services', () => {
  type Card = { title: string; channel: string }
  const firstService = (answer: { ui: Array<{ kind: string }> }) =>
    (answer.ui.find(item => item.kind === 'services') as { items: Card[] } | undefined)?.items[0]
  const chipsOf = (answer: { ui: Array<{ kind: string }> }) =>
    (answer.ui.find(item => item.kind === 'clarify') as { options: string[] } | undefined)?.options || []

  it('every chip it offers answers with exactly that service (not the complaints / news / tracking help)', async () => {
    const { fallbackAnswer, COMMON_SERVICES } = await import('../server/assistant/fallback.ts')
    const chips = new Set<string>(COMMON_SERVICES)
    for (const word of ['انقطاع', 'فقدان', 'مجاري', 'ضائع', 'هوية', 'شهادة', 'جواز', 'ماء', 'كهرباء', 'تجديد'])
      for (const chip of chipsOf(fallbackAnswer(word, { citizenId: null }))) chips.add(chip)
    // the chips that used to fall into the keyword routes are among them
    expect([...chips]).toEqual(
      expect.arrayContaining(['بلاغ انقطاع ماء أو تسرب/كسر في الشبكة', 'إخبار فقدان مستمسكات أو ممتلكات'])
    )
    for (const context of [{ citizenId: null }, { citizenId: 1 }]) {
      const missed = [...chips].filter(chip => firstService(fallbackAnswer(chip, context))?.title !== chip)
      expect(missed).toEqual([])
    }
    // a tracking-looking title is that service, not «sign in to follow your request»
    expect(firstService(fallbackAnswer('متابعة حالة بلاغ مجاري', { citizenId: null }))?.title).toBe(
      'متابعة حالة بلاغ مجاري'
    )
  })

  it('an appointment service says «online, then attendance by appointment» and keeps the attendance step', async () => {
    const { fallbackAnswer } = await import('../server/assistant/fallback.ts')
    const { listCatalogServices } = await import('../server/services/catalog.ts')
    let checked = 0
    const wrong: string[] = []
    for (const service of listCatalogServices({ channel: 'APPOINTMENT_REQUIRED' })) {
      const answer = fallbackAnswer(service.title, { citizenId: null })
      if (firstService(answer)?.channel !== 'APPOINTMENT_REQUIRED') continue
      checked++
      const steps = answer.text.match(/^\d\. .*$/gm) || []
      if (
        !answer.text.includes('ثم حضور بموعد') ||
        answer.text.includes('**وين تراجع:** إلكترونياً من المنصة') ||
        !steps.some(step => step.includes('موعد حضورك')) ||
        steps.length > 5
      )
        wrong.push(service.title)
    }
    expect(checked).toBeGreaterThan(50)
    expect(wrong).toEqual([])
    // exhaustive over the whole catalog (~200 services × a full fallback search each): ~14 s alone, more under load
  }, 120_000)

  it('the privacy help says who hears the voice and that «محادثة متواصلة» reopens the microphone', async () => {
    const { platformHelp } = await import('../server/assistant/knowledge.ts')
    ;(await speech()).setSpeechProvider(null)
    const browserOnly = platformHelp('privacy', { onlinePayment: false }).facts.join(' ')
    expect(browserOnly).toContain('محادثة متواصلة')
    expect(browserOnly).not.toContain('مزوّد')
    ;(await speech()).setSpeechProvider(new FakeSpeech())
    expect(platformHelp('privacy', { onlinePayment: false }).facts.join(' ')).toContain('fake')
  })
})
