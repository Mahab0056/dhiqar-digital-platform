import { useId, type CSSProperties } from 'react'
import { Link } from 'wouter'
import {
  ArrowRight,
  Building2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Gauge,
  Landmark,
  Network,
  Users,
} from 'lucide-react'
import {
  DISTRICT_FACTS,
  DISTRICT_LANDMARKS,
  GOVERNORATE_AREA,
  GOVERNORATE_POPULATION_2024,
  OFFICIAL_DISTRICT_COUNT,
} from './dhiqar-district-facts'
import { openWork, type DistrictSummary, type OpsDepartment, type OpsState } from './district-data'
import { FACILITY_GROUPS, groupCounts, type FacilityIndex } from './facility-catalog'

// The district profile of the operations room and the governor dashboard: one picker and one panel, shared by the
// 3D drill-down map and its flat (Leaflet) fallback, so a browser without WebGL still gets every district's profile.
// No MapLibre import here — the fallback must not load the 3D chunk.

const fmt = (value: number) => value.toLocaleString('en-US')

/** the non-map district selector (lives in the map toolbar, so it works the same in 3D and in the 2D fallback) */
export function DistrictPicker({
  value,
  districts,
  onChange,
}: {
  value: string | null
  districts: readonly { name: string }[]
  onChange: (name: string | null) => void
}) {
  return (
    <label className="drill-picker">
      <span className="sr-only">اختر قضاءً لعرض ملفه</span>
      <select value={value ?? ''} onChange={event => onChange(event.target.value || null)}>
        <option value="">كل المحافظة ({fmt(OFFICIAL_DISTRICT_COUNT)} قضاءً)</option>
        {districts.map(row => (
          <option key={row.name} value={row.name}>
            قضاء {row.name}
          </option>
        ))}
      </select>
    </label>
  )
}

