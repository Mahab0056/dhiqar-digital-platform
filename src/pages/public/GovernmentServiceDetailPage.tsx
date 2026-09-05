import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { AlertTriangle, ArrowRight, BadgeCheck, Building2, ExternalLink, RefreshCw } from 'lucide-react'
import { api } from '../../api'
import type { GovernmentServiceDirectoryEntry } from '../../types'
import { Footer } from '../../components/public/Footer'
import { PublicHeader } from '../../components/public/PublicHeader'

export function GovernmentServiceDetailPage({ id }: { id: string }) {
  const [service, setService] = useState<GovernmentServiceDirectoryEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api
      .getGovernmentService(id)
      .then(value => {
        if (active) setService(value)
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
  }, [id])
  if (loading)
    return (
      <div className="public-shell">
        <PublicHeader />
        <main className="section container">
          <div className="loading-state">
            <RefreshCw className="spin" /> جاري تحميل تفاصيل الخدمة...
          </div>
        </main>
        <Footer />
      </div>
    )
  if (error || !service)
    return (
      <div className="public-shell">
        <PublicHeader />
        <main className="section container">
          <div className="directory-empty">
            <AlertTriangle />
            <h1>تعذر فتح الخدمة</h1>
            <p>{error || 'السجل غير متاح.'}</p>
            <Link href="/directory" className="button primary">
              العودة إلى الدليل <ArrowRight />
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    )
  return (
    <div className="public-shell government-service-detail">
      <PublicHeader />
      <main>
        <section className="directory-hero">
          <div className="container">
            <Link href="/directory" className="back-link">
              <ArrowRight /> العودة إلى دليل الخدمات
            </Link>
            <span className="eyebrow">
              <BadgeCheck size={16} />{' '}
              {service.verificationStatus === 'VERIFIED_UR_PORTAL'
                ? 'معلومات موثقة من بوابة أور'
                : 'معلومات موثقة من مصدر حكومي'}
            </span>
            <h1>{service.citizenFriendlyName || service.shortNameAr || service.officialNameAr}</h1>
            <p>{service.description}</p>
            <div className="service-detail-authority">
              <Building2 />{' '}
              <span>
                {service.responsibleMinistry || service.responsibleAuthority || 'الجهة المختصة'}
                {service.responsibleAuthority && service.responsibleMinistry
                  ? ` — ${service.responsibleAuthority}`
                  : ''}
              </span>
            </div>
            {service.externalServiceUrl && (
              <a href={service.externalServiceUrl} target="_blank" rel="noreferrer" className="button primary">
                فتح مسار التقديم الرسمي <ExternalLink />
              </a>
            )}
          </div>
        </section>
        <section className="section container service-detail-grid">
          <article>
            <h2>خطوات المواطن</h2>
            <ol>
              {service.citizenSteps.map(step => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </article>
          <article>
            <h2>المستمسكات المطلوبة</h2>
            {service.requiredDocuments.length ? (
              <ul>
                {service.requiredDocuments.map((item, index) => (
                  <li key={`${item.documentName}-${index}`}>
                    <strong>{item.documentName}</strong>
                    {item.requiredOrOptional !== 'REQUIRED' && (
                      <span> — {item.requiredOrOptional === 'OPTIONAL' ? 'اختياري' : 'بحسب الحالة'}</span>
                    )}
                    {item.appliesWhen && <small>{item.appliesWhen}</small>}
                  </li>
                ))}
              </ul>
            ) : (
              <p>لم تنشر الصفحة المصدر مستمسكات محددة لهذه الخدمة.</p>
            )}
          </article>
          <article>
            <h2>الرسوم والمدة</h2>
            <dl>
              <div>
                <dt>مدة الإنجاز</dt>
                <dd>{service.processingTime || 'غير منشورة في المصدر'}</dd>
              </div>
              <div>
                <dt>الحضور</dt>
                <dd>
                  {service.physicalPresenceRequired
                    ? service.physicalPresenceDetails || 'مطلوب وفق المصدر'
                    : 'غير مطلوب وفق المصدر'}
                </dd>
              </div>
              {service.feeDetails.map((fee, index) => (
                <div key={`${fee.rule}-${index}`}>
                  <dt>{fee.rule}</dt>
                  <dd>
                    {fee.amount === null
                      ? fee.status || 'تحددها الجهة'
                      : `${fee.amount.toLocaleString('en-US')} ${fee.currency || 'IQD'}${fee.status ? ` — ${fee.status}` : ''}`}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
          <article>
            <h2>المصدر والتحقق</h2>
            <p>آخر تحقق: {service.lastVerifiedDate || 'غير محدد'}</p>
            <ul>
              {service.sources.map(source => (
                <li key={source.officialUrl}>
                  <a href={source.officialUrl} target="_blank" rel="noreferrer">
                    {source.authorityName} — {source.pageTitle || 'صفحة الخدمة'} <ExternalLink />
                  </a>
                </li>
              ))}
            </ul>
            <p className="service-detail-note">
              هذه المعلومات للمساعدة في الوصول إلى الخدمة. إجراءات القبول والدفع والإصدار تصدرها الجهة الحكومية المختصة
              حصراً.
            </p>
          </article>
        </section>
      </main>
      <Footer />
    </div>
  )
}
