# OPUROM for VS Code

Loadable, zero-build-step VS Code extension for OPUROM Lang v0.1. Everything needed at runtime is in this folder: a CommonJS `extension.js`, JSON contributions, and no dependencies.

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
- TextMate syntax highlighting for `//` comments, `app`/`state`, `Column`/`Row`/`Container`/`Text`/`Button`/`Input`/`Image`/`Spacer`, prop names, numbers, strings, booleans, `{name}` interpolation, literal `{{`, `+=`, `-=`, `=`, `.toggle()`, and punctuation.
- Snippets: `opurom-app`, `opurom-column-text`, `opurom-button-inc`, `opurom-input-bind`.
- `opurom.compile` runs `opuromc compile <src> -o <name>.opuir.json`.
- `opurom.check` runs `opuromc check <src>`; if `opurom.cliPath` is set, it runs `node <cliPath> check <src>` instead.
- Raw compiler stdout/stderr appears in the **OPUROM** output channel. `path:line:col: error: message` and warning lines become `vscode.Diagnostic` entries in a `DiagnosticCollection` (Problems panel). Success shows an information message.

Settings:

| Setting | Default | Meaning |
| --- | --- | --- |
| `opurom.compilerPath` | `../../opurom-lang/target/debug/opuromc` | Absolute path to `opuromc`; empty uses the sibling default. |
| `opurom.cliPath` | empty | Absolute path to `opurom-cli/bin/opurom.mjs`; empty uses `opuromc check`. |

Validate from the repository root:

```sh
node ../scripts/validate.mjs
```

## Honest status (round 1)

Syntax highlighting + compile/check diagnostics work in this round. LSP, autocomplete, debugger, hot reload integration are later rounds. There is no language server, semantic completion, debug adapter, or dev-server client; snippets are static. A live compile/check run requires the sibling compiler binary, which is produced by the separate `opurom-lang` repo. If that binary is missing, the extension shows a friendly missing-tool message instead of crashing.
