import { convert, getTargetsFor } from './converters'
import { diffSql, type SqlDiff } from './diff'

/**
 * Round-trip check: translate A→B, then B→A, and compare the return against the original.
 *
 * This is a **signal, not a verdict**. Plenty of correct translations don't round-trip —
 * `SYSDATE → NOW() → SYSTIMESTAMP`, format-model rewrites, `LENGTH`/`CHAR_LENGTH`. Those
 * paths are tagged `roundTripLossy` in the rule catalogue and listed separately, so a
 * difference that *isn't* on that list is the one worth looking at.
 *
 * The comparison normalises whitespace and keyword case only — it does not try to
 * understand the SQL.
 */

export interface RoundTripResult {
  available: boolean
  /** Why the check can't run (no reverse converter), when `available` is false. */
  unavailableReason?: string
  /** The SQL that came back after A→B→A. */
  returned: string
  /** Diff of the normalised original against the normalised return. */
  diff: SqlDiff
  /** True when the normalised forms match exactly. */
  matches: boolean
  /** Rules on the forward pass that are expected to prevent a clean round-trip. */
  lossyRules: { title: string; detail: string }[]
}

const KEYWORDS = /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|ORDER|BY|HAVING|LIMIT|OFFSET|FETCH|FIRST|NEXT|ROWS|ONLY|AS|AND|OR|NOT|IN|IS|NULL|LIKE|UNION|ALL|DISTINCT|CASE|WHEN|THEN|ELSE|END|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|DUAL)\b/gi

/** Whitespace to single spaces, keywords upper-cased, trailing terminators dropped. */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/[;\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(KEYWORDS, kw => kw.toUpperCase())
    .trim()
}

export function roundTrip(sql: string, source: string, target: string): RoundTripResult {
  const canReverse = getTargetsFor(target).some(d => d.name === source)
  if (!canReverse) {
    return {
      available: false,
      unavailableReason: `There's no ${target} → ${source} converter to translate back with.`,
      returned: '',
      diff: diffSql('', ''),
      matches: true,
      lossyRules: [],
    }
  }

  const forward = convert(sql, source, target)
  const back = convert(forward.output, target, source)

  const original = normalizeSql(sql)
  const returned = normalizeSql(back.output)

  return {
    available: true,
    returned: back.output,
    diff: diffSql(original, returned),
    matches: original === returned,
    lossyRules: forward.notes
      .filter(n => n.rule.roundTripLossy)
      .map(n => ({ title: n.rule.title, detail: n.rule.detail }))
      // de-dupe by title
      .filter((r, i, all) => all.findIndex(x => x.title === r.title) === i),
  }
}
