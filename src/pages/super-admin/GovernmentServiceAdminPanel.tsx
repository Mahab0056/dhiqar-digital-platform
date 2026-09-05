import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react'
import { api } from '../../api'
import type { GovernmentServiceDirectoryEntry } from '../../types'

export function GovernmentServiceAdminPanel() {
  const [records, setRecords] = useState<GovernmentServiceDirectoryEntry[]>([])
  const [filter, setFilter] = useState<'ALL' | 'APPROVED' | 'NEEDS_REVIEW' | 'DISABLED'>('ALL')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.listGovernmentServicesForAdmin(filter === 'ALL' ? undefined : filter)
      setRecords(response.services)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [filter])
  useEffect(() => {
    void load()
  }, [load])
  const changePublication = async (
    item: GovernmentServiceDirectoryEntry,
    publicationStatus: 'APPROVED' | 'NEEDS_REVIEW' | 'DISABLED'
  ) => {
    const reason = window.prompt(
      publicationStatus === 'NEEDS_REVIEW'
        ? 'سبب إرسال السجل إلى المراجعة:'
        : publicationStatus === 'DISABLED'
          ? 'سبب إيقاف النشر:'
          : 'ملاحظة الاعتماد أو إعادة النشر (اختياري):'
    )
    if (reason === null) return
    try {
      await api.setGovernmentServicePublication(item.id, publicationStatus, reason || undefined)
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <section className="government-service-admin">
      <header className="panel-heading">
        <div>
          <span className="section-kicker">السجل الوطني للخدمات</span>
          <h2>حوكمة المصادر وحالات النشر</h2>
          <p>كل سجل ظاهر للمواطن لديه مصدر رسمي محفوظ. السجلات قيد المراجعة أو المتوقفة لا تظهر في الدليل العام.</p>
        </div>
        <button className="button outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? 'spin' : ''} /> تحديث
        </button>
      </header>
      <nav className="service-admin-filters">
        {(
          [
            ['ALL', 'كل السجلات'],
            ['APPROVED', 'منشور'],
            ['NEEDS_REVIEW', 'قيد المراجعة'],
            ['DISABLED', 'متوقف'],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            className={filter === value ? 'active' : ''}
            onClick={() => setFilter(value)}
            key={value}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <div className="form-error">
          <AlertTriangle /> {error}
        </div>
      )}
      {loading ? (
        <div className="loading-state">
          <RefreshCw className="spin" /> جاري تحميل السجل...
        </div>
      ) : (
        <div className="service-admin-list">
          {records.map(item => (
            <article key={item.id}>
              <div>
                <span className={`service-publication ${item.publicationStatus.toLowerCase()}`}>
                  {item.publicationStatus === 'APPROVED'
                    ? 'منشور'
                    : item.publicationStatus === 'NEEDS_REVIEW'
                      ? 'قيد المراجعة'
                      : item.publicationStatus === 'DISABLED'
                        ? 'متوقف'
                        : 'مسودة'}
                </span>
                <h3>{item.shortNameAr || item.officialNameAr}</h3>
                <p>
                  {item.responsibleMinistry || item.responsibleAuthority || 'الجهة المختصة'} • آخر تحقق:{' '}
                  {item.lastVerifiedDate || 'غير محدد'}
                </p>
                <a href={item.sources[0]?.officialUrl} target="_blank" rel="noreferrer">
                  فتح المصدر الرسمي <ExternalLink />
                </a>
              </div>
              <div className="service-admin-actions">
                {item.publicationStatus !== 'NEEDS_REVIEW' && (
                  <button className="button outline" onClick={() => void changePublication(item, 'NEEDS_REVIEW')}>
                    إرسال للمراجعة
                  </button>
                )}
                {item.publicationStatus !== 'DISABLED' && (
                  <button className="button ghost" onClick={() => void changePublication(item, 'DISABLED')}>
                    إيقاف النشر
                  </button>
                )}
                {item.publicationStatus !== 'APPROVED' && (
                  <button className="button primary" onClick={() => void changePublication(item, 'APPROVED')}>
                    نشر بعد التحقق
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
