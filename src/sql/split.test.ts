import { describe, expect, it } from 'vitest'
import { joinStatements, splitStatements, type Statement } from './split'

/** The round-trip invariant: an unmodified split re-joins to exactly the input. */
const roundTrips = (script: string) => {
  const parts = splitStatements(script).map(statement => ({ statement, sql: statement.sql }))
  return joinStatements(parts) === script
}

const bodies = (script: string) => splitStatements(script).map(s => s.sql.trim())

describe('splitStatements — round-trip invariant', () => {
  it.each([
    'SELECT 1',
    'SELECT 1;',
    'SELECT 1;\nSELECT 2;',
    '  -- a comment\nSELECT 1; /* block */ SELECT 2;\n',
    "SELECT ';' AS semi, \"a;b\" FROM t;",
    'SELECT 1 -- trailing comment, no newline',
    '',
    '   \n\t  ',
    ';;;',
    'BEGIN\n  INSERT INTO t VALUES (1);\n  INSERT INTO t VALUES (2);\nEND;\n/',
    'DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; END$$\nDELIMITER ;',
  ])('reproduces %j exactly', script => {
    expect(roundTrips(script)).toBe(true)
  })
})

describe('splitStatements — statement boundaries', () => {
  it('splits on top-level semicolons', () => {
    expect(bodies('SELECT 1; SELECT 2; SELECT 3')).toEqual(['SELECT 1', 'SELECT 2', 'SELECT 3'])
  })

  it('does not split on a semicolon inside a string', () => {
    expect(bodies("INSERT INTO t VALUES ('a; b'); SELECT 1")).toEqual([
      "INSERT INTO t VALUES ('a; b')",
      'SELECT 1',
    ])
  })

  it("handles '' escapes inside strings", () => {
    expect(bodies("SELECT 'O''Brien; Jr'; SELECT 2")).toEqual(["SELECT 'O''Brien; Jr'", 'SELECT 2'])
  })

  it('does not split on a semicolon inside a quoted identifier', () => {
    expect(bodies('SELECT "col;name" FROM t; SELECT 2')).toEqual(['SELECT "col;name" FROM t', 'SELECT 2'])
  })

  it('does not split inside a line or block comment', () => {
    expect(bodies('SELECT 1 -- one; two\n; SELECT 2')).toEqual(['SELECT 1 -- one; two', 'SELECT 2'])
    expect(bodies('SELECT 1 /* ; ; */; SELECT 2')).toEqual(['SELECT 1 /* ; ; */', 'SELECT 2'])
  })

  it('keeps a PL/SQL block whole despite its internal semicolons', () => {
    const script = 'BEGIN\n  UPDATE t SET x = 1;\n  IF y THEN NULL; END IF;\nEND;\nSELECT 1;'
    expect(bodies(script)).toEqual([
      'BEGIN\n  UPDATE t SET x = 1;\n  IF y THEN NULL; END IF;\nEND',
      'SELECT 1',
    ])
  })

  it('treats a lone slash line as an Oracle terminator', () => {
    const parts = splitStatements('BEGIN NULL; END\n/\nSELECT 1;')
    expect(parts[0].terminator).toBe('/')
    expect(parts[0].sql.trim()).toBe('BEGIN NULL; END')
  })

  it('switches terminator on a DELIMITER directive', () => {
    const parts = splitStatements('DELIMITER //\nSELECT 1//\nSELECT 2//')
    const sql = parts.map(p => p.sql.trim()).filter(Boolean)
    expect(sql).toEqual(['DELIMITER //', 'SELECT 1', 'SELECT 2'])
  })

  it('numbers statements and records a starting line', () => {
    const parts = splitStatements('SELECT 1;\n\nSELECT 2;')
    expect(parts.map(p => p.index)).toEqual([0, 1])
    expect(parts[1].line).toBe(3) // line 1: SELECT 1; · line 2: blank · line 3: SELECT 2;
  })
})

describe('splitStatements — safety valve', () => {
  it('returns the whole input as one statement when a string is unterminated', () => {
    const parts = splitStatements("SELECT 'oops; SELECT 2")
    expect(parts).toHaveLength(1)
    expect(parts[0].sql).toBe("SELECT 'oops; SELECT 2")
  })

  it('returns one statement when a block is left open', () => {
    const parts = splitStatements('BEGIN\n  SELECT 1;\n-- forgot END')
    expect(parts).toHaveLength(1)
  })

  it('returns one statement for an unterminated block comment', () => {
    expect(splitStatements('SELECT 1 /* never closed')).toHaveLength(1)
  })
})

describe('joinStatements', () => {
  it('substitutes converted SQL while keeping leading whitespace and terminators', () => {
    const [a, b] = splitStatements('  SELECT 1;\n  SELECT 2;')
    const joined = joinStatements([
      { statement: a, sql: 'SELECT one' },
      { statement: b, sql: 'SELECT two' },
    ])
    expect(joined).toBe('  SELECT one;\n  SELECT two;')
  })
})

// A tiny sanity check that Statement is shaped as documented.
it('Statement carries leading, sql and terminator that concatenate to the source', () => {
  const [s] = splitStatements('\n  -- c\n  SELECT 1;') as [Statement]
  expect(s.leading + s.sql + s.terminator).toBe('\n  -- c\n  SELECT 1;')
})
