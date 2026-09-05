import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'wouter'
import {
  Activity,
  ArrowLeft,
  KeyRound,
  LogOut,
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  FileArchive,
  FileText,
  Gauge,
  LogIn,
  Menu,
  MessageSquareWarning,
  QrCode,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react'
import { api } from '../../api'
import { logoutAndRedirect, useSession } from '../../lib/session'
import { services } from '../../data'
import type { CitizenNotification } from '../../types'
import { Brand } from '../public/Brand'
import { CivicUtilityBar } from '../public/CivicUtilityBar'

export const citizenNav = [
  { icon: Gauge, label: 'الرئيسية', href: '/citizen' },
  { icon: BriefcaseBusiness, label: 'الخدمات', href: '/citizen#services' },
  { icon: FileText, label: 'معاملاتي', href: '/citizen#my-requests' },
  { icon: MessageSquareWarning, label: 'شكوى أو مقترح', href: '/citizen/feedback' },
  { icon: Bell, label: 'الإشعارات', href: '/citizen/notifications' },
  { icon: CalendarDays, label: 'حجز موعد', href: '/service/online-appointment' },
  { icon: QrCode, label: 'التحقق', href: '/verify' },
]

export function CitizenProfileAvatar() {
  const [hasPhoto, setHasPhoto] = useState(true)
  return hasPhoto ? (
    <img
      className="user-avatar profile-avatar"
      src="/api/citizen/profile-photo"
      alt="صورة ملف المواطن"
      onError={() => setHasPhoto(false)}
    />
  ) : (
    <div className="user-avatar" aria-label="حساب المواطن">
      ح
    </div>
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
  const [mobileNav, setMobileNav] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [liveUnread, setLiveUnread] = useState(0)
  const [liveNotification, setLiveNotification] = useState<CitizenNotification | null>(null)
  const [employeeWorkEvent, setEmployeeWorkEvent] = useState<{
    entity: 'APPLICATION' | 'SERVICE_REQUEST' | 'IDENTITY_REVIEW'
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
  const searchResults = useMemo(() => {
    const term = searchQuery.trim().toLowerCase()
    if (!term) return []
    return services
      .filter(service =>
        `${service.title} ${service.department} ${service.category} ${service.description}`.toLowerCase().includes(term)
      )
      .slice(0, 6)
  }, [searchQuery])
  const nav =
    role === 'citizen'
      ? citizenNav
      : [
          { icon: Gauge, label: 'لوحة العمل', href: '/employee#workboard' },
          { icon: FileText, label: 'المعاملات', href: '/employee#employee-applications' },
          { icon: CalendarDays, label: 'الكشوفات', href: '/employee#employee-service-requests' },
          { icon: FileArchive, label: 'الأرشيف', href: '/employee#employee-archive' },
          { icon: Activity, label: 'سجل الإجراءات', href: '/employee#employee-activity' },
          { icon: KeyRound, label: 'الأمان والحساب', href: '/staff/security' },
        ]
  const { session } = useSession()
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
    <div className="portal-shell">
      <CivicUtilityBar />
      <aside className={mobileNav ? 'portal-sidebar open' : 'portal-sidebar'}>
        <div className="sidebar-brand">
          <Brand />
          <button onClick={() => setMobileNav(false)}>
            <X />
          </button>
        </div>
        <div className="role-chip">
          {role === 'citizen' ? <UserRound /> : <Building2 />} {role === 'citizen' ? 'بوابة المواطن' : 'بوابة الموظف'}
        </div>
        <nav>
          {nav.map((item, index) => (
            <a
              href={item.href}
              onClick={() => setMobileNav(false)}
              className={location === item.href || (index === 0 && location === '/citizen') ? 'active' : ''}
              key={item.label}
            >
              <item.icon /> {item.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-security">
          <ShieldCheck />
          <span>جلسة محمية</span>
          <small>آخر نشاط: الآن</small>
        </div>
        {role === 'employee' ? (
          <button
            type="button"
            className="sidebar-logout"
            onClick={() => void logoutAndRedirect(path => navigate(path), '/staff/login')}
          >
            <LogOut /> تسجيل الخروج
          </button>
        ) : (
          <Link href="/login" className="sidebar-logout">
            <LogIn /> تبديل البوابة
          </Link>
        )}
      </aside>
      <div className="portal-main">
        <header className="portal-topbar">
          <button className="mobile-sidebar-button" onClick={() => setMobileNav(true)}>
            <Menu />
          </button>
          <div className="topbar-search">
            <Search />
            <input
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="ابحث عن خدمة أو دائرة"
              aria-label="ابحث داخل المنصة"
            />
            {!searchQuery && <span className="search-help">بحث</span>}
            {searchResults.length > 0 && (
              <div className="topbar-search-results">
                {searchResults.map(service => (
                  <Link href={`/service/${service.key}`} key={service.key} onClick={() => setSearchQuery('')}>
                    <span>
                      <BriefcaseBusiness />
                    </span>
                    <div>
                      <strong>{service.title}</strong>
                      <small>
                        {service.department} • {service.category}
                      </small>
                    </div>
                    <ArrowLeft />
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div className="topbar-actions">
            <Link
              className="topbar-notification-link"
              href={role === 'citizen' ? '/citizen/notifications' : '/employee'}
              aria-label={role === 'citizen' ? 'فتح الإشعارات' : 'فتح قائمة المعاملات'}
            >
              <Bell />
              {role === 'citizen' && liveUnread > 0 && (
                <b className="realtime-unread-badge">{liveUnread > 99 ? '99+' : liveUnread.toLocaleString('en-US')}</b>
              )}
            </Link>
            {role === 'citizen' ? (
              <CitizenProfileAvatar />
            ) : (
              <div className="user-avatar" aria-hidden="true">
                {(staffName || 'م').slice(0, 1)}
              </div>
            )}
            <div>
              <strong>{role === 'citizen' ? 'حساب المواطن' : staffName || 'حساب الموظف'}</strong>
              <small>{role === 'citizen' ? 'الخدمات والإشعارات' : staffRoleLabel}</small>
            </div>
          </div>
        </header>
        <main className="portal-content">{children}</main>
        <nav className="mobile-bottom-nav" aria-label="التنقل السريع">
          {nav.slice(0, 4).map((item, index) => (
            <a
              href={item.href}
              onClick={() => setMobileNav(false)}
              className={location === item.href || (index === 0 && location === '/citizen') ? 'active' : ''}
              key={`mobile-${item.label}`}
            >
              <item.icon />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
      </div>
      {role === 'citizen' && liveNotification && (
        <Link
          href={liveNotification.link || '/citizen/notifications'}
          className="citizen-realtime-toast"
          aria-live="polite"
        >
          <Bell />
          <span>
            <small>إشعار جديد</small>
            <strong>{liveNotification.title}</strong>
            <em>{liveNotification.message}</em>
          </span>
          <X
            onClick={event => {
              event.preventDefault()
              setLiveNotification(null)
            }}
          />
        </Link>
      )}
      {role === 'employee' && employeeWorkEvent && (
        <a
          href={
            employeeWorkEvent.entity === 'SERVICE_REQUEST'
              ? '#employee-service-requests'
              : employeeWorkEvent.entity === 'IDENTITY_REVIEW'
                ? '#employee-identity-reviews'
                : '#employee-applications'
          }
          className="employee-realtime-toast"
          aria-live="polite"
        >
          <Bell />
          <span>
            <small>تحديث في طابور العمل</small>
            <strong>
              {employeeWorkEvent.entity === 'IDENTITY_REVIEW'
                ? 'طلب توثيق هوية جديد'
                : employeeWorkEvent.entity === 'SERVICE_REQUEST'
                  ? 'طلب خدمة جديد'
                  : 'معاملة جديدة'}
            </strong>
            <em>{employeeWorkEvent.reference || 'حدّثت المنصة قائمة العمل تلقائياً.'}</em>
          </span>
        </a>
      )}
    </div>
  )
}
