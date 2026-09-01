import { describe, expect, it } from 'vitest'
import { MAX_IMPORT_BYTES, checkImportSize, suggestedFilename } from './fileTransfer'

describe('checkImportSize', () => {
  it('accepts a file at or under the limit', () => {
    expect(checkImportSize('a.sql', 0)).toBeNull()
    expect(checkImportSize('a.sql', MAX_IMPORT_BYTES)).toBeNull()
  })

  it('rejects a file over the limit and names it with its size', () => {
    const msg = checkImportSize('dump.sql', MAX_IMPORT_BYTES + 1)
    expect(msg).toContain('dump.sql')
    expect(msg).toContain('2 MB')
  })

  it('reports the actual size in MB', () => {
    expect(checkImportSize('big.sql', 5 * 1024 * 1024)).toContain('5.0 MB')
  })
})

describe('suggestedFilename', () => {
  it('builds a slugged .sql name from the dialect', () => {
    expect(suggestedFilename('mysql')).toBe('sqlbridge-mysql.sql')
    expect(suggestedFilename('SQL Server')).toBe('sqlbridge-sql-server.sql')
  })

  it('falls back to a safe name for an empty or odd dialect', () => {
    expect(suggestedFilename('')).toBe('sqlbridge-sql.sql')
    expect(suggestedFilename('!!!')).toBe('sqlbridge-sql.sql')
  })
})
