import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Database, DownloadCloud, RefreshCw, ShieldCheck } from 'lucide-react'
import { api } from '../../api'

type Status = Awaited<ReturnType<typeof api.getDatabaseStatus>>

const formatBytes = (value: number) =>
  value > 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`

export function SystemHealthPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      setStatus(await api.getDatabaseStatus())
      setError('')
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const backupNow = async () => {
    setBusy(true)
    try {
      await api.createBackup()
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="admin-panel system-health-panel" id="system-health">
      <div className="panel-heading">
        <div>
          <h2>قاعدة البيانات والنسخ الاحتياطي</h2>
          <p>
            {status
              ? `${status.engine.toUpperCase()} • ${formatBytes(status.sizeBytes)} • وضع ${status.journalMode.toUpperCase()} • نسخة كل ${status.intervalHours} ساعات، احتفاظ ${status.retentionDays} يوماً`
              : 'جارٍ التحميل...'}
          </p>
        </div>
        <div className="department-workbench-actions">
          <button className="button ghost" onClick={() => void load()}>
            <RefreshCw /> تحديث
          </button>
          <button className="button primary" onClick={() => void backupNow()} disabled={busy}>
            <DownloadCloud /> {busy ? 'جاري النسخ...' : 'نسخة احتياطية الآن'}
          </button>
        </div>
      </div>
      {error && (
        <div className="form-error">
          <AlertTriangle /> {error}
        </div>
      )}
      {status && (
        <div className="system-health-grid">
          <div className="system-health-card">
            <span className={status.integrity.ok ? 'status-pill on' : 'status-pill danger'}>
              <ShieldCheck size={12} /> {status.integrity.ok ? 'سلامة البيانات: سليمة' : 'سلامة البيانات: خلل'}
            </span>
            <ul className="system-tables">
              {status.tables
                .filter(table => table.rows > 0)
                .sort((a, b) => b.rows - a.rows)
                .slice(0, 12)
                .map(table => (
                  <li key={table.name}>
                    <span dir="ltr">{table.name}</span>
                    <strong>{table.rows.toLocaleString('en-US')}</strong>
                  </li>
                ))}
            </ul>
          </div>
          <div className="system-health-card">
            <h3>
              <Database size={15} /> آخر النسخ الاحتياطية
            </h3>
            <ul className="system-backups">
              {status.backups.slice(0, 8).map(backup => (
                <li key={backup.file}>
                  <span dir="ltr">{backup.file}</span>
                  <small>
                    {formatBytes(backup.sizeBytes)} •{' '}
                    {new Date(backup.createdAt).toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' })}
                  </small>
                </li>
              ))}
              {!status.backups.length && <li className="muted">لا توجد نسخ بعد.</li>}
            </ul>
            <small className="muted" dir="ltr">
              {status.backupDir}
            </small>
          </div>
        </div>
      )}
    </section>
  )
}
