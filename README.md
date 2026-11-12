# OPUROM IDE Plugins

Independent repository for OPUROM editor tooling. Round 2 ships [vscode-opurom](vscode-opurom/README.md): a loadable, zero-build-step VS Code extension with a built-in language server client. Round 3 adds a `contributes.debuggers` entry and a debug adapter descriptor that launches `node ../opurom-debug/bin/server.mjs --stdio` from the sibling `opurom-debug` repository. There is no bundler, generated code, or npm install step. Round 4 adds the [JetBrains metadata](jetbrains/README.md): a standalone TextMate-style grammar subset, LSP client configuration stub and plugin.xml metadata. Round 9 adds a separate [compiled JetBrains runtime subproject](jetbrains-runtime/README.md).

## Install

Development install (copy or symlink the extension folder, then reload VS Code):

```sh
mkdir -p ~/.vscode/extensions
ln -s "$PWD/vscode-opurom" ~/.vscode/extensions/opurom.vscode-opurom
```

Alternatively, package a VSIX separately and run:

```sh
code --install-extension /absolute/path/to/vscode-opurom-0.1.0.vsix
```

No VSIX is shipped in this repository. Build `opurom-lang` (`cargo build`) or set `opurom.compilerPath` before using the commands. Check out the sibling `opurom-lsp` repository for the language server and the sibling `opurom-debug` repository plus `opurom-core` for the debugger.

## Features

- `.opu` language registration with TextMate syntax highlighting for comments, `app`/`state`/`model`/`api`/`theme`/`if`/`for`, the API verbs, the `primary` modifier, the effect words, all 24 node kinds, prop names, literals, `{name}` interpolation, `+=`, `-=`, `=`, `.toggle()`, and punctuation.
- Six snippets: new app, Column with Text, Button with `+= 1`, bound Input, a full-stack `model` plus `api` scaffold, and a theme block.
- `OPUROM: Compile OPUROM to IR` writes `<name>.opuir.json` beside the source.
- `OPUROM: Check OPUROM file` runs `opuromc check`, or `opurom check` through `opurom.cliPath` when configured.
- Compiler output goes to the OPUROM output channel; `path:line:col: error: message` and warning lines become Problems-panel diagnostics. Success shows an information message.
- A zero-dependency language server client: the extension spawns `node <opurom-lsp/bin/server.mjs> --stdio` and talks JSON-RPC over stdio. It sends `initialize`, `didOpen`, `didChange` and `didClose`, applies the published diagnostics to the Problems panel and shuts the server down on deactivate.
- The LSP server provides diagnostics, hover, completion and definition for the open document. Autocomplete comes from that completion provider; snippets remain static insertions.
- `opurom.compilerPath` defaults to the sibling `../opurom-lang/target/debug/opuromc`; `opurom.cliPath` is optional; `opurom.lspPath` defaults to the sibling `../opurom-lsp/bin/server.mjs`.
- A DAP subset debugger contribution launches the sibling `opurom-debug` adapter with Node and `--stdio`. Its launch schema accepts `program`, `steps`, and an optional `coreBinary`. Breakpoints are state conditions evaluated against real kernel patches, not source-line breakpoints.

## Sample debug launch configuration

