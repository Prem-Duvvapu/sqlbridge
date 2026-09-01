import { Fragment } from 'react'
import type { DiffPiece, SqlDiff } from './diff'

function Line({ pieces }: { pieces: DiffPiece[] }) {
  return (
    <span className="diff-line">
      {pieces.map((piece, i) =>
        piece.mark === 'same'
          ? <Fragment key={i}>{piece.text}</Fragment>
          : <span key={i} className={`diff-tok diff-tok-${piece.mark}`}>{piece.text}</span>,
      )}
    </span>
  )
}

interface DiffViewProps {
  diff: SqlDiff
  sourceLabel: string
  targetLabel: string
  onCopy: () => void
  copied: boolean
}

/**
 * Unified diff of the source SQL against its translation. Removed lines carry the source
 * dialect's colour, added lines the target's; within a changed line pair, only the tokens
 * the converter actually rewrote are tinted.
 */
export function DiffView({ diff, sourceLabel, targetLabel, onCopy, copied }: DiffViewProps) {
  return (
    <section className="diff" aria-label={`Difference between ${sourceLabel} and ${targetLabel}`}>
      <div className="diff-head">
        <span className="diff-summary">
          {diff.changed === 0
            ? 'Identical — the translation made no changes'
            : `${diff.changed} line${diff.changed === 1 ? '' : 's'} changed`}
        </span>
        <div className="diff-head-right">
          <span className="diff-legend">
            <span className="diff-swatch diff-swatch-del" aria-hidden="true" />
            {sourceLabel}
            <span className="diff-swatch diff-swatch-add" aria-hidden="true" />
            {targetLabel}
          </span>
          <button
            type="button"
            className="ghost-button ghost-button-sm"
            onClick={onCopy}
            disabled={diff.changed === 0}
          >
            {copied ? 'Copied' : 'Copy result'}
          </button>
        </div>
      </div>

      <div className="diff-body">
        {diff.rows.map((row, i) => {
          switch (row.kind) {
            case 'context':
              return (
                <div key={i} className="diff-row diff-row-context">
                  <span className="diff-gutter" aria-hidden="true"> </span>
                  <span className="diff-line">{row.text}</span>
                </div>
              )
            case 'del':
              return (
                <div key={i} className="diff-row diff-row-del">
                  <span className="diff-gutter" aria-hidden="true">−</span>
                  <Line pieces={row.before} />
                </div>
              )
            case 'add':
              return (
                <div key={i} className="diff-row diff-row-add">
                  <span className="diff-gutter" aria-hidden="true">+</span>
                  <Line pieces={row.after} />
                </div>
              )
            case 'replace':
              return (
                <Fragment key={i}>
                  <div className="diff-row diff-row-del">
                    <span className="diff-gutter" aria-hidden="true">−</span>
                    <Line pieces={row.before} />
                  </div>
                  <div className="diff-row diff-row-add">
                    <span className="diff-gutter" aria-hidden="true">+</span>
                    <Line pieces={row.after} />
                  </div>
                </Fragment>
              )
          }
        })}
      </div>
    </section>
  )
}
