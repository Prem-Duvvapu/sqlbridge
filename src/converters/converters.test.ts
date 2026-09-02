import { describe, expect, it } from 'vitest'
import { convert, getSources, getTargetsFor, mysqlToOracle, oracleToMysql } from './index'

const o2m = (sql: string) => oracleToMysql.convert(sql)
const m2o = (sql: string) => mysqlToOracle.convert(sql)

const warnsAbout = (r: { warnings: string[] }, needle: string) =>
  r.warnings.some(w => w.includes(needle))

describe('Oracle → MySQL', () => {
  it('rewrites ROWNUM = 1 to LIMIT 1', () => {
    const r = o2m('SELECT * FROM emp WHERE ROWNUM = 1')
    expect(r.output).toBe('SELECT * FROM emp LIMIT 1')
    expect(warnsAbout(r, 'ROWNUM')).toBe(true)
  })

  it('keeps a sibling condition when lifting ROWNUM <= n', () => {
    expect(o2m('SELECT * FROM emp WHERE dept_id = 10 AND ROWNUM <= 5').output)
      .toBe('SELECT * FROM emp WHERE dept_id = 10 LIMIT 5')
  })

  it('rewrites a standalone ROWNUM <= n', () => {
    expect(o2m('SELECT * FROM emp WHERE ROWNUM <= 10').output)
      .toBe('SELECT * FROM emp LIMIT 10')
  })

  it('strips a trailing semicolon alongside ROWNUM', () => {
    expect(o2m('SELECT * FROM emp WHERE ROWNUM <= 5;').output)
      .toBe('SELECT * FROM emp LIMIT 5')
  })

  it('rewrites FETCH FIRST to LIMIT', () => {
    expect(o2m('SELECT * FROM emp FETCH FIRST 10 ROWS ONLY').output)
      .toBe('SELECT * FROM emp LIMIT 10')
  })

  it('rewrites OFFSET/FETCH to LIMIT/OFFSET', () => {
    expect(o2m('SELECT * FROM emp OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY').output)
      .toBe('SELECT * FROM emp LIMIT 10 OFFSET 20')
  })

  it('rewrites NVL to IFNULL', () => {
    expect(o2m('SELECT name, NVL(salary, 0) FROM emp').output)
      .toBe('SELECT name, IFNULL(salary, 0) FROM emp')
  })

  it('rewrites NVL2 to IF', () => {
    expect(o2m('SELECT NVL2(comm, comm, 0) FROM emp').output)
      .toBe('SELECT IF(comm IS NOT NULL, comm, 0) FROM emp')
  })

  it('rewrites DECODE to CASE', () => {
    expect(o2m("SELECT DECODE(status, 'A', 'Active', 'Unknown') FROM emp").output)
      .toBe("SELECT CASE status WHEN 'A' THEN 'Active' ELSE 'Unknown' END FROM emp")
  })

  it('rewrites LISTAGG to GROUP_CONCAT', () => {
    expect(o2m("SELECT LISTAGG(name, ',') WITHIN GROUP (ORDER BY name) FROM emp").output)
      .toBe("SELECT GROUP_CONCAT(name SEPARATOR ',') FROM emp")
  })

  it('rewrites SYSDATE and drops FROM DUAL', () => {
    expect(o2m('SELECT SYSDATE FROM DUAL').output).toBe('SELECT NOW()')
  })

  it('rewrites TO_DATE to STR_TO_DATE', () => {
    expect(o2m("SELECT TO_DATE('2024-01-01', 'YYYY-MM-DD') FROM DUAL").output)
      .toBe("SELECT STR_TO_DATE('2024-01-01', '%Y-%m-%d')")
  })

  it('rewrites TO_CHAR to DATE_FORMAT', () => {
    expect(o2m("SELECT TO_CHAR(hire_date, 'YYYY') FROM emp").output)
      .toBe("SELECT DATE_FORMAT(hire_date, '%Y') FROM emp")
  })

  it('leaves TO_CHAR with a number mask alone', () => {
    const sql = "SELECT TO_CHAR(salary, '999G999') FROM emp"
    expect(o2m(sql).output).toBe(sql)
  })

  it('rewrites || concatenation to CONCAT', () => {
    expect(o2m("SELECT first_name || ' ' || last_name AS full FROM emp").output)
      .toBe("SELECT CONCAT(first_name, ' ', last_name) AS full FROM emp")
  })

  it('rewrites ADD_MONTHS to DATE_ADD', () => {
    expect(o2m('SELECT ADD_MONTHS(hire_date, 3) FROM emp').output)
      .toBe('SELECT DATE_ADD(hire_date, INTERVAL 3 MONTH) FROM emp')
  })

  it('rewrites TRUNC(SYSDATE) before SYSDATE itself', () => {
    expect(o2m('SELECT TRUNC(SYSDATE) FROM DUAL').output).toBe('SELECT DATE(NOW())')
  })

  // RCA-008: Oracle DATE ± n means n days; MySQL treats the same shape as plain number
  // subtraction on the underlying value unless it's wrapped in an explicit INTERVAL.
  it('rewrites SYSDATE ± n to an explicit day INTERVAL', () => {
    const r = o2m('SELECT * FROM t WHERE d > SYSDATE - 7')
    expect(r.output).toBe('SELECT * FROM t WHERE d > NOW() - INTERVAL 7 DAY')
    expect(warnsAbout(r, 'SYSDATE date arithmetic')).toBe(true)
  })

  it('rewrites TRUNC(SYSDATE) ± n to an explicit day INTERVAL', () => {
    expect(o2m('SELECT * FROM t WHERE d >= TRUNC(SYSDATE) - 1').output)
      .toBe('SELECT * FROM t WHERE d >= DATE(NOW()) - INTERVAL 1 DAY')
  })

  it('does not double-wrap SYSDATE arithmetic that already uses INTERVAL', () => {
    expect(o2m("SELECT SYSDATE + INTERVAL '1' DAY FROM dual").output)
      .toBe("SELECT NOW() + INTERVAL '1' DAY")
  })

  it('leaves bare SYSDATE (no arithmetic) converted as before', () => {
    const r = o2m('SELECT SYSDATE FROM DUAL')
    expect(r.output).toBe('SELECT NOW()')
    expect(warnsAbout(r, 'SYSDATE date arithmetic')).toBe(false)
  })

  it('rewrites SYS_GUID to UUID', () => {
    expect(o2m('SELECT SYS_GUID() FROM DUAL').output).toBe('SELECT UUID()')
  })

  it('maps Oracle data types to MySQL', () => {
    expect(o2m('CREATE TABLE t (id NUMBER(10), name VARCHAR2(100), c CLOB)').output)
      .toBe('CREATE TABLE t (id DECIMAL(10), name VARCHAR(100), c LONGTEXT)')
  })

  it('converts double-quoted identifiers to backticks', () => {
    expect(o2m('SELECT * FROM "employees"').output).toBe('SELECT * FROM `employees`')
  })

  it('does not treat a column or alias that shares a type name as a type', () => {
    // NUMBER, RAW and LONG are all Oracle type names — and all common identifiers.
    expect(o2m('SELECT number, raw, long FROM t').output).toBe('SELECT number, raw, long FROM t')
    expect(o2m('SELECT a AS float FROM t').output).toBe('SELECT a AS float FROM t')
  })

  it('drops NULLS LAST', () => {
    expect(o2m('SELECT * FROM emp ORDER BY name NULLS LAST').output)
      .toBe('SELECT * FROM emp ORDER BY name')
  })

  it('rewrites MONTHS_BETWEEN to TIMESTAMPDIFF with swapped arguments', () => {
    expect(o2m('SELECT MONTHS_BETWEEN(d1, d2) FROM t').output)
      .toBe('SELECT TIMESTAMPDIFF(MONTH, d2, d1) FROM t')
  })

  it('strips a trailing semicolon, including a stray doubled one', () => {
    expect(o2m('SELECT * FROM emp WHERE ROWNUM <= 10;').output)
      .toBe('SELECT * FROM emp LIMIT 10')
    expect(o2m('SELECT * FROM emp WHERE ROWNUM <= 10;;').output)
      .toBe('SELECT * FROM emp LIMIT 10')
    expect(o2m('SELECT * FROM emp WHERE ROWNUM <= 10 ; ').output)
      .toBe('SELECT * FROM emp LIMIT 10')
  })
})

