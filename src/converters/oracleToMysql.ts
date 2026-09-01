import type { Converter, StatementConversion } from './types'
import { applyTypeMap } from './types'

/**
 * Constructs we refuse to convert. Matching any of these returns the original SQL with a
 * warning rather than a guess — a wrong translation is worse than no translation.
 */
const UNCERTAIN_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/SELECT\s+.*\bROWNUM\b.*WHERE\s+.*\brnum\b/is, 'Nested ROWNUM pagination pattern'],
  [/\bCONNECT\s+BY\b/i, 'CONNECT BY hierarchical query'],
  [/\w+\.NEXTVAL/i, 'Sequence reference (NEXTVAL)'],
  [/\w+\.CURRVAL/i, 'Sequence reference (CURRVAL)'],
  [/\bMATCH_RECOGNIZE\b/i, 'MATCH_RECOGNIZE pattern matching'],
  [/\bMERGE\s+INTO\b/i, 'MERGE statement'],
  [/\bNEXT_DAY\s*\(/i, 'NEXT_DAY function'],
  [/\bPIVOT\b/i, 'PIVOT clause'],
  [/\bUNPIVOT\b/i, 'UNPIVOT clause'],
  [/\bINSTR\s*\([^)]*,[^)]*,[^)]*,[^)]*\)/i, 'INSTR with 4 arguments'],
  [/\bCREATE(?:\s+OR\s+REPLACE)?\s+(?:PROCEDURE|FUNCTION|TRIGGER|PACKAGE)\b/i, 'PL/SQL stored program'],
  [/^\s*(?:DECLARE|BEGIN)\b/i, 'PL/SQL anonymous block'],
]

const TYPE_MAP: ReadonlyArray<readonly [string, string]> = [
  ['VARCHAR2', 'VARCHAR'],
  ['NVARCHAR2', 'NVARCHAR'],
  ['CLOB', 'LONGTEXT'],
  ['BLOB', 'LONGBLOB'],
  ['NCLOB', 'LONGTEXT'],
  ['RAW', 'VARBINARY'],
  ['LONG RAW', 'LONGBLOB'],
  ['LONG', 'LONGTEXT'],
  ['BFILE', 'VARCHAR(255)'],
  ['ROWID', 'CHAR(10)'],
  ['UROWID', 'VARCHAR'],
  ['FLOAT', 'DOUBLE'],
  ['BINARY_FLOAT', 'FLOAT'],
  ['BINARY_DOUBLE', 'DOUBLE'],
  ['XMLTYPE', 'LONGTEXT'],
  ['NUMBER', 'DECIMAL'],
]

/**
 * Split a function's argument list on top-level commas only — commas nested in
 * parentheses or inside quotes belong to an inner expression.
 */
function splitArgs(args: string): string[] {
  const parts: string[] = []
  let depth = 0
  let inSingle = false
  let inDouble = false
  let cur = ''
  for (const c of args) {
    if (c === "'" && !inDouble) { inSingle = !inSingle; cur += c; continue }
    if (c === '"' && !inSingle) { inDouble = !inDouble; cur += c; continue }
    if (!inSingle && !inDouble) {
      if (c === '(') { depth++; cur += c; continue }
      if (c === ')') { depth--; cur += c; continue }
      if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue }
    }
    cur += c
  }
  parts.push(cur.trim())
  return parts
}

/** Oracle date format mask → MySQL date format mask. */
function translateOracleFmt(fmt: string): string {
  const quoted = fmt.startsWith("'") && fmt.endsWith("'")
  let inner = quoted ? fmt.slice(1, -1) : fmt
  // replaceAll (not replace) to match Java's String.replace, which is global.
  inner = inner
    .replaceAll('YYYY', '%Y').replaceAll('YY', '%y')
    .replaceAll('MM', '%m').replaceAll('MONTH', '%M').replaceAll('MON', '%b')
    .replaceAll('DD', '%d').replaceAll('DAY', '%W').replaceAll('DY', '%a')
    .replaceAll('HH24', '%H').replaceAll('HH12', '%h').replaceAll('HH', '%H')
    .replaceAll('MI', '%i').replaceAll('SS', '%s').replaceAll('FF', '%f')
    .replaceAll('AM', '%p').replaceAll('PM', '%p')
  return quoted ? `'${inner}'` : inner
}

function replaceNvl2(sql: string, warnings: string[]): string {
  return sql.replace(/\bNVL2\s*\(([^)]+)\)/gi, (match, inner: string) => {
    const args = splitArgs(inner)
    if (args.length < 3) return match
    warnings.push('Converted NVL2 to IF')
    return `IF(${args[0]} IS NOT NULL, ${args[1]}, ${args[2]})`
  })
}

