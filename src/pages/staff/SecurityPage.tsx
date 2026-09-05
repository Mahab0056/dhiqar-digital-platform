import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, KeyRound, MonitorSmartphone, ShieldCheck, Smartphone, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { useSession } from '../../lib/session'
import type { StaffSessionItem } from '../../types'
import { PortalLayout } from '../../components/citizen/PortalLayout'

function PasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (next !== confirm) return setMessage({ tone: 'error', text: 'كلمتا المرور غير متطابقتين.' })
    setBusy(true)
    setMessage(null)
    try {
      const result = await api.changeStaffPassword(current, next)
      setMessage({
        tone: 'ok',
        text: `تم تغيير كلمة المرور. ${result.otherSessionsRevoked ? `أُنهيت ${result.otherSessionsRevoked} جلسة أخرى.` : ''}`,
      })
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (error) {
      setMessage({ tone: 'error', text: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="security-card">
      <header>
        <span className="security-card-icon">
          <KeyRound />
        </span>
        <div>
          <h2>كلمة المرور</h2>
          <p>12 حرفاً على الأقل مع ثلاثة أنواع من الأحرف والأرقام والرموز. تغييرها ينهي الجلسات الأخرى.</p>
        </div>
      </header>
      <form
        className="security-form"
        onSubmit={event => {
          event.preventDefault()
          void submit()
        }}
      >
        <label>
          كلمة المرور الحالية
          <input
            type="password"
            value={current}
            onChange={e => setCurrent(e.target.value)}
            autoComplete="current-password"
            dir="ltr"
          />
        </label>
        <label>
          كلمة المرور الجديدة
          <input
            type="password"
            value={next}
            onChange={e => setNext(e.target.value)}
            autoComplete="new-password"
            dir="ltr"
          />
        </label>
        <label>
          تأكيد كلمة المرور الجديدة
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password"
            dir="ltr"
          />
        </label>
        {message && (
          <div className={message.tone === 'ok' ? 'form-success' : 'form-error'}>
            {message.tone === 'ok' ? <CheckCircle2 /> : <AlertTriangle />} {message.text}
          </div>
        )}
        <button className="button primary" type="submit" disabled={busy || !current || next.length < 12}>
          {busy ? 'جاري الحفظ...' : 'تغيير كلمة المرور'}
        </button>
      </form>
    </section>
  )
}

function MfaSection({ enabled, onChanged }: { enabled: boolean; onChanged: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (task: () => Promise<void>, success: string) => {
    setBusy(true)
    setMessage(null)
    try {
      await task()
      setMessage({ tone: 'ok', text: success })
      setCode('')
      setPassword('')
      onChanged()
    } catch (error) {
      setMessage({ tone: 'error', text: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="security-card">
      <header>
        <span className="security-card-icon">
          <Smartphone />
        </span>
        <div>
          <h2>المصادقة الثنائية (TOTP)</h2>
          <p>
            {enabled
              ? 'مفعّلة. سيُطلب رمز من تطبيق المصادقة عند كل دخول.'
              : 'غير مفعّلة. استخدم Google Authenticator أو Microsoft Authenticator أو أي تطبيق TOTP.'}
          </p>
        </div>
        <span className={enabled ? 'status-pill on' : 'status-pill off'}>{enabled ? 'مفعّلة' : 'غير مفعّلة'}</span>
      </header>
      {!enabled && !setup && (
        <button
          className="button primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await api.mfaSetup()
              setSetup(result)
            }, 'امسح الرمز ثم أدخل الرمز المعروض في التطبيق.')
          }
        >
          بدء الإعداد
        </button>
      )}
      {!enabled && setup && (
        <div className="mfa-setup">
          <img src={setup.qrDataUrl} alt="رمز QR لإعداد المصادقة الثنائية" width={200} height={200} />
          <div>
            <p>أو أدخل المفتاح يدوياً:</p>
            <code dir="ltr">{setup.secret}</code>
            <label>
              رمز التحقق من التطبيق
              <input
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                dir="ltr"
              />
            </label>
            <button
              className="button primary"
              disabled={busy || code.length !== 6}
              onClick={() =>
                void run(async () => {
                  await api.mfaConfirm(code)
                  setSetup(null)
                }, 'تم تفعيل المصادقة الثنائية.')
              }
            >
              تأكيد التفعيل
            </button>
          </div>
        </div>
      )}
      {enabled && (
        <form
          className="security-form inline"
          onSubmit={event => {
            event.preventDefault()
            void run(() => api.mfaDisable(password, code).then(() => undefined), 'تم تعطيل المصادقة الثنائية.')
          }}
        >
          <label>
            كلمة المرور
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              dir="ltr"
              autoComplete="current-password"
            />
          </label>
          <label>
            رمز التطبيق
            <input
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              dir="ltr"
            />
          </label>
          <button className="button danger" type="submit" disabled={busy || !password || code.length !== 6}>
            تعطيل
          </button>
        </form>
      )}
      {message && (
        <div className={message.tone === 'ok' ? 'form-success' : 'form-error'}>
          {message.tone === 'ok' ? <CheckCircle2 /> : <AlertTriangle />} {message.text}
        </div>
      )}
    </section>
  )
}

function SessionsSection() {
  const [items, setItems] = useState<StaffSessionItem[]>([])
  const [busy, setBusy] = useState(false)
  const load = () =>
    api
      .listMySessions()
      .then(setItems)
      .catch(() => setItems([]))
  useEffect(() => {
    void load()
  }, [])
  const format = (value: string) => new Date(value).toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <section className="security-card">
      <header>
        <span className="security-card-icon">
          <MonitorSmartphone />
        </span>
        <div>
          <h2>الجلسات النشطة</h2>
          <p>الأجهزة المتصلة بحسابك حالياً. أنهِ أي جلسة لا تعرفها.</p>
        </div>
        {items.length > 1 && (
          <button
            className="button ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await api.revokeOtherSessions().catch(() => null)
              await load()
              setBusy(false)
            }}
          >
            إنهاء الجلسات الأخرى
          </button>
        )}
      </header>
      <ul className="sessions-list">
        {items.map(item => (
          <li key={item.id}>
            <div>
              <strong>{item.current ? 'هذا الجهاز' : 'جهاز آخر'}</strong>
              <small dir="ltr">{item.userAgent || '—'}</small>
              <small>
                بدأت {format(item.createdAt)} • آخر نشاط {format(item.lastSeenAt)}
              </small>
            </div>
            {!item.current && (
              <button
                className="icon-button"
                aria-label="إنهاء الجلسة"
                onClick={async () => {
                  await api.revokeSession(item.id).catch(() => null)
                  await load()
                }}
              >
                <Trash2 />
              </button>
            )}
          </li>
        ))}
        {!items.length && <li className="muted">لا توجد جلسات مسجلة.</li>}
      </ul>
    </section>
  )
}

export function SecurityPage() {
  const { session, refresh } = useSession()
  return (
    <PortalLayout role="employee">
      <section className="employee-heading">
        <div>
          <span className="section-kicker">
            <ShieldCheck size={14} /> أمان الحساب
          </span>
          <h1>الأمان والحساب</h1>
          <p>
            {session?.displayName || session?.username} — {session?.departmentName || session?.role}
          </p>
        </div>
      </section>
      <div className="security-grid">
        <PasswordSection />
        <MfaSection enabled={Boolean(session?.mfaEnabled)} onChanged={() => void refresh()} />
        <SessionsSection />
      </div>
    </PortalLayout>
  )
}