type PanelProps = {
  district: DistrictSummary
  /** every district (population rank) */
  districts: readonly DistrictSummary[]
  facilityIndex: FacilityIndex | null
  services: Map<string, number> | null
  variant: 'operations' | 'governor'
  stateOf: (department: OpsDepartment) => OpsState
  selectedId: string | null
  /** a department with official coordinates was picked from the list */
  onSelectDepartment: (id: string) => void
  onBack: () => void
  /** folded down to its title bar, so the map behind it is free (the host keeps the choice) */
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

export function DistrictProfilePanel({
  district: current,
  districts,
  facilityIndex,
  services,
  variant,
  stateOf,
  selectedId,
  onSelectDepartment,
  onBack,
  collapsed = false,
  onToggleCollapsed,
}: PanelProps) {
  const bodyId = useId()
  const fact = DISTRICT_FACTS[current.name]
  // density and rank are calculated from the census figure and the boundary area
  const ranked = districts.filter(row => DISTRICT_FACTS[row.name])
  const rank = ranked.findIndex(row => row.name === current.name) + 1
  const areaKm2 = current.areaKm2
  const density = fact && areaKm2 ? fact.population / areaKm2 : null
  const osmDistrict = facilityIndex?.districts[current.name]
  const facilityGroups = groupCounts(osmDistrict?.counts)
  const facilityMax = Math.max(1, ...facilityGroups.values())
  const landmarks = DISTRICT_LANDMARKS[current.name] ?? []
  const listedServices = services
    ? current.departments.reduce((sum, item) => sum + (services.get(String(item.id)) || 0), 0)
    : null

  return (
    <aside
      className={`drill-panel${collapsed ? ' is-collapsed' : ''}`}
      aria-label={`ملف قضاء ${current.name}`}
      key={current.name}
    >
      <div className="drill-bar">
        <button type="button" className="drill-back" onClick={onBack}>
          <ArrowRight aria-hidden="true" /> رجوع للمحافظة
        </button>
        {collapsed && <strong className="drill-bar-name">قضاء {current.name}</strong>}
        {onToggleCollapsed && (
          <button
            type="button"
            className="drill-toggle"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            title={collapsed ? 'إظهار ملف القضاء' : 'طيّ ملف القضاء لإظهار الخريطة'}
          >
            {collapsed ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
            <span className="sr-only">{collapsed ? 'إظهار ملف القضاء' : 'طيّ ملف القضاء'}</span>
          </button>
        )}
      </div>
      <div className="drill-body" id={bodyId} hidden={collapsed}>
        <header>
          <small>قضاء</small>
          <h3>{current.name}</h3>
          <p>
            مركز القضاء: مدينة {current.name}
            {rank > 0 && ` · الترتيب ${fmt(rank)} من ${fmt(ranked.length)} بعدد السكان`}
          </p>
          {current.formerParent && <p>كان ناحيةً ضمن قضاء {current.formerParent} في بيانات الحدود القديمة</p>}
        </header>

        <section className="drill-section">
          <h4>
            <Users aria-hidden="true" /> السكان والمساحة
          </h4>
          <dl className="drill-facts">
            <div>
              <dt>السكان</dt>
              <dd>{fact ? fmt(fact.population) : 'غير متوفر'}</dd>
              {fact && (
                <small>
                  تعداد {fact.year} ·{' '}
                  <a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer" title={fact.source}>
                    المصدر
                  </a>
                </small>
              )}
            </div>
            <div>
              <dt>نسبة من المحافظة</dt>
              <dd>{fact ? `${((fact.population / GOVERNORATE_POPULATION_2024) * 100).toFixed(1)}%` : 'غير متوفر'}</dd>
              {fact && <small>من {fmt(GOVERNORATE_POPULATION_2024)} نسمة</small>}
            </div>
            <div>
              <dt>المساحة</dt>
              <dd>{areaKm2 ? `${fmt(areaKm2)} كم²` : 'غير متوفر'}</dd>
              <small>تقريبية من حدود مبسّطة</small>
            </div>
            <div>
              <dt>الكثافة السكانية</dt>
              <dd>{density ? fmt(Math.round(density)) : 'غير متوفر'}</dd>
              <small>نسمة/كم² · تقريبية</small>
            </div>
          </dl>
          <p className="drill-note">
            مساحة المحافظة الرسمية نحو {fmt(GOVERNORATE_AREA.km2)} كم² (
            <a
              href={GOVERNORATE_AREA.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={GOVERNORATE_AREA.source}
            >
              الجهاز المركزي للإحصاء
            </a>
            )، ومساحات الأقضية هنا مقاسة من حدود OpenStreetMap مبسّطة فلا يطابق مجموعها الرقم الرسمي.
          </p>
        </section>

        <section className="drill-section">
          <h4>
            <Network aria-hidden="true" /> الوحدات الإدارية <small>حسب OpenStreetMap</small>
          </h4>
          {osmDistrict?.subdistricts.length ? (
            <ul className="drill-chips">
              {osmDistrict.subdistricts.map(unit => (
                <li key={unit.osm} className={unit.centre ? 'is-centre' : ''}>
                  {unit.centre ? 'مركز القضاء' : `ناحية ${unit.name}`}
                </li>
              ))}
            </ul>
          ) : (
            <p className="drill-empty">{facilityIndex ? 'غير متوفر' : 'جارٍ التحميل…'}</p>
          )}
        </section>

        <section className="drill-section">
          <h4>
            <Building2 aria-hidden="true" /> المرافق العامة <small>حسب OpenStreetMap</small>
          </h4>
          {osmDistrict ? (
            <>
              <ul className="drill-bars">
                {FACILITY_GROUPS.map(group => {
                  const count = facilityGroups.get(group.key) || 0
                  return (
                    <li
                      key={group.key}
                      style={
                        { '--bar': group.color, '--w': `${Math.round((count / facilityMax) * 100)}%` } as CSSProperties
                      }
                    >
                      <span>{group.label}</span>
                      <b>{fmt(count)}</b>
                      <i aria-hidden="true" />
                    </li>
                  )
                })}
              </ul>
              <p className="drill-note">
                {fmt(osmDistrict.total)} مرفقاً مرسوماً في OpenStreetMap — التغطية غير مكتملة وقد تقل عن الواقع.
              </p>
            </>
          ) : (
            <p className="drill-empty">{facilityIndex ? 'غير متوفر' : 'جارٍ التحميل…'}</p>
          )}
        </section>

        <section className="drill-section">
          <h4>
            <Gauge aria-hidden="true" /> على المنصة
          </h4>
          <dl className="drill-kpis">
            <div>
              <dt>جهات حكومية</dt>
              <dd>{fmt(current.departments.length)}</dd>
            </div>
            <div>
              <dt>خدمات مدرجة</dt>
              <dd>{listedServices === null ? '—' : fmt(listedServices)}</dd>
            </div>
            {variant === 'governor' ? (
              <>
                <div>
                  <dt>طلبات مسجلة</dt>
                  <dd>{fmt(current.transactions)}</dd>
                </div>
                <div>
                  <dt>نسبة الإنجاز</dt>
                  <dd>
                    {current.transactions ? `${Math.round((current.completed / current.transactions) * 100)}%` : '—'}
                  </dd>
                </div>
                <div className={current.overdue ? 'is-alert' : ''}>
                  <dt>متأخرة عن موعدها</dt>
                  <dd>{fmt(current.overdue)}</dd>
                </div>
                <div>
                  <dt>شكاوى مفتوحة</dt>
                  <dd>{fmt(current.feedback)}</dd>
                </div>
              </>
            ) : (
              <>
                <div className={current.open ? 'is-busy' : ''}>
                  <dt>طلبات مفتوحة</dt>
                  <dd>{fmt(current.open)}</dd>
                </div>
                <div className={current.overdue ? 'is-alert' : ''}>
                  <dt>متأخرة (SLA)</dt>
                  <dd>{fmt(current.overdue)}</dd>
                </div>
                <div className={current.alerts ? 'is-alert' : ''}>
                  <dt>بلا موظف مفعّل</dt>
                  <dd>{fmt(current.alerts)}</dd>
                </div>
                <div>
                  <dt>شكاوى مفتوحة</dt>
                  <dd>{fmt(current.feedback)}</dd>
                </div>
              </>
            )}
          </dl>
        </section>

        {landmarks.length > 0 && (
          <section className="drill-section">
            <h4>
              <Landmark aria-hidden="true" /> معالم
            </h4>
            <ul className="drill-landmarks">
              {landmarks.map(item => (
                <li key={item.title}>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                  <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" title={item.source}>
                    المصدر: اليونسكو <ExternalLink aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="drill-section">
          <h4>
            <Building2 aria-hidden="true" /> الجهات في القضاء
            {current.mapped < current.departments.length && <small> ({fmt(current.mapped)} على الخريطة)</small>}
          </h4>
          {/* the map legend gives way while a district is open; its key moves here, next to the dots it explains */}
          <p className="drill-legend">
            <span className="sr-only">دلالة الألوان: </span>
            <span>
              <i className="gis-dot is-idle" aria-hidden="true" /> لا طلبات مفتوحة
            </span>
            <span>
              <i className="gis-dot is-busy" aria-hidden="true" /> قيد المعالجة
            </span>
            <span>
              <i className="gis-dot is-alert" aria-hidden="true" /> بلا موظف مفعّل
            </span>
          </p>
          {current.departments.length === 0 ? (
            <p className="drill-empty">لا توجد جهة مسجلة في هذا القضاء بعد.</p>
          ) : (
            <ul className="drill-list">
              {current.departments.map((item, index) => {
                const state = stateOf(item)
                const located = typeof item.lat === 'number' && typeof item.lng === 'number'
                return (
                  <li key={item.id} style={{ '--i': Math.min(index, 20) } as CSSProperties}>
                    <button
                      type="button"
                      onClick={() => located && onSelectDepartment(String(item.id))}
                      disabled={!located}
                      title={located ? 'إظهار على الخريطة' : 'بانتظار إحداثيات رسمية'}
                      className={String(item.id) === selectedId ? 'is-selected' : ''}
                      data-department={String(item.id)}
                    >
                      <i className={`gis-dot is-${state}`} aria-hidden="true" />
                      <span>{item.name}</span>
                      {variant === 'governor'
                        ? item.transactions > 0 && <em>{fmt(item.transactions)}</em>
                        : openWork(item) > 0 && <em>{fmt(openWork(item))}</em>}
                    </button>
                    <Link href={`/departments/${encodeURIComponent(String(item.id))}`} aria-label={`صفحة ${item.name}`}>
                      ←
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </aside>
  )
}
