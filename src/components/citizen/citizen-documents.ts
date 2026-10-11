import type { IssuedDocument } from '../../types'

/**
 * The citizen's archive, split by what each document records. Only a document issued when the department approved
 * the request is «معتمدة»; a rejection decision, a referral letter or a receipt is a decision/correspondence of the
 * request, never counted or listed as an approval. A revoked document of either kind goes to its own group.
 */
export type CitizenDocumentKind = 'APPROVAL' | 'REJECTION' | 'REFERRAL' | 'RECEIPT'

type ArchiveDocument = Pick<IssuedDocument, 'status' | 'issueEvent'>

export const citizenDocumentKindLabels: Record<CitizenDocumentKind, string> = {
  APPROVAL: 'وثيقة معتمدة',
  REJECTION: 'قرار رفض',
  REFERRAL: 'كتاب إحالة',
  RECEIPT: 'وصل استلام',
}

/** null/absent issueEvent = issued on approval (an older API sends no issueEvent: those were all approvals). */
export const citizenDocumentKind = (document: Pick<IssuedDocument, 'issueEvent'>): CitizenDocumentKind =>
  document.issueEvent === 'REJECTION' || document.issueEvent === 'REFERRAL' || document.issueEvent === 'RECEIPT'
    ? document.issueEvent
    : 'APPROVAL'

/** Decisions first (the rejection), then referrals, then receipts; newest first inside a kind. */
const CORRESPONDENCE_ORDER: CitizenDocumentKind[] = ['REJECTION', 'REFERRAL', 'RECEIPT']

export function groupCitizenDocuments<T extends ArchiveDocument & { issuedAt?: string }>(documents: T[]) {
  const active = documents.filter(document => document.status !== 'REVOKED')
  const time = (document: T) => {
    const parsed = Date.parse(document.issuedAt || '')
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return {
    /** «الوثائق المعتمدة»: approval documents/licences still in force — the only ones counted as certified */
    approvals: active.filter(document => citizenDocumentKind(document) === 'APPROVAL'),
    /** «قرارات ومراسلات»: rejection decisions, referral letters, receipts */
    correspondence: active
      .filter(document => citizenDocumentKind(document) !== 'APPROVAL')
      .sort(
        (a, b) =>
          CORRESPONDENCE_ORDER.indexOf(citizenDocumentKind(a)) - CORRESPONDENCE_ORDER.indexOf(citizenDocumentKind(b)) ||
          time(b) - time(a)
      ),
    /** kept in the archive, never presented as valid */
    revoked: documents.filter(document => document.status === 'REVOKED'),
  }
}
