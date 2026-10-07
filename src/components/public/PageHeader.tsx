import type { ReactNode } from 'react'
import { Link } from 'wouter'
import { AlertTriangle, ChevronLeft, RefreshCw } from 'lucide-react'

export type Crumb = { label: string; href?: string }

/**
 * The one header every inner public page uses: breadcrumb → kicker → title → description → meta/actions,
 * with an optional aside (figures, a summary card) and a slot under it (search, filters).
 */
export function PageHeader({
  crumbs = [],
  kicker,
  title,
  description,
  meta,
  actions,
  aside,
  children,
  compact = false,
}: {
  crumbs?: Crumb[]
  kicker?: ReactNode
  title: ReactNode
  description?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  aside?: ReactNode
  children?: ReactNode
  compact?: boolean
}) {
  return (
    <section className={compact ? 'tq-page-header is-compact' : 'tq-page-header'}>
      <div className="tq-container">
        <nav className="tq-breadcrumb" aria-label="مسار التنقل">
          <ol>
            <li>
              <Link href="/">الرئيسية</Link>
            </li>
            {crumbs.map(crumb => (
              <li key={crumb.label}>
                <ChevronLeft aria-hidden="true" />
                {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
        <div className={aside ? 'tq-page-header-row has-aside' : 'tq-page-header-row'}>
          <div className="tq-page-header-main">
            {kicker && <span className="section-kicker">{kicker}</span>}
            <h1>{title}</h1>
            {description && <p className="tq-page-lead">{description}</p>}
            {meta && <div className="tq-page-meta">{meta}</div>}
            {actions && <div className="tq-page-actions">{actions}</div>}
          </div>
          {aside && <div className="tq-page-header-aside">{aside}</div>}
        </div>
        {children && <div className="tq-page-header-slot">{children}</div>}
      </div>
    </section>
  )
}

export function LoadingBlock({ label = 'جاري التحميل…' }: { label?: string }) {
  return (
    <div className="tq-state" role="status" aria-live="polite">
      <RefreshCw className="spin" aria-hidden="true" />
      <p>{label}</p>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  text,
  action,
  tone = 'neutral',
}: {
  icon?: ReactNode
  title: ReactNode
  text?: ReactNode
  action?: ReactNode
  tone?: 'neutral' | 'danger'
}) {
  return (
    <div className={tone === 'danger' ? 'tq-state is-danger' : 'tq-state'}>
      <span className="tq-state-icon" aria-hidden="true">
        {icon || <AlertTriangle />}
      </span>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {action}
    </div>
  )
}
