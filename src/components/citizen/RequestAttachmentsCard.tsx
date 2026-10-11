import { Camera, FileCheck2, FileText } from 'lucide-react'
import { attachmentBadge, attachmentsIntro, isClosedRequest } from './request-attachments'

export type RequestAttachment = {
  key: string
  label: string
  required: boolean
  status: 'MISSING' | 'UPLOADED' | 'VERIFIED' | 'REJECTED'
  rejectionReason: string | null
  updatedAt: string | null
  accepts: Array<'image' | 'pdf'>
}

export type AttachmentUploadTarget = { documentKey?: string; documentName?: string }

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('en-GB')
}

/**
 * «المستمسكات» of a citizen's request. While the request is open: per-attachment review state, upload / re-upload
 * buttons and the extra document the department asked for. Once it is closed (approved, rejected, cancelled): where
 * each attachment ended, no upload control and no instruction to re-upload.
 */
export function RequestAttachmentsCard({
  status,
  documents,
  requiredDocument,
  uploading,
  onUpload,
}: {
  status: string
  documents: RequestAttachment[]
  requiredDocument?: string | null
  uploading: string | null
  onUpload: (target: AttachmentUploadTarget, file: File | null) => void
}) {
  const closed = isClosedRequest(status)
  const needsUpload = documents.filter(doc => doc.status === 'MISSING' || doc.status === 'REJECTED')
  const extraRequested = !closed && status === 'ACTION_REQUIRED' && Boolean(requiredDocument) && !needsUpload.length
  if (!documents.length && !extraRequested) return null
  return (
    <section className="app-card cz-request-card" id="documents">
      <h2>
        <FileCheck2 /> المستمسكات
      </h2>
      <p>{attachmentsIntro(status)}</p>
      {documents.length > 0 && (
        <ul className="citizen-checklist">
          {documents.map(doc => {
            const busy = uploading === doc.key
            const canUpload = !closed && (doc.status === 'MISSING' || doc.status === 'REJECTED')
            const badge = attachmentBadge(doc.status, doc.required, closed)
            return (
              <li key={doc.key} className={`checklist-${doc.status.toLowerCase()}`}>
                <span className={`checklist-badge ${badge.tone}`}>{badge.label}</span>
                <div>
                  <strong>{doc.label}</strong>
                  {doc.status === 'REJECTED' && doc.rejectionReason && <small>سبب الرفض: {doc.rejectionReason}</small>}
                  {doc.updatedAt && doc.status !== 'MISSING' && (
                    <small className="cz-doc-time">آخر تحديث: {formatDateTime(doc.updatedAt)}</small>
                  )}
                </div>
                {canUpload && (
                  <label className="button outline small">
                    <Camera /> {busy ? 'جاري الرفع...' : doc.status === 'REJECTED' ? 'إعادة الرفع' : 'رفع'}
                    <input
                      hidden
                      type="file"
                      accept={doc.accepts.includes('pdf') ? 'image/*,application/pdf' : 'image/*'}
                      capture="environment"
                      disabled={busy}
                      onChange={event => {
                        onUpload({ documentKey: doc.key }, event.target.files?.[0] || null)
                        event.target.value = ''
                      }}
                    />
                  </label>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {extraRequested && (
        <div className="cz-callout is-warning">
          <div>
            <FileText />
            <span>
              <small>طلبت الدائرة منك</small>
              <strong>{requiredDocument}</strong>
            </span>
          </div>
          <label className="button primary">
            <Camera /> {uploading === 'extra' ? 'جاري الرفع...' : 'تصوير / رفع المستند'}
            <input
              hidden
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              disabled={uploading === 'extra'}
              onChange={event => {
                onUpload({ documentName: requiredDocument || 'المستند المطلوب' }, event.target.files?.[0] || null)
                event.target.value = ''
              }}
            />
          </label>
        </div>
      )}
    </section>
  )
}
