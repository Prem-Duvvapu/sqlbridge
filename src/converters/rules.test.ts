import { describe, expect, it } from 'vitest'
import { RULES, ruleForBlockedReason, ruleForWarning } from './rules'
import { convert, mysqlToOracle, oracleToMysql } from './index'

describe('rule catalogue', () => {
  const all = Object.values(RULES)

  it('every rule has an id, a title and a non-trivial detail', () => {
    for (const rule of all) {
      expect(rule.id).toMatch(/^[a-z0-9-]+$/)
      expect(rule.title.length).toBeGreaterThan(2)
      expect(rule.detail.length).toBeGreaterThan(20)
    }
  })

  it('ids are unique', () => {
    const ids = all.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only blocked-severity rules exist for the confidence gate', () => {
    expect(RULES.connectBy.severity).toBe('blocked')
    expect(RULES.plsqlProgram.severity).toBe('blocked')
  })
})

describe('ruleForWarning', () => {
  it('maps a converter warning to its rule', () => {
    expect(ruleForWarning('Converted NVL2 to IF')).toBe(RULES.nvl2ToIf)
    expect(ruleForWarning('Converted ROWNUM <= n to LIMIT')).toBe(RULES.rownumToLimit)
    expect(ruleForWarning('Converted ROWNUM = 1 to LIMIT 1')).toBe(RULES.rownumToLimit)
    expect(ruleForWarning('Converted DECODE to CASE')).toBe(RULES.decodeToCase)
    expect(ruleForWarning('LAST_DAY — MySQL 8.0+ has LAST_DAY(), check compatibility')).toBe(RULES.lastDayCompat)
  })

  it('maps a gate warning through its reason', () => {
    expect(ruleForWarning('CONNECT BY hierarchical query detected — automatic conversion may be incorrect'))
      .toBe(RULES.connectBy)
  })

  it('returns undefined for an unknown string', () => {
    expect(ruleForWarning('something we never emit')).toBeUndefined()
  })

  it('covers every warning the converters actually push', () => {
    // Any rewrite the converters can announce must resolve to a rule, or Explain mode
    // would show a note with no "why".
    const samples = [
      'SELECT NVL2(a, b, 0) FROM t',
      "SELECT DECODE(x, 1, 'a', 'b') FROM t",
      "SELECT LISTAGG(n, ',') WITHIN GROUP (ORDER BY n) FROM t",
      'SELECT * FROM emp WHERE ROWNUM <= 5',
      'SELECT * FROM emp FETCH FIRST 3 ROWS ONLY',
      'SELECT * FROM emp OFFSET 5 ROWS FETCH NEXT 3 ROWS ONLY',
      "SELECT TO_CHAR(d, 'YYYY-MM-DD') FROM t",
      "SELECT TO_DATE('x', 'YYYY') FROM t",
    ]
    for (const sql of samples) {
      for (const w of oracleToMysql.convert(sql).warnings) {
        expect(ruleForWarning(w), `no rule for: ${w}`).toBeDefined()
      }
    }
    for (const sql of ['SELECT * FROM t LIMIT 5', "SELECT IF(x, 'a', 'b') FROM t", "SELECT CONCAT(a, ' ', b) FROM t"]) {
      for (const w of mysqlToOracle.convert(sql).warnings) {
        expect(ruleForWarning(w), `no rule for: ${w}`).toBeDefined()
      }
    }
  })
})

describe('ruleForBlockedReason', () => {
  it('maps every gate reason to a rule', () => {
    const reasons = [
      'CONNECT BY hierarchical query', 'Sequence reference (NEXTVAL)', 'MERGE statement',
      'PIVOT clause', 'UNPIVOT clause', 'NEXT_DAY function', 'INSTR with 4 arguments',
      'PL/SQL stored program', 'MySQL stored program', 'DELIMITER directive',
    ]
    for (const reason of reasons) {
      expect(ruleForBlockedReason(reason), reason).toBeDefined()
    }
  })
})

describe('convert() attaches notes', () => {
  it('carries a rule and statement index per note', () => {
    const r = convert('SELECT NVL2(a, b, 0) FROM t;\nSELECT DECODE(x, 1, 2, 3) FROM t;', 'oracle', 'mysql')
    expect(r.notes.map(n => n.rule.id)).toEqual(['nvl2-to-if', 'decode-to-case'])
    expect(r.notes.map(n => n.statement)).toEqual([0, 1])
  })

  it('exposes the blocking rule on a refused query', () => {
    const r = convert('SELECT * FROM emp CONNECT BY PRIOR id = mgr_id', 'oracle', 'mysql')
    expect(r.blocked?.rule?.id).toBe('connect-by')
  })

  it('leaves notes empty for a clean conversion', () => {
    expect(convert('SELECT NVL(a, 0) FROM t', 'oracle', 'mysql').notes).toEqual([])
  })
})
