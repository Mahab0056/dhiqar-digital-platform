import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { AlertTriangle, CheckCircle2, KeyRound, LockKeyhole, Mail, ShieldCheck, Smartphone } from 'lucide-react'
import { api, type StaffLoginMethods } from '../../api'
import type { SessionRole, StaffLoginResponse, StaffSession } from '../../types'
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

const rawNext = () => {
  try {
    return new URLSearchParams(window.location.search).get('next')
  } catch {
    return null
  }
}

const nextParam = (role: SessionRole) => {
  const next = rawNext()
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null
  return (allowedPrefixes[role] || []).some(prefix => next.startsWith(prefix)) ? next : null
}

/** Errors the Google callback sends back as /staff/login?error=<code>. */
const signInErrors: Record<string, string> = {
  google_unavailable: 'الدخول بحساب Google غير مفعّل حالياً. استخدم اسم المستخدم وكلمة المرور.',
  google_cancelled: 'أُلغي الدخول بحساب Google. يمكنك المحاولة مرة أخرى متى شئت.',
  google_expired: 'انتهت صلاحية طلب الدخول بحساب Google. ابدأ من جديد.',
  google_failed: 'تعذر إكمال الدخول بحساب Google. حاول مرة أخرى بعد قليل.',
  google_unverified: 'البريد الإلكتروني في حساب Google هذا غير مؤكَّد لدى Google.',
  google_no_account:
    'لا يوجد حساب موظف مرتبط بهذا البريد الإلكتروني. اطلب من مدير النظام ربط بريدك بحسابك من «حسابات الموظفين».',
  google_domain: 'هذا النطاق غير مسموح به لدخول الموظفين. استخدم بريد العمل الرسمي.',
  account_disabled: 'هذا الحساب معطّل. راجع مدير النظام.',
  account_locked: 'تم قفل الحساب مؤقتاً بعد محاولات فاشلة متكررة. حاول بعد 15 دقيقة.',
}

