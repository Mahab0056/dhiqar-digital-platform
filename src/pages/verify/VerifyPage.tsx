import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { AlertTriangle, BadgeCheck, ChevronLeft, Download, QrCode } from 'lucide-react'
import { api } from '../../api'
import type { GovernmentApplication } from '../../types'
import { Footer } from '../../components/public/Footer'
import { EmptyState, LoadingBlock } from '../../components/public/PageHeader'
import { PublicHeader } from '../../components/public/PublicHeader'

export function VerifyPage({ verificationId }: { verificationId: string }) {
  const [app, setApp] = useState<GovernmentApplication | null>(null)
  const [error, setError] = useState('')
  const revoked = (app?.status as string | undefined) === 'REVOKED'
  useEffect(() => {
    api
      .verifyDocument(verificationId)
      .then(setApp)
      .catch(() => setError('لم يتم العثور على وثيقة بهذا المعرّف.'))
  }, [verificationId])
  return (
    <div className="tq-page">
      <PublicHeader />
      <main id="main-content" className="tq-content">
        <div className="tq-container verify-wrap">
          <nav className="tq-breadcrumb" aria-label="مسار التنقل">
            <ol>
              <li>
                <Link href="/">الرئيسية</Link>
              </li>
              <li>
                <ChevronLeft aria-hidden="true" />
                <Link href="/verify">التحقق من وثيقة</Link>
              </li>
              <li>
                <ChevronLeft aria-hidden="true" />
                <span aria-current="page">نتيجة التحقق</span>
              </li>
            </ol>
          </nav>
          {app ? (
            <article className={revoked ? 'verify-result is-invalid' : 'verify-result is-valid'}>
              <header className="verify-result-banner">
                <span className="verify-result-icon">{revoked ? <AlertTriangle /> : <BadgeCheck />}</span>
                <div>
                  <span>{revoked ? 'وثيقة ملغاة' : 'وثيقة صحيحة'}</span>
                  <h1>{revoked ? 'هذه الوثيقة ملغاة ولم تعد نافذة' : 'الوثيقة صحيحة ضمن سجل المنصة'}</h1>
                </div>
              </header>
              <div className="verify-result-body">
                <p>
                  {revoked
                    ? 'أُلغيت هذه الوثيقة من سجل ذي قار الرقمية. لا تعتمد عليها؛ راجع الجهة المصدرة للتأكد.'
                    : 'صدرت هذه الوثيقة من سجل ذي قار الرقمية ويمكن التحقق من بياناتها هنا. يبقى نفاذها خارج المنصة مرتبطاً باعتماد الجهة المختصة.'}
                </p>
                <dl className="verify-data">
                  <div>
                    <dt>نوع الوثيقة</dt>
                    <dd>{app.documentTitle || app.serviceName || 'وثيقة معاملة معتمدة'}</dd>
                  </div>
                  <div>
                    <dt>صاحب الوثيقة</dt>
                    <dd>{app.citizenName}</dd>
                  </div>
                  <div>
                    <dt>رقم الوثيقة</dt>
                    <dd dir="ltr">{app.documentNumber}</dd>
                  </div>
                  <div>
                    <dt>رقم المعاملة</dt>
                    <dd dir="ltr">{app.reference}</dd>
                  </div>
                  <div>
                    <dt>الحالة</dt>
                    <dd>
                      {revoked ? (
                        <span className="tq-badge is-danger">ملغاة</span>
                      ) : (
                        <span className="tq-badge is-success">فعّالة في سجل المنصة</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>تاريخ الإصدار</dt>
                    <dd>{new Date(app.issuedAt || app.updatedAt).toLocaleDateString('en-GB')}</dd>
                  </div>
                </dl>
                <div className="verify-id">
                  <QrCode aria-hidden="true" />
                  <span>
                    <small>معرّف التحقق</small>
                    <code>{app.verificationId}</code>
                  </span>
                </div>
                {app.pdfAvailable && app.originalPdfUrl && (
                  <a className="button primary" href={app.originalPdfUrl} target="_blank" rel="noreferrer">
                    <Download /> فتح نسخة PDF الأصلية المؤرشفة
                  </a>
                )}
              </div>
            </article>
          ) : error ? (
            <EmptyState
              tone="danger"
              title="تعذر التحقق"
              text={error}
              action={
                <div className="tq-page-actions">
                  <Link className="button primary" href="/verify">
                    <QrCode /> تحقق من وثيقة أخرى
                  </Link>
                  <Link className="button outline" href="/">
                    الصفحة الرئيسية
                  </Link>
                </div>
              }
            />
          ) : (
            <LoadingBlock label="جاري التحقق من الوثيقة…" />
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}
