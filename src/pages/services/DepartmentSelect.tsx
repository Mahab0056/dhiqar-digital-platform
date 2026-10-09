import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import '../../styles/ds/citizen-requests.css'
import { api } from '../../api'
import type { DepartmentSummary } from '../../types'

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ـً-ٰٟ]/g, '')
    .trim()

/**
 * Department picker for the appointment form: every department of the governorate (from /api/departments), grouped by
 * sector and filterable by name, district or service. Only names the form accepts (`allowed`) are offered, so what the
 * citizen picks always passes the server's validation.
 */
export function DepartmentSelect({
  name,
  required,
  allowed,
  defaultValue,
}: {
  name: string
  required: boolean
  allowed: string[]
  defaultValue?: string
}) {
  const [departments, setDepartments] = useState<DepartmentSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [value, setValue] = useState(defaultValue || '')
  useEffect(() => {
    let active = true
    api
      .listDepartments()
      .then(response => {
        if (active) setDepartments(response.items)
      })
      .catch(() => {
        if (active) setDepartments([])
      })
    return () => {
      active = false
    }
  }, [])
  const groups = useMemo(() => {
    const allowedSet = new Set(allowed)
    const known = (departments || []).filter(item => allowedSet.has(item.name))
    const knownNames = new Set(known.map(item => item.name))
    // names the form accepts but the directory did not return (offline, older API) stay selectable
    const extra = allowed
      .filter(item => !knownNames.has(item))
      .map(item => ({ name: item, category: 'دوائر أخرى', district: '', services: [] as string[] }))
    const term = normalize(query)
    const matches = [...known, ...extra].filter(
      item =>
        !term ||
        item.name === value ||
        normalize(`${item.name} ${item.category} ${item.district} ${item.services.join(' ')}`).includes(term)
    )
    const byCategory = new Map<string, typeof matches>()
    for (const item of matches) byCategory.set(item.category, [...(byCategory.get(item.category) || []), item])
    return [...byCategory.entries()]
      .map(([category, items]) => ({
        category,
        items: items.sort((a, b) => a.name.localeCompare(b.name, 'ar')),
      }))
      .sort((a, b) => a.category.localeCompare(b.category, 'ar'))
  }, [allowed, departments, query, value])
  const count = groups.reduce((sum, group) => sum + group.items.length, 0)
  return (
    <span className="svc-department-select">
      <span className="svc-department-search">
        <Search aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="ابحث: أحوال، جوازات، مرور، كهرباء، تربية…"
          aria-label="البحث عن الدائرة"
        />
      </span>
      <select
        name={name}
        required={required}
        value={value}
        onChange={event => setValue(event.target.value)}
        aria-label="الدائرة المطلوبة"
      >
        <option value="" disabled>
          {departments === null
            ? 'جاري تحميل الدوائر…'
            : count
              ? `اختر من ${count.toLocaleString('en-US')} دائرة`
              : 'لا توجد دائرة مطابقة'}
        </option>
        {groups.map(group => (
          <optgroup label={group.category} key={group.category}>
            {group.items.map(item => (
              <option value={item.name} key={item.name}>
                {item.name}
                {item.district && item.district !== 'الناصرية' ? ` — ${item.district}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </span>
  )
}
