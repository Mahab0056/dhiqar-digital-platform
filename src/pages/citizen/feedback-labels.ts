export const feedbackStatusLabels: Record<string, string> = {
  RECEIVED: 'تم الاستلام',
  IN_REVIEW: 'قيد المراجعة',
  IN_PROGRESS: 'قيد المعالجة',
  RESOLVED: 'تمت المعالجة',
  CLOSED: 'أُغلق الطلب',
}

export const feedbackCategories = {
  COMPLAINT: ['ماء ومجارٍ', 'بلديات ونظافة', 'طرق وجسور', 'كهرباء وإنارة', 'صحة وبيئة', 'خدمة عامة أخرى'],
  SUGGESTION: ['تحسين خدمة', 'مشروع أو مبادرة', 'تحول رقمي', 'بيئة ومدينة', 'شباب وثقافة', 'مقترح آخر'],
}