describe('Oracle → MySQL confidence gate', () => {
  const gated: ReadonlyArray<readonly [string, string, string]> = [
    ['CONNECT BY', 'SELECT * FROM emp START WITH id=1 CONNECT BY PRIOR id = mgr_id', 'CONNECT BY'],
    ['NEXTVAL', 'SELECT seq_emp.NEXTVAL FROM DUAL', 'NEXTVAL'],
    ['CURRVAL', 'SELECT seq_emp.CURRVAL FROM DUAL', 'CURRVAL'],
    ['MERGE', 'MERGE INTO t USING s ON (t.id = s.id)', 'MERGE'],
    ['PIVOT', 'SELECT * FROM t PIVOT (SUM(x) FOR y IN (1, 2))', 'PIVOT'],
    ['MATCH_RECOGNIZE', 'SELECT * FROM t MATCH_RECOGNIZE (ORDER BY x)', 'MATCH_RECOGNIZE'],
    ['NEXT_DAY', "SELECT NEXT_DAY(SYSDATE, 'MONDAY') FROM DUAL", 'NEXT_DAY'],
  ]

  it.each(gated)('refuses to convert %s and says why', (_name, sql, needle) => {
    const r = o2m(sql)
    expect(r.blocked?.reason).toContain(needle)
    expect(warnsAbout(r, needle)).toBe(true)
    // The original SQL is handed back untouched so nothing is silently mangled.
    expect(r.output).toBe(sql)
  })

  it('leaves convertible SQL unblocked', () => {
    expect(o2m('SELECT NVL(a, 0) FROM emp').blocked).toBeUndefined()
  })
})

