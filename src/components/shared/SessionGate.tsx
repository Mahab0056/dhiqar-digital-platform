import type React from 'react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { ArrowLeft, LockKeyhole, RefreshCw } from 'lucide-react'
import { api } from '../../api'
import { Brand } from '../public/Brand'

export function SessionGate({
  role,
  children,
}: {
  role: 'CITIZEN' | 'EMPLOYEE' | 'OPERATIONS' | 'SUPER_ADMIN'
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
            (role === 'EMPLOYEE' && (session.role === 'IDENTITY_REVIEWER' || session.role === 'SUPER_ADMIN')) ||
            (role === 'OPERATIONS' && session.role === 'SUPER_ADMIN')
            ? 'allowed'
            : 'denied'
        )
      })
      .catch(() => setState('denied'))
  }, [role, navigate])
  if (state === 'loading')
    return (
      <div className="access-gate-page">
        <RefreshCw className="spin" />
        <span>جاري التحقق من الجلسة...</span>
      </div>
    )
  if (state === 'denied')
    return (
      <div className="access-gate-page denied">
        <Brand />
        <span className="access-gate-icon">
          <LockKeyhole />
        </span>
        <h1>الدخول مطلوب</h1>
        <p>
          {role === 'CITIZEN'
            ? 'أكد رقم هاتفك لإدارة معاملاتك وبياناتك بأمان.'
            : 'سجّل دخولك بحسابك الوظيفي. هذه الصفحة تتطلب صلاحية محددة.'}
        </p>
        <Link
          className="button primary"
          href={
            role === 'CITIZEN' ? '/onboarding' : `/staff/login?next=${encodeURIComponent(window.location.pathname)}`
          }
        >
          {role === 'CITIZEN' ? 'تأكيد الهاتف' : 'دخول الموظفين'}
          <ArrowLeft />
        </Link>
      </div>
    )
  return <>{children}</>
}
