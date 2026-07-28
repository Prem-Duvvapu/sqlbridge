package com.sqlbridge.controller;

import com.sqlbridge.model.*;
import com.sqlbridge.service.ConverterRegistry;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@CrossOrigin(origins = "*")
public class ConvertController {

    private final ConverterRegistry registry;

    public ConvertController(ConverterRegistry registry) {
        this.registry = registry;
    }

    @PostMapping("/convert")
    public ConvertResponse convert(@RequestBody ConvertRequest req) {
        return registry.convert(req.getSql(), req.getSource(), req.getTarget());
    }

    @GetMapping("/dialects")
    public DialectsResponse dialects() {
        List<DialectInfo> sources = registry.getSources();
        return new DialectsResponse(sources);
    }

    @GetMapping("/health")
    public HealthResponse health() {
        return new HealthResponse("ok");
    }

    record DialectsResponse(List<DialectInfo> sources) {}
    record HealthResponse(String status) {}
}
