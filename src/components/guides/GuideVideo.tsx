import { useRef } from 'react'
import { PlayCircle, X } from 'lucide-react'
import { guideById, guideMedia, type GuideId } from './guides'
import '../../styles/ds/guides.css'

/** An accessible tutorial player: native controls, Arabic captions on by default, poster, no autoplay. */
export function GuideVideo({ id, className = '' }: { id: GuideId; className?: string }) {
  const guide = guideById(id)
  const media = guideMedia(id)
  return (
    <video
      className={`guide-video ${className}`.trim()}
      controls
      preload="metadata"
      playsInline
      poster={media.poster}
      aria-label={guide.title}
    >
      <source src={media.webm} type="video/webm" />
      <source src={media.mp4} type="video/mp4" />
      <track kind="captions" srcLang="ar" label="العربية" src={media.captions} default />
      متصفحك لا يدعم تشغيل الفيديو. <a href={media.mp4}>نزّل الفيديو</a>.
    </video>
  )
}

/** A small "شاهد: …" link that opens the video in a modal dialog and stops it when closed. */
export function GuideVideoLink({ id, label, className = '' }: { id: GuideId; label?: string; className?: string }) {
  const guide = guideById(id)
  const dialog = useRef<HTMLDialogElement>(null)
  const close = () => dialog.current?.close()
  return (
    <>
      <button type="button" className={`guide-link ${className}`.trim()} onClick={() => dialog.current?.showModal()}>
        <PlayCircle aria-hidden="true" />
        <span>{label || `شاهد: ${guide.title} (${guide.length})`}</span>
      </button>
      <dialog
        ref={dialog}
        className="guide-dialog"
        aria-label={guide.title}
        onClose={() => dialog.current?.querySelector('video')?.pause()}
        onClick={event => event.target === dialog.current && close()}
      >
        <div className="guide-dialog-head">
          <strong>{guide.title}</strong>
          <button type="button" className="guide-dialog-close" onClick={close} aria-label="إغلاق الفيديو">
            <X aria-hidden="true" />
          </button>
        </div>
        <GuideVideo id={id} />
      </dialog>
    </>
  )
}
