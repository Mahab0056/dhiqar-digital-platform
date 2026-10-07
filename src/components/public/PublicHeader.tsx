import { useEffect, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { LayoutDashboard, Menu, PlusCircle, UserRound, X } from 'lucide-react'
import { CivicUtilityBar } from './CivicUtilityBar'
import { useSession } from '../../lib/session'

const navItems = [
  { label: 'الرئيسية', href: '/', match: (path: string) => path === '/' },
  {
    label: 'الخدمات',
    href: '/directory',
    match: (path: string) =>
      path.startsWith('/directory') || path.startsWith('/service/') || path.startsWith('/government-services'),
  },
  { label: 'الدوائر الحكومية', href: '/departments', match: (path: string) => path.startsWith('/departments') },
  { label: 'متابعة معاملة', href: '/citizen#my-requests', match: (path: string) => path === '/citizen' },
  { label: 'التحقق من وثيقة', href: '/verify', match: (path: string) => path.startsWith('/verify') },
  {
    label: 'الشكاوى والمقترحات',
    href: '/citizen/feedback',
    match: (path: string) => path.startsWith('/citizen/feedback'),
  },
]

export function PublicHeader() {
  const [open, setOpen] = useState(false)
  const [location] = useLocation()
  const { session } = useSession()
  const portalHref =
    session?.role === 'CITIZEN'
      ? '/citizen'
      : session?.role === 'SUPER_ADMIN'
        ? '/super-admin'
        : session?.role === 'OPERATIONS'
          ? '/operations'
          : session
            ? '/employee'
            : null
  const portalLabel = session?.role === 'CITIZEN' ? 'حسابي ومعاملاتي' : 'لوحة العمل'

  // the mobile menu closes with Escape
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <a className="tq-skip-link" href="#main-content">
        تخطَّ إلى المحتوى الرئيسي
      </a>
      <CivicUtilityBar />
      <header className={open ? 'tq-header is-open' : 'tq-header'}>
        <div className="tq-container tq-header-row">
          <Link href="/" className="tq-brand" aria-label="ذي قار الرقمية — الرئيسية">
            <img src="/brand/dhiqar-unified-logo.png" alt="" />
            <span>
              <strong>ذي قار الرقمية</strong>
              <small>البوابة الحكومية لمحافظة ذي قار</small>
            </span>
          </Link>
          <nav className="tq-nav" aria-label="التنقل الرئيسي">
            {navItems.map(item => {
              const active = item.match(location)
              return (
                <Link
                  href={item.href}
                  key={item.label}
                  className={active ? 'is-active' : ''}
                  aria-current={active ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
          <div className="tq-header-actions">
            {portalHref ? (
              <Link href={portalHref} className="button primary">
                <LayoutDashboard /> {portalLabel}
              </Link>
            ) : (
              <>
                <Link href="/login" className="button ghost">
                  <UserRound /> تسجيل الدخول
                </Link>
                <Link href="/onboarding" className="button primary">
                  <PlusCircle /> ابدأ معاملتك
                </Link>
              </>
            )}
          </div>
          <button
            type="button"
            className="icon-button tq-menu-toggle"
            onClick={() => setOpen(value => !value)}
            aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
            aria-expanded={open}
            aria-controls="tq-mobile-menu"
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
        <div className="tq-mobile-menu" id="tq-mobile-menu" hidden={!open}>
          <nav className="tq-container" aria-label="التنقل الرئيسي على الجوال">
            {navItems.map(item => (
              <Link
                href={item.href}
                key={item.label}
                className={item.match(location) ? 'is-active' : ''}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <div className="tq-mobile-actions">
              {portalHref ? (
                <Link href={portalHref} className="button primary full" onClick={() => setOpen(false)}>
                  <LayoutDashboard /> {portalLabel}
                </Link>
              ) : (
                <>
                  <Link href="/onboarding" className="button primary full" onClick={() => setOpen(false)}>
                    <PlusCircle /> ابدأ معاملتك
                  </Link>
                  <Link href="/login" className="button outline full" onClick={() => setOpen(false)}>
                    <UserRound /> تسجيل الدخول
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      </header>
    </>
  )
}
