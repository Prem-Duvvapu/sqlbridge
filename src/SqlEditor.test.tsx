// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SqlInput, SqlView } from './SqlEditor'

describe('SqlView', () => {
  it('shows the placeholder when empty, still labelled', () => {
    render(<SqlView value="" placeholder="nothing yet" ariaLabel="out" />)
    expect(screen.getByText('nothing yet')).toHaveClass('editor-empty')
    expect(screen.getByLabelText('out')).toBeInTheDocument()
  })

  it('colours tokens for normal-sized SQL', () => {
    const { container } = render(
      <SqlView value="SELECT a FROM t" placeholder="" ariaLabel="out" />,
    )
    const keywords = [...container.querySelectorAll('.tok-keyword')].map(n => n.textContent)
    expect(keywords).toEqual(['SELECT', 'FROM'])
  })

  it('drops highlighting past the size cap but keeps the text', () => {
    const big = `SELECT ${'x'.repeat(21_000)}`
    const { container } = render(<SqlView value={big} placeholder="" ariaLabel="out" />)
    expect(container.querySelector('.tok-keyword')).toBeNull()
    expect(container.querySelector('.editor-view')?.textContent).toBe(big)
  })
})

describe('SqlInput', () => {
  const noop = () => {}

  it('renders a textarea holding the value, over a highlight layer', () => {
    const { container } = render(
      <SqlInput value="SELECT 1" onChange={noop} onKeyDown={noop} dialect="mysql"
        placeholder="paste here" ariaLabel="in" />,
    )
    expect(screen.getByLabelText('in')).toHaveValue('SELECT 1')
    expect(container.querySelector('.editor-layer .tok-keyword')?.textContent).toBe('SELECT')
  })

  it('reports typing through onChange', async () => {
    const onChange = vi.fn()
    render(<SqlInput value="" onChange={onChange} onKeyDown={noop} dialect="mysql"
      placeholder="paste here" ariaLabel="in" />)
    await userEvent.type(screen.getByLabelText('in'), 'ab')
    expect(onChange).toHaveBeenLastCalledWith('b') // uncontrolled in the test → last keystroke
  })

  it('forwards Ctrl+Enter to onKeyDown', async () => {
    const onKeyDown = vi.fn()
    render(<SqlInput value="x" onChange={noop} onKeyDown={onKeyDown} dialect="mysql"
      placeholder="" ariaLabel="in" />)
    screen.getByLabelText('in').focus()
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(onKeyDown).toHaveBeenCalled()
  })

  it('uses the plain stack past the size cap', () => {
    const big = `SELECT ${'x'.repeat(21_000)}`
    const { container } = render(
      <SqlInput value={big} onChange={noop} onKeyDown={noop} dialect="mysql"
        placeholder="" ariaLabel="in" />,
    )
    expect(container.querySelector('.editor-stack-plain')).not.toBeNull()
    expect(container.querySelector('.editor-layer')).toBeNull()
  })
})