function decodeToCase(sql: string, warnings: string[]): string {
  return sql.replace(/\bDECODE\s*\(([^)]+)\)/gi, (match, inner: string) => {
    const args = splitArgs(inner)
    if (args.length === 0) return match
    let out = `CASE ${args[0]}`
    let i = 1
    while (i < args.length - 1) {
      out += ` WHEN ${args[i]} THEN ${args[i + 1]}`
      i += 2
    }
    if (i === args.length - 1) out += ` ELSE ${args[args.length - 1]}`
    out += ' END'
    warnings.push('Converted DECODE to CASE')
    return out
  })
}

function replaceToChar(sql: string, warnings: string[]): string {
  const re = /\bTO_CHAR\s*\(([^,]+),\s*'([^']+)'\s*\)/gi
  // A number format mask can't be safely mapped to DATE_FORMAT — leave the SQL untouched.
  for (const m of sql.matchAll(re)) {
    const fmt = m[2]
    if (/[90GDLC]/.test(fmt) && !/[YMDHMS]/.test(fmt)) return sql
  }
  return sql.replace(re, (_m, expr: string, fmt: string) => {
    warnings.push('Converted TO_CHAR(date) to DATE_FORMAT')
    return `DATE_FORMAT(${expr}, '${translateOracleFmt(fmt)}')`
  })
}

