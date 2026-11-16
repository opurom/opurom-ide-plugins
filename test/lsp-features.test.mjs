// Editor-provider contract against the real language server: the providers
// send the documented requests, translate the answers into editor types and
// degrade to empty results when the server is gone. Registration and trigger
// drift are asserted without the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
const fakeVscode = {
  MarkdownString,
  Hover,
  Location,
  Range,
  CompletionItem,
  Uri: { parse: value => ({ toString: () => value }) }
};

const document = {
  uri: { toString: () => 'file:///tmp/features.opu' },
  getText: () => text
};

async function withServer(fn) {
  const client = new LspClient(serverPath);
  client.start();
  try {
    const initialize = await client.request('initialize', { processId: process.pid, capabilities: {} });
    client.notify('initialized', {});
    client.notify('textDocument/didOpen', {
      textDocument: { uri: document.uri.toString(), languageId: 'opurom', version: 1, text }
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
});

test('registerLspFeatures registers every provider for the opurom language', () => {
  const registered = [];
  const vscode = {
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
      }
    }
  };
  const context = { subscriptions: [] };
  features.registerLspFeatures(vscode, context, { request: () => Promise.resolve(null) });
  assert.deepEqual(registered.map(entry => entry.slice(0, 2)), [
    ['completion', 'opurom'],
    ['hover', 'opurom'],
    ['definition', 'opurom']
  ]);
  assert.equal(registered[0][2], features.COMPLETION_TRIGGERS.length);
  assert.equal(context.subscriptions.length, 3);
});
