// Editor-provider contract against the real language server: the providers
// send the documented requests, translate the answers into editor types and
// degrade to empty results when the server is gone. Registration and trigger
// drift are asserted without the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { LspClient, defaultLspPath } = require(path.join(root, 'vscode-opurom', 'lsp-client.js'));
const features = require(path.join(root, 'vscode-opurom', 'lsp-features.js'));

const serverPath = defaultLspPath();
const available = fs.existsSync(serverPath);
const text = 'app Counter {\n  state count = 0\n  Column(gap: 8) { Text("hi") }\n}\n';

// Minimal editor stand-in: the providers only construct these types.
class MarkdownString {
  constructor(value) {
    this.value = value;
  }
}
class Hover {
  constructor(contents, range) {
    this.contents = contents;
    this.range = range;
  }
}
class Location {
  constructor(uri, range) {
    this.uri = uri;
    this.range = range;
  }
}
class Range {
  constructor(a, b, c, d) {
    this.start = { line: a, character: b };
    this.end = { line: c, character: d };
  }
}
class CompletionItem {
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
  }
}
class SignatureHelp {}
class SignatureInformation {
  constructor(label) {
    this.label = label;
  }
}
class ParameterInformation {
  constructor(label) {
    this.label = label;
  }
}
class CodeAction {
  constructor(title, kind) {
    this.title = title;
    this.kind = kind;
  }
}
class CodeActionKind {
  constructor(value) {
    this.value = value;
  }
}
CodeActionKind.QuickFix = new CodeActionKind('quickfix');
CodeActionKind.Refactor = new CodeActionKind('refactor');
CodeActionKind.Source = new CodeActionKind('source');
class Diagnostic {
  constructor(range, message, severity) {
    Object.assign(this, { range, message, severity });
  }
}
class WorkspaceEdit {
  constructor() {
    this.edits = [];
  }
  replace(uri, range, text) {
    this.edits.push({ uri: uri.toString(), range, text });
  }
}
const fakeVscode = {
  MarkdownString,
  Hover,
  Location,
  Range,
  CompletionItem,
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
  CodeAction,
  CodeActionKind,
  Diagnostic,
  DiagnosticSeverity: { Error: 1, Warning: 2 },
  WorkspaceEdit,
  Uri: { parse: value => ({ toString: () => value }) }
};

const document = {
  uri: { toString: () => 'file:///tmp/features.opu' },
  getText: () => text
};

async function withServer(fn, openedText = text) {
  const client = new LspClient(serverPath);
  client.start();
  try {
    const initialize = await client.request('initialize', { processId: process.pid, capabilities: {} });
    client.notify('initialized', {});
    client.notify('textDocument/didOpen', {
      textDocument: { uri: document.uri.toString(), languageId: 'opurom', version: 1, text: openedText }
    });
    await fn(client, initialize);
  } finally {
    client.stop();
  }
}

test('the completion trigger characters mirror the server contract', { skip: !available }, async () => {
  await withServer(async (client, initialize) => {
    assert.deepEqual(
      features.COMPLETION_TRIGGERS,
      initialize.result.capabilities.completionProvider.triggerCharacters
    );
  });
});

test('the completion provider answers with node kinds and keywords', { skip: !available }, async () => {
  await withServer(async client => {
    const provider = features.createCompletionProvider(fakeVscode, client);
    const list = await provider.provideCompletionItems(document, { line: 0, character: 0 });
    assert.equal(list.isIncomplete, false);
    const column = list.items.find(item => item.label === 'Column');
    assert.ok(column, 'node kind completion present');
    assert.equal(column.kind, 7);
    assert.ok(list.items.some(item => item.kind === 14), 'keyword completions present');
    assert.ok(list.items.every(item => typeof item.label === 'string'));
  });
});

test('the hover provider maps the server markdown into a hover', { skip: !available }, async () => {
  await withServer(async client => {
    const provider = features.createServerHoverProvider(fakeVscode, client);
    const hover = await provider.provideHover(document, { line: 1, character: 10 });
    assert.ok(hover, 'server hover present for a declared state');
    assert.match(hover.contents.value, /\*\*state\*\* `count`/);
    assert.equal(hover.range.start.line, 1);
    assert.equal(hover.range.start.character, 8);
  });
});

