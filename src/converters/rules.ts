/**
 * The rule catalogue.
 *
 * Every rewrite and every flag a converter can raise has an entry here: a stable id, a
 * short title, and one or two sentences on *why* the translation is what it is. The
 * converters still push their plain warning strings; `noteFor` maps those strings (and a
 * blocked reason) back to a `Rule` so the UI can show the "why", group by severity, and
 * mark the lossy ones for the round-trip check.
 */

export type RuleSeverity = 'info' | 'caution' | 'blocked'

export interface Rule {
  id: string
  title: string
  detail: string
  severity: RuleSeverity
  /** The round-trip check expects A→B→A to differ here — flags it as known, not a bug. */
  roundTripLossy?: boolean
}

const define = <T extends Record<string, Rule>>(rules: T): T => rules

export const RULES = define({
  // ── pagination ──
  rownumToLimit: {
    id: 'rownum-to-limit',
    title: 'ROWNUM → LIMIT',
    detail: "Oracle caps rows with the ROWNUM pseudo-column in the WHERE clause; MySQL uses a trailing LIMIT. The row cap is preserved, but any ROWNUM used elsewhere in the query needs a manual look.",
    severity: 'info',
  },
  fetchToLimit: {
    id: 'fetch-to-limit',
    title: 'FETCH FIRST → LIMIT',
    detail: 'The SQL-standard FETCH FIRST n ROWS ONLY becomes MySQL’s LIMIT n.',
    severity: 'info',
  },
  offsetFetchToLimit: {
    id: 'offset-fetch-to-limit',
    title: 'OFFSET / FETCH → LIMIT / OFFSET',
    detail: 'OFFSET m ROWS FETCH NEXT n ROWS ONLY becomes LIMIT n OFFSET m.',
    severity: 'info',
  },
  limitToOffsetFetch: {
    id: 'limit-to-offset-fetch',
    title: 'LIMIT → OFFSET / FETCH',
    detail: 'MySQL’s LIMIT [n OFFSET m] becomes the SQL-standard OFFSET m ROWS FETCH NEXT n ROWS ONLY that Oracle 12c+ supports.',
    severity: 'info',
  },

  // ── null handling ──
  nvlToIfnull: {
    id: 'nvl-to-ifnull',
    title: 'NVL → IFNULL',
    detail: 'Oracle’s two-argument null-coalesce. IFNULL is the exact MySQL equivalent.',
    severity: 'info',
  },
  nvl2ToIf: {
    id: 'nvl2-to-if',
    title: 'NVL2 → IF',
    detail: 'NVL2(a, b, c) returns b when a is not null, else c. Rewritten as IF(a IS NOT NULL, b, c).',
    severity: 'info',
  },
  decodeToCase: {
    id: 'decode-to-case',
    title: 'DECODE → CASE',
    detail: 'DECODE is an Oracle-only shorthand. The equivalent searched CASE expression is portable. DECODE treats two NULLs as equal; CASE does not — check comparisons against NULL.',
    severity: 'caution',
  },
  ifToCase: {
    id: 'if-to-case',
    title: 'IF() → CASE',
    detail: 'MySQL’s IF(cond, a, b) function has no Oracle equivalent; a CASE WHEN expression does the same job.',
    severity: 'info',
  },

  // ── strings ──
  listaggToGroupConcat: {
    id: 'listagg-to-group-concat',
    title: 'LISTAGG → GROUP_CONCAT',
    detail: 'Both aggregate a column into a delimited string. GROUP_CONCAT has a default length cap (group_concat_max_len) that LISTAGG does not — long results may be truncated.',
    severity: 'caution',
  },
  groupConcatToListagg: {
    id: 'group-concat-to-listagg',
    title: 'GROUP_CONCAT → LISTAGG',
    detail: 'GROUP_CONCAT’s ORDER BY / SEPARATOR options map onto LISTAGG(...) WITHIN GROUP (ORDER BY ...).',
    severity: 'caution',
  },
  concatPipeToConcat: {
    id: 'concat-pipe-to-concat',
    title: '|| → CONCAT()',
    detail: 'Oracle concatenates with ||; MySQL’s || is a logical OR by default, so CONCAT() is used instead.',
    severity: 'info',
  },
  concatToConcatPipe: {
    id: 'concat-to-concat-pipe',
    title: 'CONCAT() → ||',
    detail: 'Oracle’s CONCAT takes exactly two arguments, so a multi-argument CONCAT is rewritten as a chain of ||.',
    severity: 'info',
  },
  lengthToCharLength: {
    id: 'length-to-char-length',
    title: 'LENGTH → CHAR_LENGTH',
    detail: 'Oracle LENGTH counts characters. MySQL LENGTH counts bytes, so CHAR_LENGTH is used to keep the same result for multi-byte text.',
    severity: 'caution',
    roundTripLossy: true,
  },

  // ── date / time ──
  sysdateToNow: {
    id: 'sysdate-to-now',
    title: 'SYSDATE → NOW()',
    detail: 'Oracle SYSDATE is a DATE (second precision); NOW() is the closest MySQL value. Converting back yields SYSTIMESTAMP, which carries fractional seconds — hence a round-trip difference.',
    severity: 'info',
    roundTripLossy: true,
  },
  sysdateArithmeticToInterval: {
    id: 'sysdate-arithmetic-to-interval',
    title: 'SYSDATE ± n → NOW() ± INTERVAL n DAY',
    detail: 'Oracle treats DATE ± n as n days. MySQL treats it as plain number subtraction on the underlying value — without INTERVAL, the predicate silently stops meaning what it looks like it means.',
    severity: 'caution',
    roundTripLossy: true,
  },
  toCharToDateFormat: {
    id: 'to-char-to-date-format',
    title: 'TO_CHAR(date) → DATE_FORMAT',
    detail: 'The format model is translated token by token (YYYY→%Y, MM→%m, …). Uncommon Oracle format elements have no MySQL equivalent and are left as-is.',
    severity: 'caution',
    roundTripLossy: true,
  },
  toDateToStrToDate: {
    id: 'to-date-to-str-to-date',
    title: 'TO_DATE → STR_TO_DATE',
    detail: 'Parses a string to a datetime. The Oracle format model is translated to MySQL format specifiers.',
    severity: 'caution',
    roundTripLossy: true,
  },
  dateFormatToToChar: {
    id: 'date-format-to-to-char',
    title: 'DATE_FORMAT → TO_CHAR',
    detail: 'The function name is swapped; the format string is passed through unchanged and may need manual translation of the specifiers.',
    severity: 'caution',
    roundTripLossy: true,
  },
  lastDayCompat: {
    id: 'last-day-compat',
    title: 'LAST_DAY',
    detail: 'MySQL 8.0+ has LAST_DAY() with the same meaning. Older MySQL does not — check the target version.',
    severity: 'caution',
  },
  timestampdiffCheck: {
    id: 'timestampdiff-check',
    title: 'TIMESTAMPDIFF',
    detail: 'Argument order and unit names differ between the dialects. For whole months, Oracle’s MONTHS_BETWEEN is usually the intended equivalent — verify.',
    severity: 'caution',
  },

  // ── structure ──
  subqueryAlias: {
    id: 'subquery-alias',
    title: 'Subquery alias added',
    detail: 'MySQL requires every derived table in a FROM clause to be aliased; Oracle does not. A placeholder alias was added.',
    severity: 'info',
  },
  multiRowInsert: {
    id: 'multi-row-insert',
    title: 'Multi-row INSERT → INSERT ALL',
    detail: 'MySQL’s INSERT ... VALUES (...), (...) has no direct Oracle form. INSERT ALL ... SELECT * FROM DUAL is equivalent but is not atomic in the same way — review for triggers and sequences.',
    severity: 'caution',
  },

  // ── refusals (confidence gate) ──
  connectBy: { id: 'connect-by', title: 'CONNECT BY', detail: 'Oracle hierarchical queries have no MySQL equivalent before 8.0 and a very different one after (recursive CTE). Rewrite by hand.', severity: 'blocked' },
  sequenceNextval: { id: 'sequence-nextval', title: 'seq.NEXTVAL', detail: 'Sequences map to AUTO_INCREMENT columns or a MySQL 8.0 sequence emulation — the right choice depends on the schema.', severity: 'blocked' },
  sequenceCurrval: { id: 'sequence-currval', title: 'seq.CURRVAL', detail: 'MySQL exposes the last inserted id via LAST_INSERT_ID(), which is per-connection and not a direct CURRVAL equivalent.', severity: 'blocked' },
  mergeStatement: { id: 'merge-statement', title: 'MERGE', detail: 'MySQL’s closest form is INSERT ... ON DUPLICATE KEY UPDATE, which only matches on a unique key — not a general MERGE.', severity: 'blocked' },
  pivotClause: { id: 'pivot-clause', title: 'PIVOT', detail: 'MySQL has no PIVOT/UNPIVOT; the columns must be enumerated with conditional aggregation.', severity: 'blocked' },
  matchRecognize: { id: 'match-recognize', title: 'MATCH_RECOGNIZE', detail: 'Row-pattern matching is Oracle-only.', severity: 'blocked' },
  nextDay: { id: 'next-day', title: 'NEXT_DAY', detail: 'NEXT_DAY(date, weekday) needs a manual expression in MySQL, and the weekday argument is locale-sensitive.', severity: 'blocked' },
  instr4Arg: { id: 'instr-4-arg', title: 'INSTR (4 args)', detail: 'MySQL’s INSTR/LOCATE take at most three arguments — the occurrence count has no direct form.', severity: 'blocked' },
  nestedRownum: { id: 'nested-rownum', title: 'Nested ROWNUM pagination', detail: 'The classic Oracle outer/inner ROWNUM paging idiom needs a single LIMIT ... OFFSET, but picking the offset safely requires reading the whole query.', severity: 'blocked' },
  plsqlProgram: { id: 'plsql-program', title: 'PL/SQL stored program', detail: 'Stored procedures, functions, triggers and packages need a manual rewrite — the declaration section, exception blocks and cursor syntax all differ.', severity: 'blocked' },
  plsqlBlock: { id: 'plsql-block', title: 'PL/SQL anonymous block', detail: 'DECLARE / BEGIN ... END blocks are procedural code, not a single statement to translate.', severity: 'blocked' },
  mysqlStoredProgram: { id: 'mysql-stored-program', title: 'MySQL stored program', detail: 'CREATE PROCEDURE / FUNCTION / TRIGGER bodies need a manual rewrite to PL/SQL.', severity: 'blocked' },
  delimiterDirective: { id: 'delimiter-directive', title: 'DELIMITER directive', detail: 'The client-side DELIMITER command has no Oracle equivalent — Oracle uses a lone / to end a block.', severity: 'blocked' },
})

