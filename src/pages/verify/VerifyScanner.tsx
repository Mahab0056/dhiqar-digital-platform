import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Camera,
  CameraOff,
  Flashlight,
  FlashlightOff,
  ImageUp,
  Info,
  LockKeyhole,
  QrCode,
  ShieldCheck,
  ZoomIn,
} from 'lucide-react'
import { Footer } from '../../components/public/Footer'
import { PageHeader } from '../../components/public/PageHeader'
import { PublicHeader } from '../../components/public/PublicHeader'
import { pickVerificationId, verificationIdFromScan, type ScanHit } from '../../lib/qr-decode'
import { decodeImageFile, PhotoDecodeError, releaseCodeReaders } from '../../lib/qr-decode-browser'
import {
  cameraErrorCode,
  startCameraScan,
  type CameraErrorCode,
  type CameraFeatures,
  type CameraScanSession,
} from '../../lib/qr-decode-camera'
import './verify-scanner.css'

type CameraState = 'off' | 'starting' | 'loading-reader' | 'scanning'

const CAMERA_ERRORS: Record<Exclude<CameraErrorCode, 'cancelled'>, string> = {
  insecure:
    'تحتاج الكاميرا إلى اتصال آمن (https). افتح الصفحة من رابط المنصة الرسمي، أو ارفع صورة للرمز، أو أدخل الرمز يدوياً.',
  unsupported:
    'هذا المتصفح لا يتيح فتح الكاميرا من الصفحة (وهذا شائع داخل تطبيقات مثل فيسبوك وإنستغرام). افتح الصفحة في Safari أو Chrome، أو ارفع صورة للرمز، أو أدخل الرمز يدوياً.',
  denied:
    'رُفض إذن الكاميرا. اسمح للموقع باستخدام الكاميرا من إعدادات المتصفح (رمز القفل بجانب العنوان) ثم أعد المحاولة، أو ارفع صورة للرمز.',
  'not-found': 'لم نعثر على كاميرا في هذا الجهاز. ارفع صورة للرمز، أو أدخل الرمز المطبوع تحت الباركود يدوياً.',
  busy: 'الكاميرا مستخدمة من تطبيق آخر أو تعذر تشغيلها. أغلق التطبيقات التي تستخدمها (مكالمة فيديو، واتساب…) ثم أعد المحاولة.',
  reader: 'تعذر تحميل قارئ الرموز. تحقق من اتصال الإنترنت ثم أعد المحاولة، أو أدخل الرمز المطبوع تحت الباركود يدوياً.',
  unknown: 'تعذر تشغيل الكاميرا. أعد المحاولة، أو ارفع صورة للرمز، أو أدخل الرمز يدوياً.',
}

const PHOTO_ERRORS: Record<PhotoDecodeError['code'], string> = {
  'not-image': 'الملف المختار ليس صورة. اختر صورة (JPG أو PNG) يظهر فيها رمز QR أو الباركود.',
  unreadable: 'تعذر فتح الصورة. اختر صورة بصيغة JPG أو PNG، أو التقط صورة جديدة للرمز.',
  'too-large': 'الصورة كبيرة جداً. التقط صورة أقرب للرمز أو اختر صورة أصغر حجماً.',
}

const FOREIGN_CODE =
  'قُرئ رمز لا يخص وثائق منصة ذي قار الرقمية. وجّه الكاميرا إلى رمز QR أو الباركود المطبوع أسفل الوثيقة.'
const SLOW_SCAN_HINT =
  'لم يُقرأ الرمز بعد؟ اجعل الرمز داخل الإطار وقرّب الهاتف أو أبعده قليلاً، وشغّل المصباح في الإضاءة الضعيفة، أو التقط صورة للرمز وارفعها.'

const CAMERA_STATUS: Record<Exclude<CameraState, 'off'>, string> = {
  starting: 'جارٍ تشغيل الكاميرا… اسمح للمتصفح باستخدامها إن طُلب منك ذلك.',
  'loading-reader': 'جارٍ تجهيز قارئ الرموز…',
  scanning: 'وجّه الكاميرا نحو رمز QR أو الباركود أسفل الوثيقة وأبقِ الهاتف ثابتاً.',
}

