# OPUROM JetBrains metadata (round 4)

This directory is grammar/config METADATA only. It is NOT a running IntelliJ client. There is no compiled Java/Kotlin plugin, no Gradle build, no IntelliJ SDK runtime, no plugin verifier run, and no JetBrains Marketplace artifact.

This directory's R4 status remains metadata only: it contains no compiled plugin, has no IntelliJ runtime test, and is not a running IntelliJ client. It declares no debugger integration and no JetBrains marketplace publication; runtime verification for this metadata subproject remains R5+. The separate R9 compiled plugin lives in [../jetbrains-runtime/](../jetbrains-runtime/README.md) and was NOT loaded inside a running IntelliJ IDE.

## Contents

- [opurom.tmLanguage.json](opurom.tmLanguage.json): a standalone TextMate-style `.opu` grammar subset. It covers `app`, `state`, `model`, `api`, `theme`, `import`, `async`, `await`, `delay`, `fetch`, API verbs, all 32 primitive kinds, strings with `{name}` interpolation, `{{`, `//` comments, numbers, booleans, operators and punctuation.
- [lsp-client.json](lsp-client.json): configuration metadata with the `opurom` language id, `.opu` file extensions, and a `node <sibling opurom-lsp/bin/server.mjs> --stdio` command. It is NOT a running IntelliJ client.
- [plugin.xml](plugin.xml): well-formed IntelliJ plugin metadata with id, name, vendor, depends, and extensions declaring the `OPUROM` language and `.opu` file type. Its implementation class names are metadata placeholders.
- [validate.mjs](validate.mjs): zero-dependency validation using Node builtins only. It parses JSON, checks XML well-formedness, compiles grammar regexes, checks keyword and file-extension coverage, and asserts honest status text.

Run the standalone checks from the repository root:

```sh
node jetbrains/validate.mjs
```

The repository validator imports the same checks:

```sh
node scripts/validate.mjs
node --test
```

## Honest status (R4)

Status: grammar/config METADATA only. NO IntelliJ runtime test, NO compiled plugin, NO JetBrains marketplace publication, NO debugger integration; JetBrains runtime plugin verification remains R5+. The VS Code extension and its DAP subset contribution are unchanged; this subproject has no debugger integration of its own. The LSP configuration points at the sibling `opurom-lsp` server as data only and does not start it.
