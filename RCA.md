# Root-cause log

One entry per real defect: what broke, why, the fix, why the tests didn't catch it, and
what now does. Newest first.

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
