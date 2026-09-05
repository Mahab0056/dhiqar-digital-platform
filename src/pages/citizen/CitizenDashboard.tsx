import { useEffect, useMemo, useState } from 'react'
import { Link } from 'wouter'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronLeft,
  CreditCard,
  ReceiptText,
  FileArchive,
  FileCheck2,
  FileText,
  MessageSquareWarning,
  Plus,
  Search,
} from 'lucide-react'
import { api } from '../../api'
import { services, statusLabels } from '../../data'
import { getServiceDefinition } from '../../service-forms'
import type {
  Citizen,
  CitizenNotification,
  CatalogService,
  CitizenServiceRequest,
  GovernmentApplication,
  IssuedDocument,
} from '../../types'
import { CitizenPdfActions } from '../../components/citizen/CitizenPdfActions'
import { PortalLayout } from '../../components/citizen/PortalLayout'

const serviceRequestStatusLabel = (status: string) =>
  status === 'ACTION_REQUIRED'
    ? 'مطلوب استكمال'
    : status === 'APPROVED'
      ? 'تمت المعاملة'
      : status === 'REJECTED'
        ? 'مرفوض'
        : status === 'UNDER_REVIEW'
          ? 'قيد التدقيق'
          : status === 'APPOINTMENT_REQUESTED'
            ? 'طلب موعد'
            : status === 'PAYMENT_PENDING'
              ? 'بانتظار الدفع'
              : 'تم التقديم'

