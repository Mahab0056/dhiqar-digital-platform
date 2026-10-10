import { createHash, randomUUID } from 'node:crypto'
import { addAudit, db } from '../db.js'
import { generateTemporaryPassword, hashPassword, passwordPolicyError, verifyPassword } from './password.js'
import { decryptSecret, encryptSecret, generateTotpSecret, verifyTotp } from './totp.js'

export type StaffRole = 'EMPLOYEE' | 'IDENTITY_REVIEWER' | 'OPERATIONS' | 'SUPER_ADMIN'
export const staffRoles: StaffRole[] = ['EMPLOYEE', 'IDENTITY_REVIEWER', 'OPERATIONS', 'SUPER_ADMIN']

export type StaffAccount = {
  id: string
  username: string
  /** Lowercase work email set by a super admin; enables Google / email-code sign-in. Never self-registered. */
  email: string | null
  fullName: string
  role: StaffRole
  departmentId: string | null
  departmentName: string | null
  /** Manager of their department (assigns requests, sees the team workload). Only meaningful for EMPLOYEE. */
  isDepartmentManager: boolean
  mustChangePassword: boolean
  totpEnabled: boolean
  status: 'ACTIVE' | 'DISABLED'
  failedAttempts: number
  lockedUntil: string | null
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
}

const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15

const now = () => new Date().toISOString()

// email column (nullable, unique when set): added in place so existing databases upgrade on boot
{
  const columns = db.prepare(`PRAGMA table_info(staff_accounts)`).all() as Array<{ name: string }>
  if (!columns.some(item => item.name === 'email')) db.exec(`ALTER TABLE staff_accounts ADD COLUMN email TEXT`)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_accounts_email ON staff_accounts(email) WHERE email IS NOT NULL`)
}

const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

export function normalizeEmail(input: string) {
  return input.trim().toLowerCase()
}

/** Validates and normalizes an admin-supplied email. Empty → null (unlinks the account). */
export function parseStaffEmail(input: string | null | undefined) {
  if (input === null || input === undefined) return null
  const email = normalizeEmail(input)
  if (!email) return null
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new Error('صيغة البريد الإلكتروني غير صحيحة.')
  return email
}

function assertEmailFree(email: string | null, exceptId?: string) {
  if (!email) return
  const row = db.prepare(`SELECT id FROM staff_accounts WHERE email = ?`).get(email) as { id: string } | undefined
  if (row && row.id !== exceptId) throw new Error('هذا البريد الإلكتروني مرتبط بحساب موظف آخر.')
}

const selectColumns = `s.id, s.username, s.email, s.full_name, s.role, s.department_id, d.name AS department_name, s.is_department_manager, s.must_change_password,
  s.totp_enabled, s.status, s.failed_attempts, s.locked_until, s.last_login_at, s.created_at, s.updated_at`

function mapStaff(row: Record<string, unknown>): StaffAccount {
  return {
    id: String(row.id),
    username: String(row.username),
    email: row.email ? String(row.email) : null,
    fullName: String(row.full_name),
    role: String(row.role) as StaffRole,
    departmentId: row.department_id ? String(row.department_id) : null,
    departmentName: row.department_name ? String(row.department_name) : null,
    isDepartmentManager: Boolean(row.is_department_manager),
    mustChangePassword: Boolean(row.must_change_password),
    totpEnabled: Boolean(row.totp_enabled),
    status: String(row.status) as 'ACTIVE' | 'DISABLED',
    failedAttempts: Number(row.failed_attempts || 0),
    lockedUntil: row.locked_until ? String(row.locked_until) : null,
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export function normalizeUsername(input: string) {
  return input.trim().toLowerCase()
}

export function getStaffById(id: string) {
  const row = db
    .prepare(
      `SELECT ${selectColumns} FROM staff_accounts s LEFT JOIN departments d ON d.id = s.department_id WHERE s.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined
  return row ? mapStaff(row) : null
}

export function getStaffByUsername(username: string) {
  const row = db
    .prepare(
      `SELECT ${selectColumns} FROM staff_accounts s LEFT JOIN departments d ON d.id = s.department_id WHERE s.username = ?`
    )
    .get(normalizeUsername(username)) as Record<string, unknown> | undefined
  return row ? mapStaff(row) : null
}

