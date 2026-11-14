import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'vscode-opurom');
const hoverCardsPath = path.join(ext, 'hover-cards.js');
const { catalog, componentNames, generateHoverCard } = require(hoverCardsPath);
const extension = require(path.join(ext, 'extension.js'));
const pkg = require(path.join(ext, 'package.json'));
const entries = new Map(catalog.components.map(
  ([name, primitive, category, defaultProps]) => [name, { name, primitive, category, defaultProps }]
));

class FakeMarkdownString {
  constructor(value) {
    this.value = value;
  }
}

class FakeHover {
  constructor(contents, range) {
    this.contents = [contents];
    this.range = range;
  }
}

test('all 240 catalog names produce a complete component hover card', () => {
  assert.equal(catalog.count, 240);
  assert.equal(catalog.components.length, 240);
  assert.equal(componentNames.length, 240);
  assert.equal(new Set(componentNames).size, 240);

  for (const name of componentNames) {
    const entry = entries.get(name);
    const card = generateHoverCard(name);
    assert.ok(card, `${name} has a card`);
    assert.ok(card.startsWith(`## ${name}\n`), `${name} has a heading`);
    assert.ok(!card.includes('\r'), `${name} uses LF newlines`);

    const signatureLine = card.split('\n')[2];
    assert.ok(signatureLine.startsWith(`\`component ${name}(`), `${name} has a signature`);
    assert.ok(signatureLine.includes(`-> ${entry.primitive}\``), `${name} names its primitive`);
    for (const prop of Object.keys(entry.defaultProps)) {
      assert.ok(signatureLine.includes(`${prop}: `), `${name} signature includes ${prop}`);
    }
    assert.ok(card.includes(`A ${entry.category} component`), `${name} has a description`);

    assert.ok(card.includes('**Default props**'), `${name} has a default-props section`);
    const defaults = /```json\n([\s\S]*?)\n```/.exec(card);
    assert.ok(defaults, `${name} has a JSON default-props block`);
    assert.deepEqual(JSON.parse(defaults[1]), entry.defaultProps, `${name} default props`);

    assert.ok(card.includes('**Usage**'), `${name} has a usage section`);
    const usage = /```opu\n([\s\S]*?)\n```/.exec(card);
    assert.ok(usage, `${name} has an OPUROM usage block`);
    assert.ok(usage[1].includes('app Preview {'), `${name} usage has an app`);
    assert.ok(usage[1].includes(`${name}(`), `${name} usage calls the component`);
    const [prop, value] = Object.entries(entry.defaultProps)[0] || [];
    if (prop) {
      assert.ok(usage[1].includes(`${prop}: ${JSON.stringify(value)}`), `${name} usage shows a prop`);
    }
    assert.equal(generateHoverCard(name), card, `${name} is deterministic within a run`);
  }
});

test('unknown component names return a clear empty result', () => {
  for (const name of ['NotAComponent', '', 'column', null, undefined, 42]) {
    assert.equal(generateHoverCard(name), null, `${String(name)} has no card`);
  }
  const provider = extension.createHoverProvider({
    Hover: FakeHover,
    MarkdownString: FakeMarkdownString
  });
  const document = {
    getWordRangeAtPosition: () => ({ start: {}, end: {} }),
    getText: () => 'NotAComponent'
  };
  assert.equal(provider.provideHover(document, {}), null);
  assert.equal(provider.provideHover({ getWordRangeAtPosition: () => null }, {}), null);
});

test('hover cards are byte-identical across separate runs', () => {
  const script = [
    `const { componentNames, generateHoverCard } = require(${JSON.stringify(hoverCardsPath)});`,
    'process.stdout.write(JSON.stringify(componentNames.map(generateHoverCard)));'
  ].join('\n');
  const first = spawnSync(process.execPath, ['-e', script]);
  const second = spawnSync(process.execPath, ['-e', script]);
  assert.equal(first.status, 0, first.stderr.toString());
  assert.equal(second.status, 0, second.stderr.toString());
  assert.ok(first.stdout.length > 0, 'cards produce output');
  assert.ok(first.stdout.equals(second.stdout), 'two fresh processes produce identical bytes');
});

test('activation registers an opurom hover provider that surfaces the generated card', () => {
  assert.ok(pkg.activationEvents.includes('onLanguage:opurom'));
  const registrations = [];
  const disposable = { dispose() {} };
  const output = { appendLine() {}, clear() {}, show() {}, dispose() {} };
  const diagnostics = { clear() {}, set() {}, dispose() {} };
  const vscode = {
    Hover: FakeHover,
    MarkdownString: FakeMarkdownString,
    window: {
      createOutputChannel: () => output,
      showInformationMessage() {},
      showErrorMessage() {}
    },
    languages: {
      createDiagnosticCollection: () => diagnostics,
      registerHoverProvider: (language, provider) => {
        registrations.push({ language, provider });
        return disposable;
      }
    },
    commands: { registerCommand: () => disposable },
    debug: { registerDebugAdapterDescriptorFactory: () => disposable },
    workspace: {
      workspaceFolders: [],
      textDocuments: [],
      getConfiguration: () => ({
        get: key => key === 'lspPath' ? '/opurom-missing-language-server.mjs' : ''
      })
    }
  };
  const context = { subscriptions: [] };

  extension.activate(context, vscode);
  extension.deactivate();

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].language, 'opurom');
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } };
  const hover = registrations[0].provider.provideHover({
    getWordRangeAtPosition: () => range,
    getText: () => 'VStack'
  }, { line: 0, character: 0 });
  assert.ok(hover instanceof FakeHover);
  assert.deepEqual(hover.range, range);
  assert.ok(hover.contents[0] instanceof FakeMarkdownString);
  assert.equal(hover.contents[0].value, generateHoverCard('VStack'));
});
