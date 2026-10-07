import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  Activity,
  ArrowLeft,
  KeyRound,
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Fingerprint,
  FileArchive,
  FileText,
  Gauge,
  MessageSquareWarning,
  QrCode,
  Search,
  UserRound,
  X,
} from 'lucide-react'
import { api } from '../../api'
import { logoutAndRedirect, useSession } from '../../lib/session'
import type { CitizenNotification } from '../../types'
import { AppShell, type AppNavItem } from '../shared/AppShell'

export const citizenNav = [
  { icon: Gauge, label: 'الرئيسية', href: '/citizen' },
  { icon: BriefcaseBusiness, label: 'الخدمات', href: '/citizen#services' },
  { icon: FileText, label: 'معاملاتي', href: '/citizen#my-requests' },
  { icon: MessageSquareWarning, label: 'شكوى أو مقترح', href: '/citizen/feedback' },
  { icon: Bell, label: 'الإشعارات', href: '/citizen/notifications' },
  { icon: CalendarDays, label: 'حجز موعد', href: '/service/online-appointment' },
  { icon: QrCode, label: 'التحقق', href: '/verify' },
]

export function CitizenProfileAvatar({ initial = 'م' }: { initial?: string }) {
  const [hasPhoto, setHasPhoto] = useState(true)
  return hasPhoto ? (
    <img
      className="user-avatar profile-avatar"
      src="/api/citizen/profile-photo"
      alt="صورة ملف المواطن"
      onError={() => setHasPhoto(false)}
    />
  ) : (
    <span className="user-avatar" aria-label="حساب المواطن">
      {initial || 'م'}
    </span>
  )
}

