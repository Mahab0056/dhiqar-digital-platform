import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { AlertTriangle, ArrowRight, BadgeCheck, Check, Clock3, Headphones, QrCode, RefreshCw, Send } from 'lucide-react'
import { api } from '../../api'
import { formatIQD, statusLabels } from '../../data'
import type { GovernmentApplication, IssuedDocument } from '../../types'
import { SecureCameraCapture } from '../../components/camera/SecureCameraCapture'
import { CitizenPdfActions } from '../../components/citizen/CitizenPdfActions'
import { PortalLayout } from '../../components/citizen/PortalLayout'

export function ApplicationPage({ reference }: { reference: string }) {
  const [app, setApp] = useState<GovernmentApplication | null>(null)
  const [busy, setBusy] = useState(false)
  const [missingDocument, setMissingDocument] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [archivedDocument, setArchivedDocument] = useState<IssuedDocument | null>(null)
  const refresh = () => api.getApplication(reference).then(setApp)
  useEffect(() => {
    void api.getApplication(reference).then(setApp)
  }, [reference])
  useEffect(() => {
    if (app?.status !== 'APPROVED') {
      setArchivedDocument(null)
      return
    }
    void api
      .listIssuedDocuments()
      .then(items => setArchivedDocument(items.find(item => item.applicationReference === app.reference) || null))
      .catch(() => setArchivedDocument(null))
  }, [app?.reference, app?.status])
  const upload = async () => {
    if (!app || !missingDocument) return setUploadError('صوّر أو اختر المرفق المطلوب قبل الإرسال.')
    setBusy(true)
    setUploadError('')
    try {
      const purpose = app.requiredDocument === 'فيديو توثيق الوجه القصير' ? 'FACE_VIDEO' : 'APPLICATION_DOCUMENT'
      await api.uploadMissingDocument(
        app.reference,
        app.requiredDocument || 'المستند المطلوب',
        missingDocument,
        purpose
      )
      setMissingDocument(null)
      await refresh()
    } catch (error) {
      setUploadError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (!app)
    return (
      <PortalLayout>
        <div className="loading-state">
          <RefreshCw className="spin" /> جاري تحميل المعاملة...
        </div>
      </PortalLayout>
    )
  const faceVerificationRequired = app.requiredDocument === 'فيديو توثيق الوجه القصير'
  return (
    <PortalLayout>
      <div className="application-detail-header">
        <Link href="/citizen">
          <ArrowRight /> معاملاتي
        </Link>
        <div>
          <div>
            <span className={`status ${app.status.toLowerCase()}`}>{statusLabels[app.status]}</span>
            <span>{app.reference}</span>
          </div>
          <h1>{app.serviceName}</h1>
          <p>
            {app.department} • تم التقديم {new Date(app.createdAt).toLocaleDateString('en-GB')}
          </p>
        </div>
      </div>
      <section
        className={
          app.status === 'ACTION_REQUIRED'
            ? 'current-action warning'
            : app.status === 'APPROVED'
              ? 'current-action success'
              : app.status === 'REJECTED'
                ? 'current-action rejected'
                : 'current-action'
        }
      >
        <span>
          {app.status === 'ACTION_REQUIRED' || app.status === 'REJECTED' ? (
            <AlertTriangle />
          ) : app.status === 'APPROVED' ? (
            <BadgeCheck />
          ) : (
            <Clock3 />
          )}
        </span>
        <div>
          <small>{app.status === 'REJECTED' ? 'قرار الدائرة' : 'المطلوب منك الآن'}</small>
          <strong>{app.status === 'REJECTED' ? 'تم رفض المعاملة' : app.currentAction}</strong>
          {app.status === 'REJECTED' && (
            <p className="rejection-reason">
              السبب: {app.rejectionReason}
              {app.decidedAt ? ` — بتاريخ ${new Date(app.decidedAt).toLocaleDateString('en-GB')}` : ''}. يمكنك تقديم طلب
              جديد بعد معالجة السبب.
            </p>
          )}
        </div>
      </section>
      {app.status === 'ACTION_REQUIRED' && (
        <section className="missing-document-capture">
          <div>
            <span className="section-kicker">استكمال مطلوب</span>
            <h2>{app.requiredDocument}</h2>
            <p>
              {faceVerificationRequired
                ? 'افتح الكاميرا الأمامية وسجّل فيديو الوجه لمدة 7 ثوانٍ. تظهر التعليمات والعدّ التنازلي داخل شاشة التصوير، ثم يُرسل الفيديو مشفراً إلى الموظف.'
                : 'افتح كاميرا الهاتف وصوّر المستند كاملاً، أو ارفع صورة / PDF واضحاً. لا تُعاد المعاملة للموظف إلا بعد رفع ملف فعلي.'}
            </p>
          </div>
          {uploadError && (
            <div className="form-error">
              <AlertTriangle /> {uploadError}
            </div>
          )}
          <SecureCameraCapture
            title={app.requiredDocument || 'المستند المطلوب'}
            guidance={
              faceVerificationRequired
                ? 'انظر إلى الكاميرا واتبع التعليمات داخل الشاشة حتى يكتمل التسجيل.'
                : 'تأكد أن كامل المستند واضح وقابل للقراءة قبل الإرسال.'
            }
            mode={faceVerificationRequired ? 'video' : 'photo'}
            facingMode={faceVerificationRequired ? 'user' : 'environment'}
            allowPdf={!faceVerificationRequired}
            file={missingDocument}
            onChange={file => {
              setMissingDocument(file)
              setUploadError('')
            }}
          />
          <button className="button primary" onClick={upload} disabled={busy || !missingDocument}>
            {busy ? 'جاري الإرسال...' : faceVerificationRequired ? 'إرسال فيديو الوجه للموظف' : 'إرسال المستند للموظف'}{' '}
            <Send />
          </button>
        </section>
      )}
      <div className="application-detail-grid">
        <section className="timeline-card">
          <h2>رحلة المعاملة</h2>
          <div className="timeline">
            {app.events.map((event, index) => (
              <div className="timeline-item" key={event.id}>
                <span className="timeline-dot">
                  {index === 0 || index === app.events.length - 1 ? <Check /> : index + 1}
                </span>
                <div>
                  <div>
                    <strong>{event.title}</strong>
                    <time>{new Date(event.createdAt).toLocaleString('en-GB')}</time>
                  </div>
                  <p>{event.description}</p>
                  <small>{event.actor}</small>
                </div>
              </div>
            ))}
          </div>
        </section>
        <aside className="detail-aside">
          <div>
            <h3>بيانات الطلب</h3>
            <span>
              <small>اسم المحل</small>
              <strong>{app.businessName}</strong>
            </span>
            <span>
              <small>النشاط</small>
              <strong>{app.activityType}</strong>
            </span>
            <span>
              <small>العنوان</small>
              <strong>{app.address}</strong>
            </span>
            <span>
              <small>الرسم</small>
              <strong>
                {formatIQD(app.fee)} — {app.paymentStatus === 'PAID' ? 'مدفوع' : 'بانتظار الموافقة'}
              </strong>
            </span>
          </div>
          <div className="support-card">
            <Headphones />
            <strong>تحتاج مساعدة؟</strong>
            <p>تواصل مع مركز دعم المواطنين مع ذكر رقم المعاملة.</p>
            <button>اتصل بالدعم</button>
          </div>
        </aside>
      </div>
      {app.status === 'APPROVED' && (
        <section className="issued-document-section">
          <div className="issued-document-heading">
            <div>
              <span className="section-kicker">الوثيقة النهائية</span>
              <h2>تم إصدار إجازة المحل</h2>
              <p>وثيقة رقمية محفوظة في الأرشيف. اختر معاينة لفتحها الآن أو تنزيل لحفظ نسخة PDF على جهازك.</p>
            </div>
            {archivedDocument ? (
              <CitizenPdfActions document={archivedDocument} />
            ) : (
              <span className="document-archiving-state">
                <RefreshCw className="spin" /> جاري تجهيز الأرشيف
              </span>
            )}
          </div>
          <div className="official-document">
            <div className="document-watermark">DIGITAL</div>
            <div className="document-header">
              <img src="/brand/dhiqar-unified-logo.png" />
              <div>
                <strong>جمهورية العراق</strong>
                <span>محافظة ذي قار — بلدية الناصرية</span>
                <b>تتطلب هذه الوثيقة اعتماد الجهة المختصة لتُعد نافذة خارج المنصة</b>
              </div>
              <div className="doc-number">
                <small>رقم الوثيقة</small>
                <strong>{app.documentNumber}</strong>
              </div>
            </div>
            <hr />
            <h2>إجازة ممارسة نشاط تجاري</h2>
            <p>
              تسجل منصة ذي قار الرقمية اكتمال مسار المعاملة المبين أدناه وإصدار نسخة رقمية قابلة للتحقق داخل المنصة.
            </p>
            <div className="document-data">
              <span>
                <small>اسم صاحب الطلب</small>
                <strong>{app.citizenName}</strong>
              </span>
              <span>
                <small>اسم المحل</small>
                <strong>{app.businessName}</strong>
              </span>
              <span>
                <small>نوع النشاط</small>
                <strong>{app.activityType}</strong>
              </span>
              <span>
                <small>العنوان</small>
                <strong>{app.address}</strong>
              </span>
              <span>
                <small>رقم المعاملة</small>
                <strong>{app.reference}</strong>
              </span>
              <span>
                <small>تاريخ الإصدار</small>
                <strong>{new Date(app.issuedAt || app.updatedAt).toLocaleDateString('en-GB')}</strong>
              </span>
            </div>
            <div className="document-footer">
              <div>
                <strong>مدير البلدية</strong>
                <span>توقيع إلكتروني قيد اعتماد الجهة</span>
              </div>
              <Link className="verification-box" href={`/verify/${app.verificationId}`}>
                <QrCode />
                <span>
                  <b>تحقق من الوثيقة</b>
                  <small>{app.verificationId}</small>
                </span>
              </Link>
            </div>
          </div>
        </section>
      )}
    </PortalLayout>
  )
}
