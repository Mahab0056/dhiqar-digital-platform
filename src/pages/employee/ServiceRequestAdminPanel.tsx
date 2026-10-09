import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeftRight,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Eye,
  FileCheck2,
  FileWarning,
  Hand,
  Info,
  ReceiptText,
  RefreshCw,
  Search,
  ShieldAlert,
  Undo2,
  UserRound,
  XCircle,
} from 'lucide-react'
import { api, type EmployeeServiceRequest } from '../../api'
import { useSession } from '../../lib/session'
import type { ChecklistItem, CitizenServiceRequest } from '../../types'

const requestStatus: Record<string, string> = {
  SUBMITTED: 'جديد',
  APPOINTMENT_REQUESTED: 'طلب موعد',
  UNDER_REVIEW: 'قيد التدقيق',
  ACTION_REQUIRED: 'بانتظار المواطن',
  APPROVED: 'تمت الموافقة',
  REJECTED: 'مرفوض',
  PAYMENT_PENDING: 'بانتظار الدفع',
}

const checklistStatus: Record<ChecklistItem['status'], string> = {
  MISSING: 'غير مرفوع',
  UPLOADED: 'بانتظار التدقيق',
  VERIFIED: 'مدقق ✓',
  REJECTED: 'مرفوض — يُعاد رفعه',
}

type Decision = 'UNDER_REVIEW' | 'ACTION_REQUIRED' | 'APPROVED' | 'REJECTED' | 'PAYMENT_REQUIRED'
type Sort = 'OLDEST' | 'NEWEST' | 'UPDATED'

const CLOSED = ['APPROVED', 'REJECTED']
// waiting on the citizen (documents or fee) does not count against the department's clock
const WAITING_ON_CITIZEN = ['ACTION_REQUIRED', 'PAYMENT_PENDING']
const HOUR = 3_600_000
const DAY = 86_400_000
type Assignment = 'ALL' | 'MINE' | 'UNASSIGNED'

/**
 * SLA state from the server's per-service deadline (dueAt): red once it has passed, amber within the last 24h.
 * A request waiting on the citizen is paused — the server pushes dueAt forward when it comes back.
 */
type SlaState = 'OVERDUE' | 'DUE_SOON' | 'OK' | 'PAUSED' | 'NONE'
const slaState = (item: CitizenServiceRequest): SlaState => {
  if (CLOSED.includes(item.status)) return 'NONE'
  if (item.slaPaused || WAITING_ON_CITIZEN.includes(item.status)) return 'PAUSED'
  if (!item.dueAt) return 'NONE'
  const left = new Date(item.dueAt).getTime() - Date.now()
  if (item.overdue || left < 0) return 'OVERDUE'
  return left <= 24 * HOUR ? 'DUE_SOON' : 'OK'
}
const isOverdue = (item: CitizenServiceRequest) => slaState(item) === 'OVERDUE'
const span = (ms: number) => {
  const hours = Math.max(1, Math.round(Math.abs(ms) / HOUR))
  if (hours < 24) return hours === 1 ? 'ساعة' : `${hours.toLocaleString('en-US')} ساعة`
  const days = Math.round(hours / 24)
  return days === 1 ? 'يوم' : `${days.toLocaleString('en-US')} أيام`
}
const dueLabel = (item: CitizenServiceRequest) => {
  const state = slaState(item)
  if (state === 'PAUSED') return 'المهلة متوقفة — بانتظار المواطن'
  if (!item.dueAt || state === 'NONE') return ''
  const left = new Date(item.dueAt).getTime() - Date.now()
  return state === 'OVERDUE' ? `متأخر ${span(left)} عن المهلة` : `يستحق خلال ${span(left)}`
}
const ageDays = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / DAY)
const ageLabel = (iso: string) => {
  const days = ageDays(iso)
  if (days <= 0) {
    const hours = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000))
    return hours < 1 ? 'الآن' : `منذ ${hours.toLocaleString('en-US')} ساعة`
  }
  return days === 1 ? 'منذ يوم' : `منذ ${days.toLocaleString('en-US')} أيام`
}
const digits = (value: string) => value.replace(/[^\d]/g, '')
/** A fee is still owed until it is PAID; a cancelled one (closed request) is not. */
const owed = (status: string) => status !== 'PAID' && status !== 'CANCELLED'

