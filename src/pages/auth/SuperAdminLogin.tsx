import { useEffect, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { AlertTriangle, ArrowRight, ShieldCheck } from 'lucide-react'
import { api } from '../../api'
import { Brand } from '../../components/public/Brand'
import { CivicUtilityBar } from '../../components/public/CivicUtilityBar'

export function SuperAdminLogin() {
  const [, navigate] = useLocation()
  const [accessCode, setAccessCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    api
      .getSession()
      .then(session => {
        if (session.role === 'SUPER_ADMIN') navigate('/super-admin')
      })
      .catch(() => {})
  }, [navigate])
  const login = async () => {
    setBusy(true)
    setError('')
    try {
      await api.loginSuperAdmin(accessCode)
      navigate('/super-admin')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="login-page super-admin-login">
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
            <ShieldCheck size={16} /> SYSTEM GOVERNANCE
          </span>
          <h1>دخول المدير العام للنظام</h1>
          <p>هذه البوابة مخصصة لإدارة المنصة ومراجعة المؤشرات وسجل الإجراءات. رمزها مستقل عن حساب الموظف والمواطن.</p>
        </div>
        <section className="super-admin-login-card">
          <span className="super-admin-shield">
            <ShieldCheck />
          </span>
          <strong>SUPER ADMIN</strong>
          <label>
            رمز دخول المدير العام
            <input
              value={accessCode}
              onChange={event => setAccessCode(event.target.value)}
              type="password"
              autoComplete="current-password"
              onKeyDown={event => {
                if (event.key === 'Enter' && accessCode.length >= 12) void login()
              }}
            />
          </label>
          {error && (
            <div className="form-error">
              <AlertTriangle /> {error}
            </div>
          )}
          <button
            className="button primary full"
            onClick={() => void login()}
            disabled={busy || accessCode.length < 12}
          >
            {busy ? 'جاري التحقق...' : 'دخول آمن'}
          </button>
          <small>تسجل جلسات المدير العام والإجراءات الحساسة في سجل التدقيق.</small>
        </section>
      </main>
    </div>
  )
}
