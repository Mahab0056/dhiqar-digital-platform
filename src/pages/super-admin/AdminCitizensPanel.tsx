import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CalendarDays, FileText, RefreshCw, Search, UsersRound } from 'lucide-react'
import { api } from '../../api'
import type { AdminCitizenDirectoryItem } from '../../types'

export function AdminCitizensPanel() {
  const [query, setQuery] = useState('')
  const [verificationStatus, setVerificationStatus] = useState('')
  const [documentType, setDocumentType] = useState('')
  const [citizens, setCitizens] = useState<AdminCitizenDirectoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.listSuperAdminCitizens({ query, verificationStatus, documentType })
      setCitizens(response.citizens)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [query, verificationStatus, documentType])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 240)
    return () => window.clearTimeout(timer)
  }, [load])
  const verificationLabels: Record<string, string> = {
    PHONE_VERIFIED: 'الهاتف موثق',
    PENDING_REVIEW: 'بانتظار المراجعة',
    MANUAL_REVIEW: 'قيد المراجعة اليدوية',
    VERIFIED: 'موثق',
    VERIFIED_MANUAL: 'موثق يدوياً',
    VERIFIED_UR_PORTAL: 'موثق عبر بوابة أور',
    NEEDS_RESUBMISSION: 'مطلوب إعادة الإرسال',
    REJECTED: 'مرفوض',
  }
  const documentLabels: Record<string, string> = {
    NATIONAL_ID: 'البطاقة الوطنية',
    PASSPORT: 'جواز السفر',
    DRIVING_LICENSE: 'إجازة السياقة',
  }
  return (
    <section id="admin-citizens" className="admin-citizens-panel">
      <header className="panel-heading">
        <div>
          <span className="section-kicker">إدارة المواطنين</span>
          <h2>سجل المواطنين</h2>
          <p>
            ابحث وفلتر الحسابات المسجلة. تعرض القائمة بيانات تعريف محدودة فقط؛ الموقع وصور الوثائق وفيديو الوجه لا تظهر
            هنا.
          </p>
        </div>
        <div className="admin-citizen-total">
          <UsersRound />
          <strong>{citizens.length.toLocaleString('en-US')}</strong>
          <small>نتيجة ظاهرة</small>
        </div>
      </header>
      <div className="admin-citizen-controls">
        <label className="admin-citizen-search">
          <Search />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="ابحث بالاسم أو الهاتف أو رقم الهوية المقنّع"
            aria-label="البحث في المواطنين"
          />
        </label>
        <label>
          حالة التوثيق
          <select value={verificationStatus} onChange={event => setVerificationStatus(event.target.value)}>
            <option value="">كل الحالات</option>
            <option value="PHONE_VERIFIED">الهاتف موثق</option>
            <option value="PENDING_REVIEW">بانتظار المراجعة</option>
            <option value="MANUAL_REVIEW">قيد المراجعة اليدوية</option>
            <option value="VERIFIED">موثق</option>
            <option value="VERIFIED_MANUAL">موثق يدوياً</option>
            <option value="NEEDS_RESUBMISSION">مطلوب إعادة الإرسال</option>
            <option value="REJECTED">مرفوض</option>
          </select>
        </label>
        <label>
          نوع المستند
          <select value={documentType} onChange={event => setDocumentType(event.target.value)}>
            <option value="">كل المستندات</option>
            <option value="NATIONAL_ID">البطاقة الوطنية</option>
            <option value="PASSPORT">جواز السفر</option>
            <option value="DRIVING_LICENSE">إجازة السياقة</option>
            <option value="UNSPECIFIED">غير محدد</option>
          </select>
        </label>
        <button type="button" className="button outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? 'spin' : ''} /> تحديث
        </button>
      </div>
      {error && (
        <div className="form-error">
          <AlertTriangle /> {error}
        </div>
      )}
      {loading ? (
        <div className="loading-state">
          <RefreshCw className="spin" /> جاري تحميل سجل المواطنين...
        </div>
      ) : citizens.length ? (
        <div className="admin-citizen-list">
          {citizens.map(citizen => (
            <article key={citizen.id}>
              <header>
                <span className="admin-citizen-avatar">{citizen.fullName.trim().slice(0, 1) || 'م'}</span>
                <div>
                  <h3>{citizen.fullName}</h3>
                  <small>
                    المعرف الداخلي: {citizen.id.toLocaleString('en-US')} • انضم{' '}
                    {new Date(citizen.createdAt).toLocaleDateString('en-GB')}
                  </small>
                </div>
                <span className={`admin-citizen-status ${citizen.verificationStatus.toLowerCase()}`}>
                  {verificationLabels[citizen.verificationStatus] || citizen.verificationStatus}
                </span>
              </header>
              <dl>
                <div>
                  <dt>الهاتف</dt>
                  <dd>{citizen.phoneMasked}</dd>
                </div>
                <div>
                  <dt>الهوية</dt>
                  <dd>{citizen.nationalIdMasked}</dd>
                </div>
                <div>
                  <dt>المستند</dt>
                  <dd>
                    {citizen.documentType ? documentLabels[citizen.documentType] || citizen.documentType : 'غير محدد'}
                  </dd>
                </div>
                <div>
                  <dt>المنطقة</dt>
                  <dd>{citizen.district}</dd>
                </div>
              </dl>
              <footer>
                <span>
                  <FileText /> {citizen.applicationCount.toLocaleString('en-US')} معاملة محلية
                </span>
                <span>
                  <CalendarDays /> {citizen.serviceRequestCount.toLocaleString('en-US')} طلب خدمة أو موعد
                </span>
                <time>آخر نشاط: {new Date(citizen.lastActivityAt).toLocaleString('en-GB')}</time>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <div className="admin-citizens-empty">
          <UsersRound />
          <h3>لا توجد نتائج مطابقة</h3>
          <p>غيّر كلمة البحث أو أزل أحد الفلاتر لعرض حسابات أخرى.</p>
        </div>
      )}
    </section>
  )
}
