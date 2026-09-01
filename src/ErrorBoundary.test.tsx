// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorBoundary } from './ErrorBoundary'

function Boom({ message }: { message: string }): never {
  throw new Error(message)
}

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(<ErrorBoundary><p>all good</p></ErrorBoundary>)
    expect(screen.getByText('all good')).toBeInTheDocument()
  })

  it('shows the recovery screen and the error message on a throw', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><Boom message="kaboom in render" /></ErrorBoundary>)

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument()
    expect(screen.getByText('kaboom in render')).toBeInTheDocument()
    expect(screen.getByText(/your sql is still saved/i)).toBeInTheDocument()
  })

  it('"Try to continue" re-renders the children once they stop throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    let broken = true
    const Flaky = () => {
      if (broken) throw new Error('not yet')
      return <p>recovered</p>
    }

    render(<ErrorBoundary><Flaky /></ErrorBoundary>)
    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument()

    broken = false
    await userEvent.click(screen.getByRole('button', { name: /try to continue/i }))
    expect(screen.getByText('recovered')).toBeInTheDocument()
  })

  it('offers a reload button', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><Boom message="x" /></ErrorBoundary>)
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
  })
})
