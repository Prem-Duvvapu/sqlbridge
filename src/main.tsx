import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './ErrorBoundary'
import './App.css'

const container = document.getElementById('root')

if (container) {
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
} else {
  // The one thing the boundary can't catch: no mount point at all.
  document.body.textContent = 'SQLBridge could not start — the page is missing its root element. Try reloading.'
}
