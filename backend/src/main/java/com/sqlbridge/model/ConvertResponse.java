package com.sqlbridge.model;

import java.util.List;

public class ConvertResponse {
    private String output;
    private List<String> warnings;

    public ConvertResponse() {}

    public ConvertResponse(String output, List<String> warnings) {
        this.output = output;
        this.warnings = warnings;
    }

    public String getOutput() { return output; }
    public void setOutput(String output) { this.output = output; }
    public List<String> getWarnings() { return warnings; }
    public void setWarnings(List<String> warnings) { this.warnings = warnings; }
}
