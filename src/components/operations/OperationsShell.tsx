import type React from 'react'
import { useEffect } from 'react'
import { Link, useLocation } from 'wouter'
import {
  Activity,
  Building2,
  CircleDollarSign,
  FileArchive,
  Landmark,
  KeyRound,
  LogOut,
  Map,
  MessageSquareWarning,
  ShieldCheck,
} from 'lucide-react'
import { api } from '../../api'
import { logoutAndRedirect, useSession } from '../../lib/session'
import { Brand } from '../public/Brand'
import { CivicUtilityBar } from '../public/CivicUtilityBar'

export function OperationsShell({ children, active = 'operations' }: { children: React.ReactNode; active?: string }) {
  const [, navigate] = useLocation()
  const { session } = useSession()
  useEffect(() => {
    void api.heartbeatPresence().catch(() => {})
    const timer = window.setInterval(() => void api.heartbeatPresence().catch(() => {}), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <div className={`ops-shell ops-${active}`}>
      <CivicUtilityBar />
      <aside className="ops-sidebar">
        <Brand compact />
        <nav>
          <Link href="/operations" className={active === 'operations' ? 'active' : ''}>
            <Map />
            <span>غرفة العمليات</span>
          </Link>
          <Link href="/governor" className={active === 'governor' ? 'active' : ''}>
            <Landmark />
            <span>لوحة المحافظ</span>
          </Link>
          <a href="/operations#departments">
            <Building2 />
            <span>الدوائر</span>
          </a>
          <a href="/operations#finance">
            <CircleDollarSign />
            <span>المالية</span>
          </a>
          <a href="/operations#operations-alerts">
            <MessageSquareWarning />
            <span>التنبيهات</span>
          </a>
          <a href="/operations#system-health">
            <Activity />
            <span>صحة النظام</span>
          </a>
          {active === 'super-admin' && (
            <Link href="/employee">
              <FileArchive />
              <span>التدقيق</span>
            </Link>
          )}
          {session?.role === 'SUPER_ADMIN' && (
            <Link href="/super-admin" className={active === 'super-admin' ? 'active' : ''}>
              <ShieldCheck />
              <span>إدارة المنصة</span>
            </Link>
          )}
          <Link href="/staff/security" title="الأمان والحساب">
            <KeyRound />
            <span>الأمان والحساب</span>
          </Link>
        </nav>
        <button
          type="button"
          className="ops-exit"
          title="تسجيل الخروج"
          aria-label="تسجيل الخروج"
          onClick={() => void logoutAndRedirect(path => navigate(path), '/staff/login')}
        >
          <LogOut />
          <span>خروج</span>
        </button>
      </aside>
      <main className="ops-main">{children}</main>
    </div>
  )
}
