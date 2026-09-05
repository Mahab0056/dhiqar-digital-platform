import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { AlertTriangle, ArrowLeft, ArrowRight, Bell, Check, RefreshCw } from 'lucide-react'
import { api } from '../../api'
import type { CitizenNotification } from '../../types'
import { PortalLayout } from '../../components/citizen/PortalLayout'

export function CitizenNotificationsPage() {
  const [notifications, setNotifications] = useState<CitizenNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const applyNotifications = (payload: { unread: number; items: CitizenNotification[] }) => {
    setUnread(payload.unread)
    setNotifications(payload.items)
  }
  useEffect(() => {
    let active = true
    api
      .getNotifications()
      .then(payload => {
        if (active) applyNotifications(payload)
      })
      .catch(loadError => {
        if (active) setError((loadError as Error).message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    const receive = (event: Event) => {
      applyNotifications((event as CustomEvent<{ unread: number; items: CitizenNotification[] }>).detail)
      setLoading(false)
    }
    window.addEventListener('citizen-notifications-updated', receive)
    return () => window.removeEventListener('citizen-notifications-updated', receive)
  }, [])
  const markOne = async (id: string) => {
    try {
      applyNotifications(await api.markNotificationRead(id))
    } catch (markError) {
      setError((markError as Error).message)
    }
  }
  const markAll = async () => {
    try {
      applyNotifications(await api.markAllNotificationsRead())
    } catch (markError) {
      setError((markError as Error).message)
    }
  }
  return (
    <PortalLayout>
      <section className="citizen-notifications-page">
        <header className="citizen-notifications-head">
          <div>
            <Link href="/citizen">
              <ArrowRight /> حساب المواطن
            </Link>
            <span className="section-kicker">التحديثات</span>
            <h1>إشعارات الحساب</h1>
            <p>تظهر هنا تحديثات المعاملات وطلبات النواقص ونتائج المراجعة حال ورودها من المنصة.</p>
          </div>
          <div>
            {unread > 0 && (
              <button className="button outline" onClick={() => void markAll()}>
                تعليم الكل كمقروء <Check />
              </button>
            )}
          </div>
        </header>
        {error && (
          <div className="form-error">
            <AlertTriangle /> {error}
          </div>
        )}
        {loading ? (
          <div className="loading-state">
            <RefreshCw className="spin" /> جاري تحميل الإشعارات...
          </div>
        ) : notifications.length === 0 ? (
          <div className="citizen-empty notifications-empty">
            <Bell />
            <div>
              <strong>لا توجد إشعارات حالياً</strong>
              <span>ستصل تحديثات الحساب والمعاملات هنا عند حدوثها.</span>
            </div>
            <Link href="/citizen#services" className="button primary">
              تصفح الخدمات <ArrowLeft />
            </Link>
          </div>
        ) : (
          <div className="citizen-notifications-full-list">
            {notifications.map(item =>
              item.link ? (
                <Link
                  href={item.link}
                  className={item.readAt ? 'citizen-notification-row read' : 'citizen-notification-row unread'}
                  key={item.id}
                  onClick={() => {
                    if (!item.readAt) void markOne(item.id)
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
                  <ArrowLeft />
                </Link>
              ) : (
                <button
                  type="button"
                  className={item.readAt ? 'citizen-notification-row read' : 'citizen-notification-row unread'}
                  key={item.id}
                  onClick={() => {
                    if (!item.readAt) void markOne(item.id)
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
                </button>
              )
            )}
          </div>
        )}
      </section>
    </PortalLayout>
  )
}
