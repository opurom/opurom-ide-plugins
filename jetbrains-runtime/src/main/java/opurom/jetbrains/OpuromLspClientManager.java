package opurom.jetbrains;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

public final class OpuromLspClientManager implements OpuromLspClientProvider {
    private static final LspClient INSTANCE = create();

    @Override
    public LspClient client() {
        return INSTANCE;
    }

    private static LspClient create() {
        List<String> command = command();
        if (command == null) return null;
        LspClient client = new LspClient(command, diagnostic -> System.out.println("OPUROM LSP: " + diagnostic));
        try {
            client.start();
            client.initialize();
            client.initialized();
            Runtime.getRuntime().addShutdownHook(new Thread(client::stop, "opurom-lsp-shutdown"));
            return client;
        } catch (IOException | RuntimeException error) {
            client.stop();
            System.err.println("OPUROM LSP startup failed: " + error.getMessage());
            return null;
        }
    }

    private static List<String> command() {
        String configured = System.getProperty("opurom.lsp.path", System.getenv("OPUROM_LSP_PATH"));
        Path server = configured == null || configured.isBlank()
            ? Path.of(System.getProperty("user.dir"), "..", "opurom-lsp", "bin", "server.mjs").normalize()
            : Path.of(configured);
        if (!Files.isRegularFile(server)) return null;
        String node = System.getProperty("opurom.node.path", System.getenv("OPUROM_NODE_PATH"));
        if (node == null || node.isBlank()) node = "node";
        return List.of(node, server.toString(), "--stdio");
    }
}
