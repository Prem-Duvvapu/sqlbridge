/**
 * Workspace persistence.
 *
 * Two storage tiers, because the requirements pull in opposite directions — tabs must
 * stay independent, but reopening the browser must restore the last session:
 *
 *   sessionStorage  per-tab, dies with the tab. Holds this tab's live workspace, so two
 *                   open tabs never overwrite each other and a reload keeps your place.
 *   localStorage    shared, survives browser close. Holds a snapshot of the most
 *                   recently edited tab, used to seed a tab that has no session state.
 *
 * Every access is wrapped: Safari private mode and "block site data" settings throw on
 * access rather than returning null, and the app must still work with zero persistence.
 */

const TAB_KEY = 'sqlbridge:tab'
const LAST_KEY = 'sqlbridge:last'
const THEME_KEY = 'sqlbridge:theme'
const VERSION = 1

export interface Workspace {
  input: string
  output: string
  warnings: string[]
  source: string
  target: string
}

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key)
  } catch {
    return null
  }
}

function write(storage: () => Storage, key: string, value: string): void {
  try {
    storage().setItem(key, value)
  } catch {
    // Storage unavailable or over quota — persistence is a convenience, not a feature.
  }
}

function parseWorkspace(raw: string | null): Workspace | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const w = parsed as Record<string, unknown>
    if (w.v !== VERSION) return null
    return {
      input: typeof w.input === 'string' ? w.input : '',
      output: typeof w.output === 'string' ? w.output : '',
      warnings: Array.isArray(w.warnings) ? w.warnings.filter(x => typeof x === 'string') : [],
      source: typeof w.source === 'string' ? w.source : 'oracle',
      target: typeof w.target === 'string' ? w.target : 'mysql',
    }
  } catch {
    return null
  }
}

/**
 * The workspace this tab should open with: its own session state if it has any,
 * otherwise the last-edited snapshot from a previous browser session. Returns null for
 * a genuine first visit, so the caller can seed a worked example rather than an
 * empty screen.
 */
export function loadWorkspace(): Workspace | null {
  return (
    parseWorkspace(read(() => sessionStorage, TAB_KEY)) ??
    parseWorkspace(read(() => localStorage, LAST_KEY))
  )
}

/** Save to both tiers: this tab's own slot, and the shared "most recent" snapshot. */
export function saveWorkspace(workspace: Workspace): void {
  const payload = JSON.stringify({ v: VERSION, ...workspace })
  write(() => sessionStorage, TAB_KEY, payload)
  write(() => localStorage, LAST_KEY, payload)
}

/**
 * Theme is a device-wide preference, not per-tab. Light is the default; dark applies only
 * when the visitor has picked it here before. (The OS `prefers-color-scheme` is
 * deliberately not consulted — the design is tuned light-first.)
 */
export function loadTheme(): 'light' | 'dark' {
  return read(() => localStorage, THEME_KEY) === 'dark' ? 'dark' : 'light'
}

export function saveTheme(theme: 'light' | 'dark'): void {
  write(() => localStorage, THEME_KEY, theme)
}
