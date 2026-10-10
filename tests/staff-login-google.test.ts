// Staff sign-in with Google (OIDC code flow + PKCE): ID-token verification, state/nonce/PKCE, account linking rules.
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { configureTestEnv, cookieOf } from './helpers'

configureTestEnv()
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'

const CLIENT_ID = 'test-client.apps.googleusercontent.com'
const KID = 'test-kid-1'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const other = generateKeyPairSync('rsa', { modulusLength: 2048 })

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
function signToken(claims: Record<string, unknown>, key: KeyObject = privateKey, header: Record<string, unknown> = {}) {
  const head = b64({ alg: 'RS256', kid: KID, typ: 'JWT', ...header })
  const body = b64(claims)
  const signature = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')
  return `${head}.${body}.${signature}`
}
const baseClaims = (nonce: string, overrides: Record<string, unknown> = {}) => {
  const now = Math.floor(Date.now() / 1000)
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '1234567890',
    email: 'ops.room@thi-qar.com',
    email_verified: true,
    name: 'Ops',
    iat: now,
    exp: now + 3600,
    nonce,
    ...overrides,
  }
}

// ---- fake Google network ---------------------------------------------------------------------------------------
let tokenClaims: (nonce: string) => Record<string, unknown> = nonce => baseClaims(nonce)
let lastNonce = ''
let lastChallenge = ''
const tokenRequests: URLSearchParams[] = []
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input)
  if (url === 'https://www.googleapis.com/oauth2/v3/certs')
    return new Response(
      JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] }),
      { status: 200 }
    )
  if (url === 'https://oauth2.googleapis.com/token') {
    const body = new URLSearchParams(String(init?.body))
    tokenRequests.push(body)
    const verifier = body.get('code_verifier') || ''
    // PKCE: the verifier must hash to the challenge sent in the authorization request
    if (createHash('sha256').update(verifier).digest('base64url') !== lastChallenge)
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    return new Response(JSON.stringify({ id_token: signToken(tokenClaims(lastNonce)) }), { status: 200 })
  }
  return new Response('not found', { status: 404 })
}) as typeof fetch

let app: Express
type Staff = typeof import('../server/auth/staff.ts')
let staff: Staff

async function start(next = '/operations') {
  const res = await request(app).get(`/api/auth/staff/google/start?next=${encodeURIComponent(next)}`)
  expect(res.status).toBe(303)
  const location = new URL(res.headers.location)
  lastNonce = location.searchParams.get('nonce') || ''
  lastChallenge = location.searchParams.get('code_challenge') || ''
  return { location, state: location.searchParams.get('state') || '', cookie: cookieOf(res) }
}
async function callback(flow: { state: string; cookie: string }, query = `code=auth-code&state=${flow.state}`) {
  return request(app).get(`/api/auth/staff/google/callback?${query}`).set('Cookie', flow.cookie)
}
const errorOf = (res: { headers: Record<string, string> }) =>
  new URL(res.headers.location, 'http://x').searchParams.get('error')

