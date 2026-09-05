import { useEffect, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, Eye, FileArchive, Fingerprint, MapPin, X } from 'lucide-react'
import { api } from '../../api'

export function IdentityReviewPanel() {
  type Review = {
    id: string
    status: string
    citizenName: string
    phoneMasked: string
    nationalIdMasked: string
    consentAt: string
    submittedAt: string
    retentionUntil: string
    notes: string | null
    location: { lat: number; lng: number; accuracyM: number | null; updatedAt: string | null } | null
    extractedFields: {
      documentTypeDetected: string | null
      fullName: string | null
      documentNumber: string | null
      dateOfBirth: string | null
      nationality: string | null
      sex: string | null
      expiryDate: string | null
    } | null
    screening: {
      qualityStatus: string
      qualityScore: number | null
      qualityChecks: Array<{ key: string; label: string; passed: boolean; detail: string }>
      faceMatchStatus: string
      faceMatchScore: number | null
      faceMatchProvider: string | null
    }
    media: Array<{ id: string; label: string; mimeType: string; sizeBytes: number }>
  }
  const [reviews, setReviews] = useState<Review[]>([])
  const [selected, setSelected] = useState<Review | null>(null)
  const [mediaUrls, setMediaUrls] = useState<Record<string, { url: string; mimeType: string }>>({})
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setBusy(true)
    setError('')
    try {
      const items = await api.listIdentityReviews()
      setReviews(items)
      setSelected(current => items.find(item => item.id === current?.id) || items[0] || null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void load()
    const refreshReviews = () => void load()
    window.addEventListener('employee-work-queue-updated', refreshReviews)
    return () => window.removeEventListener('employee-work-queue-updated', refreshReviews)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const openMedia = async (mediaId: string) => {
    if (mediaUrls[mediaId]) return
    try {
      const item = await api.loadReviewMedia(mediaId)
      setMediaUrls(current => ({ ...current, [mediaId]: item }))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const decide = async (decision: 'APPROVED' | 'REJECTED' | 'NEEDS_RESUBMISSION') => {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      await api.decideIdentityReview(selected.id, { decision, notes })
      Object.values(mediaUrls).forEach(item => URL.revokeObjectURL(item.url))
      setMediaUrls({})
      setNotes('')
      await load()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  const labels: Record<string, string> = {
    PENDING_REVIEW: 'بانتظار المراجعة',
    APPROVED: 'مقبول يدوياً',
    REJECTED: 'مرفوض',
    NEEDS_RESUBMISSION: 'مطلوب إعادة الرفع',
  }
  return (
    <section className="identity-review-admin">
      <div className="identity-review-head">
        <div>
          <span className="section-kicker">مراجعة الهوية والوسائط</span>
          <h2>ملفات الهوية والفيديو</h2>
          <p>تُسجل مشاهدة كل مرفق وكل قرار باسم الموظف. اتخاذ القرار يتطلب دور «مراجع هوية» أو مدير النظام.</p>
        </div>
        <div className="review-access">
          <button className="button primary" onClick={load} disabled={busy}>
            {busy ? 'جاري التحديث...' : 'تحديث قائمة المراجعة'}
          </button>
        </div>
      </div>
      {error && (
        <div className="form-error">
          <AlertTriangle /> {error}
        </div>
      )}
      {reviews.length > 0 && (
        <div className="identity-review-grid">
          <div className="identity-review-list">
            {reviews.map(review => (
              <button
                key={review.id}
                className={selected?.id === review.id ? 'identity-review-row selected' : 'identity-review-row'}
                onClick={() => {
                  setSelected(review)
                  setNotes(review.notes || '')
                }}
              >
                <span className={review.status === 'PENDING_REVIEW' ? 'review-status pending' : 'review-status'}>
                  {labels[review.status] || review.status}
                </span>
                <strong>{review.citizenName}</strong>
                <small>
                  {review.nationalIdMasked} • {review.phoneMasked}
                </small>
                <time>{new Date(review.submittedAt).toLocaleString('en-GB')}</time>
              </button>
            ))}
          </div>
          <div className="identity-review-detail">
            {selected && (
              <>
                <div className="review-citizen-title">
                  <div>
                    <span className="review-status pending">{labels[selected.status] || selected.status}</span>
                    <h3>{selected.citizenName}</h3>
                    <p>
                      {selected.nationalIdMasked} • {selected.phoneMasked}
                    </p>
                  </div>
                  <small>الاحتفاظ حتى: {new Date(selected.retentionUntil).toLocaleString('en-GB')}</small>
                </div>
                {selected.extractedFields && (
                  <section className="review-extracted-document">
                    <header>
                      <span className="section-kicker">OCR محمي</span>
                      <h4>بيانات المستند المقروءة</h4>
                    </header>
                    <div className="review-data-grid">
                      <span>
                        <small>نوع المستند</small>
                        <strong>{selected.extractedFields.documentTypeDetected || 'غير محدد'}</strong>
                      </span>
                      <span>
                        <small>الاسم</small>
                        <strong>{selected.extractedFields.fullName || 'لم يُستخرج'}</strong>
                      </span>
                      <span>
                        <small>رقم المستند</small>
                        <strong dir="ltr">{selected.extractedFields.documentNumber || 'لم يُستخرج'}</strong>
                      </span>
                      <span>
                        <small>تاريخ الميلاد</small>
                        <strong dir="ltr">{selected.extractedFields.dateOfBirth || 'لم يُستخرج'}</strong>
                      </span>
                      <span>
                        <small>الجنسية</small>
                        <strong>{selected.extractedFields.nationality || 'لم تُستخرج'}</strong>
                      </span>
                      <span>
                        <small>الجنس</small>
                        <strong>{selected.extractedFields.sex || 'لم يُستخرج'}</strong>
                      </span>
                      <span>
                        <small>تاريخ الانتهاء</small>
                        <strong dir="ltr">{selected.extractedFields.expiryDate || 'غير منطبق أو لم يُستخرج'}</strong>
                      </span>
                    </div>
                  </section>
                )}
                {selected.location && (
                  <section className="review-location-card">
                    <MapPin />
                    <div>
                      <strong>موقع الجهاز المصرح به</strong>
                      <small>
                        الدقة التقريبية:{' '}
                        {selected.location.accuracyM
                          ? `${Math.round(selected.location.accuracyM).toLocaleString('en-US')} م`
                          : 'غير متاحة'}
                        {selected.location.updatedAt
                          ? ` • ${new Date(selected.location.updatedAt).toLocaleString('en-GB')}`
                          : ''}
                      </small>
                    </div>
                    <a
                      className="button outline"
                      href={`https://www.openstreetmap.org/?mlat=${selected.location.lat}&mlon=${selected.location.lng}#map=17/${selected.location.lat}/${selected.location.lng}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MapPin /> فتح الموقع
                    </a>
                  </section>
                )}
                <div className="identity-screening-panel">
                  <div className="screening-score">
                    <span>{selected.screening.qualityScore?.toLocaleString('en-US') || '—'}%</span>
                    <div>
                      <strong>فحص جودة آلي</strong>
                      <small>
                        {selected.screening.qualityStatus === 'PASSED'
                          ? 'اكتملت اختبارات الملف قبل الحفظ'
                          : 'تحتاج الوسائط إلى إعادة تصوير'}
                      </small>
                    </div>
                  </div>
                  <div className="screening-checks">
                    {selected.screening.qualityChecks.map(item => (
                      <span className={item.passed ? 'passed' : 'failed'} key={item.key}>
                        {item.passed ? <Check /> : <X />}
                        <b>{item.label}</b>
                        <small>{item.detail}</small>
                      </span>
                    ))}
                  </div>
                  <div className="face-match-boundary">
                    <Fingerprint />
                    <div>
                      <strong>مطابقة الوجه بالهوية</strong>
                      <span>
                        {selected.screening.faceMatchStatus === 'MATCH_ASSISTED'
                          ? `ظهر تشابه تقني أولي${selected.screening.faceMatchScore !== null ? ` (${(selected.screening.faceMatchScore * 100).toFixed(0)}%)` : ''}؛ القرار النهائي للمراجع البشري.`
                          : selected.screening.faceMatchStatus === 'NO_MATCH_ASSISTED'
                            ? 'نتيجة التشابه تحتاج تدقيقاً إضافياً؛ لا يُرفض المواطن تلقائياً.'
                            : 'لم تتوفر نتيجة تشابه تقنية من المزود؛ راجع صورة المستند وفيديو الوجه يدوياً قبل القرار.'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="review-media-grid">
                  {selected.media.map(media => (
                    <article key={media.id} className="review-media-card">
                      <div>
                        <span>
                          <FileArchive />
                        </span>
                        <strong>{media.label}</strong>
                        <small>
                          {media.mimeType} • {(media.sizeBytes / 1024).toFixed(1)} KB
                        </small>
                      </div>
                      {mediaUrls[media.id] ? (
                        mediaUrls[media.id].mimeType.startsWith('video/') ? (
                          <video src={mediaUrls[media.id].url} controls playsInline />
                        ) : (
                          <img src={mediaUrls[media.id].url} alt={media.label} />
                        )
                      ) : (
                        <button className="button outline" onClick={() => openMedia(media.id)}>
                          <Eye /> فتح الوسيط
                        </button>
                      )}
                    </article>
                  ))}
                </div>
                {selected.status === 'PENDING_REVIEW' && (
                  <>
                    <label className="review-notes">
                      ملاحظة المراجع
                      <textarea
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        maxLength={1000}
                        placeholder="اكتب ملاحظة القرار أو سبب طلب إعادة الرفع"
                      />
                    </label>
                    <div className="review-actions identity-decisions">
                      <button className="button outline danger" onClick={() => decide('REJECTED')} disabled={busy}>
                        رفض
                      </button>
                      <button className="button outline" onClick={() => decide('NEEDS_RESUBMISSION')} disabled={busy}>
                        طلب إعادة الرفع
                      </button>
                      <button className="button primary" onClick={() => decide('APPROVED')} disabled={busy}>
                        <CheckCircle2 /> اعتماد بعد المراجعة
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
