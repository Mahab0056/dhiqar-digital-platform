import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { AlertTriangle, ArrowRight, Check, Clock3, Eye, FileArchive, RefreshCw } from 'lucide-react'
import { api } from '../../api'
import type { CitizenFeedback } from '../../types'
import { PortalLayout } from '../../components/citizen/PortalLayout'
import { feedbackStatusLabels } from './feedback-labels'

export function CitizenFeedbackDetailPage({ reference }: { reference: string }) {
  const [feedback, setFeedback] = useState<CitizenFeedback | null>(null)
  const [error, setError] = useState('')
  const [openedMedia, setOpenedMedia] = useState<Record<string, { url: string; mimeType: string }>>({})
  useEffect(() => {
    api
      .getFeedback(reference)
      .then(setFeedback)
      .catch(item => setError(item.message))
  }, [reference])
  const openMedia = async (mediaId: string) => {
    if (openedMedia[mediaId]) return
    try {
      const media = await api.loadFeedbackMedia(reference, mediaId)
      setOpenedMedia(current => ({ ...current, [mediaId]: media }))
    } catch (item) {
      setError((item as Error).message)
    }
  }
  if (error)
    return (
      <PortalLayout>
        <div className="feedback-detail-error">
          <AlertTriangle />
          <h1>تعذر فتح الطلب</h1>
          <p>{error}</p>
          <Link className="button primary" href="/citizen">
            العودة للحساب
          </Link>
        </div>
      </PortalLayout>
    )
  if (!feedback)
    return (
      <PortalLayout>
        <div className="loading-state">
          <RefreshCw className="spin" /> جاري تحميل الطلب...
        </div>
      </PortalLayout>
    )
  return (
    <PortalLayout>
      <article className="feedback-detail">
        <header>
          <Link href="/citizen#my-requests">
            <ArrowRight /> حساب المواطن
          </Link>
          <div>
            <span className={`feedback-status ${feedback.status.toLowerCase()}`}>
              {feedbackStatusLabels[feedback.status]}
            </span>
            <small>{feedback.reference}</small>
          </div>
          <h1>{feedback.subject}</h1>
          <p>
            {feedback.kind === 'COMPLAINT' ? 'شكوى' : 'مقترح'} • {feedback.category} • {feedback.district || 'ذي قار'} •{' '}
            {new Date(feedback.createdAt).toLocaleString('en-GB')}
          </p>
        </header>
        <section className="feedback-detail-action">
          <span>
            <Clock3 />
          </span>
          <div>
            <small>آخر إجراء</small>
            <strong>{feedback.currentAction}</strong>
          </div>
        </section>
        <div className="feedback-detail-grid">
          <section className="feedback-timeline">
            <h2>تحديثات الطلب</h2>
            {feedback.events.map((event, index) => (
              <div className="feedback-event" key={event.id}>
                <span>{index === feedback.events.length - 1 ? <Check /> : index + 1}</span>
                <div>
                  <strong>{event.title}</strong>
                  <time>{new Date(event.createdAt).toLocaleString('en-GB')}</time>
                  <p>{event.description}</p>
                  <small>{event.actor}</small>
                </div>
              </div>
            ))}
          </section>
          <aside>
            <section className="feedback-detail-card">
              <h3>تفاصيل الطلب</h3>
              <p>{feedback.description}</p>
              {feedback.adminNote && (
                <div className="feedback-admin-note">
                  <small>ملاحظة الجهة</small>
                  <strong>{feedback.adminNote}</strong>
                </div>
              )}
            </section>
            <section className="feedback-detail-card">
              <h3>المرفقات</h3>
              {feedback.attachments.length === 0 ? (
                <p>لم تُرفق ملفات مع هذا الطلب.</p>
              ) : (
                <div className="feedback-media-list">
                  {feedback.attachments.map(item => (
                    <div key={item.mediaId}>
                      <span>
                        <FileArchive />
                      </span>
                      <div>
                        <strong>{item.label}</strong>
                        <small>
                          {item.originalName} • {(item.sizeBytes / 1024).toFixed(1)} KB
                        </small>
                      </div>
                      {openedMedia[item.mediaId] ? (
                        openedMedia[item.mediaId].mimeType.startsWith('image/') ? (
                          <img src={openedMedia[item.mediaId].url} alt={item.label} />
                        ) : (
                          <a
                            className="button outline"
                            href={openedMedia[item.mediaId].url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            فتح PDF
                          </a>
                        )
                      ) : (
                        <button className="button outline" onClick={() => void openMedia(item.mediaId)}>
                          <Eye /> عرض
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      </article>
    </PortalLayout>
  )
}