export function PortalLayout({
  children,
  role = 'citizen',
}: {
  children: React.ReactNode
  role?: 'citizen' | 'employee'
}) {
  const [location, navigate] = useLocation()
  const [searchQuery, setSearchQuery] = useState('')
  const [liveUnread, setLiveUnread] = useState(0)
  const [liveNotification, setLiveNotification] = useState<CitizenNotification | null>(null)
  const [employeeWorkEvent, setEmployeeWorkEvent] = useState<{
    entity: 'APPLICATION' | 'SERVICE_REQUEST' | 'IDENTITY_REVIEW' | 'FEEDBACK'
    action: 'CREATED' | 'UPDATED'
    reference?: string
  } | null>(null)
  const realtimeTimerRef = useRef<number | null>(null)
  const employeeRealtimeTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (role !== 'citizen' || typeof WebSocket === 'undefined') return
    let socket: WebSocket | null = null
    let stopped = false
    let retryDelay = 1000
    const publishSnapshot = (payload: { unread: number; items: CitizenNotification[] }, notify = false) => {
      setLiveUnread(payload.unread)
      window.dispatchEvent(new CustomEvent('citizen-notifications-updated', { detail: payload }))
      if (notify) {
        const newest = payload.items.find(item => !item.readAt)
        if (newest) {
          setLiveNotification(newest)
          window.setTimeout(() => setLiveNotification(current => (current?.id === newest.id ? null : current)), 7000)
        }
      }
    }
    const connect = () => {
      if (stopped) return
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/citizen-notifications`)
      socket.addEventListener('open', () => {
        retryDelay = 1000
        void api
          .getNotifications()
          .then(payload => publishSnapshot(payload))
          .catch(() => {})
      })
      socket.addEventListener('message', event => {
        try {
          const message = JSON.parse(String(event.data)) as {
            type?: string
            payload?: { unread: number; items: CitizenNotification[] }
          }
          if (message.type === 'citizen.notifications.updated' && message.payload)
            publishSnapshot(message.payload, true)
        } catch {
          /* رسالة غير صالحة لا تؤثر على الواجهة */
        }
      })
      socket.addEventListener('error', () => socket?.close())
      socket.addEventListener('close', () => {
        if (stopped) return
        realtimeTimerRef.current = window.setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 15_000)
      })
    }
    connect()
    return () => {
      stopped = true
      if (realtimeTimerRef.current) window.clearTimeout(realtimeTimerRef.current)
      socket?.close()
    }
  }, [role])
  useEffect(() => {
    if (role !== 'employee' || typeof WebSocket === 'undefined') return
    let socket: WebSocket | null = null
    let stopped = false
    let retryDelay = 1000
    const connect = () => {
      if (stopped) return
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/employee-work-queue`)
      socket.addEventListener('open', () => {
        retryDelay = 1000
      })
      socket.addEventListener('message', event => {
        try {
          const message = JSON.parse(String(event.data)) as {
            type?: string
            payload?: {
              entity: 'APPLICATION' | 'SERVICE_REQUEST' | 'IDENTITY_REVIEW'
              action: 'CREATED' | 'UPDATED'
              reference?: string
            }
          }
          if (message.type === 'employee.work-queue.updated' && message.payload) {
            setEmployeeWorkEvent(message.payload)
            window.dispatchEvent(new CustomEvent('employee-work-queue-updated', { detail: message.payload }))
            window.setTimeout(
              () =>
                setEmployeeWorkEvent(current => (current?.reference === message.payload?.reference ? null : current)),
              7000
            )
          }
        } catch {
          /* رسالة غير صالحة لا تؤثر على الواجهة */
        }
      })
      socket.addEventListener('error', () => socket?.close())
      socket.addEventListener('close', () => {
        if (stopped) return
        void api
          .getSession()
          .then(session => {
            if (!['EMPLOYEE', 'IDENTITY_REVIEWER', 'SUPER_ADMIN'].includes(session.role)) {
              stopped = true
              return
            }
            employeeRealtimeTimerRef.current = window.setTimeout(connect, retryDelay)
            retryDelay = Math.min(retryDelay * 2, 15_000)
          })
          .catch(() => {
            stopped = true
          })
      })
    }
    connect()
    return () => {
      stopped = true
      if (employeeRealtimeTimerRef.current) window.clearTimeout(employeeRealtimeTimerRef.current)
      socket?.close()
    }
  }, [role])
  useEffect(() => {
    void api.heartbeatPresence().catch(() => {})
    const timer = window.setInterval(() => void api.heartbeatPresence().catch(() => {}), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  // in-page sections (#services, #my-requests…) drive the active nav item
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const update = () => setHash(window.location.hash)
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  useEffect(() => setHash(window.location.hash), [location])
  // the citizen's own name in the shell (the session carries no display name for citizens)
  const [citizenName, setCitizenName] = useState('')
  useEffect(() => {
    if (role !== 'citizen') return
    let active = true
    api
      .getDemoCitizen()
      .then(citizen => {
        if (active) setCitizenName(citizen.fullName)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [role])
  // portal search runs against the full catalog (synonyms, fuzzy Arabic) — not the 12 legacy services
  const [searchResults, setSearchResults] = useState<
    Array<{ key: string; title: string; departmentName: string; category: string }>
  >([])
  const searchRequest = useRef(0)
  useEffect(() => {
    const term = searchQuery.trim()
    if (term.length < 2) {
      setSearchResults([])
      return
    }
    const id = ++searchRequest.current
    const timer = window.setTimeout(() => {
      api
        .searchServices(term, 6)
        .then(items => {
          if (searchRequest.current === id) setSearchResults(items)
        })
        .catch(() => {})
    }, 180)
    return () => window.clearTimeout(timer)
  }, [searchQuery])
  const { session } = useSession()
  const baseNav =
    role === 'citizen'
      ? citizenNav
      : [
          { icon: Gauge, label: 'طلبات الخدمات', href: '/employee#employee-service-requests' },
          { icon: FileText, label: 'معاملات إجازة المحل', href: '/employee#employee-applications' },
          { icon: Fingerprint, label: 'مراجعة الهوية', href: '/employee#employee-identity-reviews' },
          { icon: MessageSquareWarning, label: 'الشكاوى', href: '/employee#employee-feedback' },
          { icon: FileArchive, label: 'الأرشيف', href: '/employee#employee-archive' },
          { icon: Activity, label: 'سجل الإجراءات', href: '/employee#employee-activity' },
          { icon: KeyRound, label: 'الأمان والحساب', href: '/staff/security' },
        ]
  const nav = baseNav.filter(
    item =>
      role !== 'employee' ||
      item.href !== '/employee#employee-identity-reviews' ||
      !session ||
      session.role === 'IDENTITY_REVIEWER' ||
      session.role === 'SUPER_ADMIN'
  )
  if (role === 'employee' && session?.departmentId)
    nav.splice(1, 0, { icon: Building2, label: 'لوحة دائرتي', href: `/department/${session.departmentId}` })
  const items: AppNavItem[] = nav.map((item, index) => {
    const [path, anchor] = item.href.split('#')
    const active = anchor
      ? location === path && (hash === `#${anchor}` || (!hash && index === 0))
      : location === item.href || (index === 0 && location === path)
    return {
      ...item,
      active,
      badge: role === 'citizen' && item.href === '/citizen/notifications' ? liveUnread : undefined,
    }
  })
  const staffName = session && session.role !== 'CITIZEN' ? session.displayName || session.username || 'موظف' : null
  const staffRoleLabel =
    session?.role === 'SUPER_ADMIN'
      ? 'مدير النظام'
      : session?.role === 'IDENTITY_REVIEWER'
        ? 'مراجع الهوية'
        : session?.role === 'OPERATIONS'
          ? 'غرفة العمليات'
          : session?.departmentName || 'التدقيق والمعاملات'

  return (
    <AppShell
      portalLabel={role === 'citizen' ? 'بوابة المواطن' : 'بوابة الموظف'}
      portalIcon={role === 'citizen' ? UserRound : Building2}
      nav={items}
      user={
        role === 'citizen'
          ? {
              name: citizenName || 'حساب المواطن',
              detail: 'حساب موثّق برقم الهاتف',
              avatar: <CitizenProfileAvatar initial={citizenName.slice(0, 1)} />,
            }
          : {
              name: staffName || 'حساب الموظف',
              detail: staffRoleLabel,
              avatar: (
                <span className="user-avatar" aria-hidden="true">
                  {(staffName || 'م').slice(0, 1)}
                </span>
              ),
            }
      }
      notifications={
        role === 'citizen'
          ? { href: '/citizen/notifications', label: 'الإشعارات', unread: liveUnread }
          : { href: '/employee', label: 'قائمة العمل' }
      }
      search={
        <div className="app-search">
          <Search aria-hidden="true" />
          <input
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="ابحث عن خدمة أو دائرة"
            aria-label="ابحث داخل المنصة"
            type="search"
          />
          {searchResults.length > 0 && (
            <div className="app-search-results">
              {searchResults.map(service => (
                <Link href={`/service/${service.key}`} key={service.key} onClick={() => setSearchQuery('')}>
                  <span className="app-search-icon">
                    <BriefcaseBusiness />
                  </span>
                  <span className="app-search-text">
                    <strong>{service.title}</strong>
                    <small>
                      {service.departmentName} • {service.category}
                    </small>
                  </span>
                  <ArrowLeft aria-hidden="true" />
                </Link>
              ))}
            </div>
          )}
        </div>
      }
      onLogout={() => void logoutAndRedirect(path => navigate(path), role === 'employee' ? '/staff/login' : '/')}
    >
      {/* legacy page styles are scoped under these two classes until each page is migrated */}
      <div className="portal-shell portal-content">{children}</div>
      {role === 'citizen' && liveNotification && (
        <Link href={liveNotification.link || '/citizen/notifications'} className="app-toast" aria-live="polite">
          <span className="app-toast-icon">
            <Bell />
          </span>
          <span className="app-toast-text">
            <small>إشعار جديد</small>
            <strong>{liveNotification.title}</strong>
            <em>{liveNotification.message}</em>
          </span>
          <button
            type="button"
            className="app-toast-close"
            aria-label="إغلاق الإشعار"
            onClick={event => {
              event.preventDefault()
              setLiveNotification(null)
            }}
          >
            <X />
          </button>
        </Link>
      )}
      {role === 'employee' && employeeWorkEvent && (
        <a
          href={
            employeeWorkEvent.entity === 'SERVICE_REQUEST'
              ? '#employee-service-requests'
              : employeeWorkEvent.entity === 'IDENTITY_REVIEW'
                ? '#employee-identity-reviews'
                : employeeWorkEvent.entity === 'FEEDBACK'
                  ? '#employee-feedback'
                  : '#employee-applications'
          }
          className="app-toast"
          aria-live="polite"
        >
          <span className="app-toast-icon">
            <Bell />
          </span>
          <span className="app-toast-text">
            <small>تحديث في قائمة العمل</small>
            <strong>
              {employeeWorkEvent.entity === 'IDENTITY_REVIEW'
                ? employeeWorkEvent.action === 'CREATED'
                  ? 'طلب توثيق هوية جديد'
                  : 'تحديث على مراجعة هوية'
                : employeeWorkEvent.entity === 'FEEDBACK'
                  ? employeeWorkEvent.action === 'CREATED'
                    ? 'شكوى أو مقترح جديد'
                    : 'تحديث على شكوى'
                  : employeeWorkEvent.entity === 'SERVICE_REQUEST'
                    ? employeeWorkEvent.action === 'CREATED'
                      ? 'طلب خدمة جديد'
                      : 'تحديث على طلب خدمة'
                    : employeeWorkEvent.action === 'CREATED'
                      ? 'معاملة جديدة'
                      : 'تحديث على معاملة'}
            </strong>
            <em>{employeeWorkEvent.reference || 'حدّثت المنصة قائمة العمل تلقائياً.'}</em>
          </span>
        </a>
      )}
    </AppShell>
  )
}
