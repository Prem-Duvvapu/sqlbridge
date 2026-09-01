import type { Converter, StatementConversion } from './types'
import { applyTypeMap } from './types'

/**
 * Constructs we won't translate to Oracle — procedural code needs a manual rewrite, not
 * a function-name swap that leaves the scaffolding MySQL-shaped.
 */
const UNCERTAIN_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bCREATE(?:\s+(?:DEFINER\s*=\s*\S+))?\s+(?:PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/i, 'MySQL stored program'],
  [/^\s*DELIMITER\b/i, 'DELIMITER directive'],
]

const TYPE_MAP: ReadonlyArray<readonly [string, string]> = [
  ['LONGTEXT', 'CLOB'],
  ['MEDIUMTEXT', 'CLOB'],
  ['TINYTEXT', 'VARCHAR2(255)'],
  ['LONGBLOB', 'BLOB'],
  ['MEDIUMBLOB', 'BLOB'],
  ['TINYBLOB', 'RAW(255)'],
  ['BINARY', 'RAW'],
  ['VARBINARY', 'RAW'],
  ['INT', 'NUMBER(10)'],
  ['INTEGER', 'NUMBER(10)'],
  ['BIGINT', 'NUMBER(19)'],
  ['SMALLINT', 'NUMBER(5)'],
  ['TINYINT', 'NUMBER(3)'],
  ['MEDIUMINT', 'NUMBER(7)'],
  ['DECIMAL', 'NUMBER'],
  ['NUMERIC', 'NUMBER'],
  ['FLOAT', 'BINARY_DOUBLE'],
  ['DOUBLE', 'BINARY_DOUBLE'],
  ['REAL', 'BINARY_DOUBLE'],
  ['DATETIME', 'TIMESTAMP'],
  ['BOOLEAN', 'CHAR(1)'],
  ['YEAR', 'NUMBER(4)'],
  ['VARCHAR', 'VARCHAR2'],
]

function replaceIfFunction(sql: string, warnings: string[]): string {
  return sql.replace(/\bIF\s*\(([^)]+)\)/gi, (match, inner: string) => {
    const args = inner.split(',')
    if (args.length !== 3) return match
    warnings.push('Converted IF() to CASE WHEN')
    return `CASE WHEN ${args[0].trim()} THEN ${args[1].trim()} ELSE ${args[2].trim()} END`
  })
}

function replaceConcatWithPipe(sql: string, warnings: string[]): string {
  return sql.replace(/\bCONCAT\s*\(([^)]+)\)/gi, (_m, inner: string) => {
    warnings.push('Converted CONCAT() to ||')
    return inner.split(',').map(a => a.trim()).join(' || ')
  })
}

/** MySQL's multi-row VALUES has no Oracle equivalent — expand into INSERT ALL. */
function replaceMultiRowInsert(sql: string, warnings: string[]): string {
  const re = /INSERT\s+INTO\s+(\w+(?:\.\w+)?)\s*((?:\([^)]+\))?)\s*VALUES\s*((?:\([^)]+\)\s*,?\s*)+)/gi
  return sql.replace(re, (match, table: string, cols: string, valsBlock: string) => {
    const rows = [...valsBlock.matchAll(/\(([^)]+)\)/g)].map(m => m[1])
    if (rows.length <= 1) return match
    warnings.push('Converted multi-row INSERT to INSERT ALL')
    const body = rows.map(r => `  INTO ${table} ${cols} VALUES (${r})\n`).join('')
    return `INSERT ALL\n${body}SELECT * FROM DUAL`
  })
}

/** Oracle requires a FROM clause; MySQL doesn't. Add DUAL when the query has none. */
function addDualIfNeeded(sql: string): string {
  if (!sql.replace(/^\s+/, '').toUpperCase().startsWith('SELECT')) return sql
  const noParens = sql.replace(/\([^()]*\)/g, '')
  const selIdx = noParens.toUpperCase().lastIndexOf('SELECT')
  if (selIdx < 0) return sql
  const rest = noParens.slice(selIdx + 6).toUpperCase()
  return rest.includes('FROM') ? sql : `${sql} FROM DUAL`
}

