'use strict';

// Bridges the language server's document features to editor providers. Each
// provider forwards the position verbatim and maps the answer into editor
// types, so protocol details stay behind this file.

// Mirrors the trigger characters the server advertises on initialize; the
// contract test in test/lsp-features.test.mjs fails if the server drifts.
const COMPLETION_TRIGGERS = [':', '"', ' ', '('];

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
    vscode.languages.registerDefinitionProvider('opurom', createDefinitionProvider(vscode, client))
  );
}

module.exports = {
  COMPLETION_TRIGGERS,
  createCompletionProvider,
  createServerHoverProvider,
  createDefinitionProvider,
  registerLspFeatures
};
