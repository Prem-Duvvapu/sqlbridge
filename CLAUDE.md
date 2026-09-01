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

## What this is

A fully client-side SQL dialect translator (Oracle ↔ MySQL). React 19 + Vite 6 + TS,
deployed as a static site on Vercel. **There is no backend** — it was a Spring Boot app
until the Java converters were ported to TypeScript and moved into the browser (see
`MIGRATION.md` for the history and the bugs found during the port).

## Architecture

### Conversion pipeline (`src/converters/`)

- A `Converter` is `{ source, target, convert(sql) → { output, warnings, blocked? } }`.
  One object per direction: `oracleToMysql.ts`, `mysqlToOracle.ts`.
- `index.ts` is the registry (replaces Spring's `ConverterRegistry`): keys converters by
  `"source->target"`, exposes `convert()`, `getSources()`, `getTargetsFor()`. `convert()`
  returns an error *result* for an unknown pair — it never throws.
- **Adding a dialect pair = one new `Converter` object + one line in the `CONVERTERS`
  array in `index.ts`.** Dropdowns, formatter language map, and routing follow.

### How converters work

Each `convert()` applies an **ordered** sequence of `String.replace(/…/gi, …)` passes to
the raw SQL. Conventions that will bite you if ignored:

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
- `src/ErrorBoundary.tsx` — wraps `<App/>` in `main.tsx`; recovery screen for anything
  the inline handlers didn't catch.
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
- The build emits a "chunk > 500 kB" warning for the lazy `sql-formatter` chunk — that's
  expected, it's not on the critical path.
