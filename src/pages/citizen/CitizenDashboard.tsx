import { useEffect, useMemo, useState } from 'react'
import { Link } from 'wouter'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  FileArchive,
  FileCheck2,
  FileText,
  MessageSquareWarning,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { api } from '../../api'
import { PushNotificationsCard } from '../../components/citizen/PushNotificationsCard'
import { services } from '../../data'
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
import { GuideVideo } from '../../components/guides/GuideVideo'
import { describeAppointment, isOpenRequest, mergeCitizenRequests, summarizeCitizenRequests } from './my-requests'
import '../../styles/ds/citizen-requests.css'

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
    // a notification means a department touched one of the citizen's requests: refresh the list with it
    const receive = (event: Event) => {
      applyNotifications((event as CustomEvent<{ unread: number; items: CitizenNotification[] }>).detail)
      void api
        .listCitizenServiceRequests()
        .then(setServiceRequests)
        .catch(() => {})
      void api
        .listCitizenApplications()
        .then(setApplications)
        .catch(() => {})
    }
    window.addEventListener('citizen-notifications-updated', receive)
    return () => window.removeEventListener('citizen-notifications-updated', receive)
  }, [])
  const readNotification = async (id: string) => applyNotifications(await api.markNotificationRead(id))
  const readAllNotifications = async () => applyNotifications(await api.markAllNotificationsRead())
  const firstName = citizen?.fullName?.trim().split(/\s+/)[0] || 'بك'
  // one list for applications + service requests: the stats, the attention card and "معاملاتي" all read from it
  const myRequests = useMemo(() => mergeCitizenRequests(applications, serviceRequests), [applications, serviceRequests])
  const requestSummary = summarizeCitizenRequests(myRequests)
  const citizenActionRequired = myRequests.find(item => item.needsAction)
  const [requestFilter, setRequestFilter] = useState<'all' | 'action' | 'open' | 'closed'>('all')
  const [showAllRequests, setShowAllRequests] = useState(false)
  const filteredRequests = myRequests.filter(item =>
    requestFilter === 'action'
      ? item.needsAction
      : requestFilter === 'open'
        ? isOpenRequest(item)
        : requestFilter === 'closed'
          ? !isOpenRequest(item)
          : true
  )
  const shownRequests = showAllRequests ? filteredRequests : filteredRequests.slice(0, 5)
  const appointmentsByReference = new Map(
    serviceRequests.flatMap(item => (item.appointment ? [[item.reference, item.appointment] as const] : []))
  )
  // the appointment the citizen should know about first: confirmed ones, then the earliest still waiting
  const upcomingAppointment = serviceRequests
    .flatMap(item =>
      item.appointment && !['APPROVED', 'REJECTED'].includes(item.status)
        ? [{ request: item, appointment: item.appointment }]
        : []
    )
    .sort(
      (a, b) =>
        Number(b.appointment.status === 'CONFIRMED') - Number(a.appointment.status === 'CONFIRMED') ||
        a.appointment.preferredDate.localeCompare(b.appointment.preferredDate)
    )[0]
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
  // phones get a short deck (the page is one column there); "عرض المزيد" loads the rest
  const [serviceLimit, setServiceLimit] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 720 ? 6 : 9
  )
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
        <header className="app-page-head">
          <div>
            <span className="section-kicker">بوابة المواطن</span>
            <h1>أهلاً {firstName === 'بك' ? 'بك' : firstName}</h1>
            <p>خدماتك وطلباتك ووثائقك وإشعاراتك في مكان واحد.</p>
          </div>
          <div className="app-page-actions">
            <Link href="/service/online-appointment" className="button outline">
              <CalendarDays /> حجز موعد
            </Link>
            <Link href="#services" className="button primary">
              <Plus /> ابدأ خدمة جديدة
            </Link>
          </div>
        </header>

        <section className="cz-overview" aria-label="ملخص الحساب">
          <article className={citizenActionRequired ? 'cz-attention is-urgent' : 'cz-attention'}>
            <span className="cz-attention-icon">{citizenActionRequired ? <AlertTriangle /> : <CheckCircle2 />}</span>
            <div>
              <small>{citizenActionRequired ? 'إجراء مطلوب منك' : 'حالة حسابك اليوم'}</small>
              <h2>{citizenActionRequired ? citizenActionRequired.currentAction : 'لا يوجد إجراء مطلوب منك حالياً'}</h2>
              <p>
                {citizenActionRequired
                  ? `${citizenActionRequired.title} • ${citizenActionRequired.reference}${
                      requestSummary.needsAction > 1 ? ` • و${requestSummary.needsAction - 1} طلب آخر بانتظارك` : ''
                    }`
                  : 'يصلك إشعار فوراً عند وصول أي تحديث من الدائرة.'}
              </p>
            </div>
            {citizenActionRequired && (
              <Link className="button primary" href={citizenActionRequired.href}>
                إكمال الإجراء <ArrowLeft />
              </Link>
            )}
          </article>
          <article className="cz-identity">
            <span className="cz-identity-avatar">{(citizen?.fullName || 'م').slice(0, 1)}</span>
            <div>
              <small>ملف المواطن</small>
              <strong>{citizen?.fullName || 'جاري تحميل الحساب…'}</strong>
              {citizen?.verificationStatus === 'VERIFIED' || citizen?.verificationStatus === 'VERIFIED_MANUAL' ? (
                <span className="tq-badge is-success">
                  <BadgeCheck /> هوية موثّقة
                </span>
              ) : (
                <span className="tq-badge is-warning">التوثيق قيد المراجعة</span>
              )}
            </div>
            <Link href="/onboarding" className="gov-link">
              ملف الهوية <ArrowLeft size={14} />
            </Link>
          </article>
          <dl className="cz-stats">
            <div>
              <dt>طلبات جارية</dt>
              <dd>{requestSummary.open.toLocaleString('en-US')}</dd>
            </div>
            <div>
              <dt>وثائق مؤرشفة</dt>
              <dd>{issuedDocuments.length.toLocaleString('en-US')}</dd>
            </div>
            <div>
              <dt>إشعارات جديدة</dt>
              <dd>{unreadNotifications.toLocaleString('en-US')}</dd>
            </div>
          </dl>
        </section>

        <nav className="cz-shortcuts" aria-label="اختصارات المواطن">
          <Link href="#services">
            <span>
              <BriefcaseBusiness />
            </span>
            <strong>الخدمات</strong>
            <small>كل الخدمات المتاحة</small>
          </Link>
          <Link href="#my-requests">
            <span>
              <FileText />
            </span>
            <strong>معاملاتي</strong>
            <small>تابع حالة طلباتك</small>
          </Link>
          <Link href="#issued-documents">
            <span>
              <FileArchive />
            </span>
            <strong>وثائقي</strong>
            <small>ملفات PDF المعتمدة</small>
          </Link>
          <Link href="/citizen/feedback">
            <span>
              <MessageSquareWarning />
            </span>
            <strong>شكوى أو مقترح</strong>
            <small>سجّل طلبك وتابعه</small>
          </Link>
        </nav>
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
            {myRequests.length === 0 ? (
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
            ) : (
              <>
                <nav className="cz-requests-filter" aria-label="تصفية المعاملات">
                  {(
                    [
                      ['all', `الكل (${requestSummary.total.toLocaleString('en-US')})`],
                      ['action', `يتطلب إجراء منك (${requestSummary.needsAction.toLocaleString('en-US')})`],
                      ['open', `جارية (${requestSummary.open.toLocaleString('en-US')})`],
                      ['closed', 'منتهية'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      type="button"
                      key={key}
                      className={requestFilter === key ? 'active' : ''}
                      aria-pressed={requestFilter === key}
                      onClick={() => {
                        setRequestFilter(key)
                        setShowAllRequests(false)
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                {filteredRequests.length === 0 ? (
                  <div className="citizen-empty compact">
                    <CheckCircle2 />
                    <div>
                      <strong>لا توجد معاملات ضمن هذا التصنيف</strong>
                      <span>اختر «الكل» لعرض جميع معاملاتك.</span>
                    </div>
                  </div>
                ) : (
                  <div className="citizen-application-list">
                    {shownRequests.map(item => {
                      const appointment = appointmentsByReference.get(item.reference)
                      const slot = appointment ? describeAppointment(appointment) : null
                      return (
                        <Link
                          href={item.href}
                          className={
                            item.needsAction ? 'citizen-application-row needs-action' : 'citizen-application-row'
                          }
                          key={`${item.kind}:${item.reference}`}
                        >
                          <span className={`citizen-application-icon ${item.status.toLowerCase()}`}>
                            {item.needsAction ? <AlertTriangle /> : <BriefcaseBusiness />}
                          </span>
                          <div>
                            <div>
                              <strong>{item.title}</strong>
                              <em className={`status ${item.status.toLowerCase()}`}>{item.statusLabel}</em>
                              {item.needsAction && (
                                <span className="cz-needs-action">
                                  <AlertTriangle /> يتطلب إجراء منك
                                </span>
                              )}
                            </div>
                            <small>
                              {item.reference} • {item.department} • آخر تحديث{' '}
                              {new Date(item.updatedAt).toLocaleDateString('en-GB')}
                            </small>
                            <p>{item.currentAction}</p>
                            {slot && (
                              <span
                                className={slot.confirmed ? 'cz-row-appointment is-confirmed' : 'cz-row-appointment'}
                              >
                                <CalendarDays /> {slot.title}: {slot.when}
                              </span>
                            )}
                          </div>
                          <ChevronLeft />
                        </Link>
                      )
                    })}
                    {filteredRequests.length > 5 && (
                      <button
                        type="button"
                        className="button outline cz-requests-more"
                        onClick={() => setShowAllRequests(value => !value)}
                        aria-expanded={showAllRequests}
                      >
                        {showAllRequests ? 'عرض أقل' : `عرض الكل (${filteredRequests.length.toLocaleString('en-US')})`}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </article>
          <aside className="citizen-workspace-card citizen-notification-card" id="notifications">
            <PushNotificationsCard compact />
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
                  onClick={() => setServiceLimit(value => value + 12)}
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
        {upcomingAppointment && (
          <section className="citizen-v2-reminder" id="appointments">
            <span>
              <CalendarDays />
            </span>
            <div>
              <small>{describeAppointment(upcomingAppointment.appointment).title}</small>
              <strong>{upcomingAppointment.request.serviceName || upcomingAppointment.request.serviceKey}</strong>
              <p>
                {describeAppointment(upcomingAppointment.appointment).when} •{' '}
                {upcomingAppointment.request.departmentName || upcomingAppointment.request.department}
              </p>
            </div>
            <Link
              className="button outline"
              href={`/citizen/request/${encodeURIComponent(upcomingAppointment.request.reference)}`}
            >
              تفاصيل الموعد <ArrowLeft />
            </Link>
          </section>
        )}
        <section className="tq-panel guide-promo" aria-labelledby="guide-protect-title">
          <div>
            <span className="section-kicker">
              <ShieldCheck size={15} /> أمان حسابك
            </span>
            <h2 id="guide-protect-title">احمِ حسابك وبياناتك</h2>
            <p>دقيقة وحدة: لا تنطي رمز التحقق لأحد، ادخل فقط من thi-qar.com، وتحقق من أي وثيقة برمز QR.</p>
            <Link href="/guides" className="gov-link">
              كل الفيديوهات التعليمية <ArrowLeft size={14} />
            </Link>
          </div>
          <GuideVideo id="protect" />
        </section>
      </div>
    </PortalLayout>
  )
}
