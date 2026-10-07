import type { ReactNode } from 'react'
import { Link } from 'wouter'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { CivicUtilityBar } from './CivicUtilityBar'

/** Identity panel beside sign-in forms: who runs the platform and why it is safe. */
export function AuthAside({ kicker, title, points }: { kicker: string; title: string; points: string[] }) {
  return (
    <div className="auth-aside-inner">
      <span className="auth-aside-kicker">{kicker}</span>
      <h2>{title}</h2>
      <ul>
        {points.map(point => (
          <li key={point}>
            <CheckCircle2 aria-hidden="true" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <div className="auth-aside-seals" aria-hidden="true">
        <img src="/brand/iraq-coat-of-arms.png" alt="" />
        <img src="/brand/dhiqar-unified-logo.png" alt="" />
        <span>
          جمهورية العراق
          <br />
          محافظة ذي قار
        </span>
      </div>
    </div>
  )
}

/** Frame for sign-in, onboarding and portal choice: slim header, form column, identity panel. */
export function AuthShell({
  back = { href: '/', label: 'الصفحة الرئيسية' },
  context,
  aside,
  children,
}: {
  back?: { href: string; label: string }
  context?: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="auth-page">
      <a className="tq-skip-link" href="#main-content">
        تخطَّ إلى المحتوى الرئيسي
      </a>
      <CivicUtilityBar />
      <header className="auth-top">
        <div className="tq-container auth-top-row">
          <Link href="/" className="tq-brand" aria-label="ذي قار الرقمية — الرئيسية">
            <img src="/brand/dhiqar-unified-logo.png" alt="" />
            <span>
              <strong>ذي قار الرقمية</strong>
              <small>{context || 'البوابة الحكومية لمحافظة ذي قار'}</small>
            </span>
          </Link>
          <Link href={back.href} className="button ghost small">
            <ArrowRight /> {back.label}
          </Link>
        </div>
      </header>
      <main id="main-content" className="auth-main">
        <div className={aside ? 'tq-container auth-grid has-aside' : 'tq-container auth-grid'}>
          <div className="auth-body">{children}</div>
          {aside && <aside className="auth-aside">{aside}</aside>}
        </div>
      </main>
      <footer className="auth-foot">
        <div className="tq-container auth-foot-row">
          <span>© {new Date().getFullYear()} محافظة ذي قار</span>
          <nav aria-label="روابط السياسات">
            <Link href="/privacy">الخصوصية</Link>
            <Link href="/terms">شروط الاستخدام</Link>
            <Link href="/accessibility">إمكانية الوصول</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
