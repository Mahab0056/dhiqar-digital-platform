import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from './db.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const railwayVolumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim()
const mediaRoot =
  process.env.MEDIA_STORAGE_PATH?.trim() ||
  (railwayVolumePath ? join(railwayVolumePath, 'private-media') : join(currentDir, '..', 'data', 'private-media'))

mkdirSync(mediaRoot, { recursive: true })

function encryptionKey() {
  const secret = process.env.MEDIA_ENCRYPTION_KEY?.trim()
  if (!secret) throw new Error('MEDIA_ENCRYPTION_KEY is required for protected media uploads.')
  return createHash('sha256').update(secret, 'utf8').digest()
}

export type MediaPurpose =
  | 'NATIONAL_ID_FRONT'
  | 'NATIONAL_ID_BACK'
  | 'IDENTITY_DOCUMENT_FRONT'
  | 'IDENTITY_DOCUMENT_BACK'
  | 'FACE_VIDEO'
  | 'PROFILE_PHOTO'
  | 'APPLICATION_DOCUMENT'
  | 'STOREFRONT_PHOTO'
  | 'FEEDBACK_ATTACHMENT'
  | 'ISSUED_DOCUMENT'

export function storeEncryptedMedia(input: {
  citizenId: number
  purpose: MediaPurpose
  originalName: string
  mimeType: string
  buffer: Buffer
  retentionHours?: number
  retentionPolicy?: 'TIME_LIMITED' | 'RETAINED_WITH_CONSENT'
  retentionConsentAt?: string
}) {
  const id = `media_${randomUUID().replaceAll('-', '')}`
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(input.buffer), cipher.final()])
  const authTag = cipher.getAuthTag()
  const envelope = Buffer.concat([iv, authTag, encrypted])
  const storagePath = join(mediaRoot, `${id}.bin`)
  const timestamp = new Date()
  const retentionPolicy = input.retentionPolicy || 'TIME_LIMITED'
  const expiresAt =
    retentionPolicy === 'RETAINED_WITH_CONSENT'
      ? new Date('9999-12-31T23:59:59.999Z')
      : new Date(timestamp.getTime() + (input.retentionHours ?? 168) * 60 * 60 * 1000)
  const sha256 = createHash('sha256').update(input.buffer).digest('hex')

  writeFileSync(storagePath, envelope, { mode: 0o600 })
  db.prepare(
    `
    INSERT INTO media_objects (
      id, citizen_id, purpose, storage_path, original_name, mime_type,
      size_bytes, sha256, encrypted, expires_at, retention_policy, retention_consent_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `
  ).run(
    id,
    input.citizenId,
    input.purpose,
    storagePath,
    input.originalName,
    input.mimeType,
    input.buffer.length,
    sha256,
    expiresAt.toISOString(),
    retentionPolicy,
    retentionPolicy === 'RETAINED_WITH_CONSENT' ? input.retentionConsentAt || timestamp.toISOString() : null,
    timestamp.toISOString()
  )

  return {
    id,
    purpose: input.purpose,
    retentionPolicy,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.length,
    sha256,
    expiresAt: expiresAt.toISOString(),
  }
}

export function readDecryptedMedia(id: string) {
  const row = db
    .prepare(
      `
    SELECT storage_path, mime_type, original_name, deleted_at
    FROM media_objects WHERE id = ?
  `
    )
    .get(id) as
    { storage_path: string; mime_type: string; original_name: string; deleted_at: string | null } | undefined

  if (!row || row.deleted_at) return null
  const envelope = readFileSync(row.storage_path)
  if (envelope.length < 29) throw new Error('Encrypted media envelope is invalid.')
  const iv = envelope.subarray(0, 12)
  const authTag = envelope.subarray(12, 28)
  const encrypted = envelope.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv)
  decipher.setAuthTag(authTag)
  const buffer = Buffer.concat([decipher.update(encrypted), decipher.final()])

  return { buffer, mimeType: row.mime_type, originalName: row.original_name }
}

export function deleteEncryptedMedia(id: string) {
  const row = db.prepare('SELECT storage_path, deleted_at FROM media_objects WHERE id = ?').get(id) as
    { storage_path: string; deleted_at: string | null } | undefined
  if (!row || row.deleted_at) return false
  rmSync(row.storage_path, { force: true })
  db.prepare('UPDATE media_objects SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), id)
  return true
}

export function purgeExpiredMedia() {
  const expired = db
    .prepare(
      `
    SELECT id FROM media_objects
    WHERE deleted_at IS NULL AND retention_policy != 'RETAINED_WITH_CONSENT' AND expires_at <= ?
  `
    )
    .all(new Date().toISOString()) as Array<{ id: string }>

  let removed = 0
  for (const item of expired) {
    if (deleteEncryptedMedia(item.id)) removed += 1
  }
  return removed
}
