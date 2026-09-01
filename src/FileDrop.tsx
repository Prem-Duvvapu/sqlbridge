import { useCallback, useEffect, useRef, useState } from 'react'
import { checkImportSize } from './fileTransfer'

interface FileImportOptions {
  onText: (text: string, filename: string) => void
  onError: (message: string) => void
}

interface FileImport {
  /** True while a file is being dragged over the window. */
  isDragging: boolean
  /** Opens the OS file picker — wire this to a visible button. */
  openPicker: () => void
  /** Hidden <input type="file">. Render it once, anywhere inside the app. */
  fileInput: React.ReactElement
}

/**
 * File import by drag-and-drop or picker.
 *
 * Drag listeners are on `window` so a drop anywhere in the app works, and a depth counter
 * handles the dragenter/dragleave that fire for every child element crossed. Only
 * file drags flip `isDragging` — dragging selected text around shouldn't dim the app.
 */
export function useFileImport({ onText, onError }: FileImportOptions): FileImport {
  const [isDragging, setDragging] = useState(false)
  const depth = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const read = useCallback((file: File) => {
    const tooBig = checkImportSize(file.name, file.size)
    if (tooBig) { onError(tooBig); return }
    const reader = new FileReader()
    reader.onload = () => onText(String(reader.result ?? ''), file.name)
    reader.onerror = () => onError(`Could not read "${file.name}".`)
    reader.readAsText(file)
  }, [onText, onError])

  useEffect(() => {
    const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return
      depth.current += 1
      setDragging(true)
    }
    const onOver = (e: DragEvent) => {
      if (carriesFiles(e)) e.preventDefault() // allow the drop
    }
    const onLeave = () => {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setDragging(false)
      const file = e.dataTransfer?.files[0]
      if (file) read(file)
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [read])

  const openPicker = useCallback(() => inputRef.current?.click(), [])

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".sql,.txt,text/plain,text/*"
      hidden
      onChange={e => {
        const file = e.target.files?.[0]
        if (file) read(file)
        e.target.value = '' // let the same file be re-picked
      }}
    />
  )

  return { isDragging, openPicker, fileInput }
}

/** Full-window cue shown while a file is being dragged in. */
export function DropOverlay({ isDragging }: { isDragging: boolean }) {
  return (
    <div className="drop-overlay" data-active={isDragging || undefined} aria-hidden="true">
      <div className="drop-overlay-card">Drop a .sql file to load it</div>
    </div>
  )
}
