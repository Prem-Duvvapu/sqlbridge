import type { Rule } from './rules'

/**
 * What a converter produces for one statement.
 *
 * `blocked` is set when the confidence gate refused the statement rather than guessing:
 * `output` is then the original SQL, untouched, and `reason` names the construct that
 * needs a manual rewrite.
 */
export interface StatementConversion {
  output: string
  warnings: string[]
  blocked?: { reason: string }
}

export interface Converter {
  readonly source: string
  readonly target: string
  convert(sql: string): StatementConversion
}

/** One statement's conversion, plus where it sat in the script. */
export interface StatementResult extends StatementConversion {
  /** 0-based position among the script's non-empty statements. */
  index: number
  /** The statement's original SQL. */
  input: string
}

/** A warning tied back to its catalogue rule and the statement it came from. */
export interface ConversionNote {
  rule: Rule
  /** The converter's original warning text — what the notes list shows. */
  message: string
  /** 0-based index into `ConvertResult.statements`. */
  statement: number
}

/**
 * The result of converting a whole script. `output` is the re-joined translation;
 * `statements` is the per-statement breakdown; `warnings` is the flattened, de-duplicated
 * string list for the summary; `notes` is the same information tied to catalogue rules
 * and statement positions (Explain mode / round-trip read this); `blocked` is set only
 * when *every* statement was refused (so the UI shows the single "not translated" panel,
 * as it did before scripts were supported).
 */
export interface ConvertResult {
  output: string
  warnings: string[]
  notes: ConversionNote[]
  blocked?: { reason: string; rule?: Rule }
  statements: StatementResult[]
}

export interface Dialect {
  name: string
  label: string
}

/** Escape a literal string for use inside a RegExp — the JS equivalent of Pattern.quote(). */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Apply an ordered map of type names to their replacements, matching whole words only.
 * Order is significant: earlier keys can be substrings of later ones.
 */
export function applyTypeMap(sql: string, typeMap: ReadonlyArray<readonly [string, string]>): string {
  let s = sql
  for (const [from, to] of typeMap) {
    s = s.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, 'gi'), to)
  }
  return s
}
