# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev       # dev server on http://localhost:50173
npm test          # Vitest, single run
npm run test:watch
npm run build     # tsc -b (type-check) then vite build → dist/
npm run preview   # serve the production build on http://localhost:50174
```

Dev port is configurable: `SQLBRIDGE_PORT=12345 npm run dev` or `.env.local`
(`SQLBRIDGE_PREVIEW_PORT` for preview). Not `strictPort` — a collision steps to the next
free port.

Single test file / case:

```bash
npx vitest run src/converters/converters.test.ts
npx vitest run -t "rewrites NVL to IFNULL"
```

There is no linter. `npm run build` is the type-check gate; `tsconfig.app.json` has
`noUnusedLocals` / `noUnusedParameters` on, so prefix intentionally-unused params with `_`.

## Working here

- `MIGRATION.md` — the Spring Boot → React port and the bugs found during it.
- `ROADMAP.md` — approved plan for the next features; tick items as they land.
- `RCA.md` — **root-cause log. Add an entry for every real defect**: symptom, root
  cause, fix, why the tests missed it, what catches it now.
- Tests: pure logic runs in Node; DOM suites start with `// @vitest-environment jsdom`.
  A new component or hook ships with its test in the same change. CI blocks merge to
  `main` on a red suite.

## What this is

A fully client-side SQL dialect translator (Oracle ↔ MySQL). React 19 + Vite 6 + TS,
deployed as a static site on Vercel. **There is no backend** — it was a Spring Boot app
until the Java converters were ported to TypeScript and moved into the browser (see
`MIGRATION.md` for the history and the bugs found during the port).

## Architecture

### Conversion pipeline (`src/converters/`)

- A `Converter` is `{ source, target, convert(sql) → StatementConversion }` where
  `StatementConversion` is `{ output, warnings, blocked? }` — it operates on **one
  statement**. One object per direction: `oracleToMysql.ts`, `mysqlToOracle.ts`.
