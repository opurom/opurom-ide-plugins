# OPUROM for VS Code

Loadable, zero-build-step VS Code extension for OPUROM Lang. Everything needed at runtime is in this folder: a CommonJS `extension.js`, a zero-dependency `lsp-client.js`, JSON contributions, and no npm packages.

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

No VSIX is included here. Build `opurom-lang` with `cargo build`, or set `opurom.compilerPath` to an existing `opuromc`.

## Features

- Registers the `opurom` language for `.opu` files, with comments, brackets, autoclosing pairs and indentation rules.
- TextMate syntax highlighting for `//` comments, `app`/`state`/`model`/`api`/`theme`/`if`/`for`, the API verbs `list`/`get`/`create`/`update`/`delete`, the `primary` modifier, the effect words `spring`/`ease`/`glass`/`gradient`/`shadow`/`opacity`/`animate`, all 24 node kinds, prop names, numbers, strings, booleans, `{name}` interpolation, literal `{{`, `+=`, `-=`, `=`, `.toggle()`, and punctuation.
- Snippets: `opurom-app`, `opurom-column-text`, `opurom-button-inc`, `opurom-input-bind`, `opurom-fullstack` (a `model` plus two `api` blocks), `opurom-theme`.
- `opurom.compile` runs `opuromc compile <src> -o <name>.opuir.json`.
- `opurom.check` runs `opuromc check <src>`; if `opurom.cliPath` is set, it runs `node <cliPath> check <src>` instead.
- Raw compiler stdout/stderr appears in the **OPUROM** output channel. `path:line:col: error: message` and warning lines become `vscode.Diagnostic` entries in a `DiagnosticCollection` (Problems panel). Success shows an information message.

## Language server

The extension starts the OPUROM language server (`opurom-lsp`, a separate repository) itself. It spawns `node <server> --stdio`, speaks the LSP JSON-RPC framing over stdio and needs no npm packages and no manual wiring.

- **Diagnostics** — the server writes the buffer to a temporary `.opu` file, runs `opuromc check` and publishes the result. Published diagnostics land in the same Problems panel as the manual commands.
- **Hover** — the type and initializer of a `state`, the fields of a `model`, the props of a node kind.
- **Completion** — the 24 node kinds, keywords, canonical props, API verbs and the declared states.
- **Definition** — jumps to the `state` or `model` declaration in the same file.

The server is configured with the `opurom.lspPath` setting. When the server file is missing the extension logs a hint in the output channel and the manual commands keep working.

Settings:

| Setting | Default | Meaning |
| --- | --- | --- |
| `opurom.compilerPath` | `../../opurom-lang/target/debug/opuromc` | Absolute path to `opuromc`; empty uses the sibling default. |
| `opurom.cliPath` | empty | Absolute path to `opurom-cli/bin/opurom.mjs`; empty uses `opuromc check`. |
| `opurom.lspPath` | `../../opurom-lsp/bin/server.mjs` | Absolute path to the language server entry point; empty uses the sibling default. |

Validate from the repository root:

```sh
node ../scripts/validate.mjs
```

## Honest status (round 2)

Syntax highlighting and compile/check diagnostics work in this round, and so does the language server: the LSP client starts, the server answers, and published diagnostics reach the Problems panel. The server answers hover, completion and definition requests. Autocomplete comes from that completion provider; snippets remain static insertions.

There is **no debugger**: no debug adapter protocol (DAP) implementation and no launch configuration is shipped. There is no JetBrains plugin, no formatting, no rename, no references, no code actions and no semantic tokens — those are later rounds. There is no hot reload integration yet. The manual compile/check commands still need the sibling `opuromc` binary, and the language server needs the sibling `opurom-lsp` checkout; when either is missing, the extension shows a friendly missing-tool message instead of crashing.
