import { useEffect, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { AlertTriangle, ArrowRight, KeyRound, LockKeyhole, ShieldCheck, Smartphone } from 'lucide-react'
import { api } from '../../api'
import type { SessionRole, StaffSession } from '../../types'
import { Brand } from '../../components/public/Brand'
import { CivicUtilityBar } from '../../components/public/CivicUtilityBar'

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
    <div className="login-page staff-login">
      <CivicUtilityBar />
      <div className="login-backdrop" />
      <div className="login-top container">
        <Brand />
        <Link href="/login">
          <ArrowRight /> بوابات الدخول
        </Link>
      </div>
      <main className="container login-content">
        <div className="login-intro">
          <span className="eyebrow">
            <ShieldCheck size={16} /> STAFF ACCESS
          </span>
          <h1>دخول موظفي المنصة</h1>
          <p>
            حساب شخصي لكل موظف بصلاحيات محددة حسب الدور والدائرة. كل إجراء يُسجل باسم صاحبه في سجل التدقيق. المصادقة
            الثنائية متاحة من صفحة الأمان بعد الدخول.
          </p>
        </div>
        <section className="staff-login-card" aria-live="polite">
          <span className="staff-login-icon">
            {step === 'mfa' ? <Smartphone /> : step === 'password-change' ? <KeyRound /> : <LockKeyhole />}
          </span>
          {step === 'credentials' && (
            <form
              onSubmit={event => {
                event.preventDefault()
                void submitCredentials()
              }}
            >
              <strong>بيانات الحساب</strong>
              <label>
                اسم المستخدم
                <input
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  autoComplete="username"
                  dir="ltr"
                  autoFocus
                />
              </label>
              <label>
                كلمة المرور
                <input
                  type="password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  autoComplete="current-password"
                  dir="ltr"
                />
              </label>
              {error && (
                <div className="form-error">
                  <AlertTriangle /> {error}
                </div>
              )}
              <button className="button primary full" type="submit" disabled={busy || !username || !password}>
                {busy ? 'جاري التحقق...' : 'دخول آمن'}
              </button>
            </form>
          )}
          {step === 'mfa' && (
            <form
              onSubmit={event => {
                event.preventDefault()
                void submitMfa()
              }}
            >
              <strong>رمز المصادقة الثنائية</strong>
              <p className="staff-login-hint">افتح تطبيق المصادقة على هاتفك وأدخل الرمز المكون من 6 أرقام.</p>
              <label>
                الرمز
                <input
                  value={code}
                  onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  autoFocus
                />
              </label>
              {error && (
                <div className="form-error">
                  <AlertTriangle /> {error}
                </div>
              )}
              <button className="button primary full" type="submit" disabled={busy || code.length !== 6}>
                {busy ? 'جاري التحقق...' : 'تأكيد'}
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
              onSubmit={event => {
                event.preventDefault()
                void submitPasswordChange()
              }}
            >
              <strong>تغيير كلمة المرور المؤقتة</strong>
              <p className="staff-login-hint">
                هذه أول جلسة بكلمة مرور مؤقتة. اختر كلمة مرور جديدة (12 حرفاً على الأقل، بثلاثة أنواع من الأحرف والأرقام
                والرموز).
              </p>
              <label>
                كلمة المرور الجديدة
                <input
                  type="password"
                  value={newPassword}
                  onChange={event => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  dir="ltr"
                  autoFocus
                />
              </label>
              <label>
                تأكيد كلمة المرور
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={event => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  dir="ltr"
                />
              </label>
              {error && (
                <div className="form-error">
                  <AlertTriangle /> {error}
                </div>
              )}
              <button
                className="button primary full"
                type="submit"
                disabled={busy || newPassword.length < 12 || confirmPassword.length < 12}
              >
                {busy ? 'جاري الحفظ...' : 'حفظ ومتابعة'}
              </button>
            </form>
          )}
          <small>
            تُسجل محاولات الدخول الناجحة والفاشلة. يُقفل الحساب مؤقتاً بعد 5 محاولات فاشلة. لا تشارك بيانات حسابك مع أي
            شخص.
          </small>
        </section>
      </main>
    </div>
  )
}

export function LegacyLoginRedirect({ next }: { next: string }) {
  const [, navigate] = useLocation()
  useEffect(() => {
    navigate(`/staff/login?next=${encodeURIComponent(next)}`, { replace: true })
  }, [navigate, next])
  return null
}
