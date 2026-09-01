import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { convert, getSources, getTargetsFor } from './converters'
import type { Workspace } from './persistence'
import { loadTheme, loadWorkspace, saveTheme, saveWorkspace } from './persistence'
import { format } from './format'
import { SqlInput, SqlView } from './SqlEditor'
import { diffSql } from './diff'
import { DiffView } from './DiffView'
import './App.css'

interface Sample {
  label: string
  sql: string
  source: string
  target: string
}

const SAMPLES: readonly Sample[] = [
  {
    label: 'Pagination and null handling',
    sql: 'SELECT name, NVL(salary, 0), SYSDATE\nFROM emp\nWHERE dept_id = 10 AND ROWNUM <= 5',
    source: 'oracle',
    target: 'mysql',
  },
  {
    label: 'String concatenation',
    sql: "SELECT CONCAT(first_name, ' ', last_name) AS full_name\nFROM users\nLIMIT 20",
    source: 'mysql',
    target: 'oracle',
  },
  {
    label: 'Needs a manual rewrite',
    sql: 'SELECT emp_id, mgr_id\nFROM emp\nSTART WITH mgr_id IS NULL\nCONNECT BY PRIOR emp_id = mgr_id',
    source: 'oracle',
    target: 'mysql',
  },
]

/**
 * First visit opens on a worked example rather than two empty boxes — the fastest way to
 * show what the tool does is to show it having already done it.
 */
function seedWorkspace(): Workspace {
  const { sql, source, target } = SAMPLES[0]
  const result = convert(sql, source, target)
  return { input: sql, output: result.output, warnings: result.warnings, source, target }
}

