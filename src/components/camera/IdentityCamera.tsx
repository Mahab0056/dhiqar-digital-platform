import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Camera, ScanFace, X } from 'lucide-react'

export type LivenessStep = 'CENTER' | 'LEFT' | 'RIGHT'
export type LivenessTimelineEntry = { step: LivenessStep; startMs: number; endMs: number }

type CardProps = { mode: 'card'; side: 'front' | 'back'; onCapture: (file: File) => void; onClose: () => void }
type FaceProps = {
  mode: 'face'
  challenge: { steps: LivenessStep[]; stepMs: number }
  onCapture: (file: File, timeline: LivenessTimelineEntry[]) => void
  onClose: () => void
}

/** ID-1 card (85.6 × 54 mm) */
const CARD_RATIO = 85.6 / 54

const cameraError = (error: unknown) => {
  if (!window.isSecureContext) return 'تحتاج الكاميرا إلى اتصال آمن. افتح thi-qar.com مباشرة في Chrome أو Safari.'
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError'))
    return 'تم رفض إذن الكاميرا. اسمح للمنصة باستخدام الكاميرا من إعدادات المتصفح ثم أعد المحاولة.'
  if (error instanceof DOMException && error.name === 'NotReadableError')
    return 'الكاميرا مستخدمة من تطبيق آخر. أغلقه ثم أعد المحاولة.'
  return 'تعذر تشغيل الكاميرا. افتح المنصة في Chrome أو Safari على هاتف بكاميرا، واسمح باستخدامها.'
}

/** Full-screen camera for the identity flow: the unified card (auto-capture when sharp) or the face challenge. */
export function IdentityCamera(props: CardProps | FaceProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState(false)

  // the camera owns the whole screen while open
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setError(cameraError(null))
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video:
            props.mode === 'card'
              ? { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
              : { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (cancelled) return stream.getTracks().forEach(track => track.stop())
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        video.muted = true
        video.playsInline = true
        await video.play()
        if (!cancelled) setReady(true)
      } catch (caught) {
        if (!cancelled) setError(cameraError(caught))
      }
    }
    void start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
  }, [props.mode])

  const blink = () => {
    setFlash(true)
    window.setTimeout(() => setFlash(false), 260)
    navigator.vibrate?.(60)
  }

  return createPortal(
    <div className={`idcam idcam-${props.mode}`} role="dialog" aria-modal="true" aria-label="كاميرا التوثيق">
      <video
        ref={videoRef}
        className={props.mode === 'face' ? 'is-mirrored' : ''}
        autoPlay
        playsInline
        muted
        disablePictureInPicture
      />
      {props.mode === 'card' ? (
        <CardOverlay {...props} videoRef={videoRef} ready={ready} onShot={blink} />
      ) : (
        <FaceOverlay {...props} stream={streamRef} ready={ready} onShot={blink} />
      )}
      <button type="button" className="idcam-close" onClick={props.onClose} aria-label="إغلاق الكاميرا">
        <X />
      </button>
      {flash && <div className="idcam-flash" aria-hidden="true" />}
      {error && (
        <div className="idcam-error" role="alert">
          <p>{error}</p>
          <button type="button" className="button light" onClick={props.onClose}>
            رجوع
          </button>
        </div>
      )}
    </div>,
    document.body
  )
}

/* ---------------------------------------------------------------------------------------------
   Card: frame the card, live quality meters, automatic capture once it is sharp, lit and steady
   --------------------------------------------------------------------------------------------- */
type Quality = { light: 'ok' | 'dark' | 'bright'; glare: boolean; sharp: boolean; steady: boolean }

