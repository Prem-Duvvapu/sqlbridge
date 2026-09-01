import type { RoundTripResult } from './roundTrip'

interface RoundTripPanelProps {
  result: RoundTripResult
  sourceLabel: string
  targetLabel: string
  onClose: () => void
}

/**
 * Shows the outcome of an A→B→A round-trip: a headline, the rules that are *expected* to
 * prevent a clean return, and — for anything else that differs — a diff of the original
 * against what came back.
 */
export function RoundTripPanel({ result, sourceLabel, targetLabel, onClose }: RoundTripPanelProps) {
  if (!result.available) {
    return (
      <section className="round-trip" aria-label="Round-trip check">
        <div className="round-trip-head">
          <span className="round-trip-title">Round-trip unavailable</span>
          <button type="button" className="ghost-button ghost-button-sm" onClick={onClose}>Close</button>
        </div>
        <p className="round-trip-body">{result.unavailableReason}</p>
      </section>
    )
  }

  const onlyLossy = !result.matches && result.diff.changed <= result.lossyRules.length

  return (
    <section className="round-trip" aria-label="Round-trip check">
      <div className="round-trip-head">
        <span className="round-trip-title" data-tone={result.matches ? 'ok' : onlyLossy ? 'expected' : 'check'}>
          {result.matches
            ? `Clean round-trip — ${sourceLabel} → ${targetLabel} → ${sourceLabel} returned the original`
            : onlyLossy
              ? 'Round-trip differs only where expected'
              : `Round-trip differs in ${result.diff.changed} place${result.diff.changed === 1 ? '' : 's'}`}
        </span>
        <button type="button" className="ghost-button ghost-button-sm" onClick={onClose}>Close</button>
      </div>

      <p className="round-trip-note">
        A round-trip is a signal, not a verdict — many correct translations don't return
        the exact original.
      </p>

      {result.lossyRules.length > 0 && (
        <div className="round-trip-lossy">
          <span className="round-trip-subhead">Expected to differ</span>
          <ul>
            {result.lossyRules.map(r => (
              <li key={r.title}><strong>{r.title}</strong> — {r.detail}</li>
            ))}
          </ul>
        </div>
      )}

      {!result.matches && (
        <div className="round-trip-diff">
          <span className="round-trip-subhead">Original vs. what came back</span>
          <div className="diff-body">
            {result.diff.rows.map((row, i) => {
              const del = 'before' in row
                ? <div className="diff-row diff-row-del"><span className="diff-gutter" aria-hidden="true">−</span><span className="diff-line">{row.before.map(p => p.text).join('')}</span></div>
                : null
              const add = 'after' in row
                ? <div className="diff-row diff-row-add"><span className="diff-gutter" aria-hidden="true">+</span><span className="diff-line">{row.after.map(p => p.text).join('')}</span></div>
                : null
              if (row.kind === 'context') {
                return (
                  <div key={i} className="diff-row diff-row-context">
                    <span className="diff-gutter" aria-hidden="true"> </span>
                    <span className="diff-line">{row.text}</span>
                  </div>
                )
              }
              return <div key={i}>{del}{add}</div>
            })}
          </div>
        </div>
      )}
    </section>
  )
}