describe('Google ID token verification', () => {
  beforeAll(async () => {
    const { createPlatformServer } = await import('../server/create-server.ts')
    app = createPlatformServer({ serveStatic: false }).app
    staff = await import('../server/auth/staff.ts')
    const google = await import('../server/auth/google.ts')
    google.setGoogleFetch(fakeFetch)
  })

  const verify = async (token: string, nonce = 'n-1') => {
    const { verifyGoogleIdToken } = await import('../server/auth/google.ts')
    return verifyGoogleIdToken(token, { clientId: CLIENT_ID, nonce })
  }

  it('accepts a correctly signed token', async () => {
    const identity = await verify(signToken(baseClaims('n-1', { email: 'Ops.Room@Thi-Qar.com' })))
    expect(identity.email).toBe('ops.room@thi-qar.com')
    expect(identity.sub).toBe('1234567890')
  })

  it.each([
    ['foreign signature', () => signToken(baseClaims('n-1'), other.privateKey)],
    ['wrong audience', () => signToken(baseClaims('n-1', { aud: 'someone-else' }))],
    ['wrong issuer', () => signToken(baseClaims('n-1', { iss: 'https://evil.example' }))],
    ['expired', () => signToken(baseClaims('n-1', { exp: Math.floor(Date.now() / 1000) - 3600 }))],
    ['nonce mismatch', () => signToken(baseClaims('other-nonce'))],
    ['unknown key id', () => signToken(baseClaims('n-1'), privateKey, { kid: 'nope' })],
    ['alg none', () => signToken(baseClaims('n-1'), privateKey, { alg: 'none' })],
    [
      'tampered payload',
      () => {
        const [h, , s] = signToken(baseClaims('n-1')).split('.')
        return `${h}.${b64(baseClaims('n-1', { email: 'admin@thi-qar.com' }))}.${s}`
      },
    ],
  ])('rejects %s', async (_label, make) => {
    await expect(verify(make())).rejects.toMatchObject({ code: 'INVALID_TOKEN' })
  })

  it('requires email_verified === true', async () => {
    await expect(verify(signToken(baseClaims('n-1', { email_verified: false })))).rejects.toMatchObject({
      code: 'EMAIL_UNVERIFIED',
    })
    await expect(verify(signToken(baseClaims('n-1', { email_verified: 'true' })))).rejects.toMatchObject({
      code: 'EMAIL_UNVERIFIED',
    })
  })
})

