import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Camera, Flashlight, FlashlightOff, ScanFace, X } from 'lucide-react'
import {
  ANALYSIS_HEIGHT,
  ANALYSIS_WIDTH,
  TICK_MS,
  acceptPhoto,
  blockThumbnail,
  createCaptureSession,
  expandRegion,
  focusRows,
  frameRegionInVideo,
  measureFrame,
  pickFrame,
  screenPointToVideo,
  stepCapture,
  stillConditions,
  thumbnailCorrelation,
  type CaptureSession,
  type HintKey,
  type Meters,
  type Region,
} from './card-quality'
import {
  createPhotoTaker,
  cropPhoto,
  focusCardAt,
  readCardFeatures,
  setCardTorch,
  tuneCardTrack,
  within,
  type CardCameraFeatures,
  type PhotoTaker,
} from './card-quality-camera'
import { createFrameStore, grabFrame } from './card-frame'

export type LivenessStep = 'CENTER' | 'LEFT' | 'RIGHT'
export type LivenessTimelineEntry = { step: LivenessStep; startMs: number; endMs: number }

type CardProps = { mode: 'card'; side: 'front' | 'back'; onCapture: (file: File) => void; onClose: () => void }
type FaceProps = {
  mode: 'face'
  challenge: { steps: LivenessStep[]; stepMs: number }
  onCapture: (file: File, timeline: LivenessTimelineEntry[]) => void
  onClose: () => void
}

const cameraError = (error: unknown) => {
  if (!window.isSecureContext) return 'تحتاج الكاميرا إلى اتصال آمن. افتح thi-qar.com مباشرة في Chrome أو Safari.'
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError'))
    return 'تم رفض إذن الكاميرا. اسمح للمنصة باستخدام الكاميرا من إعدادات المتصفح ثم أعد المحاولة.'
  if (error instanceof DOMException && error.name === 'NotReadableError')
    return 'الكاميرا مستخدمة من تطبيق آخر. أغلقه ثم أعد المحاولة.'
  return 'تعذر تشغيل الكاميرا. افتح المنصة في Chrome أو Safari على هاتف بكاميرا، واسمح باستخدامها.'
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Tab and Shift+Tab go round the camera's own controls: the page behind it is out of reach while it is open. */
function keepFocusInside(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'Tab') return
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)]
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  const outside = !event.currentTarget.contains(active)
  if (event.shiftKey ? outside || active === first : outside || active === last) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  }
}

