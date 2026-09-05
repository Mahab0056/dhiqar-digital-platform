import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { AlertTriangle, ArrowLeft, ExternalLink, RefreshCw, Search } from 'lucide-react'
import { api } from '../../api'
import type { GovernmentServiceDirectoryEntry } from '../../types'

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
    <section className="directory-results official-government-services">
      <header>
        <span className="section-kicker">الخدمات الوطنية الموثقة</span>
        <h2>خدمات موثقة من مصادر حكومية رسمية</h2>
        <p>
          تُعرض الرسوم والمستمسكات والخطوات كما نُشرت في المصدر. لا تنشئ المنصة رقماً أو معاملة موازية للخدمة الوطنية.
        </p>
        <label className="directory-dhiqar-filter">
          <input type="checkbox" checked={onlyDhiQar} onChange={event => setOnlyDhiQar(event.target.checked)} /> إظهار
          الخدمات التي تذكر ذي قار أو المحافظات صراحةً
        </label>
      </header>
      {loading ? (
        <div className="loading-state">
          <RefreshCw className="spin" /> جاري تحميل السجل الموثق...
        </div>
      ) : error ? (
        <div className="form-error">
          <AlertTriangle /> {error}
        </div>
      ) : items.length ? (
        <div className="directory-result-list">
          {items.map(service => (
            <article key={service.id}>
              <span className="availability available">
                {service.verificationStatus === 'VERIFIED_UR_PORTAL' ? 'موثق من بوابة أور' : 'مصدر حكومي موثق'}
              </span>
              <div>
                <small>
                  {service.responsibleMinistry || service.responsibleAuthority || 'الجهة المختصة'} • {service.category}
                </small>
                <h3>{service.citizenFriendlyName || service.shortNameAr || service.officialNameAr}</h3>
                <p>{service.description || 'تفاصيل الخدمة منشورة لدى الجهة المختصة.'}</p>
                <div className="government-record-meta">
                  <span>{channelLabel(service)}</span>
                  {service.availableInDhiQar && <span>متاح أو مذكور لذي قار</span>}
                  {service.processingTime && <span>{service.processingTime}</span>}
                </div>
              </div>
              <div className="directory-record-actions">
                <Link href={`/government-services/${service.canonicalServiceId}`} className="button outline">
                  عرض التفاصيل <ArrowLeft />
                </Link>
                {service.externalServiceUrl && (
                  <a href={service.externalServiceUrl} target="_blank" rel="noreferrer" className="button primary">
                    فتح الجهة الرسمية <ExternalLink />
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="directory-empty">
          <Search />
          <h3>لا توجد خدمة موثقة مطابقة</h3>
          <p>جرّب اسماً آخر أو أزل فلتر ذي قار. لا تظهر السجلات التي ما زالت قيد التحقق.</p>
        </div>
      )}
    </section>
  )
}
