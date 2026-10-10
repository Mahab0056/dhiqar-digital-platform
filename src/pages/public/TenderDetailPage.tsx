import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { ArrowRight, ExternalLink, FileText, Gavel, Megaphone } from 'lucide-react'
import { api } from '../../api'
import type { Tender } from '../../types'
import { PublicHeader } from '../../components/public/PublicHeader'
import { Footer } from '../../components/public/Footer'
import { EmptyState, LoadingBlock, PageHeader } from '../../components/public/PageHeader'
import { TenderStatusChip } from '../../components/news/NewsParts'
import { closingLabel, formatDate, formatIqd, TENDER_STATUS, TENDER_TYPE } from '../../lib/news-format'

export function TenderDetailPage({ id }: { id: string }) {
  const [tender, setTender] = useState<Tender | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    api
      .getTender(id)
      .then(value => alive && setTender(value))
      .catch(err => alive && setError((err as Error).message))
    return () => {
      alive = false
    }
  }, [id])

  useEffect(() => {
    if (tender) document.title = `${tender.title} — المناقصات والمزادات | ذي قار الرقمية`
  }, [tender])

  const crumbs = [{ label: 'المناقصات والمزادات', href: '/tenders' }, { label: tender?.reference || 'الإعلان' }]

  return (
    <div className="tq-page nwp">
      <PublicHeader />
      <main id="main-content">
        {error ? (
          <section className="tq-content">
            <div className="tq-container">
              <EmptyState
                title="الإعلان غير متاح"
                text={error}
                action={
                  <Link href="/tenders" className="button primary">
                    كل المناقصات
                  </Link>
                }
              />
            </div>
          </section>
        ) : !tender ? (
          <section className="tq-content">
            <div className="tq-container">
              <LoadingBlock label="جارٍ تحميل الإعلان…" />
            </div>
          </section>
        ) : (
          <>
            <PageHeader
              crumbs={crumbs}
              kicker={
                <>
                  {tender.type === 'AUCTION' ? <Gavel size={15} /> : <Megaphone size={15} />} إعلان{' '}
                  {TENDER_TYPE[tender.type].label}
                </>
              }
              title={tender.title}
              description={`${tender.entityName}${tender.district ? ` · ${tender.district}` : ''}`}
              meta={<TenderStatusChip tender={tender} />}
            />
            <section className="tq-content">
              <div className="tq-container nwp-detail">
                <div className="nwp-detail-main">
                  <div className="nwp-box">
                    <dl className="nwp-facts">
                      <div>
                        <dt>رقم الإعلان</dt>
                        <dd dir="auto">{tender.reference}</dd>
                      </div>
                      <div>
                        <dt>النوع</dt>
                        <dd>{TENDER_TYPE[tender.type].label}</dd>
                      </div>
                      <div>
                        <dt>الجهة المعلنة</dt>
                        <dd>
                          {tender.departmentId ? (
                            <Link href={`/departments/${tender.departmentId}`}>{tender.entityName}</Link>
                          ) : (
                            tender.entityName
                          )}
                        </dd>
                      </div>
                      {tender.district && (
                        <div>
                          <dt>القضاء</dt>
                          <dd>{tender.district}</dd>
                        </div>
                      )}
                      <div>
                        <dt>تاريخ النشر</dt>
                        <dd>{formatDate(tender.publishedAt)}</dd>
                      </div>
                      <div>
                        <dt>موعد الغلق</dt>
                        <dd>{formatDate(tender.closingAt, true)}</dd>
                      </div>
                      {tender.estimatedCostIqd !== null && (
                        <div>
                          <dt>الكلفة التخمينية</dt>
                          <dd>{formatIqd(tender.estimatedCostIqd)}</dd>
                        </div>
                      )}
                      {tender.bidBond && (
                        <div>
                          <dt>التأمينات الأولية</dt>
                          <dd>{tender.bidBond}</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                  {tender.description && (
                    <div className="nwp-box">
                      <h2>تفاصيل الإعلان</h2>
                      <p>{tender.description}</p>
                    </div>
                  )}
                  {tender.stateNote && tender.status !== 'OPEN' && (
                    <div className="nwp-box">
                      <h2>ملاحظة الجهة ({TENDER_STATUS[tender.status].label})</h2>
                      <p>{tender.stateNote}</p>
                    </div>
                  )}
                </div>
                <aside className="nwp-actions" aria-label="الموعد والوثائق">
                  <div className={tender.status === 'OPEN' ? 'nwp-countdown' : 'nwp-countdown is-ended'}>
                    <small>{tender.status === 'OPEN' ? 'الوقت المتبقي' : 'الحالة'}</small>
                    <strong>
                      {tender.status === 'OPEN' ? closingLabel(tender.closingAt) : TENDER_STATUS[tender.status].label}
                    </strong>
                    <small>الغلق: {formatDate(tender.closingAt, true)}</small>
                  </div>
                  {tender.documentUrl && (
                    <a className="button primary full" href={tender.documentUrl} target="_blank" rel="noopener noreferrer">
                      <FileText aria-hidden="true" /> وثائق الإعلان
                    </a>
                  )}
                  {tender.sourceUrl && (
                    <a className="button outline full" href={tender.sourceUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink aria-hidden="true" /> المصدر الرسمي
                    </a>
                  )}
                  <Link href="/tenders" className="button ghost full">
                    <ArrowRight aria-hidden="true" /> كل المناقصات والمزادات
                  </Link>
                  <p className="nwp-note">
                    تُقدَّم العطاءات وفق شروط الجهة المعلنة ووثائقها. راجع الدائرة المعنية لأي استفسار قبل موعد الغلق.
                  </p>
                </aside>
              </div>
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}
