import { useState, useEffect, useRef } from 'react'

interface Dialect { name: string; label: string }

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

function App() {
  const [sources, setSources] = useState<Dialect[]>([])
  const [source, setSource] = useState('oracle')
  const [target, setTarget] = useState('mysql')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [dark, setDark] = useState(false)
  const [copied, setCopied] = useState(false)
  const outputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    post<{ sources: Dialect[] }>('/dialects').then(d => {
      setSources(d.sources)
      if (d.sources.length > 0) setSource(d.sources[0].name)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  }, [dark])

  function handleConvert() {
    if (!input.trim() || source === target) return
    setBusy(true)
    setWarnings([])
    setCopied(false)
    post<{ output: string; warnings: string[] }>('/convert', { sql: input, source, target })
      .then(d => { setOutput(d.output); setWarnings(d.warnings ?? []) })
      .catch(e => setOutput(`Error: ${e.message}`))
      .finally(() => setBusy(false))
  }

  function handleSwap() {
    const tmp = source; setSource(target); setTarget(tmp)
    setInput(output); setOutput(input)
  }

  function handleCopy() {
    if (!output) return
    navigator.clipboard.writeText(output).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleConvert() }
  }

  const samples: [string, string, string][] = [
    ["SELECT name, NVL(salary, 0), SYSDATE FROM emp WHERE ROWNUM <= 5", 'oracle', 'mysql'],
    ["SELECT * FROM emp LIMIT 5", 'mysql', 'oracle'],
    ["SELECT CONCAT(first_name, ' ', last_name) AS full FROM users", 'mysql', 'oracle'],
  ]

  return (
    <div className="app">
      <header>
        <div className="header-row">
          <div className="logo-area">
            <div className="logo">&#x2194;</div>
            <div>
              <h1>SQLBridge</h1>
              <p className="subtitle">SQL dialect converter</p>
            </div>
          </div>
          <button className="icon-btn" onClick={() => setDark(d => !d)}
            title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label="Toggle theme">
            {dark ? '\u2600' : '\u263E'}
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="direction-picker">
          <select className="dialect-select" value={source} onChange={e => setSource(e.target.value)}>
            {sources.map(d => <option key={d.name} value={d.name}>{d.label}</option>)}
          </select>
          <button className="swap-btn" onClick={handleSwap} title="Swap source and target" aria-label="Swap">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
          </button>
          <select className="dialect-select" value={target} onChange={e => setTarget(e.target.value)}>
            {sources.map(d => <option key={d.name} value={d.name}>{d.label}</option>)}
          </select>
        </div>
        <button className="convert-btn" onClick={handleConvert}
          disabled={busy || !input.trim() || source === target}>
          {busy ? (
            <span className="btn-content">
              <span className="spinner" />
              Converting
            </span>
          ) : (
            <span className="btn-content">
              Convert
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </span>
          )}
        </button>
      </div>

      <div className="panels">
        <div className="panel">
          <div className="panel-header">
            <span className="panel-label">{source}</span>
            <span className="panel-meta">{input.length} chars</span>
          </div>
          <textarea className="editor" placeholder={`Paste your ${source} SQL here\u2026`}
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown} spellCheck={false} />
        </div>
        <div className="panel">
          <div className="panel-header">
            <span className="panel-label">{target}</span>
            <div className="panel-actions">
              <span className="panel-meta">{output.length} chars</span>
              {output && (
                <button className="icon-btn icon-btn-sm" onClick={handleCopy} title={copied ? 'Copied!' : 'Copy to clipboard'}>
                  {copied ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1f883d"
                      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          </div>
          <textarea className="editor output" value={output} readOnly ref={outputRef}
            placeholder="Converted SQL will appear here" spellCheck={false}
            onClick={handleCopy} title="Click to copy" />
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="warnings">
          <div className="warnings-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d29922"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>{warnings.length} warning{warnings.length > 1 ? 's' : ''}</span>
          </div>
          <div className="warnings-list">
            {warnings.map((w, i) => <div key={i} className="warning-tag">{w}</div>)}
          </div>
        </div>
      )}

      <div className="samples">
        <span className="samples-label">Try a sample</span>
        <div className="sample-list">
          {samples.map(([sql, src, tgt]) => (
            <button key={sql} className="sample-btn"
              onClick={() => { setSource(src); setTarget(tgt); setInput(sql); setOutput(''); setWarnings([]) }}>
              <span className="sample-arrow">{src} &rarr; {tgt}</span>
              <span className="sample-sql">{sql.length > 50 ? sql.slice(0, 50) + '\u2026' : sql}</span>
            </button>
          ))}
        </div>
      </div>

      <footer>
        <span><kbd>Ctrl</kbd> + <kbd>Enter</kbd> to convert &middot; click output to copy</span>
        <span className="footer-links">
          <a href="https://github.com/Prem-Duvvapu/sqlbridge/issues/new?template=bug_report.md" target="_blank" rel="noopener">Report bug</a>
          <a href="https://github.com/Prem-Duvvapu/sqlbridge/issues/new?template=feedback.md" target="_blank" rel="noopener">Give feedback</a>
        </span>
      </footer>
    </div>
  )
}

export default App
