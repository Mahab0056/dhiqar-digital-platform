import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { AlertTriangle, ArrowLeft, BadgeCheck, Building2, Clock3, ExternalLink, MapPin, Search } from 'lucide-react'
import { api } from '../../api'
import type { GovernmentServiceDirectoryEntry } from '../../types'
import { EmptyState, LoadingBlock } from './PageHeader'

export function OfficialGovernmentServiceCatalog({ query }: { query: string }) {
  const [items, setItems] = useState<GovernmentServiceDirectoryEntry[]>([])
  const [onlyDhiQar, setOnlyDhiQar] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    api
      .listGovernmentServices({ query: query.trim() || undefined, dhiQarOnly: onlyDhiQar })
      .then(value => {
        if (active) setItems(value)
      })
      .catch(err => {
        if (active) setError((err as Error).message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [query, onlyDhiQar])
  const channelLabel = (service: GovernmentServiceDirectoryEntry) =>
    service.serviceType === 'EXTERNAL_DIGITAL_SERVICE'
      ? 'تقديم عبر البوابة الرسمية'
      : service.serviceType === 'PHYSICAL_ONLY'
        ? 'مراجعة حضورية'
        : 'دليل إجراءات رسمي'
  return (
    <section className="official-catalog" aria-labelledby="official-catalog-title">
      <header className="tq-section-head">
        <div>
          <span className="section-kicker">الخدمات الوطنية الموثقة</span>
          <h2 id="official-catalog-title">خدمات موثقة من مصادر حكومية رسمية</h2>
          <p>
            تُعرض الرسوم والمستمسكات والخطوات كما نُشرت في المصدر. لا تنشئ المنصة رقماً أو معاملة موازية للخدمة
            الوطنية.
          </p>
        </div>
        <label className="tq-check">
          <input type="checkbox" checked={onlyDhiQar} onChange={event => setOnlyDhiQar(event.target.checked)} />
          <span>الخدمات التي تذكر ذي قار أو المحافظات صراحةً</span>
        </label>
      </header>
      {loading ? (
        <LoadingBlock label="جاري تحميل السجل الموثق…" />
      ) : error ? (
        <div className="form-error" role="alert">
          <AlertTriangle /> {error}
        </div>
      ) : items.length ? (
        <ul className="official-grid">
          {items.map(service => (
            <li key={service.id} className="official-card">
              <div className="dir-row-tags">
                <span className="tq-badge is-success">
                  <BadgeCheck />
                  {service.verificationStatus === 'VERIFIED_UR_PORTAL' ? 'موثق من بوابة أور' : 'مصدر حكومي موثق'}
                </span>
                <span className="tq-badge">{channelLabel(service)}</span>
              </div>
              <h3>
                <Link href={`/government-services/${service.canonicalServiceId}`}>
                  {service.citizenFriendlyName || service.shortNameAr || service.officialNameAr}
                </Link>
              </h3>
              <p>{service.description || 'تفاصيل الخدمة منشورة لدى الجهة المختصة.'}</p>
              <ul className="dir-row-meta">
                <li>
                  <Building2 aria-hidden="true" />
                  <span>{service.responsibleMinistry || service.responsibleAuthority || 'الجهة المختصة'}</span>
                </li>
                {service.availableInDhiQar && (
                  <li>
                    <MapPin aria-hidden="true" /> متاح في ذي قار
                  </li>
                )}
                {service.processingTime && (
                  <li>
                    <Clock3 aria-hidden="true" /> {service.processingTime}
                  </li>
                )}
              </ul>
              <div className="official-card-actions">
                <Link href={`/government-services/${service.canonicalServiceId}`} className="button outline small">
                  التفاصيل <ArrowLeft />
                </Link>
                {service.externalServiceUrl && (
                  <a href={service.externalServiceUrl} target="_blank" rel="noreferrer" className="gov-link">
                    <ExternalLink size={14} /> الجهة الرسمية
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<Search />}
          title="لا توجد خدمة موثقة مطابقة"
          text="جرّب اسماً آخر أو أزل فلتر ذي قار. لا تظهر السجلات التي ما زالت قيد التحقق."
        />
      )}
    </section>
  )
}
