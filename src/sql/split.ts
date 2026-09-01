/**
 * Split a SQL script into statements.
 *
 * Splitting on `;` is only safe if the scanner knows where a `;` *doesn't* end a
 * statement: inside a string, a quoted identifier, a comment, or a PL/SQL block. This is
 * a lexer, not a parser — it tracks just enough state to place the terminators.
 *
 * Guarantees:
 *   - `joinStatements` of an unmodified split reproduces the input character for
 *     character (the round-trip invariant — nothing is dropped).
 *   - if the scan ends in an impossible state (open string, unbalanced block), the whole
 *     input comes back as one statement rather than a bad guess.
 */

export interface Statement {
  /** The statement body, terminator excluded. May have surrounding whitespace. */
  sql: string
  /** Whitespace and full comments that preceded the body. */
  leading: string
  /** The terminator that closed it: `;`, a custom delimiter, `/`, or `''` at EOF. */
  terminator: string
  /** 0-based position in the script. */
  index: number
  /** 1-based line where the body starts, for messages. */
  line: number
}

const BLOCK_OPEN = /^(?:BEGIN|CASE|LOOP|IF)\b/i
// `END`, optionally with the sub-keyword that pairs it (END IF / END LOOP / END CASE),
// consumed together so the trailing keyword isn't mistaken for a fresh block open.
const BLOCK_CLOSE = /^END\b(?:[ \t\r\n]+(?:IF|LOOP|CASE))?/i
const DELIMITER_DIRECTIVE = /^DELIMITER[ \t]+(\S+)[ \t]*(\r?\n|$)/i
const LEADING_TRIVIA = /^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/

function isWordBoundary(prev: string | undefined): boolean {
  return prev === undefined || !/[A-Za-z0-9_$]/.test(prev)
}

function splitRaw(raw: string, terminator: string, index: number): Statement {
  const leading = LEADING_TRIVIA.exec(raw)?.[0] ?? ''
  return {
    leading,
    sql: raw.slice(leading.length, raw.length - terminator.length),
    terminator,
    index,
    line: 1, // filled in by numberLines once every statement is known
  }
}

/** Set each statement's `line` to where its body (past the leading trivia) begins. */
function numberLines(statements: Statement[], script: string): Statement[] {
  let offset = 0
  for (const statement of statements) {
    const bodyStart = offset + statement.leading.length
    let line = 1
    for (let k = 0; k < bodyStart; k++) if (script[k] === '\n') line++
    statement.line = line
    offset = bodyStart + statement.sql.length + statement.terminator.length
  }
  return statements
}

function oneStatement(script: string): Statement[] {
  if (script === '') return []
  const leading = LEADING_TRIVIA.exec(script)?.[0] ?? ''
  return numberLines(
    [{ leading, sql: script.slice(leading.length), terminator: '', index: 0, line: 1 }],
    script,
  )
}

export function splitStatements(script: string): Statement[] {
  const statements: Statement[] = []
  let delimiter = ';'
  let segmentStart = 0
  let blockDepth = 0
  let line = 1

  const push = (endExclusive: number, terminator: string) => {
    const raw = script.slice(segmentStart, endExclusive)
    statements.push(splitRaw(raw, terminator, statements.length))
    segmentStart = endExclusive
  }

  let i = 0
  while (i < script.length) {
    const ch = script[i]
    const atLineStart = i === 0 || script[i - 1] === '\n'

    // ── strings and quoted identifiers — consume without interpreting ──
    if (ch === "'" || ch === '"' || ch === '`') {
      const close = ch
      let j = i + 1
      while (j < script.length) {
        if (script[j] === '\n') line++
        if (script[j] === close) {
          if (close === "'" && script[j + 1] === "'") { j += 2; continue } // '' escape
          break
        }
        j++
      }
      if (j >= script.length) return oneStatement(script) // unterminated
      i = j + 1
      continue
    }

    // ── comments ──
    if (ch === '-' && script[i + 1] === '-') {
      const nl = script.indexOf('\n', i)
      i = nl === -1 ? script.length : nl // leave the \n for the line counter
      continue
    }
    if (ch === '/' && script[i + 1] === '*') {
      const end = script.indexOf('*/', i + 2)
      if (end === -1) return oneStatement(script) // unterminated
      for (let k = i; k < end + 2; k++) if (script[k] === '\n') line++
      i = end + 2
      continue
    }

    // ── DELIMITER directive (MySQL) — only at the start of a statement ──
    if (
      atLineStart && blockDepth === 0 &&
      script.slice(segmentStart, i).trim() === '' &&
      (ch === 'D' || ch === 'd')
    ) {
      const m = DELIMITER_DIRECTIVE.exec(script.slice(i))
      if (m) {
        const directiveEnd = i + m[0].length
        const term = /\r?\n$/.exec(m[0])?.[0] ?? ''
        push(directiveEnd, term)
        delimiter = m[1]
        i = directiveEnd
        continue
      }
    }

    // ── PL/SQL block depth ──
    if (isWordBoundary(script[i - 1])) {
      const openMatch = BLOCK_OPEN.exec(script.slice(i))
      if (openMatch) {
        // `CASE` inside a plain expression also matches — it pairs with its own END, so
        // the depth still balances and the terminator lands in the right place.
        blockDepth++
        i += openMatch[0].length
        continue
      }
      const closeMatch = BLOCK_CLOSE.exec(script.slice(i))
      if (closeMatch) {
        blockDepth = Math.max(0, blockDepth - 1)
        for (const c of closeMatch[0]) if (c === '\n') line++
        i += closeMatch[0].length
        continue
      }
    }

    // ── terminators ──
    if (blockDepth === 0 && script.startsWith(delimiter, i)) {
      push(i + delimiter.length, delimiter)
      i += delimiter.length
      continue
    }
    // Oracle: a lone `/` on its own line ends a block.
    if (blockDepth === 0 && ch === '/' && atLineStart) {
      const rest = script.slice(i + 1)
      const eol = /^[ \t]*(\r?\n|$)/.exec(rest)
      if (eol) {
        push(i + 1, '/')
        i += 1
        continue
      }
    }

    if (ch === '\n') line++
    i++
  }

  if (blockDepth !== 0) return oneStatement(script) // unbalanced block

  if (segmentStart < script.length) {
    statements.push(splitRaw(script.slice(segmentStart), '', statements.length))
  }

  return numberLines(statements, script)
}

export function joinStatements(parts: { statement: Statement; sql: string }[]): string {
  return parts.map(p => p.statement.leading + p.sql + p.statement.terminator).join('')
}
