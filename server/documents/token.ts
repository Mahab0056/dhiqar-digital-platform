import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Opaque, signed verification codes for issued documents.
 *
 * QR payload:   TQD1.<docKey>.<sig>
 *   docKey  16 chars of Crockford-free base32 (80 random bits) — the only lookup key, carries no personal data
 *   sig     HMAC-SHA256(key, "TQD1.<docKey>.<canonicalDigest>") truncated to 128 bits, base64url (22 chars)
 *           canonicalDigest = SHA-256 of the document's canonical record (number, template, dates, holder digest…)
 * Manual code (printed and under the linear barcode): XXXX-XXXX-XXXX-XXXX-CCCC
 *   the docKey grouped by four + a 20-bit check derived from the same HMAC
 *
 * The QR deliberately is *not* a URL: a generic phone reader only shows a meaningless code; the platform's /verify
 * scanner (or /verify/<code>) sends it to the server, which recomputes the HMAC from the stored record before
 * revealing anything. The code covers the canonical fields above; the other stored columns the verification page
 * shows or serves (document/service titles, department, status and revocation, the archived PDF's media id and
 * SHA-256 — see MAC_COLUMNS in issued-documents.ts) are covered by a second, server-side HMAC stored with the record
 * (`recordMac`). Editing the code or any of those columns makes the document invalid. The holder is bound through
 * holderDigest (citizen id + name at issuance); the masked name displayed is read from the citizen record.
 *
 * Keys: DOCUMENT_SIGNING_KEY signs; DOCUMENT_SIGNING_KEYS_RETIRED (comma separated) still verifies documents signed
 * before a rotation. Each document stores the id of the key that signed it, so rotating keys — or any unrelated
 * secret such as SESSION_SECRET — never turns genuine documents into "forged" ones. Without DOCUMENT_SIGNING_KEY the
 * server signs with a random key pinned once in its own database (see store.ts) and warns; local development and
 * the offline sample generator fall back to a fixed development key.
 */

export const TOKEN_VERSION = 'TQD1'
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 32 symbols, no I/O/0/1
const DEV_KEY = 'local-development-document-signing-key'

export type SigningKey = { id: string; secret: string }

/** Stable public id of a key (a fingerprint, never the key itself). */
export const signingKeyId = (secret: string) =>
  createHash('sha256').update(`tqd-signing-key-id\n${secret}`).digest('hex').slice(0, 16)
const keyOf = (secret: string): SigningKey => ({ id: signingKeyId(secret), secret })

type PinnedKeys = { active: () => SigningKey; byId: (id: string) => SigningKey | null }
let pinned: PinnedKeys | null = null
/** Registered by the server (store.ts): a random key generated once and kept in the database. */
export function registerPinnedSigningKey(provider: PinnedKeys) {
  pinned = provider
}

