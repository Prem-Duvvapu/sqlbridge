# sqlbridge

SQL dialect converter — translates queries between database dialects (Oracle ↔ MySQL, extensible to any pair).

## Architecture

```
sqlbridge/
├── backend/                # Spring Boot 3 (Java 17)
│   ├── pom.xml
│   └── src/main/java/com/sqlbridge/
│       ├── SqlBridgeApplication.java
│       ├── controller/ConvertController.java    # REST: POST /convert, GET /dialects
│       ├── model/                               # ConvertRequest/Response, DialectInfo
│       ├── service/ConverterRegistry.java       # Routes source→target to converter
│       └── converter/
│           ├── SqlConverter.java                # Interface: source(), target(), convert()
│           ├── OracleToMySqlConverter.java
│           └── MySqlToOracleConverter.java
├── frontend/               # React + Vite + TypeScript
│   ├── package.json
│   ├── vite.config.ts
│   └── src/App.tsx          # Dual-pane editor with direction swap
└── README.md
```

## Quick start

### Backend

```bash
cd backend
mvn spring-boot:run
# → http://localhost:8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

The Vite dev server proxies `/convert` and `/dialects` to the backend.

## API

### `POST /convert`

```json
{ "sql": "SELECT NVL(salary, 0), SYSDATE FROM emp WHERE ROWNUM <= 5",
  "source": "oracle",
  "target": "mysql" }
```

Returns:

```json
{ "output": "SELECT IFNULL(salary, 0), NOW() FROM emp LIMIT 5",
  "warnings": ["Converted ROWNUM <= n to LIMIT"] }
```

### `GET /dialects`

Returns available source databases. Future: also returns targets per source.

## Supported conversions (Oracle ↔ MySQL)

| Oracle | MySQL |
|---|---|
| `ROWNUM = 1 / <= n` | `LIMIT 1 / LIMIT n` |
| `FETCH FIRST n ROWS ONLY` | `LIMIT n` |
| `OFFSET m ROWS FETCH NEXT n ROWS ONLY` | `LIMIT n OFFSET m` |
| `FROM DUAL` | removed (auto) |
| `NVL(a, b)` | `IFNULL(a, b)` |
| `NVL2(a, b, c)` | `IF(a IS NOT NULL, b, c)` |
| `DECODE(expr, when, then, ...)` | `CASE expr WHEN ... END` |
| `LISTAGG(expr, sep) WITHIN GROUP(...)` | `GROUP_CONCAT(expr SEPARATOR sep)` |
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
| `ORDER BY x NULLS FIRST\|LAST` | removed |
| subquery alias optional | subquery alias required |
| `CONNECT BY` | ⚠ flagged for manual rewrite |
| `seq.NEXTVAL` | ⚠ flagged for manual replacement |

All reverse conversions (MySQL → Oracle) also supported, plus:

| MySQL | Oracle |
|---|---|
| `IF(cond, a, b)` | `CASE WHEN cond THEN a ELSE b END` |
| `UUID()` | `SYS_GUID()` |
| `CONNECTION_ID()` | `SYS_CONTEXT('USERENV','SESSIONID')` |
| `DATABASE()` | `SYS_CONTEXT('USERENV','DB_NAME')` |
| `DATE_ADD(d, INTERVAL n UNIT)` | `d + INTERVAL 'n' UNIT` |
| `DATEDIFF(d1, d2)` | `CAST(d1 AS DATE) - CAST(d2 AS DATE)` |
| `DATE(dt)` | `TRUNC(dt)` |
| multi-row `INSERT` | `INSERT ALL ... SELECT * FROM DUAL` |
| `INT` / `VARCHAR(n)` / `LONGBLOB` | `NUMBER(10)` / `VARCHAR2(n)` / `BLOB` |
| `SELECT 1` | `SELECT 1 FROM DUAL` |

## Adding a new database pair

Create a new class implementing `SqlConverter`:

```java
@Component
public class OracleToPostgreSqlConverter implements SqlConverter {
    public String source() { return "oracle"; }
    public String target() { return "postgresql"; }
    public ConvertResponse convert(String sql) {
        // ... conversion logic ...
    }
}
```

Spring Boot auto-discovers it via `ConverterRegistry` constructor injection. No config changes needed.


