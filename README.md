# OPUROM IDE Plugins

Independent repository for OPUROM editor tooling. Round 1 ships [vscode-opurom](vscode-opurom/README.md): a loadable, zero-build-step VS Code extension. There is no bundler, generated code, or npm install step.

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

No VSIX is shipped in this repository. Build `opurom-lang` (`cargo build`) or set `opurom.compilerPath` before using the commands.

## Features

- `.opu` language registration with TextMate syntax highlighting for comments, `app`/`state`, node kinds, prop names, literals, `{name}` interpolation, `+=`, `-=`, `=`, `.toggle()`, and punctuation.
- Four snippets: new app, Column with Text, Button with `+= 1`, bound Input.
- `OPUROM: Compile OPUROM to IR` writes `<name>.opuir.json` beside the source.
- `OPUROM: Check OPUROM file` runs `opuromc check`, or `opurom check` through `opurom.cliPath` when configured.
- Compiler output goes to the OPUROM output channel; `path:line:col: error: message` and warning lines become Problems-panel diagnostics. Success shows an information message.
- `opurom.compilerPath` defaults to the sibling `../opurom-lang/target/debug/opuromc`; `opurom.cliPath` is optional.

Verify the project with:

```sh
node scripts/validate.mjs
```

## Honest status (round 1)

Syntax highlighting + compile/check diagnostics work in this round. LSP, autocomplete, debugger, hot reload integration are later rounds. Snippets are static insertions, not semantic completion; there is no language server, debug adapter, or dev-server client. The extension requires an existing `opuromc` binary and otherwise reports a friendly missing-tool error.

## Scope

This folder is its own local git repository. Other OPUROM workstreams live in sibling repositories; this project writes nothing outside `opurom-ide-plugins/`.
