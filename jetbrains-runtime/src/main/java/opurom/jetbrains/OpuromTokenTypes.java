package opurom.jetbrains;

import com.intellij.psi.tree.IElementType;

public final class OpuromTokenTypes {
    public static final IElementType WHITE_SPACE = new IElementType("OPUROM_WHITE_SPACE", OpuromLanguage.INSTANCE);
    public static final IElementType COMMENT = new IElementType("OPUROM_COMMENT", OpuromLanguage.INSTANCE);
    public static final IElementType STRING = new IElementType("OPUROM_STRING", OpuromLanguage.INSTANCE);
    public static final IElementType NUMBER = new IElementType("OPUROM_NUMBER", OpuromLanguage.INSTANCE);
    public static final IElementType KEYWORD = new IElementType("OPUROM_KEYWORD", OpuromLanguage.INSTANCE);
    public static final IElementType NODE_KIND = new IElementType("OPUROM_NODE_KIND", OpuromLanguage.INSTANCE);
    public static final IElementType IDENTIFIER = new IElementType("OPUROM_IDENTIFIER", OpuromLanguage.INSTANCE);
    public static final IElementType PUNCTUATION = new IElementType("OPUROM_PUNCTUATION", OpuromLanguage.INSTANCE);

    private OpuromTokenTypes() {}
}
