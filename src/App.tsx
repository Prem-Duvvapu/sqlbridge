import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { convert, getSources, getTargetsFor } from './converters'
import type { Workspace } from './persistence'
import { loadTheme, loadWorkspace, saveTheme, saveWorkspace } from './persistence'
import { format } from './format'
import { SqlInput, SqlView } from './SqlEditor'
import { diffSql } from './diff'
import { DiffView } from './DiffView'
import { DropOverlay, useFileImport } from './FileDrop'
import { downloadText, suggestedFilename } from './fileTransfer'
import { buildShareUrl, clearShareToken, decodeShare, encodeShare, readShareToken } from './share'
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

// Feedback links are kept but switched off for now — flip this to true to re-enable.
const FEEDBACK_LINKS_ENABLED = false
const FEEDBACK_LINKS = [
  { label: 'Report a bug', href: 'https://github.com/Prem-Duvvapu/sqlbridge/issues/new?template=bug_report.md' },
  { label: 'Give feedback', href: 'https://github.com/Prem-Duvvapu/sqlbridge/issues/new?template=feedback.md' },
]

const EMPTY_WORKSPACE: Workspace = { input: '', output: '', warnings: [], source: 'oracle', target: 'mysql' }

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
  // A share link overrides whatever this tab had — start it blank and let the effect
  // below fill it in once the token is decoded, rather than flashing the stored workspace.
  const shareToken = useMemo(readShareToken, [])
  const initial = useMemo(
    () => (shareToken ? EMPTY_WORKSPACE : loadWorkspace() ?? seedWorkspace()),
    [shareToken],
  )
  const dialects = useMemo(getSources, [])

  const [source, setSource] = useState(initial.source)
  const [target, setTarget] = useState(initial.target)
  const [input, setInput] = useState(initial.input)
  const [output, setOutput] = useState(initial.output)
  const [warnings, setWarnings] = useState<string[]>(initial.warnings)
  const [blockedReason, setBlockedReason] = useState<string | null>(null)
  const [theme, setTheme] = useState(loadTheme)
  const [copied, setCopied] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [view, setView] = useState<'split' | 'diff'>('split')

  const copyTimer = useRef<number | undefined>(undefined)
  const shareTimer = useRef<number | undefined>(undefined)

  const fileImport = useFileImport({
    onText: text => {
      setInput(text)
      setOutput('')
      setWarnings([])
      setBlockedReason(null)
      setNotice(null)
      setCopied(false)
      setView('split')
    },
    onError: setNotice,
  })

  function downloadOutput() {
    if (output) downloadText(output, suggestedFilename(target))
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    saveTheme(theme)
  }, [theme])

  useEffect(() => {
    saveWorkspace({ input, output, warnings, source, target })
  }, [input, output, warnings, source, target])

  // Resolve a share link on first load, then drop it from the address bar so the URL
  // doesn't keep describing a workspace the user has since edited.
  useEffect(() => {
    if (!shareToken) return
    let cancelled = false
    decodeShare(shareToken).then(shared => {
      if (cancelled) return
      clearShareToken()
      if (!shared) {
        setNotice("That share link couldn't be read — starting fresh.")
        return
      }
      const result = convert(shared.input, shared.source, shared.target)
      setSource(shared.source)
      setTarget(shared.target)
      setInput(shared.input)
      setOutput(result.output)
      setWarnings(result.warnings)
      setBlockedReason(result.blocked?.reason ?? null)
    })
    return () => { cancelled = true }
  }, [shareToken])

  useEffect(() => () => {
    window.clearTimeout(copyTimer.current)
    window.clearTimeout(shareTimer.current)
  }, [])

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
    setNotice(null)
  }

  function copyOutput() {
    if (!output) return
    // clipboard is undefined in insecure contexts and can reject on permission — either
    // way, tell the user rather than doing nothing or throwing from the handler.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(output))
      .then(() => {
        setCopied(true)
        setNotice(null)
        window.clearTimeout(copyTimer.current)
        copyTimer.current = window.setTimeout(() => setCopied(false), 1800)
      })
      .catch(() => setNotice('Could not copy to the clipboard — select the text and copy it manually.'))
  }

  // One Format action for both panels — each side is reindented with its own dialect's
  // grammar. Whichever panel is empty (or blocked) is left alone.
  async function formatSql() {
    try {
      let problem: string | null = null
      if (input.trim()) {
        const r = await format(input, source)
        setInput(r.sql)
        problem = r.error ?? problem
      }
      if (output && blockedReason === null) {
        const r = await format(output, target)
        setOutput(r.sql)
        problem = r.error ?? problem
      }
      setNotice(problem)
    } catch {
      setNotice('The formatter could not load. Check your connection and try again.')
    }
  }

  function clearWorkspace() {
    setInput('')
    setOutput('')
    setWarnings([])
    setBlockedReason(null)
    setNotice(null)
    setCopied(false)
    setView('split')
  }

  async function shareLink() {
    const token = await encodeShare({ v: 1, input, source, target })
    if (!token) {
      setNotice('This SQL is too long to share as a link — use Download instead.')
      return
    }
    const url = buildShareUrl(token)
    try {
      await navigator.clipboard.writeText(url)
      setShareCopied(true)
      setNotice(null)
      window.clearTimeout(shareTimer.current)
      shareTimer.current = window.setTimeout(() => setShareCopied(false), 1800)
    } catch {
      // Clipboard blocked — put the link in the notice so it can still be copied by hand.
      setNotice(url)
    }
  }

  function loadSample(sample: Sample) {
    const result = convert(sample.sql, sample.source, sample.target)
    setSource(sample.source)
    setTarget(sample.target)
    setInput(sample.sql)
    setOutput(result.output)
    setWarnings(result.warnings)
    setBlockedReason(result.blocked?.reason ?? null)
    setNotice(null)
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
    <div
      className="app"
      data-source={source}
      data-target={target}
      data-dragging={fileImport.isDragging || undefined}
    >
      {fileImport.fileInput}
      <DropOverlay isDragging={fileImport.isDragging} />

      <header className="masthead">
        <div className="wordmark">
          <span className="wordmark-glyph" aria-hidden="true">⇌</span>
          <span className="wordmark-text">SQLBridge</span>
        </div>
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
      {notice && (
        <p className="notice" role="status">{notice}</p>
      )}

      <div className="panel-toolbar">
        <div className="panel-toolbar-actions">
          <button
            type="button"
            className="ghost-button ghost-button-sm"
            onClick={formatSql}
            disabled={!input.trim() && !output}
            title="Reindent both panels across multiple lines"
          >
            Format
          </button>
          <button
            type="button"
            className="ghost-button ghost-button-sm"
            onClick={clearWorkspace}
            disabled={!input && !output}
            title="Empty both panels"
          >
            Clear
          </button>
          <button
            type="button"
            className="ghost-button ghost-button-sm"
            onClick={shareLink}
            disabled={!input.trim()}
            title="Copy a link that reopens this SQL and direction"
          >
            {shareCopied ? 'Link copied' : 'Share'}
          </button>
        </div>
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
      </div>

      {showDiff && diff ? (
        <DiffView
          diff={diff}
          sourceLabel={labelFor(source)}
          targetLabel={labelFor(target)}
          onCopy={copyOutput}
          onDownload={downloadOutput}
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
                onClick={fileImport.openPicker}
                title="Load SQL from a .sql or .txt file"
              >
                Open file
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
                onClick={downloadOutput}
                disabled={!output}
                title="Save the translated SQL as a .sql file"
              >
                Download
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
          {FEEDBACK_LINKS.map(link => (
            FEEDBACK_LINKS_ENABLED ? (
              <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">
                {link.label}
              </a>
            ) : (
              <span key={link.label} className="colophon-link-disabled" aria-disabled="true">
                {link.label}
              </span>
            )
          ))}
        </span>
      </footer>
    </div>
  )
}

export default App
