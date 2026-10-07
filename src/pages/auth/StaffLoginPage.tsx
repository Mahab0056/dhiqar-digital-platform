import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { AlertTriangle, KeyRound, LockKeyhole, ShieldCheck, Smartphone } from 'lucide-react'
import { api } from '../../api'
import type { SessionRole, StaffSession } from '../../types'
import { AuthAside, AuthShell } from '../../components/public/AuthShell'

export const staffHomeForRole = (role: SessionRole) => {
  if (role === 'SUPER_ADMIN') return '/super-admin'
  if (role === 'OPERATIONS') return '/operations'
  if (role === 'CITIZEN') return '/citizen'
  return '/employee'
}

const allowedPrefixes: Record<string, string[]> = {
  SUPER_ADMIN: ['/'],
  OPERATIONS: ['/operations', '/governor', '/staff'],
  EMPLOYEE: ['/employee', '/staff', '/department'],
  IDENTITY_REVIEWER: ['/employee', '/staff', '/department'],
}

const nextParam = (role: SessionRole) => {
  try {
    const next = new URLSearchParams(window.location.search).get('next')
    if (!next || !next.startsWith('/') || next.startsWith('//')) return null
    return (allowedPrefixes[role] || []).some(prefix => next.startsWith(prefix)) ? next : null
  } catch {
    return null
  }
}

export function StaffLoginPage() {
  const [, navigate] = useLocation()
  const [step, setStep] = useState<'credentials' | 'mfa' | 'password-change'>('credentials')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [challengeToken, setChallengeToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const finish = (session: StaffSession) => {
    if (session.mustChangePassword) {
      setStep('password-change')
      return
    }
    navigate(nextParam(session.role) || staffHomeForRole(session.role))
  }

  useEffect(() => {
    api
      .getSession()
      .then(session => {
        if (session.role !== 'CITIZEN') finish(session)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submitCredentials = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await api.staffLogin(username, password)
      if ('mfaRequired' in result && result.mfaRequired) {
        setChallengeToken(result.challengeToken)
        setStep('mfa')
      } else finish(result as StaffSession)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submitMfa = async () => {
    setBusy(true)
    setError('')
    try {
      finish(await api.staffMfa(challengeToken, code))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submitPasswordChange = async () => {
    if (newPassword !== confirmPassword) return setError('كلمتا المرور غير متطابقتين.')
    setBusy(true)
    setError('')
    try {
      await api.changeStaffPassword(password, newPassword)
      const session = await api.getSession()
      navigate(nextParam(session.role) || staffHomeForRole(session.role))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      back={{ href: '/login', label: 'بوابات الدخول' }}
      context="دخول الموظفين"
      aside={
        <AuthAside
          kicker="بوابة الموظفين الحكوميين"
          title="حساب شخصي لكل موظف وسجل تدقيق لكل إجراء"
          points={[
            'صلاحيات محددة حسب الدور والدائرة',
            'كل إجراء يُسجَّل باسم صاحبه في سجل التدقيق',
            'مصادقة ثنائية متاحة من صفحة الأمان بعد الدخول',
            'قفل مؤقت للحساب بعد 5 محاولات فاشلة',
          ]}
        />
      }
    >
      <div className="auth-card" aria-live="polite">
        <span className="auth-card-icon">
          {step === 'mfa' ? <Smartphone /> : step === 'password-change' ? <KeyRound /> : <LockKeyhole />}
        </span>
        {step === 'credentials' && (
          <form
            className="auth-form"
            onSubmit={event => {
              event.preventDefault()
              void submitCredentials()
            }}
          >
            <span className="section-kicker">دخول الموظفين</span>
            <h1>تسجيل الدخول إلى حسابك</h1>
            <p className="auth-lead">استخدم اسم المستخدم وكلمة المرور الممنوحين لك من إدارة المنصة.</p>
            <label className="tq-field">
              <span>اسم المستخدم</span>
              <input
                value={username}
                onChange={event => setUsername(event.target.value)}
                autoComplete="username"
                dir="ltr"
                autoFocus
              />
            </label>
            <label className="tq-field">
              <span>كلمة المرور</span>
              <input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                autoComplete="current-password"
                dir="ltr"
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                <AlertTriangle /> {error}
              </div>
            )}
            <button className="button primary full auth-submit" type="submit" disabled={busy || !username || !password}>
              <LockKeyhole /> {busy ? 'جاري التحقق…' : 'دخول آمن'}
            </button>
          </form>
        )}
        {step === 'mfa' && (
          <form
            className="auth-form"
            onSubmit={event => {
              event.preventDefault()
              void submitMfa()
            }}
          >
            <span className="section-kicker">المصادقة الثنائية</span>
            <h1>أدخل رمز التحقق</h1>
            <p className="auth-lead">افتح تطبيق المصادقة على هاتفك وأدخل الرمز المكوّن من 6 أرقام.</p>
            <label className="tq-field">
              <span>الرمز</span>
              <input
                className="auth-code"
                value={code}
                onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                autoFocus
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                <AlertTriangle /> {error}
              </div>
            )}
            <button className="button primary full auth-submit" type="submit" disabled={busy || code.length !== 6}>
              {busy ? 'جاري التحقق…' : 'تأكيد'}
            </button>
            <button
              type="button"
              className="button ghost full"
              onClick={() => {
                setStep('credentials')
                setCode('')
                setError('')
              }}
            >
              رجوع
            </button>
          </form>
        )}
        {step === 'password-change' && (
          <form
            className="auth-form"
            onSubmit={event => {
              event.preventDefault()
              void submitPasswordChange()
            }}
          >
            <span className="section-kicker">أول دخول</span>
            <h1>اختر كلمة مرور جديدة</h1>
            <p className="auth-lead">
              هذه أول جلسة بكلمة مرور مؤقتة. اختر كلمة مرور من 12 حرفاً على الأقل تجمع ثلاثة أنواع من الأحرف والأرقام
              والرموز.
            </p>
            <label className="tq-field">
              <span>كلمة المرور الجديدة</span>
              <input
                type="password"
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
                autoComplete="new-password"
                dir="ltr"
                autoFocus
              />
            </label>
            <label className="tq-field">
              <span>تأكيد كلمة المرور</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                dir="ltr"
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                <AlertTriangle /> {error}
              </div>
            )}
            <button
              className="button primary full auth-submit"
              type="submit"
              disabled={busy || newPassword.length < 12 || confirmPassword.length < 12}
            >
              {busy ? 'جاري الحفظ…' : 'حفظ ومتابعة'}
            </button>
          </form>
        )}
        <p className="auth-fine">
          <ShieldCheck aria-hidden="true" /> تُسجَّل محاولات الدخول الناجحة والفاشلة. لا تشارك بيانات حسابك مع أي شخص.
        </p>
      </div>
    </AuthShell>
  )
}

export function LegacyLoginRedirect({ next }: { next: string }) {
  const [, navigate] = useLocation()
  useEffect(() => {
    navigate(`/staff/login?next=${encodeURIComponent(next)}`, { replace: true })
  }, [navigate, next])
  return null
}
