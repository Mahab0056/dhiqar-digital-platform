import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import { Menu, PlusCircle, UserRound, X } from 'lucide-react'
import { CivicUtilityBar } from './CivicUtilityBar'

const navItems = [
  { label: 'الرئيسية', href: '/', match: (path: string) => path === '/' },
  { label: 'الخدمات', href: '/directory', match: (path: string) => path.startsWith('/directory') || path.startsWith('/service/') },
  { label: 'الجهات الحكومية', href: '/departments', match: (path: string) => path.startsWith('/departments') },
  { label: 'متابعة المعاملات', href: '/citizen#my-requests', match: (path: string) => path.startsWith('/citizen') },
  { label: 'الشكاوى والمقترحات', href: '/citizen/feedback', match: (path: string) => path.startsWith('/citizen/feedback') },
  { label: 'دليل المستخدم', href: '/#journey', match: () => false },
]

export function PublicHeader() {
  const [open, setOpen] = useState(false)
  const [location] = useLocation()
  return (
    <>
      <CivicUtilityBar />
      <header className="gov-header">
        <div className="gov-container gov-header-row">
          <Link href="/" className="gov-brand" aria-label="ذي قار الرقمية — الرئيسية">
            <img src="/brand/dhiqar-unified-logo.png" alt="شعار ذي قار الرقمية" />
            <span>
              <strong>ذي قار الرقمية</strong>
              <b>THI QAR DIGITAL</b>
              <small>البوابة الحكومية الرقمية لمحافظة ذي قار</small>
            </span>
          </Link>
          <nav className={open ? 'gov-nav is-open' : 'gov-nav'} aria-label="التنقل الرئيسي">
            {navItems.map(item => (
              <Link
                href={item.href}
                key={item.label}
                className={item.match(location) ? 'active' : ''}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <div className="gov-nav-actions">
              <Link href="/login" className="gov-btn outline" onClick={() => setOpen(false)}>
                <UserRound size={16} /> تسجيل الدخول
              </Link>
              <Link href="/onboarding" className="gov-btn primary" onClick={() => setOpen(false)}>
                <PlusCircle size={16} /> ابدأ معاملتك
              </Link>
            </div>
          </nav>
          <button
            className="gov-menu-button"
            onClick={() => setOpen(value => !value)}
            aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
            aria-expanded={open}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </header>
    </>
  )
}
