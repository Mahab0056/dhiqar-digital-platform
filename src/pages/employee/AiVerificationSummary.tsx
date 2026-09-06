import { BadgeCheck, Fingerprint, ScanFace, ShieldAlert, Timer, UserCheck } from 'lucide-react'

const faceLabel: Record<string, string> = {
  MATCH: 'الوجه مطابق لصورة الهوية',
  UNCERTAIN: 'تشابه غير حاسم — قارن يدوياً',
  NO_MATCH: 'الوجه لا يطابق صورة الهوية',
  NO_FACE_ON_DOCUMENT: 'لم يُكتشف وجه واضح في صورة الهوية',
  NO_FACE_IN_VIDEO: 'لم يُكتشف وجه في الفيديو',
  FRAMES_UNAVAILABLE: 'تعذر استخراج لقطات من الفيديو',
  UNAVAILABLE: 'محرك المطابقة غير مفعّل على الخادم',
  PENDING: 'جاري فحص الوجه…',
}
const nameLabel: Record<string, string> = {
  MATCH: 'الاسم المكتوب يطابق الاسم على الوثيقة',
  PARTIAL: 'تطابق جزئي — تحقق من الاسم',
  NO_MATCH: 'الاسم المكتوب يختلف عن الوثيقة',
  NO_NAME_ON_DOCUMENT: 'لم يُقرأ اسم من الوثيقة (OCR)',
  PENDING: 'جاري مقارنة الاسم…',
}
const assessmentMeta = {
  READY_TO_APPROVE: { label: 'جاهز للاعتماد — النتائج الآلية متطابقة', tone: 'ok', icon: BadgeCheck },
  NEEDS_ATTENTION: { label: 'يحتاج مراجعة بشرية دقيقة', tone: 'warn', icon: ShieldAlert },
  LIKELY_MISMATCH: { label: 'تحذير: احتمال عدم تطابق', tone: 'danger', icon: ShieldAlert },
  UNAVAILABLE: { label: 'الفحص الآلي غير متاح — قرار يدوي', tone: 'muted', icon: Fingerprint },
  PENDING: { label: 'الفحص الآلي قيد التنفيذ…', tone: 'muted', icon: Timer },
} as const

type Screening = {
  faceMatchStatus: string
  faceMatchScore: number | null
  faceMatchDetails: {
    similarity?: number | null
    framesAnalysed?: number
    framesWithFace?: number
    frameConsistency?: number | null
    error?: string | null
  } | null
  nameMatchStatus: string
  nameMatchScore: number | null
  nameMatch: { extracted?: string | null; method?: string; matchedTokens?: string[] } | null
  autoAssessment: keyof typeof assessmentMeta
}

/** Reviewer-facing summary of the on-server AI checks (face ↔ document, typed name ↔ document name). */
export function AiVerificationSummary({ screening }: { screening: Screening }) {
  const meta = assessmentMeta[screening.autoAssessment] || assessmentMeta.PENDING
  const Icon = meta.icon
  const face = screening.faceMatchDetails || {}
  const faceTone =
    screening.faceMatchStatus === 'MATCH'
      ? 'ok'
      : screening.faceMatchStatus === 'NO_MATCH'
        ? 'danger'
        : screening.faceMatchStatus === 'UNCERTAIN'
          ? 'warn'
          : 'muted'
  const nameTone =
    screening.nameMatchStatus === 'MATCH'
      ? 'ok'
      : screening.nameMatchStatus === 'NO_MATCH'
        ? 'danger'
        : screening.nameMatchStatus === 'PARTIAL'
          ? 'warn'
          : 'muted'
  return (
    <div className={`ai-verification tone-${meta.tone}`}>
      <header>
        <Icon />
        <div>
          <strong>التحقق الآلي (ذكاء اصطناعي محلي)</strong>
          <span>{meta.label}</span>
        </div>
      </header>
      <div className="ai-verification-grid">
        <article className={`ai-check tone-${faceTone}`}>
          <ScanFace />
          <div>
            <b>مطابقة الوجه</b>
            <span>{faceLabel[screening.faceMatchStatus] || screening.faceMatchStatus}</span>
            {screening.faceMatchScore !== null && screening.faceMatchStatus !== 'PENDING' && (
              <div className="ai-meter" aria-label={`ثقة ${screening.faceMatchScore}%`}>
                <i style={{ width: `${Math.max(2, Math.min(100, screening.faceMatchScore))}%` }} />
                <em>{screening.faceMatchScore}%</em>
              </div>
            )}
            {(face.framesAnalysed || 0) > 0 && (
              <small>
                {face.framesWithFace}/{face.framesAnalysed} لقطات فيها وجه
                {typeof face.frameConsistency === 'number'
                  ? ` • اتساق اللقطات ${(face.frameConsistency * 100).toFixed(0)}%`
                  : ''}
              </small>
            )}
            {face.error && <small className="ai-error">{face.error}</small>}
          </div>
        </article>
        <article className={`ai-check tone-${nameTone}`}>
          <UserCheck />
          <div>
            <b>مطابقة الاسم</b>
            <span>{nameLabel[screening.nameMatchStatus] || screening.nameMatchStatus}</span>
            {screening.nameMatchScore !== null && (
              <div className="ai-meter" aria-label={`تطابق ${screening.nameMatchScore}%`}>
                <i style={{ width: `${Math.max(2, Math.min(100, screening.nameMatchScore))}%` }} />
                <em>{screening.nameMatchScore}%</em>
              </div>
            )}
            {screening.nameMatch?.extracted && (
              <small dir="auto">
                على الوثيقة: {screening.nameMatch.extracted}
                {screening.nameMatch.method === 'TRANSLITERATED' ? ' (مقارنة تقريبية عبر النقحرة)' : ''}
              </small>
            )}
          </div>
        </article>
      </div>
      <p className="ai-verification-note">
        النتائج مساعدة فقط؛ الصور لا تغادر الخادم. القرار النهائي بالاعتماد أو الرفض يبقى للمراجع.
      </p>
    </div>
  )
}
