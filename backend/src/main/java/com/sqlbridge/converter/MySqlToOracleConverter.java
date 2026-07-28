package com.sqlbridge.converter;

import com.sqlbridge.model.ConvertResponse;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
public class MySqlToOracleConverter implements SqlConverter {

    @Override
    public String source() { return "mysql"; }
    @Override
    public String target() { return "oracle"; }

    @Override
    public ConvertResponse convert(String sql) {
        List<String> warnings = new ArrayList<>();
        String s = sql.stripTrailing();
        boolean hasSemicolon = s.endsWith(";");
        if (hasSemicolon) s = s.substring(0, s.length() - 1).stripTrailing();

        // Identifier quoting: `ident` -> "ident"
        s = s.replaceAll("`([^`]+)`", "\"$1\"");

        // ── pagination ──
        Pattern p_limit = Pattern.compile("LIMIT\\s+(\\d+)(?:\\s+OFFSET\\s+(\\d+))?", Pattern.CASE_INSENSITIVE);
        Matcher m_limit = p_limit.matcher(s);
        if (m_limit.find()) {
            String limit = m_limit.group(1);
            String offset = m_limit.group(2);
            String replacement = offset != null
                ? ("OFFSET " + offset + " ROWS FETCH NEXT " + limit + " ROWS ONLY")
                : ("FETCH FIRST " + limit + " ROWS ONLY");
            s = m_limit.replaceFirst("");
            s = s.trim() + "\n" + replacement + "\n";
            warnings.add("Converted LIMIT to OFFSET FETCH");
        }

        // ── functions ──
        s = s.replaceAll("(?i)\\bIFNULL\\s*\\(", "NVL(");
        s = replaceIfFunction(s, warnings);
        s = s.replaceAll("(?i)(?<![.:])NOW\\s*\\(\\s*\\d*\\s*\\)", "SYSTIMESTAMP");
        s = s.replaceAll("(?i)\\bSYSDATE\\s*\\(\\s*\\)", "SYSDATE");
        s = s.replaceAll("(?i)\\bCURDATE\\s*\\(\\s*\\)", "TRUNC(SYSDATE)");
        s = s.replaceAll("(?i)\\bSTR_TO_DATE\\s*\\(", "TO_DATE(");
        s = s.replaceAll("(?i)\\bDATE_FORMAT\\s*\\(", "TO_CHAR(");
        s = s.replaceAll("(?i)\\bGROUP_CONCAT\\s*\\(", "LISTAGG(");
        s = s.replaceAll("(?i)\\bUUID\\s*\\(\\s*\\)", "SYS_GUID()");
        s = s.replaceAll("(?i)\\bCONNECTION_ID\\s*\\(\\s*\\)", "SYS_CONTEXT('USERENV', 'SESSIONID')");
        s = s.replaceAll("(?i)\\bDATABASE\\s*\\(\\s*\\)", "SYS_CONTEXT('USERENV', 'DB_NAME')");
        s = s.replaceAll("(?i)\\bCHAR_LENGTH\\s*\\(", "LENGTH(");
        s = s.replaceAll("(?i)\\bCHARACTER_LENGTH\\s*\\(", "LENGTH(");

        // CONCAT(a, b, c) -> a || b || c
        s = replaceConcatWithPipe(s, warnings);

        // DATE_ADD(d, INTERVAL n UNIT) -> d + INTERVAL 'n' UNIT
        s = s.replaceAll("(?i)\\bDATE_ADD\\s*\\(([^,]+),\\s*INTERVAL\\s+(\\d+)\\s+(\\w+)\\)", "$1 + INTERVAL '$2' $3");

        // TRUNCATE(num, d) -> TRUNC(num, d)
        s = s.replaceAll("(?i)\\bTRUNCATE\\s*\\(", "TRUNC(");

        // DATEDIFF(d1, d2) -> CAST(d1 AS DATE) - CAST(d2 AS DATE)
        s = s.replaceAll("(?i)\\bDATEDIFF\\s*\\(([^,]+),([^)]+)\\)", "CAST($1 AS DATE) - CAST($2 AS DATE)");

        // DATE(datetime) -> TRUNC(datetime)
        s = s.replaceAll("(?i)\\bDATE\\s*\\(([^)]+)\\)", "TRUNC($1)");

        // DAYNAME -> TO_CHAR
        s = s.replaceAll("(?i)\\bDAYNAME\\s*\\(([^)]+)\\)", "TO_CHAR($1, 'Day')");

        if (Pattern.compile("\\bTIMESTAMPDIFF\\s*\\(", Pattern.CASE_INSENSITIVE).matcher(s).find()) {
            warnings.add("TIMESTAMPDIFF detected — check conversion (e.g. MONTHS_BETWEEN for MONTH)");
        }

        // ── data types ──
        s = replaceDataTypes(s, typeMapMySql(), warnings);

        // ── INSERT multiple rows ──
        s = replaceMultiRowInsert(s, warnings);

        // ── DUAL ──
        s = addDualIfNeeded(s);

        // ── subquery alias — Oracle doesn't require it ──
        s = s.replaceAll("(?i)(FROM\\s*\\(\\s*SELECT[^)]+\\))\\s+t\\b", "$1");

        return new ConvertResponse(s.trim(), warnings);
    }

