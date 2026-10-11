import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { AlertTriangle, BadgeCheck, ChevronLeft, Clock3, Download, FileSearch, QrCode, ShieldAlert } from 'lucide-react'
import { Footer } from '../../components/public/Footer'
import { EmptyState, LoadingBlock } from '../../components/public/PageHeader'
import { PublicHeader } from '../../components/public/PublicHeader'
import '../../styles/ds/documents.css'

type VerifyResult = {
  reference: string | null
  citizenName: string
  holderIdLast4?: string | null
  serviceName: string
  department: string
  documentTitle: string
  templateTitle?: string | null
  documentNumber: string | null
  verificationId: string
  status: 'APPROVED' | 'REVOKED'
  validity?: 'VALID' | 'REVOKED' | 'EXPIRED'
  issuedAt?: string
  expiresAt?: string | null
  revokedAt?: string | null
  revokedReason?: string | null
  updatedAt: string
  signatureValid?: boolean
  pdfSha256?: string | null
  originalPdfUrl: string | null
  pdfAvailable: boolean
}

const dateOf = (value?: string | null) => (value ? new Date(value).toLocaleDateString('en-GB') : '—')

async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Result of a scanned/typed verification code. The server validates the code's HMAC against the stored record
 * before answering; only the minimum is shown (masked holder name, last four digits of the national ID).
 */