function CardOverlay({
  side,
  onCapture,
  videoRef,
  ready,
  onShot,
}: CardProps & { videoRef: React.RefObject<HTMLVideoElement | null>; ready: boolean; onShot: () => void }) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [quality, setQuality] = useState<Quality | null>(null)
  const [hold, setHold] = useState(0)
  const doneRef = useRef(false)
  const previous = useRef<Uint8ClampedArray | null>(null)

  /** The on-screen frame mapped into the video's own pixels (the preview uses object-fit: cover). */
  const frameInVideo = useCallback(() => {
    const video = videoRef.current
    const frame = frameRef.current
    if (!video || !frame || !video.videoWidth) return null
    const box = video.getBoundingClientRect()
    const rect = frame.getBoundingClientRect()
    const scale = Math.max(box.width / video.videoWidth, box.height / video.videoHeight)
    const offsetX = (box.width - video.videoWidth * scale) / 2
    const offsetY = (box.height - video.videoHeight * scale) / 2
    const x = (rect.left - box.left - offsetX) / scale
    const y = (rect.top - box.top - offsetY) / scale
    return {
      x: Math.max(0, x),
      y: Math.max(0, y),
      w: Math.min(video.videoWidth - Math.max(0, x), rect.width / scale),
      h: Math.min(video.videoHeight - Math.max(0, y), rect.height / scale),
    }
  }, [videoRef])

  const capture = useCallback(() => {
    const video = videoRef.current
    const region = frameInVideo()
    if (!video || !region || doneRef.current) return
    doneRef.current = true
    // a small margin around the frame keeps the card edges in the picture
    const marginX = region.w * 0.06
    const marginY = region.h * 0.08
    const sx = Math.max(0, region.x - marginX)
    const sy = Math.max(0, region.y - marginY)
    const sw = Math.min(video.videoWidth - sx, region.w + marginX * 2)
    const sh = Math.min(video.videoHeight - sy, region.h + marginY * 2)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(sw)
    canvas.height = Math.round(sh)
    canvas.getContext('2d')?.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    onShot()
    canvas.toBlob(
      blob => {
        if (blob) onCapture(new File([blob], `card-${side}-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.92
    )
  }, [frameInVideo, onCapture, onShot, side, videoRef])

  // measure light, glare, sharpness and motion inside the frame a few times a second
  useEffect(() => {
    if (!ready) return
    const canvas = document.createElement('canvas')
    canvas.width = 240
    canvas.height = Math.round(240 / CARD_RATIO)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    let streak = 0
    const timer = window.setInterval(() => {
      const video = videoRef.current
      const region = frameInVideo()
      if (!ctx || !video || !region || doneRef.current) return
      ctx.drawImage(video, region.x, region.y, region.w, region.h, 0, 0, canvas.width, canvas.height)
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const w = canvas.width
      const h = canvas.height
      const gray = new Uint8ClampedArray(w * h)
      let sum = 0
      let glare = 0
      for (let i = 0; i < w * h; i++) {
        const v = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000
        gray[i] = v
        sum += v
        if (v > 248) glare++
      }
      const mean = sum / (w * h)
      // variance of the Laplacian: high when edges and text are crisp
      let lapSum = 0
      let lapSq = 0
      let n = 0
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x
          const lap = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i]
          lapSum += lap
          lapSq += lap * lap
          n++
        }
      const sharpness = lapSq / n - (lapSum / n) ** 2
      let motion = 0
      const hadPrevious = previous.current !== null
      if (previous.current) {
        for (let i = 0; i < gray.length; i += 4) motion += Math.abs(gray[i] - previous.current[i])
        motion /= gray.length / 4
      }
      previous.current = gray
      const next: Quality = {
        light: mean < 70 ? 'dark' : mean > 215 ? 'bright' : 'ok',
        glare: glare / (w * h) > 0.025,
        sharp: sharpness > 120,
        steady: hadPrevious && motion < 7,
      }
      setQuality(next)
      const good = next.light === 'ok' && !next.glare && next.sharp && next.steady
      streak = good ? streak + 1 : 0
      setHold(Math.min(1, streak / 4))
      if (streak >= 4) capture()
    }, 280)
    return () => window.clearInterval(timer)
  }, [ready, capture, frameInVideo, videoRef])

  const hint = !ready
    ? 'جاري تشغيل الكاميرا…'
    : !quality
      ? 'ضع البطاقة داخل الإطار'
      : quality.light === 'dark'
        ? 'الإضاءة ضعيفة — اقترب من مصدر ضوء'
        : quality.light === 'bright'
          ? 'الإضاءة قوية جداً — ابتعد عن الضوء المباشر'
          : quality.glare
            ? 'يوجد انعكاس ضوء — أمِل البطاقة قليلاً'
            : !quality.sharp
              ? 'قرّب الهاتف حتى تتضح الكتابة'
              : !quality.steady
                ? 'ثبّت الهاتف لحظة'
                : 'ممتاز — لا تتحرك'

  return (
    <>
      <div className="idcam-top">
        <span className="idcam-step">{side === 'front' ? '١ / ٢' : '٢ / ٢'}</span>
        <strong>{side === 'front' ? 'وجه البطاقة الوطنية الموحدة' : 'ظهر البطاقة الوطنية الموحدة'}</strong>
        <small>
          {side === 'front'
            ? 'البطاقة الأصلية، والصورة الشخصية ظاهرة بوضوح'
            : 'الأسطر الثلاثة بالحروف الإنگليزية في الأسفل كاملة وواضحة'}
        </small>
      </div>
      <div className="idcam-card-stage">
        <div ref={frameRef} className={`idcam-card-frame${hold >= 1 ? ' is-locked' : hold > 0 ? ' is-good' : ''}`}>
          <i />
          <i />
          <i />
          <i />
          <span className="idcam-scan" aria-hidden="true" />
          {side === 'back' && <span className="idcam-mrz-hint" aria-hidden="true" />}
          {side === 'front' && <span className="idcam-portrait-hint" aria-hidden="true" />}
        </div>
      </div>
      <div className="idcam-bottom">
        <p className="idcam-hint" aria-live="polite">
          {hint}
        </p>
        {quality && (
          <ul className="idcam-meters" aria-hidden="true">
            <li className={quality.light === 'ok' ? 'ok' : ''}>الإضاءة</li>
            <li className={!quality.glare ? 'ok' : ''}>بلا انعكاس</li>
            <li className={quality.sharp ? 'ok' : ''}>الوضوح</li>
            <li className={quality.steady ? 'ok' : ''}>الثبات</li>
          </ul>
        )}
        <button
          type="button"
          className="idcam-shutter"
          onClick={capture}
          disabled={!ready}
          aria-label="التقاط الصورة"
          style={{ '--hold': hold } as React.CSSProperties}
        >
          <Camera />
        </button>
        <small className="idcam-auto">يلتقط الصورة تلقائياً عند الوضوح</small>
      </div>
    </>
  )
}

/* ---------------------------------------------------------------------------------------------
   Face: align, then the server's random head-movement challenge while recording
   --------------------------------------------------------------------------------------------- */
const STEP_COPY: Record<LivenessStep, { title: string; detail: string }> = {
  CENTER: { title: 'انظر مباشرة للكاميرا', detail: 'وجهك في منتصف الإطار' },
  LEFT: { title: 'أدر رأسك لليسار', detail: 'ببطء، حتى يظهر جانب وجهك' },
  RIGHT: { title: 'أدر رأسك لليمين', detail: 'ببطء، حتى يظهر جانب وجهك' },
}

function FaceOverlay({
  challenge,
  onCapture,
  stream,
  ready,
  onShot,
}: FaceProps & { stream: React.RefObject<MediaStream | null>; ready: boolean; onShot: () => void }) {
  const [phase, setPhase] = useState<'align' | 'record' | 'done'>('align')
  const [countdown, setCountdown] = useState(3)
  const [stepIndex, setStepIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!ready || startedRef.current) return
    startedRef.current = true
    let count = 3
    const tick = window.setInterval(() => {
      count -= 1
      setCountdown(count)
      if (count <= 0) {
        window.clearInterval(tick)
        record()
      }
    }, 900)
    return () => window.clearInterval(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  const record = () => {
    const media = stream.current
    if (!media || typeof MediaRecorder === 'undefined') return
    const candidates = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    const mimeType = candidates.find(type => MediaRecorder.isTypeSupported(type))
    const recorder = mimeType ? new MediaRecorder(media, { mimeType }) : new MediaRecorder(media)
    const container = (recorder.mimeType || mimeType || 'video/webm').split(';')[0]
    const chunks: Blob[] = []
    const timeline: LivenessTimelineEntry[] = []
    recorder.ondataavailable = event => event.data.size && chunks.push(event.data)
    recorder.onstop = () => {
      onShot()
      setPhase('done')
      const extension = container.includes('mp4') ? 'mp4' : 'webm'
      onCapture(
        new File([new Blob(chunks, { type: container })], `face-video-7s-${Date.now()}.${extension}`, {
          type: container,
        }),
        timeline
      )
    }
    setPhase('record')
    recorder.start(250)
    const t0 = performance.now()
    const total = challenge.steps.length * challenge.stepMs
    let current = -1
    const frame = () => {
      const elapsed = performance.now() - t0
      const index = Math.min(challenge.steps.length - 1, Math.floor(elapsed / challenge.stepMs))
      if (index !== current) {
        if (current >= 0) timeline[current].endMs = Math.round(elapsed)
        current = index
        timeline.push({ step: challenge.steps[index], startMs: Math.round(elapsed), endMs: Math.round(elapsed) })
        setStepIndex(index)
        navigator.vibrate?.(25)
      }
      setProgress(Math.min(1, elapsed / total))
      if (elapsed < total + 250) requestAnimationFrame(frame)
      else {
        timeline[current].endMs = Math.round(elapsed)
        if (recorder.state === 'recording') recorder.stop()
      }
    }
    requestAnimationFrame(frame)
  }

  const step = challenge.steps[stepIndex]
  const circumference = 2 * Math.PI * 48
  return (
    <>
      <div className="idcam-top">
        <span className="idcam-step">التحقق من الوجه</span>
        <strong>
          {phase === 'align'
            ? ready
              ? 'ضع وجهك داخل الإطار'
              : 'جاري تشغيل الكاميرا…'
            : phase === 'record'
              ? STEP_COPY[step].title
              : 'تم التسجيل'}
        </strong>
        <small>{phase === 'record' ? STEP_COPY[step].detail : 'إضاءة أمامية جيدة، ووجه واحد فقط'}</small>
      </div>
      <div className="idcam-face-stage">
        <div className={`idcam-oval phase-${phase} step-${step?.toLowerCase()}`}>
          <svg viewBox="0 0 100 100" className="idcam-ring" aria-hidden="true">
            <circle cx="50" cy="50" r="48" className="track" />
            <circle
              cx="50"
              cy="50"
              r="48"
              className="fill"
              style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - progress) }}
            />
          </svg>
          {phase === 'align' && ready && <b className="idcam-count">{Math.max(countdown, 1)}</b>}
          {phase === 'record' && step === 'LEFT' && (
            <span className="idcam-arrow is-left" aria-hidden="true">
              <ArrowLeft />
            </span>
          )}
          {phase === 'record' && step === 'RIGHT' && (
            <span className="idcam-arrow is-right" aria-hidden="true">
              <ArrowRight />
            </span>
          )}
          {phase === 'record' && step === 'CENTER' && (
            <span className="idcam-center" aria-hidden="true">
              <ScanFace />
            </span>
          )}
        </div>
        <ol className="idcam-steps" aria-label="الحركات المطلوبة">
          {challenge.steps.map((item, index) => (
            <li
              key={`${item}-${index}`}
              className={
                phase === 'record' && index === stepIndex
                  ? 'is-on'
                  : index < stepIndex || phase === 'done'
                    ? 'is-done'
                    : ''
              }
            >
              {item === 'LEFT' ? 'يسار' : item === 'RIGHT' ? 'يمين' : 'أمام'}
            </li>
          ))}
        </ol>
      </div>
      <div className="idcam-bottom">
        <p className="idcam-hint" aria-live="assertive">
          {phase === 'record'
            ? 'التسجيل جارٍ — تابع الحركات'
            : phase === 'done'
              ? 'جاري التجهيز…'
              : 'يبدأ التسجيل تلقائياً'}
        </p>
      </div>
    </>
  )
}
