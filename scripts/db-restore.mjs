#!/usr/bin/env node
// Restore a SQLite backup over the live database. Stop the server first.
// Usage: node scripts/db-restore.mjs <backup.sqlite> [target.sqlite]
import { copyFileSync, existsSync, renameSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const [backup, target = process.env.DATABASE_PATH || 'data/dhiqar-demo.sqlite'] = process.argv.slice(2)
if (!backup || !existsSync(backup)) {
  console.error('Usage: node scripts/db-restore.mjs <backup.sqlite> [target.sqlite]')
  process.exit(1)
}
const check = new DatabaseSync(backup, { readOnly: true }).prepare('PRAGMA integrity_check').all()
if (check.length !== 1 || check[0].integrity_check !== 'ok') {
  console.error('Backup failed integrity check:', check)
  process.exit(2)
}
if (existsSync(target)) {
  const safety = `${target}.pre-restore-${Date.now()}`
  renameSync(target, safety)
  for (const suffix of ['-wal', '-shm']) if (existsSync(target + suffix)) renameSync(target + suffix, safety + suffix)
  console.log(`previous database moved to ${safety}`)
}
copyFileSync(backup, target)
console.log(`restored ${backup} -> ${target}`)