export type RuleKey = keyof typeof RULES

/** Warning strings the converters push, mapped to their rule. */
const MESSAGE_TO_RULE: ReadonlyArray<readonly [string, Rule]> = [
  ['Converted ROWNUM', RULES.rownumToLimit],
  ['Converted FETCH FIRST', RULES.fetchToLimit],
  ['Converted OFFSET FETCH', RULES.offsetFetchToLimit],
  ['Converted LIMIT to OFFSET FETCH', RULES.limitToOffsetFetch],
  ['Converted NVL2', RULES.nvl2ToIf],
  ['Converted DECODE', RULES.decodeToCase],
  ['Converted IF()', RULES.ifToCase],
  ['Converted LISTAGG', RULES.listaggToGroupConcat],
  ['Converted CONCAT()', RULES.concatToConcatPipe],
  ['Converted LENGTH', RULES.lengthToCharLength],
  ['Converted SYSDATE date arithmetic', RULES.sysdateArithmeticToInterval],
  ['Converted SYSDATE', RULES.sysdateToNow],
  ['Converted TO_CHAR', RULES.toCharToDateFormat],
  ['Converted TO_DATE', RULES.toDateToStrToDate],
  ['Added alias for subquery', RULES.subqueryAlias],
  ['Converted multi-row INSERT', RULES.multiRowInsert],
  ['LAST_DAY', RULES.lastDayCompat],
  ['TIMESTAMPDIFF detected', RULES.timestampdiffCheck],
]

