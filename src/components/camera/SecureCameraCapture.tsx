import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, CheckCircle2, FileText, RefreshCw } from 'lucide-react'

export type CaptureMode = 'photo' | 'video'

export function SecureCameraCapture({
  title,
  guidance,
  mode,
  facingMode,
  allowPdf = false,
  cameraOnly = false,
  file,
  onChange,
}: {
  title: string
  guidance: string
  mode: CaptureMode
  facingMode: 'user' | 'environment'
  allowPdf?: boolean
  cameraOnly?: boolean
  file: File | null
  onChange: (file: File | null) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<number | null>(null)
  const discardRecordingRef = useRef(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(7)
  const [previewUrl, setPreviewUrl] = useState('')
  const [cameraError, setCameraError] = useState('')
  const [cameraReady, setCameraReady] = useState(false)
  const faceChallenge = !recording
    ? { title: 'استعد لتسجيل فيديو الوجه', detail: 'ضع وجهك داخل الإطار وانتظر بدء العد التنازلي.' }
    : recordingSeconds >= 6
      ? { title: 'ثبّت وجهك داخل الإطار', detail: 'انظر إلى الكاميرا مباشرةً بإضاءة واضحة.' }
      : recordingSeconds === 5
        ? { title: 'ابتسم للكاميرا', detail: 'ابتسامة طبيعية وخفيفة تكفي.' }
        : recordingSeconds === 4
          ? { title: 'حرّك رأسك ببطء إلى اليمين', detail: 'حركة صغيرة وهادئة من دون الخروج من الإطار.' }
          : recordingSeconds === 3
            ? { title: 'حرّك رأسك ببطء إلى اليسار', detail: 'ابقَ داخل الإطار وانظر للكاميرا.' }
            : recordingSeconds === 2
              ? { title: 'ارمش مرتين بوضوح', detail: 'لا تحتاج إلى أي حركة سريعة.' }
              : { title: 'ابقَ ثابتاً لحظة أخيرة', detail: 'سيكتمل التسجيل تلقائياً ويحفظ الفيديو المشفر.' }
  const faceRecordingProgress = recording ? Math.min(100, Math.max(0, ((7 - recordingSeconds) / 7) * 100)) : 0

  const stopCamera = () => {
    discardRecordingRef.current = true
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current)
    recordingTimerRef.current = null
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraReady(false)
    setCameraOpen(false)
    setRecording(false)
  }

  useEffect(
    () => () => {
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current)
      streamRef.current?.getTracks().forEach(track => track.stop())
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    },
    [previewUrl]
  )

  const setCapturedFile = (captured: File) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(captured))
    onChange(captured)
  }

  const cameraErrorMessage = (error: unknown) => {
    if (!window.isSecureContext)
      return 'تحتاج الكاميرا إلى اتصال آمن HTTPS. افتح المنصة من الرابط الرسمي وليس من نافذة داخل تطبيق آخر.'
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError' || error.name === 'SecurityError')
        return 'تم رفض إذن الكاميرا. من إعدادات المتصفح اسمح للمنصة باستخدام الكاميرا ثم اضغط إعادة المحاولة.'
      if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')
        return 'لم نعثر على الكاميرا المطلوبة. أوقف التطبيقات الأخرى التي تستخدم الكاميرا ثم أعد المحاولة.'
      if (error.name === 'NotReadableError')
        return 'الكاميرا مستخدمة من تطبيق آخر. أغلق الكاميرا أو واتساب أو أي تطبيق مفتوح ثم أعد المحاولة.'
    }
    return 'تعذر تشغيل معاينة الكاميرا. تأكد من الإذن، ثم أغلق التطبيقات الأخرى التي تستخدم الكاميرا وأعد المحاولة.'
  }

  const openCamera = async () => {
    setCameraError('')
    setCameraReady(false)
    stopCamera()
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('هذا المتصفح لا يدعم فتح الكاميرا. استخدم Chrome أو Safari حديثاً، أو ارفع الملف من الهاتف.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: mode === 'video',
      })
      streamRef.current = stream
      setCameraOpen(true)
      let framesWaited = 0
      const attachStream = async () => {
        if (streamRef.current !== stream) return
        const video = videoRef.current
        if (!video) {
          framesWaited += 1
          if (framesWaited < 12)
            return window.requestAnimationFrame(() => {
              void attachStream()
            })
          stream.getTracks().forEach(track => track.stop())
          if (streamRef.current === stream) streamRef.current = null
          setCameraOpen(false)
          setCameraError('تعذر تجهيز شاشة الكاميرا. أعد المحاولة أو استخدم رفع الملف.')
          return
        }
        video.srcObject = stream
        video.muted = true
        video.playsInline = true
        try {
          await video.play()
          if (streamRef.current !== stream) return
          setCameraReady(true)
          if (mode === 'video')
            window.setTimeout(() => {
              if (streamRef.current === stream) startVideo(stream)
            }, 250)
        } catch (playError) {
          stream.getTracks().forEach(track => track.stop())
          if (streamRef.current === stream) streamRef.current = null
          setCameraOpen(false)
          setCameraError(cameraErrorMessage(playError))
        }
      }
      window.requestAnimationFrame(() => {
        void attachStream()
      })
    } catch (error) {
      setCameraError(cameraErrorMessage(error))
    }
  }

  const takePhoto = () => {
    const video = videoRef.current
    if (!video || !cameraReady || video.videoWidth < 1 || video.videoHeight < 1) {
      setCameraError('انتظر حتى تظهر معاينة الكاميرا بوضوح قبل التقاط الصورة.')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      blob => {
        if (blob) setCapturedFile(new File([blob], `${title}-${Date.now()}.jpg`, { type: 'image/jpeg' }))
        stopCamera()
      },
      'image/jpeg',
      0.9
    )
  }

  const startVideo = (sourceStream?: MediaStream) => {
    const stream = sourceStream || streamRef.current
    if (!stream || typeof MediaRecorder === 'undefined')
      return setCameraError('تسجيل الفيديو غير مدعوم في هذا المتصفح. استخدم رفع فيديو قصير.')
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm'
    const recorder = new MediaRecorder(stream, { mimeType })
    chunksRef.current = []
    discardRecordingRef.current = false
    setRecordingSeconds(7)
    recorder.ondataavailable = event => {
      if (event.data.size) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
      if (!discardRecordingRef.current && chunksRef.current.length)
        setCapturedFile(
          new File([new Blob(chunksRef.current, { type: 'video/webm' })], `face-video-7s-${Date.now()}.webm`, {
            type: 'video/webm',
          })
        )
      const isCurrentStream = streamRef.current === stream
      stream.getTracks().forEach(track => track.stop())
      if (isCurrentStream) {
        streamRef.current = null
        if (videoRef.current) videoRef.current.srcObject = null
        setCameraReady(false)
        setCameraOpen(false)
        setRecording(false)
      }
    }
    recorderRef.current = recorder
    recorder.start(500)
    setRecording(true)
    const startedAt = Date.now()
    recordingTimerRef.current = window.setInterval(() => {
      const remaining = Math.max(0, 7 - Math.floor((Date.now() - startedAt) / 1000))
      setRecordingSeconds(remaining)
      if (remaining === 0) {
        if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current)
        recordingTimerRef.current = null
        if (recorder.state === 'recording') recorder.stop()
      }
    }, 250)
  }

  const pickFile = (selected: File | undefined) => {
    if (!selected) return
    const accepted =
      mode === 'photo'
        ? selected.type.startsWith('image/') || (allowPdf && selected.type === 'application/pdf')
        : selected.type.startsWith('video/')
    if (!accepted) return setCameraError(mode === 'photo' ? 'اختر صورة للوثيقة فقط.' : 'اختر فيديو الوجه فقط.')
    if (selected.size > 20 * 1024 * 1024) return setCameraError('حجم الملف أكبر من 20 MB.')
    setCameraError('')
    setCapturedFile(selected)
  }

  return (
    <div className="secure-capture">
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={mode === 'photo' ? (allowPdf ? 'image/*,application/pdf' : 'image/*') : 'video/*'}
        capture={facingMode === 'environment' ? 'environment' : 'user'}
        onChange={event => pickFile(event.target.files?.[0])}
      />
      <div className="capture-head">
        <div>
          <strong>{title}</strong>
          <p>{guidance}</p>
        </div>
        {file && (
          <span className="capture-ready">
            <CheckCircle2 /> جاهز
          </span>
        )}
      </div>
      {previewUrl && (
        <div className="capture-preview">
          {mode === 'photo' ? (
            file?.type === 'application/pdf' ? (
              <div className="pdf-preview">
                <FileText />
                <strong>{file.name}</strong>
                <small>PDF جاهز للرفع</small>
              </div>
            ) : (
              <img src={previewUrl} alt={title} />
            )
          ) : (
            <video src={previewUrl} controls playsInline />
          )}
        </div>
      )}
      {cameraOpen && (
        <div className={`live-camera ${mode === 'video' ? 'face-video-camera' : ''}`}>
          <video ref={videoRef} autoPlay playsInline muted disablePictureInPicture />
          {mode === 'video' && (
            <>
              <div className="face-guide-frame" aria-hidden="true">
                <span>ضع الوجه داخل الإطار</span>
                <i />
                <i />
              </div>
              <div className="face-capture-instructions" aria-live="assertive">
                <div className="face-capture-status">
                  <b className={recording ? 'face-countdown active' : 'face-countdown'}>
                    {recording ? recordingSeconds.toLocaleString('en-US') : '7'}
                  </b>
                  <div>
                    <small>{recording ? 'التسجيل جارٍ الآن' : 'استعد — التسجيل يبدأ تلقائياً'}</small>
                    <strong>{faceChallenge.title}</strong>
                  </div>
                </div>
                <div className="face-capture-progress" aria-hidden="true">
                  <i style={{ width: `${faceRecordingProgress}%` }} />
                </div>
                <span>{faceChallenge.detail}</span>
              </div>
            </>
          )}
          <div className="live-camera-actions">
            {mode === 'photo' ? (
              <button type="button" className="button primary" onClick={takePhoto} disabled={!cameraReady}>
                <Camera /> {cameraReady ? 'التقاط الصورة' : 'جاري تجهيز الكاميرا...'}
              </button>
            ) : (
              <div className="camera-preparing">
                <RefreshCw />{' '}
                {recording
                  ? 'تابع التوجيه داخل شاشة الكاميرا'
                  : cameraReady
                    ? 'جاري بدء التسجيل التلقائي...'
                    : 'جاري تشغيل معاينة الكاميرا...'}
              </div>
            )}
            <button type="button" className="button ghost" onClick={stopCamera}>
              إلغاء
            </button>
          </div>
        </div>
      )}
      <div className="capture-actions">
        <button type="button" className="button secondary" onClick={() => void openCamera()}>
          <Camera /> {cameraOpen ? 'إعادة محاولة الكاميرا' : file ? 'إعادة التصوير' : 'فتح الكاميرا'}
        </button>
        {!cameraOnly && (
          <button type="button" className="button ghost" onClick={() => inputRef.current?.click()}>
            <FileText /> {mode === 'photo' ? 'رفع صورة' : 'رفع فيديو'}
          </button>
        )}
        {file && (
          <button
            type="button"
            className="capture-remove"
            onClick={() => {
              if (previewUrl) URL.revokeObjectURL(previewUrl)
              setPreviewUrl('')
              onChange(null)
            }}
          >
            <RefreshCw /> مسح
          </button>
        )}
      </div>
      {cameraError && (
        <div className="capture-error">
          <AlertTriangle /> {cameraError}
        </div>
      )}
    </div>
  )
}