/** Full-screen camera for the identity flow: the unified card (auto-capture when sharp) or the face challenge. */
export function IdentityCamera(props: CardProps | FaceProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState(false)
  const onCloseRef = useRef(props.onClose)

  useEffect(() => {
    onCloseRef.current = props.onClose
  }, [props.onClose])

  // the camera owns the whole screen while open; Escape closes it, and focus goes back to whatever opened it (a
  // keyboard or screen-reader user is not left at the top of the page)
  useEffect(() => {
    const previous = document.body.style.overflow
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'
    if (!rootRef.current?.contains(document.activeElement)) closeRef.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
      if (opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true })
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
    <div
      ref={rootRef}
      className={`idcam idcam-${props.mode}`}
      role="dialog"
      aria-modal="true"
      aria-label="كاميرا التوثيق"
      onKeyDown={keepFocusInside}
    >
      <video
        ref={videoRef}
        className={props.mode === 'face' ? 'is-mirrored' : ''}
        autoPlay
        playsInline
        muted
        disablePictureInPicture
      />
      {props.mode === 'card' ? (
        <CardOverlay {...props} videoRef={videoRef} stream={streamRef} ready={ready} onShot={blink} />
      ) : (
        <FaceOverlay {...props} stream={streamRef} ready={ready} onShot={blink} />
      )}
      <button ref={closeRef} type="button" className="idcam-close" onClick={props.onClose} aria-label="إغلاق الكاميرا">
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
   Card: frame the card and it captures by itself within a second or so. Every tick is scored
   (card-quality.ts), the best recent frame is kept, and that frame — not the current one — is
   delivered; the shutter works at any moment and also uses the best recent frame.
   --------------------------------------------------------------------------------------------- */
/** A full-resolution still is started once the ring is half full, so that it lands while the card is held well. */
const STILL_ARM_PROGRESS = 0.5
/** A still started longer ago than this shows a moment too far from the chosen frame; a new one is started. */
const STILL_FRESH_MS = 1500
/** After the decision a still is waited for this long at most; otherwise the chosen video frame goes. */
const STILL_WAIT_MS = 600
/** A best frame ranked this low means nothing usable was measured (too dark, flat): the shutter takes the screen. */
const USELESS_RANK = 0.005
const RING = 2 * Math.PI * 46

type CardView = { hint: HintKey | null; meters: Meters | null; progress: number }
type PhotoSource = 'video' | 'still' | 'shutter'

const sameMeters = (a: Meters | null, b: Meters) =>
  Boolean(a) && a!.light === b.light && a!.glare === b.glare && a!.sharp === b.sharp

function cardHint(
  view: CardView,
  side: 'front' | 'back',
  features: CardCameraFeatures,
  state: { ready: boolean; capturing: boolean }
) {
  if (!state.ready) return 'جاري تشغيل الكاميرا…'
  if (state.capturing) return 'تم الالتقاط'
  switch (view.hint) {
    case 'good':
      return 'ممتاز — ثبّت لحظة'
    case 'dark':
      return features.torch ? 'الإضاءة قليلة — شغّل الفلاش أو قرّبها من ضوء' : 'الإضاءة قليلة — قرّبها من ضوء'
    case 'bright':
      return 'الضوء قوي — أبعدها شوية عن الضوء المباشر'
    case 'glare':
      return 'أمِل البطاقة شوية بسبب الانعكاس'
    case 'closer':
      return side === 'back' ? 'قرّب شوية حتى تتضح الأسطر الإنگليزية' : 'قرّب شوية حتى تتضح الكتابة'
    case 'focus':
      return features.tapFocus
        ? 'المس البطاقة على الشاشة للتركيز، أو بعّد الهاتف قليلاً'
        : 'بعّد الهاتف قليلاً حتى تتضح'
    case 'steady':
      return 'خفّف الحركة شوية'
    default:
      return 'ضع البطاقة داخل الإطار'
  }
}

/** The frame on screen right now (the margin kept), for a press before anything usable was measured. */
function snapshot(video: HTMLVideoElement, outer: Region) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(outer.w))
  canvas.height = Math.max(1, Math.round(outer.h))
  canvas.getContext('2d')?.drawImage(video, outer.x, outer.y, outer.w, outer.h, 0, 0, canvas.width, canvas.height)
  return canvas
}

