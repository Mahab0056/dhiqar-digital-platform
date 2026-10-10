// Official tenders and auctions: public listing/detail, derived open/closed status, and who may publish
// (anonymous never; a department manager only for their own department; the super admin for any entity).
import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()

let app: Express
let admin = ''
let manager = ''
let clerk = ''
const staffIds: Record<string, string> = {}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

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
  staffIds[username] = created.body.account.id
  const cookie = await staffLogin(username, created.body.temporaryPassword)
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', cookie)
    .send({ currentPassword: created.body.temporaryPassword, newPassword: `Rotated-${username}-2026!` })
  return cookie
}

const tender = (overrides: Record<string, unknown> = {}) => ({
  reference: 'م/2026/14',
  title: 'تأهيل شبكة ماء حي الشهداء في الناصرية',
  type: 'TENDER',
  description: 'أعمال مدنية وتجهيز أنابيب.',
  estimatedCostIqd: 750_000_000,
  bidBond: '1% من الكلفة التخمينية',
  closingAt: inDays(10),
  documentUrl: 'https://thiqar.gov.iq/docs/tender-14.pdf',
  ...overrides,
})

beforeAll(async () => {
  const { createPlatformServer } = await import('../server/create-server.ts')
  app = createPlatformServer({ serveStatic: false }).app
  admin = await staffLogin('admin', 'Bootstrap-Admin-Pass-2026!')
  await request(app)
    .post('/api/auth/staff/change-password')
    .set('Cookie', admin)
    .send({ currentPassword: 'Bootstrap-Admin-Pass-2026!', newPassword: 'Admin-Rotated-Pass-2026!' })
  manager = await createStaff('tn.water.manager', 'dhiqar-water')
  clerk = await createStaff('tn.water.clerk', 'dhiqar-water')
  const flagged = await request(app)
    .patch(`/api/super-admin/staff/${staffIds['tn.water.manager']}`)
    .set('Cookie', admin)
    .send({ isDepartmentManager: true })
  expect(flagged.status).toBe(200)
})

