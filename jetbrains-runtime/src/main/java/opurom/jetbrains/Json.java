package opurom.jetbrains;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class Json {
    private final String text;
    private int position;

    private Json(String text) {
        this.text = text;
    }

    static Object parse(String text) {
        Json parser = new Json(text);
        Object value = parser.readValue();
        parser.skipWhitespace();
        if (parser.position != text.length()) {
            throw new IllegalArgumentException("trailing JSON at " + parser.position);
        }
        return value;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> object(Object value) {
        return value instanceof Map ? (Map<String, Object>) value : Map.of();
    }

    @SuppressWarnings("unchecked")
    static List<Object> array(Object value) {
        return value instanceof List ? (List<Object>) value : List.of();
    }

    static String stringify(Object value) {
        StringBuilder out = new StringBuilder();
        write(out, value);
        return out.toString();
    }

    private Object readValue() {
        skipWhitespace();
        char current = peek();
        return switch (current) {
            case '{' -> readObject();
            case '[' -> readArray();
            case '"' -> readString();
            case 't' -> {
                expectWord("true");
                yield Boolean.TRUE;
            }
            case 'f' -> {
                expectWord("false");
                yield Boolean.FALSE;
            }
            case 'n' -> {
                expectWord("null");
                yield null;
            }
            default -> readNumber();
        };
    }

    private Map<String, Object> readObject() {
        expect('{');
        Map<String, Object> result = new LinkedHashMap<>();
        skipWhitespace();
        if (peek() == '}') {
            position += 1;
            return result;
        }
        for (;;) {
            skipWhitespace();
            String key = readString();
            skipWhitespace();
            expect(':');
            result.put(key, readValue());
            skipWhitespace();
            char separator = peek();
            position += 1;
            if (separator == '}') return result;
            if (separator != ',') throw new IllegalArgumentException("invalid JSON object separator at " + position);
        }
    }

    private List<Object> readArray() {
        expect('[');
        List<Object> result = new ArrayList<>();
        skipWhitespace();
        if (peek() == ']') {
            position += 1;
            return result;
        }
        for (;;) {
            result.add(readValue());
            skipWhitespace();
            char separator = peek();
            position += 1;
            if (separator == ']') return result;
            if (separator != ',') throw new IllegalArgumentException("invalid JSON array separator at " + position);
        }
    }

    private String readString() {
        expect('"');
        StringBuilder out = new StringBuilder();
        while (position < text.length()) {
            char current = text.charAt(position++);
            if (current == '"') return out.toString();
            if (current != '\\') {
                out.append(current);
                continue;
            }
            if (position >= text.length()) throw new IllegalArgumentException("unterminated JSON escape");
            char escaped = text.charAt(position++);
            switch (escaped) {
                case '"', '\\', '/' -> out.append(escaped);
                case 'b' -> out.append('\b');
                case 'f' -> out.append('\f');
                case 'n' -> out.append('\n');
                case 'r' -> out.append('\r');
                case 't' -> out.append('\t');
                case 'u' -> {
                    if (position + 4 > text.length()) throw new IllegalArgumentException("truncated JSON unicode escape");
                    out.append((char) Integer.parseInt(text.substring(position, position + 4), 16));
                    position += 4;
                }
                default -> throw new IllegalArgumentException("invalid JSON escape \\" + escaped);
            }
        }
        throw new IllegalArgumentException("unterminated JSON string");
    }

    private Number readNumber() {
        int start = position;
        while (position < text.length() && "-+0123456789.eE".indexOf(text.charAt(position)) >= 0) position += 1;
        String raw = text.substring(start, position);
        if (raw.isEmpty()) throw new IllegalArgumentException("invalid JSON value at " + start);
        if (raw.indexOf('.') >= 0 || raw.indexOf('e') >= 0 || raw.indexOf('E') >= 0) return Double.parseDouble(raw);
        return Long.parseLong(raw);
    }

    private void skipWhitespace() {
        while (position < text.length() && Character.isWhitespace(text.charAt(position))) position += 1;
    }

    private char peek() {
        if (position >= text.length()) throw new IllegalArgumentException("unexpected end of JSON");
        return text.charAt(position);
    }

    private void expect(char expected) {
        if (peek() != expected) throw new IllegalArgumentException("expected " + expected + " at " + position);
        position += 1;
    }

    private void expectWord(String word) {
        if (!text.startsWith(word, position)) throw new IllegalArgumentException("invalid JSON literal at " + position);
        position += word.length();
    }

    private static void write(StringBuilder out, Object value) {
        if (value == null) {
            out.append("null");
        } else if (value instanceof Map<?, ?> map) {
            out.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!first) out.append(',');
                first = false;
                writeString(out, String.valueOf(entry.getKey()));
                out.append(':');
                write(out, entry.getValue());
            }
            out.append('}');
        } else if (value instanceof Iterable<?> items) {
            out.append('[');
            boolean first = true;
            for (Object item : items) {
                if (!first) out.append(',');
                first = false;
                write(out, item);
            }
            out.append(']');
        } else if (value instanceof Number || value instanceof Boolean) {
            out.append(value);
        } else if (value instanceof CharSequence text) {
            writeString(out, text.toString());
        } else {
            writeString(out, String.valueOf(value));
        }
    }

    private static void writeString(StringBuilder out, String value) {
        out.append('"');
        for (int index = 0; index < value.length(); index += 1) {
            char current = value.charAt(index);
            switch (current) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (current < 0x20) out.append(String.format("\\u%04x", (int) current));
                    else out.append(current);
                }
            }
        }
        out.append('"');
    }
}
