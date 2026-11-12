package opurom.jetbrains;

import com.intellij.openapi.project.Project;
import com.intellij.openapi.startup.StartupActivity;
import java.nio.file.Path;

public final class OpuromLspStartupActivity implements StartupActivity {
    @Override
    public void runActivity(Project project) {
        LspClient client = new OpuromLspClientManager().client();
        if (client == null) return;
        String base = project == null ? null : project.getBasePath();
        Path source = base == null ? Path.of("Untitled.opu") : Path.of(base, "Untitled.opu");
        String uri = source.toAbsolutePath().toUri().toString();
        try {
            client.didOpen(uri, "opurom", 1, "// OPUROM LSP session\n");
            client.didChange(uri, 2, "app Counter {}\n");
        } catch (RuntimeException error) {
            System.err.println("OPUROM LSP session failed: " + error.getMessage());
        }
    }
}
