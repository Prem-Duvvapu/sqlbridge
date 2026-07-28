package com.sqlbridge.service;

import com.sqlbridge.converter.SqlConverter;
import com.sqlbridge.model.ConvertResponse;
import com.sqlbridge.model.DialectInfo;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class ConverterRegistry {

    private final Map<String, SqlConverter> converterMap = new LinkedHashMap<>();

    public ConverterRegistry(List<SqlConverter> converters) {
        for (SqlConverter c : converters) {
            converterMap.put(key(c.source(), c.target()), c);
        }
    }

    private static String key(String source, String target) {
        return source.toLowerCase() + "->" + target.toLowerCase();
    }

    public ConvertResponse convert(String sql, String source, String target) {
        SqlConverter c = converterMap.get(key(source, target));
        if (c == null) {
            String msg = "No converter available for " + source + " -> " + target;
            return new ConvertResponse("Error: " + msg, List.of(msg));
        }
        return c.convert(sql);
    }

    public List<DialectInfo> getSources() {
        Set<String> seen = new LinkedHashSet<>();
        List<DialectInfo> out = new ArrayList<>();
        for (SqlConverter c : converterMap.values()) {
            if (seen.add(c.source())) {
                out.add(new DialectInfo(c.source(), c.source().substring(0, 1).toUpperCase() + c.source().substring(1)));
            }
        }
        return out;
    }

    public List<DialectInfo> getTargetsFor(String source) {
        List<DialectInfo> out = new ArrayList<>();
        for (SqlConverter c : converterMap.values()) {
            if (c.source().equalsIgnoreCase(source)) {
                out.add(new DialectInfo(c.target(), c.target().substring(0, 1).toUpperCase() + c.target().substring(1)));
            }
        }
        return out;
    }
}
