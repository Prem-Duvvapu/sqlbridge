import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Last line of defence. If a render throws somewhere we didn't anticipate, the user gets
 * a readable page with their work preserved and a way out — not a blank white screen.
 *
 * Recoverable failures (a conversion that throws, a file that won't read) are handled
 * inline where they happen and never reach here; this is only for the genuinely
 * unexpected.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Nothing to report to — there's no backend — but leave a trace in the console.
    console.error('SQLBridge hit an unexpected error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="crash">
        <div className="crash-card">
          <h1 className="crash-title">Something went wrong</h1>
          <p className="crash-body">
            SQLBridge hit an unexpected error and stopped. Your SQL is still saved — it
            will be here when you reload.
          </p>
          <div className="crash-actions">
            <button
              type="button"
              className="crash-button crash-button-primary"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            <button
              type="button"
              className="crash-button"
              onClick={() => this.setState({ error: null })}
            >
              Try to continue
            </button>
          </div>
          <pre className="crash-detail">{error.message || String(error)}</pre>
          <p className="crash-foot">
            If it keeps happening,{' '}
            <a
              href="https://github.com/Prem-Duvvapu/sqlbridge/issues/new?template=bug_report.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              report it
            </a>{' '}
            with the message above.
          </p>
        </div>
      </div>
    )
  }
}
