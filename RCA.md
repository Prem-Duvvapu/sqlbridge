# Root-cause log

One entry per real defect: what broke, why, the fix, why the tests didn't catch it, and
what now does. Newest first.

---

## RCA-009 — `ROWNUM <= n` combined with `ORDER BY` can return a different row set

- **Found:** 2026-09-02, the final item from the 2026-09-02 audit (RCA-006).
- **Severity:** medium — the converted SQL is valid and often what was actually wanted,
  but it isn't guaranteed to be the same query. No warning fired.

**Symptom.** Oracle assigns `ROWNUM` to rows **as they're fetched**, before `ORDER BY`
sorts the result — so `WHERE ROWNUM <= 5 ORDER BY sal DESC` filters to *some* 5 rows
(whichever the query plan happens to fetch first) and only then sorts those 5. It does
**not** reliably return the 5 highest-paid employees; that's a well-known Oracle gotcha,
usually worked around with a nested subquery (`ORDER BY` inside, `ROWNUM` outside).

The mechanical conversion — `... ORDER BY sal DESC LIMIT 5` — sorts *first*, then takes
the top 5. That's a different operation: often the more useful one, and arguably what the
original query was trying to do, but not a faithful translation of what the Oracle query
actually returns. Converting it silently changes which rows come back, with nothing in
the output flagging that the semantics shifted.

**Root cause.** The `ROWNUM <= n` → `LIMIT n` rewrite is a syntax swap with no notion of
*when* each database applies the cap relative to sorting — it had no way to know this
combination is exactly the shape where that timing difference is observable.

**Fix.** Not a block — the output SQL is valid, and disabling conversion here would be
overcautious for a case that already usually improves on the original query's own bug.
Instead, `oracleToMysql.ts` now checks the statement for `ORDER BY` immediately after any
of the three `ROWNUM`→`LIMIT` rewrites succeeds, and pushes an additional `caution`-level
note (`rownumOrderByCaveat`) naming the risk, so it's visible instead of silent.

**Why tests missed it.** Every existing `ROWNUM`→`LIMIT` test used a query with no
`ORDER BY` — the combination that triggers the difference was never exercised.

**How we catch it now.** `converters.test.ts`: the caveat fires for all three `ROWNUM`
shapes (`= 1`, standalone `<= n`, `<= n` alongside another condition) when `ORDER BY` is
present, and stays silent when it isn't. `rules.test.ts` covers the warning-to-rule
mapping.

This was the last item from RCA-006's audit; ROADMAP's Correctness hardening section is
now fully checked off.

---

## RCA-008 — `SYSDATE ± n` silently changed from date arithmetic to number arithmetic

- **Found:** 2026-09-02, the last unscheduled item from the 2026-09-02 audit (RCA-006).
- **Severity:** high — a predicate that looks unchanged quietly stops meaning what it
  looks like it means; no warning fired.

**Symptom.** Oracle `DATE ± n` means "n days earlier/later" — `SYSDATE - 7` is a
week ago. MySQL has no such rule: subtracting a plain number from a datetime coerces it
to a number first, so `NOW() - 7` is arithmetic on a numeric encoding of the timestamp,
not a week-ago date. The old conversion produced exactly that:

```
SELECT * FROM t WHERE d > SYSDATE - 7
  -> SELECT * FROM t WHERE d > NOW() - 7        -- no longer means "7 days ago"

SELECT * FROM t WHERE d >= TRUNC(SYSDATE) - 1
  -> SELECT * FROM t WHERE d >= DATE(NOW()) - 1  -- same bug, via the TRUNC(SYSDATE) path
```

**Root cause.** `\bSYSDATE\b` → `NOW()` is a pure name substitution with no notion of
"this value is about to be used in date arithmetic" — the surrounding `± n` was never
inspected, so the rewrite carried none of the semantics that made the original query
correct.

**Fix.** Two new passes in `oracleToMysql.ts`, run before the plain `SYSDATE`/
`TRUNC(SYSDATE)` rewrites (so they see the literal `SYSDATE` text, not an already-opaque
`NOW()`): `SYSDATE\s*([+-])\s*(\d+)` → `NOW() $1 INTERVAL $2 DAY`, and
`TRUNC(SYSDATE)\s*([+-])\s*(\d+)` → `DATE(NOW()) $1 INTERVAL $2 DAY`. Both require a bare
digit immediately after the operator, so `SYSDATE + INTERVAL '1' DAY` (already correct)
is left alone rather than double-wrapped.

