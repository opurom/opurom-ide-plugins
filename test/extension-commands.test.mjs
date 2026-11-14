import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'vscode-opurom');
const pkg = JSON.parse(fs.readFileSync(path.join(ext, 'package.json'), 'utf8'));
const extensionSrc = fs.readFileSync(path.join(ext, 'extension.js'), 'utf8');
const extension = require(path.join(ext, 'extension.js'));

const expectedCommands = [
  ['opurom.showActiveDocumentInfo', 'Show active OPUROM document info'],
  ['opurom.restartLanguageServer', 'Restart OPUROM language server']
];

test('both editor commands are declared with titles, activation events and handlers', () => {
  for (const [id, title] of expectedCommands) {
    const command = pkg.contributes.commands.find(entry => entry.command === id);
    assert.ok(command, `${id} is contributed`);
    assert.equal(command.title, title);
    assert.equal(command.category, 'OPUROM');
    assert.ok(pkg.activationEvents.includes(`onCommand:${id}`), `${id} activates on invocation`);
    assert.ok(extensionSrc.includes(`registerCommand('${id}'`), `${id} is registered`);
  }
  assert.equal(pkg.contributes.commands.length, 5);
});

test('the run command is declared, activates and is registered with an F5 binding', () => {
  const command = pkg.contributes.commands.find(entry => entry.command === 'opurom.run');
  assert.ok(command, 'opurom.run is contributed');
  assert.equal(command.title, 'Run OPUROM (compile and debug)');
  assert.equal(command.category, 'OPUROM');
  assert.ok(pkg.activationEvents.includes('onCommand:opurom.run'), 'opurom.run activates on invocation');
  assert.ok(extensionSrc.includes("registerCommand('opurom.run'"), 'opurom.run is registered');
  const binding = pkg.contributes.keybindings.find(entry => entry.command === 'opurom.run');
  assert.ok(binding, 'opurom.run has a keybinding');
  assert.equal(binding.key, 'F5');
  assert.equal(binding.when, 'editorLangId == opurom');
  assert.ok(typeof extension.runAndDebug === 'function', 'runAndDebug is exported');
});

test('runAndDebug refuses to start without an active saved .opu editor', async () => {
  for (const editor of [null, { document: { isUntitled: true, isDirty: false } }]) {
    const vscode = fakeVscode(editor);
    vscode.window.showErrorMessage = message => vscode.messages.push(message);
    await extension.runAndDebug(vscode, { appendLine: () => {} }, new Map());
    assert.equal(vscode.messages.length, 1);
    assert.match(vscode.messages[0], /\.opu/);
  }
});

function fakeVscode(editor) {
  const messages = [];
  return {
    messages,
    window: {
      activeTextEditor: editor || null,
      showInformationMessage: message => messages.push(message)
    },
    workspace: {
      workspaceFolders: [],
      textDocuments: []
    }
  };
}

test('showActiveDocumentInfo reports the active .opu filename and line count', () => {
  const vscode = fakeVscode({
    document: {
      languageId: 'opurom',
      uri: { fsPath: '/tmp/counter.opu' },
      lineCount: 3
    }
  });
  extension.showActiveDocumentInfo(vscode);
  assert.deepEqual(vscode.messages, ['OPUROM: counter.opu has 3 lines.']);

  const single = fakeVscode({
    document: {
      languageId: 'opurom',
      uri: { fsPath: '/tmp/one.opu' },
      lineCount: 1
    }
  });
  extension.showActiveDocumentInfo(single);
  assert.deepEqual(single.messages, ['OPUROM: one.opu has 1 line.']);
});

test('showActiveDocumentInfo reports a clear message without an active .opu editor', () => {
  const editors = [null, {
    document: {
      languageId: 'plaintext',
      uri: { fsPath: '/tmp/notes.txt' },
      lineCount: 2
    }
  }];
  for (const editor of editors) {
    const vscode = fakeVscode(editor);
    extension.showActiveDocumentInfo(vscode);
    assert.equal(vscode.messages.length, 1);
    assert.match(vscode.messages[0], /\.opu/);
  }
});

test('restartLanguageServer restarts the client and replays the LSP session', () => {
  const calls = [];
  const client = {
    restart: () => calls.push('restart'),
    request: method => calls.push(`request:${method}`),
    notify: method => calls.push(`notify:${method}`)
  };
  const vscode = fakeVscode(null);
  vscode.workspace.textDocuments = [
    {
      languageId: 'opurom',
      uri: { toString: () => 'file:///tmp/counter.opu' },
      version: 1,
      getText: () => 'app Counter {}'
    },
    {
      languageId: 'plaintext',
      uri: { toString: () => 'file:///tmp/notes.txt' },
      version: 1,
      getText: () => 'plain'
    }
  ];
  const output = { appendLine: () => {} };
  extension.restartLanguageServer(vscode, output, client);
  assert.deepEqual(calls, [
    'restart',
    'request:initialize',
    'notify:initialized',
    'notify:textDocument/didOpen'
  ]);
  assert.deepEqual(vscode.messages, ['OPUROM language server restarted.']);
});

test('restartLanguageServer reports when the language server is not running', () => {
  const vscode = fakeVscode(null);
  extension.restartLanguageServer(vscode, { appendLine: () => {} }, null);
  assert.deepEqual(vscode.messages, ['The OPUROM language server is not running.']);
});
