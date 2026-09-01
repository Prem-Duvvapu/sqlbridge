import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeShare, encodeShare, parseShareToken, type SharePayload } from './share'

const payload: SharePayload = {
  v: 1,
  input: "SELECT NVL(salary, 0), SYSDATE FROM emp WHERE ROWNUM <= 5",
  source: 'oracle',
  target: 'mysql',
}

describe('encodeShare / decodeShare', () => {
  it('round-trips a workspace', async () => {
    const token = await encodeShare(payload)
    expect(token).toBeTruthy()
    expect(await decodeShare(token!)).toEqual(payload)
  })

  it('compresses — the token is shorter than the raw JSON for repetitive SQL', async () => {
    const big = { ...payload, input: 'SELECT a FROM t UNION ALL '.repeat(80) }
    const token = await encodeShare(big)
    expect(token!.length).toBeLessThan(JSON.stringify(big).length)
    expect((await decodeShare(token!))!.input).toBe(big.input)
  })

  it('produces a URL-safe token (no +, /, or =)', async () => {
    const token = await encodeShare({ ...payload, input: '???>>>///' })
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('refuses a payload that would make an over-long link', async () => {
    const huge = { ...payload, input: 'x'.repeat(200_000) } // random-ish, compresses poorly
    // 200k of the same char compresses well, so use varied content:
    const varied = { ...payload, input: Array.from({ length: 20000 }, (_, i) => `col_${i}`).join(',') }
    expect(await encodeShare(varied)).toBeNull()
    expect(await encodeShare(huge)).not.toBeNull() // sanity: repetitive still fits
  })

  it('works with the uncompressed fallback when CompressionStream is missing', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    const token = await encodeShare(payload)
    expect(token![0]).toBe('r') // raw scheme
    expect(await decodeShare(token!)).toEqual(payload)
    vi.unstubAllGlobals()
  })

  it('decodes null for garbage', async () => {
    expect(await decodeShare('cnot-valid-base64!!')).toBeNull()
    expect(await decodeShare('r' + btoa('{not json'))).toBeNull()
    expect(await decodeShare('')).toBeNull()
  })

  it('rejects a token from a newer schema version', async () => {
    const token = 'r' + Buffer.from(JSON.stringify({ v: 2, input: 'x' })).toString('base64url')
    expect(await decodeShare(token)).toBeNull()
  })

  it('fills missing fields with defaults', async () => {
    const token = 'r' + Buffer.from(JSON.stringify({ v: 1, input: 'SELECT 1' })).toString('base64url')
    expect(await decodeShare(token)).toEqual({ v: 1, input: 'SELECT 1', source: 'oracle', target: 'mysql' })
  })
})

describe('parseShareToken', () => {
  it('pulls s= out of a hash', () => {
    expect(parseShareToken('#s=abc123')).toBe('abc123')
    expect(parseShareToken('#view=diff&s=abc123')).toBe('abc123')
  })

  it('returns null when there is no token', () => {
    expect(parseShareToken('')).toBeNull()
    expect(parseShareToken('#view=diff')).toBeNull()
  })
})

afterEach(() => vi.unstubAllGlobals())
