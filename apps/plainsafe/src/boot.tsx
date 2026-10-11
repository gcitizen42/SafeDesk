// netguard must be the first import: it wraps fetch, WebSocket, XHR and sendBeacon before any
// other module (React, viem, wagmi, …) is evaluated. Keep it first.
import './netguard'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './app'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
