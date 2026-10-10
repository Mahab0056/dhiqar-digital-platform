// Google sign-in for staff: OpenID Connect authorization-code flow with PKCE, state and nonce.
// No client library: the token exchange and ID-token verification (RS256 against Google's JWKS) are done here.
// Google only proves the email address; the account must already exist and have that email set by a super admin.
import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
  type JsonWebKey,
} from 'node:crypto'
import { db } from '../db.js'
import { sessionSecret } from './session.js'

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])
export const GOOGLE_CALLBACK_PATH = '/api/auth/staff/google/callback'
export const GOOGLE_STATE_COOKIE = 'dhiqar_google_state'
const STATE_TTL_SECONDS = 10 * 60
const CLOCK_SKEW_SECONDS = 120

type Fetch = typeof fetch
let httpFetch: Fetch = (...args) => fetch(...args)
/** Tests replace the network (token endpoint + JWKS). */
export function setGoogleFetch(next: Fetch | null) {
  httpFetch = next ?? ((...args) => fetch(...args))
  jwksCache = null
}

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  const allowedDomains = (process.env.GOOGLE_ALLOWED_DOMAINS || '')
    .split(',')
    .map(item => item.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
  return { clientId, clientSecret, allowedDomains }
}

export const googleConfigured = () => googleConfig() !== null

export function emailDomainAllowed(email: string, allowedDomains: string[]) {
  if (!allowedDomains.length) return true
  const domain = email.split('@').pop()?.toLowerCase() || ''
  return allowedDomains.includes(domain)
}

// ---- state store (single use, bound to the browser by a cookie) ---------------------------------------------------
db.exec(`CREATE TABLE IF NOT EXISTS staff_oauth_states (
  state_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  next_path TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
)`)

const b64url = (buffer: Buffer) => buffer.toString('base64url')
const stateHash = (state: string) => createHmac('sha256', `${sessionSecret()}:google-state`).update(state).digest('hex')

