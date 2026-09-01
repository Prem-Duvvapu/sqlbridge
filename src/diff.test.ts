import { describe, expect, it } from 'vitest'
import { diffSql, type DiffPiece, type DiffRow } from './diff'

/** Rebuild the original text from a row's pieces — `same` + `del` gives the before side. */
const beforeText = (pieces: DiffPiece[]) =>
  pieces.filter(p => p.mark !== 'add').map(p => p.text).join('')
const afterText = (pieces: DiffPiece[]) =>
  pieces.filter(p => p.mark !== 'del').map(p => p.text).join('')

const marked = (pieces: DiffPiece[], mark: 'add' | 'del') =>
  pieces.filter(p => p.mark === mark).map(p => p.text)

const replaceRows = (rows: DiffRow[]) =>
  rows.filter((r): r is Extract<DiffRow, { kind: 'replace' }> => r.kind === 'replace')

describe('diffSql', () => {
  it('reports no changes for identical input', () => {
    const d = diffSql('SELECT 1 FROM t', 'SELECT 1 FROM t')
    expect(d.changed).toBe(0)
    expect(d.rows.every(r => r.kind === 'context')).toBe(true)
  })

  it('highlights only the tokens that changed within a line', () => {
    const d = diffSql('SELECT NVL(salary, 0) FROM emp', 'SELECT IFNULL(salary, 0) FROM emp')
    expect(d.changed).toBe(1)

    const [row] = replaceRows(d.rows)
    expect(marked(row.before, 'del')).toEqual(['NVL'])
    expect(marked(row.after, 'add')).toEqual(['IFNULL'])
  })

  it('reconstructs both sides exactly from the pieces', () => {
    const before = 'SELECT a, NVL(b, 0)\nFROM emp\nWHERE ROWNUM <= 5'
    const after = 'SELECT a, IFNULL(b, 0)\nFROM emp\nLIMIT 5'
    const d = diffSql(before, after)

    const rebuiltBefore: string[] = []
    const rebuiltAfter: string[] = []
    for (const row of d.rows) {
      if (row.kind === 'context') { rebuiltBefore.push(row.text); rebuiltAfter.push(row.text) }
      else if (row.kind === 'replace') {
        rebuiltBefore.push(beforeText(row.before))
        rebuiltAfter.push(afterText(row.after))
      } else if (row.kind === 'del') rebuiltBefore.push(beforeText(row.before))
      else rebuiltAfter.push(afterText(row.after))
    }
    expect(rebuiltBefore.join('\n')).toBe(before)
    expect(rebuiltAfter.join('\n')).toBe(after)
  })

  it('keeps unchanged lines as context', () => {
    const d = diffSql('SELECT a\nFROM emp\nWHERE x = 1', 'SELECT b\nFROM emp\nWHERE x = 1')
    const context = d.rows.filter(r => r.kind === 'context')
    expect(context).toHaveLength(2)
    expect(d.changed).toBe(1)
  })

  it('records a pure insertion', () => {
    const d = diffSql('SELECT a\nFROM emp', 'SELECT a\nFROM emp\nLIMIT 5')
    expect(d.changed).toBe(1)
    const added = d.rows.filter(r => r.kind === 'add')
    expect(added).toHaveLength(1)
  })

  it('records a pure deletion', () => {
    const d = diffSql('SELECT a\nFROM emp\nWHERE ROWNUM <= 5', 'SELECT a\nFROM emp')
    expect(d.changed).toBe(1)
    expect(d.rows.filter(r => r.kind === 'del')).toHaveLength(1)
  })

  it('handles an empty side', () => {
    expect(diffSql('', 'SELECT 1').changed).toBe(1)
    expect(diffSql('SELECT 1', '').changed).toBe(1)
    expect(diffSql('', '').changed).toBe(0)
  })

  it('marks a whole line when a clause is rewritten wholesale', () => {
    const d = diffSql('SELECT * FROM emp WHERE ROWNUM <= 5', 'SELECT * FROM emp LIMIT 5')
    const [row] = replaceRows(d.rows)
    expect(marked(row.before, 'del').join('')).toContain('ROWNUM')
    expect(marked(row.after, 'add').join('')).toContain('LIMIT')
  })

  it('never marks a token on both sides of a pair', () => {
    const d = diffSql('SELECT NVL(a, 0), SYSDATE FROM t', 'SELECT IFNULL(a, 0), NOW() FROM t')
    for (const row of replaceRows(d.rows)) {
      expect(row.before.every(p => p.mark !== 'add')).toBe(true)
      expect(row.after.every(p => p.mark !== 'del')).toBe(true)
    }
  })

  it('coalesces neighbouring pieces with the same mark', () => {
    const d = diffSql('SELECT a FROM t', 'SELECT b FROM t')
    for (const row of replaceRows(d.rows)) {
      for (const side of [row.before, row.after]) {
        for (let i = 1; i < side.length; i++) {
          expect(side[i].mark).not.toBe(side[i - 1].mark)
        }
      }
    }
  })
})
