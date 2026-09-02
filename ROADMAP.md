# SQLBridge — six-feature roadmap

Approved plan for the next round of work. Tick items off as each phase lands, the way
`MIGRATION.md` tracked the Spring Boot → React migration.

**Status:** in progress. ✅ 1 (drag-drop), ✅ 2 (shareable URL), ✅ A + core of 3
(splitter + multi-statement), ✅ B (rule catalogue), ✅ 6 (round-trip verify — "Check
round-trip" button, panel, CSS, `roundTrip.test.ts`; see RCA-005 for a catalogue rule
that was unreachable until this landed). Remaining: 5 (DDL depth), 4 (dedicated Explain
view — optional, B already shows the "why"), 3's per-statement notes grouping.

## Context

SQLBridge is now a single client-side React app (Oracle ↔ MySQL, static deploy on
Vercel). The migration is complete: 91 tests green, converters ported to
`src/converters/`, plus formatter, syntax highlighting, per-tab persistence and a
just-finished diff view.

What exists today handles **one statement at a time**, tells you *that* it changed
something but not *why*, and gives you no way to share a conversion or feed it a real
file. The six features below close that gap and move the tool from "paste a query" to
"work through a migration".

PostgreSQL is explicitly **out of scope** for this round.

### Decisions taken

| Question | Decision |
|---|---|
| Gated statement inside a script | **Convert the rest.** Gate per statement; the flagged one passes through unchanged and is marked. Changes today's all-or-nothing behavior. |
| Explain mode depth | **Full**: rule catalogue + span anchoring, via a `Rewriter` refactor. |
| Round-trip trigger | **On demand**, via a Verify button. |

---

## Two foundational changes

Four of the six features sit on top of these. Doing them first avoids building the same
thing twice.

### A. Statement splitter → multi-statement conversion — ✅ done

Shipped: `src/sql/split.ts` (`splitStatements` / `joinStatements`), the
`StatementConversion` / `StatementResult` / `ConvertResult` split in
`src/converters/types.ts`, and `convertScript()` in `src/converters/index.ts` (split →
convert each → re-join with original whitespace + terminators; refused statements get a
`-- SQLBridge: not translated` note when the rest converted; a lone refused query keeps
the whole-script "blocked" panel). Confidence gate extended to `CREATE
PROCEDURE|FUNCTION|TRIGGER|PACKAGE` and anonymous `DECLARE`/`BEGIN` blocks (both
directions). `App.tsx` shows a statement count in the source panel meta. 25 splitter
tests + 7 multi-statement conversion tests + `source-hygiene.test.ts`.

Still to do under **3**: notes grouped per statement (currently flattened + de-duped),
inline per-statement markers in the diff view.

---
Original design notes:

**New:** `src/sql/split.ts`

```ts
export interface Statement {
  sql: string          // the statement itself, no terminator
  leading: string      // whitespace + comments before it
  terminator: string   // ';' or '' (or a custom DELIMITER)
  index: number
  line: number         // 1-based, for error messages
}
export function splitStatements(script: string): Statement[]
export function joinStatements(parts: { statement: Statement; sql: string }[]): string
```

Splitting on `;` is only correct if the scanner understands where `;` *doesn't*
terminate. It must respect:

- single-quoted strings, including `''` escapes
- double-quoted and backtick-quoted identifiers
- `--` line comments and `/* */` block comments
- **PL/SQL blocks** — `DECLARE`/`BEGIN` … `END;` nest, and their internal semicolons are
  not terminators. Track `BEGIN`/`CASE`/`END` depth; only a depth-0 `;` terminates.
  Oracle's lone `/` on a line also terminates a block.
- **MySQL `DELIMITER //`** — changes the terminator for subsequent statements.

**Invariant (tested):** `joinStatements` of an unmodified split reproduces the input byte
for byte. Nothing is silently dropped.

**Safety valve:** if the scanner ends in an unbalanced state (unterminated string, open
block), fall back to treating the whole input as one statement rather than guessing.

**Model change** in `src/converters/types.ts`:

```ts
export interface StatementResult {
  index: number
  input: string
  output: string
  warnings: Warning[]
  blocked?: { reason: string }
}
export interface ConvertResult {
  output: string                  // joined script
  statements: StatementResult[]
  warnings: Warning[]             // flattened, for the summary
  blockedCount: number
}
```

