import { describe, expect, it } from 'vitest'
import { tokenize, type TokenKind } from './highlight'

/** All tokens of one kind, in order — the readable way to assert classification. */
const of = (sql: string, kind: TokenKind) =>
  tokenize(sql).filter(t => t.kind === kind).map(t => t.text)

describe('tokenize', () => {
  it('reproduces the input exactly', () => {
    const samples = [
      "SELECT a, b FROM t WHERE x = 1 AND y LIKE '%z%'",
      'SELECT\n  a,\n  b\nFROM t -- trailing comment',
      '',
      '   ',
      "weird ¬ chars ± here 'unclosed",
    ]
    for (const sql of samples) {
      expect(tokenize(sql).map(t => t.text).join('')).toBe(sql)
    }
  })

  it('marks structural keywords', () => {
    expect(of('SELECT a FROM t WHERE x = 1', 'keyword')).toEqual(['SELECT', 'FROM', 'WHERE'])
  })

  it('separates logical connectors from keywords', () => {
    expect(of('SELECT * FROM t WHERE a = 1 AND b = 2 OR c IS NULL', 'clause'))
      .toEqual(['AND', 'OR', 'IS', 'NULL'])
  })

  it('marks the name after FROM, JOIN, INTO and UPDATE as a table', () => {
    expect(of('SELECT * FROM employees', 'table')).toEqual(['employees'])
    expect(of('SELECT * FROM a JOIN b ON a.id = b.id', 'table')).toEqual(['a', 'b'])
    expect(of('INSERT INTO orders VALUES (1)', 'table')).toEqual(['orders'])
    expect(of('UPDATE customers SET x = 1', 'table')).toEqual(['customers'])
  })

  it('treats quoted identifiers as table names', () => {
    expect(of('SELECT * FROM `emp`', 'table')).toEqual(['`emp`'])
    expect(of('SELECT * FROM "emp"', 'table')).toEqual(['"emp"'])
  })

  it('marks a name followed by an open paren as a function', () => {
    expect(of('SELECT NVL(salary, 0), UPPER (name) FROM emp', 'function'))
      .toEqual(['NVL', 'UPPER'])
  })

  it('does not mistake a keyword for a function when it is followed by a paren', () => {
    // COUNT(*) is a function, but `IN (…)` is a connector, not a call.
    expect(of('SELECT * FROM t WHERE id IN (1, 2)', 'function')).toEqual([])
  })

  it('marks strings and numbers', () => {
    expect(of("SELECT 'abc', 42, 3.5 FROM t", 'string')).toEqual(["'abc'"])
    expect(of("SELECT 'abc', 42, 3.5 FROM t", 'number')).toEqual(['42', '3.5'])
  })

  it('keeps a string containing keywords as one string token', () => {
    expect(of("SELECT 'FROM WHERE AND' FROM t", 'string')).toEqual(["'FROM WHERE AND'"])
    expect(of("SELECT 'FROM WHERE AND' FROM t", 'keyword')).toEqual(['SELECT', 'FROM'])
  })

  it('marks line and block comments', () => {
    expect(of('SELECT a -- pick one\nFROM t', 'comment')).toEqual(['-- pick one'])
    expect(of('SELECT /* note */ a FROM t', 'comment')).toEqual(['/* note */'])
  })

  it('is case-insensitive when classifying', () => {
    expect(of('select a from t where x = 1 and y = 2', 'keyword'))
      .toEqual(['select', 'from', 'where'])
    expect(of('select a from t where x = 1 and y = 2', 'clause')).toEqual(['and'])
  })

  it('handles an unterminated string without throwing or losing text', () => {
    const sql = "SELECT 'oops FROM t"
    expect(() => tokenize(sql)).not.toThrow()
    expect(tokenize(sql).map(t => t.text).join('')).toBe(sql)
  })
})
