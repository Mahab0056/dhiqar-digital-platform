import { useState } from 'react'
import { Link } from 'wouter'
import { LogIn, Menu, X } from 'lucide-react'
import { Brand } from './Brand'
import { CivicUtilityBar } from './CivicUtilityBar'

export function PublicHeader() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <CivicUtilityBar />
      <header className="public-header">
        <div className="container nav-row">
          <Brand />
          <nav className={open ? 'nav-links is-open' : 'nav-links'}>
            <Link href="/">الرئيسية</Link>
            <Link href="/#services">الخدمات الحكومية</Link>
            <Link href="/departments">دليل الدوائر</Link>
            <Link href="/directory">الخدمات الحكومية</Link>
            <Link href="/citizen#my-requests">متابعة المعاملات</Link>
            <Link href="/citizen/feedback">الشكاوى والمقترحات</Link>
            <Link href="/#about">عن المنصة</Link>
            <Link href="/login" className="nav-login">
              <LogIn size={17} /> تسجيل الدخول
            </Link>
          </nav>
          <button
            className="menu-button"
            onClick={() => setOpen(v => !v)}
            aria-label="فتح القائمة"
            aria-expanded={open}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </header>
    </>
  )
}
