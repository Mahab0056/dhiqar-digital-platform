import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileArchive,
  MapPin,
  MessageSquareWarning,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { api } from '../../api'
import type { CitizenFeedback } from '../../types'
import { feedbackStatusLabels } from '../citizen/feedback-labels'

export function FeedbackAdminPanel({ reviewAccessCode }: { reviewAccessCode: string }) {
  const [items, setItems] = useState<CitizenFeedback[]>([])
  const [selected, setSelected] = useState<CitizenFeedback | null>(null)
  const [status, setStatus] = useState<'IN_REVIEW' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'>('IN_REVIEW')
  const [currentAction, setCurrentAction] = useState('')
  const [adminNote, setAdminNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [openedMedia, setOpenedMedia] = useState<Record<string, { url: string; mimeType: string }>>({})
  const selectFeedback = (item: CitizenFeedback | null) => {
    setSelected(item)
    if (item) {
      setStatus(
        item.status === 'RECEIVED' ? 'IN_REVIEW' : (item.status as 'IN_REVIEW' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED')
      )
      setCurrentAction(item.currentAction)
      setAdminNote(item.adminNote || '')
    }
  }
  const load = async (preferredReference?: string) => {
    setBusy(true)
    try {
      const results = await api.listFeedbackForAdmin()
      setItems(results)
      selectFeedback(
        results.find(item => item.reference === preferredReference || item.reference === selected?.reference) ||
          results[0] ||
          null
      )
    } catch (loadError) {
      setError((loadError as Error).message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    let active = true
    api
      .listFeedbackForAdmin()
      .then(results => {
        if (!active) return
        setItems(results)
        selectFeedback(results[0] || null)
      })
      .catch(loadError => {
        if (active) setError((loadError as Error).message)
      })
    return () => {
      active = false
    }
  }, [])
  const save = async () => {
    if (!selected || currentAction.trim().length < 6) return setError('اكتب إجراءً واضحاً للمواطن قبل الحفظ.')
    setBusy(true)
    setError('')
    try {
      const result = await api.updateFeedback(selected.reference, {
        status,
        currentAction,
        adminNote: adminNote || undefined,
      })
      await load(result.reference)
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const openMedia = async (mediaId: string) => {
    if (openedMedia[mediaId]) return
    if (!reviewAccessCode) return setError('رمز مراجعة الموظف غير متاح لهذه الجلسة.')
    try {
      const item = await api.loadReviewMedia(mediaId, reviewAccessCode)
      setOpenedMedia(current => ({ ...current, [mediaId]: item }))
    } catch (openError) {
      setError((openError as Error).message)
    }
  }
  return (
    <section className="feedback-admin">
      <header className="feedback-admin-heading">
        <div>
          <span className="section-kicker">صوت المواطن</span>
          <h2>الشكاوى والمقترحات</h2>
          <p>كل تحديث يسجّل في التدقيق ويصل إشعار لصاحب الطلب.</p>
        </div>
        <button className="button outline" onClick={() => void load()} disabled={busy}>
          <RefreshCw /> تحديث
        </button>
      </header>
      {error && (
        <div className="form-error">
          <AlertTriangle /> {error}
        </div>
      )}
      <div className="feedback-admin-grid">
        <div className="feedback-admin-list">
          {items.length === 0 ? (
            <div className="citizen-empty compact">
              <MessageSquareWarning />
              <div>
                <strong>لا توجد طلبات جديدة</strong>
                <span>ستظهر هنا الشكاوى والمقترحات عند إرسالها.</span>
              </div>
            </div>
          ) : (
            items.map(item => (
              <button
                key={item.reference}
                onClick={() => selectFeedback(item)}
                className={selected?.reference === item.reference ? 'feedback-admin-row active' : 'feedback-admin-row'}
              >
                <span className={item.kind === 'COMPLAINT' ? 'complaint-icon' : 'suggestion-icon'}>
                  {item.kind === 'COMPLAINT' ? <MessageSquareWarning /> : <Sparkles />}
                </span>
                <div>
                  <div>
                    <strong>{item.subject}</strong>
                    <em className={`feedback-status ${item.status.toLowerCase()}`}>
                      {feedbackStatusLabels[item.status]}
                    </em>
                  </div>
                  <small>
                    {item.reference} • {item.category}
                  </small>
                  <p>{item.currentAction}</p>
                </div>
              </button>
            ))
          )}
        </div>
        <div className="feedback-admin-detail">
          {selected ? (
            <>
              <header>
                <div>
                  <span className={`feedback-status ${selected.status.toLowerCase()}`}>
                    {feedbackStatusLabels[selected.status]}
                  </span>
                  <h3>{selected.subject}</h3>
                  <p>
                    {selected.reference} • {selected.kind === 'COMPLAINT' ? 'شكوى' : 'مقترح'} • {selected.category}
                  </p>
                </div>
                <small>{new Date(selected.updatedAt).toLocaleString('en-GB')}</small>
              </header>
              <div className="feedback-admin-description">
                <p>{selected.description}</p>
                {selected.coordinates && (
                  <span>
                    <MapPin /> الموقع: {selected.coordinates.lat.toFixed(5)}, {selected.coordinates.lng.toFixed(5)}
                  </span>
                )}
              </div>
              <div className="feedback-admin-media">
                <h4>المرفقات</h4>
                {selected.attachments.length === 0 ? (
                  <p>لا توجد مرفقات.</p>
                ) : (
                  selected.attachments.map(media => (
                    <div key={media.mediaId}>
                      <FileArchive />
                      <div>
                        <strong>{media.label}</strong>
                        <small>
                          {media.originalName} • {(media.sizeBytes / 1024).toFixed(1)} KB
                        </small>
                      </div>
                      {openedMedia[media.mediaId] ? (
                        openedMedia[media.mediaId].mimeType.startsWith('image/') ? (
                          <img src={openedMedia[media.mediaId].url} alt={media.label} />
                        ) : (
                          <a
                            className="button outline"
                            href={openedMedia[media.mediaId].url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            فتح PDF
                          </a>
                        )
                      ) : (
                        <button className="button outline" onClick={() => void openMedia(media.mediaId)}>
                          <Eye /> عرض
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
              <section className="feedback-admin-update">
                <h4>تحديث المواطن</h4>
                <label>
                  الحالة
                  <select value={status} onChange={event => setStatus(event.target.value as typeof status)}>
                    <option value="IN_REVIEW">قيد المراجعة</option>
                    <option value="IN_PROGRESS">قيد المعالجة</option>
                    <option value="RESOLVED">تمت المعالجة</option>
                    <option value="CLOSED">أُغلق الطلب</option>
                  </select>
                </label>
                <label>
                  الإجراء الحالي
                  <textarea
                    value={currentAction}
                    onChange={event => setCurrentAction(event.target.value.slice(0, 500))}
                    rows={3}
                  />
                </label>
                <label>
                  ملاحظة داخل الطلب <small>اختيارية</small>
                  <textarea
                    value={adminNote}
                    onChange={event => setAdminNote(event.target.value.slice(0, 1500))}
                    rows={2}
                    placeholder="معلومة إضافية لصاحب الطلب"
                  />
                </label>
                <button className="button primary" onClick={() => void save()} disabled={busy}>
                  <CheckCircle2 /> حفظ وإشعار المواطن
                </button>
              </section>
            </>
          ) : (
            <div className="empty-queue">
              <MessageSquareWarning />
              <p>اختَر طلباً لمراجعته.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
