// "تدقيق ذكي" for staff: department scoping, the rules baseline without a key, a mocked structured model result,
// the ASSISTANT_DOCUMENT_REVIEW privacy gate, persistence in ai_reviews and the audit trail.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf } from './helpers'
import type { AssistantModelClient, BetaMessage, ModelRequest } from '../server/assistant/client'

configureTestEnv()

let app: Express
let admin = ''
let citizen = ''
let gov = ''
let water = ''
let reference = ''

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)])
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])

const assistant = async () => import('../server/assistant/client.ts')
const db = async () => (await import('../server/db.ts')).db

async function staffLogin(username: string, password: string) {
  const response = await request(app).post('/api/auth/staff/login').send({ username, password })
  expect(response.status).toBe(200)
  return cookieOf(response)
}

async function createStaff(username: string, departmentId: string) {
  const created = await request(app)
    .post('/api/super-admin/staff')
    .set('Cookie', admin)
    .send({ username, fullName: `Test ${username}`, role: 'EMPLOYEE', departmentId })
  expect(created.status).toBe(201)
  const cookie = await staffLogin(username, created.body.temporaryPassword)
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', cookie)
    .send({ currentPassword: created.body.temporaryPassword, newPassword: `Rotated-${username}-2026!` })
  return cookie
}

async function submitComplaint() {
  const service = (await request(app).get('/api/services/gov-complaint')).body as {
    fields: Array<{ key: string; type: string; options?: string[] }>
    requiredDocuments: Array<{ key: string }>
  }
  const data = Object.fromEntries(
    service.fields.map(field => [
      field.key,
      field.options?.length ? field.options[0] : field.type === 'tel' ? '07701234567' : 'بيانات اختبار',
    ])
  )
  let req = request(app)
    .post('/api/service-requests')
    .set('Cookie', citizen)
    .field('serviceKey', 'gov-complaint')
    .field('data', JSON.stringify(data))
    .field('faceConsent', 'true')
    .field('documentConsent', 'true')
  for (const doc of service.requiredDocuments)
    req = req.attach(`doc__${doc.key}`, doc.key === 'national-id' ? jpeg : pdf, {
      filename: `${doc.key}.${doc.key === 'national-id' ? 'jpg' : 'pdf'}`,
      contentType: doc.key === 'national-id' ? 'image/jpeg' : 'application/pdf',
    })
  const response = await req.attach('faceVideo', webm, { filename: 'face.webm', contentType: 'video/webm' })
  expect(response.status).toBe(201)
  return response.body.reference as string
}

const reviewMessage = (output: unknown, stopReason = 'end_turn') =>
  ({
    id: 'msg_review',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text: JSON.stringify(output) }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 800, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 300 },
  }) as unknown as BetaMessage

class ReviewClient implements AssistantModelClient {
  requests: ModelRequest[] = []
  constructor(private readonly reply: BetaMessage) {}
  async stream(): Promise<BetaMessage> {
    throw new Error('the review never streams')
  }
  async create(req: ModelRequest) {
    this.requests.push(req)
    return this.reply
  }
}

const review = (cookie: string, ref = reference) =>
  request(app).post(`/api/employee/service-requests/${ref}/ai-review`).set('Cookie', cookie).send({})

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  admin = await staffLogin('admin', 'Bootstrap-Admin-Pass-2026!')
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', admin)
    .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Admin-Rotated-Pass-2026!' })
  const requested = await request(app).post('/api/onboarding/request-otp').send({ phone: '07801239301' })
  citizen = cookieOf(
    await request(app)
      .post('/api/onboarding/verify-phone')
      .send({ phone: '07801239301', challengeId: requested.body.challengeId, otp: '246810' })
  )
  ;(await db()).prepare(`UPDATE citizens SET verification_status = 'VERIFIED_MANUAL'`).run()
  gov = await createStaff('review.gov', 'dhiqar-governorate')
  water = await createStaff('review.water', 'dhiqar-water')
  reference = await submitComplaint()
})

afterEach(async () => {
  ;(await assistant()).setAssistantClient(undefined)
  delete process.env.ASSISTANT_DOCUMENT_REVIEW
})