This introduces a new output shape (`NOW() - INTERVAL 7 DAY`) that didn't exist before,
so the reverse converter needed a companion fix or converting it back would produce
invalid Oracle: MySQL's inline `expr ± INTERVAL n unit` uses a bare numeral, but Oracle's
`INTERVAL` literal requires it quoted (`INTERVAL '7' DAY`). Added that quoting pass to
`mysqlToOracle.ts` alongside the existing `DATE_ADD(...)`-specific one (which already
produced the quoted form for that shape). New rule `sysdateArithmeticToInterval`,
`roundTripLossy: true` — the returned Oracle text is `SYSTIMESTAMP - INTERVAL '7' DAY`,
not byte-identical to the original `SYSDATE - 7`, but now valid and semantically
equivalent, which is what the round-trip check is meant to distinguish.

**Why tests missed it.** No test exercised `SYSDATE`/`TRUNC(SYSDATE)` followed by
arithmetic — every existing SYSDATE test used it bare.

**How we catch it now.** `converters.test.ts`: `SYSDATE ± n`, `TRUNC(SYSDATE) ± n`, the
already-`INTERVAL` case left alone, bare `SYSDATE` still converting as before, and the
`mysqlToOracle` quoting fix. `rules.test.ts` covers the new rule's warning mapping.

---

## RCA-007 — Every rewrite pass ran over string literals and comments unmasked

- **Found:** 2026-09-02, scoping the fix for the external audit's string-literal finding
  (it only reported literals; comments turned out to have the identical bug).
- **Severity:** high — silently changes what a query returns (a literal) or what a note
  says (a comment), with no warning either way.

**Symptom.** Every keyword/function rewrite is a bare `String.replace(/…/gi, …)` over
the whole statement text, with no idea whether a match sits inside a string literal or a
comment:

```
o2m  SELECT 'use NVL(x,0) and ROWNUM here' AS tip FROM dual
     -> SELECT 'use IFNULL(x,0) and ROWNUM here' AS tip        -- literal corrupted, changes query output

o2m  -- NVL(a,b) and SYSDATE in a comment
     SELECT a FROM t
     -> -- IFNULL(a,b) and NOW() in a comment                  -- comment corrupted too (not just literals)
        SELECT a FROM t
```

No warning fired in either case.

**Root cause.** The regex pipeline has never distinguished "real SQL" from "text that
happens to sit inside a string or a comment" — it operates on raw characters, not tokens.

**Fix.** `src/converters/mask.ts`: before the ordered passes run, every single-quoted
string literal (respecting `''` escapes) and every `--`/`/* */` comment is replaced with
an opaque placeholder built from a NUL character (never a real word character, so every
`\b`-bounded pattern treats it as absent). `restore()` puts the original text back
verbatim right before the DDL-only `applyTypeMap` step.

Two passes are the deliberate exception and run on the **unmasked** text first:
- `TO_CHAR`/`TO_DATE` (`replaceToChar`/`replaceToDate`, oracle→mysql) rewrite the format
  mask's own quoted content (`YYYY`→`%Y`) — they need to see the real string.
- The `||`-chain-to-`CONCAT` rewrite (`replaceConcat`, oracle→mysql) needs to see an
  actual quote to recognise a literal segment of the chain (`id || '-' || name`).

Both were reordered to run before masking instead of at their old position mid-pipeline;
verified behavior-preserving by inspection (neither depends on any earlier pass having
already run) and by the full existing test suite staying green with no output changes.

**Why tests missed it.** Every converter test used identifiers and bare values as
"data" — nothing exercised a string literal or comment whose *content* happened to look
like SQL.

**How we catch it now.** `src/converters/mask.test.ts` (the masking primitive in
isolation: literals, `''` escapes, line/block comments, multiple spans, unterminated
input) and a new `converters.test.ts` group, "string literals and comments are protected
from rewrites" (both directions, plus the two unmasked-exception passes still working,
plus a query mixing a protected literal with real rewrites elsewhere).

