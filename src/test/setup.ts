import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

// With `globals: true`, @testing-library/react registers its own afterEach cleanup, so
// nothing extra is needed here for unmounting. This file just loads the jest-dom
// matchers and clears per-test storage for the DOM suites.
afterEach(() => {
  try {
    window.localStorage.clear()
    window.sessionStorage.clear()
  } catch {
    /* Node-env suite — no DOM */
  }
})