    private String replaceIfFunction(String s, List<String> warnings) {
        // IF(condition, a, b) -> CASE WHEN condition THEN a ELSE b END
        Pattern p = Pattern.compile("\\bIF\\s*\\(([^)]+)\\)", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(s);
        StringBuilder sb = new StringBuilder();
        int last = 0;
        while (m.find()) {
            sb.append(s, last, m.start());
            String[] args = m.group(1).split(",");
            if (args.length == 3) {
                sb.append("CASE WHEN ").append(args[0].trim())
                  .append(" THEN ").append(args[1].trim())
                  .append(" ELSE ").append(args[2].trim()).append(" END");
                warnings.add("Converted IF() to CASE WHEN");
            } else {
                sb.append(m.group());
            }
            last = m.end();
        }
        sb.append(s.substring(last));
        return sb.toString();
    }

    private String replaceConcatWithPipe(String s, List<String> warnings) {
        // CONCAT(a, b, c) -> a || b || c
        Pattern p = Pattern.compile("\\bCONCAT\\s*\\(([^)]+)\\)", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(s);
        StringBuilder sb = new StringBuilder();
        int last = 0;
        while (m.find()) {
            sb.append(s, last, m.start());
            String[] args = m.group(1).split(",");
            String joined = String.join(" || ", Arrays.stream(args).map(String::trim).toArray(String[]::new));
            sb.append(joined);
            warnings.add("Converted CONCAT() to ||");
            last = m.end();
        }
        sb.append(s.substring(last));
        return sb.toString();
    }

    private String replaceMultiRowInsert(String s, List<String> warnings) {
        // INSERT INTO t (cols) VALUES (1,'a'),(2,'b') -> INSERT ALL INTO t (cols) VALUES ... SELECT * FROM DUAL
        Pattern p = Pattern.compile(
            "(?i)INSERT\\s+INTO\\s+(\\w+(?:\\.\\w+)?)\\s*((?:\\([^)]+\\))?)\\s*VALUES\\s*((?:\\([^)]+\\)\\s*,?\\s*)+)"
        );
        Matcher m = p.matcher(s);
        StringBuilder sb = new StringBuilder();
        int last = 0;
        while (m.find()) {
            String table = m.group(1);
            String cols = m.group(2) != null ? m.group(2) : "";
            String valsBlock = m.group(3);
            List<String> rows = new ArrayList<>();
            Matcher rowMatcher = Pattern.compile("\\(([^)]+)\\)").matcher(valsBlock);
            while (rowMatcher.find()) rows.add(rowMatcher.group(1));
            if (rows.size() <= 1) {
                sb.append(s, last, m.end());
                last = m.end();
                continue;
            }
            sb.append(s, last, m.start());
            sb.append("INSERT ALL\n");
            for (String row : rows) {
                sb.append("  INTO ").append(table).append(" ").append(cols).append(" VALUES (").append(row).append(")\n");
            }
            sb.append("SELECT * FROM DUAL");
            warnings.add("Converted multi-row INSERT to INSERT ALL");
            last = m.end();
        }
        sb.append(s.substring(last));
        return sb.toString();
    }

    private String addDualIfNeeded(String s) {
        String upper = s.stripLeading().toUpperCase();
        if (!upper.startsWith("SELECT")) return s;
        // Check if there's a FROM clause not inside a subquery
        String noParens = s.replaceAll("\\([^()]*\\)", "");
        String afterSelect = noParens.toUpperCase().split("SELECT")[0];
        // Actually need to find the last SELECT...
        int selIdx = noParens.toUpperCase().lastIndexOf("SELECT");
        if (selIdx < 0) return s;
        String rest = noParens.substring(selIdx + 6).toUpperCase();
        if (!rest.contains("FROM")) {
            s += " FROM DUAL";
        }
        return s;
    }

    private String replaceDataTypes(String s, Map<String, String> map, List<String> warnings) {
        for (var e : map.entrySet()) {
            s = s.replaceAll("(?i)\\b" + Pattern.quote(e.getKey()) + "\\b", e.getValue());
        }
        return s;
    }

    private Map<String, String> typeMapMySql() {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("LONGTEXT", "CLOB"); m.put("MEDIUMTEXT", "CLOB"); m.put("TINYTEXT", "VARCHAR2(255)");
        m.put("LONGBLOB", "BLOB"); m.put("MEDIUMBLOB", "BLOB");
        m.put("TINYBLOB", "RAW(255)"); m.put("BINARY", "RAW"); m.put("VARBINARY", "RAW");
        m.put("INT", "NUMBER(10)"); m.put("INTEGER", "NUMBER(10)");
        m.put("BIGINT", "NUMBER(19)"); m.put("SMALLINT", "NUMBER(5)");
        m.put("TINYINT", "NUMBER(3)"); m.put("MEDIUMINT", "NUMBER(7)");
        m.put("DECIMAL", "NUMBER"); m.put("NUMERIC", "NUMBER");
        m.put("FLOAT", "BINARY_DOUBLE"); m.put("DOUBLE", "BINARY_DOUBLE"); m.put("REAL", "BINARY_DOUBLE");
        m.put("DATETIME", "TIMESTAMP"); m.put("BOOLEAN", "CHAR(1)"); m.put("YEAR", "NUMBER(4)");
        // VARCHAR and NVARCHAR last (already covered above, keep these)
        m.put("VARCHAR\\(255\\)", "VARCHAR2(255)");
        return m;
    }
}
