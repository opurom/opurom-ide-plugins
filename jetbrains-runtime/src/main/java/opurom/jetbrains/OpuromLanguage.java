package opurom.jetbrains;

import com.intellij.lang.Language;

public final class OpuromLanguage extends Language {
    public static final OpuromLanguage INSTANCE = new OpuromLanguage();

    private OpuromLanguage() {
        super("OPUROM");
    }
}
