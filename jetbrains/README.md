# OPUROM JetBrains metadata

This directory is grammar/config METADATA only. It is NOT a running IntelliJ client. There is no compiled Java/Kotlin plugin, no Gradle build, no IntelliJ SDK runtime, no plugin verifier run, and no JetBrains Marketplace artifact.

The compiled plugin and its IntelliJ runtime verification live in [jetbrains-runtime/](https://github.com/opurom/opurom-ide-plugins/blob/main/jetbrains-runtime/README.md). This directory declares no debugger integration.

## Contents

- [opurom.tmLanguage.json](opurom.tmLanguage.json): a standalone TextMate-style `.opu` grammar subset. It covers `app`, `state`, `model`, `api`, `theme`, `import`, `async`, `await`, `delay`, `fetch`, API verbs, the action verbs `set`/`add`/`sub`/`toggle`, the `animate`/`fontScale` attribute names, all 32 primitive kinds, strings with `{name}` interpolation, `{{`, `//` comments, numbers, booleans, operators and punctuation.
- [lsp-client.json](lsp-client.json): configuration metadata with the `opurom` language id, `.opu` file extensions, and a `node <sibling opurom-lsp/bin/server.mjs> --stdio` command. The server path is relative to this directory; set `OPUROM_LSP_SERVER` to override it with an absolute path. It is NOT a running IntelliJ client.
- [live-templates.xml](live-templates.xml): live-template metadata for all nine VS Code snippets (`if`, `ifelse`, `theme`, `opurom-app`, `opurom-column-text`, `opurom-button-inc`, `opurom-input-bind`, `opurom-fullstack`, `opurom-theme`), each with variables and an OPUROM context. The file is data only; no IntelliJ runtime loads it.
- [plugin.xml](plugin.xml): well-formed IntelliJ plugin metadata with id, name, vendor, depends, the live-template registration, and extensions declaring the `OPUROM` language and `.opu` file type. Its implementation class names are metadata placeholders.
- [validate.mjs](validate.mjs): zero-dependency validation using Node builtins only. It parses JSON, checks plugin and live-template XML well-formedness, compiles grammar regexes, and checks keyword and file-extension coverage.

Run the standalone checks from the repository root:

```sh
node jetbrains/validate.mjs
```

The repository validator imports the same checks:

```sh
node scripts/validate.mjs
node --test
```

## Scope

The DAP subset contribution is unchanged; this directory has no debugger integration of its own. The LSP configuration points
at the sibling `opurom-lsp` server as data only and does not start it.
