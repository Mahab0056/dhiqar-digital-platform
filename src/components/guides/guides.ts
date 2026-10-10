/** The in-platform tutorial videos (built by design/videos/make.mjs into public/media). */
export type GuideId = 'register' | 'protect' | 'explainer'

export type Guide = {
  id: GuideId
  title: string
  summary: string
  /** human length, shown on cards and links */
  length: string
}

export const guides: Guide[] = [
  {
    id: 'register',
    title: 'كيف تسجّل في منصة ذي قار الرقمية',
    summary: 'من رقم الموبايل إلى تصوير البطاقة الموحدة وتحقق الوجه، خطوة بخطوة حتى تجهز لوحتك.',
    length: 'دقيقة',
  },
  {
    id: 'protect',
    title: 'احمِ حسابك وبياناتك',
    summary: 'ثماني نصائح: رمز التحقق إلك وحدك، العنوان الرسمي، التحقق من الوثائق، والإبلاغ عن الرسائل المشبوهة.',
    length: 'دقيقة',
  },
  {
    id: 'explainer',
    title: 'تعرّف على المنصة',
    summary: 'كيف تنتقل معاملتك من البحث عن الخدمة إلى الوثيقة الموثّقة برمز QR.',
    length: '٤٠ ثانية',
  },
]

export const guideById = (id: GuideId) => guides.find(guide => guide.id === id) as Guide

export const guideMedia = (id: GuideId) => ({
  mp4: `/media/${id}.mp4`,
  webm: `/media/${id}.webm`,
  captions: `/media/${id}.ar.vtt`,
  poster: `/media/${id}-poster.jpg`,
})