function replaceToDate(sql: string, warnings: string[]): string {
  const re = /\bTO_DATE\s*\(([^,]+),\s*('[^']*')\s*\)/gi
  if (!re.test(sql)) return sql.replace(/\bTO_DATE\s*\(/gi, 'STR_TO_DATE(')
  warnings.push('Converted TO_DATE to STR_TO_DATE')
  return sql.replace(re, (_m, expr: string, fmt: string) =>
    `STR_TO_DATE(${expr}, ${translateOracleFmt(fmt)})`)
}

function replaceConcat(sql: string): string {
  const re = /(?:(?:\w+(?:\.\w+)?|'[^']*')\s*\|\|\s*)+(?:\w+(?:\.\w+)?|'[^']*')/gi
  return sql.replace(re, m => `CONCAT(${m.split(/\s*\|\|\s*/).join(', ')})`)
}

function replaceLengthWithCharLength(sql: string, warnings: string[]): string {
  const out = sql.replace(/(?<![.:])\bLENGTH\s*\(/gi, 'CHAR_LENGTH(')
  if (out !== sql) warnings.push('Converted LENGTH to CHAR_LENGTH')
  return out
}

export const oracleToMysql: Converter = {
  source: 'oracle',
  target: 'mysql',

  convert(sql: string): StatementConversion {
    const warnings: string[] = []

    // Confidence gate — bail out before touching anything we can't translate reliably.
    for (const [pattern, reason] of UNCERTAIN_PATTERNS) {
      if (pattern.test(sql)) {
        warnings.push(`${reason} detected — automatic conversion may be incorrect`)
        return { output: sql, warnings, blocked: { reason } }
      }
    }

    // Drop every trailing statement terminator and surrounding whitespace — one `;`, a
    // stray `;;`, or `; ` all reduce to the same clean statement. A leftover terminator
    // gets stranded mid-query once a later pass rewrites the clause in front of it.
    let s = sql.replace(/[;\s]+$/, '')

    s = s.replace(/\bFROM\s+DUAL\b/gi, '').trim()

    // Identifier quoting: "ident" -> `ident`
    s = s.replace(/"([^"]+)"/g, '`$1`')

    // ── pagination ──
    if (/WHERE\s+ROWNUM\s*=\s*1/i.test(s) && !s.toUpperCase().includes('LIMIT')) {
      s = s.replace(/WHERE\s+ROWNUM\s*=\s*1/gi, '')
      s = `${s.trim()} LIMIT 1`
      warnings.push('Converted ROWNUM = 1 to LIMIT 1')
    }

    // ROWNUM <= n preceded by another condition — keep the condition, drop the ROWNUM.
    const withCond = /WHERE\s+(.+?)\s+AND\s+ROWNUM\s*<=\s*(\d+)/is.exec(s)
    if (withCond && !s.toUpperCase().includes('LIMIT')) {
      const cond = withCond[1].trim()
      const keep = cond.toLowerCase() === '1=1' || cond === '' ? '' : `WHERE ${cond}`
      s = s.replace(withCond[0], keep)
      s = `${s.trim()} LIMIT ${withCond[2]}`
      warnings.push('Converted ROWNUM <= n to LIMIT')
    }

    const standalone = /WHERE\s+ROWNUM\s*<=\s*(\d+)/i.exec(s)
    if (standalone && !s.toUpperCase().includes('LIMIT')) {
      s = s.replace(standalone[0], '')
      s = `${s.trim()} LIMIT ${standalone[1]}`
      warnings.push('Converted ROWNUM <= n to LIMIT')
    }

    // OFFSET…FETCH must be matched before the standalone FETCH pass, which would
    // otherwise consume the FETCH half and strand a dangling `OFFSET n ROWS`.
    const offsetFetch = /OFFSET\s+(\d+)\s+ROWS\s+FETCH\s+(?:FIRST|NEXT)\s+(\d+)\s+ROWS\s+ONLY/i.exec(s)
    if (offsetFetch) {
      s = `${s.replace(offsetFetch[0], '').trim()} LIMIT ${offsetFetch[2]} OFFSET ${offsetFetch[1]}`
      warnings.push('Converted OFFSET FETCH to LIMIT OFFSET')
    } else {
      const fetch = /FETCH\s+(?:FIRST|NEXT)\s+(\d+)\s+ROWS\s+ONLY/i.exec(s)
      if (fetch) {
        s = `${s.replace(fetch[0], '').trim()} LIMIT ${fetch[1]}`
        warnings.push('Converted FETCH FIRST to LIMIT')
      }
    }

    // ── functions ──
    s = s.replace(/\bNVL\s*\(/gi, 'IFNULL(')
    s = replaceNvl2(s, warnings)
    s = decodeToCase(s, warnings)

    s = s.replace(
      /\bLISTAGG\s*\(([^,]+)\s*,\s*([^)]+)\)\s*WITHIN\s+GROUP\s*\([^)]+\)/gi,
      'GROUP_CONCAT($1 SEPARATOR $2)',
    )
    if (s.includes('GROUP_CONCAT')) warnings.push('Converted LISTAGG to GROUP_CONCAT')

    // ── date/time ── TRUNC must run before SYSDATE, or its argument is already rewritten.
    s = s.replace(/\bTRUNC\s*\((SYSDATE|SYSTIMESTAMP|CURRENT_DATE|CURRENT_TIMESTAMP)\)/gi, 'DATE($1)')
    s = s.replace(/\bTRUNC\s*\((\w+(?:\.\w+)?)\)/gi, 'CAST($1 AS DATE)')

    s = s.replace(/\bSYSDATE\b/gi, 'NOW()')
    s = s.replace(/\bSYSTIMESTAMP\b/gi, 'NOW(6)')
    s = s.replace(/\bCURRENT_DATE\b(?!\s*\()/gi, 'CURDATE()')

    s = replaceToChar(s, warnings)
    s = replaceToDate(s, warnings)
    s = s.replace(/\bTO_TIMESTAMP\s*\(/gi, 'STR_TO_DATE(')

    // Captured arguments are trimmed — the char classes below happily absorb the space
    // after the comma, which would otherwise show up doubled in the output.
    s = s.replace(/\bADD_MONTHS\s*\(([^,]+),([^)]+)\)/gi,
      (_m, date: string, n: string) => `DATE_ADD(${date.trim()}, INTERVAL ${n.trim()} MONTH)`)
    s = s.replace(/\bMONTHS_BETWEEN\s*\(([^,]+),([^)]+)\)/gi,
      (_m, d1: string, d2: string) => `TIMESTAMPDIFF(MONTH, ${d2.trim()}, ${d1.trim()})`)

    if (/\bLAST_DAY\s*\(/i.test(s)) {
      warnings.push('LAST_DAY — MySQL 8.0+ has LAST_DAY(), check compatibility')
    }

    s = s.replace(/\bSYS_GUID\s*\(\s*\)/gi, 'UUID()')
    s = replaceLengthWithCharLength(s, warnings)
    s = replaceConcat(s)

    // ── joins: Oracle (+) outer join syntax -> LEFT JOIN ──
    s = s.replace(
      /,\s*(\w+)\s+(\w+)\s+WHERE\s+\2\.\w+\s*\(\+\)\s*=\s*(\w+\.\w+)/gi,
      'LEFT JOIN $1 $2 ON $2.$3 = $3',
    )

    // ── subquery alias: optional in Oracle, required in MySQL ──
    if (/FROM\s*\(\s*SELECT\b/is.test(s) && !/^(?:.*FROM\s*\(\s*SELECT.*\)\s+\w+.*)$/i.test(s)) {
      s = s.replace(/(FROM\s*\(\s*SELECT[^)]+\))(?!\s+\w)/gi, '$1 t')
      warnings.push('Added alias for subquery in FROM clause')
    }

    // MySQL has no NULLS FIRST/LAST.
    s = s.replace(/\bNULLS\s+(?:FIRST|LAST)\b/gi, '').trim()

    s = applyTypeMap(s, TYPE_MAP)

    return { output: s.trim(), warnings }
  },
}
