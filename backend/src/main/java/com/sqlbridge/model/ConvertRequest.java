package com.sqlbridge.model;

import com.fasterxml.jackson.annotation.JsonProperty;

public class ConvertRequest {
    private String sql;
    private String source;
    private String target;

    public String getSql() { return sql; }
    public void setSql(String sql) { this.sql = sql; }

    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }

    public String getTarget() { return target; }
    public void setTarget(String target) { this.target = target; }
}
