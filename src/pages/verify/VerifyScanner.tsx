import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { AlertTriangle, ArrowLeft, ArrowRight, Camera, QrCode } from 'lucide-react'
import { Brand } from '../../components/public/Brand'
import { CivicUtilityBar } from '../../components/public/CivicUtilityBar'

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
    <div className="verify-page">
      <CivicUtilityBar />
      <header className="verify-header container">
        <Brand />
        <Link href="/">
          <ArrowRight /> الرئيسية
        </Link>
      </header>
      <main className="container scanner-content">
        <section className="scanner-card">
          <span className="scanner-icon">
            <QrCode />
          </span>
          <span className="section-kicker">تحقق من وثيقة صادرة</span>
          <h1>امسح رمز QR أو أدخل المعرّف</h1>
          <p>يفتح المسح سجل التحقق العام ويعرض الحد الأدنى من بيانات الوثيقة. لا ترفع صورة QR إلى خادم المنصة.</p>
          {cameraOpen && (
            <div className="scanner-camera">
              <video ref={videoRef} autoPlay playsInline muted />
              <button className="button ghost" onClick={stopCamera}>
                إيقاف الكاميرا
              </button>
            </div>
          )}
          <div className="scanner-actions">
            <button className="button primary" onClick={startScanner}>
              <Camera /> مسح بالكاميرا
            </button>
            <div className="scanner-divider">
              <span>أو</span>
            </div>
            <label>
              معرّف التحقق أو رابط QR
              <input
                value={value}
                onChange={event => setValue(event.target.value)}
                placeholder="TQD-..."
                autoComplete="off"
              />
            </label>
            <button className="button outline" onClick={() => parseAndOpen(value)}>
              تحقق الآن <ArrowLeft />
            </button>
          </div>
          {error && (
            <div className="form-error">
              <AlertTriangle /> {error}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
