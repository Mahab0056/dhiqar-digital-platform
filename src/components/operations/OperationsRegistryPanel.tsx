import { useState } from 'react'
import {
  AlertTriangle,
  Building2,
  Camera,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileText,
  MessageSquareWarning,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react'
import { formatIQD } from '../../data'
import type { DashboardStats } from '../../types'

export function OperationsRegistryPanel({ stats }: { stats: DashboardStats }) {
  const [cameraDepartment, setCameraDepartment] = useState<DashboardStats['departments'][number] | null>(null)
  return (
    <>
      <section className="ops-registry-grid">
        <article className="dark-panel registry-panel" id="departments">
          <div className="panel-heading">
            <div>
              <h2>سجل دوائر ذي قار</h2>
              <p>
                {stats.registry?.verified || stats.departments.length} جهات بمصادر حكومية متحققة؛ المعاملات محسوبة من
                سجل المنصة.
              </p>
            </div>
            <Building2 />
          </div>
          <div className="registry-department-grid">
            {stats.departments.map(dept => (
              <article className="registry-department-card" key={dept.id}>
                <header>
                  <span className={dept.dataStatus === 'VERIFIED_SOURCE' ? 'verified' : 'pending'} />
                  <div>
                    <strong>{dept.name}</strong>
                    <small>
                      {dept.type} • {dept.gisStatus === 'COORDINATES_VERIFIED' ? 'GIS مكتمل' : 'بانتظار GIS'}
                    </small>
                  </div>
                  {dept.sourceUrl && (
                    <a href={dept.sourceUrl} target="_blank" rel="noreferrer">
                      المصدر
                    </a>
                  )}
                </header>
                <div className="registry-transaction-metrics">
                  <span>
                    <FileText />
                    <small>المقدمة</small>
                    <b>{dept.submitted.toLocaleString('en-US')}</b>
                  </span>
                  <span>
                    <CheckCircle2 />
                    <small>المنجزة</small>
                    <b>{dept.completed.toLocaleString('en-US')}</b>
                  </span>
                  <span>
                    <Clock3 />
                    <small>قيد التدقيق</small>
                    <b>{dept.underReview.toLocaleString('en-US')}</b>
                  </span>
                  <span>
                    <AlertTriangle />
                    <small>نواقص</small>
                    <b>{dept.actionRequired.toLocaleString('en-US')}</b>
                  </span>
                </div>
                <div
                  className={
                    dept.workforce.dataStatus === 'RECORDED_BY_SUPER_ADMIN'
                      ? 'workforce-status recorded'
                      : 'workforce-status awaiting'
                  }
                >
                  <UsersRound />
                  <div>
                    <small>
                      {dept.workforce.dataStatus === 'RECORDED_BY_SUPER_ADMIN'
                        ? 'الموظفون والحضور — مصدر مسجل'
                        : 'الموظفون والحضور'}
                    </small>
                    <strong>
                      {dept.workforce.dataStatus === 'RECORDED_BY_SUPER_ADMIN'
                        ? `${dept.workforce.totalEmployees?.toLocaleString('en-US')} موظف • ${dept.workforce.presentEmployees?.toLocaleString('en-US')} حاضر`
                        : 'بانتظار مصدر حضور مصرح'}
                    </strong>
                    <em>
                      {dept.workforce.dataStatus === 'RECORDED_BY_SUPER_ADMIN'
                        ? `${dept.workforce.sourceName}${dept.workforce.observedAt ? ` • ${new Date(dept.workforce.observedAt).toLocaleString('en-GB')}` : ''}`
                        : 'لا تظهر أعداد أو حالات حضور قبل تسجيلها من الدائرة أو مصدرها المصرح.'}
                    </em>
                  </div>
                  {dept.workforce.sourceUrl && (
                    <a href={dept.workforce.sourceUrl} target="_blank" rel="noreferrer">
                      السند
                    </a>
                  )}
                </div>
                <button type="button" className="camera-status-button" onClick={() => setCameraDepartment(dept)}>
                  <Camera /> {dept.cameras.status === 'READY_FOR_GATEWAY' ? 'حالة البث' : 'حالة الكاميرا'}
                </button>
                {dept.openFeedback > 0 && (
                  <div className="registry-feedback-flag">
                    <MessageSquareWarning /> {dept.openFeedback.toLocaleString('en-US')} بلاغ مفتوح مرتبط بهذه الدائرة
                  </div>
                )}
              </article>
            ))}
          </div>
        </article>
        <article className="dark-panel finance-panel" id="finance">
          <div className="panel-heading">
            <div>
              <h2>المالية والواردات</h2>
              <p>تُعرض فقط عمليات الدفع المسجلة من بوابة دفع معتمدة.</p>
            </div>
            <CircleDollarSign />
          </div>
          <div className="finance-total">
            <small>تحصيل مسجل</small>
            <strong>{formatIQD(stats.financialCollection)}</strong>
          </div>
          <div className="finance-note">
            <ShieldCheck />
            <span>لا توجد تسوية مالية حية أو تحصيل فعلي قبل ربط مزود الدفع وحساب التاجر وWebhook المطابقة.</span>
          </div>
        </article>
      </section>
      {cameraDepartment && (
        <div
          className="camera-status-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={`حالة كاميرات ${cameraDepartment.name}`}
        >
          <button
            className="camera-dialog-backdrop"
            onClick={() => setCameraDepartment(null)}
            aria-label="إغلاق نافذة الكاميرا"
          />
          <article>
            <header>
              <span>
                <Camera />
              </span>
              <div>
                <small>كاميرات الدائرة</small>
                <h3>{cameraDepartment.name}</h3>
              </div>
              <button onClick={() => setCameraDepartment(null)} aria-label="إغلاق">
                <X />
              </button>
            </header>
            <div className="camera-dialog-body">
              <strong>
                {cameraDepartment.cameras.status === 'AWAITING_AUTHORIZATION'
                  ? 'بانتظار ربط كاميرا مصرح بها'
                  : cameraDepartment.cameras.status === 'CONFIGURED_DISABLED'
                    ? 'الكاميرا مهيأة لكنها غير مفعلة'
                    : 'بوابة الكاميرا جاهزة للتكامل'}
              </strong>
              <p>
                {cameraDepartment.cameras.status === 'AWAITING_AUTHORIZATION'
                  ? 'لا توجد كاميرا أو تفويض تشغيل مسجلان لهذه الدائرة بعد. لا يتم عرض بث تجريبي أو رابط كاميرا غير مصرح به.'
                  : cameraDepartment.cameras.status === 'CONFIGURED_DISABLED'
                    ? 'تم حفظ إعداد كاميرا دون تشغيل البث. لا يمكن فتحه قبل تفويض الجهة المالكة وتفعيل بوابة آمنة.'
                    : 'تم تسجيل تفويض وبوابة آمنة، لكن العرض المباشر يحتاج طبقة بث خادمية مصرحاً بها وإدارة صلاحيات قبل إتاحته للمشغلين.'}
              </p>
              <dl>
                <div>
                  <dt>الكاميرات المهيأة</dt>
                  <dd>{cameraDepartment.cameras.configured.toLocaleString('en-US')}</dd>
                </div>
                <div>
                  <dt>المفعلة</dt>
                  <dd>{cameraDepartment.cameras.enabled.toLocaleString('en-US')}</dd>
                </div>
                <div>
                  <dt>المصدر</dt>
                  <dd>{cameraDepartment.cameras.sourceName || 'غير مسجل'}</dd>
                </div>
                {cameraDepartment.cameras.lastCheckedAt && (
                  <div>
                    <dt>آخر فحص</dt>
                    <dd>{new Date(cameraDepartment.cameras.lastCheckedAt).toLocaleString('en-GB')}</dd>
                  </div>
                )}
              </dl>
            </div>
          </article>
        </div>
      )}
    </>
  )
}
