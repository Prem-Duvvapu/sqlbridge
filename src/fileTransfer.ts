/** Reading a multi-MB dump into a textarea and re-tokenising it on every keystroke locks
 *  the tab. 2 MB is generous for a migration script and safe for the browser. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024

/** Returns an error message if the file is too big to import, or null if it's fine. */
export function checkImportSize(name: string, bytes: number): string | null {
  if (bytes <= MAX_IMPORT_BYTES) return null
  const mb = (bytes / 1024 / 1024).toFixed(1)
  return `"${name}" is ${mb} MB — the limit is 2 MB. Open it in an editor and paste the part you need.`
}

/** A plausible download name for the translated SQL, e.g. "sqlbridge-mysql.sql". */
export function suggestedFilename(dialect: string): string {
  const slug = dialect.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sql'
  return `sqlbridge-${slug}.sql`
}

/**
 * Hand the user a text file to save. Uses a temporary object URL and an <a download>.
 *
 * Note: the Artifact preview sandbox blocks downloads a page starts itself, so this is
 * inert there — it works on the deployed site.
 */
export function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/sql;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
