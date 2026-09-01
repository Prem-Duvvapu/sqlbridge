# SQLBridge

Translate SQL between database dialects (Oracle ↔ MySQL, extensible to any pair). Runs
entirely in the browser — paste a query, pick a direction, read the translation.

[![CI](https://github.com/Prem-Duvvapu/sqlbridge/actions/workflows/ci.yml/badge.svg)](https://github.com/Prem-Duvvapu/sqlbridge/actions/workflows/ci.yml)

**[Live demo](https://sqlbridge.vercel.app/)** · CI must pass before a PR can merge to
`main`, which auto-deploys.

## What it does

- **Dialect translation** — regex-based rewrites for pagination, null handling, date
  functions, string operators, identifier quoting, data types, and more (full table
  below).
- **Multi-statement scripts** — paste a whole `.sql` file; each statement is translated
  on its own and the file is re-assembled with its original spacing and terminators.
- **Confidence gate** — constructs that can't be translated safely (`CONNECT BY`,
  sequences, `MERGE`, `PIVOT`, stored procedures, …) are flagged for a manual rewrite
  rather than converted into something subtly wrong. In a script, the flagged statement
  gets a `-- SQLBridge:` note and the rest still converts.
- **Diff view** — a Split/Diff toggle; Diff shows a line-by-line comparison with only the
  tokens the translation actually rewrote highlighted.
- **File in / out** — drag a `.sql` file onto the page (or use **Open file**); save the
  result with **Download**. 2 MB cap.
- **Share** — copies a link that reopens your SQL and direction. The link's payload sits
  in the URL fragment, which browsers never send to the server, so a shared query isn't
  logged anywhere.
- **Formatter** — dialect-aware reindentation onto multiple lines, on either panel.
- **Syntax highlighting** — keywords, logical connectors, table names, functions, and
  literals each in their own colour.
- **Per-tab workspaces** — each browser tab keeps its own query and result; reopening the
  site restores your last session.

Light theme by default; a toggle switches to dark and remembers the choice.

Everything happens client-side. There is no server, no account, and nothing you paste
leaves your machine.

## Develop

```bash
npm install
npm run dev      # http://localhost:50173
npm test         # Vitest — converter, formatter, highlighter and diff suites
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build on http://localhost:50174
```

Change the dev port with `SQLBRIDGE_PORT=12345 npm run dev`, or put
`SQLBRIDGE_PORT=12345` in a git-ignored `.env.local`. If the port is taken, Vite steps to
the next free one.

Run a single test file or case:

```bash
npx vitest run src/converters/converters.test.ts
npx vitest run -t "rewrites NVL to IFNULL"
```

## Deploy

Static site, zero configuration.

**From GitHub (recommended)** — push the repo, then at
[vercel.com/new](https://vercel.com/new) import it. Vercel detects Vite, builds with
`npm run build`, and serves `dist/`. Every push to the default branch redeploys; pull
requests get preview URLs. No build settings or environment variables to configure.

**From the CLI** — `npm run build && npx vercel deploy --prebuilt`.

The same `dist/` folder also drops onto Netlify, GitHub Pages, Cloudflare Pages, or any
static host.

## Architecture

```
src/
├── converters/
│   ├── types.ts          Converter / StatementConversion / ConvertResult
│   ├── oracleToMysql.ts   one Converter per direction (single-statement)
│   ├── mysqlToOracle.ts
│   └── index.ts           registry + convertScript (split → convert → re-join)
├── sql/split.ts          statement splitter (strings, comments, PL/SQL blocks)
├── format.ts             sql-formatter wrapper (lazy-loaded, dialect-aware)
├── highlight.ts          display-only SQL tokenizer
├── diff.ts               line + token diff for the Diff view
├── FileDrop.tsx          drag-and-drop / file-picker import
├── fileTransfer.ts       import size guard + .sql download
├── share.ts              deflate + base64url workspace links (URL hash)
├── persistence.ts        session/local storage tiers
├── SqlEditor.tsx         highlighted input + read-only view
├── DiffView.tsx          unified diff panel
├── ErrorBoundary.tsx     last-resort recovery screen
└── App.tsx               the page
```

A converter is `{ source, target, convert(sql) -> { output, warnings, blocked? } }`. The
registry keys converters by `"source->target"` and returns an error result — never
throws, even if a converter itself does — for an unknown pair. Converters are pure: no
module-level mutable state, so any number of conversions can run without interfering.

`convert()`, `tokenize()` and `diffSql()` are all wrapped so they never throw (they run
on every render); anything else unexpected is caught by `ErrorBoundary`, which shows a
recovery screen with your SQL still saved.

Each `convert()` runs an **ordered** sequence of string rewrites. Order is load-bearing —
`TRUNC(SYSDATE)` is handled before the bare `SYSDATE` rewrite, pagination before
function rewrites — so a new rewrite has to be slotted into the right place, and the test
suite is how you check you got it right.

## Adding a dialect pair

Write one `Converter` and register it:

```ts
// src/converters/oracleToPostgres.ts
import type { Converter } from './types'

export const oracleToPostgres: Converter = {
  source: 'oracle',
  target: 'postgresql',
  convert(sql) {
    // ordered rewrites…
    return { output: sql, warnings: [] }
  },
}
```

```ts
// src/converters/index.ts
const CONVERTERS = [oracleToMysql, mysqlToOracle, oracleToPostgres]
```

The dialect dropdowns, the formatter language map, and the routing all pick it up from
there.

## Supported conversions (Oracle ↔ MySQL)

| Oracle | MySQL |
|---|---|
| `ROWNUM = 1 / <= n` | `LIMIT 1 / LIMIT n` |
| `FETCH FIRST n ROWS ONLY` | `LIMIT n` |
| `OFFSET m ROWS FETCH NEXT n ROWS ONLY` | `LIMIT n OFFSET m` |
| `FROM DUAL` | removed |
| `NVL(a, b)` | `IFNULL(a, b)` |
| `NVL2(a, b, c)` | `IF(a IS NOT NULL, b, c)` |
| `DECODE(expr, when, then, …)` | `CASE expr WHEN … END` |
| `LISTAGG(expr, sep) WITHIN GROUP(…)` | `GROUP_CONCAT(expr SEPARATOR sep)` |
| `SYSDATE` / `SYSTIMESTAMP` | `NOW()` / `NOW(6)` |
| `CURRENT_DATE` | `CURDATE()` |
| `TO_DATE(str, fmt)` | `STR_TO_DATE(str, fmt)` |
| `TO_CHAR(date, fmt)` | `DATE_FORMAT(date, fmt)` |
| `TRUNC(datetime)` | `DATE(datetime)` |
| `ADD_MONTHS(d, n)` | `DATE_ADD(d, INTERVAL n MONTH)` |
| `MONTHS_BETWEEN(d1, d2)` | `TIMESTAMPDIFF(MONTH, d2, d1)` |
| `SYS_GUID()` | `UUID()` |
| `LENGTH(str)` | `CHAR_LENGTH(str)` |
| `a \|\| b \|\| c` | `CONCAT(a, b, c)` |
| `"ident"` quoting | `` `ident` `` quoting |
| `NUMBER(10)` / `VARCHAR2(n)` / `CLOB` | `DECIMAL(10)` / `VARCHAR(n)` / `LONGTEXT` |
| `(+)` outer join | `LEFT JOIN` |
| `ORDER BY x NULLS FIRST\|LAST` | `ORDER BY x` |
| subquery alias optional | subquery alias added |
| `CONNECT BY` · `seq.NEXTVAL` · `MERGE` · `PIVOT` · … | flagged for manual rewrite |

Reverse (MySQL → Oracle) is also supported, plus `IF()` → `CASE`, `UUID()` → `SYS_GUID()`,
`DATABASE()`/`CONNECTION_ID()` → `SYS_CONTEXT(…)`, `DATE_ADD` → `INTERVAL` arithmetic,
`DATEDIFF` → date subtraction, multi-row `INSERT` → `INSERT ALL`, `SELECT 1` →
`SELECT 1 FROM DUAL`, and the data-type map in reverse.

## Caveats

The translation is lexical, not a parser. It handles the common shapes well and warns
when it's unsure, but **review every result before running it against a database** —
especially anything with nested subqueries, unusual quoting, or vendor-specific syntax
not in the table above.
