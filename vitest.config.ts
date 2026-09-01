import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Split test config from vite.config.ts so the dev-server port logic and the test
// environment don't sit on top of each other.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Pure logic (converters, diff, format, highlight) runs in Node; a DOM suite opts in
    // with `// @vitest-environment jsdom` at the top of the file.
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
})
