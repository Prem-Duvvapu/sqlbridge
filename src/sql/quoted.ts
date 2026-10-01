/** End of a protected span; -1 means unterminated, undefined means ordinary SQL. */
export function specialSpanEnd(sql: string, i: number): number | undefined {
  if (sql.startsWith('/*', i)) {
    let depth = 1
    let j = i + 2
    while (j < sql.length && depth) {
      if (sql.startsWith('/*', j)) { depth++; j += 2 }
      else if (sql.startsWith('*/', j)) { depth--; j += 2 }
      else j++
    }
    return depth ? -1 : j
  }
  if (i > 0 && /[\w$]/.test(sql[i - 1])) return undefined
  const tag = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(sql.slice(i))?.[0]
  if (tag) {
    const end = sql.indexOf(tag, i + tag.length)
    return end < 0 ? -1 : end + tag.length
  }
  if (/^[eE]'/.test(sql.slice(i, i + 2))) {
    let j = i + 2
    while (j < sql.length) {
      if (sql[j] === '\\') { j += 2; continue }
      if (sql[j] === "'") {
        if (sql[j + 1] === "'") { j += 2; continue }
        return j + 1
      }
      j++
    }
    return -1
  }
  return undefined
}
