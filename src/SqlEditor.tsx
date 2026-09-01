import { useMemo, useRef } from 'react'
import { tokenize } from './highlight'

/**
 * Renders SQL as coloured spans. A trailing newline needs a following character or the
 * browser collapses the last line, which would put the highlight layer one line out of
 * step with the textarea above it.
 */
function Highlighted({ sql }: { sql: string }) {
  const tokens = useMemo(() => tokenize(sql), [sql])
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i} className={`tok tok-${t.kind}`}>{t.text}</span>
      ))}
      {'\n'}
    </>
  )
}

interface SqlEditorProps {
  value: string
  dialect: string
  ariaLabel: string
}

/**
 * Read-only SQL display. No textarea involved, so this is just a coloured <pre>.
 */
export function SqlView({ value, placeholder, ariaLabel }: {
  value: string
  placeholder: string
  ariaLabel: string
}) {
  if (!value) {
    return <div className="editor editor-empty">{placeholder}</div>
  }
  return (
    <pre className="editor editor-view" tabIndex={0} aria-label={ariaLabel}>
      <Highlighted sql={value} />
    </pre>
  )
}

/**
 * Editable SQL with syntax colour.
 *
 * A <textarea> can't render coloured text, so the standard two-layer approach applies: a
 * highlighted <pre> underneath, and a transparent textarea on top holding the real
 * caret and selection. The two only stay aligned if every metric that affects text
 * layout is identical, which is why both layers share the `.editor` class and neither is
 * independently resizable. Scroll is mirrored from the textarea onto the layer below.
 */
export function SqlInput({
  value,
  onChange,
  onKeyDown,
  dialect: _dialect,
  placeholder,
  ariaLabel,
}: SqlEditorProps & {
  onChange: (value: string) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  placeholder: string
}) {
  const layerRef = useRef<HTMLPreElement>(null)

  return (
    <div className="editor-stack">
      <pre className="editor editor-layer" aria-hidden="true" ref={layerRef}>
        <Highlighted sql={value} />
      </pre>
      <textarea
        className="editor editor-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={e => {
          const layer = layerRef.current
          if (!layer) return
          layer.scrollTop = e.currentTarget.scrollTop
          layer.scrollLeft = e.currentTarget.scrollLeft
        }}
        spellCheck={false}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    </div>
  )
}
