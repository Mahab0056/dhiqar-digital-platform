import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, HelpCircle, Send, Sparkles, XCircle } from 'lucide-react'
import '../../styles/ds/assistant.css'
import { getAiReview, runAiReview, type AiReview } from './assistant-client'

const verdictLabels: Record<AiReview['verdict'], string> = {
  READY: 'المستمسكات مكتملة',
  MISSING_ITEMS: 'توجد نواقص',
  NEEDS_HUMAN_CHECK: 'يحتاج نظرة الموظف',
}
const docIcons = { PRESENT: CheckCircle2, MISSING: XCircle, UNCLEAR: HelpCircle } as const
const docLabels = { PRESENT: 'موجود', MISSING: 'ناقص', UNCLEAR: 'غير واضح' } as const

/**
 * "تدقيق ذكي" on the selected request. The assistant only prepares: a checklist and a "ناقصة بس" note. Sending the
 * note goes through the department's normal decision form (prefilled by `onUseNote`), which the employee confirms.
 */
export function AiReviewPanel({
  reference,
  canSendNote,
  onUseNote,
}: {
  reference: string
  /** false when the request is closed, read-only or assigned to a colleague */
  canSendNote: boolean
  onUseNote: (note: string, missingItems: string[]) => void
}) {
  const [review, setReview] = useState<AiReview | null>(null)
  const [mode, setMode] = useState<'ai' | 'fallback' | null>(null)
  const [documentReview, setDocumentReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setReview(null)
    setError('')
    getAiReview(reference)
      .then(response => {
        if (!alive) return
        setReview(response.review)
        setMode(response.mode)
        setDocumentReview(response.documentReview)
      })
      .catch(() => {
        /* no previous review or no access: the button still works */
      })
    return () => {
      alive = false
    }
  }, [reference])

  const run = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await runAiReview(reference)
      setReview(response.review)
      setMode(response.mode)
      setDocumentReview(response.documentReview)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذر تشغيل التدقيق الذكي.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ai-review" aria-live="polite">
      <div className="ai-review-head">
        <h4>
          <Sparkles aria-hidden="true" /> تدقيق ذكي
        </h4>
        {review && (
          <span className={`ai-review-verdict is-${review.verdict.toLowerCase()}`}>
            {review.verdict === 'READY' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            {verdictLabels[review.verdict]}
          </span>
        )}
        <button type="button" className="button outline small" disabled={busy} onClick={() => void run()}>
          <Sparkles /> {busy ? 'يدقق الآن…' : review ? 'أعد التدقيق' : 'تدقيق ذكي'}
        </button>
      </div>
      {!review && !busy && (
        <p className="ai-review-meta">
          يقارن المساعد الطلب بقائمة المستمسكات الرسمية للخدمة وحقول الاستمارة، ويجهز لك ملاحظة «ناقصة بس» للمواطن.
          {mode === 'fallback' ? ' (المساعد الذكي غير مفعّل حالياً — ستظهر نتيجة القواعد الآلية فقط.)' : ''}
          {mode === 'ai' && !documentReview ? ' لا تُرسل صور المستمسكات للذكاء الاصطناعي حسب إعداد الخصوصية.' : ''}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {review && (
        <>
          <p className="ai-review-summary">{review.summary}</p>
          <ul className="ai-review-list" aria-label="نتيجة تدقيق المستمسكات">
            {review.documents.map(doc => {
              const Icon = docIcons[doc.status]
              return (
                <li key={doc.key} className={`is-${doc.status.toLowerCase()}`}>
                  <Icon aria-hidden="true" />
                  <strong>
                    {doc.label} — {docLabels[doc.status]}
                    {!doc.required && <em className="gov-muted"> (اختياري)</em>}
                  </strong>
                  <small>{doc.reason}</small>
                </li>
              )
            })}
            {review.fieldIssues.map(issue => (
              <li key={`field-${issue.field}`} className="is-unclear">
                <AlertTriangle aria-hidden="true" />
                <strong>{issue.field}</strong>
                <small>{issue.issue}</small>
              </li>
            ))}
          </ul>
          {review.citizenNote && (
            <div className="ai-review-note">
              <small>الملاحظة المقترحة للمواطن:</small>
              <p>{review.citizenNote}</p>
              {canSendNote && (
                <div className="ai-review-actions">
                  <button
                    type="button"
                    className="button primary small"
                    onClick={() => onUseNote(review.citizenNote, review.missingItems)}
                  >
                    <Send /> أرسل طلب الاستكمال للمواطن
                  </button>
                </div>
              )}
            </div>
          )}
          <p className="ai-review-meta">
            {review.source === 'MODEL' ? `بواسطة ${review.model}` : 'قواعد آلية من قائمة المستمسكات'} —{' '}
            {new Date(review.createdAt).toLocaleString('en-GB')}
            {review.documentsSent ? ` — فُحص ${review.documentsSent} ملف` : ''}.{' '}
            {review.notice ? `${review.notice} ` : ''}
            المساعد لا يوافق ولا يرفض: القرار لك.
          </p>
        </>
      )}
    </section>
  )
}
