package opurom.jetbrains;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

public final class LspClient implements AutoCloseable {
    private final List<String> command;
    private final Consumer<LspDiagnostics.Diagnostic> onDiagnostic;
    private final Map<Integer, CompletableFuture<Map<String, Object>>> pending = new ConcurrentHashMap<>();
    private final AtomicInteger nextId = new AtomicInteger(1);
    private Process process;
    private OutputStream output;
    private Thread reader;
    private volatile boolean running;

    public LspClient(List<String> command, Consumer<LspDiagnostics.Diagnostic> onDiagnostic) {
        this.command = List.copyOf(command);
        this.onDiagnostic = onDiagnostic == null ? ignored -> {} : onDiagnostic;
    }

    public void start() throws IOException {
        if (process != null) return;
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.redirectError(ProcessBuilder.Redirect.DISCARD);
        process = builder.start();
        output = process.getOutputStream();
        running = true;
        reader = new Thread(this::readLoop, "opurom-lsp-reader");
        reader.setDaemon(true);
        reader.start();
    }

    public CompletableFuture<Map<String, Object>> request(String method, Object params) {
        int id = nextId.getAndIncrement();
        CompletableFuture<Map<String, Object>> future = new CompletableFuture<>();
        pending.put(id, future);
        try {
            send(method, params, id);
        } catch (RuntimeException error) {
            pending.remove(id);
            future.completeExceptionally(error);
        }
        return future;
    }

    public void notify(String method, Object params) {
        send(method, params, null);
    }

    public CompletableFuture<Map<String, Object>> initialize() {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("processId", (int) ProcessHandle.current().pid());
        params.put("capabilities", Map.of());
        return request("initialize", params);
    }

    public void initialized() {
        notify("initialized", Map.of());
    }

    public void didOpen(String uri, String languageId, int version, String text) {
        notify("textDocument/didOpen", Map.of(
            "textDocument", Map.of(
                "uri", uri,
                "languageId", languageId,
                "version", version,
                "text", text
            )
        ));
    }

    public void didChange(String uri, int version, String text) {
        notify("textDocument/didChange", Map.of(
            "textDocument", Map.of("uri", uri, "version", version),
            "contentChanges", List.of(Map.of("text", text))
        ));
    }

    public void didClose(String uri) {
        notify("textDocument/didClose", Map.of("textDocument", Map.of("uri", uri)));
    }

    @Override
    public void close() {
        stop();
    }

    public void stop() {
        running = false;
        Process child = process;
        if (child == null) return;
        try {
            send("shutdown", null, nextId.getAndIncrement());
            send("exit", null, null);
            output.close();
        } catch (IOException | RuntimeException error) {
            System.err.println("OPUROM LSP shutdown failed: " + error.getMessage());
        }
        try {
            child.waitFor(1, TimeUnit.SECONDS);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        }
        if (child.isAlive()) child.destroy();
        for (CompletableFuture<Map<String, Object>> future : pending.values()) future.cancel(false);
        pending.clear();
        process = null;
        output = null;
    }

    private void send(String method, Object params, Integer id) {
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("jsonrpc", "2.0");
        if (id != null) message.put("id", id);
        message.put("method", method);
        message.put("params", params);
        try {
            write(message);
        } catch (IOException error) {
            throw new UncheckedIOException(error);
        }
    }

    private synchronized void write(Map<String, Object> message) throws IOException {
        if (output == null) throw new IOException("LSP client is not started");
        byte[] body = Json.stringify(message).getBytes(StandardCharsets.UTF_8);
        output.write(("Content-Length: " + body.length + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        output.write(body);
        output.flush();
    }

    private void readLoop() {
        try (InputStream input = process.getInputStream()) {
            while (running) {
                int length = -1;
                String line;
                while ((line = readLine(input)) != null) {
                    if (line.isEmpty()) break;
                    int colon = line.indexOf(':');
                    if (colon >= 0 && line.substring(0, colon).trim().equalsIgnoreCase("Content-Length")) {
                        length = Integer.parseInt(line.substring(colon + 1).trim());
                    }
                }
                if (line == null) return;
                if (length < 0) throw new IOException("missing Content-Length header");
                byte[] body = input.readNBytes(length);
                if (body.length != length) throw new EOFException("truncated LSP frame");
                dispatch(Json.parse(new String(body, StandardCharsets.UTF_8)));
            }
        } catch (IOException | RuntimeException error) {
            if (running) System.err.println("OPUROM LSP read failed: " + error.getMessage());
        }
    }

    private static String readLine(InputStream input) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int value;
        while ((value = input.read()) != -1) {
            if (value == '\n') {
                byte[] bytes = line.toByteArray();
                int length = bytes.length > 0 && bytes[bytes.length - 1] == '\r' ? bytes.length - 1 : bytes.length;
                return new String(bytes, 0, length, StandardCharsets.US_ASCII);
            }
            line.write(value);
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private void dispatch(Object value) {
        if (!(value instanceof Map<?, ?> raw)) return;
        Map<String, Object> message = (Map<String, Object>) raw;
        if (message.get("id") instanceof Number number) {
            CompletableFuture<Map<String, Object>> future = pending.remove(number.intValue());
            if (future != null) future.complete(message);
            return;
        }
        if ("textDocument/publishDiagnostics".equals(message.get("method"))) {
            Map<String, Object> params = Json.object(message.get("params"));
            for (LspDiagnostics.Diagnostic diagnostic : LspDiagnostics.parse(params)) {
                onDiagnostic.accept(diagnostic);
            }
        }
    }
}