describe('tender permissions', () => {
  it('refuses anonymous visitors and plain employees', async () => {
    expect((await request(app).post('/api/staff/tenders').send(tender())).status).toBe(401)
    expect((await request(app).post('/api/staff/tenders').set('Cookie', clerk).send(tender())).status).toBe(403)
    expect((await request(app).get('/api/staff/tenders').set('Cookie', clerk)).status).toBe(403)
  })

  it('lets a department manager publish only for their own department', async () => {
    const created = await request(app)
      .post('/api/staff/tenders')
      .set('Cookie', manager)
      .send(tender({ departmentId: 'dhiqar-health' }))
    expect(created.status).toBe(201)
    // the body asked for another department; the manager's own department wins
    expect(created.body.departmentId).toBe('dhiqar-water')
    expect(created.body.status).toBe('OPEN')

    const adminTender = await request(app)
      .post('/api/staff/tenders')
      .set('Cookie', admin)
      .send(tender({ reference: 'ص/77', title: 'تجهيز مستشفى الحبوبي بأجهزة طبية', departmentId: 'dhiqar-health' }))
    expect(adminTender.status).toBe(201)
    const editOther = await request(app)
      .patch(`/api/staff/tenders/${adminTender.body.id}`)
      .set('Cookie', manager)
      .send({ title: 'محاولة تعديل جهة أخرى' })
    expect(editOther.status).toBe(403)
    const cancelOther = await request(app)
      .post(`/api/staff/tenders/${adminTender.body.id}/status`)
      .set('Cookie', manager)
      .send({ state: 'CANCELLED' })
    expect(cancelOther.status).toBe(403)

    const own = await request(app).get('/api/staff/tenders').set('Cookie', manager)
    expect(own.body.items.every((item: { departmentId: string }) => item.departmentId === 'dhiqar-water')).toBe(true)
    const all = await request(app).get('/api/staff/tenders').set('Cookie', admin)
    expect(all.body.total).toBe(2)

    const edited = await request(app)
      .patch(`/api/staff/tenders/${created.body.id}`)
      .set('Cookie', manager)
      .send({ title: 'تأهيل شبكة ماء حي الشهداء — المرحلة الثانية' })
    expect(edited.status).toBe(200)
    expect(edited.body.title).toContain('المرحلة الثانية')
  })

  it('lets the super admin publish for an entity outside the registry, and validates input', async () => {
    const auction = await request(app)
      .post('/api/staff/tenders')
      .set('Cookie', admin)
      .send(
        tender({
          type: 'AUCTION',
          reference: 'مز/3',
          title: 'مزايدة علنية لتأجير محال سوق الشيوخ',
          entityName: 'بلدية سوق الشيوخ',
          estimatedCostIqd: null,
        })
      )
    expect(auction.status).toBe(201)
    expect(auction.body).toMatchObject({ type: 'AUCTION', departmentId: null, entityName: 'بلدية سوق الشيوخ' })

    const bad = await request(app)
      .post('/api/staff/tenders')
      .set('Cookie', admin)
      .send(tender({ entityName: 'جهة', closingAt: inDays(-1), publishedAt: inDays(0) }))
    expect(bad.status).toBe(400)
    const badUrl = await request(app)
      .post('/api/staff/tenders')
      .set('Cookie', admin)
      .send(tender({ entityName: 'جهة', documentUrl: 'javascript:alert(1)' }))
    expect(badUrl.status).toBe(400)
    const noEntity = await request(app).post('/api/staff/tenders').set('Cookie', admin).send(tender())
    expect(noEntity.status).toBe(400)

    const { db } = await import('../server/db.ts')
    const audited = db.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE entity_type = 'Tender'`).get() as {
      n: number
    }
    expect(audited.n).toBeGreaterThanOrEqual(3)
  })
})

describe('public tenders', () => {
  it('derives CLOSED from the closing date and honours cancel/award', async () => {
    const { tenderStatus } = await import('../server/tenders.ts')
    expect(tenderStatus('ACTIVE', inDays(1))).toBe('OPEN')
    expect(tenderStatus('ACTIVE', inDays(-1))).toBe('CLOSED')
    expect(tenderStatus('CANCELLED', inDays(5))).toBe('CANCELLED')
    expect(tenderStatus('AWARDED', inDays(-5))).toBe('AWARDED')

    const { db } = await import('../server/db.ts')
    const created = await request(app)
      .post('/api/staff/tenders')
      .set('Cookie', admin)
      .send(
        tender({
          reference: 'ق/9',
          title: 'صيانة طريق الشطرة الغراف',
          departmentId: 'dhiqar-governorate',
          publishedAt: inDays(-20),
          closingAt: inDays(5),
        })
      )
    expect(created.status).toBe(201)
    db.prepare(`UPDATE tenders SET closing_at = ? WHERE id = ?`).run(inDays(-2), created.body.id)
    const closed = await request(app).get(`/api/tenders/${created.body.id}`)
    expect(closed.status).toBe(200)
    expect(closed.body.status).toBe('CLOSED')

    const list = await request(app).get('/api/tenders')
    const cancelled = list.body.items.find((item: { status: string }) => item.status === 'OPEN')
    const changed = await request(app)
      .post(`/api/staff/tenders/${cancelled.id}/status`)
      .set('Cookie', admin)
      .send({ state: 'CANCELLED', note: 'إلغاء لإعادة الإعلان' })
    expect(changed.body.status).toBe('CANCELLED')
  })

  it('filters by status, type, entity and text, and hides scheduled announcements', async () => {
    await request(app)
      .post('/api/staff/tenders')
      .set('Cookie', admin)
      .send(
        tender({
          reference: 'مستقبلي',
          title: 'إعلان مجدول لم يُنشر بعد',
          entityName: 'جهة',
          publishedAt: inDays(3),
          closingAt: inDays(20),
        })
      )
    const all = await request(app).get('/api/tenders')
    expect(all.status).toBe(200)
    expect(all.headers['cache-control']).toBe('public, max-age=120')
    expect(all.body.items.some((item: { reference: string }) => item.reference === 'مستقبلي')).toBe(false)
    expect(all.body.counts.CLOSED).toBe(1)
    expect(all.body.entities.length).toBeGreaterThan(0)
    // open ones first
    expect(all.body.items[0].status).toBe('OPEN')

    const auctions = await request(app).get('/api/tenders?type=AUCTION')
    expect(auctions.body.items).toHaveLength(1)
    const open = await request(app).get('/api/tenders?status=OPEN')
    expect(open.body.items.every((item: { status: string }) => item.status === 'OPEN')).toBe(true)
    const water = await request(app).get('/api/tenders?department=dhiqar-water')
    expect(water.body.items).toHaveLength(1)
    const search = await request(app).get('/api/tenders?q=' + encodeURIComponent('الحبوبي'))
    expect(search.body.items).toHaveLength(1)
    expect((await request(app).get('/api/tenders/tnd_missing')).status).toBe(404)
  })

  it('serves /tenders pages as client routes and lists them in the sitemap', async () => {
    const { isClientRoute } = await import('../server/routes/seo.ts')
    expect(isClientRoute('/news')).toBe(true)
    expect(isClientRoute('/tenders')).toBe(true)
    expect(isClientRoute('/tenders/tnd_abc')).toBe(true)
    const sitemap = await request(app).get('/sitemap.xml')
    expect(sitemap.text).toContain('/tenders/tnd_')
    expect(sitemap.text).toContain('/news</loc>')
  })
})
