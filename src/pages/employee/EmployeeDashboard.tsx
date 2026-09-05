import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Bell,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  Eye,
  FileArchive,
  FileText,
  Fingerprint,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import { api } from '../../api'
import { statusLabels } from '../../data'
import type { GovernmentApplication } from '../../types'
import { PortalLayout } from '../../components/citizen/PortalLayout'
import { FeedbackAdminPanel } from './FeedbackAdminPanel'
import { IdentityReviewPanel } from './IdentityReviewPanel'
import { ServiceRequestAdminPanel } from './ServiceRequestAdminPanel'

export function EmployeeDashboard() {
  const [, navigate] = useLocation()
  const todayLabel = new Date().toLocaleDateString('en-GB')
  const [apps, setApps] = useState<GovernmentApplication[]>([])
  const [selected, setSelected] = useState<GovernmentApplication | null>(null)
  const [workQueue, setWorkQueue] = useState({ applications: 0, serviceRequests: 0, identityReviews: 0, total: 0 })
  const [busy, setBusy] = useState(false)
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [openedMedia, setOpenedMedia] = useState<{ url: string; mimeType: string; label: string } | null>(null)
  const [mediaError, setMediaError] = useState('')
  const [reviewError, setReviewError] = useState('')
  const load = useCallback(async () => {
    const [items, summary] = await Promise.all([api.listApplications(), api.getEmployeeWorkQueueSummary()])
    setApps(items)
    setWorkQueue(summary)
    setSelected(current =>
      !current || !items.find(item => item.reference === current.reference)
        ? items[0] || null
        : items.find(item => item.reference === current.reference) || null
    )
  }, [])
  useEffect(() => {
    api
      .getSession()
      .then(session => {
        const allowed =
          session.role === 'EMPLOYEE' || session.role === 'IDENTITY_REVIEWER' || session.role === 'SUPER_ADMIN'
        setAuthenticated(allowed)
        if (allowed) void load()
        else navigate('/staff/login?next=%2Femployee')
      })
      .catch(() => navigate('/staff/login?next=%2Femployee'))
  }, [load, navigate])
  useEffect(() => {
    const refreshQueue = () => {
      void load()
    }
    window.addEventListener('employee-work-queue-updated', refreshQueue)
    return () => window.removeEventListener('employee-work-queue-updated', refreshQueue)
  }, [load])
  const openAttachment = async (mediaId: string, label: string) => {
    setMediaError('')
    try {
      const item = await api.loadReviewMedia(mediaId)
      setOpenedMedia({ ...item, label })
    } catch (error) {
      setMediaError((error as Error).message)
    }
  }
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const act = async (kind: 'request' | 'approve' | 'reject') => {
    if (!selected) return
    setBusy(true)
    setReviewError('')
    try {
      if (kind === 'request') {
        const needsFaceVideo = !selected.attachments.some(item => item.purpose === 'FACE_VIDEO' && item.available)
        await api.requestDocument(selected.reference, needsFaceVideo ? 'فيديو توثيق الوجه القصير' : 'المستند المطلوب')
      } else if (kind === 'reject') {
        await api.rejectApplication(selected.reference, rejectReason.trim())
        setRejectOpen(false)
        setRejectReason('')
      } else await api.approveApplication(selected.reference)
      await load()
    } catch (error) {
      setReviewError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const missingFaceVerification = Boolean(
    selected && !selected.attachments.some(item => item.purpose === 'FACE_VIDEO' && item.available)
  )
  if (authenticated === null)
    return (
      <PortalLayout role="employee">
        <div className="employee-auth-loading">
          <RefreshCw className="spin" />
          <span>جاري التحقق من جلسة الموظف...</span>
        </div>
      </PortalLayout>
    )
  if (!authenticated) return null
  return (
    <PortalLayout role="employee">
      <section className="employee-heading" id="workboard">
        <div>
          <span>اليوم • {todayLabel}</span>
          <h1>لوحة عمل المراجعة</h1>
          <p>هناك {apps.filter(a => a.status !== 'APPROVED').length.toLocaleString('en-US')} معاملات تحتاج مراجعة.</p>
        </div>
        <button className="button outline" onClick={() => void load()} disabled={busy}>
          <RefreshCw /> تحديث قائمة العمل
        </button>
      </section>
      <section className="employee-live-work-queue" aria-live="polite">
        <div>
          <span>
            <BriefcaseBusiness />
          </span>
          <small>معاملات محلية جديدة</small>
          <strong>{workQueue.applications.toLocaleString('en-US')}</strong>
        </div>
        <div>
          <span>
            <FileText />
          </span>
          <small>طلبات خدمات جديدة</small>
          <strong>{workQueue.serviceRequests.toLocaleString('en-US')}</strong>
        </div>
        <div>
          <span>
            <Fingerprint />
          </span>
          <small>مواطنون بانتظار مراجعة الهوية</small>
          <strong>{workQueue.identityReviews.toLocaleString('en-US')}</strong>
        </div>
        <a href="#employee-identity-reviews">
          <ShieldCheck /> فتح مراجعة الهوية
        </a>
      </section>
      <section className="employee-kpis">
        <div>
          <span className="blue">
            <FileText />
          </span>
          <small>جديدة</small>
          <strong>{apps.filter(a => a.status === 'SUBMITTED').length}</strong>
        </div>
        <div>
          <span className="green">
            <Eye />
          </span>
          <small>قيد التدقيق</small>
          <strong>{apps.filter(a => a.status === 'UNDER_REVIEW').length}</strong>
        </div>
        <div>
          <span className="amber">
            <Bell />
          </span>
          <small>بانتظار المواطن</small>
          <strong>{apps.filter(a => a.status === 'ACTION_REQUIRED').length}</strong>
        </div>
        <div>
          <span className="red">
            <Clock3 />
          </span>
          <small>التأخير التشغيلي</small>
          <strong>—</strong>
          <em>بانتظار SLA</em>
        </div>
      </section>
      <div className="employee-workspace" id="employee-applications">
        <section className="work-queue">
          <div className="queue-toolbar">
            <div>
              <h2>قائمة المعاملات</h2>
              <span>{apps.length} نتيجة</span>
            </div>
            <button>
              <Search />
            </button>
          </div>
          {apps.length === 0 ? (
            <div className="empty-queue">
              <FileText />
              <p>لا توجد معاملات. قدّم طلباً من بوابة المواطن أولاً.</p>
            </div>
          ) : (
            apps.map(app => (
              <button
                className={selected?.reference === app.reference ? 'queue-item selected' : 'queue-item'}
                key={app.reference}
                onClick={() => setSelected(app)}
              >
                <div>
                  <strong>{app.serviceName}</strong>
                  <span className={`status ${app.status.toLowerCase()}`}>{statusLabels[app.status]}</span>
                </div>
                <small>
                  {app.reference} • {app.citizenName}
                </small>
                <p>{app.currentAction}</p>
                <time>
                  {new Date(app.updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </time>
              </button>
            ))
          )}
        </section>
        <section className="review-panel">
          {selected ? (
            <>
              <div className="review-header">
                <div>
                  <span className={`status ${selected.status.toLowerCase()}`}>{statusLabels[selected.status]}</span>
                  <h2>{selected.serviceName}</h2>
                  <p>{selected.reference}</p>
                </div>
                <button>
                  <FileArchive />
                </button>
              </div>
              <div className="citizen-access-notice">
                <ShieldCheck />
                <span>
                  <strong>وصول حسب الحاجة الوظيفية</strong>
                  <small>بيانات الهوية الحساسة مخفية، وتم تسجيل فتح المعاملة في سجل التدقيق.</small>
                </span>
              </div>
              <div className="review-section">
                <h3>بيانات المواطن</h3>
                <div className="review-data-grid">
                  <span>
                    <small>الاسم</small>
                    <strong>
                      {selected.citizenName} <BadgeCheck />
                    </strong>
                  </span>
                  <span>
                    <small>الرقم الوطني</small>
                    <strong>********** 4821</strong>
                  </span>
                  <span>
                    <small>القضاء</small>
                    <strong>{selected.district}</strong>
                  </span>
                  <span>
                    <small>حالة الهوية</small>
                    <strong>موثّقة يدوياً أو قيد المراجعة</strong>
                  </span>
                </div>
              </div>
              <div className="review-section">
                <h3>بيانات النشاط</h3>
                <div className="review-data-grid">
                  <span>
                    <small>المحل</small>
                    <strong>{selected.businessName}</strong>
                  </span>
                  <span>
                    <small>النشاط</small>
                    <strong>{selected.activityType}</strong>
                  </span>
                  <span className="wide">
                    <small>العنوان</small>
                    <strong>{selected.address}</strong>
                  </span>
                </div>
              </div>
              <div className="review-section">
                <h3>المستندات والمرفقات</h3>
                {selected.attachments.length === 0 ? (
                  <div className="review-document empty">
                    <FileText />
                    <div>
                      <strong>لا توجد مرفقات محفوظة</strong>
                      <small>هذه معاملة سابقة لم تحفظ مرفقات التوثيق. اطلب استكمال فيديو الوجه قبل اعتمادها.</small>
                    </div>
                  </div>
                ) : (
                  selected.attachments.map(item => (
                    <div className="review-document" key={item.id}>
                      <FileText />
                      <div>
                        <strong>{item.label}</strong>
                        <small>
                          {item.originalName} • {Math.ceil(item.sizeBytes / 1024)} KB • محمي
                        </small>
                      </div>
                      <button
                        type="button"
                        onClick={() => openAttachment(item.mediaId, item.label)}
                        aria-label={`فتح ${item.label}`}
                      >
                        <Eye />
                      </button>
                    </div>
                  ))
                )}
                {mediaError && (
                  <div className="form-error">
                    <AlertTriangle /> {mediaError}
                  </div>
                )}
                {reviewError && (
                  <div className="form-error">
                    <AlertTriangle /> {reviewError}
                  </div>
                )}
                {openedMedia && (
                  <div className="employee-media-preview">
                    <div>
                      <strong>{openedMedia.label}</strong>
                      <button
                        type="button"
                        onClick={() => {
                          URL.revokeObjectURL(openedMedia.url)
                          setOpenedMedia(null)
                        }}
                      >
                        <X />
                      </button>
                    </div>
                    {openedMedia.mimeType.startsWith('video/') ? (
                      <video src={openedMedia.url} controls playsInline />
                    ) : openedMedia.mimeType === 'application/pdf' ? (
                      <iframe src={openedMedia.url} title={openedMedia.label} />
                    ) : (
                      <img src={openedMedia.url} alt={openedMedia.label} />
                    )}
                  </div>
                )}
              </div>
              {missingFaceVerification && (
                <div className="review-verification-required">
                  <AlertTriangle />
                  <span>
                    <strong>لا يمكن اعتماد هذه المعاملة حالياً</strong>
                    <small>
                      لم يُحفظ فيديو توثيق الوجه مع الطلب. اضغط «طلب استكمال التوثيق» ليصل للمواطن إشعار ورابط تصوير
                      الفيديو.
                    </small>
                  </span>
                </div>
              )}
              {selected.status === 'REJECTED' && (
                <div className="review-warning rejected">
                  <AlertTriangle />
                  <span>
                    <strong>معاملة مرفوضة</strong>
                    <small>
                      {selected.rejectionReason}
                      {selected.decidedBy ? ` — بقرار ${selected.decidedBy}` : ''}
                    </small>
                  </span>
                </div>
              )}
              {rejectOpen && selected.status !== 'APPROVED' && selected.status !== 'REJECTED' && (
                <div className="reject-form">
                  <label>
                    سبب الرفض (يُرسل للمواطن ويُسجل باسمك)
                    <textarea
                      value={rejectReason}
                      onChange={event => setRejectReason(event.target.value)}
                      rows={3}
                      placeholder="مثال: الموقع ضمن منطقة سكنية لا يُسمح فيها بالنشاط التجاري المطلوب وفق ضوابط البلدية."
                    />
                  </label>
                  <div className="reject-form-actions">
                    <button
                      className="button danger"
                      disabled={busy || rejectReason.trim().length < 10}
                      onClick={() => void act('reject')}
                    >
                      تأكيد الرفض
                    </button>
                    <button className="button ghost" onClick={() => setRejectOpen(false)} disabled={busy}>
                      إلغاء
                    </button>
                  </div>
                </div>
              )}
              <div className="review-actions">
                {!rejectOpen && selected.status !== 'APPROVED' && selected.status !== 'REJECTED' && (
                  <button className="button ghost" onClick={() => setRejectOpen(true)} disabled={busy}>
                    <X /> رفض مسبب
                  </button>
                )}
                <button
                  className="button outline danger"
                  onClick={() => void act('request')}
                  disabled={busy || selected.status === 'APPROVED' || selected.status === 'REJECTED'}
                >
                  <Bell /> {missingFaceVerification ? 'طلب استكمال التوثيق' : 'طلب مستند'}
                </button>
                <button
                  className="button primary"
                  onClick={() => void act('approve')}
                  disabled={
                    busy ||
                    missingFaceVerification ||
                    selected.status === 'ACTION_REQUIRED' ||
                    selected.status === 'PAYMENT_REQUIRED' ||
                    selected.status === 'APPROVED' ||
                    selected.status === 'REJECTED'
                  }
                >
                  <CheckCircle2 />{' '}
                  {selected.status === 'APPROVED'
                    ? 'تمت الموافقة'
                    : selected.status === 'REJECTED'
                      ? 'مرفوضة'
                      : selected.status === 'PAYMENT_REQUIRED'
                        ? 'بانتظار الدفع'
                        : missingFaceVerification
                          ? 'بانتظار فيديو الوجه'
                          : 'موافقة وإصدار الوثيقة'}
                </button>
              </div>
            </>
          ) : (
            <div className="empty-queue">
              <FileText />
              <p>اختر معاملة لبدء التدقيق.</p>
            </div>
          )}
        </section>
      </div>
      <section id="employee-service-requests" className="employee-anchor-section">
        <ServiceRequestAdminPanel />
      </section>
      <section id="employee-feedback" className="employee-anchor-section">
        <FeedbackAdminPanel />
      </section>
      <section id="employee-archive" className="employee-anchor-section employee-archive-section">
        <header className="employee-anchor-heading">
          <div>
            <span className="section-kicker">سجل المعاملات</span>
            <h2>الأرشيف</h2>
            <p>المعاملات التي أنجزت سابقاً تبقى متاحة للرجوع إليها ضمن صلاحيات الموظف.</p>
          </div>
          <FileArchive />
        </header>
        {apps.filter(app => app.status === 'APPROVED').length === 0 ? (
          <div className="employee-empty-state">
            <FileArchive />
            <div>
              <strong>لا توجد معاملات مؤرشفة حالياً</strong>
              <span>تنتقل المعاملات المعتمدة إلى هذا القسم تلقائياً.</span>
            </div>
          </div>
        ) : (
          <div className="employee-archive-list">
            {apps
              .filter(app => app.status === 'APPROVED')
              .map(app => (
                <article key={app.reference}>
                  <div>
                    <strong>{app.serviceName}</strong>
                    <span>
                      {app.reference} • {app.citizenName}
                    </span>
                  </div>
                  <time>{new Date(app.updatedAt).toLocaleString('en-GB')}</time>
                </article>
              ))}
          </div>
        )}
      </section>
      <section id="employee-activity" className="employee-anchor-section employee-activity-section">
        <header className="employee-anchor-heading">
          <div>
            <span className="section-kicker">متابعة التشغيل</span>
            <h2>سجل الإجراءات</h2>
            <p>يعرض التغييرات المسجلة على المعاملات المتاحة لهذه الجلسة فقط.</p>
          </div>
          <Activity />
        </header>
        {apps.length === 0 ? (
          <div className="employee-empty-state">
            <Activity />
            <div>
              <strong>لا توجد إجراءات مسجلة</strong>
              <span>ستظهر تحديثات المعاملات هنا عند توفرها.</span>
            </div>
          </div>
        ) : (
          <div className="employee-activity-list">
            {apps
              .slice()
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .slice(0, 12)
              .map(app => (
                <article key={`activity-${app.reference}`}>
                  <span className={`status ${app.status.toLowerCase()}`}>{statusLabels[app.status]}</span>
                  <div>
                    <strong>{app.serviceName}</strong>
                    <small>{app.currentAction}</small>
                  </div>
                  <time>{new Date(app.updatedAt).toLocaleString('en-GB')}</time>
                </article>
              ))}
          </div>
        )}
      </section>
      <section id="employee-identity-reviews" className="employee-anchor-section">
        <IdentityReviewPanel />
      </section>
    </PortalLayout>
  )
}
