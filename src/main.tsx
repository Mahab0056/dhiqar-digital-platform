import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import '@fontsource/ibm-plex-sans-arabic/700.css'
import '@fontsource/readex-pro/arabic-300.css'
import '@fontsource/readex-pro/arabic-400.css'
import '@fontsource/readex-pro/arabic-500.css'
import '@fontsource/readex-pro/arabic-600.css'
import '@fontsource/readex-pro/arabic-700.css'
import '@fontsource/readex-pro/latin-400.css'
import '@fontsource/readex-pro/latin-600.css'
import './styles/main.css'
import App from './App.tsx'
import { registerServiceWorker } from './lib/push'

registerServiceWorker()

// apply a saved night-mode choice before the first paint
try {
  if (localStorage.getItem('tqd-theme-v3') === 'dark') document.documentElement.setAttribute('data-gov-theme', 'dark')
} catch {
  /* storage unavailable: keep the default theme */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
