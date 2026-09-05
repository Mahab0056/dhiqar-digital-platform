import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SCRYPT_N = 2 ** 15
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64
const SCRYPT_MAXMEM = 128 * 1024 * 1024

/** Hash format: scrypt$N$r$p$saltBase64$hashBase64 */
export function hashPassword(password: string) {
  const salt = randomBytes(16)
  const hash = scryptSync(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password: string, stored: string | null | undefined) {
  if (!stored) return false
  const [algorithm, n, r, p, saltB64, hashB64] = stored.split('$')
  if (algorithm !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = scryptSync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT_MAXMEM,
  })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

const commonPasswords = new Set([
  'password',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'admin123',
  'dhiqar2026',
  'iraq2026',
])

/** Returns an Arabic error message when the password is weak, otherwise null. */
export function passwordPolicyError(password: string) {
  if (password.length < 12) return 'كلمة المرور يجب أن تكون 12 حرفاً على الأقل.'
  if (password.length > 128) return 'كلمة المرور طويلة جداً.'
  if (commonPasswords.has(password.toLowerCase())) return 'كلمة المرور شائعة جداً. اختر كلمة أقوى.'
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(pattern => pattern.test(password)).length
  if (classes < 3) return 'استخدم ثلاثة أنواع على الأقل من: أحرف كبيرة، أحرف صغيرة، أرقام، رموز.'
  return null
}

export function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(16)
  let out = ''
  for (const byte of bytes) out += alphabet[byte % alphabet.length]
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`
}