The current per-statement logic in `oracleToMysql.ts` / `mysqlToOracle.ts` becomes
`convertStatement()`; the exported `convert()` splits → maps → joins. The confidence gate
moves inside `convertStatement`, giving the per-statement behavior decided above.

**Files:** `src/sql/split.ts` (+ test), `src/converters/types.ts`,
`src/converters/{oracleToMysql,mysqlToOracle,index}.ts`, `src/App.tsx`.

### B. Rule catalogue — ✅ done (scoped)

Shipped `src/converters/rules.ts`: a `RULES` catalogue — one entry per rewrite and per
gate refusal, each with `id`, `title`, a one-to-two-sentence `detail` ("why"),
`severity` (`info` / `caution` / `blocked`), and `roundTripLossy` where A→B→A is expected
to differ. `ruleForWarning()` / `ruleForBlockedReason()` map the converters' existing
warning strings and blocked reasons onto rules — **no converter bodies changed**, so all
73 converter tests held.

`ConvertResult` gained `notes: ConversionNote[]` (`{ rule, message, statement }`) and
`blocked.rule`. `App.tsx`'s notes list now shows each rule's "why" line and colours the
bullet by severity.

**Deviation from the original plan:** the `Rewriter` class with per-rewrite output-span
tracking was *not* built — it would have rewritten every `.replace` in both converters
(high risk) for a feature (span highlighting in Explain mode) that can be approximated by
re-finding the rewritten token. The catalogue + `notes` plumbing delivers what 4/5/6
actually need. Span tracking can come back as its own change if Explain mode wants it.

Original design notes:

**New:** `src/converters/rules.ts`, `src/converters/rewriter.ts`

Today each rewrite is a bare `s.replace(...)` followed by a hand-written
`warnings.push('Converted X to Y')`. The message is a loose string with no identity, no
"why", and no idea where in the output it applied. Explain mode, DDL rules and
round-trip all want those three things.

```ts
// rules.ts — the catalogue, one entry per rewrite
export interface Rule {
  id: string                 // 'oracle→mysql/nvl-to-ifnull'
  title: string              // 'NVL → IFNULL'
  message: string            // the existing short warning text
  detail: string             // the "why", 1–2 sentences
  severity: 'info' | 'caution' | 'blocked'
  roundTripLossy?: boolean   // feeds the Verify panel
}

// rewriter.ts
class Rewriter {
  apply(rule: Rule, pattern: RegExp, replacement: string): this
  applyFn(rule: Rule, pattern: RegExp, fn: (...groups) => string): this
  flag(rule: Rule): this            // warn without rewriting
  result(): { output: string; warnings: Warning[] }
}
```

`apply` runs the replace and, when anything actually changed, records the rule plus the
**output** spans it wrote (computed by tracking match offsets and the running length
delta). A `Warning` becomes:

```ts
export interface Warning {
  rule: Rule
  spans: { start: number; end: number }[]   // offsets into that statement's output
  statement: number
}
```

Each converter is rewritten as an ordered chain of `apply` calls. **Ordering stays
exactly as it is today** — it is load-bearing (`TRUNC(SYSDATE)` before bare `SYSDATE`,
`OFFSET…FETCH` before standalone `FETCH`), and the existing 63 converter tests are the
proof the refactor didn't move anything.

**Files:** `src/converters/rules.ts`, `src/converters/rewriter.ts` (+ tests), both
converters, `src/converters/types.ts`.

---

## The six features

### 1. Drag-and-drop file (+ download) — ✅ done

- `src/FileDrop.tsx` — `useFileImport` hook (window drag listeners + a depth counter for
  child dragenter/leave, files-only) and a `DropOverlay`. `src/fileTransfer.ts` —
  `checkImportSize` (2 MB cap), `suggestedFilename`, `downloadText` (`Blob` + `<a
  download>`; inert in the Artifact sandbox, fine on the deployed site).
- **Open file** button in the source panel head; hidden `<input type=file>` accepts
  `.sql` / `.txt` / `text/*`. **Download** button in the target panel head and the diff
  head.
