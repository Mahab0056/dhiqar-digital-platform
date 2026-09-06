import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import '@fontsource/ibm-plex-sans-arabic/700.css'
import '@fontsource/noto-kufi-arabic/500.css'
import '@fontsource/noto-kufi-arabic/700.css'
import '@fontsource/noto-kufi-arabic/800.css'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './lib/push'

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
