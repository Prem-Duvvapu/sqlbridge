import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Ports live in the 50000s — well clear of the defaults every other local dev server
// reaches for (3000, 5173, 8080), so day to day nothing collides.
//
// Override per machine without editing this file:
//   SQLBRIDGE_PORT=12345 npm run dev            (env var)
//   echo "SQLBRIDGE_PORT=12345" >> .env.local    (dotfile, git-ignored)
//
// strictPort is intentionally left off: if the chosen port is somehow taken, Vite steps
// to the next free one and prints the real URL rather than refusing to start.
const DEFAULT_DEV_PORT = 50173
const DEFAULT_PREVIEW_PORT = 50174

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const devPort = Number(env.SQLBRIDGE_PORT) || DEFAULT_DEV_PORT
  const previewPort = Number(env.SQLBRIDGE_PREVIEW_PORT) || devPort + 1 || DEFAULT_PREVIEW_PORT

  // No proxy and no backend: conversion runs in the browser, so this builds to static files.
  return {
    plugins: [react()],
    server: { port: devPort },
    preview: { port: previewPort },
  }
})
