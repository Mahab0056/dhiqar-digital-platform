import { useEffect, useRef, useState } from 'react'
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

/**
 * idle → checking → ok. A photo the instant check finds unusable (no portrait on the front) asks once: use it anyway or
 * retake. An unread machine-readable zone on the back never blocks: the photo is kept and the zone is read again
 * after submission. When the check could not judge the photo at all (its OCR engine is down) nothing is asked.
 */
type TileStatus = 'idle' | 'checking' | 'ok' | 'soft' | 'bad'

const BACK_UNREAD = 'ما قدرنا نقرأ الأسطر الإنگليزية بوضوح — تقدر تعيد التصوير أو تكمل وتُقرأ بعد الإرسال'

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
  const [status, setStatus] = useState<TileStatus>(file ? 'ok' : 'idle')
  const [message, setMessage] = useState('')
  const checkRef = useRef(0)
  const mainRef = useRef<HTMLButtonElement | null>(null)
  const actionsRef = useRef<HTMLDivElement | null>(null)
  const tileRef = useRef<HTMLDivElement | null>(null)
  const preview = usePreview(file)
  const title = side === 'front' ? 'وجه البطاقة' : 'ظهر البطاقة'

  /** set once the camera was used here: only then does the tile move the focus */
  const usedRef = useRef(false)

  // after the camera closes: a choice to make gets the focus (its buttons are announced as one group); otherwise
  // focus stays on — or comes back to — the tile, never left on the page itself. Focus that has moved on elsewhere
  // (the other side's camera, a field) is left alone.
  useEffect(() => {
    if (open || !usedRef.current) return
    const active = document.activeElement
    const lost = !active || active === document.body
    if (!lost && !tileRef.current?.contains(active)) return
    if (status === 'soft' || status === 'bad')
      actionsRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    else if (lost) mainRef.current?.focus({ preventScroll: true })
  }, [status, open])

  const openCamera = () => {
    usedRef.current = true
    setOpen(true)
  }

  const captured = async (photo: File) => {
    setOpen(false)
    onFile(photo)
    // a retake while an earlier check is still running: only the latest photo's answer counts
    const check = ++checkRef.current
    setStatus('checking')
    setMessage(side === 'front' ? 'نتأكد من صورة الوجه في البطاقة…' : 'نقرأ بيانات البطاقة…')
    try {
      // the check also says when nothing could be judged (its engine is down): no retake is suggested then
      const result: Awaited<ReturnType<typeof api.cardCheck>> & { retakeSuggested?: boolean } = await api.cardCheck(
        side,
        photo
      )
      if (check !== checkRef.current) return
      if (side === 'back') onCard?.(result.card ?? null)
      if (result.ok || result.retakeSuggested === false) {
        setStatus('ok')
        setMessage(result.message || 'تم التصوير.')
        navigator.vibrate?.([30, 40, 30])
      } else if (side === 'back') {
        setStatus('soft')
        setMessage(BACK_UNREAD)
        navigator.vibrate?.(40)
      } else {
        setStatus('bad')
        setMessage(result.message || 'لم تظهر صورة الوجه في البطاقة بوضوح.')
        navigator.vibrate?.(120)
      }
    } catch (error) {
      if (check !== checkRef.current) return
      // the instant check is a convenience: if it cannot run, the full checks still happen on submission
      setStatus('ok')
      setMessage((error as Error).message || 'سيُتحقق من الصورة بعد الإرسال.')
    }
  }

  /** Keeps the photo as it is; the full checks run again on submission. */
  const keep = () => {
    setStatus('ok')
    setMessage(side === 'back' ? 'تمام — تُقرأ الأسطر بعد الإرسال.' : 'تمام — نستخدم هذه الصورة وتُفحص مع الطلب.')
    mainRef.current?.focus()
  }

  const shown = status === 'idle' ? '' : message || 'تم التصوير.'
  return (
    <div ref={tileRef} className={`id-tile is-${status}`}>
      <button ref={mainRef} type="button" className="id-tile-main" onClick={openCamera}>
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
        <strong>{title}</strong>
        <small>
          {status === 'idle' ? (side === 'front' ? 'اضغط لفتح الكاميرا' : 'مع الأسطر الإنگليزية في الأسفل') : shown}
        </small>
        {status === 'ok' && (
          <span className="id-tile-retake">
            <RefreshCw aria-hidden="true" /> إعادة التصوير
          </span>
        )}
        {status === 'idle' && <Camera aria-hidden="true" />}
      </button>
      {status === 'soft' && (
        <div ref={actionsRef} className="id-tile-actions" role="group" aria-label={`${title}: ${shown}`}>
          <button type="button" className="button primary small" onClick={keep}>
            <Check aria-hidden="true" /> أكمل بهذه الصورة
          </button>
          <button type="button" className="button outline small" onClick={openCamera}>
            <RefreshCw aria-hidden="true" /> إعادة التصوير
          </button>
        </div>
      )}
      {status === 'bad' && (
        <div ref={actionsRef} className="id-tile-actions" role="group" aria-label={`${title}: ${shown}`}>
          <button type="button" className="button primary small" onClick={openCamera}>
            <RefreshCw aria-hidden="true" /> إعادة
          </button>
          <button type="button" className="button outline small" onClick={keep}>
            استخدم هذه الصورة
          </button>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {shown && `${title}: ${shown}`}
      </span>
      {open && (
        <IdentityCamera
          mode="card"
          side={side}
          onCapture={photo => void captured(photo)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
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
