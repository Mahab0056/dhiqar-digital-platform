// Lost super admin password: STAFF_RECOVERY_* unlocks the account once, and never creates or touches other accounts.
import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv } from './helpers'

configureTestEnv()

let app: Express
const login = (username: string, password: string) =>
  request(app).post('/api/auth/staff/login').send({ username, password })

describe('super admin recovery', () => {
  beforeAll(async () => {
    const { createPlatformServer } = await import('../server/create-server.ts')
    app = createPlatformServer({ serveStatic: false }).app
  })

  it('unlocks the super admin with the recovery password, once', async () => {
    const { recoverStaffAccount } = await import('../server/auth/staff.ts')
    for (let i = 0; i < 6; i++) await login('admin', 'Wrong-Password-2026!')
    expect((await login('admin', 'Bootstrap-Admin-Pass-2026!')).status).toBe(401) // locked

    process.env.STAFF_RECOVERY_USERNAME = 'admin'
    process.env.STAFF_RECOVERY_PASSWORD = 'Recovered-Admin-Pass-2026!'
    recoverStaffAccount(() => {})
    const ok = await login('admin', 'Recovered-Admin-Pass-2026!')
    expect(ok.status).toBe(200)

    // a later restart with the same variables does not reset the password again
    const { db } = await import('../server/db.ts')
    const before = db.prepare(`SELECT password_hash FROM staff_accounts WHERE username = 'admin'`).get() as {
      password_hash: string
    }
    recoverStaffAccount(() => {})
    const after = db.prepare(`SELECT password_hash FROM staff_accounts WHERE username = 'admin'`).get() as {
      password_hash: string
    }
    expect(after.password_hash).toBe(before.password_hash)
  })

  it('ignores unknown usernames and weak passwords', async () => {
    const { recoverStaffAccount } = await import('../server/auth/staff.ts')
    const { db } = await import('../server/db.ts')
    const count = () => (db.prepare('SELECT COUNT(*) AS n FROM staff_accounts').get() as { n: number }).n
    const total = count()
    process.env.STAFF_RECOVERY_USERNAME = 'intruder'
    process.env.STAFF_RECOVERY_PASSWORD = 'Another-Strong-Pass-2026!'
    recoverStaffAccount(() => {})
    process.env.STAFF_RECOVERY_USERNAME = 'admin'
    process.env.STAFF_RECOVERY_PASSWORD = 'short'
    recoverStaffAccount(() => {})
    expect(count()).toBe(total)
    expect((await login('admin', 'short')).status).toBe(401)
    delete process.env.STAFF_RECOVERY_USERNAME
    delete process.env.STAFF_RECOVERY_PASSWORD
  })
})
