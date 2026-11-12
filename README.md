# OPUROM IDE Plugins

Independent repository for OPUROM editor tooling. Round 2 ships [vscode-opurom](vscode-opurom/README.md): a loadable, zero-build-step VS Code extension with a built-in language server client. There is no bundler, generated code, or npm install step.

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

No VSIX is shipped in this repository. Build `opurom-lang` (`cargo build`) or set `opurom.compilerPath` before using the commands, and check out the sibling `opurom-lsp` repository for the language server.

## Features

- `.opu` language registration with TextMate syntax highlighting for comments, `app`/`state`/`model`/`api`/`theme`/`if`/`for`, the API verbs, the `primary` modifier, the effect words, all 24 node kinds, prop names, literals, `{name}` interpolation, `+=`, `-=`, `=`, `.toggle()`, and punctuation.
- Six snippets: new app, Column with Text, Button with `+= 1`, bound Input, a full-stack `model` plus `api` scaffold, and a theme block.
- `OPUROM: Compile OPUROM to IR` writes `<name>.opuir.json` beside the source.
- `OPUROM: Check OPUROM file` runs `opuromc check`, or `opurom check` through `opurom.cliPath` when configured.
- Compiler output goes to the OPUROM output channel; `path:line:col: error: message` and warning lines become Problems-panel diagnostics. Success shows an information message.
- A zero-dependency language server client: the extension spawns `node <opurom-lsp/bin/server.mjs> --stdio` and talks JSON-RPC over stdio. It sends `initialize`, `didOpen`, `didChange` and `didClose`, applies the published diagnostics to the Problems panel and shuts the server down on deactivate.
- The server provides diagnostics, hover, completion and definition for the open document.
- `opurom.compilerPath` defaults to the sibling `../opurom-lang/target/debug/opuromc`; `opurom.cliPath` is optional; `opurom.lspPath` defaults to the sibling `../opurom-lsp/bin/server.mjs`.

Verify the project with:

```sh
node scripts/validate.mjs
```

## Honest status (round 2)

Syntax highlighting and compile/check diagnostics work in this round, and so does the language server. The LSP client is verified: the server starts, the session is real JSON-RPC, and published diagnostics reach the Problems panel. The server answers hover, completion and definition requests. Autocomplete comes from that completion provider; snippets remain static insertions.

There is **no debugger**: no debug adapter protocol (DAP) implementation and no launch configuration is shipped. There is no JetBrains plugin, no formatting, no rename, no references, no code actions and no semantic tokens — those are later rounds. There is no hot reload integration yet. A live compile/check run requires the sibling compiler binary; the language server additionally requires the sibling `opurom-lsp` checkout, and a missing tool is reported with a friendly message instead of a crash.

## Scope

This folder is its own local git repository. Other OPUROM workstreams live in sibling repositories; this project writes nothing outside `opurom-ide-plugins/`.
