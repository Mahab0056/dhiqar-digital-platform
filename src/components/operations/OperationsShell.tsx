import type React from 'react'
import { useEffect } from 'react'
import { useLocation } from 'wouter'
import {
  Activity,
  Building2,
  CircleDollarSign,
  FileArchive,
  KeyRound,
  Landmark,
  Map,
  MessageSquareWarning,
  MonitorCheck,
  ShieldCheck,
} from 'lucide-react'
import { api } from '../../api'
import { logoutAndRedirect, useSession } from '../../lib/session'
import { AppShell, type AppNavItem } from '../shared/AppShell'

const roleLabel = (role?: string) =>
  role === 'SUPER_ADMIN' ? 'مدير النظام' : role === 'OPERATIONS' ? 'غرفة العمليات' : 'موظف المنصة'

export function OperationsShell({ children, active = 'operations' }: { children: React.ReactNode; active?: string }) {
  const [, navigate] = useLocation()
  const { session } = useSession()
  useEffect(() => {
    void api.heartbeatPresence().catch(() => {})
    const timer = window.setInterval(() => void api.heartbeatPresence().catch(() => {}), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const nav: AppNavItem[] = [
    { icon: Map, label: 'غرفة العمليات', href: '/operations', active: active === 'operations' },
    { icon: Landmark, label: 'لوحة المحافظ', href: '/governor', active: active === 'governor' },
    { icon: Building2, label: 'الدوائر', href: '/operations#departments' },
    { icon: CircleDollarSign, label: 'المالية', href: '/operations#finance' },
    { icon: MessageSquareWarning, label: 'التنبيهات', href: '/operations#operations-alerts' },
    { icon: Activity, label: 'صحة النظام', href: '/operations#system-health' },
  ]
  if (session?.role === 'SUPER_ADMIN') {
    nav.push({ icon: FileArchive, label: 'التدقيق والمعاملات', href: '/employee' })
    nav.push({ icon: ShieldCheck, label: 'إدارة المنصة', href: '/super-admin', active: active === 'super-admin' })
  }
  nav.push({ icon: KeyRound, label: 'الأمان والحساب', href: '/staff/security' })
  const name = session?.displayName || session?.username || 'موظف'

  return (
    <AppShell
      portalLabel={active === 'super-admin' ? 'إدارة المنصة' : active === 'governor' ? 'لوحة المحافظ' : 'غرفة العمليات'}
      portalIcon={active === 'super-admin' ? ShieldCheck : MonitorCheck}
      nav={nav}
      mobileNav={nav.filter(item => !item.href.includes('#')).slice(0, 4)}
      user={{
        name,
        detail: roleLabel(session?.role),
        avatar: (
          <span className={session?.role === 'SUPER_ADMIN' ? 'user-avatar gold' : 'user-avatar'} aria-hidden="true">
            {name.slice(0, 1)}
          </span>
        ),
      }}
      onLogout={() => void logoutAndRedirect(path => navigate(path), '/staff/login')}
    >
      <div className={`ops-shell ops-main ops-${active}`}>{children}</div>
    </AppShell>
  )
}
