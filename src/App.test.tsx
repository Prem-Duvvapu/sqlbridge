// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { encodeShare } from './share'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.location.hash = ''
})

afterEach(() => { window.location.hash = '' })

const editor = (label: RegExp) => screen.getByLabelText(label) as HTMLTextAreaElement

describe('App — first load', () => {
  it('opens on a worked example, already converted', () => {
    render(<App />)
    expect(editor(/oracle sql input/i).value).toContain('NVL(salary, 0)')
    // the seed is converted, so the output panel is populated
    expect(screen.getByLabelText(/mysql sql output/i).textContent).toContain('IFNULL')
  })

  it('renders the direction selects and the Convert button', () => {
    render(<App />)
    expect(screen.getByRole('combobox', { name: /from/i })).toHaveValue('oracle')
    expect(screen.getByRole('combobox', { name: /to/i })).toHaveValue('mysql')
    expect(screen.getByRole('button', { name: /convert/i })).toBeEnabled()
  })
})

describe('App — conversion flow', () => {
  it('converts fresh input on click', async () => {
    render(<App />)
    const input = editor(/oracle sql input/i)
    await userEvent.clear(input)
    await userEvent.type(input, 'SELECT SYSDATE FROM DUAL')
    await userEvent.click(screen.getByRole('button', { name: /convert/i }))

    expect(screen.getByLabelText(/mysql sql output/i).textContent).toContain('NOW()')
  })

  it('shows the confidence-gate panel for a construct it refuses', async () => {
    render(<App />)
    const input = editor(/oracle sql input/i)
    await userEvent.clear(input)
    await userEvent.type(input, 'SELECT * FROM emp CONNECT BY PRIOR id = mgr_id')
    await userEvent.click(screen.getByRole('button', { name: /convert/i }))

    const panel = screen.getByText('Not translated').closest('.blocked') as HTMLElement
    expect(within(panel).getByText(/connect by hierarchical query/i)).toBeInTheDocument()
    expect(within(panel).getByText(/needs a manual rewrite/i)).toBeInTheDocument()
  })

  it('lists conversion notes', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /convert/i }))
    const notes = screen.getByRole('region', { name: /conversion notes/i })
    expect(within(notes).getByText(/ROWNUM/i)).toBeInTheDocument()
  })
})

describe('App — controls', () => {
  it('swaps direction and moves the text across', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /swap/i }))
    expect(screen.getByRole('combobox', { name: /from/i })).toHaveValue('mysql')
    expect(screen.getByRole('combobox', { name: /to/i })).toHaveValue('oracle')
  })

  it('blocks conversion when both dialects match', async () => {
    render(<App />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /to/i }), 'oracle')
    expect(screen.getByRole('button', { name: /convert/i })).toBeDisabled()
    expect(screen.getByText(/pick two different dialects/i)).toBeInTheDocument()
  })

  it('loads a sample query', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /string concatenation/i }))
    expect(editor(/mysql sql input/i).value).toContain('CONCAT(first_name')
  })

  it('opens the Diff view on a converted result', async () => {
    render(<App />)
    const input = editor(/oracle sql input/i)
    await userEvent.clear(input)
    await userEvent.type(input, 'SELECT a FROM emp WHERE ROWNUM <= 3')
    await userEvent.click(screen.getByRole('button', { name: /convert/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Diff' }))

    const diff = screen.getByRole('region', { name: /difference between/i })
    expect(within(diff).getByText(/line.*changed/i)).toBeInTheDocument()
  })

  it('disables the Diff view when the result was blocked', async () => {
    render(<App />)
    const input = editor(/oracle sql input/i)
    await userEvent.clear(input)
    await userEvent.type(input, 'MERGE INTO t USING s ON (t.id = s.id)')
    await userEvent.click(screen.getByRole('button', { name: /convert/i }))
    expect(screen.getByRole('button', { name: 'Diff' })).toBeDisabled()
  })

  it('toggles the theme and persists it', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /switch to dark theme/i }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('sqlbridge:theme')).toBe('dark')
  })

  it('imports text from the file picker into the source panel', async () => {
    render(<App />)
    const file = new File(['SELECT UUID()'], 'in.sql', { type: 'text/plain' })
    await userEvent.upload(document.querySelector('input[type=file]') as HTMLInputElement, file)
    // FileReader is async — wait for the load to land in the textarea.
    expect(await screen.findByDisplayValue('SELECT UUID()')).toBeInTheDocument()
  })

  it('surfaces a notice when an oversized file is picked', async () => {
    render(<App />)
    const big = new File(['x'], 'huge.sql', { type: 'text/plain' })
    Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 })
    await userEvent.upload(document.querySelector('input[type=file]') as HTMLInputElement, big)
    expect(await screen.findByText(/the limit is 2 MB/i)).toBeInTheDocument()
  })
})

describe('App — Clear', () => {
  it('empties both panels, the notes and the blocked state', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /convert/i }))
    expect(screen.getByRole('region', { name: /conversion notes/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(editor(/oracle sql input/i).value).toBe('')
    expect(screen.getByLabelText(/mysql sql output/i)).toHaveTextContent('Translated SQL appears here')
    expect(screen.queryByRole('region', { name: /conversion notes/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
  })
})

describe('App — share links', () => {
  it('copies a link containing the workspace token', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('#s='))
    expect(await screen.findByRole('button', { name: /link copied/i })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('opens the workspace encoded in the URL hash, converted', async () => {
    const token = await encodeShare({ v: 1, input: 'SELECT SYSDATE FROM DUAL', source: 'oracle', target: 'mysql' })
    window.location.hash = `#s=${token}`
    render(<App />)

    expect(await screen.findByDisplayValue('SELECT SYSDATE FROM DUAL')).toBeInTheDocument()
    expect(screen.getByLabelText(/mysql sql output/i).textContent).toContain('NOW()')
    // token is dropped from the address bar once consumed
    expect(window.location.hash).toBe('')
  })

  it('starts fresh with a notice when the hash token is corrupt', async () => {
    window.location.hash = '#s=cGARBAGE!!!'
    render(<App />)
    expect(await screen.findByText(/couldn't be read/i)).toBeInTheDocument()
  })
})

describe('App — persistence', () => {
  it('restores the previous workspace on reload', async () => {
    const first = render(<App />)
    const input = editor(/oracle sql input/i)
    await userEvent.clear(input)
    await userEvent.type(input, 'SELECT 42 FROM DUAL')
    first.unmount()

    render(<App />)
    expect(editor(/oracle sql input/i)).toHaveValue('SELECT 42 FROM DUAL')
  })
})

vi.mock('./format', () => ({
  format: vi.fn(async (sql: string) => ({ sql: sql.toUpperCase() })),
}))

describe('App — format', () => {
  it('reindents both panels through the single Format button', async () => {
    render(<App />)
    const input = editor(/oracle sql input/i)
    await userEvent.clear(input)
    await userEvent.type(input, 'select 1 from dual')
    await userEvent.click(screen.getByRole('button', { name: 'Format' }))
    expect(editor(/oracle sql input/i)).toHaveValue('SELECT 1 FROM DUAL')
  })
})
