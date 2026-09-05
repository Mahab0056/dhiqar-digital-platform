import { useEffect, useState } from 'react'
import { Accessibility, Globe, Moon, Sun } from 'lucide-react'

const THEME_KEY = 'tqd-theme'

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
    <div className="gov-utility">
      <div className="gov-container">
        <span className="gov-utility-identity">
          <img src="/brand/iraq-coat-of-arms.png" alt="" aria-hidden="true" />
          <strong>جمهورية العراق</strong>
          <i aria-hidden="true" />
          <span>محافظة ذي قار</span>
        </span>
        <nav className="gov-utility-links" aria-label="خيارات العرض">
          <button type="button" onClick={toggle} aria-pressed={theme === 'dark'}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />} الوضع الليلي
          </button>
          <a href="#accessibility">
            <Accessibility size={14} /> إمكانية الوصول
          </a>
          <span className="gov-utility-lang is-muted" title="النسخة الإنجليزية قيد الإعداد">
            English
          </span>
          <span className="gov-utility-lang is-active">
            <Globe size={14} /> العربية
          </span>
        </nav>
      </div>
    </div>
  )
}
