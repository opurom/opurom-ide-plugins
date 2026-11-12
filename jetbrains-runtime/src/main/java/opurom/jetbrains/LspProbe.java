package opurom.jetbrains;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

public final class LspProbe {
    private LspProbe() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 6) {
            throw new IllegalArgumentException("usage: LspProbe <node> <server> <record> <uri> <initial> <changed>");
        }
        List<String> command = List.of(args[0], args[1], args[2], "--stdio");
        CountDownLatch diagnostics = new CountDownLatch(1);
        AtomicInteger count = new AtomicInteger();
        LspClient client = new LspClient(command, diagnostic -> {
            count.incrementAndGet();
            System.out.println("DIAG " + diagnostic.uri() + "|" + diagnostic.line() + "|" +
                diagnostic.character() + "|" + diagnostic.severity() + "|" + diagnostic.message());
            diagnostics.countDown();
        });
        try {
            client.start();
            client.initialize().get(5, TimeUnit.SECONDS);
            client.initialized();
            client.didOpen(args[3], "opurom", 1, args[4]);
            client.didChange(args[3], 2, args[5]);
            if (!diagnostics.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("no publishDiagnostics received");
            System.out.println("RESULT diagnostics=" + count.get());
        } finally {
            client.stop();
        }
    }
}
