import type React from 'react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { ArrowLeft, LockKeyhole } from 'lucide-react'
import { api } from '../../api'
import { AuthShell } from '../public/AuthShell'
import { LoadingBlock } from '../public/PageHeader'

export function SessionGate({
  role,
  children,
}: {
  role: 'CITIZEN' | 'EMPLOYEE' | 'OPERATIONS' | 'SUPER_ADMIN' | 'ANY_STAFF'
  children: React.ReactNode
}) {
  const [state, setState] = useState<'loading' | 'allowed' | 'denied'>('loading')
  const [, navigate] = useLocation()
  useEffect(() => {
    api
      .getSession()
      .then(session => {
        if (session.role !== 'CITIZEN' && session.mustChangePassword) {
          navigate(`/staff/login?next=${encodeURIComponent(window.location.pathname)}`)
          return
        }
        setState(
          session.role === role ||
            (role === 'ANY_STAFF' && session.role !== 'CITIZEN') ||
            (role === 'EMPLOYEE' &&
              (session.role === 'IDENTITY_REVIEWER' ||
                session.role === 'SUPER_ADMIN' ||
                (session.role === 'OPERATIONS' && window.location.pathname.startsWith('/department/')))) ||
            (role === 'OPERATIONS' && session.role === 'SUPER_ADMIN')
            ? 'allowed'
            : 'denied'
        )
      })
      .catch(() => setState('denied'))
  }, [role, navigate])
  if (state === 'loading')
    return (
      <div className="auth-page access-gate-loading">
        <LoadingBlock label="جاري التحقق من الجلسة…" />
      </div>
    )
  if (state === 'denied')
    return (
      <AuthShell context={role === 'CITIZEN' ? 'حساب المواطن' : 'دخول الموظفين'}>
        <div className="auth-card access-gate">
          <span className="auth-card-icon">
            <LockKeyhole />
          </span>
          <span className="section-kicker">صفحة محمية</span>
          <h1>سجّل الدخول للمتابعة</h1>
          <p className="auth-lead">
            {role === 'CITIZEN'
              ? 'أكّد رقم هاتفك لإدارة معاملاتك وبياناتك بأمان.'
              : 'سجّل دخولك بحسابك الوظيفي. هذه الصفحة تتطلب صلاحية محددة.'}
          </p>
          <Link
            className="button primary full auth-submit"
            href={
              role === 'CITIZEN' ? '/onboarding' : `/staff/login?next=${encodeURIComponent(window.location.pathname)}`
            }
          >
            {role === 'CITIZEN' ? 'الدخول برقم الهاتف' : 'دخول الموظفين'}
            <ArrowLeft />
          </Link>
        </div>
      </AuthShell>
    )
  return <>{children}</>
}
