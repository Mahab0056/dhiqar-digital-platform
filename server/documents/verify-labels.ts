/**
 * What the public verification page says about a document: its kind and its validity, in neutral words.
 *
 * Not every issued document is an approval: a request also issues a fee receipt, a referral letter and — on
 * rejection — a reasoned rejection decision. A verifier must never read one of those as «معتمد/موافقة»: the
 * document is genuine and in force («سارية»), but what it records is the decision printed on it.
 */

export type DocumentKind = 'APPROVAL' | 'RECEIPT' | 'REJECTION' | 'REFERRAL'
export type DocumentValidity = 'VALID' | 'EXPIRED' | 'REVOKED'

/** The kind of a document as the citizen and the verifier see it. */
export const documentKindLabels: Record<DocumentKind, string> = {
  APPROVAL: 'وثيقة معتمدة',
  RECEIPT: 'وصل استلام',
  REJECTION: 'قرار رفض',
  REFERRAL: 'كتاب إحالة',
}

/** Validity only — never «معتمد»: a valid rejection decision is still a rejection. */
export const validityLabels: Record<DocumentValidity, string> = {
  VALID: 'سارية',
  EXPIRED: 'منتهية',
  REVOKED: 'ملغاة',
}

/**
 * The request step that issued the document (issue_event) decides its kind; a rejection-decision template is a
 * rejection whatever recorded it. Anything else was issued on approval.
 */
export function documentKindOf(issueEvent: unknown, templateId?: unknown): DocumentKind {
  const event = issueEvent ? String(issueEvent) : ''
  if (event === 'RECEIPT' || event === 'REJECTION' || event === 'REFERRAL') return event
  if (templateId && String(templateId) === 'rejection-decision') return 'REJECTION'
  return 'APPROVAL'
}

/**
 * `status` of the verify answer: «APPROVED» is kept for documents issued on an approval (older clients read it),
 * an event document (receipt, referral, rejection) is only «ISSUED», and a revoked one «REVOKED».
 */
export function verificationStatusOf(kind: DocumentKind, validity: DocumentValidity) {
  if (validity === 'REVOKED') return 'REVOKED' as const
  return kind === 'APPROVAL' ? ('APPROVED' as const) : ('ISSUED' as const)
}