describe('MySQL → Oracle', () => {
  it('rewrites LIMIT to FETCH FIRST', () => {
    expect(m2o('SELECT * FROM emp LIMIT 5').output).toContain('FETCH FIRST 5 ROWS ONLY')
  })

  it('rewrites LIMIT/OFFSET to OFFSET/FETCH NEXT', () => {
    expect(m2o('SELECT * FROM emp LIMIT 10 OFFSET 20').output)
      .toContain('OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY')
  })

  it('drops a trailing semicolon when rewriting LIMIT', () => {
    const out = m2o('SELECT * FROM app_user LIMIT 510;').output.replace(/\s+$/, '')
    expect(out.endsWith('FETCH FIRST 510 ROWS ONLY')).toBe(true)
    expect(out).not.toContain(';')
  })

  it('does not strand a doubled semicolon mid-statement', () => {
    // Regression: `;;` left one `;` behind, which the LIMIT rewrite then stranded on its
    // own line between the FROM clause and FETCH FIRST.
    const out = m2o('SELECT *\nFROM job_execution\nLIMIT 10;;').output
    expect(out).not.toContain(';')
    expect(out.replace(/\s+/g, ' ')).toBe('SELECT * FROM job_execution FETCH FIRST 10 ROWS ONLY')
  })

  it('rewrites IFNULL to NVL', () => {
    expect(m2o('SELECT IFNULL(salary, 0) FROM emp').output).toBe('SELECT NVL(salary, 0) FROM emp')
  })

  it('rewrites IF() to CASE WHEN', () => {
    expect(m2o("SELECT IF(status = 1, 'a', 'b') FROM users").output)
      .toBe("SELECT CASE WHEN status = 1 THEN 'a' ELSE 'b' END FROM users")
  })

  it('rewrites NOW() and adds FROM DUAL', () => {
    expect(m2o('SELECT NOW()').output).toBe('SELECT SYSTIMESTAMP FROM DUAL')
  })

  it('rewrites CONCAT to || concatenation', () => {
    expect(m2o("SELECT CONCAT(first_name, ' ', last_name) AS full FROM emp").output)
      .toBe("SELECT first_name || ' ' || last_name AS full FROM emp")
  })

  it('rewrites UUID to SYS_GUID', () => {
    expect(m2o('SELECT UUID()').output).toBe('SELECT SYS_GUID() FROM DUAL')
  })

  it('rewrites CHAR_LENGTH to LENGTH', () => {
    expect(m2o('SELECT CHAR_LENGTH(name) FROM emp').output).toBe('SELECT LENGTH(name) FROM emp')
  })

  it('rewrites DATE_FORMAT to TO_CHAR', () => {
    expect(m2o("SELECT DATE_FORMAT(created_at, '%Y-%m-%d') FROM posts").output)
      .toBe("SELECT TO_CHAR(created_at, '%Y-%m-%d') FROM posts")
  })

  it('rewrites STR_TO_DATE to TO_DATE', () => {
    expect(m2o("SELECT STR_TO_DATE('2024-01-01', '%Y-%m-%d')").output)
      .toBe("SELECT TO_DATE('2024-01-01', '%Y-%m-%d') FROM DUAL")
  })

  it('rewrites DATEDIFF to date subtraction', () => {
    expect(m2o('SELECT DATEDIFF(NOW(), hire_date) FROM emp').output)
      .toBe('SELECT CAST(SYSTIMESTAMP AS DATE) - CAST(hire_date AS DATE) FROM emp')
  })

  it('maps MySQL data types to Oracle', () => {
    expect(m2o('CREATE TABLE t (id INT, name VARCHAR(100), bl LONGBLOB)').output)
      .toBe('CREATE TABLE t (id NUMBER(10), name VARCHAR2(100), bl BLOB)')
  })

  it('maps TINYINT to NUMBER(3)', () => {
    expect(m2o('CREATE TABLE t (id TINYINT)').output).toBe('CREATE TABLE t (id NUMBER(3))')
  })

  it('drops a source display width when the target already has its own precision', () => {
    // TINYINT(1) must become NUMBER(3), not the invalid NUMBER(3)(1).
    expect(m2o('CREATE TABLE t (flag TINYINT(1) DEFAULT 0)').output)
      .toBe('CREATE TABLE t (flag NUMBER(3) DEFAULT 0)')
    expect(m2o('CREATE TABLE t (id INT(11) NOT NULL)').output)
      .toBe('CREATE TABLE t (id NUMBER(10) NOT NULL)')
  })

  it('maps TEXT to CLOB', () => {
    expect(m2o('CREATE TABLE t (body TEXT)').output).toBe('CREATE TABLE t (body CLOB)')
  })

  it('does not treat a column or alias that shares a type name as a type', () => {
    // YEAR is a MySQL type name — and a common column name.
    expect(m2o('SELECT text, year FROM logs').output).toBe('SELECT text, year FROM logs')
    expect(m2o('SELECT a AS year FROM t').output).toBe('SELECT a AS year FROM t')
  })

  it('converts backtick identifiers to double quotes', () => {
    expect(m2o('SELECT * FROM `employees`').output).toBe('SELECT * FROM "employees"')
  })

  it('adds FROM DUAL to a bare SELECT', () => {
    expect(m2o('SELECT 1').output).toBe('SELECT 1 FROM DUAL')
  })

  it('leaves an existing FROM clause alone', () => {
    expect(m2o('SELECT id FROM users').output).toBe('SELECT id FROM users')
  })

  it('rewrites DATABASE() to SYS_CONTEXT', () => {
    expect(m2o('SELECT DATABASE()').output)
      .toBe("SELECT SYS_CONTEXT('USERENV', 'DB_NAME') FROM DUAL")
  })

  it('rewrites CONNECTION_ID() to SYS_CONTEXT', () => {
    expect(m2o('SELECT CONNECTION_ID()').output)
      .toBe("SELECT SYS_CONTEXT('USERENV', 'SESSIONID') FROM DUAL")
  })

  it('rewrites GROUP_CONCAT to LISTAGG', () => {
    expect(m2o("SELECT GROUP_CONCAT(name, ',') FROM emp").output)
      .toBe("SELECT LISTAGG(name, ',') FROM emp")
  })

  it('rewrites DATE_ADD to INTERVAL arithmetic', () => {
    expect(m2o('SELECT DATE_ADD(hire_date, INTERVAL 3 MONTH) FROM emp').output)
      .toBe("SELECT hire_date + INTERVAL '3' MONTH FROM emp")
  })

  it('quotes a bare inline INTERVAL numeral for Oracle', () => {
    // MySQL's `expr ± INTERVAL n unit` is bare; Oracle's INTERVAL literal must be quoted.
    expect(m2o('SELECT * FROM t WHERE d > NOW() - INTERVAL 7 DAY').output)
      .toBe("SELECT * FROM t WHERE d > SYSTIMESTAMP - INTERVAL '7' DAY")
  })

  it('expands a multi-row INSERT into INSERT ALL', () => {
    const r = m2o("INSERT INTO t (id, name) VALUES (1, 'a'), (2, 'b'), (3, 'c')")
    expect(r.output).toContain('INSERT ALL')
    expect(r.output).toContain('SELECT * FROM DUAL')
    expect(r.output.match(/INTO t/g)).toHaveLength(3)
    expect(warnsAbout(r, 'INSERT ALL')).toBe(true)
  })

  it('leaves a single-row INSERT as-is', () => {
    const r = m2o("INSERT INTO t (id, name) VALUES (1, 'a')")
    expect(r.output).not.toContain('INSERT ALL')
  })

  it('warns about TIMESTAMPDIFF rather than guessing', () => {
    expect(warnsAbout(m2o('SELECT TIMESTAMPDIFF(MONTH, a, b) FROM t'), 'TIMESTAMPDIFF')).toBe(true)
  })
})

