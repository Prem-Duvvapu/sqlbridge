// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tour, type TourStep } from './Tour'

const STEPS: readonly TourStep[] = [
  { target: '[data-tour="a"]', title: 'First', body: 'First body' },
  { target: '[data-tour="b"]', title: 'Second', body: 'Second body' },
  { target: '[data-tour="missing"]', title: 'Third', body: 'Third body' },
]

function Harness() {
  return (
    <div>
      <button data-tour="a">A</button>
      <button data-tour="b">B</button>
    </div>
  )
}

describe('Tour', () => {
  it('renders the first step and steps forward with Next', async () => {
    const onFinish = vi.fn()
    render(<><Harness /><Tour steps={STEPS} onFinish={onFinish} /></>)

    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Second')).toBeInTheDocument()
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(onFinish).not.toHaveBeenCalled()
  })

  it('steps backward with Back', async () => {
    const onFinish = vi.fn()
    render(<><Harness /><Tour steps={STEPS} onFinish={onFinish} /></>)

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('First')).toBeInTheDocument()
  })

  it('calls onFinish from Skip', async () => {
    const onFinish = vi.fn()
    render(<><Harness /><Tour steps={STEPS} onFinish={onFinish} /></>)

    await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('shows Done on the last step and calls onFinish when clicked', async () => {
    const onFinish = vi.fn()
    render(<><Harness /><Tour steps={STEPS} onFinish={onFinish} /></>)

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', async () => {
    const onFinish = vi.fn()
    render(<><Harness /><Tour steps={STEPS} onFinish={onFinish} /></>)

    await userEvent.keyboard('{Escape}')
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('navigates with arrow keys', async () => {
    const onFinish = vi.fn()
    render(<><Harness /><Tour steps={STEPS} onFinish={onFinish} /></>)

    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByText('Second')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByText('First')).toBeInTheDocument()
  })

  it('degrades to a centered tooltip when the target selector matches nothing', async () => {
    const onFinish = vi.fn()
    render(<><Harness /><Tour steps={STEPS} onFinish={onFinish} /></>)

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    // Step 3 targets a selector that isn't in the DOM — no spotlight, but the tooltip
    // still renders rather than throwing.
    expect(screen.getByText('Third')).toBeInTheDocument()
    expect(document.querySelector('.tour-spotlight')).not.toBeInTheDocument()
  })

  it('renders nothing when the step list is empty', () => {
    const onFinish = vi.fn()
    const { container } = render(<Tour steps={[]} onFinish={onFinish} />)
    expect(container.firstChild).toBeNull()
  })
})
