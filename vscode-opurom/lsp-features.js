'use strict';

// Bridges the language server's document features to editor providers. Each
// provider forwards the position verbatim and maps the answer into editor
// types, so protocol details stay behind this file.

// Mirrors the trigger characters the server advertises on initialize; the
// contract test in test/lsp-features.test.mjs fails if the server drifts.
const COMPLETION_TRIGGERS = [':', '"', "'", '(', '{', '/', '=', '.'];
const SIGNATURE_TRIGGERS = ['(', ','];

function positionParams(document, position) {
  return {
    textDocument: { uri: document.uri.toString() },
    position: { line: position.line, character: position.character }
  };
}

function toRange(vscode, range) {
  if (!range || !range.start || !range.end) return null;
  return new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character);
}

// LSP completion kinds share the editor enum's numbering, so they map directly.
function createCompletionProvider(vscode, client) {
  return {
    async provideCompletionItems(document, position) {
      const response = await client.request('textDocument/completion', positionParams(document, position));
      const result = response && response.result;
      const items = (result && result.items ? result.items : []).map(item => {
        const entry = new vscode.CompletionItem(item.label, item.kind);
        if (item.detail) entry.detail = item.detail;
        if (item.documentation) entry.documentation = item.documentation;
        if (item.filterText) entry.filterText = item.filterText;
        if (item.sortText) entry.sortText = item.sortText;
        // Replacement range is server-owned: opurom-lsp/lib/features.mjs:212-215.
        if (item.textEdit && item.textEdit.range && typeof item.textEdit.newText === 'string') {
          entry.range = toRange(vscode, item.textEdit.range);
          entry.insertText = item.textEdit.newText;
        }
        return entry;
      });
      return { isIncomplete: Boolean(result && result.isIncomplete), items };
    }
  };
}

// Registered beside the local hover-card provider: the server covers state,
// model and declared-component words the generated cards do not.
function createServerHoverProvider(vscode, client) {
  return {
    async provideHover(document, position) {
      const response = await client.request('textDocument/hover', positionParams(document, position));
      const result = response && response.result;
      if (!result || !result.contents) return null;
      const body = typeof result.contents === 'string' ? result.contents : String(result.contents.value || '');
      if (!body) return null;
      return new vscode.Hover(new vscode.MarkdownString(body), toRange(vscode, result.range) || undefined);
    }
  };
}

function createDefinitionProvider(vscode, client) {
  return {
    async provideDefinition(document, position) {
      const response = await client.request('textDocument/definition', positionParams(document, position));
      const result = response && response.result;
      if (!result || !result.uri || !result.range) return null;
      return new vscode.Location(vscode.Uri.parse(result.uri), toRange(vscode, result.range));
    }
  };
}

function createSignatureHelpProvider(vscode, client) {
  return {
    async provideSignatureHelp(document, position) {
      const response = await client.request('textDocument/signatureHelp', positionParams(document, position));
      const result = response && response.result;
      if (!result || !Array.isArray(result.signatures) || result.signatures.length === 0) return null;
      const signatures = result.signatures.map(signature => {
        const info = new vscode.SignatureInformation(signature.label);
        const docs = signature.documentation;
        if (docs) info.documentation = typeof docs === 'string' ? docs : String(docs.value || '');
        info.parameters = (signature.parameters || []).map(parameter =>
          new vscode.ParameterInformation(parameter.label)
        );
        return info;
      });
      const help = new vscode.SignatureHelp();
      help.signatures = signatures;
      help.activeSignature = result.activeSignature ?? 0;
      help.activeParameter = result.activeParameter ?? 0;
      return help;
    }
  };
}

function plainRange(range) {
  if (!range || !range.start || !range.end) {
    return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  }
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character }
  };
}

function codeActionKind(vscode, kind) {
  if (kind === 'quickfix') return vscode.CodeActionKind.QuickFix;
  if (kind === 'refactor') return vscode.CodeActionKind.Refactor;
  if (kind === 'source') return vscode.CodeActionKind.Source;
  // Sub-kinds such as quickfix.<rule> are passed through, never flattened.
  return kind ? new vscode.CodeActionKind(kind) : undefined;
}

function toWorkspaceEdit(vscode, changes) {
  const edit = new vscode.WorkspaceEdit();
  for (const [uri, items] of Object.entries(changes || {})) {
    for (const item of items) {
      const range = toRange(vscode, item.range);
      if (range && typeof item.newText === 'string') {
        edit.replace(vscode.Uri.parse(uri), range, item.newText);
      }
    }
  }
  return edit;
}

function createCodeActionProvider(vscode, client) {
  return {
    async provideCodeActions(document, range, context) {
      const diagnostics = context && context.diagnostics ? context.diagnostics : [];
      const response = await client.request('textDocument/codeAction', {
        textDocument: { uri: document.uri.toString() },
        range: plainRange(range),
        context: {
          diagnostics: diagnostics.map(item => ({
            range: plainRange(item.range),
            severity: item.severity,
            message: item.message,
            source: item.source
          }))
        }
      });
      const list = response && response.result;
      if (!Array.isArray(list)) return [];
      return list.map(action => {
        const entry = new vscode.CodeAction(action.title, codeActionKind(vscode, action.kind));
        if (Array.isArray(action.diagnostics)) {
          entry.diagnostics = action.diagnostics.map(item => {
            const range = toRange(vscode, item.range);
            const severity = item.severity === 2
              ? vscode.DiagnosticSeverity.Warning
              : vscode.DiagnosticSeverity.Error;
            const diagnostic = new vscode.Diagnostic(range, item.message, severity);
            if (item.source) diagnostic.source = item.source;
            return diagnostic;
          });
        }
        if (action.edit && action.edit.changes) entry.edit = toWorkspaceEdit(vscode, action.edit.changes);
        if (action.isPreferred) entry.isPreferred = true;
        return entry;
      });
    }
  };
}

// Providers are registered once per session: they close over the client,
// whose object survives a restart of the server process.
function registerLspFeatures(vscode, context, client) {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      'opurom',
      createCompletionProvider(vscode, client),
      ...COMPLETION_TRIGGERS
    ),
    vscode.languages.registerHoverProvider('opurom', createServerHoverProvider(vscode, client)),
    vscode.languages.registerDefinitionProvider('opurom', createDefinitionProvider(vscode, client)),
    vscode.languages.registerSignatureHelpProvider(
      'opurom',
      createSignatureHelpProvider(vscode, client),
      ...SIGNATURE_TRIGGERS
    ),
    vscode.languages.registerCodeActionsProvider(
      'opurom',
      createCodeActionProvider(vscode, client),
      {
        providedCodeActionKinds: [
          vscode.CodeActionKind.QuickFix,
          vscode.CodeActionKind.Refactor,
          vscode.CodeActionKind.Source
        ]
      }
    )
  );
}

module.exports = {
  COMPLETION_TRIGGERS,
  SIGNATURE_TRIGGERS,
  createCompletionProvider,
  createServerHoverProvider,
  createDefinitionProvider,
  createSignatureHelpProvider,
  createCodeActionProvider,
  registerLspFeatures
};
