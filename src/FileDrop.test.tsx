// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, renderHook, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DropOverlay, useFileImport } from './FileDrop'
import { MAX_IMPORT_BYTES } from './fileTransfer'

/** A minimal DragEvent — jsdom doesn't implement DataTransfer. */
function fileDragEvent(type: string, files: File[]) {
  const event = new Event(type, { bubbles: true }) as unknown as {
    dataTransfer: { types: string[]; files: File[] }
    preventDefault: () => void
  }
  event.dataTransfer = { types: ['Files'], files }
  event.preventDefault = vi.fn()
  return event as unknown as Event
}

const sqlFile = (name: string, body: string, size = body.length) => {
  const f = new File([body], name, { type: 'text/plain' })
  Object.defineProperty(f, 'size', { value: size })
  // jsdom's File.text() works, but FileReader.readAsText needs the body — File carries it.
  return f
}

describe('DropOverlay', () => {
  it('is inert until a drag is active', () => {
    const { rerender } = render(<DropOverlay isDragging={false} />)
    expect(screen.getByText('Drop a .sql file to load it').parentElement).not.toHaveAttribute('data-active')
    rerender(<DropOverlay isDragging />)
    expect(screen.getByText('Drop a .sql file to load it').parentElement).toHaveAttribute('data-active')
  })
})

describe('useFileImport', () => {
  it('flips isDragging on file dragenter / dragleave', () => {
    const { result } = renderHook(() => useFileImport({ onText: vi.fn(), onError: vi.fn() }))
    expect(result.current.isDragging).toBe(false)

    act(() => { window.dispatchEvent(fileDragEvent('dragenter', [])) })
    expect(result.current.isDragging).toBe(true)

    act(() => { window.dispatchEvent(fileDragEvent('dragleave', [])) })
    expect(result.current.isDragging).toBe(false)
  })

  it('reads a dropped file and reports its text and name', async () => {
    const onText = vi.fn()
    const { result } = renderHook(() => useFileImport({ onText, onError: vi.fn() }))

    act(() => {
      window.dispatchEvent(fileDragEvent('drop', [sqlFile('q.sql', 'SELECT 1')]))
    })

    await vi.waitFor(() => expect(onText).toHaveBeenCalledWith('SELECT 1', 'q.sql'))
    expect(result.current.isDragging).toBe(false)
  })

  it('rejects a file over the 2 MB cap without reading it', () => {
    const onText = vi.fn()
    const onError = vi.fn()
    renderHook(() => useFileImport({ onText, onError }))

    act(() => {
      window.dispatchEvent(fileDragEvent('drop', [sqlFile('huge.sql', 'x', MAX_IMPORT_BYTES + 1)]))
    })

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('2 MB'))
    expect(onText).not.toHaveBeenCalled()
  })

  it('opens the picker and reads the chosen file', async () => {
    const onText = vi.fn()
    function Harness() {
      const { openPicker, fileInput } = useFileImport({ onText, onError: vi.fn() })
      return <><button onClick={openPicker}>open</button>{fileInput}</>
    }
    render(<Harness />)

    const input = document.querySelector('input[type=file]') as HTMLInputElement
    await userEvent.upload(input, sqlFile('picked.sql', 'SELECT 2'))

    await vi.waitFor(() => expect(onText).toHaveBeenCalledWith('SELECT 2', 'picked.sql'))
  })

  it('ignores drags that carry no files', () => {
    const { result } = renderHook(() => useFileImport({ onText: vi.fn(), onError: vi.fn() }))
    const textDrag = new Event('dragenter', { bubbles: true }) as unknown as { dataTransfer: { types: string[] } }
    textDrag.dataTransfer = { types: ['text/plain'] }
    act(() => { window.dispatchEvent(textDrag as unknown as Event) })
    expect(result.current.isDragging).toBe(false)
  })
})