// RCA-006 (string literals) / RCA-007 (comments): a keyword or function name inside
// user data or a note must not be rewritten — only real SQL is.
describe('string literals and comments are protected from rewrites', () => {
  it('leaves a keyword-shaped string literal untouched (o2m)', () => {
    const r = o2m("SELECT 'use NVL(x,0) and ROWNUM here' AS tip FROM dual")
    expect(r.output).toBe("SELECT 'use NVL(x,0) and ROWNUM here' AS tip")
  })

  it('respects a doubled quote escape inside the literal (o2m)', () => {
    expect(o2m("SELECT 'it''s NVL(a,b)' FROM dual").output)
      .toBe("SELECT 'it''s NVL(a,b)'")
  })

  it('leaves a keyword-shaped string literal untouched (m2o)', () => {
    expect(m2o("SELECT 'IFNULL(a,b) NOW()' AS s FROM t").output)
      .toBe("SELECT 'IFNULL(a,b) NOW()' AS s FROM t")
  })

  it('leaves keywords inside a line comment untouched', () => {
    expect(o2m('-- NVL(a,b) and SYSDATE in a comment\nSELECT a FROM t').output)
      .toBe('-- NVL(a,b) and SYSDATE in a comment\nSELECT a FROM t')
  })

  it('leaves keywords inside a block comment untouched', () => {
    expect(o2m('/* SYSDATE NVL(x,y) */ SELECT a FROM t').output)
      .toBe('/* SYSDATE NVL(x,y) */ SELECT a FROM t')
  })

  it('still translates the TO_CHAR format mask, which needs to read a real string', () => {
    expect(o2m("SELECT TO_CHAR(hire_date,'YYYY-MM-DD') FROM emp").output)
      .toBe("SELECT DATE_FORMAT(hire_date, '%Y-%m-%d') FROM emp")
  })

  it('still turns a `||` chain with a literal segment into CONCAT', () => {
    expect(o2m("SELECT id || '-' || name FROM t").output)
      .toBe("SELECT CONCAT(id, '-', name) FROM t")
  })

  it('handles a query mixing a protected literal with real rewrites elsewhere', () => {
    const r = o2m("SELECT NVL(a, 0), 'call NVL first' AS note, SYSDATE FROM t WHERE ROWNUM <= 5")
    expect(r.output).toBe("SELECT IFNULL(a, 0), 'call NVL first' AS note, NOW() FROM t LIMIT 5")
  })
})

