package com.sqlbridge.converter;

import com.sqlbridge.model.ConvertResponse;

public interface SqlConverter {
    String source();
    String target();
    ConvertResponse convert(String sql);
}
