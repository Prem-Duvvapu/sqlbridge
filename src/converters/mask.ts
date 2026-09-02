/**
 * Hide string literals and comments before the ordered rewrite passes run, so a keyword
 * or function name that happens to appear inside one — user data, a note to a colleague —
 * isn't mistaken for real SQL and rewritten. See RCA-006 (string literals) and RCA-007
 * (comments — the same bug, found while fixing the first).
 *
 * Each masked span becomes an opaque placeholder built around a NUL character, which
 * never appears in real SQL and isn't a word character, so every word-boundary-bound
 * rewrite pattern in either converter treats a placeholder exactly as if the span were
 * absent. `restore()` puts the original text back verbatim, `''` escapes and all.
 *
 * Two passes are the deliberate exception and must run on the *unmasked* text before
 * this: Oracle's TO_CHAR/TO_DATE format-mask translation (it rewrites the format
 * string's own content token by token) and the `||`-chain-to-CONCAT rewrite (it needs
 * to see a real quote to recognise a literal segment of the chain).
 *
 * Built with String.fromCharCode rather than a literal escape in source, so the
 * placeholder never appears as a literal control byte in this file — see RCA-004 and
 * RCA-007, both about control bytes landing in source by accident.
 */

export interface Masked {
  masked: string
  restore(s: string): string
}

const NUL = String.fromCharCode(0)
const PLACEHOLDER_RE = new RegExp(`${NUL}(\\d+)${NUL}`, 'g')

function placeholder(index: number): string {
  return `${NUL}${index}${NUL}`
}

export function maskLiteralsAndComments(sql: string): Masked {
  const spans: string[] = []
  let out = ''
  let i = 0

  const mask = (end: number) => {
    spans.push(sql.slice(i, end))
    out += placeholder(spans.length - 1)
    i = end
  }

  while (i < sql.length) {
    const ch = sql[i]

    if (ch === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue } // '' escape — stays inside the literal
          j++ // consume the closing quote
          break
        }
        j++
      }
      mask(j) // unterminated at EOF: swallow the rest, same fallback split.ts takes
      continue
    }

    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i)
      mask(nl === -1 ? sql.length : nl) // leave the \n itself unmasked
      continue
    }

    if (ch === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2)
      mask(close === -1 ? sql.length : close + 2)
      continue
    }

    out += ch
    i++
  }

  return {
    masked: out,
    restore: s => s.replace(PLACEHOLDER_RE, (whole, index) => spans[Number(index)] ?? whole),
  }
}