export function getStaffByEmail(email: string) {
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  const row = db
    .prepare(
      `SELECT ${selectColumns} FROM staff_accounts s LEFT JOIN departments d ON d.id = s.department_id WHERE s.email = ?`
    )
    .get(normalized) as Record<string, unknown> | undefined
  return row ? mapStaff(row) : null
}

export function listStaff() {
  const rows = db
    .prepare(
      `SELECT ${selectColumns} FROM staff_accounts s LEFT JOIN departments d ON d.id = s.department_id ORDER BY s.role, s.username`
    )
    .all() as Array<Record<string, unknown>>
  return rows.map(mapStaff)
}

export function countStaff(role?: StaffRole) {
  const row = role
    ? (db.prepare(`SELECT COUNT(*) AS total FROM staff_accounts WHERE role = ? AND status = 'ACTIVE'`).get(role) as {
        total: number
      })
    : (db.prepare(`SELECT COUNT(*) AS total FROM staff_accounts`).get() as { total: number })
  return Number(row.total)
}

export function createStaff(input: {
  username: string
  fullName: string
  role: StaffRole
  departmentId?: string | null
  email?: string | null
  password?: string
  mustChangePassword?: boolean
  createdBy?: string
}) {
  const username = normalizeUsername(input.username)
  if (!/^[a-z0-9._-]{3,40}$/.test(username))
    throw new Error('اسم المستخدم يجب أن يكون 3–40 حرفاً لاتينياً صغيراً أو أرقاماً أو نقاطاً أو شرطات.')
  if (getStaffByUsername(username)) throw new Error('اسم المستخدم مستخدم مسبقاً.')
  if (!staffRoles.includes(input.role)) throw new Error('الدور غير معروف.')
  const email = parseStaffEmail(input.email)
  assertEmailFree(email)
  const temporaryPassword = input.password ?? generateTemporaryPassword()
  if (input.password) {
    const policyError = passwordPolicyError(input.password)
    if (policyError) throw new Error(policyError)
  }
  const id = `stf_${randomUUID().replaceAll('-', '')}`
  const timestamp = now()
  db.prepare(
    `INSERT INTO staff_accounts (id, username, email, full_name, role, department_id, password_hash, password_updated_at, must_change_password, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`
  ).run(
    id,
    username,
    email,
    input.fullName.trim(),
    input.role,
    input.departmentId || null,
    hashPassword(temporaryPassword),
    timestamp,
    input.mustChangePassword === false ? 0 : 1,
    input.createdBy || null,
    timestamp,
    timestamp
  )
  return { account: getStaffById(id)!, temporaryPassword: input.password ? null : temporaryPassword }
}

export type LoginFailure = 'INVALID' | 'LOCKED' | 'DISABLED'

/** Verifies username/password and applies lockout. Returns the account on success. */
export function authenticateStaff(
  username: string,
  password: string
): { ok: true; account: StaffAccount } | { ok: false; reason: LoginFailure; retryAfterSeconds?: number } {
  const row = db
    .prepare(`SELECT id, password_hash, status, failed_attempts, locked_until FROM staff_accounts WHERE username = ?`)
    .get(normalizeUsername(username)) as
    | { id: string; password_hash: string; status: string; failed_attempts: number; locked_until: string | null }
    | undefined
  if (!row) {
    // burn comparable time so username enumeration via timing is harder
    verifyPassword(password, hashPassword('timing-padding-password'))
    return { ok: false, reason: 'INVALID' }
  }
  if (row.status !== 'ACTIVE') return { ok: false, reason: 'DISABLED' }
  if (row.locked_until && row.locked_until > now()) {
    const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(row.locked_until) - Date.now()) / 1000))
    return { ok: false, reason: 'LOCKED', retryAfterSeconds }
  }
  if (!verifyPassword(password, row.password_hash)) {
    return registerFailedStaffAttempt(row.id, 'PASSWORD')
      ? { ok: false, reason: 'LOCKED', retryAfterSeconds: LOCK_MINUTES * 60 }
      : { ok: false, reason: 'INVALID' }
  }
  clearFailedStaffAttempts(row.id)
  return { ok: true, account: getStaffById(row.id)! }
}

