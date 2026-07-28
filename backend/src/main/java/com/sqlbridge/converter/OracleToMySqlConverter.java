package com.sqlbridge.converter;

import com.sqlbridge.model.ConvertResponse;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
public class OracleToMySqlConverter implements SqlConverter {

    @Override
    public String source() { return "oracle"; }
    @Override
    public String target() { return "mysql"; }

    @Override
    public ConvertResponse convert(String sql) {
        List<String> warnings = new ArrayList<>();
        String s = sql;

        // DUAL removal
        s = s.replaceAll("(?i)\\bFROM\\s+DUAL\\b", "").trim();

        // Identifier quoting: "ident" -> `ident`
        s = s.replaceAll("\"([^\"]+)\"", "`$1`");

        // ── pagination ──
        // ROWNUM = 1 -> LIMIT 1
        Pattern p_rownum_eq = Pattern.compile("WHERE\\s+ROWNUM\\s*=\\s*1", Pattern.CASE_INSENSITIVE);
        Matcher m_rownum_eq = p_rownum_eq.matcher(s);
        if (m_rownum_eq.find() && !s.toUpperCase().contains("LIMIT")) {
            s = m_rownum_eq.replaceFirst("");
            s = s.trim() + " LIMIT 1";
            warnings.add("Converted ROWNUM = 1 to LIMIT 1");
        }

        // ROWNUM <= n with preceding condition: WHERE cond AND ROWNUM <= n
        Pattern p_rownum_and = Pattern.compile("WHERE\\s+(.+?)\\s+AND\\s+ROWNUM\\s*<=\\s*(\\d+)", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
        Matcher m_rownum_and = p_rownum_and.matcher(s);
        if (m_rownum_and.find() && !s.toUpperCase().contains("LIMIT")) {
            String cond = m_rownum_and.group(1).trim();
            String limit = m_rownum_and.group(2);
            String where = cond.equalsIgnoreCase("1=1") || cond.isEmpty() ? "" : ("WHERE " + cond);
            s = s.replace(m_rownum_and.group(0), where);
            s = s.trim() + " LIMIT " + limit;
            warnings.add("Converted ROWNUM <= n to LIMIT");
        }

        // ROWNUM <= n (standalone WHERE)
        Pattern p_rownum_standalone = Pattern.compile("WHERE\\s+ROWNUM\\s*<=\\s*(\\d+)", Pattern.CASE_INSENSITIVE);
        Matcher m_rownum_standalone = p_rownum_standalone.matcher(s);
        if (m_rownum_standalone.find() && !s.toUpperCase().contains("LIMIT")) {
            s = m_rownum_standalone.replaceFirst("");
            s = s.trim() + " LIMIT " + m_rownum_standalone.group(1);
            warnings.add("Converted ROWNUM <= n to LIMIT");
        }

        // FETCH FIRST n ROWS ONLY -> LIMIT n
        s = s.replaceAll("(?i)FETCH\\s+(FIRST|NEXT)\\s+(\\d+)\\s+ROWS\\s+ONLY", "");
        s = s.trim();
        Pattern p_fetch = Pattern.compile("FETCH\\s+(FIRST|NEXT)\\s+(\\d+)\\s+ROWS\\s+ONLY", Pattern.CASE_INSENSITIVE);
        Matcher m_fetch = p_fetch.matcher(sql);
        if (m_fetch.find()) {
            s += " LIMIT " + m_fetch.group(2);
            warnings.add("Converted FETCH FIRST to LIMIT");
        }

        // OFFSET m ROWS FETCH NEXT n ROWS ONLY -> LIMIT n OFFSET m
        Pattern p_off_fetch = Pattern.compile("OFFSET\\s+(\\d+)\\s+ROWS\\s+FETCH\\s+(FIRST|NEXT)\\s+(\\d+)\\s+ROWS\\s+ONLY", Pattern.CASE_INSENSITIVE);
        Matcher m_off_fetch = p_off_fetch.matcher(s);
        if (m_off_fetch.find()) {
            String offset = m_off_fetch.group(1);
            String limit = m_off_fetch.group(3);
            s = m_off_fetch.replaceFirst("");
            s = s.trim() + " LIMIT " + limit + " OFFSET " + offset;
            warnings.add("Converted OFFSET FETCH to LIMIT OFFSET");
        }

        // ── functions ──
        s = s.replaceAll("(?i)\\bNVL\\s*\\(", "IFNULL(");
        s = s.replaceAll("(?i)\\bNVL2\\s*\\(([^,]+),([^,]+),([^)]+)\\)", "IF($1 IS NOT NULL, $2, $3)");

        // DECODE
        s = decodeToCase(s, warnings);

        // LISTAGG -> GROUP_CONCAT
        s = s.replaceAll("(?i)\\bLISTAGG\\s*\\(([^,]+)\\s*,\\s*([^)]+)\\)\\s*WITHIN\\s+GROUP\\s*\\([^)]+\\)", "GROUP_CONCAT($1 SEPARATOR $2)");
        if (!s.equals(sql) && s.contains("GROUP_CONCAT")) {
            warnings.add("Converted LISTAGG to GROUP_CONCAT");
        }

        // SYSDATE -> NOW() — must happen after TRUNC handling (see below)
        // We handle date functions in a careful order

        // ── date/time ──
        // TRUNC(SYSDATE), TRUNC(SYSTIMESTAMP), etc
        s = s.replaceAll("(?i)\\bTRUNC\\s*\\((SYSDATE|SYSTIMESTAMP|CURRENT_DATE|CURRENT_TIMESTAMP)\\)", "DATE($1)");
        s = s.replaceAll("(?i)\\bTRUNC\\s*\\((\\w+(?:\\.\\w+)?)\\)", "CAST($1 AS DATE)");

        s = s.replaceAll("(?i)\\bSYSDATE\\b", "NOW()");
        s = s.replaceAll("(?i)\\bSYSTIMESTAMP\\b", "NOW(6)");
        s = s.replaceAll("(?i)\\bCURRENT_DATE\\b(?!\\s*\\()", "CURDATE()");
        s = s.replaceAll("(?i)\\bLOCALTIMESTAMP\\b", "LOCALTIMESTAMP");

        s = s.replaceAll("(?i)\\bTO_DATE\\s*\\(", "STR_TO_DATE(");
        s = s.replaceAll("(?i)\\bTO_CHAR\\s*\\(", "DATE_FORMAT(");
        s = s.replaceAll("(?i)\\bTO_TIMESTAMP\\s*\\(", "STR_TO_DATE(");

        // ADD_MONTHS(d, n) -> DATE_ADD(d, INTERVAL n MONTH)
        s = s.replaceAll("(?i)\\bADD_MONTHS\\s*\\(([^,]+),([^)]+)\\)", "DATE_ADD($1, INTERVAL $2 MONTH)");
        if (!s.equals(sql) && s.contains("DATE_ADD")) {
            warnings.add("Converted ADD_MONTHS to DATE_ADD");
        }

        // MONTHS_BETWEEN(d1, d2) -> TIMESTAMPDIFF(MONTH, d2, d1)
        s = s.replaceAll("(?i)\\bMONTHS_BETWEEN\\s*\\(([^,]+),([^)]+)\\)", "TIMESTAMPDIFF(MONTH, $2, $1)");
        if (!s.equals(sql) && s.contains("TIMESTAMPDIFF")) {
            warnings.add("Converted MONTHS_BETWEEN to TIMESTAMPDIFF");
        }

        if (Pattern.compile("\\bNEXT_DAY\\s*\\(", Pattern.CASE_INSENSITIVE).matcher(s).find()) {
            warnings.add("NEXT_DAY detected — manual conversion may be needed");
        }
        if (Pattern.compile("\\bLAST_DAY\\s*\\(", Pattern.CASE_INSENSITIVE).matcher(s).find()) {
            warnings.add("LAST_DAY — MySQL 8.0+ has LAST_DAY(), check compatibility");
        }

        // SYS_GUID() -> UUID()
        s = s.replaceAll("(?i)\\bSYS_GUID\\s*\\(\\s*\\)", "UUID()");

        // LENGTH -> CHAR_LENGTH
        s = replaceLengthWithCharLength(s, warnings);

        // ── || concat -> CONCAT(a, b, c) ──
        s = replaceConcat(s);

        // ── joins ──
        s = s.replaceAll("(?i),\\s*(\\w+)\\s+(\\w+)\\s+WHERE\\s+\\2\\.\\w+\\s*\\(\\+\\)\\s*=\\s*(\\w+\\.\\w+)", "LEFT JOIN $1 $2 ON $2.$3 = $3");
        s = s.replaceAll("\\(\\+\\)", "");

        // ── subquery alias ──
        Pattern p_subq = Pattern.compile("(?i)FROM\\s*\\(\\s*SELECT\\b", Pattern.DOTALL);
        if (p_subq.matcher(s).find() && !s.matches("(?i).*FROM\\s*\\(\\s*SELECT.*\\)\\s+\\w+.*")) {
            s = s.replaceAll("(?i)(FROM\\s*\\(\\s*SELECT[^)]+\\))(?!\\s+\\w)", "$1 t");
            warnings.add("Added alias for subquery in FROM clause");
        }

        // ── ORDER BY NULLS FIRST|LAST -> remove ──
        s = s.replaceAll("(?i)\\bNULLS\\s+(FIRST|LAST)\\b", "").trim();

        // ── data types ──
        s = replaceDataTypes(s, typeMapOracle(), warnings);

        // ── warnings ──
        if (Pattern.compile("\\w+\\.NEXTVAL", Pattern.CASE_INSENSITIVE).matcher(s).find())
            warnings.add("Sequence NEXTVAL detected — replace with AUTO_INCREMENT or (SELECT MAX(id)+1)");
        if (Pattern.compile("\\w+\\.CURRVAL", Pattern.CASE_INSENSITIVE).matcher(s).find())
            warnings.add("Sequence CURRVAL detected — manual conversion needed");
        if (Pattern.compile("\\bCONNECT\\s+BY\\b", Pattern.CASE_INSENSITIVE).matcher(s).find())
            warnings.add("CONNECT BY detected — rewrite to WITH RECURSIVE manually");
        if (Pattern.compile("\\bMATCH_RECOGNIZE\\b", Pattern.CASE_INSENSITIVE).matcher(s).find())
            warnings.add("MATCH_RECOGNIZE detected — not supported in MySQL");
        if (Pattern.compile("\\bMERGE\\s+INTO\\b", Pattern.CASE_INSENSITIVE).matcher(s).find())
            warnings.add("MERGE detected — rewrite to INSERT ... ON DUPLICATE KEY UPDATE");

        return new ConvertResponse(s.trim(), warnings);
    }

    private String replaceConcat(String s) {
        // Match identifier/string || identifier/string [ || ... ]
        StringBuilder sb = new StringBuilder();
        Pattern p = Pattern.compile("(?:(?:\\w+(?:\\.\\w+)?|'[^']*')\\s*\\|\\|\\s*)+(?:\\w+(?:\\.\\w+)?|'[^']*')", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(s);
        int last = 0;
        while (m.find()) {
            sb.append(s, last, m.start());
            String expr = m.group();
            String[] parts = expr.split("\\s*\\|\\|\\s*");
            sb.append("CONCAT(").append(String.join(", ", parts)).append(")");
            last = m.end();
        }
        sb.append(s.substring(last));
        return sb.toString();
    }

    private String decodeToCase(String s, List<String> warnings) {
        Pattern p = Pattern.compile("\\bDECODE\\s*\\(([^)]+)\\)", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(s);
        StringBuilder sb = new StringBuilder();
        int last = 0;
        while (m.find()) {
            sb.append(s, last, m.start());
            String argsStr = m.group(1);
            String[] args = argsStr.split(",");
            for (int i = 0; i < args.length; i++) args[i] = args[i].trim();

            sb.append("CASE ").append(args[0]);
            int i = 1;
            while (i < args.length - 1) {
                sb.append(" WHEN ").append(args[i]).append(" THEN ").append(args[i + 1]);
                i += 2;
            }
            if (i == args.length - 1) {
                sb.append(" ELSE ").append(args[args.length - 1]);
            }
            sb.append(" END");
            last = m.end();
            warnings.add("Converted DECODE to CASE");
        }
        sb.append(s.substring(last));
        return sb.toString();
    }

    private String replaceLengthWithCharLength(String s, List<String> warnings) {
        // Only replace LENGTH( when the argument looks like a string column (not numeric)
        // Heuristic: replace all LENGTH( that aren't preceded by .
        String result = s.replaceAll("(?<![.:])\\bLENGTH\\s*\\(", "CHAR_LENGTH(");
        if (!result.equals(s)) warnings.add("Converted LENGTH to CHAR_LENGTH");
        return result;
    }

    private String replaceDataTypes(String s, Map<String, String> map, List<String> warnings) {
        for (var e : map.entrySet()) {
            s = s.replaceAll("(?i)\\b" + Pattern.quote(e.getKey()) + "\\b", e.getValue());
        }
        return s;
    }

    private Map<String, String> typeMapOracle() {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("VARCHAR2", "VARCHAR"); m.put("NVARCHAR2", "NVARCHAR");
        m.put("CLOB", "LONGTEXT"); m.put("BLOB", "LONGBLOB"); m.put("NCLOB", "LONGTEXT");
        m.put("RAW", "VARBINARY"); m.put("LONG RAW", "LONGBLOB"); m.put("LONG", "LONGTEXT");
        m.put("BFILE", "VARCHAR(255)"); m.put("ROWID", "CHAR(10)"); m.put("UROWID", "VARCHAR");
        m.put("FLOAT", "DOUBLE"); m.put("BINARY_FLOAT", "FLOAT"); m.put("BINARY_DOUBLE", "DOUBLE");
        m.put("XMLTYPE", "LONGTEXT");
        return m;
    }
}
