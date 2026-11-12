package opurom.jetbrains;

import com.intellij.openapi.fileTypes.LanguageFileType;
import javax.swing.Icon;

public final class OpuromFileType extends LanguageFileType {
    public static final OpuromFileType INSTANCE = new OpuromFileType();

    private OpuromFileType() {
        super(OpuromLanguage.INSTANCE);
    }

    @Override
    public String getName() {
        return "OPUROM";
    }

    @Override
    public String getDescription() {
        return "OPUROM source file";
    }

    @Override
    public String getDefaultExtension() {
        return "opu";
    }

    @Override
    public Icon getIcon() {
        return null;
    }
}
