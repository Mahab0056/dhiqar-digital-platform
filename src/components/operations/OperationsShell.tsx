import type React from 'react'
import { useEffect } from 'react'
import { Link } from 'wouter'
import {
  Activity,
  Building2,
  CircleDollarSign,
  FileArchive,
  Landmark,
  LogIn,
  Map,
  MessageSquareWarning,
  ShieldCheck,
} from 'lucide-react'
import { api } from '../../api'
import { Brand } from '../public/Brand'
import { CivicUtilityBar } from '../public/CivicUtilityBar'

export function OperationsShell({ children, active = 'operations' }: { children: React.ReactNode; active?: string }) {
  useEffect(() => {
    void api.heartbeatPresence().catch(() => {})
    const timer = window.setInterval(() => void api.heartbeatPresence().catch(() => {}), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <div className="ops-shell">
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
          <Link href="/super-admin" className={active === 'super-admin' ? 'active' : ''}>
            <ShieldCheck />
            <span>إدارة المنصة</span>
          </Link>
        </nav>
        <Link href="/login" className="ops-exit">
          <LogIn />
        </Link>
      </aside>
      <main className="ops-main">{children}</main>
    </div>
  )
}
