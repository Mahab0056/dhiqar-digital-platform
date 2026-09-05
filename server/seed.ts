import { db } from './db.js'
import { departmentRegistry } from './department-registry.js'

export function ensureDepartmentRecord(name: string) {
  const item = departmentRegistry.find(entry => entry.name === name)
  if (!item) return null
  const timestamp = new Date().toISOString()
  db.prepare(
    `INSERT INTO departments (id, name, category, district, website, lat, lng, data_status, source_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category, district = excluded.district, website = excluded.website, lat = excluded.lat, lng = excluded.lng, data_status = excluded.data_status, source_url = excluded.source_url, updated_at = excluded.updated_at`
  ).run(
    item.id,
    item.name,
    item.category,
    item.district,
    item.sourceUrl,
    item.lat,
    item.lng,
    item.dataStatus,
    item.sourceUrl,
    timestamp,
    timestamp
  )
  return item
}
