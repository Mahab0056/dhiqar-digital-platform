/**
 * The attachments («المستمسكات») of a citizen's request, as the request page shows them. Once the request is closed
 * — approved, rejected or cancelled — nothing is waiting for review any more and nothing can be re-uploaded: an
 * attachment left «بانتظار التدقيق» or «أعد الرفع» on a closed request tells the citizen to do something that the
 * server would refuse anyway.
 */
export const CLOSED_REQUEST_STATUSES = ['APPROVED', 'REJECTED', 'CANCELLED'] as const

export const isClosedRequest = (status: string) => (CLOSED_REQUEST_STATUSES as readonly string[]).includes(status)

/** Badge of one attachment: its label and the `checklist-badge` tone class. */
export function attachmentBadge(status: string, required: boolean, closed: boolean) {
  if (status === 'VERIFIED') return { label: 'مدقق', tone: 'verified' }
  if (closed) {
    // a refused attachment stays refused; anything still pending simply ended with the request
    if (status === 'REJECTED') return { label: 'مرفوض', tone: 'rejected' }
    return { label: 'أُغلق الطلب', tone: 'closed' }
  }
  if (status === 'UPLOADED') return { label: 'بانتظار التدقيق', tone: 'uploaded' }
  if (status === 'REJECTED') return { label: 'مرفوض — أعد الرفع', tone: 'rejected' }
  return required ? { label: 'مطلوب', tone: 'missing' } : { label: 'اختياري', tone: 'missing' }
}

/** The line under «المستمسكات»: the review/re-upload instructions only while the request is open. */
export function attachmentsIntro(requestStatus: string) {
  switch (requestStatus) {
    case 'APPROVED':
      return 'أُغلق الطلب بالموافقة عليه، فلا حاجة لرفع أي مستمسك. تبقى المستمسكات محفوظة في سجل الطلب.'
    case 'REJECTED':
      return 'أُغلق الطلب برفضه، فلا يُقبل رفع مستمسكات عليه أو استبدالها. لمعالجة أسباب الرفض قدّم طلباً جديداً.'
    case 'CANCELLED':
      return 'أُغلق الطلب بإلغائه، فلا يُقبل رفع مستمسكات عليه.'
    default:
      return 'يدقق موظف الدائرة كل مستمسك على حدة. أعد رفع أي مستمسك مرفوض ليعود الطلب إلى التدقيق.'
  }
}