/** Shared lockout counter for every sign-in method. Returns true when this failure locked the account. */
export function registerFailedStaffAttempt(staffId: string, method = 'PASSWORD') {
  const row = db.prepare(`SELECT failed_attempts FROM staff_accounts WHERE id = ?`).get(staffId) as
    { failed_attempts: number } | undefined
  if (!row) return false
  const attempts = Number(row.failed_attempts || 0) + 1
  const lockedUntil =
    attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null
  db.prepare(`UPDATE staff_accounts SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?`).run(
    lockedUntil ? 0 : attempts,
    lockedUntil,
    now(),
    staffId
  )
  if (lockedUntil)
    addAudit({
      actor: 'auth',
      role: 'SYSTEM',
      action: 'STAFF_ACCOUNT_LOCKED',
      entityType: 'StaffAccount',
      entityId: staffId,
      metadata: { attempts, lockedUntil, method },
    })
  return Boolean(lockedUntil)
}

export function clearFailedStaffAttempts(staffId: string) {
  db.prepare(`UPDATE staff_accounts SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`).run(
    now(),
    staffId
  )
}

/** Gate for passwordless methods (Google / email code): the account must be active and not locked. */
export function staffSignInBlock(
  account: StaffAccount
): { reason: 'LOCKED' | 'DISABLED'; retryAfterSeconds?: number } | null {
  if (account.status !== 'ACTIVE') return { reason: 'DISABLED' }
  if (account.lockedUntil && account.lockedUntil > now())
    return {
      reason: 'LOCKED',
      retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(account.lockedUntil) - Date.now()) / 1000)),
    }
  return null
}

export function recordStaffLogin(staffId: string) {
  db.prepare(`UPDATE staff_accounts SET last_login_at = ?, updated_at = ? WHERE id = ?`).run(now(), now(), staffId)
}

export function changeStaffPassword(
  staffId: string,
  input: { currentPassword?: string; newPassword: string; force?: boolean }
) {
  const row = db.prepare(`SELECT password_hash FROM staff_accounts WHERE id = ?`).get(staffId) as
    { password_hash: string } | undefined
  if (!row) throw new Error('الحساب غير موجود.')
  if (!input.force && !verifyPassword(input.currentPassword || '', row.password_hash))
    throw new Error('كلمة المرور الحالية غير صحيحة.')
  const policyError = passwordPolicyError(input.newPassword)
  if (policyError) throw new Error(policyError)
  if (verifyPassword(input.newPassword, row.password_hash)) throw new Error('اختر كلمة مرور مختلفة عن الحالية.')
  db.prepare(
    `UPDATE staff_accounts SET password_hash = ?, password_updated_at = ?, must_change_password = 0, updated_at = ? WHERE id = ?`
  ).run(hashPassword(input.newPassword), now(), now(), staffId)
}

/** Super-admin reset: sets a temporary password that must be changed on next login. */
export function resetStaffPassword(staffId: string) {
  const temporaryPassword = generateTemporaryPassword()
  const result = db
    .prepare(
      `UPDATE staff_accounts SET password_hash = ?, password_updated_at = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`
    )
    .run(hashPassword(temporaryPassword), now(), now(), staffId)
  if (!result.changes) throw new Error('الحساب غير موجود.')
  return temporaryPassword
}

