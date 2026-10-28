import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { navigate } from './lib/router'

// The service worker shows pushes (weekly review, alerts) and opens the route they name.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent<{ type?: string; route?: string }>) => {
    if (e.data?.type === 'ledger:navigate' && typeof e.data.route === 'string' && e.data.route.startsWith('/')) navigate(e.data.route)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
