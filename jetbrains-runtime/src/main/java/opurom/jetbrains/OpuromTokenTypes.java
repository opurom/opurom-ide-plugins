package opurom.jetbrains;

import com.intellij.psi.tree.IElementType;

public final class OpuromTokenTypes {
    public static final IElementType WHITE_SPACE = new IElementType("Opurom_WHITE_SPACE", OpuromLanguage.INSTANCE);
    public static final IElementType COMMENT = new IElementType("Opurom_COMMENT", OpuromLanguage.INSTANCE);
    public static final IElementType STRING = new IElementType("Opurom_STRING", OpuromLanguage.INSTANCE);
    public static final IElementType NUMBER = new IElementType("Opurom_NUMBER", OpuromLanguage.INSTANCE);
    public static final IElementType KEYWORD = new IElementType("Opurom_KEYWORD", OpuromLanguage.INSTANCE);
    public static final IElementType NODE_KIND = new IElementType("Opurom_NODE_KIND", OpuromLanguage.INSTANCE);
    public static final IElementType IDENTIFIER = new IElementType("Opurom_IDENTIFIER", OpuromLanguage.INSTANCE);
    public static final IElementType PUNCTUATION = new IElementType("Opurom_PUNCTUATION", OpuromLanguage.INSTANCE);

    private OpuromTokenTypes() {}
}
