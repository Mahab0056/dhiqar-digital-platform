import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CircleDollarSign,
  ExternalLink,
  FileText,
  Info,
  ListChecks,
  ShieldCheck,
} from 'lucide-react'
import { api } from '../../api'
import type { GovernmentServiceDirectoryEntry } from '../../types'
import { Footer } from '../../components/public/Footer'
import { PublicHeader } from '../../components/public/PublicHeader'
import { EmptyState, LoadingBlock, PageHeader } from '../../components/public/PageHeader'

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

  if (loading || error || !service)
    return (
      <div className="tq-page">
        <PublicHeader />
        <main id="main-content" className="tq-content">
          <div className="tq-container">
            {loading ? (
              <LoadingBlock label="جاري تحميل تفاصيل الخدمة…" />
            ) : (
              <EmptyState
                tone="danger"
                title="تعذر فتح الخدمة"
                text={error || 'السجل غير متاح.'}
                action={
                  <Link href="/directory" className="button primary">
                    <ArrowRight /> العودة إلى دليل الخدمات
                  </Link>
                }
              />
            )}
          </div>
        </main>
        <Footer />
      </div>
    )

  const title = service.citizenFriendlyName || service.shortNameAr || service.officialNameAr
  const authority =
    (service.responsibleMinistry || service.responsibleAuthority || 'الجهة المختصة') +
    (service.responsibleAuthority && service.responsibleMinistry ? ` — ${service.responsibleAuthority}` : '')

  return (
    <div className="tq-page">
      <PublicHeader />
      <main id="main-content">
        <PageHeader
          crumbs={[{ label: 'دليل الخدمات', href: '/directory' }, { label: title }]}
          kicker={
            <>
              <BadgeCheck size={15} />
              {service.verificationStatus === 'VERIFIED_UR_PORTAL'
                ? 'معلومات موثقة من بوابة أور'
                : 'معلومات موثقة من مصدر حكومي'}
            </>
          }
          title={title}
          description={service.description}
          meta={
            <span>
              <Building2 /> {authority}
            </span>
          }
          actions={
            service.externalServiceUrl ? (
              <a href={service.externalServiceUrl} target="_blank" rel="noreferrer" className="button primary">
                <ExternalLink /> فتح مسار التقديم الرسمي
              </a>
            ) : undefined
          }
        />
        <section className="tq-content">
          <div className="tq-container tq-layout">
            <div className="tq-stack">
              <article className="tq-panel">
                <h2>
                  <ListChecks /> خطوات المواطن
                </h2>
                {service.citizenSteps.length ? (
                  <ol className="tq-steps">
                    {service.citizenSteps.map(step => (
                      <li key={step}>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>لم تنشر الصفحة المصدر خطوات تفصيلية لهذه الخدمة.</p>
                )}
              </article>
              <article className="tq-panel">
                <h2>
                  <FileText /> المستمسكات المطلوبة
                </h2>
                {service.requiredDocuments.length ? (
                  <ul className="tq-doc-list">
                    {service.requiredDocuments.map((item, index) => (
                      <li key={`${item.documentName}-${index}`}>
                        <FileText aria-hidden="true" />
                        <span>
                          <strong>{item.documentName}</strong>
                          {item.appliesWhen && <small>{item.appliesWhen}</small>}
                        </span>
                        {item.requiredOrOptional === 'REQUIRED' ? (
                          <span className="tq-badge is-success">إلزامي</span>
                        ) : (
                          <span className="tq-badge">
                            {item.requiredOrOptional === 'OPTIONAL' ? 'اختياري' : 'بحسب الحالة'}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>لم تنشر الصفحة المصدر مستمسكات محددة لهذه الخدمة.</p>
                )}
              </article>
            </div>
            <aside className="tq-stack tq-sticky">
              <article className="tq-panel">
                <h2>
                  <CircleDollarSign /> الرسوم والمدة
                </h2>
                <dl className="tq-dl">
                  <div>
                    <dt>مدة الإنجاز</dt>
                    <dd>{service.processingTime || 'غير منشورة في المصدر'}</dd>
                  </div>
                  <div>
                    <dt>الحضور الشخصي</dt>
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
                          : `${fee.amount.toLocaleString('en-US')} ${!fee.currency || fee.currency === 'IQD' ? 'د.ع' : fee.currency}${fee.status ? ` — ${fee.status}` : ''}`}
                      </dd>
                    </div>
                  ))}
                </dl>
              </article>
              <article className="tq-panel">
                <h2>
                  <ShieldCheck /> المصدر والتحقق
                </h2>
                <dl className="tq-dl">
                  <div>
                    <dt>آخر تحقق</dt>
                    <dd>{service.lastVerifiedDate || 'غير محدد'}</dd>
                  </div>
                </dl>
                {service.sources.length > 0 && (
                  <ul className="tq-link-list">
                    {service.sources.map(source => (
                      <li key={source.officialUrl}>
                        <a href={source.officialUrl} target="_blank" rel="noreferrer">
                          <ExternalLink aria-hidden="true" />
                          <span>
                            {source.authorityName} — {source.pageTitle || 'صفحة الخدمة'}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
              <p className="tq-note is-info">
                <Info aria-hidden="true" />
                <span>
                  هذه المعلومات للمساعدة في الوصول إلى الخدمة. القبول والدفع والإصدار تتم لدى الجهة الحكومية المختصة
                  حصراً.
                </span>
              </p>
            </aside>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
