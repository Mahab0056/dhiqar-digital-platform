import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { AlertTriangle, ArrowRight, BadgeCheck, Download, QrCode, RefreshCw } from 'lucide-react'
import { api } from '../../api'
import type { GovernmentApplication } from '../../types'
import { Brand } from '../../components/public/Brand'
import { CivicUtilityBar } from '../../components/public/CivicUtilityBar'

export function VerifyPage({ verificationId }: { verificationId: string }) {
  const [app, setApp] = useState<GovernmentApplication | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api
      .verifyDocument(verificationId)
      .then(setApp)
      .catch(() => setError('لم يتم العثور على وثيقة بهذا المعرّف.'))
  }, [verificationId])
  return (
    <div className="verify-page">
      <CivicUtilityBar />
      <header className="verify-header container">
        <Brand />
        <Link href="/">
          <ArrowRight /> الرئيسية
        </Link>
      </header>
      <main className="container verify-content">
        {app ? (
          <div className="verification-result valid">
            <span className="verification-icon">
              <BadgeCheck />
            </span>
            <span className="section-kicker">DIGITAL DOCUMENT VERIFICATION</span>
            <h1>الوثيقة صحيحة ضمن سجل المنصة</h1>
            <p>
              تم إصدار هذه الوثيقة من سجل ذي قار الرقمية ويمكن التحقق من بياناتها هنا. يبقى نفاذها خارج المنصة مرتبطاً
              باعتماد الجهة المختصة.
            </p>
            <div className="verification-data">
              <span>
                <small>نوع الوثيقة</small>
                <strong>{app.documentTitle || app.serviceName || 'وثيقة معاملة معتمدة'}</strong>
              </span>
              <span>
                <small>رقم الوثيقة</small>
                <strong>{app.documentNumber}</strong>
              </span>
              <span>
                <small>رقم المعاملة</small>
                <strong>{app.reference}</strong>
              </span>
              <span>
                <small>صاحب الوثيقة</small>
                <strong>{app.citizenName}</strong>
              </span>
              <span>
                <small>الحالة</small>
                <strong>فعّالة في سجل المنصة</strong>
              </span>
              <span>
                <small>تاريخ الإصدار</small>
                <strong>{new Date(app.issuedAt || app.updatedAt).toLocaleDateString('en-GB')}</strong>
              </span>
            </div>
            <div className="verification-hash">
              <QrCode />
              <span>
                <small>Verification ID</small>
                <strong>{app.verificationId}</strong>
              </span>
            </div>
            {app.pdfAvailable && app.originalPdfUrl && (
              <a
                className="button primary verification-pdf-link"
                href={app.originalPdfUrl}
                target="_blank"
                rel="noreferrer"
              >
                <Download /> فتح PDF الأصلي المؤرشف
              </a>
            )}
          </div>
        ) : error ? (
          <div className="verification-result invalid">
            <span className="verification-icon">
              <AlertTriangle />
            </span>
            <h1>تعذر التحقق</h1>
            <p>{error}</p>
            <Link className="button primary" href="/">
              العودة للرئيسية
            </Link>
          </div>
        ) : (
          <div className="loading-state">
            <RefreshCw className="spin" /> جاري التحقق من الوثيقة...
          </div>
        )}
      </main>
    </div>
  )
}