Add this to `.vscode/launch.json` after compiling an IR file:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "opurom",
      "request": "launch",
      "name": "Debug Counter IR",
      "program": "${workspaceFolder}/counter.opuir.json",
      "steps": ["tap 4", "tap 4", "tap 4"]
    }
  ]
}
```

Set a state breakpoint such as `count == 2` through the `setBreakpoints` DAP request. The adapter stops after the second tap and exposes the live kernel state in `variables`.

Verify the project with:

```sh
node scripts/validate.mjs
node --test
node jetbrains/validate.mjs
```

## Honest status (round 3)

Syntax highlighting and compile/check diagnostics work in this round, and so does the language server. The LSP client is verified: the server starts, the session is real JSON-RPC, and published diagnostics reach the Problems panel. The LSP server answers hover, completion and definition requests. Autocomplete comes from that completion provider; snippets remain static insertions.

The debugger is a DAP subset contribution backed by a separate adapter repository; its framed protocol and kernel integration are tested there. No GUI client tested. There are no real source breakpoints, no watch expressions, no step-in/out, and no multi-thread debugging; those are R4+. At round 3, there was no JetBrains plugin binary or runtime integration, no formatting, no rename, no references, no code actions and no semantic tokens - those are later rounds. There is no hot reload integration yet. A live compile/check run requires the sibling compiler binary; the language server requires the sibling `opurom-lsp` checkout; the debugger requires the sibling `opurom-debug` and `opurom-core` checkouts. A missing tool is reported with a friendly message instead of a crash.

## JetBrains metadata (round 4)

[jetbrains/](jetbrains/README.md) contains grammar/config METADATA only. `opurom.tmLanguage.json` is a standalone TextMate-style grammar subset for `.opu` with R4 keywords, async effects, 32 primitive kinds, interpolation, comments, numbers and booleans. `lsp-client.json` records the `opurom` language id, `.opu` extensions, and the sibling `opurom-lsp` stdio server command as configuration metadata; it is NOT a running IntelliJ client. `plugin.xml` is well-formed IntelliJ plugin metadata with id, name, vendor, depends, and language/file type extensions. `validate.mjs` checks JSON, XML, keyword coverage and status text with Node builtins only.

R4 metadata status: grammar/config METADATA only. NO IntelliJ runtime test, NO compiled plugin, NO JetBrains marketplace publication, NO debugger integration; JetBrains runtime plugin verification for that metadata subproject remains R5+. The VS Code extension and its DAP subset contribution are unchanged; this metadata subproject has no debugger integration of its own.

## Compiled JetBrains plugin (round 9)

[jetbrains-runtime/](jetbrains-runtime/README.md) is a separate Gradle IntelliJ Platform subproject using JDK 21. Its `plugin.xml` declares the plugin id, name, vendor, `idea-version`, platform dependencies, the OPUROM language/file type, a grammar extension, an LSP client extension and a startup activity. Java sources implement a real stdio LSP client with `Content-Length` framing over a spawned process, `initialize`, `didOpen`, `didChange`, `didClose`, shutdown/exit and `publishDiagnostics` parsing. The VS Code LSP client remains the protocol reference; the JetBrains client is independent Java code.

The preferred build produces `jetbrains-runtime/build/distributions/opurom-jetbrains-0.1.0.zip` through `gradle buildPlugin` with JDK 21 compiling Java 17 bytecode for ideaIC 2023.3.6 compatibility, Gradle 8.7 and `--no-daemon`. If the IntelliJ SDK cannot be downloaded, `node jetbrains-runtime/build.mjs` compiles the same Java sources with `javac`, builds a JAR and assembles the real plugin ZIP at `jetbrains-runtime/build/fallback/opurom-jetbrains-0.1.0.zip`. The fallback uses local IntelliJ API stubs only on the compiler classpath; no stubs are packaged. The concrete build outcome and exact SDK failure reason, when applicable, are recorded in [jetbrains-runtime/README.md](jetbrains-runtime/README.md).

Verify the archive structure with zero dependencies:

```sh
node jetbrains-runtime/verify.mjs
node scripts/validate.mjs
node --test
```

`verify.mjs` uses `unzip -l` to require `lib/`, compiled `.class` files, `plugin.xml`, the declared grammar resource and a plugin JAR containing `META-INF/plugin.xml`; it exits 0 only for a valid plugin archive. The SDK cache, downloaded SDKs and all build outputs are gitignored and are not committed.

Honest scope: the archive was NOT loaded inside a running IntelliJ IDE. There is no marketplace publication, no runtime IDE verification, no plugin verifier run and no debugger UI. Editor document synchronization, real IDE integration tests, plugin verifier runs and marketplace publication are R10+.

## Scope

This folder is its own local git repository. Other OPUROM workstreams live in sibling repositories; this project writes nothing outside `opurom-ide-plugins/`.
