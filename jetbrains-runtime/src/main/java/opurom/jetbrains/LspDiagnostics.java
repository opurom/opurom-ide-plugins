package opurom.jetbrains;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

final class LspDiagnostics {
    record Diagnostic(String uri, int line, int character, int severity, String message) {}

    static List<Diagnostic> parse(Map<String, Object> params) {
        String uri = String.valueOf(params.get("uri"));
        List<Object> raw = Json.array(params.get("diagnostics"));
        List<Diagnostic> parsed = new ArrayList<>();
        for (Object item : raw) {
            Map<String, Object> diagnostic = Json.object(item);
            Map<String, Object> range = Json.object(diagnostic.get("range"));
            Map<String, Object> start = Json.object(range.get("start"));
            parsed.add(new Diagnostic(
                uri,
                integer(start.get("line")),
                integer(start.get("character")),
                integer(diagnostic.get("severity")),
                String.valueOf(diagnostic.get("message"))
            ));
        }
        return parsed;
    }

    private static int integer(Object value) {
        return value instanceof Number number ? number.intValue() : 0;
    }
}
