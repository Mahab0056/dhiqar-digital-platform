import { checkDigit } from '../server/mrz'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Must run before the server modules are imported (db opens at import time). */
export function configureTestEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'dhiqar-test-'))
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_PATH = join(dir, 'test.sqlite')
  process.env.MEDIA_STORAGE_PATH = join(dir, 'media')
  process.env.SESSION_SECRET = 'test-session-secret-0123456789-abcdef'
  process.env.MEDIA_ENCRYPTION_KEY = 'test-media-key-0123456789abcdef'
  process.env.OTP_HASH_SECRET = 'test-otp-secret'
  process.env.OTP_DEV_MODE = 'true'
  process.env.OTP_DEV_CODE = '246810'
  process.env.STAFF_BOOTSTRAP_USERNAME = 'admin'
  process.env.STAFF_BOOTSTRAP_PASSWORD = 'Bootstrap-Admin-Pass-2026!'
  process.env.ADMIN_REVIEW_PASSWORD = 'legacy-employee-pass'
  process.env.OPERATIONS_PASSWORD = '2468'
  return dir
}

export const cookieOf = (response: { headers: Record<string, unknown> }) => {
  const raw = response.headers['set-cookie']
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : []
  return list.map(item => item.split(';')[0]).join('; ')
}

/** Builds a valid Iraqi TD1 with correct check digits, for the decision tests. */
export function iraqiTd1(input: {
  number: string
  birth: string
  sex: 'M' | 'F'
  expiry: string
  surname: string
  given: string
}) {
  const l1Body = `${input.number}${checkDigit(input.number)}${'<'.repeat(15)}`
  const l1 = `I<IRQ${l1Body}`
  const birth = `${input.birth}${checkDigit(input.birth)}`
  const expiry = `${input.expiry}${checkDigit(input.expiry)}`
  const optional2 = '<'.repeat(11)
  const composite = checkDigit(`${l1Body}${birth}${expiry}${optional2}`)
  const l2 = `${birth}${input.sex}${expiry}IRQ${optional2}${composite}`
  const l3 = `${input.surname}<<${input.given.replace(/ /g, '<')}`.padEnd(30, '<')
  return [l1, l2, l3].join('\n')
}