export function VerifyScanner() {
  const [, navigate] = useLocation()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const scanRef = useRef<AbortController | null>(null)
  const sessionRef = useRef<CameraScanSession | null>(null)
  const mountedRef = useRef(true)
  const [value, setValue] = useState('')
  const [camera, setCamera] = useState<CameraState>('off')
  const [features, setFeatures] = useState<CameraFeatures | null>(null)
  const [torchOn, setTorchOn] = useState(false)
  const [zoom, setZoom] = useState<number | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const openVerification = (id: string) => navigate(`/verify/${encodeURIComponent(id)}`)

  /** Releases the camera (idempotent): aborting the scan's signal stops every track. */
  const stopCamera = () => {
    scanRef.current?.abort()
    scanRef.current = null
    sessionRef.current = null
    setCamera('off')
    setFeatures(null)
    setTorchOn(false)
    setZoom(null)
  }

  useEffect(() => {
    mountedRef.current = true
    // a hidden tab or a page being left must not keep the camera (and its indicator light) on
    const release = () => {
      if (!scanRef.current) return
      stopCamera()
      setNotice('أُوقفت الكاميرا عند مغادرة الصفحة. اضغط «مسح الرمز بالكاميرا» للمتابعة.')
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') release()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', release)
    return () => {
      mountedRef.current = false
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', release)
      scanRef.current?.abort()
      scanRef.current = null
      releaseCodeReaders() // the WebAssembly reader's worker and memory
    }
    // mount-only: stopCamera touches nothing but refs and state setters
  }, [])

  useEffect(() => {
    if (camera !== 'scanning') return
    const timer = window.setTimeout(() => setNotice(current => current || SLOW_SCAN_HINT), 12_000)
    return () => window.clearTimeout(timer)
  }, [camera])

  const onHits = (hits: ScanHit[]) => {
    const id = pickVerificationId(hits)
    if (!id) {
      setNotice(FOREIGN_CODE)
      return false
    }
    navigator.vibrate?.(60)
    stopCamera()
    openVerification(id)
    return true
  }

  const startScanner = async () => {
    setError('')
    setNotice('')
    scanRef.current?.abort()
    const video = videoRef.current
    if (!video) return
    const controller = new AbortController()
    scanRef.current = controller
    setCamera('starting')
    setFeatures(null)
    setTorchOn(false)
    setZoom(null)
    try {
      const session = await startCameraScan({
        video,
        signal: controller.signal,
        onHits,
        onStatus: status => {
          if (scanRef.current === controller) setCamera(status)
        },
        onFeatures: next => {
          if (scanRef.current !== controller) return
          setFeatures(next)
          setZoom(current => current ?? next.zoom?.value ?? null)
        },
        onEnded: () => {
          if (scanRef.current !== controller) return
          stopCamera()
          setError('توقفت الكاميرا فجأة (ربما استخدمها تطبيق آخر). اضغط «مسح الرمز بالكاميرا» لإعادة تشغيلها.')
        },
      })
      if (scanRef.current === controller) sessionRef.current = session
      else session.stop()
    } catch (failure) {
      const code = cameraErrorCode(failure)
      if (code === 'cancelled' || scanRef.current !== controller) return
      stopCamera()
      setError(CAMERA_ERRORS[code])
    }
  }

  const toggleTorch = async () => {
    const session = sessionRef.current
    if (!session) return
    const next = !torchOn
    if (await session.setTorch(next)) setTorchOn(next)
    else setNotice('تعذر تشغيل المصباح في هذا الجهاز. استخدم إضاءة الغرفة أو قرّب الوثيقة من مصدر ضوء.')
  }

  const changeZoom = (next: number) => {
    setZoom(next)
    void sessionRef.current?.setZoom(next)
  }

  const decodePhoto = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setNotice('')
    stopCamera()
    setPhotoBusy(true)
    try {
      const hits = await decodeImageFile(file)
      if (!mountedRef.current) return
      const id = pickVerificationId(hits)
      if (id) return openVerification(id)
      setError(
        hits.length
          ? 'الرمز الموجود في الصورة لا يخص وثائق منصة ذي قار الرقمية. صوّر رمز QR أو الباركود المطبوع أسفل الوثيقة.'
          : 'لم نعثر على رمز QR أو باركود واضح في الصورة. التقط صورة أقرب يظهر فيها الرمز كاملاً، بإضاءة جيدة ودون انعكاس أو اهتزاز.'
      )
    } catch (failure) {
      if (!mountedRef.current) return
      setError(failure instanceof PhotoDecodeError ? PHOTO_ERRORS[failure.code] : CAMERA_ERRORS.reader)
    } finally {
      if (mountedRef.current) setPhotoBusy(false)
      if (fileRef.current) fileRef.current.value = '' // the same photo can be picked again
    }
  }

  const submitManual = () => {
    const id = verificationIdFromScan(value)
    if (!id) return setError('أدخل رمز التحقق أو امسح رمز QR صالحاً.')
    openVerification(id)
  }

  const cameraOn = camera !== 'off'
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
          description="رمز الوثائق الرسمية مشفّر وموقّع رقمياً ولا يحمل بيانات شخصية: يُقرأ هنا فقط، ثم تتحقق المنصة من توقيعه وتعرض الحد الأدنى من بيانات الوثيقة. لا تُرسل صورة الرمز إلى الخادم."
        />
        <section className="tq-content">
          <div className="tq-container verify-wrap is-start">
            <div className="tq-panel verify-card">
              <div className="verify-camera vs-camera" hidden={!cameraOn}>
                <div className="vs-camera-view">
                  <video ref={videoRef} autoPlay playsInline muted aria-label="معاينة الكاميرا لمسح الرمز" />
                  <span className="verify-camera-frame vs-camera-frame" aria-hidden="true" />
                  {features?.torch && (
                    <button
                      type="button"
                      className="vs-camera-tool"
                      onClick={() => void toggleTorch()}
                      aria-pressed={torchOn}
                      aria-label={torchOn ? 'إطفاء المصباح' : 'تشغيل المصباح'}
                    >
                      {torchOn ? <FlashlightOff aria-hidden="true" /> : <Flashlight aria-hidden="true" />}
                    </button>
                  )}
                </div>
                {features?.zoom && zoom !== null && (
                  <label className="vs-zoom">
                    <ZoomIn aria-hidden="true" />
                    <span className="sr-only">تقريب الكاميرا</span>
                    <input
                      type="range"
                      min={features.zoom.min}
                      max={features.zoom.max}
                      step={features.zoom.step}
                      value={zoom}
                      onChange={event => changeZoom(Number(event.target.value))}
                      dir="ltr"
                    />
                  </label>
                )}
                <p className="vs-status" role="status" aria-live="polite">
                  {cameraOn ? CAMERA_STATUS[camera] : ''}
                </p>
                <button type="button" className="button outline small" onClick={stopCamera}>
                  <CameraOff aria-hidden="true" /> إيقاف الكاميرا
                </button>
              </div>
              {!cameraOn && (
                <button
                  type="button"
                  className="button primary full verify-scan"
                  onClick={() => void startScanner()}
                  disabled={photoBusy}
                >
                  <Camera /> مسح الرمز بالكاميرا
                </button>
              )}
              <button
                type="button"
                className="button outline full vs-photo"
                onClick={() => fileRef.current?.click()}
                disabled={photoBusy}
                aria-describedby="vs-photo-help"
              >
                <ImageUp /> {photoBusy ? 'جارٍ قراءة الرمز من الصورة…' : 'رفع صورة للرمز'}
              </button>
              <small id="vs-photo-help" className="vs-help">
                التقط صورة واضحة لرمز QR أو الباركود، أو اخترها من معرض الصور. تُقرأ الصورة على جهازك ولا تُرفع.
              </small>
              <input
                ref={fileRef}
                className="sr-only"
                type="file"
                accept="image/*"
                tabIndex={-1}
                aria-hidden="true"
                onChange={event => void decodePhoto(event.target.files?.[0])}
              />
              <div className="verify-divider">
                <span>أو أدخل الرمز يدوياً</span>
              </div>
              <form
                className="verify-manual"
                onSubmit={event => {
                  event.preventDefault()
                  submitManual()
                }}
              >
                <label className="tq-field">
                  <span>رمز التحقق اليدوي (المطبوع تحت الباركود) أو محتوى رمز QR</span>
                  <input
                    value={value}
                    onChange={event => setValue(event.target.value)}
                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
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
              {notice && !error && (
                <p className="vs-notice" role="status">
                  <Info aria-hidden="true" /> {notice}
                </p>
              )}
            </div>
            <ul className="verify-facts">
              <li>
                <ShieldCheck aria-hidden="true" /> كل وثيقة تحمل رمز QR وباركود مشفّرين لا تقرؤهما إلا المنصة، وأي تلاعب
                بهما يُكشف فوراً.
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
