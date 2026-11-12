package opurom.jetbrains;

import com.intellij.lexer.Lexer;
import com.intellij.openapi.editor.colors.TextAttributesKey;
import com.intellij.openapi.fileTypes.SyntaxHighlighter;
import com.intellij.psi.tree.IElementType;

public final class OpuromSyntaxHighlighter implements SyntaxHighlighter {
    private final OpuromGrammar grammar = new OpuromTextMateGrammar();

    @Override
    public Lexer getHighlightingLexer() {
        return new OpuromLexer(grammar);
    }

    @Override
    public TextAttributesKey[] getTokenHighlights(IElementType tokenType) {
        return OpuromLexer.keys(tokenType);
    }
}
