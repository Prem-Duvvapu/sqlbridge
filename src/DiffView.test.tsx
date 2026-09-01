// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiffView } from './DiffView'
import { diffSql } from './diff'

const props = {
  sourceLabel: 'Oracle',
  targetLabel: 'MySQL',
  onCopy: vi.fn(),
  onDownload: vi.fn(),
  copied: false,
}

describe('DiffView', () => {
  it('summarises the number of changed lines', () => {
    const diff = diffSql('SELECT NVL(a, 0) FROM emp', 'SELECT IFNULL(a, 0) FROM emp')
    render(<DiffView {...props} diff={diff} />)
    expect(screen.getByText('1 line changed')).toBeInTheDocument()
  })

  it('says so when the two sides are identical', () => {
    const diff = diffSql('SELECT 1', 'SELECT 1')
    render(<DiffView {...props} diff={diff} />)
    expect(screen.getByText(/identical/i)).toBeInTheDocument()
  })

  it('renders a removed and an added row for a rewrite', () => {
    const diff = diffSql('SELECT NVL(a, 0)', 'SELECT IFNULL(a, 0)')
    const { container } = render(<DiffView {...props} diff={diff} />)
    expect(container.querySelector('.diff-row-del .diff-tok-del')?.textContent).toBe('NVL')
    expect(container.querySelector('.diff-row-add .diff-tok-add')?.textContent).toBe('IFNULL')
  })

  it('wires the Copy and Download buttons', async () => {
    const onCopy = vi.fn()
    const onDownload = vi.fn()
    const diff = diffSql('SELECT NVL(a, 0)', 'SELECT IFNULL(a, 0)')
    render(<DiffView {...props} diff={diff} onCopy={onCopy} onDownload={onDownload} />)

    await userEvent.click(screen.getByRole('button', { name: 'Download' }))
    await userEvent.click(screen.getByRole('button', { name: /copy result/i }))
    expect(onDownload).toHaveBeenCalledOnce()
    expect(onCopy).toHaveBeenCalledOnce()
  })

  it('disables Copy and Download when there is nothing to export', () => {
    const diff = diffSql('SELECT 1', 'SELECT 1')
    render(<DiffView {...props} diff={diff} />)
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /copy result/i })).toBeDisabled()
  })

  it('shows "Copied" while the copied flag is set', () => {
    const diff = diffSql('SELECT NVL(a, 0)', 'SELECT IFNULL(a, 0)')
    render(<DiffView {...props} diff={diff} copied />)
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })
})
