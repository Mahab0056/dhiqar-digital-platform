import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import '@fontsource/ibm-plex-sans-arabic/700.css'
import '@fontsource/noto-kufi-arabic/500.css'
import '@fontsource/noto-kufi-arabic/700.css'
import '@fontsource/noto-kufi-arabic/800.css'
import './styles/main.css'
import App from './App.tsx'
import { registerServiceWorker } from './lib/push'

registerServiceWorker()

// apply a saved day-mode choice before the first paint (index.html ships the night theme)
try {
  if (localStorage.getItem('tqd-theme-v2') === 'light') document.documentElement.setAttribute('data-gov-theme', 'light')
} catch {
  /* storage unavailable: keep the default theme */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