export function VerifyPage({ verificationId }: { verificationId: string }) {
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [error, setError] = useState<{ title: string; text: string } | null>(null)
  const [hashCheck, setHashCheck] = useState<'idle' | 'checking' | 'match' | 'mismatch'>('idle')
  useEffect(() => {
    setResult(null)
    setError(null)
    fetch(`/api/verify/${encodeURIComponent(verificationId)}`, { credentials: 'include' })
      .then(async response => {
        const payload = (await response.json().catch(() => ({}))) as VerifyResult & { code?: string; message?: string }
        if (response.ok) return setResult(payload)
        setError(
          payload.code === 'INVALID_CODE'
            ? {
                title: 'رمز تحقق غير صالح',
                text: 'الرمز غير موقّع من المنصة أو جرى التلاعب به. لا تعتمد هذه الوثيقة وراجع الجهة المصدرة.',
              }
            : { title: 'تعذر التحقق', text: payload.message || 'لم يتم العثور على وثيقة بهذا الرمز.' }
        )
      })
      .catch(() => setError({ title: 'تعذر التحقق', text: 'تعذر الاتصال بالمنصة. أعد المحاولة.' }))
  }, [verificationId])

  const validity = result?.validity || (result?.status === 'REVOKED' ? 'REVOKED' : 'VALID')
  const tone = validity === 'VALID' ? 'is-valid' : validity === 'EXPIRED' ? 'is-invalid is-expired' : 'is-invalid'
  const checkFile = async (file: File | undefined) => {
    if (!file || !result?.pdfSha256) return
    setHashCheck('checking')
    try {
      setHashCheck((await sha256Hex(file)) === result.pdfSha256 ? 'match' : 'mismatch')
    } catch {
      setHashCheck('mismatch')
    }
  }

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
          {result ? (
            <article className={`verify-result ${tone}`}>
              <header className="verify-result-banner">
                <span className="verify-result-icon">
                  {validity === 'VALID' ? <BadgeCheck /> : validity === 'EXPIRED' ? <Clock3 /> : <AlertTriangle />}
                </span>
                <div>
                  <span>
                    {validity === 'VALID' ? 'وثيقة صحيحة' : validity === 'EXPIRED' ? 'منتهية النفاذ' : 'وثيقة ملغاة'}
                  </span>
                  <h1>
                    {validity === 'VALID'
                      ? 'الوثيقة صحيحة وموقّعة من منصة ذي قار الرقمية'
                      : validity === 'EXPIRED'
                        ? 'صدرت الوثيقة من المنصة لكن مدة نفاذها انتهت'
                        : 'هذه الوثيقة ملغاة ولم تعد نافذة'}
                  </h1>
                </div>
              </header>
              <div className="verify-result-body">
                <p>
                  {validity === 'REVOKED'
                    ? `ألغت الجهة المصدرة هذه الوثيقة${result.revokedAt ? ` بتاريخ ${dateOf(result.revokedAt)}` : ''}${result.revokedReason ? ` — السبب: ${result.revokedReason}` : ''}. لا تعتمد عليها.`
                    : result.signatureValid
                      ? 'تحققت المنصة من التوقيع الرقمي لرمز الوثيقة ومن مطابقته للسجل المحفوظ. قارن البيانات أدناه مع الورقة التي بين يديك.'
                      : 'الوثيقة مسجلة في المنصة (إصدار سابق بلا رمز موقّع). قارن البيانات أدناه مع الورقة.'}
                </p>
                <dl className="verify-data">
                  <div>
                    <dt>نوع الوثيقة</dt>
                    <dd>{result.documentTitle || result.templateTitle || result.serviceName}</dd>
                  </div>
                  <div>
                    <dt>صاحب الوثيقة</dt>
                    <dd>
                      {result.citizenName}
                      {result.holderIdLast4 && (
                        <small className="docs-verify-id" dir="ltr">
                          {' '}
                          ID •••• {result.holderIdLast4}
                        </small>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>الجهة المصدرة</dt>
                    <dd>{result.department}</dd>
                  </div>
                  <div>
                    <dt>رقم الوثيقة</dt>
                    <dd dir="ltr">{result.documentNumber}</dd>
                  </div>
                  <div>
                    <dt>تاريخ الإصدار</dt>
                    <dd>{dateOf(result.issuedAt || result.updatedAt)}</dd>
                  </div>
                  <div>
                    <dt>نافذة لغاية</dt>
                    <dd>{result.expiresAt ? dateOf(result.expiresAt) : 'غير محددة المدة'}</dd>
                  </div>
                  <div>
                    <dt>الحالة</dt>
                    <dd>
                      <span
                        className={`tq-badge ${validity === 'VALID' ? 'is-success' : validity === 'EXPIRED' ? 'is-warning' : 'is-danger'}`}
                      >
                        {validity === 'VALID' ? 'نافذة' : validity === 'EXPIRED' ? 'منتهية النفاذ' : 'ملغاة'}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>رقم المعاملة</dt>
                    <dd dir="ltr">{result.reference}</dd>
                  </div>
                </dl>
                <div className="verify-id">
                  <QrCode aria-hidden="true" />
                  <span>
                    <small>رمز التحقق {result.signatureValid ? '(موقّع رقمياً)' : ''}</small>
                    <code>{result.verificationId}</code>
                  </span>
                </div>
                {result.pdfAvailable && result.originalPdfUrl && (
                  <>
                    <div className="docs-pdf docs-verify-pdf">
                      <iframe
                        src={`${result.originalPdfUrl}#toolbar=0&navpanes=0&view=FitH`}
                        title="النسخة الأصلية المؤرشفة للمقارنة"
                      />
                    </div>
                    <a className="button primary" href={result.originalPdfUrl} target="_blank" rel="noreferrer">
                      <Download /> فتح نسخة PDF الأصلية المؤرشفة
                    </a>
                  </>
                )}
                {result.pdfSha256 && validity !== 'REVOKED' && (
                  <div className="docs-hash">
                    <FileSearch aria-hidden="true" />
                    <div>
                      <label htmlFor="verify-pdf-file">
                        <strong>هل لديك ملف PDF من هذه الوثيقة؟</strong>
                      </label>
                      <small id="verify-pdf-help">
                        اختره هنا لمطابقة بصمته الرقمية (SHA-256) مع الأصل المؤرشف. يُفحص الملف على جهازك ولا يُرفع.
                      </small>
                      <input
                        id="verify-pdf-file"
                        type="file"
                        accept="application/pdf"
                        aria-describedby="verify-pdf-help"
                        onChange={event => void checkFile(event.target.files?.[0])}
                      />
                      <div role="status" aria-live="polite" aria-atomic="true">
                        {hashCheck === 'checking' && <span>جارٍ الحساب…</span>}
                        {hashCheck === 'match' && (
                          <span className="tq-badge is-success">الملف مطابق تماماً للأصل الصادر من المنصة</span>
                        )}
                        {hashCheck === 'mismatch' && (
                          <span className="tq-badge is-danger">
                            <ShieldAlert aria-hidden="true" /> الملف لا يطابق الأصل — قد يكون معدّلاً
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </article>
          ) : error ? (
            <EmptyState
              tone="danger"
              title={error.title}
              text={error.text}
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
            <LoadingBlock label="جاري التحقق من التوقيع الرقمي للوثيقة…" />
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}
