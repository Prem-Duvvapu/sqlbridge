/**
 * Map our dialect names onto sql-formatter's language ids. Formatting is dialect-aware:
 * `LIMIT` is a MySQL clause and `FETCH FIRST` an Oracle one, and each is only broken onto
 * its own line by the grammar that knows about it.
 */
const LANGUAGE: Readonly<Record<string, 'plsql' | 'mysql' | 'postgresql' | 'transactsql'>> = {
  oracle: 'plsql',
  mysql: 'mysql',
  postgresql: 'postgresql',
  sqlserver: 'transactsql',
}

export interface FormatResult {
  sql: string
  /** Set when the SQL couldn't be parsed; `sql` is then the untouched input. */
  error?: string
}

/**
 * Pretty-print SQL for the given dialect.
 *
 * sql-formatter is roughly 300 kB — more than half the bundle — and formatting is an
 * on-demand action, so it is imported dynamically the first time someone asks for it
 * rather than shipped on the critical path. The browser caches the chunk after that.
 *
 * Never throws and never loses the input: SQL the formatter can't parse — which includes
 * anything mid-edit — comes back unchanged with a reason, so pressing Format can't
 * destroy what you typed.
 */
export async function format(sql: string, dialect: string): Promise<FormatResult> {
  if (!sql.trim()) return { sql }
  try {
    const { format: formatSql } = await import('sql-formatter')
    return {
      sql: formatSql(sql, {
        language: LANGUAGE[dialect] ?? 'sql',
        keywordCase: 'upper',
        indentStyle: 'standard',
        tabWidth: 2,
        linesBetweenQueries: 1,
      }),
    }
  } catch (e) {
    return { sql, error: e instanceof Error ? e.message : 'Could not parse this SQL' }
  }
}
