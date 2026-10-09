import { useEffect, useState } from 'react'
import { Camera, Check, RefreshCw, ScanFace } from 'lucide-react'
import { api } from '../../api'
import { IdentityCamera, type LivenessTimelineEntry } from './IdentityCamera'

export type CardData = {
  name: string
  documentLast4: string
  birthDate: string | null
  expiryDate: string | null
  sex: string | null
  nationality: string
  valid: boolean
}

const usePreview = (file: File | null) => {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!file) return setUrl('')
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return url
}

/** One side of the unified card: opens the full-screen camera, then checks the photo instantly. */
export function CardTile({
  side,
  file,
  onFile,
  onCard,
}: {
  side: 'front' | 'back'
  file: File | null
  onFile: (file: File | null) => void
  onCard?: (card: CardData | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'bad'>(file ? 'ok' : 'idle')
  const [message, setMessage] = useState('')
  const preview = usePreview(file)

  const captured = async (photo: File) => {
    setOpen(false)
    onFile(photo)
    setStatus('checking')
    setMessage(side === 'front' ? 'نبحث عن صورة الوجه في البطاقة…' : 'نقرأ بيانات البطاقة…')
    try {
      const result = await api.cardCheck(side, photo)
      setStatus(result.ok ? 'ok' : 'bad')
      setMessage(result.message || '')
      if (side === 'back') onCard?.(result.card ?? null)
      navigator.vibrate?.(result.ok ? [30, 40, 30] : 120)
    } catch (error) {
      // the instant check is a convenience: if it cannot run, the full checks still happen on submission
      setStatus('ok')
      setMessage((error as Error).message || 'سيُتحقق من الصورة بعد الإرسال.')
    }
  }

  return (
    <>
      <button
        type="button"
        className={`id-tile${status === 'ok' ? ' is-ok' : status === 'bad' ? ' is-bad' : ''}`}
        onClick={() => setOpen(true)}
      >
        {status === 'ok' && (
          <span className="id-tile-badge" aria-hidden="true">
            <Check />
          </span>
        )}
        <span className={`id-tile-art${status === 'checking' ? ' is-scanning' : ''}`} aria-hidden="true">
          {preview ? (
            <img src={preview} alt="" />
          ) : side === 'front' ? (
            <>
              <span className="id-art-face" />
              <span className="id-art-lines">
                <i />
                <i />
                <i />
              </span>
            </>
          ) : (
            <span className="id-art-mrz" />
          )}
        </span>
        <strong>{side === 'front' ? 'وجه البطاقة' : 'ظهر البطاقة'}</strong>
        <small>
          {status === 'idle' ? (side === 'front' ? 'اضغط لفتح الكاميرا' : 'مع الأسطر الإنگليزية في الأسفل') : message}
        </small>
        {status !== 'idle' && status !== 'checking' && (
          <span className="id-tile-retake">
            <RefreshCw aria-hidden="true" /> إعادة التصوير
          </span>
        )}
        {status === 'idle' && <Camera aria-hidden="true" />}
      </button>
      {open && (
        <IdentityCamera
          mode="card"
          side={side}
          onCapture={photo => void captured(photo)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** Starts the face check: gets the server's random movement order, then records it full screen. */
export function FaceChallengeStart({
  done,
  onCaptured,
}: {
  done: boolean
  onCaptured: (video: File, challengeId: string, timeline: LivenessTimelineEntry[]) => void
}) {
  const [challenge, setChallenge] = useState<{
    id: string
    steps: Array<'CENTER' | 'LEFT' | 'RIGHT'>
    stepMs: number
  } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const start = async () => {
    setBusy(true)
    setError('')
    try {
      setChallenge(await api.livenessChallenge())
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button
        type="button"
        className={`id-face-start${done ? ' is-ok' : ''}`}
        onClick={() => void start()}
        disabled={busy}
      >
        <span className="id-face-icon" aria-hidden="true">
          {done ? <Check /> : <ScanFace />}
        </span>
        <strong>{done ? 'تم تسجيل التحقق من الوجه' : 'ابدأ التحقق من الوجه'}</strong>
        <small>
          {done
            ? 'اضغط لإعادة التسجيل إن أردت'
            : 'تفتح الكاميرا الأمامية بكامل الشاشة: انظر للأمام، ثم أدر رأسك يميناً ويساراً بالترتيب الذي يظهر لك'}
        </small>
      </button>
      {error && <p className="field-hint is-error">{error}</p>}
      {challenge && (
        <IdentityCamera
          mode="face"
          challenge={challenge}
          onCapture={(video, timeline) => {
            const id = challenge.id
            setChallenge(null)
            onCaptured(video, id, timeline)
          }}
          onClose={() => setChallenge(null)}
        />
      )}
    </>
  )
}
