import { useEffect, useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import '../../styles/ds/assistant.css'
import { getAssistantStatus, type AssistantStatus } from './assistant-client'

const number = (value: number) => value.toLocaleString('en-US')

/** Super admin: is the assistant on, which model, the privacy flag, and today's / total usage for cost visibility. */
export function AssistantStatusCard() {
  const [status, setStatus] = useState<AssistantStatus | null>(null)
  const [error, setError] = useState('')
  const load = () => {
    setError('')
    getAssistantStatus()
      .then(setStatus)
      .catch(caught => setError(caught instanceof Error ? caught.message : 'تعذر تحميل حالة المساعد.'))
  }
  useEffect(load, [])

  return (
    <section className="gov-card ai-review" aria-labelledby="assistant-status-title">
      <div className="ai-review-head">
        <h4 id="assistant-status-title">
          <Sparkles aria-hidden="true" /> مساعد ذي قار الآلي
        </h4>
        {status && (
          <span className={`ai-review-verdict ${status.mode === 'ai' ? 'is-ready' : 'is-missing_items'}`}>
            {status.mode === 'ai' ? 'مفعّل' : status.keyConfigured ? 'موقوف' : 'وضع البحث (بلا مفتاح)'}
          </span>
        )}
        <button type="button" className="button outline small" onClick={load}>
          <RefreshCw /> تحديث
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {status && (
        <>
          <p className="ai-review-meta">
            النموذج: <bdi dir="ltr">{status.model}</bdi> — جهد المحادثة {status.effort.chat}، التدقيق{' '}
            {status.effort.review} — إرسال صور المستمسكات للذكاء الاصطناعي: {status.documentReview ? 'مفعّل' : 'متوقف'}
            {status.dailyTokenLimit ? ` — سقف يومي ${number(status.dailyTokenLimit)} توكن` : ''}
          </p>
          <div className="assistant-status-grid">
            <div>
              <small>رسائل اليوم</small>
              <strong>{number(status.usage.today.requests)}</strong>
            </div>
            <div>
              <small>استدعاءات النموذج اليوم</small>
              <strong>{number(status.usage.today.modelCalls)}</strong>
            </div>
            <div>
              <small>توكن إدخال / إخراج اليوم</small>
              <strong>
                {number(status.usage.today.inputTokens)} / {number(status.usage.today.outputTokens)}
              </strong>
            </div>
            <div>
              <small>قراءة من الكاش اليوم</small>
              <strong>{number(status.usage.today.cacheReadTokens)}</strong>
            </div>
            <div>
              <small>إجمالي الطلبات</small>
              <strong>{number(status.usage.total.requests)}</strong>
            </div>
            <div>
              <small>ردود البحث الاحتياطي</small>
              <strong>{number(status.usage.total.fallbackAnswers)}</strong>
            </div>
            <div>
              <small>أخطاء / امتناع</small>
              <strong>
                {number(status.usage.total.errors)} / {number(status.usage.total.refusals)}
              </strong>
            </div>
          </div>
          {!status.keyConfigured && (
            <p className="ai-review-meta">
              لتفعيل الذكاء الاصطناعي أضف المتغير ANTHROPIC_API_KEY في Railway ثم أعد التشغيل. حتى ذلك يعمل المساعد ببحث
              دليل الخدمات.
            </p>
          )}
        </>
      )}
    </section>
  )
}