function App() {
  const initial = useMemo(() => loadWorkspace() ?? seedWorkspace(), [])
  const dialects = useMemo(getSources, [])

  const [source, setSource] = useState(initial.source)
  const [target, setTarget] = useState(initial.target)
  const [input, setInput] = useState(initial.input)
  const [output, setOutput] = useState(initial.output)
  const [warnings, setWarnings] = useState<string[]>(initial.warnings)
  const [blockedReason, setBlockedReason] = useState<string | null>(null)
  const [theme, setTheme] = useState(loadTheme)
  const [copied, setCopied] = useState(false)
  const [formatError, setFormatError] = useState<string | null>(null)
  const [view, setView] = useState<'split' | 'diff'>('split')

  const copyTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    saveTheme(theme)
  }, [theme])

  useEffect(() => {
    saveWorkspace({ input, output, warnings, source, target })
  }, [input, output, warnings, source, target])

  useEffect(() => () => window.clearTimeout(copyTimer.current), [])

  const targets = useMemo(() => getTargetsFor(source), [source])
  const canConvert = input.trim().length > 0 && source !== target
  const unsupported = source !== target && targets.every(d => d.name !== target)

  const canDiff = output !== '' && blockedReason === null
  const showDiff = view === 'diff' && canDiff
  const diff = useMemo(
    () => (showDiff ? diffSql(input, output) : null),
    [showDiff, input, output],
  )

  const runConvert = useCallback(() => {
    if (!canConvert) return
    const result = convert(input, source, target)
    setOutput(result.output)
    setWarnings(result.warnings)
    setBlockedReason(result.blocked?.reason ?? null)
    setCopied(false)
  }, [canConvert, input, source, target])

  function swapDirection() {
    setSource(target)
    setTarget(source)
    setInput(output)
    setOutput(input)
    setWarnings([])
    setBlockedReason(null)
    setFormatError(null)
  }

  function copyOutput() {
    if (!output) return
    navigator.clipboard.writeText(output).then(() => {
      setCopied(true)
      window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1800)
    }, () => undefined)
  }

  async function formatInput() {
    const result = await format(input, source)
    setInput(result.sql)
    setFormatError(result.error ?? null)
  }

  async function formatOutput() {
    const result = await format(output, target)
    setOutput(result.sql)
    setFormatError(result.error ?? null)
  }

  function loadSample(sample: Sample) {
    const result = convert(sample.sql, sample.source, sample.target)
    setSource(sample.source)
    setTarget(sample.target)
    setInput(sample.sql)
    setOutput(result.output)
    setWarnings(result.warnings)
    setBlockedReason(result.blocked?.reason ?? null)
    setFormatError(null)
    setCopied(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      runConvert()
    }
  }

  const labelFor = (name: string) =>
    dialects.find(d => d.name === name)?.label ?? name

  return (
    <div className="app" data-source={source} data-target={target}>
      <header className="masthead">
        <div className="wordmark">
          <span className="wordmark-glyph" aria-hidden="true">⇌</span>
          <span className="wordmark-text">SQLBridge</span>
        </div>
        <p className="tagline">SQL dialect translator · runs in your browser</p>
        <button
          type="button"
          className="ghost-button"
          onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </header>

      {/* The bridge: direction is the primary control, so it gets the primary space. */}
      <section className="bridge" aria-label="Conversion direction">
        <label className="bridge-end bridge-end-source">
          <span className="bridge-label">From</span>
          <select
            className="dialect-select"
            value={source}
            onChange={e => setSource(e.target.value)}
          >
            {dialects.map(d => (
              <option key={d.name} value={d.name}>{d.label}</option>
            ))}
          </select>
        </label>

        <div className="bridge-rail">
          <span className="rail-line" aria-hidden="true" />
          <button
            type="button"
            className="swap-button"
            onClick={swapDirection}
            aria-label="Swap source and target dialects"
            title="Swap direction"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="17 3 21 7 17 11" />
              <line x1="21" y1="7" x2="4" y2="7" />
              <polyline points="7 21 3 17 7 13" />
              <line x1="3" y1="17" x2="20" y2="17" />
            </svg>
          </button>
        </div>

        <label className="bridge-end bridge-end-target">
          <span className="bridge-label">To</span>
          <select
            className="dialect-select"
            value={target}
            onChange={e => setTarget(e.target.value)}
          >
            {dialects.map(d => (
              <option key={d.name} value={d.name}>{d.label}</option>
            ))}
          </select>
        </label>

        <button type="button" className="convert-button" onClick={runConvert} disabled={!canConvert}>
          Convert
          <kbd className="convert-hint">⌘↵</kbd>
        </button>
      </section>

      {source === target && (
        <p className="notice" role="status">
          Pick two different dialects to convert between.
        </p>
      )}
      {unsupported && (
        <p className="notice" role="status">
          No converter for {labelFor(source)} → {labelFor(target)} yet.
        </p>
      )}
      {formatError && (
        <p className="notice" role="status">
          Left the SQL as it was — the formatter couldn't parse it. {formatError}
        </p>
      )}

      <div className="view-switch" role="group" aria-label="View">
        <button
          type="button"
          className="view-tab"
          aria-pressed={!showDiff}
          onClick={() => setView('split')}
        >
          Split
        </button>
        <button
          type="button"
          className="view-tab"
          aria-pressed={showDiff}
          onClick={() => setView('diff')}
          disabled={!canDiff}
          title={canDiff ? 'Show what the translation changed' : 'Convert something first'}
        >
          Diff
        </button>
      </div>

      {showDiff && diff ? (
        <DiffView
          diff={diff}
          sourceLabel={labelFor(source)}
          targetLabel={labelFor(target)}
          onCopy={copyOutput}
          copied={copied}
        />
      ) : (
      <main className="panels">
        <section className="panel" data-role="source">
          <div className="panel-head">
            <h2 className="panel-title">{labelFor(source)}</h2>
            <div className="panel-head-actions">
              <span className="panel-meta">{input.length} chars</span>
              <button
                type="button"
                className="ghost-button ghost-button-sm"
                onClick={formatInput}
                disabled={!input.trim()}
                title="Reindent this SQL across multiple lines"
              >
                Format
              </button>
            </div>
          </div>
          <SqlInput
            value={input}
            onChange={setInput}
            onKeyDown={handleKeyDown}
            dialect={source}
            placeholder={`Paste ${labelFor(source)} SQL here`}
            ariaLabel={`${labelFor(source)} SQL input`}
          />
        </section>

        <section className="panel" data-role="target">
          <div className="panel-head">
            <h2 className="panel-title">{labelFor(target)}</h2>
            <div className="panel-head-actions">
              <span className="panel-meta">{output.length} chars</span>
              <button
                type="button"
                className="ghost-button ghost-button-sm"
                onClick={formatOutput}
                disabled={!output || blockedReason !== null}
                title="Reindent this SQL across multiple lines"
              >
                Format
              </button>
              <button
                type="button"
                className="ghost-button ghost-button-sm"
                onClick={copyOutput}
                disabled={!output}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          {blockedReason ? (
            <div className="blocked" role="status">
              <p className="blocked-title">Not translated</p>
              <p className="blocked-reason">
                {blockedReason} needs a manual rewrite. Your SQL is unchanged below —
                translating it automatically would risk changing what the query returns.
              </p>
              <pre className="blocked-sql">{output}</pre>
            </div>
          ) : (
            <SqlView
              value={output}
              placeholder="Translated SQL appears here"
              ariaLabel={`${labelFor(target)} SQL output`}
            />
          )}
        </section>
      </main>
      )}

      {warnings.length > 0 && (
        <section className="notes" aria-label="Conversion notes">
          <h2 className="notes-title">
            {warnings.length} conversion {warnings.length === 1 ? 'note' : 'notes'}
          </h2>
          <ul className="notes-list">
            {warnings.map(w => <li key={w} className="note">{w}</li>)}
          </ul>
        </section>
      )}

      <section className="samples" aria-label="Sample queries">
        <h2 className="samples-title">Samples</h2>
        <div className="samples-grid">
          {SAMPLES.map(sample => (
            <button
              key={sample.label}
              type="button"
              className="sample"
              onClick={() => loadSample(sample)}
            >
              <span className="sample-route">
                {labelFor(sample.source)} → {labelFor(sample.target)}
              </span>
              <span className="sample-label">{sample.label}</span>
            </button>
          ))}
        </div>
      </section>

      <footer className="colophon">
        <span>
          Regex-based translation. Review every result before running it against a database.
        </span>
        <span className="colophon-links">
          <a href="https://github.com/Prem-Duvvapu/sqlbridge/issues/new?template=bug_report.md"
            target="_blank" rel="noopener noreferrer">Report a bug</a>
          <a href="https://github.com/Prem-Duvvapu/sqlbridge/issues/new?template=feedback.md"
            target="_blank" rel="noopener noreferrer">Give feedback</a>
        </span>
      </footer>
    </div>
  )
}

export default App