function GoogleMark() {
  return (
    <svg className="auth-google-mark" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

type Step = 'credentials' | 'email-code' | 'mfa' | 'password-change'

export function StaffLoginPage() {
  const [, navigate] = useLocation()
  const [step, setStep] = useState<Step>('credentials')
  const [method, setMethod] = useState<'password' | 'email'>('password')
  const [methods, setMethods] = useState<StaffLoginMethods>({ password: true, google: false, email: false })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailNotice, setEmailNotice] = useState('')
  const [resendIn, setResendIn] = useState(0)
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

  const handleLoginResponse = (result: StaffLoginResponse) => {
    if ('mfaRequired' in result && result.mfaRequired) {
      setChallengeToken(result.challengeToken)
      setCode('')
      setStep('mfa')
    } else finish(result as StaffSession)
  }

  useEffect(() => {
    // the Google callback returns here with ?error=<code>, or with #mfa=<challenge> when TOTP is enabled
    const errorCode = new URLSearchParams(window.location.search).get('error')
    if (errorCode) setError(signInErrors[errorCode] || signInErrors.google_failed)
    const mfa = new URLSearchParams(window.location.hash.slice(1)).get('mfa')
    if (mfa) {
      setChallengeToken(mfa)
      setStep('mfa')
    }
    if (errorCode || mfa) {
      const params = new URLSearchParams(window.location.search)
      params.delete('error')
      const search = params.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}`)
    }
    api
      .staffLoginMethods()
      .then(setMethods)
      .catch(() => {})
    if (!mfa)
      api
        .getSession()
        .then(session => {
          if (session.role !== 'CITIZEN') finish(session)
        })
        .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = window.setTimeout(() => setResendIn(value => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendIn])

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await task()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submitCredentials = () => run(async () => handleLoginResponse(await api.staffLogin(username, password)))

  const sendEmailCode = () =>
    run(async () => {
      const result = await api.requestStaffEmailCode(email.trim())
      setEmailNotice(result.message)
      setResendIn(result.resendAfterSeconds)
      setEmailCode('')
      setStep('email-code')
    })

  const submitEmailCode = () =>
    run(async () => handleLoginResponse(await api.verifyStaffEmailCode(email.trim(), emailCode)))

  const submitMfa = () => run(async () => finish(await api.staffMfa(challengeToken, code)))

  const submitPasswordChange = async () => {
    if (newPassword !== confirmPassword) return setError('كلمتا المرور غير متطابقتين.')
    await run(async () => {
      await api.changeStaffPassword(password, newPassword)
      const session = await api.getSession()
      navigate(nextParam(session.role) || staffHomeForRole(session.role))
    })
  }

  const backToStart = () => {
    setStep('credentials')
    setCode('')
    setEmailCode('')
    setError('')
  }

  const next = rawNext()
  const googleHref = `/api/auth/staff/google/start${next ? `?next=${encodeURIComponent(next)}` : ''}`
  const errorBox = error && (
    <div className="form-error" role="alert">
      <AlertTriangle /> {error}
    </div>
  )

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
          {step === 'mfa' ? (
            <Smartphone />
          ) : step === 'password-change' ? (
            <KeyRound />
          ) : step === 'email-code' || method === 'email' ? (
            <Mail />
          ) : (
            <LockKeyhole />
          )}
        </span>
        {step === 'credentials' && (
          <div className="auth-form">
            <span className="section-kicker">دخول الموظفين</span>
            <h1>تسجيل الدخول إلى حسابك</h1>
            <p className="auth-lead">
              {methods.google && methods.email
                ? 'ادخل بحساب Google أو برمز يصل إلى بريدك الإلكتروني المسجّل لدى إدارة المنصة، أو باسم المستخدم وكلمة المرور.'
                : methods.google
                  ? 'ادخل بحساب Google المرتبط ببريدك المسجّل لدى إدارة المنصة، أو باسم المستخدم وكلمة المرور.'
                  : methods.email
                    ? 'ادخل باسم المستخدم وكلمة المرور، أو برمز يصل إلى بريدك الإلكتروني المسجّل لدى إدارة المنصة.'
                    : 'استخدم اسم المستخدم وكلمة المرور الممنوحين لك من إدارة المنصة.'}
            </p>
            {methods.google && (
              <>
                <a className="auth-google-button" href={googleHref}>
                  <GoogleMark />
                  <span>الدخول بحساب Google</span>
                </a>
                <div className="auth-divider" role="separator">
                  <span>أو</span>
                </div>
              </>
            )}
            {methods.email && (
              <div className="tq-segmented auth-method-switch" role="tablist" aria-label="طريقة الدخول">
                <button
                  type="button"
                  role="tab"
                  aria-selected={method === 'password'}
                  className={method === 'password' ? 'is-active' : ''}
                  onClick={() => {
                    setMethod('password')
                    setError('')
                  }}
                >
                  اسم المستخدم وكلمة المرور
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={method === 'email'}
                  className={method === 'email' ? 'is-active' : ''}
                  onClick={() => {
                    setMethod('email')
                    setError('')
                  }}
                >
                  رمز على البريد الإلكتروني
                </button>
              </div>
            )}
            {method === 'password' || !methods.email ? (
              <form
                className="auth-form"
                onSubmit={event => {
                  event.preventDefault()
                  void submitCredentials()
                }}
              >
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
                {errorBox}
                <button
                  className="button primary full auth-submit"
                  type="submit"
                  disabled={busy || !username || !password}
                >
                  <LockKeyhole /> {busy ? 'جاري التحقق…' : 'دخول آمن'}
                </button>
              </form>
            ) : (
              <form
                className="auth-form"
                onSubmit={event => {
                  event.preventDefault()
                  void sendEmailCode()
                }}
              >
                <label className="tq-field">
                  <span>البريد الإلكتروني للعمل</span>
                  <input
                    type="email"
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    autoComplete="email"
                    inputMode="email"
                    placeholder="name@thi-qar.com"
                    dir="ltr"
                    autoFocus
                  />
                </label>
                {errorBox}
                <button
                  className="button primary full auth-submit"
                  type="submit"
                  disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())}
                >
                  <Mail /> {busy ? 'جاري الإرسال…' : 'أرسل رمز الدخول'}
                </button>
              </form>
            )}
          </div>
        )}
        {step === 'email-code' && (
          <form
            className="auth-form"
            onSubmit={event => {
              event.preventDefault()
              void submitEmailCode()
            }}
          >
            <span className="section-kicker">رمز البريد الإلكتروني</span>
            <h1>أدخل رمز الدخول</h1>
            <p className="auth-lead">
              اكتب الرمز المكوّن من 6 أرقام المرسل إلى <bdi dir="ltr">{email.trim()}</bdi>. ينتهي الرمز خلال 10 دقائق
              ويُستخدم مرة واحدة.
            </p>
            {emailNotice && !error && (
              <div className="form-success" role="status">
                <CheckCircle2 /> {emailNotice}
              </div>
            )}
            <label className="tq-field">
              <span>الرمز</span>
              <input
                className="auth-code"
                value={emailCode}
                onChange={event => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                autoFocus
              />
            </label>
            {errorBox}
            <button className="button primary full auth-submit" type="submit" disabled={busy || emailCode.length !== 6}>
              {busy ? 'جاري التحقق…' : 'تأكيد ودخول'}
            </button>
            <div className="auth-inline-actions">
              <button
                type="button"
                className="button ghost"
                disabled={busy || resendIn > 0}
                onClick={() => void sendEmailCode()}
              >
                {resendIn > 0 ? `إعادة الإرسال بعد ${resendIn} ث` : 'أعد إرسال الرمز'}
              </button>
              <button type="button" className="button ghost" onClick={backToStart}>
                تغيير البريد
              </button>
            </div>
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
            {errorBox}
            <button className="button primary full auth-submit" type="submit" disabled={busy || code.length !== 6}>
              {busy ? 'جاري التحقق…' : 'تأكيد'}
            </button>
            <button type="button" className="button ghost full" onClick={backToStart}>
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
            {errorBox}
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
          <ShieldCheck aria-hidden="true" /> تُسجَّل محاولات الدخول الناجحة والفاشلة. لا تشارك بيانات حسابك أو رموز
          الدخول مع أي شخص.
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
