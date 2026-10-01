import { describe, expect, it } from 'vitest'
import { convert, getTargetsFor } from './index'
import { splitStatements, joinStatements } from '../sql/split'
import { roundTrip } from '../roundTrip'

const pg = (sql: string, source = 'oracle', target = 'postgresql') => convert(sql, source, target)

describe('PostgreSQL conversions', () => {
  it.each([
    ['oracle', 'postgresql', 'SELECT NVL(x, 0), SYSDATE FROM t FETCH FIRST 5 ROWS ONLY', 'SELECT COALESCE(x, 0), CURRENT_TIMESTAMP FROM t LIMIT 5'],
    ['mysql', 'postgresql', 'SELECT IFNULL(x, 0), CURDATE() FROM `t` LIMIT 10, 5', 'SELECT COALESCE(x, 0), CURRENT_DATE FROM "t" LIMIT 5 OFFSET 10'],
    ['postgresql', 'oracle', 'SELECT COALESCE(x, 0) FROM t LIMIT 5 OFFSET 10', 'SELECT COALESCE(x, 0) FROM t OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY'],
    ['mysql', 'postgresql', 'SELECT NOW(6), SYSDATE()', 'SELECT CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP'],
    ['postgresql', 'mysql', 'SELECT LENGTH("name") FROM "users" LIMIT 5', 'SELECT CHAR_LENGTH(`name`) FROM `users` LIMIT 5'],
  ])('converts %s to %s', (source, target, input, output) => {
    const result = pg(input, source, target)
    expect(result.blocked).toBeUndefined()
    expect(result.output).toBe(output)
    expect(result.notes).toHaveLength(result.warnings.length)
  })

  it('registers both reverse directions', () => {
    expect(getTargetsFor('postgresql').map(x => x.name)).toEqual(['oracle', 'mysql'])
  })
  it('handles simple ROWNUM caps and DUAL', () => {
    expect(pg('SELECT * FROM t WHERE ROWNUM <= 5').output).toBe('SELECT * FROM t LIMIT 5')
    expect(pg('SELECT 1 FROM DUAL').output).toBe('SELECT 1')
    expect(pg('SELECT NOW() LIMIT 1', 'postgresql', 'oracle').output).toBe('SELECT CURRENT_TIMESTAMP FROM DUAL FETCH FIRST 1 ROWS ONLY')
  })
  it('preserves data, comments and quoted identifiers during rewrites', () => {
    const input = `SELECT 'NVL(x, 0)', "NVL", NVL(x, 0) /* NVL(x, 1) */ FROM t`
    expect(pg(input).output).toBe(`SELECT 'NVL(x, 0)', "NVL", COALESCE(x, 0) /* NVL(x, 1) */ FROM t`)
  })
  it('maps only column type slots', () => {
    expect(pg('CREATE TABLE t (number NUMBER(10,2), label VARCHAR2(20), created DATE, "CLOB" CLOB)').output)
      .toBe('CREATE TABLE t (number NUMERIC(10,2), label VARCHAR(20), created TIMESTAMP, "CLOB" TEXT)')
    expect(pg('SELECT number, clob FROM t').output).toBe('SELECT number, clob FROM t')
  })
  it.each([
    ['postgresql', 'mysql', 'SELECT x::text FROM t'],
    ['postgresql', 'oracle', 'INSERT INTO t VALUES (1) RETURNING id'],
    ['postgresql', 'mysql', "SELECT $$a;b' NVL(x, 0)$$"],
    ['postgresql', 'oracle', "DO $body$ BEGIN PERFORM 1; PERFORM 2; END $body$"],
    ['mysql', 'postgresql', 'SELECT GROUP_CONCAT(x) FROM t'],
    ['mysql', 'postgresql', "SELECT CONCAT(x, 'a') FROM t"],
    ['oracle', 'postgresql', 'SELECT * FROM t WHERE ROWNUM <= 5 ORDER BY id'],
    ['oracle', 'postgresql', 'SELECT seq.NEXTVAL FROM DUAL'],
    ['oracle', 'postgresql', 'SELECT SYSDATE - 1 FROM DUAL'],
    ['mysql', 'postgresql', 'SELECT "literal"'],
  ])('preserves refused %s → %s input', (source, target, input) => {
    const result = pg(input, source, target)
    expect(result.output).toBe(input)
    expect(result.blocked?.rule?.severity).toBe('blocked')
  })
  it('converts other statements around a refused dollar-quoted statement', () => {
    const input = "SELECT LENGTH(x) FROM t; SELECT $$a;b$$; SELECT 1;"
    const result = pg(input, 'postgresql', 'mysql')
    expect(result.statements).toHaveLength(3)
    expect(result.output).toContain('SELECT CHAR_LENGTH(x) FROM t;')
    expect(result.output).toContain('-- SQLBridge: not translated')
    expect(result.output).toContain('SELECT $$a;b$$; SELECT 1;')
  })
  it('round-trips shared syntax', () => {
    expect(roundTrip('SELECT COALESCE(x, 0) FROM t LIMIT 5', 'postgresql', 'mysql').returned)
      .toBe('SELECT COALESCE(x, 0) FROM t LIMIT 5')
  })
})

describe('PostgreSQL script boundaries', () => {
  it.each(['SELECT 1; SELECT $$unfinished', 'SELECT 1; /* unfinished'])('keeps malformed scripts intact: %s', input => {
    expect(splitStatements(input)).toHaveLength(1)
    expect(pg(input, 'postgresql', 'mysql').output).toBe(input)
    expect(pg(input, 'postgresql', 'mysql').blocked).toBeDefined()
  })
  it.each([
    "SELECT $$a;b$$; SELECT 2;",
    "SELECT $tag$a;'b$tag$; SELECT 2;",
    "SELECT E'a\\';b'; SELECT 2;",
    'SELECT 1 /* outer /* inner */ ; still comment */; SELECT 2;',
  ])('preserves protected spans: %s', input => {
    const statements = splitStatements(input)
    expect(statements).toHaveLength(2)
    expect(joinStatements(statements.map(statement => ({ statement, sql: statement.sql })))).toBe(input)
  })
})
