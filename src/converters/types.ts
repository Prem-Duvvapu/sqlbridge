export interface ConvertResult {
  output: string
  warnings: string[]
  /**
   * Set when the confidence gate refused the input rather than guessing at it.
   * `output` is then the original SQL, untouched, and `reason` names the construct
   * that needs a manual rewrite.
   */
  blocked?: { reason: string }
}

export interface Converter {
  readonly source: string
  readonly target: string
  convert(sql: string): ConvertResult
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
