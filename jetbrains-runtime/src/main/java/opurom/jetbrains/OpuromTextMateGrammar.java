package opurom.jetbrains;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

public final class OpuromTextMateGrammar implements OpuromGrammar {
    private final Map<String, Pattern> patterns = new HashMap<>();

    public OpuromTextMateGrammar() {
        try (InputStream resource = OpuromTextMateGrammar.class.getResourceAsStream("/textmate/opurom.tmLanguage.json")) {
            if (resource == null) throw new IllegalStateException("missing bundled OPUROM grammar");
            Map<String, Object> grammar = Json.object(Json.parse(new String(resource.readAllBytes(), StandardCharsets.UTF_8)));
            Map<String, Object> repository = Json.object(grammar.get("repository"));
            for (Object value : repository.values()) {
                Map<String, Object> rule = Json.object(value);
                if (rule.get("name") instanceof String scope && rule.get("match") instanceof String regex) {
                    patterns.put(scope, Pattern.compile(regex));
                }
            }
        } catch (IOException error) {
            throw new IllegalStateException("cannot read bundled OPUROM grammar", error);
        }
    }

    @Override
    public boolean matches(String scope, String token) {
        Pattern pattern = patterns.get(scope);
        return pattern != null && pattern.matcher(token).find();
    }
}
