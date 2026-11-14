# OPUROM for VS Code

Loadable, zero-build-step VS Code extension for OPUROM Lang. Everything needed at runtime is in this folder: a CommonJS `extension.js`, a zero-dependency `lsp-client.js`, JSON contributions, a `contributes.debuggers` entry, and no npm packages. The debug adapter itself lives in the sibling `opurom-debug` repository.

## Install

From this `vscode-opurom/` folder, symlink or copy it into your VS Code extensions directory and reload the window:

```sh
mkdir -p ~/.vscode/extensions
ln -s "$PWD" ~/.vscode/extensions/opurom.vscode-opurom
```

A copy works too:

```sh
cp -R . ~/.vscode/extensions/opurom.vscode-opurom
```

If you separately package a VSIX, install it with:

```sh
code --install-extension /absolute/path/to/vscode-opurom-0.1.0.vsix
```

No VSIX is included here. Build `opurom-lang` with `cargo build`, or set `opurom.compilerPath` to an existing `opuromc`. Check out the sibling `opurom-lsp`, `opurom-debug`, and `opurom-core` repositories for the optional language server and debugger.

## Features

- Registers the `opurom` language for `.opu` files, with comments, brackets, autoclosing pairs and indentation rules.
- TextMate syntax highlighting for `//` comments, `app`/`state`/`model`/`api`/`theme`/`if`/`for`, the API verbs `list`/`get`/`create`/`update`/`delete`, the action verbs `set`/`add`/`sub`/`toggle`, the `primary` modifier, the effect words `spring`/`ease`/`glass`/`gradient`/`shadow`/`opacity`, the `animate`/`fontScale` attribute names, all 100 primitive node kinds and capitalized component aliases, prop names, numbers, strings, booleans, `{name}` interpolation, literal `{{`, `+=`, `-=`, `=`, `.toggle()`, and punctuation.
- Snippets: `opurom-app`, `opurom-column-text`, `opurom-button-inc`, `opurom-input-bind`, `opurom-fullstack` (a `model` plus two `api` blocks), `opurom-theme`, `if` and `ifelse` conditional rendering, `theme` (the canonical accent and radius), and `opurom-particles` (a Container with a `particles:` field and `animate:`).
- `opurom.compile` runs `opuromc compile <src> -o <name>.opuir.json`.
- `opurom.check` runs `opuromc check <src>`; if `opurom.cliPath` is set, it runs `node <cliPath> check <src>` instead.
- `opurom.showActiveDocumentInfo` reports the active `.opu` filename and line count, and a clear message when no `.opu` editor is active.
- `opurom.restartLanguageServer` restarts the language server process, replays the LSP handshake and reopens the current `.opu` documents.
- Raw compiler stdout/stderr appears in the **OPUROM** output channel. `path:line:col: error: message` and warning lines become `vscode.Diagnostic` entries in a `DiagnosticCollection` (Problems panel). Success shows an information message.
- A DAP subset debugger descriptor launches `node ../opurom-debug/bin/server.mjs --stdio`. Launch attributes are `program`, `steps`, and optional `coreBinary`. Conditions inspect real kernel state after each command.

## Language server

The extension starts the OPUROM language server (`opurom-lsp`, a separate repository) itself. It spawns `node <server> --stdio`, speaks LSP JSON-RPC framing over stdio and needs no npm packages and no manual wiring.

- **Diagnostics**: the server writes the buffer to a temporary `.opu` file, runs `opuromc check` and publishes the result. Published diagnostics land in the same Problems panel as the manual commands.
- **Hover**: the type and initializer of a `state`, the fields of a `model`, the props of a node kind.
- **Completion**: the 100 primitive node kinds, keywords, canonical props, API verbs and the declared states. Autocomplete comes from this completion provider.
- **Definition**: jumps to the `state` or `model` declaration in the same file.

The server is configured with the `opurom.lspPath` setting. When the server file is missing the extension logs a hint in the output channel and the manual commands keep working.

Settings:

| Setting | Default | Meaning |
| --- | --- | --- |
| `opurom.compilerPath` | `../../opurom-lang/target/debug/opuromc` | Absolute path to `opuromc`; empty uses the sibling default. |
| `opurom.cliPath` | empty | Absolute path to `opurom-cli/bin/opurom.mjs`; empty uses `opuromc check`. |
| `opurom.lspPath` | `../../opurom-lsp/bin/server.mjs` | Absolute path to the language server entry point; empty uses the sibling default. |

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

A state breakpoint such as `count == 2` stops after the second tap. The adapter exposes live kernel state through `variables`; the `source.path` in a breakpoint request only identifies the breakpoint set.

Validate from the repository root:

```sh
node scripts/validate.mjs
node --test
```

`scripts/validate.mjs` checks that every contributed command has a registered handler. `test/extension-commands.test.mjs` covers the command declarations and behavior, `test/lsp-client.test.mjs` covers the client restart lifecycle, and `test/grammar-tokenization.test.mjs` checks the shared conditional and theme snippet bodies across all three grammars.

## Status

Syntax highlighting and compile/check diagnostics work, and so does the language server: the LSP client starts, the server answers, and published diagnostics reach the Problems panel. The LSP server answers hover, completion and definition requests. Autocomplete comes from that completion provider; snippets remain static insertions.

The debugger is a DAP subset contribution backed by the sibling `opurom-debug` adapter; its framed protocol and kernel integration are tested there. The manual compile/check commands still need the sibling `opuromc` binary, the language server needs the sibling `opurom-lsp` checkout, and the debugger needs the sibling `opurom-debug` and `opurom-core` checkouts; when a tool is missing, the extension shows a friendly missing-tool message instead of crashing.
