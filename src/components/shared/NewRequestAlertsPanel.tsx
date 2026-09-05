import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'wouter'
import { AlertTriangle, ArrowLeft, Bell, RefreshCw } from 'lucide-react'
import { api } from '../../api'

export function NewRequestAlertsPanel({ scope }: { scope: 'admin' | 'operations' }) {
  const [alerts, setAlerts] = useState<
    Array<{
      reference: string
      serviceName: string
      department: string
      status: string
      createdAt: string
      updatedAt: string
    }>
  >([])
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const knownReferences = useRef(new Set<string>())
  const playNotificationTone = () => {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return
      const context = new AudioContextClass()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(880, context.currentTime)
      gain.gain.setValueAtTime(0.0001, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.025)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.3)
      setTimeout(() => void context.close(), 500)
    } catch {
      /* Browser may block sound until interaction; the visual alert remains available. */
    }
  }
  const load = useCallback(
    async (allowSound = false) => {
      try {
        const response = await api.getNewRequestAlerts()
        const next = response.alerts
        const hasNew = next.some(
          item => knownReferences.current.size > 0 && !knownReferences.current.has(item.reference)
        )
        knownReferences.current = new Set(next.map(item => item.reference))
        setAlerts(next)
        if (allowSound && soundEnabled && hasNew) playNotificationTone()
        setError('')
      } catch (item) {
        setError((item as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [soundEnabled]
  )
  useEffect(() => {
    void load(false)
    const timer = window.setInterval(() => void load(true), 20_000)
    return () => window.clearInterval(timer)
  }, [load])
  const enableSound = () => {
    const next = !soundEnabled
    setSoundEnabled(next)
    if (next) playNotificationTone()
  }
  return (
    <section
      className={`new-request-alerts ${scope}`}
      id={scope === 'operations' ? 'operations-alerts' : 'admin-alerts'}
    >
      <header className="panel-heading">
        <div>
          <span className="section-kicker">متابعة فورية</span>
          <h2>طلبات جديدة</h2>
          <p>تُحدّث كل 20 ثانية من الطلبات المسجلة في المنصة. يظهر صوت التنبيه بعد تفعيله من هذا الزر.</p>
        </div>
        <div className="alerts-actions">
          <button type="button" className={soundEnabled ? 'button primary' : 'button outline'} onClick={enableSound}>
            <Bell /> {soundEnabled ? 'الصوت مفعّل' : 'تفعيل صوت التنبيه'}
          </button>
          <button type="button" className="button ghost" onClick={() => void load(false)} disabled={loading}>
            <RefreshCw className={loading ? 'spin' : ''} /> تحديث
          </button>
        </div>
      </header>
      {error && (
        <div className="form-error">
          <AlertTriangle /> {error}
        </div>
      )}
      {alerts.length === 0 && !loading ? (
        <div className="admin-empty-state">
          <Bell />
          <span>لا توجد طلبات جديدة بانتظار المراجعة حالياً.</span>
        </div>
      ) : (
        <div className="new-request-alert-list">
          {alerts.map(item => (
            <article key={item.reference}>
              <span className="new-request-dot" />
              <div>
                <strong>{item.serviceName}</strong>
                <small>
                  {item.reference} • {item.department}
                </small>
              </div>
              <time>{new Date(item.createdAt).toLocaleString('en-GB')}</time>
              {scope === 'admin' && (
                <Link className="button outline" href="/employee#employee-service-requests">
                  فتح المعاملة <ArrowLeft />
                </Link>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