const isProduction = () => process.env.NODE_ENV === 'production'
const retiredKeys = () =>
  String(process.env.DOCUMENT_SIGNING_KEYS_RETIRED || '')
    .split(/[\s,]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(keyOf)

let warned = false
/** The key new documents are signed with. */
export function activeSigningKey(): SigningKey {
  const explicit = process.env.DOCUMENT_SIGNING_KEY?.trim()
  if (explicit) return keyOf(explicit)
  if (pinned) {
    if (isProduction() && !warned) {
      warned = true
      console.warn(
        '[documents] DOCUMENT_SIGNING_KEY is not set: signing with a key pinned in the database. Set DOCUMENT_SIGNING_KEY so that a database leak cannot be used to forge documents (documents signed so far keep verifying).'
      )
    }
    return pinned.active()
  }
  if (isProduction()) throw new Error('DOCUMENT_SIGNING_KEY is required to sign official documents.')
  if (!warned && process.env.NODE_ENV !== 'test') {
    warned = true
    console.warn('[documents] using the local development signing key (set DOCUMENT_SIGNING_KEY)')
  }
  return keyOf(DEV_KEY)
}

/** Any key that may have signed a stored document: the active one, retired ones, the pinned one(s). */
export function signingKeyById(id: string | null | undefined): SigningKey | null {
  if (!id) return activeSigningKey()
  const explicit = process.env.DOCUMENT_SIGNING_KEY?.trim()
  const candidates = [...(explicit ? [keyOf(explicit)] : []), ...retiredKeys()]
  const found = candidates.find(item => item.id === id)
  if (found) return found
  const stored = pinned?.byId(id)
  if (stored) return stored
  if (!isProduction() && id === signingKeyId(DEV_KEY)) return keyOf(DEV_KEY)
  return null
}

export function newDocKey() {
  const bytes = randomBytes(16)
  return [...bytes].map(byte => ALPHABET[byte % 32]).join('')
}

export type CanonicalRecord = {
  docKey: string
  documentNumber: string
  templateId: string
  departmentId: string
  issuedAt: string
  expiresAt: string | null
  /** SHA-256 of the holder's name + citizen id: binds the code to the person without storing them in it */
  holderDigest: string
}

export const holderDigestOf = (citizenId: number | string, name: string) =>
  createHash('sha256').update(`${citizenId}|${name.trim()}`).digest('hex')

export function canonicalDigest(record: CanonicalRecord) {
  const canonical = [
    TOKEN_VERSION,
    record.docKey,
    record.documentNumber,
    record.templateId,
    record.departmentId,
    record.issuedAt,
    record.expiresAt || '-',
    record.holderDigest,
  ].join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}

const mac = (key: SigningKey, docKey: string, digest: string) =>
  createHmac('sha256', key.secret).update(`${TOKEN_VERSION}.${docKey}.${digest}`).digest()

export function signDocument(record: CanonicalRecord, key: SigningKey = activeSigningKey()) {
  const digest = canonicalDigest(record)
  const raw = mac(key, record.docKey, digest)
  const sig = raw.subarray(0, 16).toString('base64url')
  const check = [0, 1, 2, 3].map(index => ALPHABET[raw[16 + index] % 32]).join('')
  const groups = record.docKey.match(/.{4}/g) || [record.docKey]
  return {
    token: `${TOKEN_VERSION}.${record.docKey}.${sig}`,
    manualCode: [...groups, check].join('-'),
    digest,
    keyId: key.id,
  }
}

/** Server-side HMAC over the stored columns a verifier sees (never printed, never sent to clients). */
export function recordMac(key: SigningKey, fields: Array<string | number | null | undefined>) {
  const canonical = fields.map(value => (value === null || value === undefined ? '\u0000' : String(value))).join('\n')
  return createHmac('sha256', key.secret).update(`${TOKEN_VERSION}.record\n${canonical}`).digest('hex')
}

export function sameMac(expected: string, received: string | null | undefined) {
  if (!received) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(String(received))
  return a.length === b.length && timingSafeEqual(a, b)
}

export type ParsedCode =
  | { kind: 'token'; docKey: string; sig: string }
  | { kind: 'manual'; docKey: string; check: string }
  | { kind: 'legacy'; value: string }
  | { kind: 'invalid' }

const KEY_PATTERN = new RegExp(`^[${ALPHABET}]{16}$`)

/** A pasted URL may still be percent-encoded; a lone "%" (or any malformed escape) is kept as typed. */
function decodeOnce(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Accepts the QR token, a verify URL that ends with it, or the manual code (case/spaces/dashes tolerant). */
export function parseVerificationCode(input: string): ParsedCode {
  let value = decodeOnce(String(input || '')).trim()
  if (value.includes('/verify/')) value = value.split('/verify/').pop() || ''
  value = value.replace(/[?#].*$/, '')
  if (!value || value.length > 120) return { kind: 'invalid' }
  if (value.startsWith(`${TOKEN_VERSION}.`)) {
    const [, docKey, sig] = value.split('.')
    if (!docKey || !sig || !KEY_PATTERN.test(docKey) || !/^[A-Za-z0-9_-]{22}$/.test(sig)) return { kind: 'invalid' }
    return { kind: 'token', docKey, sig }
  }
  const compact = value.toUpperCase().replace(/[\s-]/g, '')
  if (/^[A-Z2-9]{20}$/.test(compact) && KEY_PATTERN.test(compact.slice(0, 16)))
    return { kind: 'manual', docKey: compact.slice(0, 16), check: compact.slice(16) }
  if (/^[A-Za-z0-9_-]{4,64}$/.test(value)) return { kind: 'legacy', value }
  return { kind: 'invalid' }
}

/**
 * Constant-time check of a parsed code against the stored record's canonical digest, with the key that signed it
 * (`keyId` stored on the record; null = the active key).
 */
export function verifyParsedCode(parsed: ParsedCode, docKey: string, digest: string, keyId?: string | null) {
  if (parsed.kind !== 'token' && parsed.kind !== 'manual') return false
  if (parsed.docKey !== docKey) return false
  const key = signingKeyById(keyId)
  if (!key) return false
  const raw = mac(key, docKey, digest)
  if (parsed.kind === 'token') {
    const expected = Buffer.from(raw.subarray(0, 16).toString('base64url'))
    const received = Buffer.from(parsed.sig)
    return expected.length === received.length && timingSafeEqual(expected, received)
  }
  const expected = Buffer.from([0, 1, 2, 3].map(index => ALPHABET[raw[16 + index] % 32]).join(''))
  const received = Buffer.from(parsed.check)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export const sha256Hex = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')
