import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { AlertTriangle, ArrowLeft, BadgeCheck, Camera, LockKeyhole, QrCode, ShieldCheck } from 'lucide-react'
import { Footer } from '../../components/public/Footer'
import { PageHeader } from '../../components/public/PageHeader'
import { PublicHeader } from '../../components/public/PublicHeader'

export function VerifyScanner() {
  const [, navigate] = useLocation()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const [value, setValue] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [error, setError] = useState('')

  const parseAndOpen = (raw: string) => {
    const normalized = raw.trim()
    const identifier = normalized.includes('/verify/') ? normalized.split('/verify/').pop() || '' : normalized
    if (!identifier) return setError('أدخل معرّف التحقق أو امسح رمز QR صالحاً.')
    navigate(`/verify/${encodeURIComponent(identifier)}`)
  }
  const stopCamera = () => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    setCameraOpen(false)
  }
  useEffect(() => () => stopCamera(), [])
  const startScanner = async () => {
    setError('')
    const Detector = (
      window as unknown as {
        BarcodeDetector?: new (options: { formats: string[] }) => {
          detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>
        }
      }
    ).BarcodeDetector
    if (!Detector)
      return setError(
        'المسح المباشر غير مدعوم في هذا المتصفح. استخدم كاميرا الجهاز لفتح الرابط أو أدخل معرّف الوثيقة يدوياً.'
      )
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream
      setCameraOpen(true)
      window.setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream
      }, 0)
      const detector = new Detector({ formats: ['qr_code'] })
      timerRef.current = window.setInterval(async () => {
        if (!videoRef.current) return
        const codes = await detector.detect(videoRef.current).catch(() => [])
        if (codes[0]?.rawValue) {
          stopCamera()
          parseAndOpen(codes[0].rawValue)
        }
      }, 600)
    } catch {
      setError('تعذر فتح كاميرا الهاتف. امنح إذن الكاميرا أو أدخل معرّف الوثيقة يدوياً.')
    }
  }
  return (
    <div className="tq-page">
      <PublicHeader />
      <main id="main-content">
        <PageHeader
          compact
          crumbs={[{ label: 'التحقق من وثيقة' }]}
          kicker={
            <>
              <QrCode size={15} /> تحقق من وثيقة صادرة
            </>
          }
          title="امسح رمز QR أو أدخل معرّف الوثيقة"
          description="يُقرأ الرمز على جهازك ثم يُعرض سجل التحقق العام بالحد الأدنى من بيانات الوثيقة؛ لا تُرسل صورة الرمز إلى الخادم."
        />
        <section className="tq-content">
          <div className="tq-container verify-wrap is-start">
            <div className="tq-panel verify-card">
              {cameraOpen && (
                <div className="verify-camera">
                  <video ref={videoRef} autoPlay playsInline muted />
                  <span className="verify-camera-frame" aria-hidden="true" />
                  <button type="button" className="button outline small" onClick={stopCamera}>
                    إيقاف الكاميرا
                  </button>
                </div>
              )}
              <button type="button" className="button primary full verify-scan" onClick={startScanner}>
                <Camera /> مسح الرمز بالكاميرا
              </button>
              <div className="verify-divider">
                <span>أو أدخل المعرّف يدوياً</span>
              </div>
              <form
                className="verify-manual"
                onSubmit={event => {
                  event.preventDefault()
                  parseAndOpen(value)
                }}
              >
                <label className="tq-field">
                  <span>معرّف التحقق أو رابط QR</span>
                  <input
                    value={value}
                    onChange={event => setValue(event.target.value)}
                    placeholder="TQD-..."
                    autoComplete="off"
                    dir="ltr"
                  />
                </label>
                <button type="submit" className="button outline">
                  تحقق الآن <ArrowLeft />
                </button>
              </form>
              {error && (
                <div className="form-error" role="alert">
                  <AlertTriangle /> {error}
                </div>
              )}
            </div>
            <ul className="verify-facts">
              <li>
                <ShieldCheck aria-hidden="true" /> كل وثيقة تصدرها المنصة تحمل معرّفاً ورمز QR فريداً.
              </li>
              <li>
                <LockKeyhole aria-hidden="true" /> تُعرض بيانات الحد الأدنى فقط حفاظاً على خصوصية صاحب الوثيقة.
              </li>
              <li>
                <BadgeCheck aria-hidden="true" /> الوثيقة الملغاة تظهر بوضوح على أنها غير نافذة.
              </li>
            </ul>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