function CardOverlay({
  side,
  onCapture,
  videoRef,
  stream,
  ready,
  onShot,
}: CardProps & {
  videoRef: React.RefObject<HTMLVideoElement | null>
  stream: React.RefObject<MediaStream | null>
  ready: boolean
  onShot: () => void
}) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const shutterRef = useRef<HTMLButtonElement | null>(null)
  const [view, setView] = useState<CardView>({ hint: null, meters: null, progress: 0 })
  const [capturing, setCapturing] = useState(false)
  const [round, setRound] = useState(0)
  const [features, setFeatures] = useState<CardCameraFeatures>({ torch: false, tapFocus: false })
  const [torchOn, setTorchOn] = useState(false)
  const [focusMark, setFocusMark] = useState<{ x: number; y: number; id: number } | null>(null)
  const doneRef = useRef(false)
  const aliveRef = useRef(true)
  const sessionRef = useRef<CaptureSession>(createCaptureSession(side))
  const storeRef = useRef(createFrameStore(() => document.createElement('canvas')))
  /** sharpness measured on the latest tick (logged with a photo taken from the screen) */
  const lastSharpnessRef = useRef(0)
  const photoTakerRef = useRef<PhotoTaker | null>(null)
  const stillRef = useRef<{ at: number; photo: Promise<Blob | null> } | null>(null)
  const autoFocusAtRef = useRef(0)
  const latest = useRef({ onCapture, onShot })

  useEffect(() => {
    latest.current = { onCapture, onShot }
  }, [onCapture, onShot])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const videoTrack = useCallback(() => stream.current?.getVideoTracks()[0] ?? null, [stream])

  /** The on-screen frame in the video's pixels, and the same with the margin kept in the photo. */
  const regions = useCallback(() => {
    const video = videoRef.current
    const frame = frameRef.current
    if (!video || !frame || !video.videoWidth) return null
    const inner = frameRegionInVideo(
      video.getBoundingClientRect(),
      frame.getBoundingClientRect(),
      video.videoWidth,
      video.videoHeight
    )
    if (!inner) return null
    return {
      inner,
      outer: expandRegion(inner, video.videoWidth, video.videoHeight),
      width: video.videoWidth,
      height: video.videoHeight,
    }
  }, [videoRef])

  /** Starts a full-resolution still while the card is held well, so that it is there by the time of the decision. */
  const armStill = useCallback(() => {
    const taker = photoTakerRef.current
    const now = performance.now()
    if (!taker?.useful() || (stillRef.current && now - stillRef.current.at < STILL_FRESH_MS)) return
    stillRef.current = { at: now, photo: taker.take() }
  }, [])

  const finish = useCallback(
    async (mode: 'auto' | 'manual') => {
      const video = videoRef.current
      const area = regions()
      if (doneRef.current || !video || !area) return
      doneRef.current = true
      setCapturing(true)
      setView(current => ({ ...current, progress: 1 }))
      const decidedAt = performance.now()
      // the best frame of the last moments, exactly as it was scored: a press on the shutter never shakes the photo
      // — unless nothing usable was measured (too dark, a flat surface), then the newest picture is as good as any
      const picked = pickFrame(sessionRef.current.frames, decidedAt)
      const held =
        picked && (mode === 'auto' || picked.rank > USELESS_RANK) ? storeRef.current.get(picked.slot) : undefined
      let canvas = held?.canvas ?? snapshot(video, area.outer)
      let source: PhotoSource = held ? 'video' : 'shutter'
      let sharpness = held?.sharpness ?? lastSharpnessRef.current
      // feedback at the moment of the decision: the flash and the buzz never wait for a full-resolution still
      latest.current.onShot()
      // automatic capture: a full-resolution still is sharper text for the server, when the camera has one ready
      // quickly and it shows the same card at least as well as the chosen frame
      const taker = photoTakerRef.current
      if (mode === 'auto' && held && taker?.useful()) {
        const armed = stillRef.current && decidedAt - stillRef.current.at <= STILL_FRESH_MS ? stillRef.current : null
        const photo = await within(armed?.photo ?? taker.take(), STILL_WAIT_MS, null)
        const still =
          photo && aliveRef.current
            ? await cropPhoto(photo, { width: area.width, height: area.height }, area.inner, area.outer, {
                width: ANALYSIS_WIDTH,
                height: ANALYSIS_HEIGHT,
              })
            : null
        if (still) {
          const measured = measureFrame(still.gray, ANALYSIS_WIDTH, ANALYSIS_HEIGHT, null, focusRows(side))
          const correlation = thumbnailCorrelation(
            blockThumbnail(still.gray, ANALYSIS_WIDTH, ANALYSIS_HEIGHT),
            blockThumbnail(held.gray, ANALYSIS_WIDTH, ANALYSIS_HEIGHT)
          )
          if (
            acceptPhoto({
              correlation,
              photoSharpness: measured.sharpness,
              bufferedSharpness: held.sharpness,
              photoConditions: stillConditions(measured),
              bufferedConditions: held.conditions,
              photoWidth: still.canvas.width,
              bufferedWidth: held.canvas.width,
            })
          ) {
            canvas = still.canvas
            source = 'still'
            sharpness = measured.sharpness
          }
        }
      }
      if (!aliveRef.current) return
      canvas.toBlob(
        blob => {
          if (!aliveRef.current) return
          // the file name tells the server log what the camera measured on the picture it sent
          const name = `card-${side}-${Date.now()}-s${Math.round(sharpness)}-${source}.jpg`
          if (blob) return latest.current.onCapture(new File([blob], name, { type: 'image/jpeg' }))
          // the picture could not be encoded: carry on measuring and let it capture again
          doneRef.current = false
          setCapturing(false)
          setRound(value => value + 1)
        },
        'image/jpeg',
        0.92
      )
    },
    [regions, side, videoRef]
  )

  // camera extras once frames flow: continuous focus/exposure, the torch, tap to focus, full-resolution stills
  useEffect(() => {
    if (!ready) return
    const track = videoTrack()
    if (!track) return
    let cancelled = false
    void tuneCardTrack(track).then(found => {
      if (!cancelled) setFeatures(found)
    })
    // some Android cameras only report the torch once frames are flowing
    const later = window.setTimeout(() => {
      if (!cancelled) setFeatures(readCardFeatures(track))
    }, 900)
    photoTakerRef.current = createPhotoTaker(track)
    shutterRef.current?.focus({ preventScroll: true })
    return () => {
      cancelled = true
      window.clearTimeout(later)
    }
  }, [ready, videoTrack])

  // measure light, reflections and sharpness inside the frame several times a second
  useEffect(() => {
    if (!ready) return
    const canvas = document.createElement('canvas')
    canvas.width = ANALYSIS_WIDTH
    canvas.height = ANALYSIS_HEIGHT
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return
    context.imageSmoothingQuality = 'medium'
    const rows = focusRows(side)
    const analysis = { width: ANALYSIS_WIDTH, height: ANALYSIS_HEIGHT }
    let previous: Uint8ClampedArray | null = null
    let timer = 0
    const tick = () => {
      if (doneRef.current) return
      const started = performance.now()
      const video = videoRef.current
      const area = regions()
      if (video && area && video.readyState >= 2) {
        const store = storeRef.current
        // one picture per tick: the frame that is scored is the frame that is kept
        const gray = grabFrame(video, area, store.scratch(), context, analysis)
        if (gray) {
          const metrics = measureFrame(gray, ANALYSIS_WIDTH, ANALYSIS_HEIGHT, previous, rows)
          const step = stepCapture(sessionRef.current, metrics, performance.now())
          previous = gray
          lastSharpnessRef.current = metrics.sharpness
          sessionRef.current = step.session
          if (step.storeIn !== null)
            store.keep(step.storeIn, { gray, sharpness: metrics.sharpness, conditions: stillConditions(metrics) })
          const progress = Math.round(step.session.progress * 50) / 50
          setView(current =>
            current.hint === step.hint && current.progress === progress && sameMeters(current.meters, step.meters)
              ? current
              : { hint: step.hint, meters: step.meters, progress }
          )
          if (step.session.progress >= STILL_ARM_PROGRESS) armStill()
          if (step.capture) return void finish('auto')
        }
      }
      timer = window.setTimeout(tick, Math.max(40, TICK_MS - (performance.now() - started)))
    }
    timer = window.setTimeout(tick, TICK_MS)
    return () => window.clearTimeout(timer)
  }, [ready, side, regions, finish, armStill, videoRef, round])

  // blurred for a while: nudge the autofocus on the card once (a tap does the same)
  useEffect(() => {
    if (view.hint !== 'focus' || !features.tapFocus) return
    const track = videoTrack()
    const video = videoRef.current
    const frame = frameRef.current
    const now = performance.now()
    if (!track || !video?.videoWidth || !frame || now - autoFocusAtRef.current < 3000) return
    autoFocusAtRef.current = now
    const box = frame.getBoundingClientRect()
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    void focusCardAt(
      track,
      screenPointToVideo(video.getBoundingClientRect(), centre, video.videoWidth, video.videoHeight)
    )
  }, [view.hint, features.tapFocus, videoTrack, videoRef])

  useEffect(() => {
    if (!focusMark) return
    const timer = window.setTimeout(() => setFocusMark(null), 900)
    return () => window.clearTimeout(timer)
  }, [focusMark])

  const tapToFocus = (event: React.MouseEvent) => {
    const track = videoTrack()
    const video = videoRef.current
    if (!features.tapFocus || !track || !video?.videoWidth || capturing) return
    const point = { x: event.clientX, y: event.clientY }
    setFocusMark({ ...point, id: Date.now() })
    autoFocusAtRef.current = performance.now()
    void focusCardAt(
      track,
      screenPointToVideo(video.getBoundingClientRect(), point, video.videoWidth, video.videoHeight)
    )
  }

  const toggleTorch = async () => {
    const track = videoTrack()
    if (!track) return
    const next = !torchOn
    if (await setCardTorch(track, next)) setTorchOn(next)
  }

  const hint = cardHint(view, side, features, { ready, capturing })
  const progress = capturing ? 1 : view.progress
  // the meters keep their place from the start (hidden until measured, and while capturing): the frame above them
  // must not move while the card is being aligned
  const meters = view.meters ?? { light: false, glare: false, sharp: false }
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
      {features.torch && (
        <button
          type="button"
          className={`idcam-torch${torchOn ? ' is-on' : ''}`}
          onClick={() => void toggleTorch()}
          aria-pressed={torchOn}
          aria-label={torchOn ? 'إطفاء الفلاش' : 'تشغيل الفلاش'}
        >
          {torchOn ? <FlashlightOff /> : <Flashlight />}
        </button>
      )}
      <div className="idcam-card-stage" onClick={tapToFocus}>
        <div
          ref={frameRef}
          className={`idcam-card-frame${capturing ? ' is-locked' : progress >= 0.15 ? ' is-good' : ''}`}
        >
          <i />
          <i />
          <i />
          <i />
          <span className="idcam-scan" aria-hidden="true" />
          {side === 'back' && <span className="idcam-mrz-hint" aria-hidden="true" />}
          {side === 'front' && <span className="idcam-portrait-hint" aria-hidden="true" />}
        </div>
      </div>
      {focusMark && (
        <span
          key={focusMark.id}
          className="idcam-focus"
          style={{ left: focusMark.x, top: focusMark.y }}
          aria-hidden="true"
        />
      )}
      <div className="idcam-bottom">
        <p className="idcam-hint" aria-live="polite">
          {hint}
        </p>
        <ul className={`idcam-meters${view.meters && !capturing ? '' : ' is-pending'}`} aria-hidden="true">
          <li className={meters.light ? 'ok' : ''}>الإضاءة</li>
          <li className={meters.glare ? 'ok' : ''}>بلا انعكاس</li>
          <li className={meters.sharp ? 'ok' : ''}>الوضوح</li>
        </ul>
        <div className={`idcam-shutter-wrap${capturing ? ' is-capturing' : ''}`}>
          <svg className="idcam-shutter-ring" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="46" className="track" />
            <circle
              cx="50"
              cy="50"
              r="46"
              className="fill"
              style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - progress), opacity: progress > 0 ? 1 : 0 }}
            />
          </svg>
          <button
            ref={shutterRef}
            type="button"
            className="idcam-shutter"
            onClick={() => void finish('manual')}
            disabled={!ready || capturing}
            aria-label="التقاط الصورة الآن"
          >
            <Camera />
          </button>
        </div>
        <small className="idcam-auto">يلتقط تلقائياً — وتقدر تضغط الزر بأي وقت</small>
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
