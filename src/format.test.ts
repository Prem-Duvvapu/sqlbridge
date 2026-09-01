import { describe, expect, it } from 'vitest'
import { format } from './format'

describe('format', () => {
  it('breaks a one-line query onto multiple indented lines', async () => {
    const { sql } = await format('SELECT a, b FROM emp WHERE id = 1', 'mysql')
    expect(sql).toBe(['SELECT', '  a,', '  b', 'FROM', '  emp', 'WHERE', '  id = 1'].join('\n'))
  })

  it('uppercases keywords', async () => {
    const { sql } = await format('select a from emp', 'oracle')
    expect(sql).toContain('SELECT')
    expect(sql).toContain('FROM')
  })

  it('formats Oracle pagination as PL/SQL', async () => {
    const { sql } = await format('SELECT a FROM emp FETCH FIRST 5 ROWS ONLY', 'oracle')
    expect(sql).toContain('FETCH FIRST\n  5 ROWS ONLY')
  })

  it('returns the input untouched, with a reason, when it cannot parse', async () => {
    const broken = 'SELECT FROM WHERE ((('
    const { sql, error } = await format(broken, 'mysql')
    expect(sql).toBe(broken)
    expect(error).toBeTruthy()
  })

  it('leaves whitespace-only input alone', async () => {
    expect(await format('   \n  ', 'mysql')).toEqual({ sql: '   \n  ' })
  })

  it('falls back to generic SQL for an unknown dialect', async () => {
    const { sql, error } = await format('SELECT a FROM t', 'db2')
    expect(error).toBeUndefined()
    expect(sql).toContain('SELECT')
  })
})
