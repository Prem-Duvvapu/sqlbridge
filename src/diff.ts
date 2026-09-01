import { tokenize } from './highlight'

/**
 * Line-level diff of two SQL strings, with token-level highlighting inside changed lines.
 *
 * The translator's rewrites are mostly in place — same line structure, a function name
 * swapped here, a clause moved there — so a plain line diff would just say "this line
 * changed" and leave you hunting for the edit. Diffing the tokens within each changed
 * line pair shows exactly what the converter touched.
 */

export type Mark = 'same' | 'add' | 'del'

export interface DiffPiece {
  text: string
  mark: Mark
}

export type DiffRow =
  | { kind: 'context'; text: string }
  | { kind: 'replace'; before: DiffPiece[]; after: DiffPiece[] }
  | { kind: 'add'; after: DiffPiece[] }
  | { kind: 'del'; before: DiffPiece[] }

export interface SqlDiff {
  rows: DiffRow[]
  /** Number of added, removed and replaced lines — drives the summary line. */
  changed: number
}

type Op<T> = { type: 'equal' | 'del' | 'ins'; value: T }

/**
 * Longest-common-subsequence diff. O(n·m) time and space, which is fine for SQL: even a
 * large migration script is a few thousand lines, and a line is a few hundred tokens.
 */
function lcsDiff<T>(a: readonly T[], b: readonly T[]): Op<T>[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const ops: Op<T>[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', value: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', value: a[i] })
      i++
    } else {
      ops.push({ type: 'ins', value: b[j] })
      j++
    }
  }
  while (i < n) ops.push({ type: 'del', value: a[i++] })
  while (j < m) ops.push({ type: 'ins', value: b[j++] })
  return ops
}

/** Coalesce neighbouring pieces that carry the same mark, so the DOM stays small. */
function mergePieces(pieces: DiffPiece[]): DiffPiece[] {
  const out: DiffPiece[] = []
  for (const piece of pieces) {
    const last = out[out.length - 1]
    if (last && last.mark === piece.mark) last.text += piece.text
    else out.push({ ...piece })
  }
  return out
}

function diffTokens(before: string, after: string): { before: DiffPiece[]; after: DiffPiece[] } {
  const a = tokenize(before).map(t => t.text)
  const b = tokenize(after).map(t => t.text)
  const before$: DiffPiece[] = []
  const after$: DiffPiece[] = []

  for (const op of lcsDiff(a, b)) {
    if (op.type === 'equal') {
      before$.push({ text: op.value, mark: 'same' })
      after$.push({ text: op.value, mark: 'same' })
    } else if (op.type === 'del') {
      before$.push({ text: op.value, mark: 'del' })
    } else {
      after$.push({ text: op.value, mark: 'add' })
    }
  }

  return { before: mergePieces(before$), after: mergePieces(after$) }
}

export function diffSql(before: string, after: string): SqlDiff {
  try {
    return computeDiff(before, after)
  } catch {
    // Degrade to a plain two-block diff rather than breaking the Diff view.
    if (before === after) {
      return { rows: before.split('\n').map(text => ({ kind: 'context' as const, text })), changed: 0 }
    }
    return {
      rows: [
        ...before.split('\n').map(line => ({ kind: 'del' as const, before: [{ text: line, mark: 'del' as const }] })),
        ...after.split('\n').map(line => ({ kind: 'add' as const, after: [{ text: line, mark: 'add' as const }] })),
      ],
      changed: before.split('\n').length + after.split('\n').length,
    }
  }
}

function computeDiff(before: string, after: string): SqlDiff {
  const ops = lcsDiff(before.split('\n'), after.split('\n'))
  const rows: DiffRow[] = []
  let changed = 0

  let k = 0
  while (k < ops.length) {
    if (ops[k].type === 'equal') {
      rows.push({ kind: 'context', text: ops[k].value })
      k++
      continue
    }

    // A run of removed lines followed by a run of added lines is a block of edits.
    // Pair them up by position and diff each pair's tokens; anything left over is a
    // pure insertion or deletion.
    const dels: string[] = []
    const adds: string[] = []
    while (k < ops.length && ops[k].type === 'del') dels.push(ops[k++].value)
    while (k < ops.length && ops[k].type === 'ins') adds.push(ops[k++].value)

    const paired = Math.min(dels.length, adds.length)
    for (let p = 0; p < paired; p++) {
      const { before: bf, after: af } = diffTokens(dels[p], adds[p])
      rows.push({ kind: 'replace', before: bf, after: af })
      changed++
    }
    for (let p = paired; p < dels.length; p++) {
      rows.push({ kind: 'del', before: [{ text: dels[p], mark: 'del' }] })
      changed++
    }
    for (let p = paired; p < adds.length; p++) {
      rows.push({ kind: 'add', after: [{ text: adds[p], mark: 'add' }] })
      changed++
    }
  }

  return { rows, changed }
}
