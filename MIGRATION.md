# Migration: Spring Boot + React → all-React (Vercel)

SQLBridge is now a single client-side React app, deployable as a static site. The Java
Spring Boot backend is gone.

**Status: complete.** 81 tests passing, production build clean. Not yet committed or
deployed.

---

## Why

The backend's entire job was two classes doing regex rewrites on SQL strings — no
database, no auth, no secrets, no state. That logic runs fine in the browser, which
removed the server, the CORS config, the dev proxy, and the deploy complexity.

It also settled the "100 simultaneous users" requirement by construction: Vercel's CDN
serves static files and every visitor's browser does its own work. Nothing to contend for.

---

## What changed

### 1. Repo restructured
`frontend/*` moved to the repo root; `backend/` deleted. `server.proxy` removed from
`vite.config.ts`. Dev port **50173**, preview **50174** — in the 50000s to stay clear of
the ports other local dev servers grab. Configurable via `SQLBRIDGE_PORT` /
`SQLBRIDGE_PREVIEW_PORT` (env var or `.env.local`); a collision steps to the next free
port.

### 2. Converters ported to TypeScript — `src/converters/`
`types.ts`, `oracleToMysql.ts`, `mysqlToOracle.ts`, `index.ts` (the registry).

Six defects were found during the port. All were **pre-existing in the Java code**, and
the Java test suite had assertions for the correct behaviour — so that suite could not
have been passing. Fixed rather than reproduced:

| Defect | Effect |
|---|---|
| Standalone `FETCH` pass ran before `OFFSET…FETCH` | `OFFSET 20 ROWS FETCH NEXT 10` → stranded `OFFSET 20 ROWS LIMIT 10` |
| `ADD_MONTHS` captured the space after the comma | `INTERVAL  3 MONTH` (doubled space) |
| `MONTHS_BETWEEN` same | `TIMESTAMPDIFF(MONTH,  d2, d1)` |
| `DATEDIFF` same | `CAST( hire_date AS DATE)` |
| Oracle→MySQL never stripped a trailing `;` | `SELECT … ; LIMIT 5` |
| `typeMapOracle()` had no `NUMBER` entry | `NUMBER(10)` → `DECIMAL(10)` never happened |

### 3. Test suite — 93 passing
- `src/converters/converters.test.ts` (64) — the 40 original cases, plus confidence-gate
  coverage, registry routing, a `converters are pure` group that guards the concurrency
  requirement (shared singletons must not carry state between calls), and a
  never-throws-on-junk guard.
- `src/highlight.test.ts` (12) — tokenizer classification and the "never loses a
  character" invariant.
- `src/diff.test.ts` (11) — line/token diff, "pieces reconstruct both sides", and a
  never-throws guard.
- `src/format.test.ts` (6) — formatting, dialect awareness, graceful failure.

### 4. UI runs locally
`src/App.tsx` calls the converter registry directly. No `fetch`, no `post()` helper, no
spinner — conversion is synchronous. First visit opens on a worked example.

### 5. Per-tab state + restore-on-reopen — `src/persistence.ts`

| Storage | Scope | Serves |
|---|---|---|
| `sessionStorage` | per-tab, dies on browser close | Each tab keeps its own SQL and results; survives tab reload |
| `localStorage` (`sqlbridge:last`) | shared, survives browser close | Seeds a fresh tab with the last-edited workspace |

Every access is `try/catch`-wrapped (Safari private mode throws on access). Theme lives in
`localStorage` only — it's device-wide, not per-tab.

### 6. Visual redesign
Mono-led chrome (JetBrains Mono + IBM Plex Sans). Colour encodes dialect identity — each
dialect owns a hue, panels take the hue for the end they represent, and they trade places
on swap. Signature element: the **bridge rail** between the selectors, tinted source-hue →
target-hue. Light is the default theme; dark is opt-in via the toggle only (the OS
`prefers-color-scheme` is not consulted). Confidence-gate refusals are a distinct panel
state, not an error string in the output box.

### 7. SQL formatter — `src/format.ts`
Wraps `sql-formatter`, dialect-aware (Oracle → PL/SQL grammar, MySQL → MySQL grammar).
Lazy-loaded via dynamic `import()` — it's ~300 kB, larger than the rest of the app, and
formatting is on-demand. Unparseable SQL returns unchanged with a reason.

### 8. Diff view — `src/diff.ts` + `src/DiffView.tsx`
A **Split / Diff** toggle above the panels. Diff mode replaces the two panels with a
unified diff of source vs. translation: line-level diff (LCS), and within each changed
line pair a token-level diff so only the spans the converter actually rewrote are tinted.
Removed tokens carry the source hue, added tokens the target hue. Tested invariant: the
diff pieces reconstruct both input and output exactly.

### 10. Syntax highlighting — `src/highlight.ts` + `src/SqlEditor.tsx`
Display-only lexer. Token roles: `keyword`, `clause` (`AND`/`OR`/`IN`/`LIKE`/`IS`),
`table` (name after `FROM`/`JOIN`/`INTO`/`UPDATE`), `function`, `string`, `number`,
`comment`, `operator`. The editable panel uses the two-layer technique (highlighted
`<pre>` under a transparent `<textarea>`, metrics matched via a shared `.editor` class);
the output panel is a plain coloured `<pre>`.

### 11. Error handling — `src/ErrorBoundary.tsx`
`convert()`, `tokenize()` and `diffSql()` are wrapped so they never throw — they run
reactively and a throw would blank the page; each degrades to a safe result instead.
`ErrorBoundary` wraps `<App/>` and shows a readable recovery screen (with the saved SQL
intact) for anything unforeseen. Recoverable failures — a conversion that errors, a
formatter that won't load, a blocked clipboard — surface as an inline notice.

### 12. Docs
`README.md` and `CLAUDE.md` rewritten for the single-app architecture. `.gitignore` and
`.gitattributes` for the flattened layout and LF endings. `ROADMAP.md` holds the approved
plan for the next round of features.

---

## Verification

- [x] `npm install` resolves at repo root
- [x] `npm test` — 93 green
- [x] `npm run build` — `tsc -b` clean, `dist/` emitted (224 kB main + 294 kB lazy formatter chunk)
- [x] Dev server serves on 50173; production preview on 50174
- [x] Production bundle contains the converter and makes no network calls
- [ ] Two-tab isolation + browser-restart restore — verify by hand in a browser
- [x] Deployed: `main` merged; import at vercel.com/new (zero config)

## Deploy

Push the repo, then import it at [vercel.com/new](https://vercel.com/new). Vercel detects
Vite, runs `npm run build`, serves `dist/`. Every push redeploys; PRs get preview URLs.
No settings, no environment variables.
