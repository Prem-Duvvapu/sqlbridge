/**
 * A small SQL tokenizer for display only.
 *
 * Deliberately lexical, not a parser: it recognises strings, comments, numbers, words and
 * punctuation, then classifies words by lookup and by what precedes them. That is enough
 * to colour a query and cheap enough to run on every keystroke, but it will mislabel
 * genuinely ambiguous SQL — a column literally named `order`, say. Colour is a reading
 * aid here, never something the converter depends on.
 */

export type TokenKind =
  | 'keyword'
  | 'clause'
  | 'table'
  | 'function'
  | 'string'
  | 'number'
  | 'comment'
  | 'operator'
  | 'plain'

export interface Token {
  text: string
  kind: TokenKind
}

/** Structural keywords — the skeleton of the statement. */
const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET',
  'FETCH', 'FIRST', 'NEXT', 'ROWS', 'ONLY', 'INSERT', 'INTO', 'VALUES', 'UPDATE',
  'SET', 'DELETE', 'CREATE', 'TABLE', 'ALTER', 'DROP', 'INDEX', 'VIEW', 'AS',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'ON', 'USING',
  'UNION', 'ALL', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH',
  'PARTITION', 'OVER', 'ASC', 'DESC', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
  'CONSTRAINT', 'DEFAULT', 'START', 'CONNECT', 'PRIOR', 'MERGE', 'DUAL', 'SEPARATOR',
  'INTERVAL', 'WITHIN', 'GROUP_CONCAT',
])

/** Logical connectors — these steer the result set, so they read separately. */
const CLAUSES = new Set([
  'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS', 'NULL', 'ANY', 'SOME',
])

/** A name directly after one of these is the thing the query reads or writes. */
const TABLE_LEAD = new Set(['FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE'])

const SCANNER = new RegExp(
  [
    '(--[^\\n]*|/\\*[\\s\\S]*?\\*/)',       // 1 comment
    "('(?:[^']|'')*'?)",                    // 2 string
    '(`[^`]*`|"[^"]*")',                    // 3 quoted identifier
    '(\\b\\d+(?:\\.\\d+)?\\b)',             // 4 number
    '([A-Za-z_][A-Za-z0-9_$]*)',            // 5 word
    '(\\s+)',                               // 6 whitespace
    '([^\\sA-Za-z0-9_]+)',                  // 7 operator / punctuation
  ].join('|'),
  'g',
)

/** Split SQL into display tokens. Concatenating every `text` reproduces the input exactly. */
export function tokenize(sql: string): Token[] {
  const tokens: Token[] = []
  let lastEnd = 0

  for (const m of sql.matchAll(SCANNER)) {
    // Anything the scanner skipped is preserved verbatim so no character is ever lost.
    if (m.index > lastEnd) tokens.push({ text: sql.slice(lastEnd, m.index), kind: 'plain' })
    lastEnd = m.index + m[0].length

    const [, comment, string, quoted, number, word, space, operator] = m
    if (comment !== undefined) tokens.push({ text: comment, kind: 'comment' })
    else if (string !== undefined) tokens.push({ text: string, kind: 'string' })
    else if (quoted !== undefined) tokens.push({ text: quoted, kind: 'table' })
    else if (number !== undefined) tokens.push({ text: number, kind: 'number' })
    else if (word !== undefined) tokens.push({ text: word, kind: classifyWord(word, tokens, sql, lastEnd) })
    else if (space !== undefined) tokens.push({ text: space, kind: 'plain' })
    else if (operator !== undefined) tokens.push({ text: operator, kind: 'operator' })
  }

  if (lastEnd < sql.length) tokens.push({ text: sql.slice(lastEnd), kind: 'plain' })
  return tokens
}

function classifyWord(word: string, sofar: Token[], sql: string, end: number): TokenKind {
  const upper = word.toUpperCase()

  // A name followed by `(` is being called, whatever else it might look like.
  if (/^\s*\(/.test(sql.slice(end))) {
    return KEYWORDS.has(upper) || CLAUSES.has(upper) ? 'keyword' : 'function'
  }
  if (CLAUSES.has(upper)) return 'clause'
  if (KEYWORDS.has(upper)) return 'keyword'
  if (TABLE_LEAD.has(previousWord(sofar))) return 'table'
  return 'plain'
}

function previousWord(tokens: Token[]): string {
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].text.trim() === '') continue
    return tokens[i].text.toUpperCase()
  }
  return ''
}
