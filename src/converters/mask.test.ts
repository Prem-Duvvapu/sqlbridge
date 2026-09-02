import { describe, expect, it } from 'vitest'
import { maskLiteralsAndComments } from './mask'

describe('maskLiteralsAndComments', () => {
  it('hides a string literal so a keyword inside it is invisible', () => {
    const { masked, restore } = maskLiteralsAndComments("SELECT 'use NVL(x,0) here' FROM t")
    expect(masked).not.toContain('NVL')
    expect(masked).not.toContain("'")
    expect(restore(masked)).toBe("SELECT 'use NVL(x,0) here' FROM t")
  })

  it("keeps a doubled '' escape inside the masked span", () => {
    const { masked, restore } = maskLiteralsAndComments("SELECT 'it''s NVL(a,b)' FROM t")
    expect(masked).not.toContain('NVL')
    expect(restore(masked)).toBe("SELECT 'it''s NVL(a,b)' FROM t")
  })

  it('hides a line comment', () => {
    const { masked, restore } = maskLiteralsAndComments('-- NVL(a,b) and SYSDATE\nSELECT a FROM t')
    expect(masked).not.toContain('NVL')
    expect(masked).not.toContain('SYSDATE')
    expect(masked).toContain('\nSELECT a FROM t')
    expect(restore(masked)).toBe('-- NVL(a,b) and SYSDATE\nSELECT a FROM t')
  })

  it('hides a block comment', () => {
    const { masked, restore } = maskLiteralsAndComments('/* SYSDATE NVL(x,y) */ SELECT a FROM t')
    expect(masked).not.toContain('NVL')
    expect(restore(masked)).toBe('/* SYSDATE NVL(x,y) */ SELECT a FROM t')
  })

  it('restores multiple spans independently and in order', () => {
    const sql = "SELECT 'a' AS x, -- note\n  'b' AS y FROM t"
    const { masked, restore } = maskLiteralsAndComments(sql)
    expect(restore(masked)).toBe(sql)
  })

  it('leaves ordinary SQL untouched', () => {
    const sql = 'SELECT a, b FROM t WHERE a = 1'
    const { masked, restore } = maskLiteralsAndComments(sql)
    expect(masked).toBe(sql)
    expect(restore(masked)).toBe(sql)
  })

  it('does not throw on an unterminated string literal', () => {
    const { masked, restore } = maskLiteralsAndComments("SELECT 'unterminated")
    expect(() => restore(masked)).not.toThrow()
    expect(restore(masked)).toBe("SELECT 'unterminated")
  })

  it('does not throw on an unterminated block comment', () => {
    const { masked, restore } = maskLiteralsAndComments('SELECT a /* unterminated')
    expect(restore(masked)).toBe('SELECT a /* unterminated')
  })
})
