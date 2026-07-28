package com.sqlbridge.converter;

import com.sqlbridge.model.ConvertResponse;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
public class OracleToMySqlConverter implements SqlConverter {

    private static final List<Pattern> UNCERTAIN_PATTERNS = List.of(
        Pattern.compile("SELECT\\s+.*\\bROWNUM\\b.*WHERE\\s+.*\\brnum\\b", Pattern.CASE_INSENSITIVE | Pattern.DOTALL),
        Pattern.compile("\\bCONNECT\\s+BY\\b", Pattern.CASE_INSENSITIVE),
        Pattern.compile("\\w+\\.NEXTVAL", Pattern.CASE_INSENSITIVE),
        Pattern.compile("\\w+\\.CURRVAL", Pattern.CASE_INSENSITIVE),
        Pattern.compile("\\bMATCH_RECOGNIZE\\b", Pattern.CASE_INSENSITIVE),
        Pattern.compile("\\bMERGE\\s+INTO\\b", Pattern.CASE_INSENSITIVE),
        Pattern.compile("\\bNEXT_DAY\\s*\\(", Pattern.CASE_INSENSITIVE),
        Pattern.compile("\\bPIVOT\\b", Pattern.CASE_INSENSITIVE),
        Pattern.compile("\\bUNPIVOT\\b", Pattern.CASE_INSENSITIVE),
        Pattern.compile("\\bINSTR\\s*\\([^)]*,[^)]*,[^)]*,[^)]*\\)", Pattern.CASE_INSENSITIVE)
    );

    @Override
    public String source() { return "oracle"; }
    @Override
    public String target() { return "mysql"; }

