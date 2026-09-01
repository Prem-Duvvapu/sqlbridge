// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadTheme, loadWorkspace, saveTheme, saveWorkspace, type Workspace } from './persistence'

const workspace: Workspace = {
  input: 'SELECT 1',
  output: 'SELECT 1 FROM DUAL',
  warnings: ['note'],
  source: 'mysql',
  target: 'oracle',
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('loadWorkspace', () => {
  it('returns null on a first visit', () => {
    expect(loadWorkspace()).toBeNull()
  })

  it('round-trips a saved workspace', () => {
    saveWorkspace(workspace)
    expect(loadWorkspace()).toEqual(workspace)
  })

  it('prefers this tab\'s sessionStorage over the shared snapshot', () => {
    localStorage.setItem('sqlbridge:last', JSON.stringify({ v: 1, ...workspace, input: 'OLD' }))
    sessionStorage.setItem('sqlbridge:tab', JSON.stringify({ v: 1, ...workspace, input: 'CURRENT' }))
    expect(loadWorkspace()?.input).toBe('CURRENT')
  })

  it('falls back to the localStorage snapshot when the tab has none', () => {
    localStorage.setItem('sqlbridge:last', JSON.stringify({ v: 1, ...workspace, input: 'RESTORED' }))
    expect(loadWorkspace()?.input).toBe('RESTORED')
  })

  it('ignores a payload from an older schema version', () => {
    localStorage.setItem('sqlbridge:last', JSON.stringify({ v: 0, ...workspace }))
    expect(loadWorkspace()).toBeNull()
  })

  it('ignores corrupt JSON', () => {
    sessionStorage.setItem('sqlbridge:tab', '{not json')
    expect(loadWorkspace()).toBeNull()
  })

  it('fills missing fields with defaults rather than returning a partial', () => {
    localStorage.setItem('sqlbridge:last', JSON.stringify({ v: 1, input: 'x' }))
    expect(loadWorkspace()).toEqual({
      input: 'x', output: '', warnings: [], source: 'oracle', target: 'mysql',
    })
  })

  it('drops non-string entries from warnings', () => {
    sessionStorage.setItem('sqlbridge:tab', JSON.stringify({ v: 1, ...workspace, warnings: ['ok', 3, null] }))
    expect(loadWorkspace()?.warnings).toEqual(['ok'])
  })
})

describe('theme', () => {
  it('defaults to light with nothing stored', () => {
    expect(loadTheme()).toBe('light')
  })

  it('round-trips an explicit dark choice', () => {
    saveTheme('dark')
    expect(loadTheme()).toBe('dark')
  })

  it('treats any non-"dark" value as light', () => {
    localStorage.setItem('sqlbridge:theme', 'system')
    expect(loadTheme()).toBe('light')
  })
})

describe('when storage throws (private mode, blocked site data)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('loadWorkspace returns null instead of throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => loadWorkspace()).not.toThrow()
    expect(loadWorkspace()).toBeNull()
  })

  it('saveWorkspace swallows the failure', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => saveWorkspace(workspace)).not.toThrow()
  })

  it('loadTheme falls back to light', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(loadTheme()).toBe('light')
  })
})