- `index.ts` is the registry (replaces Spring's `ConverterRegistry`): keys converters by
  `"source->target"`, exposes `convert()`, `getSources()`, `getTargetsFor()`.
- `convert()` runs `convertScript()`: `splitStatements()` (`src/sql/split.ts`) → convert
  each statement → `joinStatements()` with the original whitespace and terminators. It
  returns a `ConvertResult` = `{ output, warnings, blocked?, statements: StatementResult[] }`.
  Never throws — unknown pair or a converter bug both come back as a result.
- Per-statement gating: a refused statement passes through unchanged; when the rest of
  the script converted it gets a `-- SQLBridge: not translated` comment. `blocked` at the
  top level is set only when *every* statement was refused, so a lone bad query still
  shows the single "not translated" panel.
- **Adding a dialect pair = one new `Converter` object + one line in the `CONVERTERS`
  array in `index.ts`.** Dropdowns, formatter language map, and routing follow.

### Rule catalogue (`src/converters/rules.ts`)

- `RULES` — one `Rule` (`id`, `title`, `detail`, `severity`, `roundTripLossy?`) per
  rewrite and per gate refusal. The converters still push plain warning strings;
  `ruleForWarning()` / `ruleForBlockedReason()` map them back to a `Rule`, and
  `convertScript()` builds `ConvertResult.notes` (`{ rule, message, statement }`).
- **The converter bodies do not reference rules** — keep it that way. To add a rewrite:
  do the `s.replace` + `warnings.push('Converted X to Y')` as before, then add a `RULES`
  entry and a `['Converted X', RULES.xToY]` line in `MESSAGE_TO_RULE`. `rules.test.ts`'s
  "covers every warning" test fails if you forget the mapping.

### Statement splitter (`src/sql/split.ts`)

- `splitStatements(script)` is a lexer, not a parser. Tracks strings (`'` with `''`),
  `"`/`` ` `` identifiers, `--` and `/* */` comments, and PL/SQL block depth
  (`BEGIN`/`IF`/`LOOP`/`CASE` ++, `END` --) so a `;` inside a block or string doesn't
  terminate. Handles a lone `/` line (Oracle) and `DELIMITER` directives (MySQL).
- **Invariant:** `joinStatements` of an unmodified split reproduces the input exactly
  (`split.test.ts` guards it). **Safety valve:** an unbalanced end (open string/block)
  returns the whole input as one statement.

### How converters work

Each `convert()` applies an **ordered** sequence of `String.replace(/…/gi, …)` passes to
the raw SQL. Conventions that will bite you if ignored:

- **String literals and comments are masked first** (`src/converters/mask.ts`), so a
  keyword or function name inside one — user data, a note to a colleague — isn't mistaken
  for real SQL (RCA-006 / RCA-007). Placeholders are restored right before the DDL-only
  `applyTypeMap` step. Two passes are the deliberate exception and run on the *unmasked*
  text first: `TO_CHAR`/`TO_DATE` (they rewrite the format string's own content) and the
  `||`-chain-to-`CONCAT` rewrite (it needs a real quote to recognise a literal segment). A
  new rewrite that needs to read inside a string literal belongs in that unmasked group,
  not after masking.
- **Order is load-bearing.** `TRUNC(SYSDATE)` before bare `SYSDATE`; pagination before
  function rewrites; `OFFSET…FETCH` before standalone `FETCH`. Slot a new pass into the
  right place and run the tests.
- **Confidence gate first (Oracle→MySQL).** `UNCERTAIN_PATTERNS` is checked before any
  rewrite. A match returns `{ output: <original sql unchanged>, warnings, blocked: { reason } }`.
  The UI renders `blocked` as a distinct panel state — do not fold it back into `output`.
- **Java → JS regex gotchas** (relevant when comparing to git history / the old Java):
  `replaceAll("(?i)…")` → `replace(/…/gi, …)` (the `g` is required); `String.replace(a,b)`
  in Java is global, JS `.replace(str,str)` is not — `translateOracleFmt` uses
  `.replaceAll(str,str)` deliberately.
- **Purity matters.** Converters are shared module singletons and the "works for 100
  concurrent users" requirement rests on them holding no module-level mutable state. The
  `converters are pure` test group guards this — keep it green.
- Arg-splitting helpers (`splitArgs`) exist for functions where commas can be nested
  (`NVL2`, `DECODE`); simple functions use `.split(',')`.

### Supporting modules

- `src/format.ts` — wraps `sql-formatter`, **lazy-loaded** via dynamic `import()` (it's
  ~300 kB, more than the rest of the bundle) and dialect-aware. Never throws; unparseable
  SQL returns unchanged with an `error`.
- `src/highlight.ts` — display-only lexer. `tokenize()` guarantees the concatenation of
  all token `text` equals the input (no character ever lost). Classification is heuristic
  and *will* mislabel ambiguous SQL; it's a reading aid, nothing depends on it.
- `src/SqlEditor.tsx` — `SqlInput` is the two-layer trick (highlighted `<pre>` under a
  transparent `<textarea>`). Both layers share the `.editor` class so their text metrics
  are identical; changing padding/font/line-height on one without the other makes the
  highlight drift out of alignment with the caret.
- `src/diff.ts` + `src/DiffView.tsx` — the Split/Diff toggle. `diffSql()` does an
  LCS line diff, then a token diff (via `tokenize`) within each changed line pair, so
  only rewritten spans are tinted. Tested invariant: the pieces reconstruct both sides
  exactly. Never throws — degrades to a plain two-block diff.
- `src/roundTrip.ts` + `src/RoundTripPanel.tsx` — the **Check round-trip** button.
  Converts A→B→A and diffs the return against the original after normalizing whitespace
  and keyword case. A signal, not a verdict: rules flagged `roundTripLossy` in the rule
  catalogue are listed separately as expected-to-differ, so an *unexplained* diff is the
  one worth looking at. A rule can only appear there if the converter that triggers it
  actually pushes a warning — see RCA-005.
- `src/ErrorBoundary.tsx` — wraps `<App/>` in `main.tsx`; recovery screen for anything
  the inline handlers didn't catch.
- `src/FileDrop.tsx` + `src/fileTransfer.ts` — `useFileImport` puts drag listeners on
  `window` (depth counter for nested dragenter/leave; files-only) and returns the hidden
  `<input>` plus `openPicker`. `fileTransfer.ts` holds the 2 MB import cap and the
  `<a download>` save. `App.tsx`'s `notice` state is the shared inline-error channel
  (format / copy / file).
- `src/share.ts` — workspace → `deflate-raw` → base64url token in the URL **hash**
  (`#s=`), never the query string, so shared SQL isn't sent to the server. Load
  precedence in `App.tsx`: hash → sessionStorage → localStorage → seed; a share link
  starts the tab from `EMPTY_WORKSPACE` so nothing flashes before the decode lands.
- `src/persistence.ts` — two storage tiers: `sessionStorage` for per-tab isolation,
  `localStorage` (`sqlbridge:last`) to reseed a fresh tab after a browser restart. Every
  access is `try/catch`-wrapped (Safari private mode throws). `loadWorkspace()` returns
  `null` on a true first visit so `App.tsx` can seed a worked example instead of blanks.

## Gotchas

- Dev port **50173**, preview **50174** (`vite.config.ts`) — in the 50000s to stay clear
  of the ports other local dev servers grab. Override with `SQLBRIDGE_PORT` /
  `SQLBRIDGE_PREVIEW_PORT` (env or `.env.local`).
- Theme: **light is the default and the only un-stamped state.** Dark is opt-in — it
  applies only when the toggle stamps `data-theme="dark"`. The OS `prefers-color-scheme`
  is deliberately not consulted (`loadTheme()` in `src/persistence.ts`, and there is no
  dark `@media` block in `src/App.css`).
- Error handling: `convert()` (`src/converters/index.ts`), `tokenize()`
  (`src/highlight.ts`) and `diffSql()` (`src/diff.ts`) are wrapped so they never throw —
  they run reactively and a throw would blank the page. `src/ErrorBoundary.tsx` wraps
  `<App/>` for anything else. Recoverable failures surface as an inline `.notice`.
- Large-input guards (the textarea takes any pasted text): above 20 000 chars
  `SqlEditor` drops the highlight layer (plain textarea only); above 3 000 lines or
  400 000 chars `diffSql` returns a plain block diff instead of the O(n·m) LCS.
  Conversion and formatting are never size-gated.
- Converters strip **all** trailing `;`/whitespace (`/[;\s]+$/`), not just one — a
  leftover terminator gets stranded mid-statement once a later pass rewrites the clause
  in front of it.
- The build emits a "chunk > 500 kB" warning for the lazy `sql-formatter` chunk — that's
  expected, it's not on the critical path.
