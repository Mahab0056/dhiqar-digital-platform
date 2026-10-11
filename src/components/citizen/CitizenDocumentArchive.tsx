import type { CSSProperties } from 'react'
import { Ban, FileArchive, FileCheck2, FileText, FileX, Forward, Mail, ReceiptText } from 'lucide-react'
import type { IssuedDocument } from '../../types'
import { CitizenPdfActions } from './CitizenPdfActions'
import {
  citizenDocumentKind,
  citizenDocumentKindLabels,
  groupCitizenDocuments,
  type CitizenDocumentKind,
} from './citizen-documents'

type Groups = ReturnType<typeof groupCitizenDocuments<IssuedDocument>>

const kindIcons: Record<CitizenDocumentKind, typeof FileText> = {
  APPROVAL: FileCheck2,
  REJECTION: FileX,
  REFERRAL: Forward,
  RECEIPT: ReceiptText,
}

// the archive's own sub-headings (the section heading styles stop at h2)
const groupHeading: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  margin: '18px 0 4px',
  fontFamily: 'var(--ds-font-ui)',
  fontSize: 'var(--ds-text-base)',
  fontWeight: 700,
}
const groupNote: CSSProperties = { margin: '0 0 10px', color: 'var(--ds-text-muted)', fontSize: 'var(--ds-text-sm)' }
// a decision or letter is not an approval: no success-green tick next to it
const correspondenceIcon: CSSProperties = { background: 'var(--ds-info-soft)', color: 'var(--ds-info)' }

const issuedOn = (document: IssuedDocument) => new Date(document.issuedAt).toLocaleString('en-GB')

/**
 * «وثائقي» on the citizen dashboard: approval documents («الوثائق المعتمدة») apart from the decisions and letters a
 * request produced on its way («قرارات ومراسلات»: قرار رفض، كتاب إحالة، وصل استلام), revoked ones last. The groups
 * come from the dashboard, so its «وثائق معتمدة» count and this list are the same list.
 */
export function CitizenDocumentArchive({ groups }: { groups: Groups }) {
  const { approvals, correspondence, revoked } = groups
  const revokedApprovals = revoked.some(document => citizenDocumentKind(document) === 'APPROVAL')
  return (
    <section className="citizen-issued-documents" id="issued-documents">
      <header className="citizen-section-heading compact">
        <div>
          <span className="section-kicker">الأرشيف الرقمي</span>
          <h2>وثائقي</h2>
          <p>ملفات PDF الأصلية التي أصدرتها الدوائر لك، محفوظة في الأرشيف ويمكن التحقق منها برمز QR.</p>
        </div>
        <FileArchive />
      </header>

      <div className="citizen-issued-group" aria-labelledby="approved-documents-title">
        <h3 id="approved-documents-title" style={groupHeading}>
          <FileCheck2 aria-hidden="true" size={18} /> الوثائق المعتمدة{' '}
          <span className="tq-badge is-success">{approvals.length.toLocaleString('en-US')}</span>
        </h3>
        <p style={groupNote}>تصدر عند موافقة الدائرة على طلبك: الإجازات والموافقات والشهادات النافذة.</p>
        {approvals.length === 0 ? (
          <div className="citizen-empty compact">
            <FileCheck2 />
            <div>
              <strong>{revokedApprovals ? 'لا توجد وثائق معتمدة سارية' : 'لا توجد وثائق معتمدة بعد'}</strong>
              <span>تظهر الوثيقة هنا تلقائياً عند موافقة الدائرة على طلبك وإصدارها.</span>
            </div>
          </div>
        ) : (
          <div className="citizen-issued-document-list">
            {approvals.map(document => (
              <article key={document.id}>
                <span>
                  <FileCheck2 />
                </span>
                <div>
                  <small>
                    {document.documentNumber} • {issuedOn(document)}
                  </small>
                  <h3>{document.documentTitle}</h3>
                  <p>
                    {document.departmentName} • {document.serviceName}
                  </p>
                </div>
                <CitizenPdfActions document={document} compact />
              </article>
            ))}
          </div>
        )}
      </div>

      {correspondence.length > 0 && (
        <div className="citizen-issued-group" aria-labelledby="decision-documents-title">
          <h3 id="decision-documents-title" style={groupHeading}>
            <Mail aria-hidden="true" size={18} /> قرارات ومراسلات{' '}
            <span className="tq-badge is-info">{correspondence.length.toLocaleString('en-US')}</span>
          </h3>
          <p style={groupNote}>
            قرارات الرفض وكتب الإحالة ووصولات الاستلام التي أصدرتها الدائرة خلال معاملاتك. وثائق رسمية قابلة للتحقق،
            لكنها ليست وثائق اعتماد.
          </p>
          <div className="citizen-issued-document-list">
            {correspondence.map(document => {
              const kind = citizenDocumentKind(document)
              const Icon = kindIcons[kind]
              return (
                <article key={document.id} data-kind={kind.toLowerCase()}>
                  <span style={correspondenceIcon}>
                    <Icon />
                  </span>
                  <div>
                    <small>
                      {citizenDocumentKindLabels[kind]} • {document.documentNumber} • {issuedOn(document)}
                    </small>
                    <h3>{document.documentTitle}</h3>
                    <p>
                      {document.departmentName} • {document.serviceName}
                    </p>
                  </div>
                  <CitizenPdfActions document={document} compact />
                </article>
              )
            })}
          </div>
        </div>
      )}

      {revoked.length > 0 && (
        <div className="citizen-issued-revoked-group" aria-labelledby="revoked-documents-title">
          <h3 id="revoked-documents-title">
            <Ban /> وثائق ملغاة — لا يُعتمد عليها
          </h3>
          <div className="citizen-issued-document-list">
            {revoked.map(document => (
              <article key={document.id} className="is-revoked">
                <span>
                  <Ban />
                </span>
                <div>
                  <small>
                    {citizenDocumentKindLabels[citizenDocumentKind(document)]} • {document.documentNumber} •{' '}
                    {issuedOn(document)}
                  </small>
                  <h3>
                    {document.documentTitle} <em className="citizen-issued-revoked-badge">ملغاة</em>
                  </h3>
                  <p>
                    {document.departmentName} • {document.serviceName}
                  </p>
                  <p className="citizen-issued-revoked-reason" role="note">
                    أُلغيت هذه الوثيقة من قِبل {document.departmentName}
                    {document.revokedReason ? `: ${document.revokedReason}` : ''}. لا تقدّمها لأي جهة؛ صفحة التحقق
                    تظهرها «ملغاة».
                  </p>
                </div>
                <CitizenPdfActions document={document} compact />
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
