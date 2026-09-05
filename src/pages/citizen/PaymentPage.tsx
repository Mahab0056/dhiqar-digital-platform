import { useEffect, useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Building2,
  CheckCircle2,
  CreditCard,
  FlaskConical,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { api } from '../../api'
import type { PaymentConfig, PaymentIntent } from '../../types'
import { PortalLayout } from '../../components/citizen/PortalLayout'

const modeLabel: Record<string, string> = {
  SANDBOX: 'وضع تجريبي — لا يُخصم أي مبلغ',
  TEST: 'بيئة اختبار البوابة — لا يُخصم مبلغ حقيقي',
  LIVE: 'دفع حقيقي عبر البوابة المعتمدة',
}

export function PaymentPage({ reference, sandbox = false }: { reference: string; sandbox?: boolean }) {
  const [, navigate] = useLocation()
  const [intent, setIntent] = useState<PaymentIntent | null | undefined>(undefined)
  const [config, setConfig] = useState<PaymentConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const result = new URLSearchParams(window.location.search).get('result')

  useEffect(() => {
    let active = true
    Promise.all([api.getPayment(reference), api.getPaymentConfig()])
      .then(([payment, paymentConfig]) => {
        if (!active) return
        setIntent(payment)
        setConfig(paymentConfig)
      })
      .catch(err => {
        if (!active) return
        setIntent(null)
        setError((err as Error).message)
      })
    return () => {
      active = false
    }
  }, [reference])

  const startCheckout = async () => {
    setBusy(true)
    setError('')
    try {
      const checkout = await api.startCheckout(reference)
      if (checkout.checkoutUrl.startsWith('/')) navigate(checkout.checkoutUrl)
      else window.location.assign(checkout.checkoutUrl)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const confirmSandbox = async (outcome: 'PAID' | 'FAILED') => {
    setBusy(true)
    setError('')
    try {
      const updated = await api.sandboxConfirmPayment(reference, outcome)
      setIntent(updated)
      navigate(`/citizen/pay/${encodeURIComponent(reference)}?result=${outcome.toLowerCase()}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <PortalLayout>
      <div className="citizen-v2 payment-page">
        {intent === undefined ? (
          <div className="service-loading">
            <RefreshCw className="spin" /> جاري تحميل بيانات الدفع…
          </div>
        ) : !intent ? (
          <div className="citizen-empty">
            <AlertTriangle />
            <div>
              <strong>عملية الدفع غير موجودة</strong>
              <span>{error || 'تأكد من الرابط أو افتح الطلب من حساب المواطن.'}</span>
            </div>
            <Link className="button primary" href="/citizen#my-requests">
              العودة إلى معاملاتي
            </Link>
          </div>
        ) : (
          <section className="payment-card">
            <header className="payment-head">
              <span className="payment-icon">{intent.status === 'PAID' ? <BadgeCheck /> : <CreditCard />}</span>
              <div>
                <span className="section-kicker">
                  {intent.status === 'PAID' ? 'تم السداد' : sandbox ? 'صفحة الدفع التجريبية' : 'سداد رسم الخدمة'}
                </span>
                <h1>{intent.serviceName}</h1>
                <p>
                  <Building2 /> {intent.departmentName}
                  {intent.serviceRequestReference ? ` • الطلب ${intent.serviceRequestReference}` : ''}
                </p>
              </div>
            </header>

            <dl className="payment-summary">
              <div>
                <dt>رقم عملية الدفع</dt>
                <dd>{intent.reference}</dd>
              </div>
              <div>
                <dt>المبلغ</dt>
                <dd className="payment-amount">{intent.amountIqd.toLocaleString('en-US')} د.ع</dd>
              </div>
              <div>
                <dt>البيان</dt>
                <dd>{intent.description}</dd>
              </div>
              {intent.receiptNumber && (
                <div>
                  <dt>رقم الإيصال</dt>
                  <dd>{intent.receiptNumber}</dd>
                </div>
              )}
              {intent.paidAt && (
                <div>
                  <dt>تاريخ السداد</dt>
                  <dd>{new Date(intent.paidAt).toLocaleString('en-GB')}</dd>
                </div>
              )}
            </dl>

            {intent.status === 'PAID' ? (
              <div className="payment-state paid">
                <CheckCircle2 />
                <div>
                  <strong>تم تأكيد الدفع وإحالة الطلب إلى الدائرة</strong>
                  <span>
                    احتفظ برقم الإيصال {intent.receiptNumber}. ستصلك إشعارات المنصة عند بدء التدقيق واتخاذ القرار.
                  </span>
                </div>
                <Link className="button primary" href="/citizen#my-requests">
                  متابعة الطلب <ArrowLeft />
                </Link>
              </div>
            ) : result === 'failed' || intent.status === 'FAILED' ? (
              <div className="payment-state failed">
                <XCircle />
                <div>
                  <strong>لم تكتمل عملية الدفع</strong>
                  <span>لم يُخصم أي مبلغ. يمكنك المحاولة مرة أخرى.</span>
                </div>
              </div>
            ) : null}

            {intent.status !== 'PAID' && (
              <>
                <div className={`payment-mode ${config?.mode?.toLowerCase() || ''}`}>
                  {config?.mode === 'LIVE' ? <ShieldCheck /> : <FlaskConical />}
                  <span>
                    {config?.available
                      ? `${modeLabel[config.mode] || config.mode}${config.provider && config.provider !== 'sandbox' ? ` — ${config.provider === 'zaincash' ? 'ZainCash' : config.provider}` : ''}`
                      : 'بوابة الدفع الإلكتروني غير مفعّلة بعد. راجع الدائرة لسداد الرسم، أو انتظر تفعيل البوابة.'}
                  </span>
                </div>
                {error && (
                  <div className="form-error" role="alert">
                    <AlertTriangle /> {error}
                  </div>
                )}
                {sandbox && config?.provider === 'sandbox' ? (
                  <div className="payment-sandbox">
                    <p>
                      هذه صفحة محاكاة لبوابة الدفع. عند ربط بوابة حقيقية (ZainCash، Qi، FIB…) سيُحوَّل المواطن إلى صفحة
                      البوابة نفسها ثم يعود هنا بالنتيجة.
                    </p>
                    <div className="payment-actions">
                      <button className="button primary" disabled={busy} onClick={() => void confirmSandbox('PAID')}>
                        <CheckCircle2 /> محاكاة دفع ناجح
                      </button>
                      <button className="button outline" disabled={busy} onClick={() => void confirmSandbox('FAILED')}>
                        <XCircle /> محاكاة فشل الدفع
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="payment-actions">
                    <button
                      className="button primary"
                      disabled={busy || !config?.available}
                      onClick={() => void startCheckout()}
                    >
                      <CreditCard /> {busy ? 'جاري التحويل…' : `ادفع ${intent.amountIqd.toLocaleString('en-US')} د.ع`}
                    </button>
                    <Link className="button outline" href="/citizen#my-requests">
                      لاحقاً
                    </Link>
                  </div>
                )}
                <p className="gov-muted payment-note">
                  <ReceiptText /> يصدر إيصال إلكتروني برقم مرجعي فور تأكيد الدفع، ويُحفظ ضمن الطلب ويظهر للدائرة.
                </p>
              </>
            )}
          </section>
        )}
      </div>
    </PortalLayout>
  )
}
