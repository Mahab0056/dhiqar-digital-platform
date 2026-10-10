import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, DownloadCloud, ExternalLink, Eye, EyeOff, RefreshCw, Search } from 'lucide-react'
import { api } from '../../api'
import type { AdminNewsListResponse } from '../../types'
import { formatDate, relativeTime } from '../../lib/news-format'

/** Aggregated news moderation: hide an inappropriate item, or fetch all sources now. */
export function NewsModerationPanel() {
  const [data, setData] = useState<AdminNewsListResponse | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (q = '') => {
    try {
      setData(await api.listAdminNews({ q: q || undefined, limit: 100 }))
      setError('')
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = async () => {
    setBusy(true)
    try {
      await api.refreshNews()
      await load(query)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (id: string, hidden: boolean) => {
    try {
      const item = await api.setNewsHidden(id, hidden)
      setData(current =>
        current ? { ...current, items: current.items.map(old => (old.id === id ? item : old)) } : current
      )
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const lastRun = data?.status.lastRun
  return (
    <section className="admin-panel news-moderation-panel" id="news-moderation">
      <div className="panel-heading">
        <div>
          <h2>أخبار ذي قار — الإشراف</h2>
          <p>
            تُجمع الأخبار تلقائياً كل ساعة من مصادر RSS عامة.{' '}
            {lastRun
              ? `آخر جلب ${relativeTime(lastRun.finishedAt)}: ${lastRun.added} جديد، ${lastRun.total} مخزّن.`
              : 'لم يُنفَّذ جلب بعد.'}
          </p>
        </div>
        <div className="department-workbench-actions">
          <button className="button primary" onClick={() => void refresh()} disabled={busy}>
            <DownloadCloud className={busy ? 'spin' : ''} /> {busy ? 'جارٍ الجلب…' : 'جلب الآن'}
          </button>
        </div>
      </div>
      {error && (
        <div className="form-error" role="alert">
          <AlertTriangle /> {error}
        </div>
      )}
      {lastRun && (
        <ul className="news-source-status">
          {lastRun.sources.map(source => (
            <li key={source.id}>
              <span className={source.ok ? 'status-pill on' : 'status-pill danger'}>
                {source.ok ? 'يعمل' : 'تعذّر'}
              </span>
              <strong>{source.name}</strong>
              <small className="muted">
                {source.ok ? `${source.kept} ذو صلة من ${source.parsed} · ${source.added} جديد` : source.error}
              </small>
            </li>
          ))}
        </ul>
      )}
      <form
        className="staff-table-tools"
        onSubmit={event => {
          event.preventDefault()
          void load(query)
        }}
      >
        <label className="depts-search">
          <Search aria-hidden="true" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="بحث في العناوين" />
        </label>
        <button className="button ghost" type="submit">
          <RefreshCw /> بحث
        </button>
      </form>
      <div className="table-scroll">
        <table className="staff-table">
          <thead>
            <tr>
              <th>العنوان</th>
              <th>المصدر</th>
              <th>النشر</th>
              <th>الحالة</th>
              <th>إجراء</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map(item => (
              <tr key={item.id} className={item.hidden ? 'disabled-row' : ''}>
                <td>
                  <a href={item.link} target="_blank" rel="noopener noreferrer">
                    {item.title} <ExternalLink size={12} aria-hidden="true" />
                  </a>
                  {item.kind === 'TENDER' && <small className="muted"> · إعلان مناقصة/مزاد</small>}
                </td>
                <td>{item.sourceName}</td>
                <td>
                  <small>{formatDate(item.publishedAt, true)}</small>
                </td>
                <td>
                  <span className={item.hidden ? 'status-pill off' : 'status-pill on'}>
                    {item.hidden ? 'مخفي' : 'ظاهر'}
                  </span>
                </td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="icon-button"
                    title={item.hidden ? 'إظهار' : 'إخفاء'}
                    aria-label={item.hidden ? 'إظهار الخبر' : 'إخفاء الخبر'}
                    onClick={() => void toggle(item.id, !item.hidden)}
                  >
                    {item.hidden ? <Eye /> : <EyeOff />}
                  </button>
                </td>
              </tr>
            ))}
            {data && !data.items.length && (
              <tr>
                <td colSpan={5} className="muted">
                  لا توجد أخبار مخزّنة بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
