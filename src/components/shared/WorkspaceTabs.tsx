import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export type WorkspaceTab = {
  id: string
  label: string
  icon: LucideIcon
  badge?: number | string | null
  content: ReactNode
}

/** Hash-routed tabs (#id) so sidebar links and deep links open the right section; one section on screen at a time. */
export function WorkspaceTabs({
  tabs,
  defaultTab,
  ariaLabel,
}: {
  tabs: WorkspaceTab[]
  defaultTab?: string
  ariaLabel: string
}) {
  const resolve = () => {
    const hash = window.location.hash.replace('#', '')
    return tabs.some(tab => tab.id === hash) ? hash : defaultTab || tabs[0].id
  }
  const [active, setActive] = useState(resolve)
  useEffect(() => {
    const onHash = () => setActive(resolve())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.map(tab => tab.id).join('|')])
  const select = (id: string) => {
    setActive(id)
    window.history.replaceState(null, '', `#${id}`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const current = tabs.find(tab => tab.id === active) || tabs[0]
  return (
    <div className="workspace-tabs">
      <nav className="workspace-tabbar" role="tablist" aria-label={ariaLabel}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === current.id}
            className={tab.id === current.id ? 'active' : ''}
            onClick={() => select(tab.id)}
          >
            <tab.icon />
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge !== null && tab.badge !== 0 && <b>{String(tab.badge)}</b>}
          </button>
        ))}
      </nav>
      <div className="workspace-tabpanel" role="tabpanel" key={current.id}>
        {current.content}
      </div>
    </div>
  )
}
