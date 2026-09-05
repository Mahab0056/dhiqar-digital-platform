import { useEffect, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { AlertTriangle, ArrowRight, MonitorCheck } from 'lucide-react'
import { api } from '../../api'
import { Brand } from '../../components/public/Brand'
import { CivicUtilityBar } from '../../components/public/CivicUtilityBar'

export function OperationsLogin() {
  const [, navigate] = useLocation()
  const [accessCode, setAccessCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    api
      .getSession()
      .then(session => {
        if (session.role === 'OPERATIONS' || session.role === 'EMPLOYEE' || session.role === 'SUPER_ADMIN')
          navigate('/operations')
      })
      .catch(() => {})
  }, [navigate])
  const login = async () => {
    setBusy(true)
    setError('')
    try {
      await api.loginOperations(accessCode)
      navigate('/operations')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="login-page operations-login">
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
            <MonitorCheck size={16} /> غرفة العمليات
          </span>
          <h1>دخول غرفة العمليات</h1>
          <p>
            هذه البوابة مخصصة للمتابعة التشغيلية وقراءة مؤشرات الدوائر فقط. رمزها مستقل عن دخول الموظف والمدير العام.
          </p>
        </div>
        <section className="super-admin-login-card operations-login-card">
          <span className="super-admin-shield">
            <MonitorCheck />
          </span>
          <strong>وصول تشغيلي</strong>
          <label>
            رمز دخول غرفة العمليات
            <input
              value={accessCode}
              onChange={event => setAccessCode(event.target.value.replace(/\D/g, '').slice(0, 4))}
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              placeholder="••••"
              onKeyDown={event => {
                if (event.key === 'Enter' && accessCode.length === 4) void login()
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
            disabled={busy || accessCode.length !== 4}
          >
            {busy ? 'جاري التحقق...' : 'دخول غرفة العمليات'}
          </button>
          <small>هذا الرمز مؤقت، ولا يمنح هذا الدور حق مراجعة الهويات أو فتح مرفقات المواطنين.</small>
        </section>
      </main>
    </div>
  )
}