describe('POST /api/employee/service-requests/:reference/ai-review', () => {
  it("is limited to staff of the request's department", async () => {
    ;(await assistant()).setAssistantClient(null)
    expect((await review(citizen)).status).toBe(401)
    expect((await review(water)).status).toBe(403)
    expect((await review(gov, 'TQS-2000-99999')).status).toBe(404)
    expect(
      (await request(app).get(`/api/employee/service-requests/${reference}/ai-review`).set('Cookie', water)).status
    ).toBe(403)
  })

  it('without a key returns the rules result, stores it and audits it', async () => {
    ;(await assistant()).setAssistantClient(null)
    const response = await review(gov)
    expect(response.status).toBe(200)
    const result = response.body.review
    expect(result).toMatchObject({ source: 'RULES', model: null, verdict: 'READY', documentReview: false })
    expect(result.documents.map((doc: { key: string }) => doc.key)).toEqual(['national-id', 'supporting-evidence'])
    expect(result.notice).toContain('غير مفعّل')
    const latest = await request(app).get(`/api/employee/service-requests/${reference}/ai-review`).set('Cookie', gov)
    expect(latest.body.review.id).toBe(result.id)
    const audit = (await db())
      .prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'SERVICE_REQUEST_AI_REVIEW' AND entity_id = ?`)
      .get(reference) as { n: number }
    expect(audit.n).toBeGreaterThan(0)
  })

  it('a mocked model result is merged with the checklist; files stay on the server by default', async () => {
    const client = new ReviewClient(
      reviewMessage({
        verdict: 'READY',
        summary: 'البطاقة غير واضحة.',
        documents: [{ key: 'national-id', status: 'UNCLEAR', reason: 'الصورة مقصوصة.' }],
        fieldIssues: [{ field: 'تفاصيل الشكوى', issue: 'قصيرة جداً.' }],
        missingItems: ['صورة واضحة للبطاقة الوطنية'],
        citizenNote: 'ناقصة بس: صورة واضحة للبطاقة الوطنية. ارفعها من صفحة طلبك.',
      })
    )
    ;(await assistant()).setAssistantClient(client)
    const response = await review(gov)
    expect(response.status).toBe(200)
    const result = response.body.review
    expect(result).toMatchObject({ source: 'MODEL', model: 'claude-opus-5-5', documentsSent: 0 })
    // a model "READY" with missing items is never shown as ready
    expect(result.verdict).toBe('MISSING_ITEMS')
    expect(result.citizenNote.startsWith('ناقصة بس')).toBe(true)
    expect(result.documents.find((doc: { key: string }) => doc.key === 'national-id').status).toBe('UNCLEAR')
    expect(result.notice).toContain('ASSISTANT_DOCUMENT_REVIEW')
    // request: structured output, medium effort, no files without the flag
    const sent = client.requests[0]
    expect(sent.output_config?.effort).toBe('medium')
    expect(sent.output_config?.format?.type).toBe('json_schema')
    expect(sent.fallbacks).toBe('default')
    expect(JSON.stringify(sent.messages)).not.toContain('"type":"image"')
    expect(JSON.stringify(sent.messages)).not.toContain('"type":"document"')
    // the AI never decides: the request status is untouched
    const status = (await db()).prepare('SELECT status FROM service_requests WHERE reference = ?').get(reference) as {
      status: string
    }
    expect(['SUBMITTED', 'UNDER_REVIEW']).toContain(status.status)
  })

  it('sends the decrypted files as image/document blocks only with ASSISTANT_DOCUMENT_REVIEW=true', async () => {
    process.env.ASSISTANT_DOCUMENT_REVIEW = 'true'
    const client = new ReviewClient(
      reviewMessage({
        verdict: 'READY',
        summary: 'المستمسكات واضحة.',
        documents: [
          { key: 'national-id', status: 'PRESENT', reason: 'واضحة.' },
          { key: 'supporting-evidence', status: 'PRESENT', reason: 'مرفق.' },
        ],
        fieldIssues: [],
        missingItems: [],
        citizenNote: '',
      })
    )
    ;(await assistant()).setAssistantClient(client)
    const result = (await review(gov)).body.review
    expect(result).toMatchObject({ verdict: 'READY', documentsSent: 2, documentReview: true, citizenNote: '' })
    const body = JSON.stringify(client.requests[0].messages)
    expect(body).toContain('"type":"image"')
    expect(body).toContain('"type":"document"')
  })

  it('a never-uploaded required document stays MISSING whatever the model says', async () => {
    const database = await db()
    const row = database
      .prepare('SELECT document_checklist FROM service_requests WHERE reference = ?')
      .get(reference) as {
      document_checklist: string
    }
    const checklist = JSON.parse(row.document_checklist) as Array<{
      key: string
      mediaId: string | null
      status: string
    }>
    const original = row.document_checklist
    for (const item of checklist)
      if (item.key === 'national-id') Object.assign(item, { mediaId: null, status: 'MISSING' })
    database
      .prepare('UPDATE service_requests SET document_checklist = ? WHERE reference = ?')
      .run(JSON.stringify(checklist), reference)
    try {
      const client = new ReviewClient(
        reviewMessage({
          verdict: 'READY',
          summary: 'تمام.',
          documents: [{ key: 'national-id', status: 'PRESENT', reason: 'موجودة.' }],
          fieldIssues: [],
          missingItems: [],
          citizenNote: '',
        })
      )
      ;(await assistant()).setAssistantClient(client)
      const result = (await review(gov)).body.review
      expect(result.verdict).toBe('MISSING_ITEMS')
      expect(result.documents.find((doc: { key: string }) => doc.key === 'national-id').status).toBe('MISSING')
      expect(result.citizenNote).toContain('ناقصة بس')
      expect(result.missingItems.length).toBe(1)
    } finally {
      database
        .prepare('UPDATE service_requests SET document_checklist = ? WHERE reference = ?')
        .run(original, reference)
    }
  })

  it('a refusal or a broken reply falls back to the rules result', async () => {
    ;(await assistant()).setAssistantClient(new ReviewClient(reviewMessage({}, 'refusal')))
    expect((await review(gov)).body.review).toMatchObject({ source: 'RULES' })
    ;(await assistant()).setAssistantClient(new ReviewClient(reviewMessage({ nope: true })))
    expect((await review(gov)).body.review).toMatchObject({ source: 'RULES' })
  })
})
