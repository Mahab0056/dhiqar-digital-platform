import { db } from './db.js'
import { departmentRegistry } from './department-registry.js'
import { serviceDefinitions } from '../src/service-forms.js'

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

export function seedPlatformServiceCatalog() {
  const timestamp = new Date().toISOString()
  for (const definition of serviceDefinitions) {
    const department = ensureDepartmentRecord(definition.department)
    if (!department) continue
    db.prepare(
      `INSERT INTO service_catalog (id, department_id, name, category, description, fee_iqd, fee_status, estimated_duration, form_schema, required_documents, payment_mode, active, source_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DISABLED', 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET department_id = excluded.department_id, name = excluded.name, category = excluded.category, description = excluded.description, fee_iqd = excluded.fee_iqd, estimated_duration = excluded.estimated_duration, form_schema = excluded.form_schema, source_url = excluded.source_url, updated_at = excluded.updated_at`
    ).run(
      definition.key,
      department.id,
      definition.title,
      definition.category,
      definition.description,
      definition.fee,
      definition.fee > 0 ? 'UNVERIFIED' : 'NOT_REQUIRED',
      definition.estimatedTime,
      JSON.stringify(definition.fields),
      JSON.stringify(definition.requirements),
      department.sourceUrl,
      timestamp,
      timestamp
    )
  }
}