const BLOCKED_REASON_TO_RULE: ReadonlyArray<readonly [string, Rule]> = [
  ['CONNECT BY hierarchical query', RULES.connectBy],
  ['Sequence reference (NEXTVAL)', RULES.sequenceNextval],
  ['Sequence reference (CURRVAL)', RULES.sequenceCurrval],
  ['MERGE statement', RULES.mergeStatement],
  ['PIVOT clause', RULES.pivotClause],
  ['UNPIVOT clause', RULES.pivotClause],
  ['MATCH_RECOGNIZE pattern matching', RULES.matchRecognize],
  ['NEXT_DAY function', RULES.nextDay],
  ['INSTR with 4 arguments', RULES.instr4Arg],
  ['Nested ROWNUM pagination pattern', RULES.nestedRownum],
  ['PL/SQL stored program', RULES.plsqlProgram],
  ['PL/SQL anonymous block', RULES.plsqlBlock],
  ['MySQL stored program', RULES.mysqlStoredProgram],
  ['DELIMITER directive', RULES.delimiterDirective],
]

/** The rule behind a converter warning string, if it maps to one. */
export function ruleForWarning(message: string): Rule | undefined {
  for (const [needle, rule] of MESSAGE_TO_RULE) {
    if (message.startsWith(needle)) return rule
  }
  // Gate warnings read "<reason> detected — automatic conversion may be incorrect".
  const gate = /^(.+?) detected — automatic conversion/.exec(message)
  if (gate) return ruleForBlockedReason(gate[1])
  return undefined
}

/** The rule behind a `blocked.reason`. */
export function ruleForBlockedReason(reason: string): Rule | undefined {
  for (const [needle, rule] of BLOCKED_REASON_TO_RULE) {
    if (reason.startsWith(needle)) return rule
  }
  return undefined
}
