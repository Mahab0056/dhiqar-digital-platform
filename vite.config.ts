import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        advancedChunks: {
          minSize: 20_000,
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler|wouter)[\\/]/ },
            { name: 'vendor-charts', test: /node_modules[\\/](recharts|d3-|victory|internmap)/ },
            { name: 'vendor-map', test: /node_modules[\\/](leaflet|react-leaflet|@react-leaflet)/ },
            { name: 'vendor-motion', test: /node_modules[\\/](framer-motion|motion)/ },
            { name: 'vendor-icons', test: /node_modules[\\/]lucide-react/ },
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/uploads': 'http://localhost:8787',
    },
  },
})
