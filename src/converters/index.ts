import type { Converter, ConversionNote, ConvertResult, Dialect, StatementResult } from './types'
import { oracleToMysql } from './oracleToMysql'
import { mysqlToOracle } from './mysqlToOracle'
import { ruleForBlockedReason, ruleForWarning } from './rules'
import { joinStatements, splitStatements, type Statement } from '../sql/split'

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

const DELIMITER_LINE = /^\s*DELIMITER\b/i

/**
 * Convert a whole script between dialects. Never throws: an unknown pair or a bug inside
 * a converter both come back as an error result the UI can render.
 *
 * The script is split into statements, each converted on its own, then re-joined with the
 * original whitespace and terminators. A statement the confidence gate refuses passes
 * through unchanged; if the rest of the script converted, it gets a `-- SQLBridge:` note
 * so it's obvious in the output which lines still need work.
 */
export function convert(sql: string, source: string, target: string): ConvertResult {
  const converter = REGISTRY.get(key(source, target))
  if (!converter) {
    const msg = `No converter available for ${source} -> ${target}`
    return { output: `Error: ${msg}`, warnings: [msg], notes: [], statements: [] }
  }
  try {
    return convertScript(sql, converter)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return {
      output: sql,
      warnings: [`Conversion hit an internal error and stopped (${detail}). Your SQL is shown unchanged — nothing was translated.`],
      notes: [],
      statements: [],
    }
  }
}

function convertScript(script: string, converter: Converter): ConvertResult {
  const statements = splitStatements(script)

  type Piece = { statement: Statement; result?: StatementResult; passthrough?: string }
  const pieces: Piece[] = []

  for (const statement of statements) {
    const body = statement.sql.trim()
    if (body === '') continue // whitespace / comment-only — dropped from the translation
    if (DELIMITER_LINE.test(body)) {
      pieces.push({ statement, passthrough: statement.sql })
      continue
    }
    const conversion = converter.convert(statement.sql)
    pieces.push({
      statement,
      result: {
        index: pieces.filter(p => p.result).length,
        input: statement.sql,
        output: conversion.output,
        warnings: conversion.warnings,
        blocked: conversion.blocked,
      },
    })
  }

  const results = pieces.map(p => p.result).filter((r): r is StatementResult => r !== undefined)
  if (results.length === 0) return { output: script.trim(), warnings: [], notes: [], statements: [] }

  const notes: ConversionNote[] = results.flatMap(r =>
    r.warnings.flatMap(message => {
      const rule = ruleForWarning(message)
      return rule ? [{ rule, message, statement: r.index }] : []
    }),
  )

  const anyTranslated = results.some(r => !r.blocked)
  // Only annotate a refused statement when it sits among translated ones — a lone refused
  // query keeps today's behaviour, where the UI shows the "not translated" panel instead.
  const annotateBlocked = anyTranslated && results.length > 1

  const parts = pieces.map(p => {
    if (p.passthrough !== undefined) return { statement: p.statement, sql: p.passthrough }
    const r = p.result!
    if (r.blocked && annotateBlocked) {
      return {
        statement: p.statement,
        sql: `-- SQLBridge: not translated — ${r.blocked.reason} (needs a manual rewrite)\n${r.output}`,
      }
    }
    return { statement: p.statement, sql: r.output }
  })

  const everyStatementBlocked = results.every(r => r.blocked)
  const blockedReason = everyStatementBlocked ? results[0].blocked : undefined
  return {
    output: joinStatements(parts).trim(),
    // de-duplicated for the summary: a 40-statement script shouldn't list
    // "Converted NVL to IFNULL" forty times.
    warnings: [...new Set(results.flatMap(r => r.warnings))],
    notes,
    statements: results,
    blocked: blockedReason && { ...blockedReason, rule: ruleForBlockedReason(blockedReason.reason) },
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
export type {
  Converter, ConversionNote, ConvertResult, Dialect, StatementConversion, StatementResult,
} from './types'
export { RULES, type Rule, type RuleSeverity } from './rules'
