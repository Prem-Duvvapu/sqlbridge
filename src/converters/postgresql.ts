import type { Converter, StatementConversion } from './types'
import { specialSpanEnd } from '../sql/quoted'

type Dialect = 'oracle' | 'mysql' | 'postgresql'

/** Direct, deliberately conservative translations; no lossy intermediate dialect. */
function translate(sql: string, source: Dialect, target: Dialect): StatementConversion {
  const warnings: string[] = []
  const spans: string[] = []
  const nul = String.fromCharCode(0)
  const token = (text: string) => { spans.push(text); return `${nul}${spans.length - 1}${nul}` }
  let s = ''
  let specialLiteral = false
  let quoted = false
  let ambiguousMysqlLiteral = false
  // Protect identifiers as well as data: a column called "NVL" is not a function.
  for (let i = 0; i < sql.length;) {
    const end = specialSpanEnd(sql, i)
    if (end === -1) {
      const reason = 'PostgreSQL compatibility: unterminated literal or comment'
      return { output: sql, warnings: [`${reason} detected — automatic conversion may be incorrect`], blocked: { reason } }
    }
    if (end !== undefined) {
      if (!sql.startsWith('/*', i)) specialLiteral = true
      s += token(sql.slice(i, end)); i = end; continue
    }
    const match = /^(?:--[^\n]*|'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`)/.exec(sql.slice(i))
    if (match) {
      let text = match[0]
      if (source === 'mysql' && (text[0] === '"' || (text[0] === "'" && text.includes('\\')))) ambiguousMysqlLiteral = true
      if (text[0] === '`' && source === 'mysql') {
        text = '"' + text.slice(1, -1).replaceAll('``', '`').replaceAll('"', '""') + '"'
        quoted = true
      } else if (text[0] === '"' && target === 'mysql') {
        text = '`' + text.slice(1, -1).replaceAll('""', '"').replaceAll('`', '``') + '`'
        quoted = true
      }
      s += token(text); i += match[0].length
    } else { s += sql[i]; i++ }
  }
  const blocked = (detail: string): StatementConversion => {
    const reason = `PostgreSQL compatibility: ${detail}`
    return { output: sql, warnings: [`${reason} detected — automatic conversion may be incorrect`], blocked: { reason } }
  }
  if (ambiguousMysqlLiteral) return blocked('MySQL string quoting depends on SQL mode')
  if (source === 'oracle' && /\b(?:SYSDATE|SYSTIMESTAMP)\s*[+-]\s*\d/i.test(s)) return blocked('Oracle numeric date arithmetic')
  if (specialLiteral) return blocked('dollar-quoted or escape string literal needs a manual rewrite')
  if (/\b(?:PROCEDURE|FUNCTION|TRIGGER|PACKAGE|DECLARE|DO)\b|^\s*BEGIN\b/i.test(s)) return blocked('stored program')
  if (/\b(?:CONNECT\s+BY|PIVOT|UNPIVOT|MATCH_RECOGNIZE|MERGE)\b|\(\+\)/i.test(s)) return blocked('vendor-specific statement or join')
  const unsupported = source === 'oracle'
    ? /\b(?:NVL2|DECODE|LISTAGG|ADD_MONTHS|MONTHS_BETWEEN|TRUNC|SYS_GUID|NEXT_DAY|ROWNUM|NEXTVAL|CURRVAL)\b/i
    : source === 'mysql'
      ? /\b(?:IF|GROUP_CONCAT|DATE_FORMAT|STR_TO_DATE|DATE_ADD|DATE_SUB|DATEDIFF|TIMESTAMPDIFF|UUID|UNSIGNED|AUTO_INCREMENT|ENGINE|ENUM|SET)\b|\bON\s+DUPLICATE\b|\bINSERT\s+IGNORE\b|<=>/i
      : /::|\b(?:ILIKE|RETURNING|SERIAL|BIGSERIAL|SMALLSERIAL|JSONB|BYTEA|ARRAY|BOOLEAN|BOOL|TRUE|FALSE|GENERATED|STRING_AGG|DATE_TRUNC|NEXTVAL|CURRVAL|SETVAL|TIMESTAMPTZ)\b|\bON\s+CONFLICT\b|\bDISTINCT\s+ON\b|\bFILTER\s*\(|->|#>|\[|\$\d+/i
  // ROWNUM is only safe here as a simple final conjunct, without ordering/grouping.
  if (source === 'oracle' && /\bROWNUM\b/i.test(s)) {
    if (/\b(?:ORDER|GROUP|OR|UNION|SELECT[\s\S]*SELECT)\b/i.test(s)) return blocked('complex ROWNUM pagination')
    const cap = /\s+(WHERE|AND)\s+ROWNUM\s*(<=|=)\s*(\d+)\s*$/i.exec(s)
    if (!cap || (cap[2] === '=' && cap[3] !== '1')) return blocked('ROWNUM expression')
    s = s.slice(0, cap.index) + ` LIMIT ${cap[3]}`
    warnings.push('PostgreSQL pagination: converted ROWNUM to LIMIT')
  }
  if (unsupported.test(s)) return blocked('unsupported dialect-specific expression or DDL')
  if (source === 'postgresql' && target === 'mysql' && /\|\||\b(?:NULLS|TO_CHAR|TO_DATE|TO_TIMESTAMP|INTERVAL)\b/i.test(s)) return blocked('PostgreSQL expression needs a manual MySQL rewrite')
  if (source === 'postgresql' && target === 'oracle' && /\b(?:CONCAT|LENGTH|TEXT)\s*\(/i.test(s)) return blocked('function semantics need a manual Oracle rewrite')
  const rewrite = (pattern: RegExp, replacement: string, detail: string) => {
    const next = s.replace(pattern, replacement)
    if (next !== s) { s = next; warnings.push(detail) }
  }
  if (quoted) warnings.push('PostgreSQL identifiers: converted identifier quoting; review case sensitivity')
  if (target === 'postgresql') {
    rewrite(/\b(?:NVL|IFNULL)\s*\(/gi, 'COALESCE(', 'PostgreSQL null handling: converted to COALESCE; review argument types and empty strings')
    rewrite(/\b(?:NOW|CURRENT_TIMESTAMP)\s*\(\s*([0-6])\s*\)/gi, 'CURRENT_TIMESTAMP($1)', 'PostgreSQL dates: converted timestamp precision')
    rewrite(/\bSYSDATE\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP', 'PostgreSQL dates: converted current timestamp; review time zone and transaction timing')
    rewrite(/\b(?:NOW|CURRENT_TIMESTAMP)\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP', 'PostgreSQL dates: converted current timestamp; review time zone and transaction timing')
    rewrite(/\b(?:SYSDATE|SYSTIMESTAMP)\b/gi, 'CURRENT_TIMESTAMP', 'PostgreSQL dates: converted current timestamp; review time zone and transaction timing')
    rewrite(/\bCURDATE\s*\(\s*\)/gi, 'CURRENT_DATE', 'PostgreSQL dates: converted current date')
    rewrite(/\bCHAR_LENGTH\s*\(/gi, 'LENGTH(', 'PostgreSQL functions: converted character length')
    rewrite(/\s+FROM\s+DUAL\b/gi, '', 'PostgreSQL dual: removed FROM DUAL')
    rewrite(/\bLIMIT\s+(\d+)\s*,\s*(\d+)/gi, 'LIMIT $2 OFFSET $1', 'PostgreSQL pagination: converted LIMIT offset, count')
    rewrite(/\bOFFSET\s+(\d+)\s+ROWS?\s+FETCH\s+(?:NEXT|FIRST)\s+(\d+)\s+ROWS?\s+ONLY/gi, 'LIMIT $2 OFFSET $1', 'PostgreSQL pagination: converted OFFSET FETCH')
    rewrite(/\bFETCH\s+(?:FIRST|NEXT)\s+(\d+)\s+ROWS?\s+ONLY/gi, 'LIMIT $1', 'PostgreSQL pagination: converted FETCH to LIMIT')
    if (source === 'mysql' && /\bCONCAT\s*\(/i.test(s)) return blocked('CONCAT null semantics differ')
  } else {
    if (target === 'mysql') {
      rewrite(/\bLENGTH\s*\(/gi, 'CHAR_LENGTH(', 'PostgreSQL functions: converted character length')
    } else {
      rewrite(/\bNOW\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP', 'PostgreSQL dates: converted current timestamp; review time zone and transaction timing')
      rewrite(/\bLIMIT\s+(\d+)\s+OFFSET\s+(\d+)\b/gi, 'OFFSET $2 ROWS FETCH NEXT $1 ROWS ONLY', 'PostgreSQL pagination: converted LIMIT OFFSET to OFFSET FETCH')
      rewrite(/\bLIMIT\s+(\d+)\b/gi, 'FETCH FIRST $1 ROWS ONLY', 'PostgreSQL pagination: converted LIMIT to FETCH FIRST')
      if (/\bLIMIT\b|\bOFFSET\s+\d+(?![\d\s]*ROWS)\b/i.test(s)) return blocked('unsupported pagination expression')
      if (/^\s*SELECT\b/i.test(s) && !/\bFROM\b/i.test(s)) {
        const at = s.search(/\b(?:WHERE|GROUP|HAVING|ORDER|OFFSET|FETCH)\b/i)
        s = at < 0 ? s.trimEnd() + ' FROM DUAL' : s.slice(0, at) + 'FROM DUAL ' + s.slice(at)
        warnings.push('PostgreSQL dual: added FROM DUAL for Oracle')
      }
    }
  }
  // Only rewrite the type slot following a column declaration, never arbitrary words.
  if (/^\s*CREATE\s+TABLE\b/i.test(s)) {
    const types: Record<string, string> = target === 'postgresql'
      ? source === 'oracle'
        ? { NUMBER: 'NUMERIC', VARCHAR2: 'VARCHAR', NVARCHAR2: 'VARCHAR', CLOB: 'TEXT', BINARY_FLOAT: 'REAL', BINARY_DOUBLE: 'DOUBLE PRECISION', DATE: 'TIMESTAMP' }
        : { DATETIME: 'TIMESTAMP', LONGTEXT: 'TEXT', MEDIUMTEXT: 'TEXT', TINYTEXT: 'TEXT', DOUBLE: 'DOUBLE PRECISION', TINYINT: 'SMALLINT' }
      : target === 'oracle'
        ? { NUMERIC: 'NUMBER', DECIMAL: 'NUMBER', VARCHAR: 'VARCHAR2', TEXT: 'CLOB', INTEGER: 'NUMBER(10)', INT: 'NUMBER(10)', BIGINT: 'NUMBER(19)', SMALLINT: 'NUMBER(5)', REAL: 'BINARY_FLOAT' }
        : { TEXT: 'LONGTEXT', NUMERIC: 'DECIMAL' }
    const identifier = `(?:[A-Za-z_][\\w$]*|${nul}\\d+${nul})`
    s = s.replace(new RegExp(`([,(]\\s*${identifier}\\s+)([A-Za-z_][A-Za-z_0-9]*)\\b`, 'g'), (whole, prefix: string, type: string) => {
      const mapped = types[type.toUpperCase()]
      if (!mapped) return whole
      warnings.push('PostgreSQL types: mapped column types; review precision, ranges and date semantics')
      return prefix + mapped
    })
  }
  return {
    output: s.replace(new RegExp(`${nul}(\\d+)${nul}`, 'g'), (_, index) => spans[Number(index)]).trim(),
    warnings: [...new Set(warnings)],
  }
}

function converter(source: Dialect, target: Dialect): Converter {
  return { source, target, convert: sql => translate(sql, source, target) }
}
export const oracleToPostgresql = converter('oracle', 'postgresql')
export const mysqlToPostgresql = converter('mysql', 'postgresql')
export const postgresqlToOracle = converter('postgresql', 'oracle')
export const postgresqlToMysql = converter('postgresql', 'mysql')
