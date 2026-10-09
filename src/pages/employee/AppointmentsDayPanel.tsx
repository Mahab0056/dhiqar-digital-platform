import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { api, type EmployeeAppointment } from '../../api'
import { useSession } from '../../lib/session'

/** YYYY-MM-DD in Baghdad, `offset` days from `from` (default today). */
const baghdadDay = (offset = 0, from?: string) => {
  const base = from ? new Date(`${from}T12:00:00+03:00`) : new Date()
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(base.getTime() + offset * 86_400_000))
}

const weekday = (date: string) =>
  new Date(`${date}T12:00:00+03:00`).toLocaleDateString('ar-IQ', { weekday: 'long', timeZone: 'Asia/Baghdad' })

const requestStatus: Record<string, string> = {
  SUBMITTED: 'جديد',
  APPOINTMENT_REQUESTED: 'طلب موعد',
  UNDER_REVIEW: 'قيد التدقيق',
  ACTION_REQUIRED: 'بانتظار المواطن',
  APPROVED: 'تمت الموافقة',
  PAYMENT_PENDING: 'بانتظار الدفع',
}

/**
 * The department's bookings for one day: requested slots to confirm, confirmed ones to move. Every change notifies
 * the citizen with the confirmed date and time.
 */
export function AppointmentsDayPanel() {
  const { session } = useSession()
  const readOnly = session?.role === 'OPERATIONS' || session?.role === 'IDENTITY_REVIEWER'
  const [date, setDate] = useState(() => baghdadDay())
  const [items, setItems] = useState<EmployeeAppointment[]>([])
  const [scopeMessage, setScopeMessage] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async (day: string) => {
    setBusy(true)
    setError('')
    try {
      const response = await api.listEmployeeAppointments(day)
      setItems(response.items)
      setScopeMessage(response.message || '')
    } catch (loadError) {
      setError((loadError as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load(date)
  }, [date, load])
  useEffect(() => {
    // a confirmation made from the requests tab (or by a colleague) shows up here too
    let timer = 0
    const refresh = (event: Event) => {
      const entity = (event as CustomEvent<{ entity?: string }>).detail?.entity
      if (entity && entity !== 'SERVICE_REQUEST' && entity !== 'RESYNC') return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void load(date), 500)
    }
    window.addEventListener('employee-work-queue-updated', refresh)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('employee-work-queue-updated', refresh)
    }
  }, [date, load])

  const openEditor = (item: EmployeeAppointment) => {
    setEditing(item.id)
    setNewDate(item.date)
    setNewTime(item.time)
    setNote('')
    setError('')
  }

  const act = async (item: EmployeeAppointment, action: 'CONFIRM' | 'RESCHEDULE') => {
    const slot = action === 'RESCHEDULE' ? { date: newDate, time: newTime } : { date: item.date, time: item.time }
    if (!slot.date || !slot.time) return setError('حدد التاريخ والوقت الجديدين للموعد.')
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api.scheduleServiceRequestAppointment(item.requestReference, {
        action,
        date: slot.date,
        time: slot.time,
        note: note.trim() || undefined,
      })
      setNotice(
        action === 'RESCHEDULE'
          ? `نُقل موعد ${item.citizenName} إلى ${slot.date} الساعة ${slot.time} وأُبلغ المواطن.`
          : `تأكد موعد ${item.citizenName} (${slot.date} الساعة ${slot.time}) وأُبلغ المواطن.`
      )
      setEditing(null)
      await load(date)
    } catch (actionError) {
      setError((actionError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const confirmedCount = items.filter(item => item.confirmed).length
  const today = baghdadDay()

  return (
    <section className="service-requests-admin" id="employee-appointments">
      <header className="service-requests-admin-heading">
        <div>
          <span className="section-kicker">مواعيد الحضور</span>
          <h2>
            مواعيد {weekday(date)} {date}
          </h2>
          <p>
            {items.length
              ? `${items.length.toLocaleString('en-US')} موعد — ${confirmedCount.toLocaleString('en-US')} مؤكد و${(items.length - confirmedCount).toLocaleString('en-US')} بانتظار التأكيد.`
              : 'لا توجد مواعيد في هذا اليوم.'}{' '}
            يصل المواطن إشعار بالتاريخ والوقت عند كل تأكيد أو تغيير.
          </p>
        </div>
        <div className="service-requests-admin-tools">
          <div className="gov-segmented" role="group" aria-label="اليوم">
            <button onClick={() => setDate(current => baghdadDay(-1, current))} aria-label="اليوم السابق">
              <ChevronRight />
            </button>
            <button className={date === today ? 'active' : ''} onClick={() => setDate(today)}>
              اليوم
            </button>
            <button onClick={() => setDate(current => baghdadDay(1, current))} aria-label="اليوم التالي">
              <ChevronLeft />
            </button>
          </div>
          <input
            type="date"
            value={date}
            onChange={event => event.target.value && setDate(event.target.value)}
            aria-label="اختر اليوم"
          />
          <button className="button outline" onClick={() => void load(date)} disabled={busy}>
            <RefreshCw className={busy ? 'spin' : ''} /> تحديث
          </button>
        </div>
      </header>
      {notice && (
        <div className="form-success" role="status">
          <CheckCircle2 /> {notice}
        </div>
      )}
      {(error || scopeMessage) && (
        <div className="form-error" role="alert">
          <AlertTriangle /> {error || scopeMessage}
        </div>
      )}
      {items.length === 0 ? (
        <div className="citizen-empty compact">
          <CalendarClock />
          <div>
            <strong>لا توجد مواعيد في {date}</strong>
            <span>تظهر هنا طلبات المواعيد ومواعيد الحضور التي تحددها الدائرة عند الموافقة.</span>
          </div>
        </div>
      ) : (
        <ul className="service-request-checklist" aria-label="مواعيد اليوم">
          {items.map(item => (
            <li key={item.id} className={item.confirmed ? 'checklist-verified' : 'checklist-uploaded'}>
              <div className="checklist-head">
                <div>
                  <strong>
                    <bdi dir="ltr">{item.time}</bdi> — {item.citizenName}
                  </strong>
                  <small>
                    {item.serviceName} • {item.requestReference}
                    {session?.role !== 'EMPLOYEE' ? ` • ${item.departmentName}` : ''}
                    {item.citizenPhone ? (
                      <>
                        {' • '}
                        <bdi dir="ltr">{item.citizenPhone}</bdi>
                      </>
                    ) : null}
                    {requestStatus[item.requestStatus] ? ` • الطلب: ${requestStatus[item.requestStatus]}` : ''}
                  </small>
                  {item.note && <small>{item.note}</small>}
                </div>
                <span className={`checklist-badge ${item.confirmed ? 'verified' : 'uploaded'}`}>
                  {item.confirmed ? 'مؤكد ✓' : 'بانتظار التأكيد'}
                </span>
              </div>
              {!readOnly && (
                <div className="checklist-actions">
                  {!item.confirmed && (
                    <button className="button primary small" disabled={busy} onClick={() => void act(item, 'CONFIRM')}>
                      <CheckCircle2 /> تأكيد الموعد
                    </button>
                  )}
                  {editing === item.id ? (
                    <>
                      <input
                        type="date"
                        value={newDate}
                        min={today}
                        onChange={event => setNewDate(event.target.value)}
                        aria-label="التاريخ الجديد"
                      />
                      <input
                        type="time"
                        value={newTime}
                        onChange={event => setNewTime(event.target.value)}
                        aria-label="الوقت الجديد"
                      />
                      <input
                        value={note}
                        onChange={event => setNote(event.target.value.slice(0, 300))}
                        placeholder="تعليمات للمواطن (اختيارية)"
                        aria-label="تعليمات الحضور"
                      />
                      <button
                        className="button primary small"
                        disabled={busy || (newDate === item.date && newTime === item.time)}
                        onClick={() => void act(item, 'RESCHEDULE')}
                      >
                        <CalendarClock /> حفظ الموعد الجديد
                      </button>
                      <button className="button ghost small" onClick={() => setEditing(null)}>
                        إلغاء
                      </button>
                    </>
                  ) : (
                    <button className="button outline small" disabled={busy} onClick={() => openEditor(item)}>
                      <CalendarClock /> تغيير الموعد
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