export function CitizenDashboard() {
  const [citizen, setCitizen] = useState<Citizen | null>(null)
  const [applications, setApplications] = useState<GovernmentApplication[]>([])
  const [serviceRequests, setServiceRequests] = useState<CitizenServiceRequest[]>([])
  const [issuedDocuments, setIssuedDocuments] = useState<IssuedDocument[]>([])
  const [notifications, setNotifications] = useState<CitizenNotification[]>([])
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const applyNotifications = (payload: { unread: number; items: CitizenNotification[] }) => {
    setUnreadNotifications(payload.unread)
    setNotifications(payload.items)
  }
  useEffect(() => {
    void Promise.all([
      api.getDemoCitizen().then(setCitizen),
      api.listCitizenApplications().then(setApplications),
      api.listCitizenServiceRequests().then(setServiceRequests),
      api.listIssuedDocuments().then(setIssuedDocuments),
      api.getNotifications().then(applyNotifications),
    ])
  }, [])
  useEffect(() => {
    const receive = (event: Event) =>
      applyNotifications((event as CustomEvent<{ unread: number; items: CitizenNotification[] }>).detail)
    window.addEventListener('citizen-notifications-updated', receive)
    return () => window.removeEventListener('citizen-notifications-updated', receive)
  }, [])
  const readNotification = async (id: string) => applyNotifications(await api.markNotificationRead(id))
  const readAllNotifications = async () => applyNotifications(await api.markAllNotificationsRead())
  const [uploadingServiceReference, setUploadingServiceReference] = useState<string | null>(null)
  const [serviceUploadError, setServiceUploadError] = useState('')
  const uploadServiceDocument = async (
    item: CitizenServiceRequest,
    target: { documentKey?: string; documentName?: string },
    file: File | null
  ) => {
    if (!file) return
    setUploadingServiceReference(`${item.reference}:${target.documentKey || 'extra'}`)
    setServiceUploadError('')
    try {
      const updated = await api.uploadServiceRequestDocument(item.reference, target, file)
      setServiceRequests(current =>
        current.map(request => (request.reference === updated.reference ? updated : request))
      )
      applyNotifications(await api.getNotifications())
    } catch (uploadError) {
      setServiceUploadError((uploadError as Error).message)
    } finally {
      setUploadingServiceReference(null)
    }
  }
  const firstName = citizen?.fullName?.trim().split(/\s+/)[0] || 'بك'
  const actionRequired = applications.find(app => app.status === 'ACTION_REQUIRED')
  const activeApplications = applications.filter(app => !['APPROVED', 'REJECTED'].includes(app.status))
  const nextRequest = serviceRequests[0]
  const serviceActionRequired = serviceRequests.find(
    request => request.status === 'ACTION_REQUIRED' || request.status === 'PAYMENT_PENDING'
  )
  const citizenActionRequired = actionRequired || serviceActionRequired
  const [catalog, setCatalog] = useState<CatalogService[] | null>(null)
  useEffect(() => {
    let active = true
    api
      .listServices()
      .then(items => {
        if (active) setCatalog(items)
      })
      .catch(() => {
        if (active) setCatalog([])
      })
    return () => {
      active = false
    }
  }, [])
  const availableServices = useMemo(
    () =>
      catalog && catalog.length
        ? [...catalog]
            .sort(
              (a, b) =>
                Number(b.mode !== 'CATALOG') - Number(a.mode !== 'CATALOG') ||
                ['ONLINE_SUBMISSION', 'APPOINTMENT_REQUIRED', 'INFORMATION_ONLY'].indexOf(a.channel) -
                  ['ONLINE_SUBMISSION', 'APPOINTMENT_REQUIRED', 'INFORMATION_ONLY'].indexOf(b.channel) ||
                ['OFFICIAL', 'RELIABLE', 'UNVERIFIED'].indexOf(a.sourceQuality) -
                  ['OFFICIAL', 'RELIABLE', 'UNVERIFIED'].indexOf(b.sourceQuality)
            )
            .map(item => ({
              key: item.key,
              title: item.title,
              department: item.departmentName,
              category: item.category,
              description: item.description,
              channel: item.channel,
              mode: item.mode,
            }))
        : services.map(item => ({
            key: item.key,
            title: item.title,
            department: item.department,
            category: item.category,
            description: item.description,
            channel: 'ONLINE_SUBMISSION' as const,
            mode: getServiceDefinition(item.key)?.mode || ('GENERIC' as const),
          })),
    [catalog]
  )
  const [serviceCategory, setServiceCategory] = useState('الكل')
  const [serviceSearch, setServiceSearch] = useState('')
  const [serviceLimit, setServiceLimit] = useState(24)
  const serviceCategories = ['الكل', ...Array.from(new Set(availableServices.map(service => service.category)))]
  const filteredAvailableServices = availableServices.filter(
    service =>
      (serviceCategory === 'الكل' || service.category === serviceCategory) &&
      `${service.title} ${service.department} ${service.description}`
        .toLowerCase()
        .includes(serviceSearch.trim().toLowerCase())
  )
  const shownServices = filteredAvailableServices.slice(0, serviceLimit)
  return (
    <PortalLayout>
      <div className="citizen-v2">
        <section className="citizen-v2-hero">
          <div className="citizen-v2-intro">
            <span className="citizen-v2-kicker">
              <BadgeCheck /> حساب مواطن محمي
            </span>
            <h1>
              أهلاً {firstName}،<br />
              <em>ما الخدمة التي تحتاجها اليوم؟</em>
            </h1>
            <p>خدماتك وطلباتك وإشعاراتك في مكان واحد، بخطوات واضحة من البداية حتى النتيجة.</p>
            <div className="citizen-v2-hero-actions">
              <Link href="#services" className="button primary">
                <BriefcaseBusiness /> تصفح الخدمات
              </Link>
              <Link href="/service/online-appointment" className="button citizen-quiet-button">
                <CalendarDays /> احجز موعد
              </Link>
            </div>
          </div>
          <aside className="citizen-v2-identity-card">
            <div className="identity-card-top">
              <span className="identity-avatar">{firstName.slice(0, 1)}</span>
              <div>
                <small>ملف المواطن</small>
                <strong>{citizen?.fullName || 'جاري تحميل الحساب'}</strong>
              </div>
              <BadgeCheck />
            </div>
            <div className="identity-card-meta">
              <span>
                <small>حالة الهوية</small>
                <b>
                  {citizen?.verificationStatus === 'VERIFIED' || citizen?.verificationStatus === 'VERIFIED_MANUAL'
                    ? 'تمت المراجعة'
                    : 'قيد المراجعة'}
                </b>
              </span>
              <span>
                <small>حماية الحساب</small>
                <b>OTP + جلسة آمنة</b>
              </span>
            </div>
            <Link href="/onboarding" className="identity-card-link">
              إدارة ملف الهوية <ArrowLeft />
            </Link>
          </aside>
        </section>
        <nav className="citizen-v2-quick-actions" aria-label="اختصارات المواطن">
          <Link href="#services">
            <span>
              <Plus />
            </span>
            <div>
              <strong>اختر خدمة</strong>
              <small>كل الخدمات المتاحة</small>
            </div>
            <ArrowLeft />
          </Link>
          <Link href="/service/online-appointment">
            <span>
              <CalendarDays />
            </span>
            <div>
              <strong>حجز موعد</strong>
              <small>اختر وقتك</small>
            </div>
            <ArrowLeft />
          </Link>
          <Link href="/citizen/notifications">
            <span className={unreadNotifications ? 'notification-dot' : ''}>
              <Bell />
            </span>
            <div>
              <strong>الإشعارات</strong>
              <small>{unreadNotifications ? `${unreadNotifications.toLocaleString('en-US')} جديد` : 'أنت مطّلع'}</small>
            </div>
            <ArrowLeft />
          </Link>
          <Link href="/citizen/feedback">
            <span>
              <MessageSquareWarning />
            </span>
            <div>
              <strong>شكوى أو مقترح</strong>
              <small>سجّل طلبك وتابعه</small>
            </div>
            <ArrowLeft />
          </Link>
        </nav>
        <section className="citizen-v2-priority-grid">
          <article className={citizenActionRequired ? 'citizen-priority-card urgent' : 'citizen-priority-card'}>
            <span className="priority-icon">{citizenActionRequired ? <AlertTriangle /> : <CheckCircle2 />}</span>
            <div>
              <small>{citizenActionRequired ? 'إجراء مطلوب منك' : 'حالة حسابك اليوم'}</small>
              <h2>{citizenActionRequired ? citizenActionRequired.currentAction : 'لا يوجد إجراء مطلوب منك حالياً'}</h2>
              <p>
                {citizenActionRequired
                  ? `${actionRequired?.serviceName || serviceActionRequired?.serviceName || 'طلب خدمة'} • ${citizenActionRequired.reference}`
                  : 'توصلك الإشعارات مباشرة عند وصول تحديث جديد من الدائرة.'}
              </p>
            </div>
            {citizenActionRequired ? (
              <Link
                className="button primary"
                href={actionRequired ? `/citizen/application/${actionRequired.reference}` : '#general-requests'}
              >
                إكمال الإجراء <ArrowLeft />
              </Link>
            ) : (
              <Link className="button outline" href="#services">
                ابدأ خدمة <Plus />
              </Link>
            )}
          </article>
          <article className="citizen-progress-card">
            <div>
              <span className="section-kicker">ملخص النشاط</span>
              <h2>صورة سريعة لحسابك</h2>
            </div>
            <div className="progress-stat-row">
              <span>
                <b>{activeApplications.length.toLocaleString('en-US')}</b>
                <small>طلبات جارية</small>
              </span>
              <span>
                <b>{issuedDocuments.length.toLocaleString('en-US')}</b>
                <small>PDF مؤرشف</small>
              </span>
              <span>
                <b>{serviceRequests.length.toLocaleString('en-US')}</b>
                <small>طلبات عامة</small>
              </span>
            </div>
          </article>
        </section>
        <section className="citizen-v2-services service-catalog-direct" id="services">
          <header className="citizen-section-heading">
            <div>
              <span className="section-kicker">دليل الخدمات الرقمية</span>
              <h2>اختر خدمتك من القائمة الكاملة</h2>
              <p>
                {availableServices.length.toLocaleString('en-US')} خدمة من دوائر المحافظة. كل بطاقة تعرض المستمسكات
                المطلوبة وتفتح الاستمارة الخاصة بها، والخدمات الوطنية تفتح بوابتها الرسمية فقط.
              </p>
            </div>
            <Link href="/directory">
              البحث حسب الحاجة <ArrowLeft />
            </Link>
          </header>
          <div className="service-catalog-direct-note">
            <BriefcaseBusiness />
            <span>ترفع المستمسكات داخل الاستمارة مباشرةً، ويدقّقها موظف الدائرة المختصة مستمسكاً مستمسكاً.</span>
          </div>
          <div className="citizen-service-controls">
            <label>
              <Search />
              <input
                value={serviceSearch}
                onChange={event => setServiceSearch(event.target.value)}
                placeholder="ابحث باسم الخدمة أو الدائرة"
                aria-label="البحث في خدمات المواطن"
              />
            </label>
            <nav aria-label="تصفية الخدمات حسب القطاع">
              {serviceCategories.map(category => (
                <button
                  type="button"
                  className={serviceCategory === category ? 'active' : ''}
                  onClick={() => setServiceCategory(category)}
                  key={category}
                >
                  {category}
                </button>
              ))}
            </nav>
            <small>{filteredAvailableServices.length.toLocaleString('en-US')} خدمة مطابقة</small>
          </div>
          {filteredAvailableServices.length ? (
            <div className="citizen-service-deck">
              {shownServices.map(service => {
                const mode = service.mode
                return (
                  <Link
                    href={`/service/${service.key}`}
                    className={`citizen-service-card ${mode === 'SPECIALIZED' ? 'featured' : ''}`}
                    key={service.key}
                  >
                    <div>
                      <span className="service-card-icon">
                        <BriefcaseBusiness />
                      </span>
                      <small>{service.department}</small>
                    </div>
                    <span className="service-card-category">{service.category}</span>
                    <h3>{service.title}</h3>
                    <p>{service.description}</p>
                    <footer>
                      <span>
                        {mode === 'EXTERNAL' || service.channel === 'INFORMATION_ONLY'
                          ? 'التفاصيل والرابط الرسمي'
                          : mode === 'APPOINTMENT'
                            ? 'طلب موعد'
                            : service.channel === 'APPOINTMENT_REQUIRED'
                              ? 'تقديم إلكتروني ثم حضور'
                              : 'فتح الاستمارة'}
                      </span>
                      <ArrowLeft />
                    </footer>
                  </Link>
                )
              })}
              {filteredAvailableServices.length > serviceLimit && (
                <button
                  className="button outline citizen-service-more"
                  type="button"
                  onClick={() => setServiceLimit(value => value + 24)}
                >
                  عرض المزيد ({(filteredAvailableServices.length - serviceLimit).toLocaleString('en-US')})
                </button>
              )}
            </div>
          ) : (
            <div className="citizen-empty service-filter-empty">
              <Search />
              <div>
                <strong>لا توجد خدمة مطابقة</strong>
                <span>جرّب اسماً آخر أو اختر قطاعاً مختلفاً.</span>
              </div>
              <button
                className="button outline"
                type="button"
                onClick={() => {
                  setServiceSearch('')
                  setServiceCategory('الكل')
                }}
              >
                إعادة تعيين
              </button>
            </div>
          )}
        </section>
        <section className="citizen-v2-workspace" id="my-requests">
          <article className="citizen-workspace-card">
            <header className="citizen-section-heading compact">
              <div>
                <span className="section-kicker">معاملاتي</span>
                <h2>تابع معاملاتك</h2>
              </div>
              <Link href="#services">
                اختر خدمة <Plus />
              </Link>
            </header>
            {applications.length === 0 && serviceRequests.length === 0 ? (
              <div className="citizen-empty">
                <FileText />
                <div>
                  <strong>لم تبدأ أي معاملة بعد</strong>
                  <span>ابدأ خدمة وسيظهر رقم المتابعة والحالة هنا.</span>
                </div>
                <Link className="button primary" href="#services">
                  اختر خدمة
                </Link>
              </div>
            ) : applications.length === 0 ? (
              <div className="citizen-application-list">
                {serviceRequests.slice(0, 4).map(item => (
                  <a href="#general-requests" className="citizen-application-row" key={item.reference}>
                    <span className={`citizen-application-icon ${item.status.toLowerCase()}`}>
                      <BriefcaseBusiness />
                    </span>
                    <div>
                      <div>
                        <strong>{item.serviceName || item.serviceKey}</strong>
                        <em className={`status ${item.status.toLowerCase()}`}>
                          {serviceRequestStatusLabel(item.status)}
                        </em>
                      </div>
                      <small>
                        {item.reference} • {item.departmentName || item.department}
                      </small>
                      <p>{item.currentAction}</p>
                    </div>
                    <ChevronLeft />
                  </a>
                ))}
              </div>
            ) : (
              <div className="citizen-application-list">
                {applications.slice(0, 4).map(app => (
                  <Link
                    href={`/citizen/application/${app.reference}`}
                    className="citizen-application-row"
                    key={app.reference}
                  >
                    <span className={`citizen-application-icon ${app.status.toLowerCase()}`}>
                      <BriefcaseBusiness />
                    </span>
                    <div>
                      <div>
                        <strong>{app.serviceName}</strong>
                        <em className={`status ${app.status.toLowerCase()}`}>{statusLabels[app.status]}</em>
                      </div>
                      <small>
                        {app.reference} • {app.department}
                      </small>
                      <p>{app.currentAction}</p>
                    </div>
                    <ChevronLeft />
                  </Link>
                ))}
              </div>
            )}
          </article>
          <aside className="citizen-workspace-card citizen-notification-card" id="notifications">
            <header className="citizen-section-heading compact">
              <div>
                <span className="section-kicker">التحديثات</span>
                <h2>آخر الإشعارات</h2>
              </div>
              {unreadNotifications > 0 && (
                <button className="text-action" onClick={() => void readAllNotifications()}>
                  تعليم الكل كمقروء
                </button>
              )}
            </header>
            {notifications.length === 0 ? (
              <div className="citizen-empty compact">
                <Bell />
                <div>
                  <strong>لا توجد تحديثات جديدة</strong>
                  <span>ستظهر هنا تنبيهات الهوية والطلبات والمواعيد.</span>
                </div>
              </div>
            ) : (
              <div className="citizen-notification-list">
                {notifications.slice(0, 4).map(item =>
                  item.link ? (
                    <Link
                      href={item.link}
                      className={item.readAt ? 'citizen-notification-row read' : 'citizen-notification-row unread'}
                      key={item.id}
                      onClick={() => {
                        if (!item.readAt) void readNotification(item.id)
                      }}
                    >
                      <span>
                        <Bell />
                      </span>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.message}</p>
                        <time>{new Date(item.createdAt).toLocaleString('en-GB')}</time>
                      </div>
                    </Link>
                  ) : (
                    <button
                      className={item.readAt ? 'citizen-notification-row read' : 'citizen-notification-row unread'}
                      key={item.id}
                      onClick={() => void readNotification(item.id)}
                    >
                      <span>
                        <Bell />
                      </span>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.message}</p>
                        <time>{new Date(item.createdAt).toLocaleString('en-GB')}</time>
                      </div>
                    </button>
                  )
                )}
              </div>
            )}
          </aside>
        </section>
        <section className="citizen-issued-documents" id="issued-documents">
          <header className="citizen-section-heading compact">
            <div>
              <span className="section-kicker">الأرشيف الرقمي</span>
              <h2>وثائقي المعتمدة</h2>
              <p>هذه هي ملفات PDF الأصلية المحفوظة في الأرشيف بعد اعتماد الدائرة.</p>
            </div>
            <FileArchive />
          </header>
          {issuedDocuments.length === 0 ? (
            <div className="citizen-empty compact">
              <FileCheck2 />
              <div>
                <strong>لا توجد وثائق PDF مؤرشفة بعد</strong>
                <span>تظهر الوثيقة هنا تلقائياً عند اعتماد الطلب وإصدارها.</span>
              </div>
            </div>
          ) : (
            <div className="citizen-issued-document-list">
              {issuedDocuments.map(document => (
                <article key={document.id}>
                  <span>
                    <FileCheck2 />
                  </span>
                  <div>
                    <small>
                      {document.documentNumber} • {new Date(document.issuedAt).toLocaleString('en-GB')}
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
        </section>
        {serviceRequests.length > 0 && (
          <section className="citizen-service-requests" id="general-requests">
            <header className="citizen-section-heading compact">
              <div>
                <span className="section-kicker">متابعة الخدمات</span>
                <h2>طلبات الخدمات الإلكترونية</h2>
                <p>تابع القرار، سبب الرفض، أو ارفع النواقص مباشرة من هنا.</p>
              </div>
            </header>
            {serviceUploadError && (
              <div className="form-error">
                <AlertTriangle /> {serviceUploadError}
              </div>
            )}
            <div className="citizen-service-request-list">
              {serviceRequests.map(item => {
                const checklist = item.checklist || []
                const closed = ['APPROVED', 'REJECTED'].includes(item.status)
                const needsUpload = checklist.filter(doc => doc.status === 'MISSING' || doc.status === 'REJECTED')
                const extraRequested = item.status === 'ACTION_REQUIRED' && item.requiredDocument && !needsUpload.length
                return (
                  <article key={item.reference} className={`citizen-service-request ${item.status.toLowerCase()}`}>
                    <div className="citizen-service-request-top">
                      <span className="citizen-application-icon">
                        <BriefcaseBusiness />
                      </span>
                      <div>
                        <small>
                          {item.reference} • {item.departmentName || item.department}
                        </small>
                        <h3>{item.serviceName || item.serviceKey}</h3>
                        <p>{item.currentAction}</p>
                      </div>
                      <em className={`status ${item.status.toLowerCase()}`}>
                        {serviceRequestStatusLabel(item.status)}
                      </em>
                    </div>
                    {item.appointment && (
                      <div className="service-decision-note">
                        <CalendarDays />
                        <span>
                          <small>
                            {item.appointment.status === 'CONFIRMED' ? 'موعد مؤكد' : 'موعد بانتظار التأكيد'}
                          </small>
                          <strong>
                            {item.appointment.preferredDate} — {item.appointment.preferredTime}
                            {item.appointment.note ? ` — ${item.appointment.note}` : ''}
                          </strong>
                        </span>
                      </div>
                    )}
                    {item.status === 'PAYMENT_PENDING' &&
                      item.payments?.find(payment => payment.status === 'PENDING') && (
                        <div className="service-required-upload payment-due">
                          <div>
                            <CreditCard />
                            <span>
                              <small>رسم الخدمة</small>
                              <strong>
                                {item.payments
                                  .find(payment => payment.status === 'PENDING')!
                                  .amountIqd.toLocaleString('en-US')}{' '}
                                د.ع
                              </strong>
                            </span>
                          </div>
                          <Link
                            className="button primary"
                            href={`/citizen/pay/${item.payments.find(payment => payment.status === 'PENDING')!.reference}`}
                          >
                            <CreditCard /> سدّد الرسم الآن
                          </Link>
                        </div>
                      )}
                    {item.payments?.some(payment => payment.status === 'PAID') && (
                      <div className="service-request-attachment-summary">
                        <ReceiptText /> إيصال الدفع:{' '}
                        {item.payments
                          .filter(payment => payment.status === 'PAID')
                          .map(payment => `${payment.receiptNumber} (${payment.amountIqd.toLocaleString('en-US')} د.ع)`)
                          .join('، ')}
                      </div>
                    )}
                    {item.decisionNote && (
                      <div className="service-decision-note">
                        <AlertTriangle />
                        <span>
                          <small>{item.status === 'REJECTED' ? 'سبب الرفض' : 'ملاحظة الدائرة'}</small>
                          <strong>{item.decisionNote}</strong>
                        </span>
                      </div>
                    )}
                    {checklist.length > 0 && (
                      <ul className="citizen-checklist">
                        {checklist.map(doc => {
                          const uploading = uploadingServiceReference === `${item.reference}:${doc.key}`
                          const canUpload = !closed && (doc.status === 'MISSING' || doc.status === 'REJECTED')
                          return (
                            <li key={doc.key} className={`checklist-${doc.status.toLowerCase()}`}>
                              <span className={`checklist-badge ${doc.status.toLowerCase()}`}>
                                {doc.status === 'VERIFIED'
                                  ? 'مدقق'
                                  : doc.status === 'UPLOADED'
                                    ? 'بانتظار التدقيق'
                                    : doc.status === 'REJECTED'
                                      ? 'أعد الرفع'
                                      : doc.required
                                        ? 'مطلوب'
                                        : 'اختياري'}
                              </span>
                              <div>
                                <strong>{doc.label}</strong>
                                {doc.status === 'REJECTED' && doc.note && <small>سبب الرفض: {doc.note}</small>}
                              </div>
                              {canUpload && (
                                <label className="button outline small">
                                  <Camera />{' '}
                                  {uploading ? 'جاري الرفع...' : doc.status === 'REJECTED' ? 'إعادة الرفع' : 'رفع'}
                                  <input
                                    hidden
                                    type="file"
                                    accept={doc.accepts.includes('pdf') ? 'image/*,application/pdf' : 'image/*'}
                                    capture="environment"
                                    disabled={uploading}
                                    onChange={event =>
                                      void uploadServiceDocument(
                                        item,
                                        { documentKey: doc.key },
                                        event.target.files?.[0] || null
                                      )
                                    }
                                  />
                                </label>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    {extraRequested && (
                      <div className="service-required-upload">
                        <div>
                          <FileText />
                          <span>
                            <small>المطلوب منك</small>
                            <strong>{item.requiredDocument}</strong>
                          </span>
                        </div>
                        <label className="button primary">
                          <Camera />{' '}
                          {uploadingServiceReference === `${item.reference}:extra`
                            ? 'جاري الرفع...'
                            : 'تصوير / رفع المستند'}
                          <input
                            hidden
                            type="file"
                            accept="image/*,application/pdf"
                            capture="environment"
                            disabled={uploadingServiceReference === `${item.reference}:extra`}
                            onChange={event =>
                              void uploadServiceDocument(
                                item,
                                { documentName: item.requiredDocument || 'المستند المطلوب' },
                                event.target.files?.[0] || null
                              )
                            }
                          />
                        </label>
                      </div>
                    )}
                    {item.attachments && item.attachments.length > 0 && (
                      <div className="service-request-attachment-summary">
                        <FileArchive /> {item.attachments.length.toLocaleString('en-US')} مرفق محفوظ مشفراً ضمن الطلب
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </section>
        )}
        {nextRequest && (
          <section className="citizen-v2-reminder">
            <span>
              <CalendarDays />
            </span>
            <div>
              <small>آخر طلب مسجل</small>
              <strong>{nextRequest.serviceName || nextRequest.serviceKey}</strong>
              <p>{nextRequest.currentAction}</p>
            </div>
            <Link className="button outline" href="/service/online-appointment">
              حجز موعد آخر <ArrowLeft />
            </Link>
          </section>
        )}
      </div>
    </PortalLayout>
  )
}