- App-wide dashed overlay on file drag; the source panel border lights up.
- `App.tsx`: `formatError` state renamed to `notice` — it's now the shared inline-notice
  channel (format, copy, and file errors).
- Tests: `src/fileTransfer.test.ts` (size guard, filename slugging).

### 2. Shareable URL — ✅ done

- `src/share.ts` — `{ v: 1, input, source, target }` (not the output) → JSON →
  `deflate-raw` → base64url, with a one-char scheme prefix (`c`/`r`) and an
  uncompressed fallback where `CompressionStream` is missing. No new dependency.
- Token lives in the **hash** (`#s=…`) — never sent to the server, so shared SQL stays
  out of Vercel's logs. Refused over 8000 chars ("too long — use Download").
- Load precedence: **hash → sessionStorage → localStorage → seed.** A share link starts
  the tab blank (`EMPTY_WORKSPACE`) so the stored workspace never flashes first; the
  decoded link fills it and auto-converts. `clearShareToken()` drops the hash once
  consumed.
- **Share** button in the toolbar (Format · Clear · Share); copies the link, falls back
  to showing it in the notice if the clipboard is blocked.
- Tests: `src/share.test.ts` (round-trip, compression, URL-safety, size cap, fallback,
  garbage), plus App-level share flow tests.

### 3. Multi-statement / script handling — *depends on A*

- UI: statement count in the panel meta (`3 statements · 412 chars`).
- Notes group under statement headings; a gated statement gets an inline marker in the
  output rather than replacing the whole result.
- The diff view already operates on the joined text, so it needs no change.
- **Files:** as listed under **A**, plus `src/App.tsx`, `src/DiffView.tsx` (statement
  separators only).

### 4. Explain mode — *depends on B*

- A third view tab beside **Split** and **Diff**.
- Left: the translated SQL with each rewritten span underlined. Right: the list of rules
  that fired, each with title, detail, severity chip, and a round-trip note.
- Hovering or focusing a rule highlights its spans; clicking a span scrolls to its rule.
  Keyboard reachable, not hover-only.
- **Files:** `src/ExplainView.tsx`, `src/App.tsx`, `src/App.css`.

### 5. DDL depth — *depends on A + B*

New rules authored in the catalogue shape, with tests per row:

| Oracle | MySQL |
|---|---|
| `GENERATED … AS IDENTITY` | `AUTO_INCREMENT` |
| sequence + trigger idiom | `AUTO_INCREMENT` (flag — not mechanically safe) |
| `DEFAULT SYSDATE` | `DEFAULT CURRENT_TIMESTAMP` |
| `NUMBER(1)` as boolean | `TINYINT(1)` (flag — ambiguous) |
| `COMMENT ON COLUMN t.c IS '…'` | folded into the column's inline `COMMENT` |
| `TABLESPACE` / `ORGANIZATION` / `ENABLE` / storage clauses | stripped + flagged |
| `ENGINE=InnoDB DEFAULT CHARSET=…` | stripped for Oracle |
| `UNSIGNED` | widen the type + flag |
| `ON UPDATE CURRENT_TIMESTAMP` | flag — needs a trigger in Oracle |
| `ENUM(…)` | `VARCHAR2(n)` + `CHECK` constraint |
| — | `AUTO_INCREMENT` alone, no equivalent yet emitted — flag (RCA-006) |
| nested `DECODE` / nested `ROWNUM` pagination that half-applies | `blocked`, not broken output — the rules exist but currently mis-fire (RCA-006 audit) |

`COMMENT ON` folding reads one statement and edits another, which is why it needs the
splitter.

- **Files:** `src/converters/rules.ts`, both converters, tests.

### 6. Round-trip verify — ✅ done

- `src/roundTrip.ts`: convert A→B, then B→A, and diff the return against the original
  (reusing `diffSql` from `src/diff.ts`).
- Comparison normalizes whitespace and keyword case only. It deliberately does **not**
  normalize semantics — and the result is framed as a **signal, not a verdict**.
  `SYSDATE → NOW() → SYSTIMESTAMP` is a legitimately lossy path, and rules carrying
  `roundTripLossy` are labelled as expected-to-differ so real problems stand out.
