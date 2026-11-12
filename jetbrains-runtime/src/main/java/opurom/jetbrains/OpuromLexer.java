package opurom.jetbrains;

import com.intellij.lexer.LexerBase;
import com.intellij.openapi.editor.colors.TextAttributesKey;
import com.intellij.psi.tree.IElementType;

public final class OpuromLexer extends LexerBase {
    private static final TextAttributesKey KEYWORD_KEY = TextAttributesKey.createTextAttributesKey("OPUROM_KEYWORD");
    private static final TextAttributesKey NODE_KEY = TextAttributesKey.createTextAttributesKey("OPUROM_NODE_KIND");
    private static final TextAttributesKey STRING_KEY = TextAttributesKey.createTextAttributesKey("OPUROM_STRING");
    private static final TextAttributesKey NUMBER_KEY = TextAttributesKey.createTextAttributesKey("OPUROM_NUMBER");
    private static final TextAttributesKey COMMENT_KEY = TextAttributesKey.createTextAttributesKey("OPUROM_COMMENT");
    private static final TextAttributesKey PUNCTUATION_KEY = TextAttributesKey.createTextAttributesKey("OPUROM_PUNCTUATION");
    private static final TextAttributesKey[] EMPTY_KEYS = new TextAttributesKey[0];

    private final OpuromGrammar grammar;
    private CharSequence buffer = "";
    private int bufferEnd;
    private int tokenStart;
    private int tokenEnd;
    private int state;
    private IElementType tokenType;

    public OpuromLexer(OpuromGrammar grammar) {
        this.grammar = grammar;
    }

    @Override
    public void start(CharSequence buffer, int startOffset, int endOffset, int initialState) {
        this.buffer = buffer;
        this.bufferEnd = endOffset;
        this.tokenStart = startOffset;
        this.tokenEnd = startOffset;
        this.state = initialState;
        this.tokenType = null;
        advance();
    }

    @Override
    public int getState() {
        return state;
    }

    @Override
    public IElementType getTokenType() {
        return tokenType;
    }

    @Override
    public int getTokenStart() {
        return tokenStart;
    }

    @Override
    public int getTokenEnd() {
        return tokenEnd;
    }

    @Override
    public CharSequence getBufferSequence() {
        return buffer;
    }

    @Override
    public int getBufferEnd() {
        return bufferEnd;
    }

    @Override
    public void advance() {
        if (tokenEnd >= bufferEnd) {
            tokenStart = tokenEnd;
            tokenType = null;
            state = tokenEnd;
            return;
        }
        int position = tokenEnd;
        while (position < bufferEnd && Character.isWhitespace(buffer.charAt(position))) position += 1;
        tokenStart = position;
        if (position >= bufferEnd) {
            tokenEnd = bufferEnd;
            tokenType = null;
            state = tokenEnd;
            return;
        }
        char current = buffer.charAt(position);
        if (current == '/' && position + 1 < bufferEnd && buffer.charAt(position + 1) == '/') {
            position += 2;
            while (position < bufferEnd && buffer.charAt(position) != '\n') position += 1;
            tokenType = OpuromTokenTypes.COMMENT;
        } else if (current == '"') {
            position += 1;
            while (position < bufferEnd) {
                char value = buffer.charAt(position++);
                if (value == '\\' && position < bufferEnd) {
                    position += 1;
                    continue;
                }
                if (value == '"') break;
            }
            tokenType = OpuromTokenTypes.STRING;
        } else if (Character.isLetter(current) || current == '_') {
            int wordStart = position++;
            while (position < bufferEnd &&
                (Character.isLetterOrDigit(buffer.charAt(position)) || buffer.charAt(position) == '_')) position += 1;
            tokenType = classify(buffer.subSequence(wordStart, position).toString());
        } else if (Character.isDigit(current) ||
            (current == '-' && position + 1 < bufferEnd && Character.isDigit(buffer.charAt(position + 1)))) {
            position += 1;
            while (position < bufferEnd && Character.isDigit(buffer.charAt(position))) position += 1;
            tokenType = OpuromTokenTypes.NUMBER;
        } else {
            position += 1;
            tokenType = OpuromTokenTypes.PUNCTUATION;
        }
        tokenEnd = position;
        state = tokenEnd;
    }

    private IElementType classify(String word) {
        if (isKeyword(word)) return OpuromTokenTypes.KEYWORD;
        if (grammar.matches("support.class.node.opurom", word) ||
            grammar.matches("support.constant.effect.opurom", word) ||
            grammar.matches("support.function.async-effect.opurom", word)) return OpuromTokenTypes.NODE_KIND;
        return OpuromTokenTypes.IDENTIFIER;
    }

    private boolean isKeyword(String word) {
        return grammar.matches("keyword.control.opurom", word) ||
            grammar.matches("keyword.control.verb.opurom", word) ||
            grammar.matches("storage.modifier.opurom", word) ||
            grammar.matches("constant.language.boolean.opurom", word);
    }

    static TextAttributesKey[] keys(IElementType type) {
        if (type == OpuromTokenTypes.KEYWORD) return new TextAttributesKey[] { KEYWORD_KEY };
        if (type == OpuromTokenTypes.NODE_KIND) return new TextAttributesKey[] { NODE_KEY };
        if (type == OpuromTokenTypes.STRING) return new TextAttributesKey[] { STRING_KEY };
        if (type == OpuromTokenTypes.NUMBER) return new TextAttributesKey[] { NUMBER_KEY };
        if (type == OpuromTokenTypes.COMMENT) return new TextAttributesKey[] { COMMENT_KEY };
        if (type == OpuromTokenTypes.PUNCTUATION) return new TextAttributesKey[] { PUNCTUATION_KEY };
        return EMPTY_KEYS;
    }
}
