import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { db, databasePath } from '../db.js'

const backupDir = () => process.env.BACKUP_DIR?.trim() || join(dirname(databasePath), 'backups')
const retentionDays = () => Number(process.env.BACKUP_RETENTION_DAYS || 14)
const minimumKept = () => Number(process.env.BACKUP_MIN_KEEP || 7)
const intervalHours = () => Number(process.env.BACKUP_INTERVAL_HOURS || 6)

export type BackupEntry = { file: string; path: string; sizeBytes: number; createdAt: string }

export function listBackups(): BackupEntry[] {
  const dir = backupDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(file => file.endsWith('.sqlite'))
    .map(file => {
      const path = join(dir, file)
      const stats = statSync(path)
      return { file, path, sizeBytes: stats.size, createdAt: stats.mtime.toISOString() }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Consistent online snapshot using SQLite's VACUUM INTO (safe under WAL, no write lock held for long). */
export function createBackup(reason: 'SCHEDULED' | 'MANUAL' | 'STARTUP' = 'MANUAL') {
  const dir = backupDir()
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = `dhiqar-${stamp}-${reason.toLowerCase()}.sqlite`
  const target = join(dir, file)
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  pruneBackups()
  const stats = statSync(target)
  return { file, path: target, sizeBytes: stats.size, createdAt: stats.mtime.toISOString() } satisfies BackupEntry
}

export function pruneBackups() {
  const entries = listBackups()
  const cutoff = Date.now() - retentionDays() * 24 * 60 * 60 * 1000
  entries.forEach((entry, index) => {
    if (index < minimumKept()) return
    if (Date.parse(entry.createdAt) < cutoff) unlinkSync(entry.path)
  })
}

export function integrityCheck() {
  const rows = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>
  const ok = rows.length === 1 && rows[0].integrity_check === 'ok'
  return { ok, detail: rows.map(row => row.integrity_check) }
}

export function scheduleBackups(log: (message: string) => void = console.log) {
  if (process.env.BACKUP_ENABLED === 'false' || process.env.NODE_ENV === 'test') return null
  const check = integrityCheck()
  if (!check.ok) log(`[db] INTEGRITY CHECK FAILED: ${check.detail.join('; ')}`)
  else log('[db] integrity check ok')
  try {
    const first = createBackup('STARTUP')
    log(`[db] startup backup written: ${first.path} (${Math.round(first.sizeBytes / 1024)} KB)`)
  } catch (error) {
    log(`[db] startup backup failed: ${(error as Error).message}`)
  }
  const timer = setInterval(
    () => {
      try {
        const entry = createBackup('SCHEDULED')
        log(`[db] scheduled backup written: ${entry.file}`)
      } catch (error) {
        log(`[db] scheduled backup failed: ${(error as Error).message}`)
      }
    },
    intervalHours() * 60 * 60 * 1000
  )
  timer.unref()
  return timer
}

export function databaseStats() {
  const pageSize = (db.prepare('PRAGMA page_size').get() as { page_size: number }).page_size
  const pageCount = (db.prepare('PRAGMA page_count').get() as { page_count: number }).page_count
  const tables = (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as Array<{
      name: string
    }>
  ).map(table => ({
    name: table.name,
    rows: Number((db.prepare(`SELECT COUNT(*) AS total FROM "${table.name}"`).get() as { total: number }).total),
  }))
  return {
    engine: 'sqlite',
    path: databasePath,
    sizeBytes: pageSize * pageCount,
    journalMode: (db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode,
    tables,
    backups: listBackups().slice(0, 20),
    backupDir: backupDir(),
    retentionDays: retentionDays(),
    intervalHours: intervalHours(),
  }
}
