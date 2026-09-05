import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30
const DIGITS = 6

export function base32Encode(buffer: Buffer) {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

export function base32Decode(input: string) {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char)
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20))
}

function hotp(secret: Buffer, counter: number) {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', secret).update(message).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code =
    ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3]
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0')
}

export function totpCode(secretBase32: string, at = Date.now()) {
  return hotp(base32Decode(secretBase32), Math.floor(at / 1000 / STEP_SECONDS))
}

/** Verifies a TOTP code allowing ±1 step drift. Returns the matched counter (to block replay) or null. */
export function verifyTotp(secretBase32: string, code: string, at = Date.now(), lastUsedCounter: number | null = null) {
  const normalized = code.replace(/\D/g, '')
  if (normalized.length !== DIGITS) return null
  const secret = base32Decode(secretBase32)
  const counter = Math.floor(at / 1000 / STEP_SECONDS)
  for (const drift of [0, -1, 1]) {
    const candidateCounter = counter + drift
    if (lastUsedCounter !== null && candidateCounter <= lastUsedCounter) continue
    const expected = Buffer.from(hotp(secret, candidateCounter))
    const received = Buffer.from(normalized)
    if (expected.length === received.length && timingSafeEqual(expected, received)) return candidateCounter
  }
  return null
}

export function otpauthUrl(input: { issuer: string; account: string; secret: string }) {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`)
  const issuer = encodeURIComponent(input.issuer)
  return `otpauth://totp/${label}?secret=${input.secret}&issuer=${issuer}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`
}

// ---- secret-at-rest encryption (AES-256-GCM keyed from SESSION_SECRET) -----
function encryptionKey() {
  const secret = process.env.MFA_ENCRYPTION_KEY?.trim() || process.env.SESSION_SECRET?.trim()
  if (!secret) throw new Error('SESSION_SECRET or MFA_ENCRYPTION_KEY must be configured for MFA.')
  return createHash('sha256').update(`mfa:${secret}`).digest()
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`
}

export function decryptSecret(stored: string) {
  const [ivB64, tagB64, dataB64] = stored.split('.')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}