export function beginGoogleLogin(input: { redirectUri: string; next?: string | null }) {
  const config = googleConfig()
  if (!config) throw new Error('GOOGLE_NOT_CONFIGURED')
  const state = b64url(randomBytes(32))
  const nonce = b64url(randomBytes(32))
  const codeVerifier = b64url(randomBytes(48))
  const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest())
  const created = new Date()
  db.prepare(`DELETE FROM staff_oauth_states WHERE expires_at < ?`).run(created.toISOString())
  db.prepare(
    `INSERT INTO staff_oauth_states (state_hash, nonce, code_verifier, redirect_uri, next_path, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    stateHash(state),
    nonce,
    codeVerifier,
    input.redirectUri,
    input.next || null,
    created.toISOString(),
    new Date(created.getTime() + STATE_TTL_SECONDS * 1000).toISOString()
  )
  const url = new URL(GOOGLE_AUTH_ENDPOINT)
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
    ...(config.allowedDomains.length === 1 ? { hd: config.allowedDomains[0] } : {}),
  }).toString()
  return { url: url.toString(), state, stateTtlSeconds: STATE_TTL_SECONDS }
}

/** Consumes the state (single use). The query value must match the browser's cookie and still be fresh. */
export function consumeGoogleState(queryState: string | undefined, cookieState: string | undefined) {
  if (!queryState || !cookieState) return null
  const left = Buffer.from(queryState)
  const right = Buffer.from(cookieState)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  const hash = stateHash(queryState)
  const row = db
    .prepare(
      `SELECT nonce, code_verifier, redirect_uri, next_path, expires_at FROM staff_oauth_states WHERE state_hash = ?`
    )
    .get(hash) as
    | { nonce: string; code_verifier: string; redirect_uri: string; next_path: string | null; expires_at: string }
    | undefined
  db.prepare(`DELETE FROM staff_oauth_states WHERE state_hash = ?`).run(hash)
  if (!row || row.expires_at <= new Date().toISOString()) return null
  return { nonce: row.nonce, codeVerifier: row.code_verifier, redirectUri: row.redirect_uri, next: row.next_path }
}

// ---- token exchange + ID token verification ---------------------------------------------------------------------
export class GoogleAuthError extends Error {
  code: 'TOKEN_EXCHANGE' | 'INVALID_TOKEN' | 'EMAIL_UNVERIFIED'
  constructor(code: GoogleAuthError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export async function exchangeGoogleCode(input: { code: string; codeVerifier: string; redirectUri: string }) {
  const config = googleConfig()
  if (!config) throw new GoogleAuthError('TOKEN_EXCHANGE', 'Google is not configured')
  let response: Response
  try {
    response = await httpFetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        code_verifier: input.codeVerifier,
        redirect_uri: input.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }).toString(),
    })
  } catch {
    throw new GoogleAuthError('TOKEN_EXCHANGE', 'token endpoint unreachable')
  }
  const payload = (await response.json().catch(() => ({}))) as { id_token?: string; error?: string }
  if (!response.ok || !payload.id_token)
    throw new GoogleAuthError('TOKEN_EXCHANGE', `token endpoint error ${response.status} ${payload.error || ''}`.trim())
  return payload.id_token
}

type Jwk = JsonWebKey & { kid?: string; alg?: string; kty?: string; use?: string }
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null
const JWKS_TTL_MS = 60 * 60 * 1000

async function googleKey(kid: string) {
  const find = () => jwksCache?.keys.find(key => key.kid === kid && key.kty === 'RSA')
  if (!jwksCache || Date.now() - jwksCache.fetchedAt > JWKS_TTL_MS || !find()) {
    const response = await httpFetch(GOOGLE_JWKS_URL, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new GoogleAuthError('INVALID_TOKEN', `jwks fetch failed ${response.status}`)
    const body = (await response.json()) as { keys?: Jwk[] }
    jwksCache = { keys: Array.isArray(body.keys) ? body.keys : [], fetchedAt: Date.now() }
  }
  return find() || null
}

export type GoogleIdentity = { sub: string; email: string; name: string | null; hostedDomain: string | null }

const decodeSegment = <T>(segment: string) => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T

/** Verifies signature (RS256 / Google JWKS), issuer, audience, expiry, nonce and email_verified. */
export async function verifyGoogleIdToken(
  idToken: string,
  input: { clientId: string; nonce: string; nowMs?: number }
): Promise<GoogleIdentity> {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new GoogleAuthError('INVALID_TOKEN', 'malformed token')
  const [headerB64, payloadB64, signatureB64] = parts
  let header: { alg?: string; kid?: string }
  let claims: Record<string, unknown>
  try {
    header = decodeSegment(headerB64)
    claims = decodeSegment(payloadB64)
  } catch {
    throw new GoogleAuthError('INVALID_TOKEN', 'undecodable token')
  }
  if (header.alg !== 'RS256' || !header.kid) throw new GoogleAuthError('INVALID_TOKEN', 'unexpected algorithm')
  const jwk = await googleKey(header.kid)
  if (!jwk) throw new GoogleAuthError('INVALID_TOKEN', 'unknown signing key')
  const valid = verify(
    'RSA-SHA256',
    Buffer.from(`${headerB64}.${payloadB64}`),
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(signatureB64, 'base64url')
  )
  if (!valid) throw new GoogleAuthError('INVALID_TOKEN', 'bad signature')

  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000)
  if (!GOOGLE_ISSUERS.has(String(claims.iss))) throw new GoogleAuthError('INVALID_TOKEN', 'bad issuer')
  const audience = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud)]
  if (!audience.includes(input.clientId)) throw new GoogleAuthError('INVALID_TOKEN', 'bad audience')
  if (audience.length > 1 && claims.azp !== input.clientId) throw new GoogleAuthError('INVALID_TOKEN', 'bad azp')
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds)
    throw new GoogleAuthError('INVALID_TOKEN', 'expired')
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > nowSeconds)
    throw new GoogleAuthError('INVALID_TOKEN', 'issued in the future')
  const nonce = typeof claims.nonce === 'string' ? claims.nonce : ''
  const nonceOk = nonce.length === input.nonce.length && timingSafeEqual(Buffer.from(nonce), Buffer.from(input.nonce))
  if (!nonceOk) throw new GoogleAuthError('INVALID_TOKEN', 'nonce mismatch')
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string' || !claims.email)
    throw new GoogleAuthError('INVALID_TOKEN', 'missing subject or email')
  if (claims.email_verified !== true) throw new GoogleAuthError('EMAIL_UNVERIFIED', 'email not verified')
  return {
    sub: claims.sub,
    email: claims.email.trim().toLowerCase(),
    name: typeof claims.name === 'string' ? claims.name : null,
    hostedDomain: typeof claims.hd === 'string' ? claims.hd.toLowerCase() : null,
  }
}
