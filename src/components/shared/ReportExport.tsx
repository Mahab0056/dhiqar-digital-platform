import { useState } from 'react'
import { Download } from 'lucide-react'

const isoDay = (date: Date) => date.toISOString().slice(0, 10)

/** Date range + download of the transactions report (CSV that opens in Excel). The server scopes it by role. */
export function ReportExport({ label = 'تقرير المعاملات (Excel)' }: { label?: string }) {
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 30 * 86_400_000)))
  const [to, setTo] = useState(() => isoDay(new Date()))
  const href = `/api/reports/transactions.csv?from=${from}&to=${to}`
  return (
    <div className="report-export" role="group" aria-label={label}>
      <label>
        من
        <input type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} />
      </label>
      <label>
        إلى
        <input
          type="date"
          value={to}
          min={from}
          max={isoDay(new Date())}
          onChange={event => setTo(event.target.value)}
        />
      </label>
      <a className="button outline" href={href} download>
        <Download aria-hidden="true" /> {label}
      </a>
    </div>
  )
}
