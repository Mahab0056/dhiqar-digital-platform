import type React from 'react'
import { useEffect, useState } from 'react'
import { Link } from 'wouter'
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
  useEffect(() => {
    api
      .getSession()
      .then(session =>
        setState(
          session.role === role ||
            (role === 'EMPLOYEE' && (session.role === 'IDENTITY_REVIEWER' || session.role === 'SUPER_ADMIN')) ||
            (role === 'OPERATIONS' && (session.role === 'EMPLOYEE' || session.role === 'SUPER_ADMIN'))
            ? 'allowed'
            : 'denied'
        )
      )
      .catch(() => setState('denied'))
  }, [role])
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
            : role === 'SUPER_ADMIN'
              ? 'سجّل دخولك بحساب المدير العام قبل فتح إدارة المنصة.'
              : role === 'OPERATIONS'
                ? 'سجّل دخولك برمز غرفة العمليات قبل فتح المؤشرات التشغيلية.'
                : 'سجّل دخولك بحساب الموظف قبل فتح الشاشات التشغيلية.'}
        </p>
        <Link
          className="button primary"
          href={
            role === 'CITIZEN'
              ? '/onboarding'
              : role === 'SUPER_ADMIN'
                ? '/super-admin/login'
                : role === 'OPERATIONS'
                  ? '/operations/login'
                  : '/employee'
          }
        >
          {role === 'CITIZEN'
            ? 'تأكيد الهاتف'
            : role === 'SUPER_ADMIN'
              ? 'دخول المدير العام'
              : role === 'OPERATIONS'
                ? 'دخول غرفة العمليات'
                : 'دخول الموظف'}{' '}
          <ArrowLeft />
        </Link>
      </div>
    )
  return <>{children}</>
}
