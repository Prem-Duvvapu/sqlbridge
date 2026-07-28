package com.sqlbridge;

import com.sqlbridge.converter.MySqlToOracleConverter;
import com.sqlbridge.converter.OracleToMySqlConverter;
import com.sqlbridge.model.ConvertResponse;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ConverterTest {

    private final OracleToMySqlConverter o2m = new OracleToMySqlConverter();
    private final MySqlToOracleConverter m2o = new MySqlToOracleConverter();

    // ─── Oracle → MySQL ──────────────────────────────────────

    @Test
    void o2m_rownum_equals_1() {
        ConvertResponse r = o2m.convert("SELECT * FROM emp WHERE ROWNUM = 1");
        assertEquals("SELECT * FROM emp LIMIT 1", r.getOutput());
        assertTrue(r.getWarnings().stream().anyMatch(w -> w.contains("ROWNUM")));
    }

    @Test
    void o2m_rownum_with_condition() {
        ConvertResponse r = o2m.convert("SELECT * FROM emp WHERE dept_id = 10 AND ROWNUM <= 5");
        assertEquals("SELECT * FROM emp WHERE dept_id = 10 LIMIT 5", r.getOutput());
    }

    @Test
    void o2m_rownum_standalone() {
        ConvertResponse r = o2m.convert("SELECT * FROM emp WHERE ROWNUM <= 10");
        assertEquals("SELECT * FROM emp LIMIT 10", r.getOutput());
    }

    @Test
    void o2m_fetch_first() {
        ConvertResponse r = o2m.convert("SELECT * FROM emp FETCH FIRST 10 ROWS ONLY");
        assertEquals("SELECT * FROM emp LIMIT 10", r.getOutput());
    }

    @Test
    void o2m_offset_fetch() {
        ConvertResponse r = o2m.convert("SELECT * FROM emp OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY");
        assertEquals("SELECT * FROM emp LIMIT 10 OFFSET 20", r.getOutput());
    }

    @Test
    void o2m_nvl() {
        assertOutput("SELECT name, IFNULL(salary, 0) FROM emp",
            o2m.convert("SELECT name, NVL(salary, 0) FROM emp"));
    }

    @Test
    void o2m_nvl2() {
        assertOutput("SELECT IF(comm IS NOT NULL, comm, 0) FROM emp",
            o2m.convert("SELECT NVL2(comm, comm, 0) FROM emp"));
    }

    @Test
    void o2m_decode() {
        assertOutput("SELECT CASE status WHEN 'A' THEN 'Active' ELSE 'Unknown' END FROM emp",
            o2m.convert("SELECT DECODE(status, 'A', 'Active', 'Unknown') FROM emp"));
    }

    @Test
    void o2m_listagg() {
        assertOutput("SELECT GROUP_CONCAT(name SEPARATOR ',') FROM emp",
            o2m.convert("SELECT LISTAGG(name, ',') WITHIN GROUP (ORDER BY name) FROM emp"));
    }

    @Test
    void o2m_sysdate() {
        ConvertResponse r = o2m.convert("SELECT SYSDATE FROM DUAL");
        assertEquals("SELECT NOW()", r.getOutput());
    }

    @Test
    void o2m_to_date() {
        assertOutput("SELECT STR_TO_DATE('2024-01-01', 'YYYY-MM-DD')",
            o2m.convert("SELECT TO_DATE('2024-01-01', 'YYYY-MM-DD') FROM DUAL"));
    }

    @Test
    void o2m_to_char() {
        assertOutput("SELECT DATE_FORMAT(hire_date, 'YYYY') FROM emp",
            o2m.convert("SELECT TO_CHAR(hire_date, 'YYYY') FROM emp"));
    }

    @Test
    void o2m_concat_pipe() {
        ConvertResponse r = o2m.convert("SELECT first_name || ' ' || last_name AS full FROM emp");
        assertEquals("SELECT CONCAT(first_name, ' ', last_name) AS full FROM emp", r.getOutput());
    }

    @Test
    void o2m_add_months() {
        assertOutput("SELECT DATE_ADD(hire_date, INTERVAL 3 MONTH) FROM emp",
            o2m.convert("SELECT ADD_MONTHS(hire_date, 3) FROM emp"));
    }

    @Test
    void o2m_trunc_sysdate() {
        ConvertResponse r = o2m.convert("SELECT TRUNC(SYSDATE) FROM DUAL");
        assertEquals("SELECT DATE(NOW())", r.getOutput());
    }

    @Test
    void o2m_sys_guid() {
        assertOutput("SELECT UUID()", o2m.convert("SELECT SYS_GUID() FROM DUAL"));
    }

    @Test
    void o2m_data_types() {
        String input = "CREATE TABLE t (id NUMBER(10), name VARCHAR2(100), c CLOB)";
        String expected = "CREATE TABLE t (id DECIMAL(10), name VARCHAR(100), c LONGTEXT)";
        assertOutput(expected, o2m.convert(input));
    }

    @Test
    void o2m_ident_quoting() {
        assertOutput("SELECT * FROM `employees`",
            o2m.convert("SELECT * FROM \"employees\""));
    }

    @Test
    void o2m_rownum_semicolon() {
        ConvertResponse r = o2m.convert("SELECT * FROM emp WHERE ROWNUM <= 5;");
        assertEquals("SELECT * FROM emp LIMIT 5", r.getOutput());
    }

    @Test
    void o2m_connect_by_warning() {
        ConvertResponse r = o2m.convert("SELECT * FROM emp START WITH id=1 CONNECT BY PRIOR id = mgr_id");
        assertTrue(r.getWarnings().stream().anyMatch(w -> w.contains("CONNECT BY")));
    }

    @Test
    void o2m_sequence_warning() {
        ConvertResponse r = o2m.convert("SELECT seq_emp.NEXTVAL FROM DUAL");
        assertTrue(r.getWarnings().stream().anyMatch(w -> w.contains("NEXTVAL")));
    }

    @Test
    void o2m_nulls_last_removed() {
        ConvertResponse r = o2m.convert("SELECT * FROM emp ORDER BY name NULLS LAST");
        assertEquals("SELECT * FROM emp ORDER BY name", r.getOutput());
    }

    // ─── MySQL → Oracle ──────────────────────────────────────

    @Test
    void m2o_limit() {
        ConvertResponse r = m2o.convert("SELECT * FROM emp LIMIT 5");
        assertTrue(r.getOutput().contains("FETCH FIRST 5 ROWS ONLY"));
    }

    @Test
    void m2o_limit_offset() {
        ConvertResponse r = m2o.convert("SELECT * FROM emp LIMIT 10 OFFSET 20");
        assertTrue(r.getOutput().contains("OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY"));
    }

    @Test
    void m2o_limit_semicolon() {
        ConvertResponse r = m2o.convert("SELECT * FROM app_user LIMIT 510;");
        String out = r.getOutput().stripTrailing();
        assertTrue(out.endsWith("FETCH FIRST 510 ROWS ONLY"));
        assertFalse(out.contains(";"));
    }

    @Test
    void m2o_ifnull() {
        assertOutput("SELECT NVL(salary, 0) FROM emp",
            m2o.convert("SELECT IFNULL(salary, 0) FROM emp"));
    }

    @Test
    void m2o_if_func() {
        assertOutput("SELECT CASE WHEN status = 1 THEN 'a' ELSE 'b' END FROM users",
            m2o.convert("SELECT IF(status = 1, 'a', 'b') FROM users"));
    }

    @Test
    void m2o_now() {
        assertOutput("SELECT SYSTIMESTAMP FROM DUAL", m2o.convert("SELECT NOW()"));
    }

    @Test
    void m2o_concat() {
        assertOutput("SELECT first_name || ' ' || last_name AS full FROM emp",
            m2o.convert("SELECT CONCAT(first_name, ' ', last_name) AS full FROM emp"));
    }

    @Test
    void m2o_uuid() {
        assertOutput("SELECT SYS_GUID() FROM DUAL", m2o.convert("SELECT UUID()"));
    }

    @Test
    void m2o_char_length() {
        assertOutput("SELECT LENGTH(name) FROM emp",
            m2o.convert("SELECT CHAR_LENGTH(name) FROM emp"));
    }

    @Test
    void m2o_date_format() {
        assertOutput("SELECT TO_CHAR(created_at, '%Y-%m-%d') FROM posts",
            m2o.convert("SELECT DATE_FORMAT(created_at, '%Y-%m-%d') FROM posts"));
    }

    @Test
    void m2o_str_to_date() {
        assertOutput("SELECT TO_DATE('2024-01-01', '%Y-%m-%d') FROM DUAL",
            m2o.convert("SELECT STR_TO_DATE('2024-01-01', '%Y-%m-%d')"));
    }

    @Test
    void m2o_datediff() {
        assertOutput("SELECT CAST(NOW() AS DATE) - CAST(hire_date AS DATE) FROM emp",
            m2o.convert("SELECT DATEDIFF(NOW(), hire_date) FROM emp"));
    }

    @Test
    void m2o_data_types() {
        String input = "CREATE TABLE t (id INT, name VARCHAR(100), bl LONGBLOB)";
        String expected = "CREATE TABLE t (id NUMBER(10), name VARCHAR2(100), bl BLOB)";
        assertOutput(expected, m2o.convert(input));
    }

    @Test
    void m2o_ident_quoting() {
        assertOutput("SELECT * FROM \"employees\"",
            m2o.convert("SELECT * FROM `employees`"));
    }

    @Test
    void m2o_select_1() {
        assertOutput("SELECT 1 FROM DUAL", m2o.convert("SELECT 1"));
    }

    @Test
    void m2o_database_func() {
        assertOutput("SELECT SYS_CONTEXT('USERENV', 'DB_NAME') FROM DUAL",
            m2o.convert("SELECT DATABASE()"));
    }

    @Test
    void m2o_group_concat() {
        assertOutput("SELECT LISTAGG(name, ',') FROM emp",
            m2o.convert("SELECT GROUP_CONCAT(name, ',') FROM emp"));
    }

    @Test
    void m2o_date_add() {
        assertOutput("SELECT hire_date + INTERVAL '3' MONTH FROM emp",
            m2o.convert("SELECT DATE_ADD(hire_date, INTERVAL 3 MONTH) FROM emp"));
    }

    @Test
    void m2o_multi_row_insert() {
        String input = "INSERT INTO t (id, name) VALUES (1, 'a'), (2, 'b'), (3, 'c')";
        ConvertResponse r = m2o.convert(input);
        assertTrue(r.getOutput().contains("INSERT ALL"));
        assertTrue(r.getOutput().contains("SELECT * FROM DUAL"));
    }

    @Test
    void m2o_tinyint_type() {
        assertOutput("CREATE TABLE t (id NUMBER(3))",
            m2o.convert("CREATE TABLE t (id TINYINT)"));
    }

    // ─── helpers ─────────────────────────────────────────────

    private void assertOutput(String expected, ConvertResponse r) {
        assertEquals(expected, r.getOutput());
    }
}
