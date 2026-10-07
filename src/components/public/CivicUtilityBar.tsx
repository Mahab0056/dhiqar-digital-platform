import { useEffect, useState } from 'react'
import { Accessibility, Globe, Moon, Sun } from 'lucide-react'

// v3: day theme is the default again; older keys stored whatever default the visitor first saw
const THEME_KEY = 'tqd-theme-v3'

function readTheme(): 'light' | 'dark' {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/** Presentation-only night mode: toggles a data attribute consumed by the public design tokens. */
export function useNightMode() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => readTheme())
  useEffect(() => {
    document.documentElement.setAttribute('data-gov-theme', theme)
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* storage unavailable */
    }
  }, [theme])
  return { theme, toggle: () => setTheme(current => (current === 'dark' ? 'light' : 'dark')) }
}

export function CivicUtilityBar() {
  const { theme, toggle } = useNightMode()
  return (
    <div className="tq-utility">
      <div className="tq-container tq-utility-row">
        <span className="tq-utility-identity">
          <img src="/brand/iraq-coat-of-arms.png" alt="" aria-hidden="true" />
          <strong>جمهورية العراق</strong>
          <i aria-hidden="true" />
          <span>محافظة ذي قار</span>
        </span>
        <nav className="tq-utility-links" aria-label="خيارات العرض">
          <button type="button" onClick={toggle} aria-pressed={theme === 'dark'}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            <span>{theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}</span>
          </button>
          <a href="/accessibility">
            <Accessibility size={14} />
            <span>إمكانية الوصول</span>
          </a>
          <span className="tq-utility-lang" title="النسخة الإنجليزية قيد الإعداد" aria-disabled="true">
            English <small>(قريباً)</small>
          </span>
          <span className="tq-utility-lang is-active">
            <Globe size={14} /> العربية
          </span>
        </nav>
      </div>
    </div>
  )
}
