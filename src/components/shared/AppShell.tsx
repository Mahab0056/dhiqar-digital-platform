import type React from 'react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { Bell, LogOut, Menu, ShieldCheck, X, type LucideIcon } from 'lucide-react'
import { CivicUtilityBar } from '../public/CivicUtilityBar'

export type AppNavItem = { icon: LucideIcon; label: string; href: string; active?: boolean; badge?: number }

/**
 * The signed-in frame shared by every portal (citizen, employee, department, operations, governor,
 * super admin): sidebar navigation, a top bar for search / notifications, and the content column.
 */
export function AppShell({
  portalLabel,
  portalIcon: PortalIcon,
  nav,
  mobileNav,
  user,
  notifications,
  search,
  onLogout,
  sidebarExtra,
  children,
}: {
  portalLabel: string
  portalIcon: LucideIcon
  nav: AppNavItem[]
  /** items for the phone bottom bar; defaults to the first four */
  mobileNav?: AppNavItem[]
  user: { name: string; detail: string; avatar: React.ReactNode }
  notifications?: { href: string; label: string; unread?: number }
  search?: React.ReactNode
  onLogout: () => void
  sidebarExtra?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [location] = useLocation()
  useEffect(() => setOpen(false), [location])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const renderLink = (item: AppNavItem, compact = false) => {
    const content = (
      <>
        <item.icon aria-hidden="true" />
        <span>{item.label}</span>
        {!compact && item.badge ? <b className="app-nav-badge">{item.badge > 99 ? '99+' : item.badge}</b> : null}
      </>
    )
    const className = item.active ? 'is-active' : ''
    // hash links scroll inside the current page; real routes go through the router
    return item.href.includes('#') ? (
      <a
        href={item.href}
        className={className}
        aria-current={item.active ? 'page' : undefined}
        key={item.label}
        onClick={() => setOpen(false)}
      >
        {content}
      </a>
    ) : (
      <Link
        href={item.href}
        className={className}
        aria-current={item.active ? 'page' : undefined}
        key={item.label}
        onClick={() => setOpen(false)}
      >
        {content}
      </Link>
    )
  }

  return (
    <div className="app-shell">
      <a className="tq-skip-link" href="#main-content">
        تخطَّ إلى المحتوى الرئيسي
      </a>
      <CivicUtilityBar />
      {open && (
        <button type="button" className="app-backdrop" aria-label="إغلاق القائمة" onClick={() => setOpen(false)} />
      )}
      <div className="app-frame">
        <aside className={open ? 'app-sidebar is-open' : 'app-sidebar'} aria-label="قائمة البوابة">
          <div className="app-sidebar-head">
            <Link href="/" className="app-brand" aria-label="ذي قار الرقمية — الرئيسية">
              <img src="/brand/dhiqar-unified-logo.png" alt="" />
              <span>
                <strong>ذي قار الرقمية</strong>
                <small>
                  <PortalIcon aria-hidden="true" /> {portalLabel}
                </small>
              </span>
            </Link>
            <button
              type="button"
              className="icon-button app-sidebar-close"
              aria-label="إغلاق القائمة"
              onClick={() => setOpen(false)}
            >
              <X />
            </button>
          </div>
          <nav className="app-nav" aria-label="التنقل">
            {nav.map(item => renderLink(item))}
          </nav>
          {sidebarExtra}
          <div className="app-sidebar-foot">
            <div className="app-user">
              {user.avatar}
              <span>
                <strong>{user.name}</strong>
                <small>{user.detail}</small>
              </span>
            </div>
            <p className="app-session">
              <ShieldCheck aria-hidden="true" /> جلسة محمية ومشفّرة
            </p>
            <button type="button" className="button outline small full app-logout" onClick={onLogout}>
              <LogOut /> تسجيل الخروج
            </button>
          </div>
        </aside>
        <div className="app-main">
          <header className="app-topbar">
            <button
              type="button"
              className="icon-button app-menu"
              aria-label="فتح القائمة"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Menu />
            </button>
            <div className="app-topbar-search">{search}</div>
            <div className="app-topbar-actions">
              {notifications && (
                <Link href={notifications.href} className="icon-button app-bell" aria-label={notifications.label}>
                  <Bell />
                  {notifications.unread ? (
                    <b className="app-bell-badge">{notifications.unread > 99 ? '99+' : notifications.unread}</b>
                  ) : null}
                </Link>
              )}
              <div className="app-topbar-user">
                {user.avatar}
                <span>
                  <strong>{user.name}</strong>
                  <small>{user.detail}</small>
                </span>
              </div>
            </div>
          </header>
          <main id="main-content" className="app-content">
            {children}
          </main>
        </div>
      </div>
      <nav className="app-bottom-nav" aria-label="التنقل السريع">
        {(mobileNav || nav.slice(0, 4)).map(item => renderLink(item, true))}
        <button type="button" onClick={() => setOpen(true)} aria-label="كل الأقسام">
          <Menu aria-hidden="true" />
          <span>المزيد</span>
        </button>
      </nav>
    </div>
  )
}
