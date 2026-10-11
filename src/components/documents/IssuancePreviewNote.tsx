import { useEffect, useState } from 'react'
import { Eye, FileCheck2, X } from 'lucide-react'
import { documentsApi, type RequestDocumentPlan } from './documentsApi'
import '../../styles/ds/documents.css'

/**
 * Shown next to «الموافقة» in the request review: which official template will be issued for this request,
 * with a watermarked preview filled with the request's real data before the employee confirms.
 */
export function IssuancePreviewNote({ reference }: { reference: string }) {
  const [plan, setPlan] = useState<RequestDocumentPlan | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setPlan(null)
    setOpen(false)
    documentsApi
      .requestPlan(reference)
      .then(setPlan)
      .catch(() => setPlan(null))
  }, [reference])
  if (!plan || !plan.issuesDocument) return null
  return (
    <div className="docs-issue-note" dir="rtl">
      <FileCheck2 aria-hidden="true" />
      <div>
        <strong>ستصدر عند الموافقة: {plan.documentTitle}</strong>
        <small>
          نموذج «{plan.template?.title}» • {plan.template?.familyLabel}
          {plan.validityDays ? ` • نافذة ${plan.validityDays} يوماً` : ''} • يوقّعها: {plan.signerTitle}
          {plan.overridden ? ' • معيّن من الدائرة' : ''}
        </small>
        {plan.appointmentRequired && (
          <small className={plan.appointment ? undefined : 'docs-issue-warning'} role="note">
            {plan.appointment
              ? `تُطبع عليها موعد الحضور: ${plan.appointment.date} الساعة ${plan.appointment.time} (أو الموعد الذي تحدده عند الموافقة).`
              : 'تحمل هذه الوثيقة موعد الحضور: حدد تاريخ ووقت الموعد عند الموافقة، وإلا تُرفض الموافقة.'}
          </small>
        )}
      </div>
      <button type="button" className="button outline small" onClick={() => setOpen(value => !value)}>
        {open ? <X /> : <Eye />} {open ? 'إخفاء المعاينة' : 'معاينة الوثيقة'}
      </button>
      {open && (
        <div className="docs-pdf docs-issue-preview">
          <iframe src={`${plan.previewUrl}#toolbar=0&navpanes=0&view=FitH`} title="معاينة الوثيقة قبل الإصدار" />
          <a className="button ghost small" href={plan.previewUrl} target="_blank" rel="noreferrer">
            فتح المعاينة في نافذة جديدة
          </a>
        </div>
      )}
    </div>
  )
}