describe('registry', () => {
  it('routes a known pair to its converter', () => {
    expect(convert('SELECT * FROM emp WHERE ROWNUM = 1', 'oracle', 'mysql').output)
      .toBe('SELECT * FROM emp LIMIT 1')
  })

  it('is case-insensitive about dialect names', () => {
    expect(convert('SELECT 1', 'MySQL', 'ORACLE').output).toBe('SELECT 1 FROM DUAL')
  })

  it('returns an error result for an unknown pair instead of throwing', () => {
    const r = convert('SELECT 1', 'oracle', 'postgresql')
    expect(r.output).toContain('No converter available')
    expect(r.warnings).toHaveLength(1)
  })

  it('never throws on pathological input', () => {
    const junk = [
      '('.repeat(4000),
      ')'.repeat(4000),
      "'".repeat(999),
      '\u0000\u0001\u0007 SELECT',
      'SELECT '.repeat(3000),
      'DECODE('.repeat(200) + 'x' + ')'.repeat(200),
    ]
    for (const sql of junk) {
      expect(() => convert(sql, 'oracle', 'mysql')).not.toThrow()
      expect(() => convert(sql, 'mysql', 'oracle')).not.toThrow()
    }
  })

  it('lists each source dialect once', () => {
    expect(getSources().map(d => d.name)).toEqual(['oracle', 'mysql'])
    expect(getSources().map(d => d.label)).toEqual(['Oracle', 'MySQL'])
  })

  it('lists reachable targets for a source', () => {
    expect(getTargetsFor('oracle').map(d => d.name)).toEqual(['mysql'])
    expect(getTargetsFor('nope')).toEqual([])
  })
})