describe('Google sign-in flow', () => {
  afterEach(() => {
    tokenClaims = nonce => baseClaims(nonce)
    delete process.env.GOOGLE_ALLOWED_DOMAINS
  })

  it('advertises the method only when configured', async () => {
    expect((await request(app).get('/api/auth/staff/methods')).body).toMatchObject({ password: true, google: true })
    const saved = process.env.GOOGLE_CLIENT_SECRET
    delete process.env.GOOGLE_CLIENT_SECRET
    expect((await request(app).get('/api/auth/staff/methods')).body.google).toBe(false)
    const res = await request(app).get('/api/auth/staff/google/start')
    expect(res.headers.location).toContain('error=google_unavailable')
    process.env.GOOGLE_CLIENT_SECRET = saved
  })

  it('redirects to Google with state, nonce and an S256 PKCE challenge', async () => {
    const { location, state, cookie } = await start()
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(location.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(location.searchParams.get('scope')).toBe('openid email profile')
    expect(location.searchParams.get('redirect_uri')).toMatch(/\/api\/auth\/staff\/google\/callback$/)
    expect(state.length).toBeGreaterThan(30)
    expect(lastNonce.length).toBeGreaterThan(30)
    expect(cookie).toContain(`dhiqar_google_state=${state}`)
  })

  it('rejects a Google account with no linked staff email (no self-registration)', async () => {
    const before = staff.listStaff().length
    tokenClaims = nonce => baseClaims(nonce, { email: 'stranger@gmail.com' })
    const res = await callback(await start())
    expect(res.status).toBe(303)
    expect(errorOf(res)).toBe('google_no_account')
    expect(cookieOf(res)).not.toContain('dhiqar_session=')
    expect(staff.listStaff().length).toBe(before)
  })

  it('signs a linked operations-room account in and redirects to its portal', async () => {
    staff.createStaff({
      username: 'ops.room',
      fullName: 'غرفة العمليات',
      role: 'OPERATIONS',
      email: 'ops.room@thi-qar.com',
    })
    const res = await callback(await start('/operations'))
    expect(res.status).toBe(303)
    expect(res.headers.location).toBe('/operations')
    // the token request carried the PKCE verifier and the same redirect_uri
    const last = tokenRequests.at(-1)!
    expect(last.get('code_verifier')).toBeTruthy()
    expect(last.get('redirect_uri')).toMatch(/\/api\/auth\/staff\/google\/callback$/)
    const session = await request(app).get('/api/auth/session').set('Cookie', cookieOf(res))
    expect(session.status).toBe(200)
    expect(session.body.role).toBe('OPERATIONS')
    // temporary-password change is not demanded of a Google session
    expect(session.body.mustChangePassword).toBe(false)
  })

  it('ignores a next path outside the role', async () => {
    const res = await callback(await start('/super-admin'))
    expect(res.headers.location).toBe('/operations')
  })

  it('rejects a state that does not match the browser cookie, and replayed states', async () => {
    const flow = await start()
    const forged = await callback({ state: flow.state, cookie: 'dhiqar_google_state=someone-elses-state' })
    expect(errorOf(forged)).toBe('google_expired')
    // the mismatched attempt did not consume the real state …
    const ok = await callback(flow)
    expect(ok.headers.location).toBe('/operations')
    // … but a successful one did: replaying it fails
    expect(errorOf(await callback(flow))).toBe('google_expired')
  })

  it('rejects an ID token whose nonce belongs to another flow', async () => {
    tokenClaims = () => baseClaims('a-different-nonce')
    expect(errorOf(await callback(await start()))).toBe('google_failed')
  })

  it('maps a cancelled consent screen and unverified emails', async () => {
    const flow = await start()
    expect(errorOf(await callback(flow, `error=access_denied&state=${flow.state}`))).toBe('google_cancelled')
    tokenClaims = nonce => baseClaims(nonce, { email_verified: false })
    expect(errorOf(await callback(await start()))).toBe('google_unverified')
  })

  it('enforces GOOGLE_ALLOWED_DOMAINS', async () => {
    staff.createStaff({
      username: 'gmail.user',
      fullName: 'موظف بريد عام',
      role: 'EMPLOYEE',
      email: 'worker@gmail.com',
    })
    process.env.GOOGLE_ALLOWED_DOMAINS = 'thi-qar.com, thiqar.gov.iq'
    tokenClaims = nonce => baseClaims(nonce, { email: 'worker@gmail.com' })
    expect(errorOf(await callback(await start('/employee')))).toBe('google_domain')
    tokenClaims = nonce => baseClaims(nonce)
    expect((await callback(await start())).headers.location).toBe('/operations')
  })

  it('rejects disabled and locked accounts', async () => {
    const account = staff.getStaffByUsername('ops.room')!
    staff.setStaffStatus(account.id, 'DISABLED')
    expect(errorOf(await callback(await start()))).toBe('account_disabled')
    staff.setStaffStatus(account.id, 'ACTIVE')
    const { db } = await import('../server/db.ts')
    db.prepare(`UPDATE staff_accounts SET locked_until = ? WHERE id = ?`).run(
      new Date(Date.now() + 600_000).toISOString(),
      account.id
    )
    expect(errorOf(await callback(await start()))).toBe('account_locked')
    db.prepare(`UPDATE staff_accounts SET locked_until = NULL WHERE id = ?`).run(account.id)
  })

  it('sends TOTP-enabled accounts through the existing MFA step', async () => {
    const { totpCode } = await import('../server/auth/totp.ts')
    const account = staff.getStaffByUsername('ops.room')!
    const secret = staff.beginTotpEnrollment(account.id)
    expect(staff.confirmTotpEnrollment(account.id, totpCode(secret))).toBe(true)
    const res = await callback(await start())
    expect(cookieOf(res)).not.toContain('dhiqar_session=')
    const challengeToken = decodeURIComponent(res.headers.location.split('#mfa=')[1] || '')
    expect(challengeToken).toBeTruthy()
    const mfa = await request(app)
      .post('/api/auth/staff/mfa')
      .send({ challengeToken, code: totpCode(secret, Date.now() + 30_000) })
    expect(mfa.status).toBe(200)
    expect(mfa.body.role).toBe('OPERATIONS')
    expect(mfa.body.mustChangePassword).toBe(false)
    staff.disableTotp(account.id)
  })

  it('audits successes and failures without secrets', async () => {
    const { db } = await import('../server/db.ts')
    const rows = db
      .prepare(`SELECT action, metadata FROM audit_logs WHERE action LIKE 'STAFF_GOOGLE_LOGIN_%'`)
      .all() as Array<{ action: string; metadata: string | null }>
    expect(rows.some(row => row.action === 'STAFF_GOOGLE_LOGIN_SUCCEEDED')).toBe(true)
    expect(rows.some(row => row.action === 'STAFF_GOOGLE_LOGIN_FAILED')).toBe(true)
    const text = JSON.stringify(rows)
    expect(text).not.toContain('auth-code')
    expect(text).not.toContain('test-client-secret')
  })
})