export function setStaffStatus(staffId: string, status: 'ACTIVE' | 'DISABLED') {
  const result = db
    .prepare(`UPDATE staff_accounts SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, now(), staffId)
  if (!result.changes) throw new Error('الحساب غير موجود.')
}

export function updateStaffProfile(
  staffId: string,
  input: {
    fullName?: string
    role?: StaffRole
    departmentId?: string | null
    isDepartmentManager?: boolean
    email?: string | null
  }
) {
  const current = getStaffById(staffId)
  if (!current) throw new Error('الحساب غير موجود.')
  const email = input.email === undefined ? current.email : parseStaffEmail(input.email)
  assertEmailFree(email, staffId)
  const role = input.role || current.role
  const departmentId = input.departmentId === undefined ? current.departmentId : input.departmentId
  // a manager manages one department as an employee of it: moving the account elsewhere (or to another role)
  // drops the flag instead of silently making them manager of the new department
  const keepsScope = role === 'EMPLOYEE' && Boolean(departmentId) && departmentId === current.departmentId
  const isDepartmentManager =
    input.isDepartmentManager !== undefined
      ? input.isDepartmentManager && role === 'EMPLOYEE' && Boolean(departmentId)
      : current.isDepartmentManager && keepsScope
  db.prepare(
    `UPDATE staff_accounts SET full_name = ?, role = ?, department_id = ?, is_department_manager = ?, email = ?, updated_at = ? WHERE id = ?`
  ).run(
    input.fullName?.trim() || current.fullName,
    role,
    departmentId,
    isDepartmentManager ? 1 : 0,
    email,
    now(),
    staffId
  )
  return getStaffById(staffId)!
}

// ---- MFA -----------------------------------------------------------------

export function beginTotpEnrollment(staffId: string) {
  const secret = generateTotpSecret()
  db.prepare(
    `UPDATE staff_accounts SET totp_secret_encrypted = ?, totp_enabled = 0, totp_last_counter = NULL, updated_at = ? WHERE id = ?`
  ).run(encryptSecret(secret), now(), staffId)
  return secret
}

function storedTotpSecret(staffId: string) {
  const row = db
    .prepare(`SELECT totp_secret_encrypted, totp_enabled, totp_last_counter FROM staff_accounts WHERE id = ?`)
    .get(staffId) as
    { totp_secret_encrypted: string | null; totp_enabled: number; totp_last_counter: number | null } | undefined
  if (!row?.totp_secret_encrypted) return null
  return {
    secret: decryptSecret(row.totp_secret_encrypted),
    enabled: Boolean(row.totp_enabled),
    lastCounter: row.totp_last_counter,
  }
}

export function confirmTotpEnrollment(staffId: string, code: string) {
  const stored = storedTotpSecret(staffId)
  if (!stored) throw new Error('لم يبدأ إعداد المصادقة الثنائية بعد.')
  const counter = verifyTotp(stored.secret, code)
  if (counter === null) return false
  db.prepare(`UPDATE staff_accounts SET totp_enabled = 1, totp_last_counter = ?, updated_at = ? WHERE id = ?`).run(
    counter,
    now(),
    staffId
  )
  return true
}

export function verifyStaffTotp(staffId: string, code: string) {
  const stored = storedTotpSecret(staffId)
  if (!stored?.enabled) return false
  const counter = verifyTotp(stored.secret, code, Date.now(), stored.lastCounter)
  if (counter === null) return false
  db.prepare(`UPDATE staff_accounts SET totp_last_counter = ?, updated_at = ? WHERE id = ?`).run(
    counter,
    now(),
    staffId
  )
  return true
}

export function disableTotp(staffId: string) {
  db.prepare(
    `UPDATE staff_accounts SET totp_secret_encrypted = NULL, totp_enabled = 0, totp_last_counter = NULL, updated_at = ? WHERE id = ?`
  ).run(now(), staffId)
}

// ---- bootstrap ------------------------------------------------------------

/**
 * Creates the first accounts when the staff table is empty.
 * Prefers STAFF_BOOTSTRAP_* variables; falls back to the legacy shared-password variables so an existing
 * deployment keeps working after upgrade (each legacy password becomes a named account that must be rotated).
 */
export function bootstrapStaffAccounts(log: (message: string) => void = console.log) {
  if (countStaff() > 0) return
  const created: string[] = []
  const bootstrapUsername = process.env.STAFF_BOOTSTRAP_USERNAME?.trim()
  const bootstrapPassword = process.env.STAFF_BOOTSTRAP_PASSWORD?.trim()
  if (bootstrapUsername && bootstrapPassword) {
    createStaff({
      username: bootstrapUsername,
      fullName: process.env.STAFF_BOOTSTRAP_FULL_NAME?.trim() || 'مدير النظام',
      role: 'SUPER_ADMIN',
      password: bootstrapPassword,
      mustChangePassword: true,
      createdBy: 'bootstrap',
    })
    created.push(`${bootstrapUsername} (SUPER_ADMIN)`)
  }
  const legacy: Array<[string, string, StaffRole, string | undefined]> = [
    ['superadmin', 'مدير النظام', 'SUPER_ADMIN', process.env.SUPER_ADMIN_PASSWORD],
    ['employee', 'موظف التدقيق', 'EMPLOYEE', process.env.ADMIN_REVIEW_PASSWORD],
    ['operations', 'مشغل غرفة العمليات', 'OPERATIONS', process.env.OPERATIONS_PASSWORD],
  ]
  for (const [username, fullName, role, password] of legacy) {
    if (!password || getStaffByUsername(username)) continue
    if (role === 'SUPER_ADMIN' && created.length) continue
    const id = `stf_${randomUUID().replaceAll('-', '')}`
    const timestamp = now()
    // legacy passwords may not satisfy the policy: store them but force rotation on first login
    db.prepare(
      `INSERT INTO staff_accounts (id, username, full_name, role, password_hash, password_updated_at, must_change_password, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'ACTIVE', 'legacy-env-bootstrap', ?, ?)`
    ).run(id, username, fullName, role, hashPassword(password), timestamp, timestamp, timestamp)
    created.push(`${username} (${role}, legacy password — must rotate)`)
  }
  if (created.length) {
    addAudit({
      actor: 'bootstrap',
      role: 'SYSTEM',
      action: 'STAFF_ACCOUNTS_BOOTSTRAPPED',
      entityType: 'StaffAccount',
      entityId: 'bootstrap',
      metadata: { created },
    })
    log(`[auth] bootstrapped staff accounts: ${created.join(', ')}`)
  } else {
    log(
      '[auth] no staff accounts exist. Set STAFF_BOOTSTRAP_USERNAME and STAFF_BOOTSTRAP_PASSWORD to create the first super admin.'
    )
  }
}

// ---- recovery -------------------------------------------------------------

/**
 * Regains access when the super admin's password is lost. The operator sets STAFF_RECOVERY_USERNAME and
 * STAFF_RECOVERY_PASSWORD on the server and restarts: that SUPER_ADMIN account is unlocked, re-enabled and given the
 * password (to be changed at the next login). Each username/password pair is applied only once, so a password changed
 * afterwards is never overwritten by later restarts. Only existing super admins can be recovered; no account is
 * created. Remove the variables once signed in.
 */
export function recoverStaffAccount(log: (message: string) => void = console.log) {
  const username = normalizeUsername(process.env.STAFF_RECOVERY_USERNAME || '')
  const password = process.env.STAFF_RECOVERY_PASSWORD?.trim()
  if (!username || !password) return
  const policyError = passwordPolicyError(password)
  if (policyError) return log(`[auth] staff recovery skipped: ${policyError}`)
  db.exec(`CREATE TABLE IF NOT EXISTS staff_recovery_applied (fingerprint TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`)
  const fingerprint = createHash('sha256').update(`${username}\n${password}`).digest('hex')
  if (db.prepare('SELECT 1 FROM staff_recovery_applied WHERE fingerprint = ?').get(fingerprint)) return
  const account = getStaffByUsername(username)
  if (!account || account.role !== 'SUPER_ADMIN')
    return log(`[auth] staff recovery skipped: no super admin named "${username}".`)
  const timestamp = now()
  db.prepare(
    `UPDATE staff_accounts SET password_hash = ?, password_updated_at = ?, must_change_password = 1, status = 'ACTIVE',
       failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`
  ).run(hashPassword(password), timestamp, timestamp, account.id)
  db.prepare('INSERT INTO staff_recovery_applied (fingerprint, applied_at) VALUES (?, ?)').run(fingerprint, timestamp)
  addAudit({
    actor: 'recovery',
    role: 'SYSTEM',
    action: 'STAFF_ACCOUNT_RECOVERED',
    entityType: 'StaffAccount',
    entityId: account.id,
    metadata: { username },
  })
  log(`[auth] super admin "${username}" recovered (unlocked, new password set). Remove STAFF_RECOVERY_* now.`)
}