describe('multi-statement scripts', () => {
  it('converts every statement and keeps the terminators', () => {
    const r = convert('SELECT SYSDATE FROM DUAL;\nSELECT NVL(x, 0) FROM t;', 'oracle', 'mysql')
    expect(r.statements).toHaveLength(2)
    expect(r.output).toBe('SELECT NOW();\nSELECT IFNULL(x, 0) FROM t;')
    expect(r.blocked).toBeUndefined()
  })

  it('flattens warnings across statements', () => {
    const r = convert('SELECT NVL(a, 0) FROM t;\nSELECT NVL2(b, b, 0) FROM t;', 'oracle', 'mysql')
    expect(r.warnings.length).toBeGreaterThanOrEqual(1)
    expect(r.statements[1].warnings.some(w => w.includes('NVL2'))).toBe(true)
  })

  it('converts the rest of a script and marks the one statement it refuses', () => {
    const script = [
      'SELECT NVL(a, 0) FROM t;',
      'SELECT * FROM emp CONNECT BY PRIOR id = mgr_id;',
      'SELECT SYSDATE FROM DUAL;',
    ].join('\n')
    const r = convert(script, 'oracle', 'mysql')

    expect(r.blocked).toBeUndefined() // not the whole-script panel
    expect(r.statements[0].output).toBe('SELECT IFNULL(a, 0) FROM t')
    expect(r.statements[1].blocked?.reason).toContain('CONNECT BY')
    expect(r.statements[2].output).toBe('SELECT NOW()')
    expect(r.output).toContain('-- SQLBridge: not translated — CONNECT BY')
    expect(r.output).toContain('SELECT IFNULL(a, 0) FROM t;')
    expect(r.output.trimEnd().endsWith('SELECT NOW();')).toBe(true)
  })

  it('still shows the whole-script blocked state for a single refused query', () => {
    const r = convert('SELECT * FROM emp CONNECT BY PRIOR id = mgr_id', 'oracle', 'mysql')
    expect(r.blocked?.reason).toContain('CONNECT BY')
    expect(r.statements).toHaveLength(1)
  })

  it('does not split a PL/SQL block, and the gate refuses it', () => {
    const block = 'BEGIN\n  UPDATE t SET x = 1;\n  DELETE FROM u;\nEND;'
    const r = convert(block, 'oracle', 'mysql')
    expect(r.statements).toHaveLength(1)
    expect(r.blocked?.reason).toContain('PL/SQL')
  })

  it('passes a DELIMITER directive through untouched', () => {
    const r = convert('DELIMITER //\nSELECT NOW()//', 'mysql', 'oracle')
    expect(r.output).toContain('DELIMITER //')
    expect(r.output).toContain('SYSTIMESTAMP')
  })

  it('drops empty statements from stray semicolons', () => {
    const r = convert('SELECT NVL(a, 0) FROM t;;;', 'oracle', 'mysql')
    expect(r.statements).toHaveLength(1)
    expect(r.output).toBe('SELECT IFNULL(a, 0) FROM t;')
  })
})

describe('converters are pure', () => {
  // Guards the "100 simultaneous users" requirement: converters are shared module
  // singletons, so any state carried between calls would leak across conversions.
  const corpus = [
    'SELECT name, NVL(salary, 0), SYSDATE FROM emp WHERE ROWNUM <= 5',
    "SELECT DECODE(status, 'A', 'Active', 'Unknown') FROM emp",
    "SELECT TO_CHAR(hire_date, 'YYYY-MM-DD') FROM emp",
    'SELECT * FROM emp FETCH FIRST 10 ROWS ONLY',
  ]

  it('returns identical results when the same input is converted repeatedly', () => {
    for (const sql of corpus) {
      const first = o2m(sql)
      expect(o2m(sql)).toEqual(first)
      expect(o2m(sql)).toEqual(first)
    }
  })

  it('does not let one conversion affect the next', () => {
    const baseline = o2m(corpus[0])
    corpus.forEach(sql => o2m(sql))
    expect(o2m(corpus[0])).toEqual(baseline)
  })

  it('never mutates the input string', () => {
    const sql = 'SELECT NVL(a, 0) FROM DUAL'
    const copy = String(sql)
    o2m(sql)
    expect(sql).toBe(copy)
  })

  it('accumulates warnings per call, not across calls', () => {
    const a = o2m('SELECT NVL2(x, y, z) FROM t')
    const b = o2m('SELECT NVL2(x, y, z) FROM t')
    expect(a.warnings).toEqual(b.warnings)
  })
})