- UI: a **Check round-trip** button that expands a panel with the summary and diff.
  Unavailable (disabled, with a reason) when no reverse converter is registered.
- **Files:** `src/roundTrip.ts` (+ test), `src/RoundTripPanel.tsx`, `src/App.tsx`.

---

## Correctness hardening (from the 2026-09-02 audit)

An external audit downloaded the deployed bundle and ran adversarial cases against the
real converter (see RCA-006). Three classes are done; one is not scheduled.

- ✅ **DDL type mapping firing on ordinary columns** (RCA-006).
- ✅ **String literals and comments weren't masked before rewrites ran** (RCA-007).
  `SELECT 'use NVL(x,0) here'` rewrote the keyword *inside the string*; `-- NVL(a,b)` in a
  comment had the identical bug. Fixed in `src/converters/mask.ts`: every single-quoted
  literal and `--`/`/* */` comment is masked out before the ordered passes run and
  restored verbatim before the DDL-only type map. `TO_CHAR`/`TO_DATE` (format-mask
  translation) and the `||`-chain-to-`CONCAT` rewrite are the deliberate exception and run
  on the unmasked text first, since they need to read a real quoted string. This did
  **not** require the tokenizer the audit suggested — masking two categories of span was
  enough, and it kept the diff to the two converters plus one new module.
- ✅ **Date arithmetic** (RCA-008). `SYSDATE - 7` → `NOW() - 7` coerced the datetime to a
  plain number instead of subtracting a day. `SYSDATE ± n` and `TRUNC(SYSDATE) ± n` now
  become `NOW() ± INTERVAL n DAY` / `DATE(NOW()) ± INTERVAL n DAY`, ordered ahead of the
  bare-`SYSDATE`/`TRUNC(SYSDATE)` passes. The reverse converter also learned to quote a
  bare inline `INTERVAL n unit` for Oracle, so round-tripping the new shape produces valid
  (if lossy — tagged `roundTripLossy`) SQL instead of an invalid unquoted interval.
- **Not scheduled: `ROWNUM <= n` combined with `ORDER BY`** changes the result set, not
  just the syntax (Oracle caps before sorting; `LIMIT` after `ORDER BY` caps after) —
  currently flagged only `info`. Worth a `caution`-severity rule specifically for that
  combination.

---

## Order of work

```
1. Drag-drop + download      ── independent, unblocks testing with real .sql files
2. Shareable URL             ── independent
3. A: splitter + multi-statement conversion      ┐ foundational
4. B: Rewriter + rule catalogue                  ┘
5. Explain mode              ── on B
6. DDL depth                 ── on A + B
7. Round-trip verify         ── on B
```

1 and 2 go first because they are self-contained and make the later phases easier to
test by hand. 3 and 4 are the heavy lifts; 5–7 are comparatively thin once they land.

## Risks

- **PL/SQL splitting is the hardest correctness problem here.** Mitigated by the
  byte-for-byte round-trip invariant, a wide test corpus, and the whole-input fallback
  when the scanner ends unbalanced.
- **The `Rewriter` refactor touches every rule.** The existing 63 converter tests are
  the safety net — they must stay green at every step, and no expected output may be
  edited to make the refactor pass.
- **`ConvertResult` shape change** ripples into `App.tsx`, the diff view and the tests;
  do it as one coherent change, not piecemeal.
- No new runtime dependencies. `CompressionStream` is native; everything else is ours.

## Verification

- `npm test` — all existing 91 stay green; new suites for `split`, `rewriter`, `share`,
  `roundTrip`, and per-rule DDL cases. Target ~160 tests.
- `npm run build` — `tsc -b` clean; watch that the main chunk stays near its current
  224 kB (no accidental dependency).
- `npm run dev` (port 50173) and by hand:
  - drop a multi-statement `.sql` file with a `CONNECT BY` in the middle — every other
    statement converts, that one is marked
  - copy the share link, open it in a fresh private window — same input, source, target
  - Explain: click a rule, confirm the right span highlights; keyboard-reach the same
  - Verify: run round-trip on `SELECT SYSDATE FROM DUAL`, confirm it reports a difference
    and labels it as a known-lossy rule
  - a PL/SQL block with internal semicolons stays one statement