test('the definition provider jumps to the declaration location', { skip: !available }, async () => {
  await withServer(async client => {
    const provider = features.createDefinitionProvider(fakeVscode, client);
    const location = await provider.provideDefinition(document, { line: 1, character: 10 });
    assert.ok(location, 'declaration location present');
    assert.equal(location.uri.toString(), 'file:///tmp/features.opu');
    assert.equal(location.range.start.character, 8);
  });
});

test('completion mapping carries the server replacement edit', { skip: !available }, async () => {
  const propText = 'app Counter {\n  state count = 0\n  Column(padding: ) { Text("hi") }\n}\n';
  await withServer(async client => {
    const provider = features.createCompletionProvider(fakeVscode, client);
    const list = await provider.provideCompletionItems(document, { line: 2, character: 16 });
    const prop = list.items.find(item => item.label === 'padding');
    assert.ok(prop, 'prop completion present');
    assert.equal(prop.filterText, 'padding');
    assert.equal(prop.sortText, '9000');
    assert.equal(prop.insertText, 'padding: ');
    assert.equal(prop.range.start.line, 2);
    assert.equal(prop.range.start.character, 9);
    assert.equal(prop.range.end.character, 16);
  }, propText);
});

test('the signature help provider maps the enclosing node kind', { skip: !available }, async () => {
  await withServer(async client => {
    const provider = features.createSignatureHelpProvider(fakeVscode, client);
    const help = await provider.provideSignatureHelp(document, { line: 2, character: 9 });
    assert.ok(help, 'signature help present inside a node call');
    assert.match(help.signatures[0].label, /^Column\(/);
    assert.ok(help.signatures[0].parameters.every(parameter => typeof parameter.label === 'string'));
    assert.equal(help.activeSignature, 0);
  });
});

test('codeAction flows from announcement to applied edit through a mock session', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opurom-lsp-codeaction-'));
  const server = path.join(dir, 'server.mjs');
  fs.writeFileSync(server, [
    "import fs from 'node:fs';",
    'let buf = Buffer.alloc(0);',
    "process.stdin.on('data', chunk => {",
    '  buf = Buffer.concat([buf, chunk]);',
    '  for (;;) {',
    "    const end = buf.indexOf('\\r\\n\\r\\n');",
    '    if (end < 0) return;',
    "    const header = buf.subarray(0, end).toString('ascii');",
    '    const m = /content-length:\\s*(\\d+)/i.exec(header);',
    '    if (!m) { buf = buf.subarray(end + 4); continue; }',
    '    const len = Number(m[1]);',
    '    const start = end + 4;',
    '    if (buf.length < start + len) return;',
    "    const msg = JSON.parse(buf.subarray(start, start + len).toString('utf8'));",
    '    buf = buf.subarray(start + len);',
    "    const reply = result => { const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })); process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\\r\\n\\r\\n`), body])); };",
    "    if (msg.method === 'initialize') reply({ capabilities: { codeActionProvider: true } });",
    "    if (msg.method === 'textDocument/codeAction') reply([{",
    "      title: 'Use state count', kind: 'quickfix', diagnostics: msg.params.context.diagnostics,",
    "      edit: { changes: { [msg.params.textDocument.uri]: [{ range: msg.params.range, newText: 'count' }] } }",
    '    }]);',
    "    if (msg.method === 'shutdown') { reply(null); process.exit(0); }",
    '  }',
    '});'
  ].join('\n') + '\n');

  const client = new LspClient(server);
  client.start();
  try {
    const initialize = await client.request('initialize', { processId: process.pid, capabilities: {} });
    assert.equal(initialize.result.capabilities.codeActionProvider, true);
    const codeActionText = 'app Counter {\n  state count = 0\n  Column(gap: 8) { Text("x {nope}") }\n}\n';
    const codeActionDocument = {
      uri: { toString: () => 'file:///tmp/features.opu' },
      getText: () => codeActionText
    };
    const range = { start: { line: 2, character: 28 }, end: { line: 2, character: 32 } };
    const actions = await features.createCodeActionProvider(fakeVscode, client).provideCodeActions(
      codeActionDocument,
      range,
      { diagnostics: [{ range, severity: 1, message: 'unknown state', source: 'opuromc' }] }
    );
    assert.equal(actions.length, 1);
    assert.equal(actions[0].title, 'Use state count');
    assert.equal(actions[0].kind.value, 'quickfix');
    assert.equal(actions[0].diagnostics.length, 1);
    assert.equal(actions[0].diagnostics[0].source, 'opuromc');
    assert.equal(actions[0].edit.edits.length, 1);
    assert.equal(actions[0].edit.edits[0].text, 'count');
    const applied = applyEdits(codeActionText, actions[0].edit.edits);
    assert.match(applied, /Text\("x \{count\}"\)/);
    assert.doesNotMatch(applied, /nope/);
  } finally {
    client.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function applyEdits(text, edits) {
  const offset = (line, character) => {
    const lines = text.split('\n');
    let total = 0;
    for (let index = 0; index < line; index++) total += lines[index].length + 1;
    return total + character;
  };
  let out = text;
  const ordered = [...edits].sort((a, b) =>
    offset(b.range.start.line, b.range.start.character) - offset(a.range.start.line, a.range.start.character));
  for (const edit of ordered) {
    const start = offset(edit.range.start.line, edit.range.start.character);
    const end = offset(edit.range.end.line, edit.range.end.character);
    out = out.slice(0, start) + edit.text + out.slice(end);
  }
  return out;
}

test('providers answer empty when the language server is gone', async () => {
  const client = { request: () => Promise.resolve(null) };
  const completion = await features
    .createCompletionProvider(fakeVscode, client)
    .provideCompletionItems(document, { line: 0, character: 0 });
  assert.deepEqual(completion, { isIncomplete: false, items: [] });
  const hover = await features
    .createServerHoverProvider(fakeVscode, client)
    .provideHover(document, { line: 0, character: 0 });
  assert.equal(hover, null);
  const definition = await features
    .createDefinitionProvider(fakeVscode, client)
    .provideDefinition(document, { line: 0, character: 0 });
  assert.equal(definition, null);
  const signature = await features
    .createSignatureHelpProvider(fakeVscode, client)
    .provideSignatureHelp(document, { line: 0, character: 0 });
  assert.equal(signature, null);
  const actions = await features
    .createCodeActionProvider(fakeVscode, client)
    .provideCodeActions(document, { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, { diagnostics: [] });
  assert.deepEqual(actions, []);
});

test('registerLspFeatures registers every provider for the opurom language', () => {
  const registered = [];
  const vscode = {
    CodeActionKind: fakeVscode.CodeActionKind,
    languages: {
      registerCompletionItemProvider: (selector, provider, ...triggers) => {
        registered.push(['completion', selector, triggers.length]);
        return { dispose() {} };
      },
      registerHoverProvider: selector => {
        registered.push(['hover', selector, 0]);
        return { dispose() {} };
      },
      registerDefinitionProvider: selector => {
        registered.push(['definition', selector, 0]);
        return { dispose() {} };
      },
      registerSignatureHelpProvider: (selector, provider, ...triggers) => {
        registered.push(['signature', selector, triggers.length]);
        return { dispose() {} };
      },
      registerCodeActionsProvider: (selector, provider, metadata) => {
        registered.push(['codeAction', selector, metadata.providedCodeActionKinds.length]);
        return { dispose() {} };
      }
    }
  };
  const context = { subscriptions: [] };
  features.registerLspFeatures(vscode, context, { request: () => Promise.resolve(null) });
  assert.deepEqual(registered.map(entry => entry.slice(0, 2)), [
    ['completion', 'opurom'],
    ['hover', 'opurom'],
    ['definition', 'opurom'],
    ['signature', 'opurom'],
    ['codeAction', 'opurom']
  ]);
  assert.equal(registered[0][2], features.COMPLETION_TRIGGERS.length);
  assert.equal(registered[3][2], features.SIGNATURE_TRIGGERS.length);
  assert.equal(registered[4][2], 3);
  assert.equal(context.subscriptions.length, 5);
});
