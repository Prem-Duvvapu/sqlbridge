import { useEffect, useLayoutEffect, useState } from 'react'

export interface TourStep {
  /** CSS selector for the element this step points at. */
  target: string
  title: string
  body: string
}

interface TourProps {
  steps: readonly TourStep[]
  onFinish: () => void
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

const SPOTLIGHT_PAD = 8
const TOOLTIP_WIDTH = 320
const VIEWPORT_MARGIN = 12

function measure(selector: string): Rect | null {
  const el = document.querySelector(selector)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

/**
 * A minimal, dependency-free product tour: a dimmed overlay with a spotlight cutout
 * (one box with a huge `box-shadow` — no four-quadrant mask divs needed) around the
 * current step's target, plus a tooltip with Back/Next/Skip. Steps are addressed by CSS
 * selector so this component stays generic; callers supply `data-tour="…"` hooks.
 *
 * A missing target (wrong selector, or the element isn't mounted for the current view)
 * degrades to a centered tooltip with no spotlight rather than throwing — consistent
 * with the rest of the app's "never blank the page" error handling.
 */
export function Tour({ steps, onFinish }: TourProps) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const step = steps[index]
  const isLast = index === steps.length - 1

  useLayoutEffect(() => {
    if (!step) return
    function update() {
      setRect(measure(step.target))
    }
    update()
    // jsdom (unit tests) has no layout engine and no scrollIntoView implementation on
    // some versions — guard it the same way the rest of the app treats optional DOM APIs.
    document.querySelector(step.target)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [step])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { onFinish(); return }
      if (e.key === 'ArrowRight') setIndex(i => Math.min(i + 1, steps.length - 1))
      if (e.key === 'ArrowLeft') setIndex(i => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onFinish, steps.length])

  if (!step) return null

  const spotlightStyle = rect
    ? {
        top: rect.top - SPOTLIGHT_PAD,
        left: rect.left - SPOTLIGHT_PAD,
        width: rect.width + SPOTLIGHT_PAD * 2,
        height: rect.height + SPOTLIGHT_PAD * 2,
      }
    : null

  const tooltipStyle = (() => {
    if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' as const }
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.left),
      window.innerWidth - TOOLTIP_WIDTH - VIEWPORT_MARGIN,
    )
    const spaceBelow = window.innerHeight - (rect.top + rect.height)
    if (spaceBelow > 180) {
      return { top: rect.top + rect.height + SPOTLIGHT_PAD + 12, left }
    }
    return { bottom: window.innerHeight - rect.top + SPOTLIGHT_PAD + 12, left }
  })()

  return (
    <div className="tour" role="dialog" aria-label={`Tour: ${step.title}`} aria-modal="true">
      <div className="tour-overlay" onClick={onFinish} />
      {spotlightStyle && <div className="tour-spotlight" style={spotlightStyle} />}
      <div className="tour-tooltip" style={tooltipStyle}>
        <div className="tour-tooltip-head">
          <span className="tour-step-count">{index + 1} / {steps.length}</span>
          <button type="button" className="tour-skip" onClick={onFinish}>Skip</button>
        </div>
        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        <div className="tour-tooltip-actions">
          <button
            type="button"
            className="ghost-button ghost-button-sm"
            onClick={() => setIndex(i => i - 1)}
            disabled={index === 0}
          >
            Back
          </button>
          <button
            type="button"
            className="ghost-button ghost-button-sm tour-primary"
            onClick={() => (isLast ? onFinish() : setIndex(i => i + 1))}
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