---

## RCA-006 — Type mapping fired on ordinary columns, not just DDL

- **Found:** 2026-09-02, triaging an external audit that downloaded the deployed bundle
  and ran adversarial cases against it (`sqlbridge-notes.md`, not committed — see below).
  Verified independently against this repo's source, not just the deployed build.
- **Severity:** high for the affected shape — a plain `SELECT` corrupted into invalid SQL,
  with no warning, on a very common shape (a column or alias named after a type word).

**Symptom.** `applyTypeMap()` is a blind whole-word find-and-replace run unconditionally
on every converted statement. Type names are also extremely common column and alias
names, so ordinary queries came out broken:

```
o2m  SELECT number, raw, long FROM t        →  SELECT DECIMAL, VARBINARY, LONGTEXT FROM t
o2m  SELECT a AS float FROM t               →  SELECT a AS DOUBLE FROM t
m2o  SELECT text, year FROM logs            →  SELECT text, NUMBER(4) FROM logs
m2o  SELECT a AS year FROM t                →  SELECT a AS NUMBER(4) FROM t
```

No warning fired in any of these cases — the tool actively worsened correct SQL and said
nothing. Separately, a source type that carries its own display width produced doubled
parens: `TINYINT(1)` → `NUMBER(3)(1)` (invalid) instead of `NUMBER(3)`. And `TEXT` (the
plain MySQL type — `LONGTEXT`/`MEDIUMTEXT`/`TINYTEXT` were mapped, the common one wasn't)
passed through untouched, silently, on `mysqlToOracle`.

**Root cause.** `applyTypeMap` has no idea whether a matched word sits in a type
position or an identifier position — it's a text substitution, not a parser. It ran on
every statement, DML included, because nothing gated it to DDL.

**Fix.**
- `isDdlStatement()` (`src/converters/types.ts`) gates `applyTypeMap` to statements that
  start `CREATE TABLE` / `ALTER TABLE` in both converters — the only place type names are
  ever genuinely in a type position today. DML is left alone entirely.
- `applyTypeMap` now consumes a source type's own `(n[,m])` when the replacement already
  carries its own precision (`TINYINT(1)` → `NUMBER(3)`), and leaves the source's
  parenthesized group in place otherwise (`DECIMAL(10,2)` → `NUMBER(10,2)`, unchanged).
- Added `['TEXT', 'CLOB']` to `mysqlToOracle`'s type map.

**Why tests missed it.** Every existing type-map test used a `CREATE TABLE` statement,
so DDL-only behavior looked identical to "always on" — nothing exercised a DML statement
that happened to mention a type word.

**How we catch it now.** `converters.test.ts`: "does not treat a column or alias that
shares a type name as a type" (both directions), "drops a source display width when the
target already has its own precision", "maps TEXT to CLOB".

**Scope note.** This audit surfaced a longer list of correctness issues in the regex
pipeline — most notably that keyword rewrites run over raw text and don't mask string
literals or comments (`SELECT 'use NVL(x,0) here'` rewrites *inside* the string) and that
`SYSDATE - n` becomes `NOW() - n` (integer arithmetic on a datetime) instead of
`NOW() - INTERVAL n DAY`. Those need either literal/comment masking ahead of every
rewrite pass or a real tokenizer, not a contained fix — tracked in ROADMAP under
"Correctness hardening" rather than fixed here, since they touch the ordering of every
rule in both converters.

---

## RCA-005 — A catalogued rule that could never surface

- **Found:** 2026-09-02, wiring the round-trip verify panel (ROADMAP feature 6) and
  running its own worked example from the plan (`SELECT SYSDATE FROM DUAL`).
- **Severity:** low — no wrong output, but the exact scenario the feature exists for
  didn't work.

**Symptom.** `RULES.sysdateToNow` (`src/converters/rules.ts`) is marked
`roundTripLossy: true` specifically so the round-trip panel can say "this difference is
expected" for `SYSDATE → NOW() → SYSTIMESTAMP`. Running that exact query showed the
panel reporting an *unexplained* diff instead — no entry under "Expected to differ".

**Root cause.** `oracleToMysql.ts`'s `SYSDATE → NOW()` rewrite never called
`warnings.push(...)`, unlike every other rewrite. `roundTrip()`'s `lossyRules` list is
built from `forward.notes`, and `notes` only exist for warnings the converter actually
pushes (`ruleForWarning` has nothing to map). A rule can sit in the catalogue with
`roundTripLossy: true` and still be unreachable if the converter that triggers it is
silent.

**Fix.** Added `warnings.push('Converted SYSDATE to NOW()')` alongside the rewrite, and
`['Converted SYSDATE', RULES.sysdateToNow]` to `MESSAGE_TO_RULE`. This also means a plain
conversion now lists it as a (low-severity, `info`) conversion note, which is consistent
with every other rule in the catalogue.

**Why tests missed it.** `rules.test.ts`'s "covers every warning" test only checks the
direction warnings → rules (no orphaned warning), not the reverse (every catalogued rule
is reachable from some real warning). A rule with no matching warning is invisible to
that test.

**How we catch it now.** `src/roundTrip.test.ts` exercises the SYSDATE case directly and
asserts a matching entry in `lossyRules`. Still open: a general "every `roundTripLossy`
rule is reachable from at least one converter warning" test would catch the next one of
these before a manual walkthrough does.

---

## RCA-004 — NUL / control bytes in two test files

- **Found:** 2026-09-01, building the statement splitter — `rg` reported
  `converters.test.ts` as "binary file matches".
- **Severity:** low. Tests still ran (esbuild tolerates it), but the files read as binary
  to `git` and `grep`, and the "junk" the pathological-input tests fed the code was not
  what the source appeared to say.

**Symptom.** `src/diff.test.ts` and `src/converters/converters.test.ts` each held a
literal `NUL` (plus `SOH`/`BEL`) byte inside a "pathological input" string, where
`'\u0000\u0001\u0002'` escape sequences were intended.

**Root cause.** When the pathological-input guards were authored, the control characters
went into the file as raw bytes instead of as `\uXXXX` escapes.

**Fix.** Replaced the raw bytes with `'\uXXXX'` escapes — identical runtime value,
plain-text source.

**Why tests missed it.** Nothing checked source files for non-printable bytes; the tests
themselves passed.

**How we catch it now.** `src/test/source-hygiene.test.ts` scans every `src/**/*.ts(x)`
(via `import.meta.glob('?raw')`) and fails on any byte below U+0020 that isn't tab /
newline / CR.

---

## RCA-003 — No tests for the UI, hooks, or persistence

- **Found:** 2026-09-01, during review ("add proper tests for old code and new changes").
- **Severity:** low (no user-visible break), but a standing risk.

**Symptom.** `App.tsx`, `SqlEditor.tsx`, `DiffView.tsx`, `ErrorBoundary.tsx`,
`FileDrop.tsx` and `persistence.ts` had **zero** test coverage. Every regression in that
layer — theme default flipping, a broken swap, the confidence-gate panel not rendering,
storage throwing in private mode — would have shipped silently. CI was green because it
only ran the converter/format/highlight/diff suites.

**Root cause.** The port from Java focused testing effort on the converters (the obvious
risk) and treated the React layer as "just wiring". It grew — diff view, file import,
persistence tiers, error boundary — without tests following.

**Fix.** Added `@testing-library/react` + `jsdom`, a split `vitest.config.ts`
(`environment: 'node'` by default; DOM suites opt in with
`// @vitest-environment jsdom`), and `src/test/setup.ts`. New suites:
`persistence.test.ts`, `FileDrop.test.tsx`, `ErrorBoundary.test.tsx`,
`SqlEditor.test.tsx`, `DiffView.test.tsx`, `App.test.tsx`. ~60 new assertions covering
first-load seed, convert / swap / sample / theme / file-import / clear flows, the
confidence-gate panel, storage-throws resilience, and the size-cap fallbacks.

**Prevention.** CI (PR #6) runs the whole suite on every PR and blocks merge on failure.
Convention going forward: a new component or hook ships with its test in the same PR.

---

## RCA-002 — Stray `;;` stranded a semicolon mid-statement

- **Found:** 2026-09-01 by the user, on the deployed site.
- **Severity:** medium — produced visibly broken output, though only on malformed input.

**Symptom.** Converting MySQL → Oracle:

```
SELECT *
FROM job_execution
LIMIT 10;;          -- note the doubled ;
```

produced

```
SELECT *
FROM job_execution
;                   -- stranded
FETCH FIRST 10 ROWS ONLY
```

With a single `;` the output was correct.

**Root cause.** Both converters stripped **one** trailing terminator:
`if (s.endsWith(';')) s = s.slice(0, -1)…`. A doubled `;;` left one behind. The pagination
pass then matched `LIMIT\n  10` and deleted it, leaving the survivor `;` sitting where the
clause had been — between `FROM …` and the appended `FETCH FIRST`. The project already
documents this failure mode ("a leftover terminator gets stranded mid-statement once a
later pass rewrites the clause in front of it") — the guard was just too narrow.

**Fix.** Strip the entire trailing run of terminators and whitespace in both directions:
`sql.replace(/[;\s]+$/, '')` (commit `a575bdb`, PR #5).

**Why tests missed it.** The two semicolon tests
(`o2m_rownum_semicolon`, `m2o_limit_semicolon`) only exercised a **single** trailing `;`.
No case for `;;`, `; `, `;\n`, or leading/trailing whitespace around the terminator. The
`never throws on pathological input` guard ran junk through the converters but only
asserted "doesn't throw" — not "output is well-formed".

**How we catch it now.**
- `converters.test.ts` → "strips a trailing semicolon, including a stray doubled one"
  (o2m: `;`, `;;`, ` ; ` all normalise to the same output).
- `converters.test.ts` → "does not strand a doubled semicolon mid-statement" (m2o, the
  exact reported input).

**Still open / follow-up.** The pathological-input guard should assert a structural
invariant, not just non-throwing — e.g. *the output never contains a lone `;` on its own
line* for single-statement input. Worth adding when the statement splitter lands
(ROADMAP feature 3), since that's when multi-`;` handling gets real.

---

## RCA-001 — Six latent bugs in the Java converters, surfaced by the TS port

- **Found:** 2026-09-01, porting `ConverterTest.java` to Vitest during the migration.
- **Severity:** medium — wrong output on common inputs; all pre-existing in the Java code.

**Symptom / root cause (one line each):**

| Bug | Cause |
|---|---|
| `OFFSET 20 ROWS FETCH NEXT 10` → stranded `OFFSET 20 ROWS LIMIT 10` | standalone-`FETCH` pass ran before the `OFFSET…FETCH` pass |
| `ADD_MONTHS(d, 3)` → `INTERVAL  3 MONTH` (double space) | `([^)]+)` capture group swallowed the space after the comma |
| `MONTHS_BETWEEN` / `DATEDIFF` — same doubled space | same |
| Oracle→MySQL never stripped a trailing `;` | only the MySQL→Oracle path had the strip |
| `NUMBER(10)` → `DECIMAL(10)` never happened | `typeMapOracle()` had **no `NUMBER` entry** |

**Fix.** Corrected during the port: reorder the pagination passes, `.trim()` the captured
groups, add the terminator strip to both sides, add the `NUMBER → DECIMAL` mapping. All
covered by the ported `converters.test.ts`.

**Why the Java tests missed it.** They **didn't** — `ConverterTest.java` had assertions
for the correct behaviour on all six. The suite simply wasn't being run (or was red and
ignored). There was no CI.

**How we catch it now.** CI (PR #6) runs `npm test` on every PR and branch protection
blocks merge on a red suite, so a failing test can no longer be ignored.

---

## Testing notes (not defects)

- `expect(el).toHaveValue(expect.stringContaining(…))` does **not** work —
  `toHaveValue` needs an exact value. Use `expect(el.value).toContain(…)`.
- `FileReader` (file import) is async; assert with `findBy*` / `waitFor`, never a bare
  `expect` right after `userEvent.upload`.
- The seeded first-load workspace already has output, so tests for "no output" states
  must clear it explicitly (or use a blocked construct).
- jsdom has no `DataTransfer`; drag tests build a minimal `{ types, files }` stub.
