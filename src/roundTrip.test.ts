import { describe, expect, it } from 'vitest'
import { normalizeSql, roundTrip } from './roundTrip'

describe('normalizeSql', () => {
  it('collapses whitespace and drops trailing terminators', () => {
    expect(normalizeSql('SELECT  1\nFROM  dual;\n\n')).toBe('SELECT 1 FROM DUAL')
  })

  it('upper-cases known keywords but leaves identifiers alone', () => {
    expect(normalizeSql('select emp_id from Emp where dept_id = 10'))
      .toBe('SELECT emp_id FROM Emp WHERE dept_id = 10')
  })
})

describe('roundTrip', () => {
  it('reports a clean round-trip when A→B→A reproduces the original', () => {
    const result = roundTrip('SELECT NVL(salary, 0) FROM emp', 'oracle', 'mysql')
    expect(result.available).toBe(true)
    expect(result.matches).toBe(true)
    expect(result.diff.changed).toBe(0)
    expect(result.lossyRules).toEqual([])
  })

  it('flags a known-lossy rewrite instead of reporting a silent mismatch', () => {
    const result = roundTrip('SELECT SYSDATE FROM dual', 'oracle', 'mysql')
    expect(result.available).toBe(true)
    expect(result.matches).toBe(false)
    expect(result.lossyRules.length).toBeGreaterThan(0)
    expect(result.lossyRules.some(r => r.title.toLowerCase().includes('sysdate'))).toBe(true)
  })

  it('de-duplicates lossy rules that fire more than once', () => {
    const result = roundTrip('SELECT SYSDATE, SYSDATE FROM dual', 'oracle', 'mysql')
    const titles = result.lossyRules.map(r => r.title)
    expect(titles.length).toBe(new Set(titles).size)
  })

  it('is unavailable when there is no reverse converter', () => {
    const result = roundTrip('SELECT 1', 'mysql', 'postgresql')
    expect(result.available).toBe(false)
    expect(result.unavailableReason).toMatch(/postgresql.*mysql/i)
    expect(result.matches).toBe(true)
  })
})