    @Override
    public ConvertResponse convert(String sql) {
        List<String> warnings = new ArrayList<>();

        // Check for uncertain patterns first
        for (Pattern p : UNCERTAIN_PATTERNS) {
            Matcher m = p.matcher(sql);
            if (m.find()) {
                String pat = p.pattern();
                String reason;
                if (pat.contains("ROWNUM")) reason = "Nested ROWNUM pagination pattern";
                else if (pat.contains("CONNECT")) reason = "CONNECT BY hierarchical query";
                else if (pat.contains("NEXTVAL")) reason = "Sequence reference (NEXTVAL)";
                else if (pat.contains("CURRVAL")) reason = "Sequence reference (CURRVAL)";
                else if (pat.contains("MATCH")) reason = "MATCH_RECOGNIZE pattern matching";
                else if (pat.contains("MERGE")) reason = "MERGE statement";
                else if (pat.contains("NEXT_DAY")) reason = "NEXT_DAY function";
                else if (pat.contains("PIVOT")) reason = "PIVOT clause";
                else if (pat.contains("UNPIVOT")) reason = "UNPIVOT clause";
                else if (pat.contains("INSTR")) reason = "INSTR with 4 arguments";
                else reason = "Unsupported construct";
                warnings.add(reason + " detected — automatic conversion may be incorrect");
                return new ConvertResponse(
                    "\u26A0\uFE0F  Conversion not attempted \u2014 " + reason.toLowerCase() + " requires manual review.\n\n" + sql,
                    warnings
                );
            }
        }

        String s = sql;

        // DUAL removal
        s = s.replaceAll("(?i)\\bFROM\\s+DUAL\\b", "").trim();

        // Identifier quoting: "ident" -> `ident`
        s = s.replaceAll("\"([^\"]+)\"", "`$1`");

        // ── pagination ──
        // ROWNUM = 1 -> LIMIT 1
        if (Pattern.compile("WHERE\\s+ROWNUM\\s*=\\s*1", Pattern.CASE_INSENSITIVE).matcher(s).find()
            && !s.toUpperCase().contains("LIMIT")) {
            s = s.replaceAll("(?i)WHERE\\s+ROWNUM\\s*=\\s*1", "");
            s = s.trim() + " LIMIT 1";
            warnings.add("Converted ROWNUM = 1 to LIMIT 1");
        }

        // ROWNUM <= n with preceding condition
        Pattern p_ra = Pattern.compile("WHERE\\s+(.+?)\\s+AND\\s+ROWNUM\\s*<=\\s*(\\d+)", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
        Matcher m_ra = p_ra.matcher(s);
        if (m_ra.find() && !s.toUpperCase().contains("LIMIT")) {
            String cond = m_ra.group(1).trim();
            String limit = m_ra.group(2);
            s = s.replace(m_ra.group(0), cond.equalsIgnoreCase("1=1") || cond.isEmpty() ? "" : "WHERE " + cond);
            s = s.trim() + " LIMIT " + limit;
            warnings.add("Converted ROWNUM <= n to LIMIT");
        }

        // ROWNUM <= n (standalone)
        Pattern p_rs = Pattern.compile("WHERE\\s+ROWNUM\\s*<=\\s*(\\d+)", Pattern.CASE_INSENSITIVE);
        Matcher m_rs = p_rs.matcher(s);
        if (m_rs.find() && !s.toUpperCase().contains("LIMIT")) {
            s = m_rs.replaceFirst("");
            s = s.trim() + " LIMIT " + m_rs.group(1);
            warnings.add("Converted ROWNUM <= n to LIMIT");
        }

        // FETCH FIRST n ROWS ONLY -> LIMIT n
        Pattern p_fetch = Pattern.compile("FETCH\\s+(FIRST|NEXT)\\s+(\\d+)\\s+ROWS\\s+ONLY", Pattern.CASE_INSENSITIVE);
        Matcher m_fetch = p_fetch.matcher(s);
        if (m_fetch.find()) {
            s = m_fetch.replaceFirst("").trim() + " LIMIT " + m_fetch.group(2);
            warnings.add("Converted FETCH FIRST to LIMIT");
        }

        // OFFSET m ROWS FETCH NEXT n ROWS ONLY -> LIMIT n OFFSET m
        Pattern p_of = Pattern.compile("OFFSET\\s+(\\d+)\\s+ROWS\\s+FETCH\\s+(FIRST|NEXT)\\s+(\\d+)\\s+ROWS\\s+ONLY", Pattern.CASE_INSENSITIVE);
        Matcher m_of = p_of.matcher(s);
        if (m_of.find()) {
            s = m_of.replaceFirst("").trim() + " LIMIT " + m_of.group(3) + " OFFSET " + m_of.group(1);
            warnings.add("Converted OFFSET FETCH to LIMIT OFFSET");
        }

        // ── functions ──
        s = s.replaceAll("(?i)\\bNVL\\s*\\(", "IFNULL(");
        s = replaceNvl2(s, warnings);
        s = decodeToCase(s, warnings);

        s = s.replaceAll("(?i)\\bLISTAGG\\s*\\(([^,]+)\\s*,\\s*([^)]+)\\)\\s*WITHIN\\s+GROUP\\s*\\([^)]+\\)",
            "GROUP_CONCAT($1 SEPARATOR $2)");
        if (s.contains("GROUP_CONCAT")) warnings.add("Converted LISTAGG to GROUP_CONCAT");

        // ── date/time ──
        s = s.replaceAll("(?i)\\bTRUNC\\s*\\((SYSDATE|SYSTIMESTAMP|CURRENT_DATE|CURRENT_TIMESTAMP)\\)", "DATE($1)");
        s = s.replaceAll("(?i)\\bTRUNC\\s*\\((\\w+(?:\\.\\w+)?)\\)", "CAST($1 AS DATE)");

        s = s.replaceAll("(?i)\\bSYSDATE\\b", "NOW()");
        s = s.replaceAll("(?i)\\bSYSTIMESTAMP\\b", "NOW(6)");
        s = s.replaceAll("(?i)\\bCURRENT_DATE\\b(?!\\s*\\()", "CURDATE()");
        s = s.replaceAll("(?i)\\bLOCALTIMESTAMP\\b", "LOCALTIMESTAMP");

        s = replaceToChar(s, warnings);
        s = replaceToDate(s, warnings);
        s = s.replaceAll("(?i)\\bTO_TIMESTAMP\\s*\\(", "STR_TO_DATE(");

        s = s.replaceAll("(?i)\\bADD_MONTHS\\s*\\(([^,]+),([^)]+)\\)", "DATE_ADD($1, INTERVAL $2 MONTH)");
        s = s.replaceAll("(?i)\\bMONTHS_BETWEEN\\s*\\(([^,]+),([^)]+)\\)", "TIMESTAMPDIFF(MONTH, $2, $1)");

        if (Pattern.compile("\\bLAST_DAY\\s*\\(", Pattern.CASE_INSENSITIVE).matcher(s).find()) {
            warnings.add("LAST_DAY — MySQL 8.0+ has LAST_DAY(), check compatibility");
        }

        s = s.replaceAll("(?i)\\bSYS_GUID\\s*\\(\\s*\\)", "UUID()");
        s = replaceLengthWithCharLength(s, warnings);
        s = replaceConcat(s);

        // ── joins ──
        s = s.replaceAll("(?i),\\s*(\\w+)\\s+(\\w+)\\s+WHERE\\s+\\2\\.\\w+\\s*\\(\\+\\)\\s*=\\s*(\\w+\\.\\w+)",
            "LEFT JOIN $1 $2 ON $2.$3 = $3");

        // ── subquery alias ──
        if (Pattern.compile("(?i)FROM\\s*\\(\\s*SELECT\\b", Pattern.DOTALL).matcher(s).find()
            && !s.matches("(?i).*FROM\\s*\\(\\s*SELECT.*\\)\\s+\\w+.*")) {
            s = s.replaceAll("(?i)(FROM\\s*\\(\\s*SELECT[^)]+\\))(?!\\s+\\w)", "$1 t");
            warnings.add("Added alias for subquery in FROM clause");
        }

        // ── ORDER BY NULLS FIRST|LAST -> remove ──
        s = s.replaceAll("(?i)\\bNULLS\\s+(FIRST|LAST)\\b", "").trim();

        // ── data types ──
        s = replaceDataTypes(s);

        return new ConvertResponse(s.trim(), warnings);
    }

    // ─── helpers ─────────────────────────────────────────────────

    private List<String> splitArgs(String args) {
        List<String> parts = new ArrayList<>();
        int depth = 0;
        boolean inSingle = false, inDouble = false;
        StringBuilder cur = new StringBuilder();
        for (int i = 0; i < args.length(); i++) {
            char c = args.charAt(i);
            if (c == '\'' && !inDouble) { inSingle = !inSingle; cur.append(c); continue; }
            if (c == '"' && !inSingle) { inDouble = !inDouble; cur.append(c); continue; }
            if (!inSingle && !inDouble) {
                if (c == '(') { depth++; cur.append(c); continue; }
                if (c == ')') { depth--; cur.append(c); continue; }
                if (c == ',' && depth == 0) {
                    parts.add(cur.toString().trim());
                    cur = new StringBuilder();
                    continue;
                }
            }
            cur.append(c);
        }
        parts.add(cur.toString().trim());
        return parts;
    }

    private String replaceNvl2(String s, List<String> warnings) {
        Pattern p = Pattern.compile("\\bNVL2\\s*\\(([^)]+)\\)", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(s);
        StringBuilder sb = new StringBuilder();
        int last = 0;
        while (m.find()) {
            sb.append(s, last, m.start());
            List<String> args = splitArgs(m.group(1));
            if (args.size() >= 3) {
                sb.append("IF(").append(args.get(0)).append(" IS NOT NULL, ")
                  .append(args.get(1)).append(", ").append(args.get(2)).append(")");
                warnings.add("Converted NVL2 to IF");
            } else {
                sb.append(m.group());
            }
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
            List<String> args = splitArgs(m.group(1));
            if (args.isEmpty()) { sb.append(m.group()); last = m.end(); continue; }
            sb.append("CASE ").append(args.get(0));
            int i = 1;
            while (i < args.size() - 1) {
                sb.append(" WHEN ").append(args.get(i)).append(" THEN ").append(args.get(i + 1));
                i += 2;
            }
            if (i == args.size() - 1) sb.append(" ELSE ").append(args.get(args.size() - 1));
            sb.append(" END");
            last = m.end();
            warnings.add("Converted DECODE to CASE");
        }
        sb.append(s.substring(last));
        return sb.toString();
    }

    private String replaceToChar(String s, List<String> warnings) {
        Pattern p = Pattern.compile("\\bTO_CHAR\\s*\\(([^,]+),\\s*'([^']+)'\\s*\\)", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(s);
        StringBuilder sb = new StringBuilder();
        int last = 0;
        while (m.find()) {
            sb.append(s, last, m.start());
            String fmt = m.group(2);
            boolean isNumberFmt = fmt.matches(".*[90GDLC].*") && !fmt.matches(".*[YMDHMS].*");
            if (isNumberFmt) {
                // Return original SQL with warning — can't safely convert number TO_CHAR
                return s;
            }
            sb.append("DATE_FORMAT(").append(m.group(1)).append(", '")
              .append(translateOracleFmt(fmt)).append("')");
            warnings.add("Converted TO_CHAR(date) to DATE_FORMAT");
            last = m.end();
        }
        sb.append(s.substring(last));
        return sb.toString();
    }

    private String replaceToDate(String s, List<String> warnings) {
        Pattern p = Pattern.compile("\\bTO_DATE\\s*\\(([^,]+),\\s*('[^']*')\\s*\\)", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(s);
        if (!m.find()) return s.replaceAll("(?i)\\bTO_DATE\\s*\\(", "STR_TO_DATE(");
        warnings.add("Converted TO_DATE to STR_TO_DATE");
        return m.replaceAll(mr ->
            "STR_TO_DATE(" + mr.group(1) + ", " + translateOracleFmt(mr.group(2)) + ")"
        );
    }

    private String translateOracleFmt(String fmt) {
        boolean quoted = fmt.startsWith("'") && fmt.endsWith("'");
        String inner = quoted ? fmt.substring(1, fmt.length() - 1) : fmt;
        inner = inner
            .replace("YYYY", "%Y").replace("YY", "%y")
            .replace("MM", "%m").replace("MONTH", "%M").replace("MON", "%b")
            .replace("DD", "%d").replace("DAY", "%W").replace("DY", "%a")
            .replace("HH24", "%H").replace("HH12", "%h").replace("HH", "%H")
            .replace("MI", "%i").replace("SS", "%s").replace("FF", "%f")
            .replace("AM", "%p").replace("PM", "%p");
        return quoted ? "'" + inner + "'" : inner;
    }

    private String replaceConcat(String s) {
        StringBuilder sb = new StringBuilder();
        Pattern p = Pattern.compile("(?:(?:\\w+(?:\\.\\w+)?|'[^']*')\\s*\\|\\|\\s*)+(?:\\w+(?:\\.\\w+)?|'[^']*')", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(s);
        int last = 0;
        while (m.find()) {
            sb.append(s, last, m.start());
            sb.append("CONCAT(").append(String.join(", ", m.group().split("\\s*\\|\\|\\s*"))).append(")");
            last = m.end();
        }
        sb.append(s.substring(last));
        return sb.toString();
    }

    private String replaceLengthWithCharLength(String s, List<String> warnings) {
        String r = s.replaceAll("(?<![.:])\\bLENGTH\\s*\\(", "CHAR_LENGTH(");
        if (!r.equals(s)) warnings.add("Converted LENGTH to CHAR_LENGTH");
        return r;
    }

    private String replaceDataTypes(String s) {
        for (var e : typeMapOracle().entrySet())
            s = s.replaceAll("(?i)\\b" + Pattern.quote(e.getKey()) + "\\b", e.getValue());
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