export const mysqlToOracle: Converter = {
  source: 'mysql',
  target: 'oracle',

  convert(sql: string): StatementConversion {
    const warnings: string[] = []

    for (const [pattern, reason] of UNCERTAIN_PATTERNS) {
      if (pattern.test(sql)) {
        warnings.push(`${reason} detected — automatic conversion may be incorrect`)
        return { output: sql, warnings, blocked: { reason } }
      }
    }

    // Drop every trailing statement terminator and surrounding whitespace — one `;`, a
    // stray `;;`, or `; ` all reduce to the same clean statement. A leftover terminator
    // gets stranded mid-query once the LIMIT pass rewrites the clause in front of it.
    let s = sql.replace(/[;\s]+$/, '')

    // Identifier quoting: `ident` -> "ident"
    s = s.replace(/`([^`]+)`/g, '"$1"')

    // ── pagination ──
    const limit = /LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?/i.exec(s)
    if (limit) {
      const replacement = limit[2] !== undefined
        ? `OFFSET ${limit[2]} ROWS FETCH NEXT ${limit[1]} ROWS ONLY`
        : `FETCH FIRST ${limit[1]} ROWS ONLY`
      s = `${s.replace(limit[0], '').trim()}\n${replacement}\n`
      warnings.push('Converted LIMIT to OFFSET FETCH')
    }

    // ── functions ──
    s = s.replace(/\bIFNULL\s*\(/gi, 'NVL(')
    s = replaceIfFunction(s, warnings)
    s = s.replace(/(?<![.:])NOW\s*\(\s*\d*\s*\)/gi, 'SYSTIMESTAMP')
    s = s.replace(/\bSYSDATE\s*\(\s*\)/gi, 'SYSDATE')
    s = s.replace(/\bCURDATE\s*\(\s*\)/gi, 'TRUNC(SYSDATE)')
    s = s.replace(/\bSTR_TO_DATE\s*\(/gi, 'TO_DATE(')
    s = s.replace(/\bDATE_FORMAT\s*\(/gi, 'TO_CHAR(')
    s = s.replace(/\bGROUP_CONCAT\s*\(/gi, 'LISTAGG(')
    s = s.replace(/\bUUID\s*\(\s*\)/gi, 'SYS_GUID()')
    s = s.replace(/\bCONNECTION_ID\s*\(\s*\)/gi, "SYS_CONTEXT('USERENV', 'SESSIONID')")
    s = s.replace(/\bDATABASE\s*\(\s*\)/gi, "SYS_CONTEXT('USERENV', 'DB_NAME')")
    s = s.replace(/\bCHAR_LENGTH\s*\(/gi, 'LENGTH(')
    s = s.replace(/\bCHARACTER_LENGTH\s*\(/gi, 'LENGTH(')

    s = replaceConcatWithPipe(s, warnings)

    s = s.replace(/\bDATE_ADD\s*\(([^,]+),\s*INTERVAL\s+(\d+)\s+(\w+)\)/gi,
      (_m, date: string, n: string, unit: string) => `${date.trim()} + INTERVAL '${n}' ${unit}`)
    s = s.replace(/\bTRUNCATE\s*\(/gi, 'TRUNC(')
    // Arguments are trimmed: `[^,]+` absorbs the space after the comma.
    s = s.replace(/\bDATEDIFF\s*\(([^,]+),([^)]+)\)/gi,
      (_m, d1: string, d2: string) => `CAST(${d1.trim()} AS DATE) - CAST(${d2.trim()} AS DATE)`)
    s = s.replace(/\bDATE\s*\(([^)]+)\)/gi, 'TRUNC($1)')
    s = s.replace(/\bDAYNAME\s*\(([^)]+)\)/gi, "TO_CHAR($1, 'Day')")

    if (/\bTIMESTAMPDIFF\s*\(/i.test(s)) {
      warnings.push('TIMESTAMPDIFF detected — check conversion (e.g. MONTHS_BETWEEN for MONTH)')
    }

    s = applyTypeMap(s, TYPE_MAP)
    s = replaceMultiRowInsert(s, warnings)
    s = addDualIfNeeded(s)

    // Oracle doesn't require the subquery alias MySQL insists on.
    s = s.replace(/(FROM\s*\(\s*SELECT[^)]+\))\s+t\b/gi, '$1')

    return { output: s.trim(), warnings }
  },
}
