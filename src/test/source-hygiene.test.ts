import { describe, expect, it } from 'vitest'

// Raw contents of every source file, pulled in at build time by Vite.
const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * True for control characters that have no business in source: everything below U+0020
 * except tab (9), newline (10) and carriage return (13). A raw one usually means a
 * control character was written literally instead of as a \uXXXX escape, which makes the
 * file read as binary to git and grep. See RCA-004.
 */
function strayControlChar(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) return i
  }
  return -1
}

describe('source hygiene', () => {
  it('has files to check', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10)
  })

  it('contains no NUL or stray control bytes', () => {
    const offenders: string[] = []
    for (const [path, text] of Object.entries(sources)) {
      const at = strayControlChar(text)
      if (at !== -1) {
        offenders.push(`${path} @ ${at} (U+${text.charCodeAt(at).toString(16).padStart(4, '0')})`)
      }
    }
    expect(offenders).toEqual([])
  })
})