export function ServiceRequestAdminPanel({
  departmentId,
  focusReference,
}: {
  /** When set (department dashboard), only this department's requests are shown even for supervisors. */
  departmentId?: string
  /** Reference to open when the list loads / changes. */
  focusReference?: string | null
} = {}) {
  const { session } = useSession()
  const readOnly = session?.role === 'OPERATIONS' || session?.role === 'IDENTITY_REVIEWER'
  const myId = session?.subject || ''
  /** Department manager of this request's department, or the super admin: may assign, release and override. */
  const managesRequest = (item: CitizenServiceRequest | null) =>
    Boolean(item) &&
    (session?.role === 'SUPER_ADMIN' ||
      (session?.role === 'EMPLOYEE' &&
        Boolean(session.isDepartmentManager) &&
        session.departmentId === item?.departmentId))
  const [assignment, setAssignment] = useState<Assignment>('ALL')
  const [staffOptions, setStaffOptions] = useState<Array<{ id: string; fullName: string }>>([])
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([])
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferTo, setTransferTo] = useState('')
  const [transferReason, setTransferReason] = useState('')
  const [notice, setNotice] = useState('')
  const [items, setItems] = useState<CitizenServiceRequest[]>([])
  const [scope, setScope] = useState<{ scope: string; message?: string }>({ scope: 'ALL' })
  const [filter, setFilter] = useState<'OPEN' | 'ALL'>('OPEN')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [serviceFilter, setServiceFilter] = useState('')
  const [sort, setSort] = useState<Sort>('OLDEST')
  const [selected, setSelected] = useState<CitizenServiceRequest | null>(null)
  const [status, setStatus] = useState<Decision>('UNDER_REVIEW')
  const [currentAction, setCurrentAction] = useState('')
  const [decisionNote, setDecisionNote] = useState('')
  const [requiredDocument, setRequiredDocument] = useState('')
  const [appointmentDate, setAppointmentDate] = useState('')
  const [appointmentNote, setAppointmentNote] = useState('')
  const [amountIqd, setAmountIqd] = useState('')
  const [appointmentTime, setAppointmentTime] = useState('')
  const [docNotes, setDocNotes] = useState<Record<string, string>>({})
  // fee paid at the department counter
  const [receiptNumber, setReceiptNumber] = useState('')
  const [receiptAmount, setReceiptAmount] = useState('')
  const [receiptNote, setReceiptNote] = useState('')
  // confirm / move the attendance appointment
  const [slotDate, setSlotDate] = useState('')
  const [slotTime, setSlotTime] = useState('')
  const [slotNote, setSlotNote] = useState('')
  /** null until /api/payments/config answers; false = no online gateway (fees are collected at the office) */
  const [onlinePayments, setOnlinePayments] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const selectItem = useCallback((item: CitizenServiceRequest | null) => {
    setSelected(item)
    setError('')
    setTransferOpen(false)
    setTransferTo('')
    setTransferReason('')
    if (item) {
      // a request waiting for its fee can only be sent back or rejected
      setStatus(
        (item.status === 'PAYMENT_PENDING'
          ? 'ACTION_REQUIRED'
          : item.status === 'SUBMITTED' || item.status === 'APPOINTMENT_REQUESTED'
            ? 'UNDER_REVIEW'
            : item.status) as Decision
      )
      setCurrentAction('')
      setDecisionNote(item.decisionNote || '')
      setRequiredDocument('')
      setAppointmentDate('')
      setAppointmentTime('')
      setAppointmentNote('')
      setAmountIqd('')
      setDocNotes({})
      setReceiptNumber('')
      setReceiptAmount('')
      setReceiptNote('')
      setSlotDate(item.appointment?.preferredDate || '')
      setSlotTime(item.appointment?.preferredTime || '')
      setSlotNote('')
    }
  }, [])

  const selectedRef = useRef<CitizenServiceRequest | null>(null)
  selectedRef.current = selected
  const load = useCallback(
    async (reference?: string) => {
      setBusy(true)
      try {
        const response = await api.listEmployeeServiceRequests()
        setScope({ scope: response.scope, message: response.message })
        const items = departmentId ? response.items.filter(item => item.departmentId === departmentId) : response.items
        setItems(items)
        if (reference) {
          // after the clerk's own decision: open the saved request with a clean form
          selectItem(items.find(item => item.reference === reference) || null)
          return
        }
        // background refresh (live update, manual refresh): fresh data, but the clerk's half-written decision stays
        if (!selectedRef.current) {
          // open the same request the list shows first: the oldest one still waiting on the department
          const firstOpen = items
            .filter(item => !CLOSED.includes(item.status) && !WAITING_ON_CITIZEN.includes(item.status))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
          selectItem(firstOpen || items[0] || null)
        } else setSelected(current => (current && items.find(item => item.reference === current.reference)) || current)
      } catch (loadError) {
        setError((loadError as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [selectItem, departmentId]
  )

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    let cancelled = false
    api
      .getPaymentConfig()
      .then(config => {
        if (!cancelled) setOnlinePayments(config.available)
      })
      .catch(() => {
        if (!cancelled) setOnlinePayments(null)
      })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    if (!focusReference) return
    const match = items.find(item => item.reference === focusReference)
    if (match && match.reference !== selected?.reference) {
      selectItem(match)
      setFilter('ALL')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusReference, items])
  useEffect(() => {
    // only service-request events (or a resync after reconnecting) matter here; bursts collapse into one reload
    let timer = 0
    const refreshQueue = (event: Event) => {
      const entity = (event as CustomEvent<{ entity?: string }>).detail?.entity
      if (entity && entity !== 'SERVICE_REQUEST' && entity !== 'RESYNC') return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void load(), 500)
    }
    window.addEventListener('employee-work-queue-updated', refreshQueue)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('employee-work-queue-updated', refreshQueue)
    }
  }, [load])

  const reviewDocument = async (item: ChecklistItem, verdict: 'VERIFIED' | 'REJECTED') => {
    if (!selected) return
    const note = (docNotes[item.key] || '').trim()
    if (verdict === 'REJECTED' && note.length < 3)
      return setError(`اكتب سبب رفض «${item.label}» حتى يعرف المواطن ما المطلوب.`)
    setBusy(true)
    setError('')
    try {
      const updated = await api.reviewServiceRequestDocument(selected.reference, item.key, {
        status: verdict,
        note: note || undefined,
      })
      setItems(current => current.map(entry => (entry.reference === updated.reference ? updated : entry)))
      setSelected(updated)
    } catch (reviewError) {
      setError((reviewError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Claim / release / assign return the updated request; the rest of the clerk's form is left as typed. */
  const changeAssignment = async (task: () => Promise<CitizenServiceRequest>, message: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const updated = await task()
      setItems(current => current.map(entry => (entry.reference === updated.reference ? updated : entry)))
      setSelected(updated)
      setNotice(message)
    } catch (assignError) {
      setError((assignError as Error).message)
      // someone else may have claimed it in the meantime: show who
      void load()
    } finally {
      setBusy(false)
    }
  }

  const selectedDepartmentId = selected?.departmentId || ''
  const canManageSelected = managesRequest(selected)
  useEffect(() => {
    if (!canManageSelected || !selectedDepartmentId) return
    let cancelled = false
    api
      .listDepartmentStaff(session?.role === 'SUPER_ADMIN' ? selectedDepartmentId : undefined)
      .then(result => {
        if (!cancelled) setStaffOptions(result.items)
      })
      .catch(() => {
        if (!cancelled) setStaffOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [canManageSelected, selectedDepartmentId, session?.role])

  const openTransfer = async () => {
    setTransferOpen(true)
    setError('')
    if (departments.length) return
    try {
      const result = await api.listDepartments()
      setDepartments(result.items.map(item => ({ id: item.id, name: item.name })))
    } catch (listError) {
      setError((listError as Error).message)
    }
  }

  const transfer = async () => {
    if (!selected) return
    if (!transferTo) return setError('اختر الدائرة المختصة.')
    if (transferReason.trim().length < 10)
      return setError('اكتب سبب الإحالة (10 أحرف على الأقل) — يظهر للدائرة المستلمة في سجل الطلب.')
    const target = departments.find(item => item.id === transferTo)?.name || 'الدائرة المختارة'
    if (!window.confirm(`إحالة ${selected.reference} إلى ${target}؟ سيخرج الطلب من قائمة دائرتك ويُبلَّغ المواطن.`))
      return
    setBusy(true)
    setError('')
    try {
      await api.transferServiceRequest(selected.reference, {
        toDepartmentId: transferTo,
        reason: transferReason.trim(),
      })
      setNotice(`أُحيل ${selected.reference} إلى ${target}.`)
      setTransferOpen(false)
      // the request now belongs to another department: it leaves this list (supervisors still see it)
      await load(selected.reference)
    } catch (transferError) {
      setError((transferError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!selected) return
    if (status === 'REJECTED' && decisionNote.trim().length < 6) return setError('اكتب سبب الرفض للمواطن.')
    if (status === 'PAYMENT_REQUIRED' && !(Number(amountIqd) >= 250))
      return setError('أدخل مبلغ الرسم بالدينار (250 د.ع فأكثر).')
    if (currentAction.trim() && currentAction.trim().length < 6)
      return setError('نص الإجراء الظاهر للمواطن قصير جداً — اكتب 6 أحرف على الأقل أو اتركه فارغاً.')
    if (status === 'APPROVED' && pendingRequired.length)
      return setError(`دقّق كل المستمسكات المطلوبة قبل الموافقة: ${pendingRequired.map(doc => doc.label).join('، ')}.`)
    if (status === 'APPROVED' && feeOwed)
      return setError('لا يمكن الموافقة قبل استيفاء رسم الخدمة: سجّل وصل الدفع في الدائرة أولاً.')
    if (status === 'APPROVED' && needsSlot && (!appointmentDate || !appointmentTime))
      return setError('هذه الخدمة تتطلب حضور المواطن: حدد تاريخ ووقت موعد الحضور قبل الموافقة.')
    if (status === 'APPROVED' && appointmentDate && !appointmentTime) return setError('حدد وقت موعد الحضور مع التاريخ.')
    setBusy(true)
    setError('')
    try {
      const updated = await api.updateEmployeeServiceRequest(selected.reference, {
        status,
        currentAction: currentAction.trim().length >= 6 ? currentAction.trim() : undefined,
        decisionNote: decisionNote.trim() || undefined,
        requiredDocument: status === 'ACTION_REQUIRED' && requiredDocument.trim() ? requiredDocument.trim() : undefined,
        appointmentDate: status === 'APPROVED' && appointmentDate ? appointmentDate : undefined,
        appointmentTime: status === 'APPROVED' && appointmentDate && appointmentTime ? appointmentTime : undefined,
        appointmentNote: status === 'APPROVED' && appointmentNote.trim() ? appointmentNote.trim() : undefined,
        amountIqd: status === 'PAYMENT_REQUIRED' ? Math.round(Number(amountIqd)) : undefined,
      })
      await load(updated.reference)
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const checklist = selected?.checklist || []
  const pendingRequired = checklist.filter(item => item.required && item.status !== 'VERIFIED')
  const rejectedDocs = checklist.filter(item => item.status === 'REJECTED')
  const closed = selected ? ['APPROVED', 'REJECTED'].includes(selected.status) : false
  const pendingPayment = selected?.payments?.find(payment => owed(payment.status))
  const paidPayments = selected?.payments?.filter(payment => payment.status === 'PAID') || []
  const detail = selected as EmployeeServiceRequest | null
  /** a fee is still owed: an online intent not paid yet, or an official fee to be collected at the counter */
  const feeOwed = Boolean(pendingPayment) || selected?.paymentStatus === 'PAY_AT_OFFICE'
  const officeDue = pendingPayment
    ? (selected?.payments || []).filter(payment => owed(payment.status)).reduce((sum, item) => sum + item.amountIqd, 0)
    : detail?.feeIqd || 0
  /** an attendance service is approved with a booked slot (unless the request already has one) */
  const needsSlot = detail?.serviceChannel === 'APPOINTMENT_REQUIRED' && !selected?.appointment

  const recordOfficePayment = async () => {
    if (!selected) return
    const amount = Math.round(Number(receiptAmount || officeDue))
    if (receiptNumber.trim().length < 3) return setError('اكتب رقم وصل القبض الصادر من الدائرة (3 أحرف على الأقل).')
    if (!(amount >= 1)) return setError('أدخل المبلغ المستوفى بالدينار.')
    if (officeDue && amount < officeDue)
      return setError(`المبلغ أقل من الرسم المستحق (${officeDue.toLocaleString('en-US')} د.ع).`)
    if (
      !window.confirm(
        `تسجيل وصل ${receiptNumber.trim()} بمبلغ ${amount.toLocaleString('en-US')} د.ع على ${selected.reference}؟`
      )
    )
      return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const updated = await api.recordServiceRequestOfficePayment(selected.reference, {
        receiptNumber: receiptNumber.trim(),
        amountIqd: amount,
        note: receiptNote.trim() || undefined,
      })
      setNotice(`سُجّل وصل ${receiptNumber.trim()} على ${updated.reference} وأُبلغ المواطن.`)
      await load(updated.reference)
    } catch (receiptError) {
      setError((receiptError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const scheduleAppointment = async (action: 'CONFIRM' | 'RESCHEDULE') => {
    if (!selected) return
    if (!slotDate || !slotTime) return setError('حدد تاريخ ووقت الموعد.')
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const updated = await api.scheduleServiceRequestAppointment(selected.reference, {
        action,
        date: slotDate,
        time: slotTime,
        note: slotNote.trim() || undefined,
      })
      setNotice(
        `${action === 'RESCHEDULE' ? 'تغيّر' : 'تأكد'} موعد ${updated.reference}: ${slotDate} الساعة ${slotTime} — أُبلغ المواطن.`
      )
      await load(updated.reference)
    } catch (slotError) {
      setError((slotError as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const services = useMemo(
    () => [...new Map(items.map(item => [item.serviceKey, item.serviceName || item.serviceKey])).entries()],
    [items]
  )
  const visibleItems = useMemo(() => {
    const term = query.trim().toLowerCase()
    const termDigits = digits(query)
    const rank = (item: CitizenServiceRequest) =>
      CLOSED.includes(item.status) ? 2 : WAITING_ON_CITIZEN.includes(item.status) ? 1 : 0
    return items
      .filter(item => filter === 'ALL' || !CLOSED.includes(item.status))
      .filter(item => !statusFilter || item.status === statusFilter)
      .filter(item => !serviceFilter || item.serviceKey === serviceFilter)
      .filter(item =>
        assignment === 'MINE'
          ? item.assignedStaffId === myId
          : assignment === 'UNASSIGNED'
            ? !item.assignedStaffId
            : true
      )
      .filter(
        item =>
          !term ||
          item.reference.toLowerCase().includes(term) ||
          (item.citizenName || '').toLowerCase().includes(term) ||
          (item.serviceName || '').toLowerCase().includes(term) ||
          (termDigits.length >= 3 && digits(item.citizenPhone || '').includes(termDigits))
      )
      .sort((a, b) => {
        // the department's own work first, then what waits on citizens, closed last
        const byRank = rank(a) - rank(b)
        if (byRank) return byRank
        if (sort === 'NEWEST') return b.createdAt.localeCompare(a.createdAt)
        if (sort === 'UPDATED') return b.updatedAt.localeCompare(a.updatedAt)
        return a.createdAt.localeCompare(b.createdAt)
      })
  }, [items, filter, statusFilter, serviceFilter, query, sort, assignment, myId])
  const openCount = items.filter(item => !CLOSED.includes(item.status)).length
  const overdueCount = items.filter(isOverdue).length
  const dueSoonCount = items.filter(item => slaState(item) === 'DUE_SOON').length
  const openItems = items.filter(item => !CLOSED.includes(item.status))
  const mineCount = openItems.filter(item => item.assignedStaffId === myId).length
  const unassignedCount = openItems.filter(item => !item.assignedStaffId).length
  const filtering = Boolean(query || statusFilter || serviceFilter || assignment !== 'ALL')
  const assignedToOther = Boolean(
    selected?.assignedStaffId && selected.assignedStaffId !== myId && !managesRequest(selected)
  )
  const attachmentFor = (item: ChecklistItem) =>
    selected?.attachments?.find(attachment => attachment.mediaId === item.mediaId) || null

  return (
    <section className="service-requests-admin">
      <header className="service-requests-admin-heading">
        <div>
          <span className="section-kicker">قائمة الدائرة</span>
          <h2>طلبات الخدمات الإلكترونية</h2>
          <p>
            {scope.scope === 'ALL'
              ? 'تعرض هذه القائمة طلبات جميع الدوائر (صلاحية إشراف).'
              : 'تصل هنا طلبات دائرتك فقط. دقّق كل مستمسك، ثم اتخذ القرار — يصل المواطن إشعار فوري.'}
          </p>
        </div>
        <div className="service-requests-admin-tools">
          <div className="gov-segmented" role="group" aria-label="تصفية الطلبات">
            <button className={filter === 'OPEN' ? 'active' : ''} onClick={() => setFilter('OPEN')}>
              المفتوحة <b>{openCount.toLocaleString('en-US')}</b>
            </button>
            <button className={filter === 'ALL' ? 'active' : ''} onClick={() => setFilter('ALL')}>
              الكل <b>{items.length.toLocaleString('en-US')}</b>
            </button>
          </div>
          <button className="button outline" onClick={() => void load()} disabled={busy}>
            <RefreshCw className={busy ? 'spin' : ''} /> تحديث
          </button>
        </div>
      </header>
      <div className="service-requests-filters">
        <label className="service-requests-search">
          <Search aria-hidden="true" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value.slice(0, 80))}
            placeholder="ابحث برقم المعاملة، اسم المواطن، الخدمة أو آخر أرقام الهاتف"
            aria-label="بحث في الطلبات"
          />
        </label>
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="الحالة">
          <option value="">كل الحالات</option>
          {Object.entries(requestStatus).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select value={serviceFilter} onChange={event => setServiceFilter(event.target.value)} aria-label="الخدمة">
          <option value="">كل الخدمات</option>
          {services.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select value={sort} onChange={event => setSort(event.target.value as Sort)} aria-label="الترتيب">
          <option value="OLDEST">الأقدم أولاً</option>
          <option value="NEWEST">الأحدث أولاً</option>
          <option value="UPDATED">آخر تحديث</option>
        </select>
        <div className="gov-segmented" role="group" aria-label="الإسناد">
          {session?.role === 'EMPLOYEE' && (
            <button className={assignment === 'MINE' ? 'active' : ''} onClick={() => setAssignment('MINE')}>
              طلباتي <b>{mineCount.toLocaleString('en-US')}</b>
            </button>
          )}
          <button className={assignment === 'UNASSIGNED' ? 'active' : ''} onClick={() => setAssignment('UNASSIGNED')}>
            غير مسندة <b>{unassignedCount.toLocaleString('en-US')}</b>
          </button>
          <button className={assignment === 'ALL' ? 'active' : ''} onClick={() => setAssignment('ALL')}>
            الكل
          </button>
        </div>
        {overdueCount > 0 && (
          <span className="service-requests-overdue" role="status">
            <AlertTriangle aria-hidden="true" /> {overdueCount.toLocaleString('en-US')} متأخر عن المهلة
          </span>
        )}
        {dueSoonCount > 0 && (
          <span className="service-requests-overdue due-soon" role="status">
            <Clock3 aria-hidden="true" /> {dueSoonCount.toLocaleString('en-US')} يستحق خلال 24 ساعة
          </span>
        )}
      </div>
      {notice && (
        <div className="form-success" role="status">
          <CheckCircle2 /> {notice}
        </div>
      )}
      {scope.scope === 'NONE' && (
        <div className="form-error">
          <AlertTriangle /> {scope.message || 'حسابك غير مرتبط بدائرة بعد.'}
        </div>
      )}
      {error && (
        <div className="form-error" role="alert">
          <AlertTriangle /> {error}
        </div>
      )}
      <div className="service-requests-admin-grid">
        <div className="service-requests-admin-list">
          {visibleItems.length === 0 ? (
            <div className="citizen-empty compact">
              <BriefcaseBusiness />
              <div>
                <strong>
                  {filtering
                    ? 'لا توجد طلبات تطابق البحث'
                    : filter === 'OPEN'
                      ? 'لا توجد طلبات مفتوحة'
                      : 'لا توجد طلبات بعد'}
                </strong>
                <span>
                  {filtering ? 'غيّر كلمة البحث أو الفلاتر.' : 'تظهر الطلبات هنا فور إرسالها من المواطن مع مستمسكاتها.'}
                </span>
              </div>
            </div>
          ) : (
            visibleItems.map(item => {
              const pending = (item.checklist || []).filter(doc => doc.status === 'UPLOADED').length
              const sla = slaState(item)
              return (
                <button
                  key={item.reference}
                  onClick={() => selectItem(item)}
                  aria-current={selected?.reference === item.reference ? 'true' : undefined}
                  className={`service-request-admin-row${selected?.reference === item.reference ? ' active' : ''}${sla === 'OVERDUE' ? ' overdue' : sla === 'DUE_SOON' ? ' due-soon' : ''}`}
                >
                  <span>
                    <BriefcaseBusiness />
                  </span>
                  <div>
                    <div>
                      <strong>{item.serviceName || item.serviceKey}</strong>
                      <em className={`status ${item.status.toLowerCase()}`}>
                        {requestStatus[item.status] || item.status}
                      </em>
                    </div>
                    <small>
                      {item.reference} • {item.citizenName || 'مواطن'}
                      {scope.scope === 'ALL' && item.department ? ` • ${item.department}` : ''}
                    </small>
                    <span className="row-meta">
                      <time dateTime={item.createdAt}>{ageLabel(item.createdAt)}</time>
                      {sla === 'OVERDUE' && <b className="row-overdue">متأخر</b>}
                      {sla === 'DUE_SOON' && <b className="row-due-soon">يستحق اليوم</b>}
                      {item.assignedStaffId ? (
                        <b className={`row-assignee${item.assignedStaffId === myId ? ' mine' : ''}`}>
                          {item.assignedStaffId === myId ? 'طلبي' : `مُسند إلى ${item.assignedStaffName || 'موظف'}`}
                        </b>
                      ) : null}
                      {item.originDepartmentId && item.originDepartmentId !== item.departmentId && (
                        <b className="row-referred">محال</b>
                      )}
                      {(item as EmployeeServiceRequest).escalation && (
                        <b className="row-overdue">{(item as EmployeeServiceRequest).escalation!.label}</b>
                      )}
                    </span>
                    <span className="row-action">
                      {pending ? `${pending.toLocaleString('en-US')} مستمسك بانتظار التدقيق` : item.currentAction}
                    </span>
                  </div>
                </button>
              )
            })
          )}
        </div>
        <div className="service-request-admin-detail">
          {selected ? (
            <>
              <header>
                <div>
                  <span className={`status ${selected.status.toLowerCase()}`}>
                    {requestStatus[selected.status] || selected.status}
                  </span>
                  <h3>{selected.serviceName || selected.serviceKey}</h3>
                  <p>
                    {selected.reference} • {selected.citizenName || 'مواطن'}
                    {selected.citizenPhone ? (
                      <>
                        {' • '}
                        <bdi dir="ltr">{selected.citizenPhone}</bdi>
                      </>
                    ) : null}{' '}
                    • {selected.department || selected.departmentId}
                  </p>
                </div>
                <small>
                  أُرسل {new Date(selected.createdAt).toLocaleString('en-GB')}
                  <br />
                  آخر تحديث {new Date(selected.updatedAt).toLocaleString('en-GB')}
                  {selected.dueAt && !closed && (
                    <>
                      <br />
                      <span className={`sla-due ${slaState(selected).toLowerCase().replace('_', '-')}`}>
                        المهلة {new Date(selected.dueAt).toLocaleString('en-GB')} — {dueLabel(selected)}
                      </span>
                    </>
                  )}
                </small>
              </header>
              <div className="service-request-current-action">
                <Info />
                <span>{selected.currentAction}</span>
              </div>
              {detail?.escalation && (
                <div className="service-request-current-action">
                  <ShieldAlert />
                  <span>
                    <b>{detail.escalation.label}</b> —{' '}
                    {detail.escalation.reason === 'NO_STAFF'
                      ? `لا يوجد موظف فعّال في ${selected.department || 'الدائرة المختصة'}، فظهر الطلب في قائمة ديوان المحافظة حتى لا يضيع. يمكنك استلامه ومعالجته أو إحالته للدائرة المختصة.`
                      : 'تجاوز الطلب مهلته دون أن يستلمه أحد في دائرته، فظهر في قائمة ديوان المحافظة. استلمه أو تابع مع الدائرة المختصة.'}
                  </span>
                </div>
              )}

              <div className="service-request-assignment">
                <UserRound aria-hidden="true" />
                <span
                  className={`assignment-chip${selected.assignedStaffId ? (selected.assignedStaffId === myId ? ' mine' : ' other') : ''}`}
                >
                  {selected.assignedStaffId
                    ? selected.assignedStaffId === myId
                      ? 'مُسند إليك'
                      : `مُسند إلى ${selected.assignedStaffName || 'موظف'}`
                    : 'غير مسند — يستطيع أي موظف في الدائرة استلامه'}
                  {selected.assignedAt ? ` • استُلم ${ageLabel(selected.assignedAt)}` : ''}
                </span>
                {!readOnly && !closed && (
                  <div className="assignment-actions">
                    {!selected.assignedStaffId && session?.role === 'EMPLOYEE' && (
                      <button
                        className="button primary small"
                        disabled={busy}
                        onClick={() =>
                          void changeAssignment(
                            () => api.claimServiceRequest(selected.reference),
                            `استلمت ${selected.reference}. يظهر الآن في «طلباتي».`
                          )
                        }
                      >
                        <Hand /> استلام
                      </button>
                    )}
                    {selected.assignedStaffId && (selected.assignedStaffId === myId || managesRequest(selected)) && (
                      <button
                        className="button outline small"
                        disabled={busy}
                        onClick={() =>
                          void changeAssignment(
                            () => api.releaseServiceRequest(selected.reference),
                            `حُرِّر ${selected.reference} وعاد إلى الطلبات غير المسندة.`
                          )
                        }
                      >
                        <Undo2 /> تحرير
                      </button>
                    )}
                    {managesRequest(selected) && staffOptions.length > 0 && (
                      <select
                        aria-label="إسناد إلى موظف"
                        value=""
                        disabled={busy}
                        onChange={event => {
                          const staffId = event.target.value
                          const name = staffOptions.find(option => option.id === staffId)?.fullName || 'الموظف'
                          if (staffId)
                            void changeAssignment(
                              () => api.assignServiceRequest(selected.reference, staffId),
                              `أُسند ${selected.reference} إلى ${name}.`
                            )
                        }}
                      >
                        <option value="">إسناد إلى…</option>
                        {staffOptions
                          .filter(option => option.id !== selected.assignedStaffId)
                          .map(option => (
                            <option key={option.id} value={option.id}>
                              {option.fullName}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                )}
              </div>

              {(selected.transfers?.length || 0) > 0 && (
                <ul className="service-request-transfers" aria-label="سجل الإحالة">
                  {selected.transfers!.map(entry => (
                    <li key={entry.id}>
                      <ArrowLeftRight aria-hidden="true" />
                      <span>
                        أُحيل من <b>{entry.fromDepartmentName}</b> إلى <b>{entry.toDepartmentName}</b> — {entry.reason}
                        <small>
                          {entry.requestedBy} • {new Date(entry.createdAt).toLocaleString('en-GB')}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {selected.appointment && (
                <div className="service-request-current-action">
                  <CalendarClock />
                  <span>
                    {selected.appointment.status === 'CONFIRMED' ? 'موعد الحضور المؤكد' : 'موعد طلبه المواطن'}:{' '}
                    {selected.appointment.preferredDate} الساعة {selected.appointment.preferredTime} —{' '}
                    {selected.appointment.status === 'CONFIRMED'
                      ? 'مؤكد'
                      : selected.appointment.status === 'CANCELLED'
                        ? 'ملغى'
                        : 'بانتظار التأكيد'}
                    {selected.appointment.note ? ` — ${selected.appointment.note}` : ''}
                  </span>
                </div>
              )}
              {selected.appointment &&
                selected.status !== 'REJECTED' &&
                !readOnly &&
                !assignedToOther &&
                selected.appointment.status !== 'CANCELLED' && (
                  <section className="service-request-update">
                    <h4>
                      <CalendarClock /> {selected.appointment.status === 'CONFIRMED' ? 'تغيير الموعد' : 'تأكيد الموعد'}
                    </h4>
                    <div className="form-grid">
                      <label>
                        التاريخ
                        <input
                          type="date"
                          value={slotDate}
                          min={new Date().toISOString().slice(0, 10)}
                          onChange={event => setSlotDate(event.target.value)}
                        />
                      </label>
                      <label>
                        الوقت
                        <input type="time" value={slotTime} onChange={event => setSlotTime(event.target.value)} />
                      </label>
                    </div>
                    <label>
                      تعليمات الحضور <small>اختيارية — تصل المواطن مع الموعد</small>
                      <input
                        value={slotNote}
                        onChange={event => setSlotNote(event.target.value.slice(0, 300))}
                        placeholder="مثال: الطابق الثاني، شعبة الإصدار، إحضار الأصول"
                      />
                    </label>
                    <div className="transfer-actions">
                      {selected.appointment.status !== 'CONFIRMED' && (
                        <button
                          type="button"
                          className="button primary"
                          disabled={busy}
                          onClick={() => void scheduleAppointment('CONFIRM')}
                        >
                          <CheckCircle2 /> تأكيد الموعد وإشعار المواطن
                        </button>
                      )}
                      <button
                        type="button"
                        className={selected.appointment.status === 'CONFIRMED' ? 'button primary' : 'button outline'}
                        disabled={
                          busy ||
                          (slotDate === selected.appointment.preferredDate &&
                            slotTime === selected.appointment.preferredTime)
                        }
                        onClick={() => void scheduleAppointment('RESCHEDULE')}
                      >
                        <CalendarClock /> تغيير الموعد
                      </button>
                    </div>
                  </section>
                )}

              {selected.paymentStatus === 'PAY_AT_OFFICE' && !pendingPayment && (
                <div className="service-request-current-action">
                  <ReceiptText />
                  <span>
                    رسم رسمي{detail?.feeIqd ? ` (${detail.feeIqd.toLocaleString('en-US')} د.ع)` : ''} يُستوفى في الدائرة
                    (الدفع الإلكتروني غير مفعّل). لا يمكن الموافقة قبل تسجيل وصل القبض أدناه.
                  </span>
                </div>
              )}
              {detail?.officeReceipt && (
                <div className="service-request-current-action closed">
                  <ReceiptText />
                  <span>
                    سُدد الرسم في الدائرة: وصل {detail.officeReceipt.receiptNumber} —{' '}
                    {detail.officeReceipt.amountIqd.toLocaleString('en-US')} د.ع
                    {detail.officeReceipt.recordedAt
                      ? ` — ${new Date(detail.officeReceipt.recordedAt).toLocaleString('en-GB')}`
                      : ''}
                    {detail.officeReceipt.note ? ` — ${detail.officeReceipt.note}` : ''}
                  </span>
                </div>
              )}
              {feeOwed && !closed && !readOnly && !assignedToOther && (
                <section className="service-request-update">
                  <h4>
                    <ReceiptText /> تسجيل وصل دفع في الدائرة
                  </h4>
                  <p className="gov-muted">
                    إن سدّد المواطن الرسم{officeDue ? ` (${officeDue.toLocaleString('en-US')} د.ع)` : ''} في صندوق
                    الدائرة، سجّل رقم وصل القبض هنا: يُغلق أي رابط دفع إلكتروني مفتوح ويعود الطلب للتدقيق ويُبلَّغ
                    المواطن.
                  </p>
                  <div className="form-grid">
                    <label>
                      رقم وصل القبض
                      <input
                        value={receiptNumber}
                        onChange={event => setReceiptNumber(event.target.value.slice(0, 40))}
                        placeholder="مثال: 004512"
                      />
                    </label>
                    <label>
                      المبلغ المستوفى (د.ع)
                      <input
                        inputMode="numeric"
                        value={receiptAmount}
                        onChange={event => setReceiptAmount(event.target.value.replace(/[^\d]/g, ''))}
                        placeholder={officeDue ? String(officeDue) : 'مثال: 5000'}
                      />
                    </label>
                  </div>
                  <label>
                    ملاحظة <small>اختيارية</small>
                    <input
                      value={receiptNote}
                      onChange={event => setReceiptNote(event.target.value.slice(0, 300))}
                      placeholder="مثال: دفع نقدي في شباك الحسابات"
                    />
                  </label>
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy}
                    onClick={() => void recordOfficePayment()}
                  >
                    <ReceiptText /> تسجيل وصل دفع في الدائرة
                  </button>
                </section>
              )}
              {(pendingPayment || paidPayments.length > 0) && (
                <div className={`service-request-current-action ${pendingPayment ? '' : 'closed'}`}>
                  <ReceiptText />
                  <span>
                    {pendingPayment
                      ? `${pendingPayment.status === 'FAILED' ? 'فشلت محاولة الدفع ويمكن للمواطن إعادتها —' : 'بانتظار سداد'} ${pendingPayment.amountIqd.toLocaleString('en-US')} د.ع (${pendingPayment.reference}) — لا يمكن الموافقة قبل التسديد.`
                      : `الرسوم مسددة: ${paidPayments.map(payment => `${payment.receiptNumber} — ${payment.amountIqd.toLocaleString('en-US')} د.ع`).join('، ')}`}
                  </span>
                </div>
              )}
              <section className="service-request-form-data">
                <h4>بيانات الاستمارة</h4>
                {(selected.formEntries?.length || Object.keys(selected.formData).length) > 0 ? (
                  <div>
                    {(
                      selected.formEntries ||
                      Object.entries(selected.formData).map(([key, value]) => ({ key, label: key, value }))
                    ).map(entry => (
                      <span key={entry.key}>
                        <small>{entry.label}</small>
                        <strong>{String(entry.value)}</strong>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="gov-muted">لا توجد حقول إضافية لهذه الخدمة.</p>
                )}
              </section>

              <section className="service-request-checklist">
                <h4>
                  <FileCheck2 /> تدقيق المستمسكات{' '}
                  <small>
                    {checklist.filter(item => item.status === 'VERIFIED').length.toLocaleString('en-US')} /{' '}
                    {checklist.length.toLocaleString('en-US')} مدقق
                  </small>
                </h4>
                {checklist.length === 0 ? (
                  <p className="gov-muted">لا تتطلب هذه الخدمة مستمسكات.</p>
                ) : (
                  <ul>
                    {checklist.map(item => {
                      const attachment = attachmentFor(item)
                      return (
                        <li key={item.key} className={`checklist-${item.status.toLowerCase()}`}>
                          <div className="checklist-head">
                            <div>
                              <strong>
                                {item.label} {!item.required && <em>اختياري</em>}
                              </strong>
                              {item.description && <small>{item.description}</small>}
                            </div>
                            <span className={`checklist-badge ${item.status.toLowerCase()}`}>
                              {checklistStatus[item.status]}
                            </span>
                          </div>
                          {item.note && item.status === 'REJECTED' && (
                            <p className="checklist-note">
                              <FileWarning /> {item.note}
                            </p>
                          )}
                          {item.mediaId && !readOnly && (
                            <div className="checklist-actions">
                              <a
                                className="button outline small"
                                href={`/api/employee/service-requests/${encodeURIComponent(selected.reference)}/media/${encodeURIComponent(item.mediaId)}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Eye /> عرض {attachment?.mimeType === 'application/pdf' ? 'PDF' : 'الصورة'}
                              </a>
                              {!closed && !readOnly && !assignedToOther && item.status === 'UPLOADED' && (
                                <>
                                  <input
                                    value={docNotes[item.key] || ''}
                                    onChange={event =>
                                      setDocNotes(current => ({
                                        ...current,
                                        [item.key]: event.target.value.slice(0, 400),
                                      }))
                                    }
                                    placeholder="ملاحظة (إلزامية عند الرفض)"
                                    aria-label={`ملاحظة على ${item.label}`}
                                  />
                                  <button
                                    className="button primary small"
                                    disabled={busy}
                                    onClick={() => void reviewDocument(item, 'VERIFIED')}
                                  >
                                    <CheckCircle2 /> صحيح
                                  </button>
                                  <button
                                    className="button danger small"
                                    disabled={busy}
                                    onClick={() => void reviewDocument(item, 'REJECTED')}
                                  >
                                    <XCircle /> غير مقبول
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              {!closed && !readOnly && assignedToOther ? (
                <div className="service-request-current-action">
                  <Info />
                  <span>
                    هذا الطلب مُسند إلى {selected.assignedStaffName || 'موظف آخر'} — التدقيق والقرار والإحالة له أو
                    لمدير الدائرة.
                  </span>
                </div>
              ) : !closed && !readOnly ? (
                <section className="service-request-update">
                  <h4>قرار الدائرة</h4>
                  <label>
                    الحالة
                    <select value={status} onChange={event => setStatus(event.target.value as Decision)}>
                      <option value="UNDER_REVIEW" disabled={selected.status === 'PAYMENT_PENDING'}>
                        قيد التدقيق
                      </option>
                      <option value="ACTION_REQUIRED">إعادة للمواطن — نواقص</option>
                      <option
                        value="APPROVED"
                        disabled={pendingRequired.length > 0 || selected.status === 'PAYMENT_PENDING' || feeOwed}
                      >
                        موافقة{' '}
                        {pendingRequired.length
                          ? `(بقي ${pendingRequired.length} مستمسك)`
                          : feeOwed
                            ? '(بانتظار استيفاء الرسم)'
                            : ''}
                      </option>
                      {onlinePayments !== false && (
                        <option
                          value="PAYMENT_REQUIRED"
                          disabled={
                            pendingPayment !== undefined ||
                            selected.status === 'PAYMENT_PENDING' ||
                            onlinePayments === null
                          }
                        >
                          طلب سداد رسم إلكترونياً {pendingPayment ? '(يوجد رسم بانتظار السداد)' : ''}
                        </option>
                      )}
                      <option value="REJECTED">رفض الطلب</option>
                    </select>
                  </label>
                  {onlinePayments === false && (
                    <p className="gov-muted">
                      <Info aria-hidden="true" /> الدفع الإلكتروني غير مفعّل حالياً، لذلك لا يظهر خيار «طلب سداد رسم».
                      إن ترتب رسم على المعاملة فاطلب من المواطن سداده في صندوق الدائرة ثم سجّل وصل القبض على الطلب.
                    </p>
                  )}
                  {status === 'APPROVED' && detail?.issuesDocument === false && (
                    <p className="gov-muted">
                      <Info aria-hidden="true" /> لا تصدر وثيقة PDF لهذه الخدمة (شكوى أو بلاغ أو موعد) — يُبلَّغ المواطن
                      بالقرار وملاحظتك فقط.
                    </p>
                  )}
                  {status === 'PAYMENT_REQUIRED' && (
                    <label>
                      مبلغ الرسم (د.ع)
                      <input
                        inputMode="numeric"
                        value={amountIqd}
                        onChange={event => setAmountIqd(event.target.value.replace(/[^\d]/g, ''))}
                        placeholder="مثال: 25000"
                      />
                      <small>يُرسل للمواطن رابط الدفع الإلكتروني ويعود الطلب إليك بعد التسديد.</small>
                    </label>
                  )}
                  {status === 'ACTION_REQUIRED' && (
                    <>
                      {rejectedDocs.length > 0 && (
                        <p className="gov-muted">
                          سيُطلب من المواطن إعادة رفع: {rejectedDocs.map(doc => doc.label).join('، ')}.
                        </p>
                      )}
                      <label>
                        مستمسك أو إجراء إضافي <small>اختياري إن كانت هناك مستمسكات مرفوضة أعلاه</small>
                        <input
                          value={requiredDocument}
                          onChange={event => setRequiredDocument(event.target.value.slice(0, 160))}
                          placeholder="مثال: مخطط هندسي مختوم من نقابة المهندسين"
                        />
                      </label>
                    </>
                  )}
                  {status === 'APPROVED' && (
                    <div className="form-grid">
                      <label>
                        موعد حضور المواطن{' '}
                        <small>{needsSlot ? 'إلزامي — هذه الخدمة تتطلب الحضور' : 'إن كان الإجراء يتطلب الحضور'}</small>
                        <input
                          type="date"
                          value={appointmentDate}
                          min={new Date().toISOString().slice(0, 10)}
                          onChange={event => setAppointmentDate(event.target.value)}
                        />
                      </label>
                      <label>
                        وقت الحضور
                        <input
                          type="time"
                          value={appointmentTime}
                          onChange={event => setAppointmentTime(event.target.value)}
                        />
                      </label>
                      <label>
                        تعليمات الحضور
                        <input
                          value={appointmentNote}
                          onChange={event => setAppointmentNote(event.target.value.slice(0, 300))}
                          placeholder="مثال: الطابق الثاني، شعبة الإصدار، إحضار الأصول"
                        />
                      </label>
                    </div>
                  )}
                  <label>
                    {status === 'REJECTED'
                      ? 'سبب الرفض (يصل المواطن نصاً)'
                      : status === 'PAYMENT_REQUIRED'
                        ? 'بيان الرسم (يظهر للمواطن مع رابط الدفع)'
                        : 'ملاحظة للمواطن'}{' '}
                    {status !== 'REJECTED' && <small>اختيارية</small>}
                    <textarea
                      value={decisionNote}
                      onChange={event => setDecisionNote(event.target.value.slice(0, 1500))}
                      rows={3}
                      placeholder={
                        status === 'REJECTED' ? 'اكتب سبباً واضحاً وقابلاً للتصحيح' : 'تظهر ضمن تفاصيل الطلب وإشعاره'
                      }
                    />
                  </label>
                  <label>
                    نص الإجراء الظاهر للمواطن <small>اختياري — يُولَّد تلقائياً إن تُرك فارغاً</small>
                    <input
                      value={currentAction}
                      onChange={event => setCurrentAction(event.target.value.slice(0, 500))}
                      placeholder="مثال: اكتمل التدقيق وسيُستدعى المواطن لاستلام الإجازة"
                    />
                  </label>
                  <button className="button primary" onClick={() => void save()} disabled={busy}>
                    <CheckCircle2 /> حفظ القرار وإشعار المواطن
                  </button>
                  <div className="service-request-transfer">
                    {!transferOpen ? (
                      <button
                        type="button"
                        className="button ghost"
                        disabled={busy}
                        onClick={() => void openTransfer()}
                      >
                        <ArrowLeftRight /> إحالة لدائرة أخرى
                      </button>
                    ) : pendingPayment || selected.status === 'PAYMENT_PENDING' ? (
                      <p className="gov-muted">
                        لا يمكن إحالة طلب عليه رسم غير مسدد ({pendingPayment?.reference || 'رسم الخدمة'}) لأن الرسم مسجل
                        باسم هذه الدائرة. انتظر السداد، أو ارفض الطلب مع توجيه المواطن للدائرة المختصة.
                      </p>
                    ) : (
                      <>
                        <h4>إحالة الطلب إلى الدائرة المختصة</h4>
                        <label>
                          الدائرة المختصة
                          <select value={transferTo} onChange={event => setTransferTo(event.target.value)}>
                            <option value="">اختر الدائرة…</option>
                            {departments
                              .filter(item => item.id !== selected.departmentId)
                              .map(item => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          سبب الإحالة <small>إلزامي — يظهر للدائرة المستلمة في سجل الطلب، ولا يُرسل للمواطن</small>
                          <textarea
                            rows={2}
                            value={transferReason}
                            onChange={event => setTransferReason(event.target.value.slice(0, 500))}
                            placeholder="مثال: الطلب يخص شبكة الماء وليس من اختصاص الديوان"
                          />
                        </label>
                        <div className="transfer-actions">
                          <button
                            type="button"
                            className="button primary"
                            disabled={busy}
                            onClick={() => void transfer()}
                          >
                            <ArrowLeftRight /> إحالة وإبلاغ المواطن
                          </button>
                          <button type="button" className="button ghost" onClick={() => setTransferOpen(false)}>
                            إلغاء
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </section>
              ) : readOnly && !closed ? (
                <div className="service-request-current-action">
                  <Info />
                  <span>عرض للمتابعة فقط — القرار وتدقيق المستمسكات من صلاحية موظفي الدائرة.</span>
                </div>
              ) : (
                <div className="service-request-current-action closed">
                  <CheckCircle2 />
                  <span>
                    قرار نهائي بواسطة {selected.decidedBy || 'الدائرة'}
                    {selected.decidedAt ? ` — ${new Date(selected.decidedAt).toLocaleString('en-GB')}` : ''}
                    {selected.decisionNote ? ` — ${selected.decisionNote}` : ''}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="empty-queue">
              <BriefcaseBusiness />
              <p>اختَر طلباً من القائمة لتدقيق مستمسكاته واتخاذ القرار.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
