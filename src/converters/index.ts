import type { Converter, ConvertResult, Dialect } from './types'
import { oracleToMysql } from './oracleToMysql'
import { mysqlToOracle } from './mysqlToOracle'

/**
 * Every conversion direction the app supports. Adding a dialect pair means writing one
 * more `Converter` and listing it here — nothing else needs to change.
 */
const CONVERTERS: readonly Converter[] = [oracleToMysql, mysqlToOracle]

const LABELS: Readonly<Record<string, string>> = {
  oracle: 'Oracle',
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  sqlserver: 'SQL Server',
}

const key = (source: string, target: string) => `${source.toLowerCase()}->${target.toLowerCase()}`

const REGISTRY: ReadonlyMap<string, Converter> = new Map(
  CONVERTERS.map(c => [key(c.source, c.target), c]),
)

function label(name: string): string {
  return LABELS[name] ?? name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * Convert `sql` between dialects. Never throws: an unknown pair or a bug inside a
 * converter both come back as an error result the UI can render.
 */
export function convert(sql: string, source: string, target: string): ConvertResult {
  const converter = REGISTRY.get(key(source, target))
  if (!converter) {
    const msg = `No converter available for ${source} -> ${target}`
    return { output: `Error: ${msg}`, warnings: [msg] }
  }
  try {
    return converter.convert(sql)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return {
      output: sql,
      warnings: [`Conversion hit an internal error and stopped (${detail}). Your SQL is shown unchanged — nothing was translated.`],
    }
  }
}

/** Dialects that can be used as a conversion source, in registration order. */
export function getSources(): Dialect[] {
  const seen = new Set<string>()
  return CONVERTERS.flatMap(c =>
    seen.has(c.source) ? [] : (seen.add(c.source), [{ name: c.source, label: label(c.source) }]),
  )
}

/** Dialects reachable from `source`. */
export function getTargetsFor(source: string): Dialect[] {
  return CONVERTERS
    .filter(c => c.source.toLowerCase() === source.toLowerCase())
    .map(c => ({ name: c.target, label: label(c.target) }))
}

export { oracleToMysql, mysqlToOracle }
export type { Converter, ConvertResult, Dialect }
