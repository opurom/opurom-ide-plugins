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
  ['opurom.showActiveDocumentInfo', 'Show active Opurom document info'],
  ['opurom.restartLanguageServer', 'Restart Opurom language server']
];

test('both editor commands are declared with titles, activation events and handlers', () => {
  for (const [id, title] of expectedCommands) {
    const command = pkg.contributes.commands.find(entry => entry.command === id);
    assert.ok(command, `${id} is contributed`);
    assert.equal(command.title, title);
    assert.equal(command.category, 'Opurom');
    assert.ok(pkg.activationEvents.includes(`onCommand:${id}`), `${id} activates on invocation`);
    assert.ok(extensionSrc.includes(`registerCommand('${id}'`), `${id} is registered`);
  }
  // Commands are an open set: every contributed command must be activated and
  // registered. Pinning a count makes unrelated additions look like failures.
  const ids = pkg.contributes.commands.map(entry => entry.command);
  assert.equal(new Set(ids).size, ids.length, 'command ids are unique');
  for (const id of ids) {
    assert.ok(pkg.activationEvents.includes(`onCommand:${id}`), `${id} activates on invocation`);
    assert.ok(extensionSrc.includes(`registerCommand('${id}'`), `${id} is registered`);
  }
});

test('the run command is declared, activates and is registered with an F5 binding', () => {
  const command = pkg.contributes.commands.find(entry => entry.command === 'opurom.run');
  assert.ok(command, 'opurom.run is contributed');
  assert.equal(command.title, 'Run Opurom (compile and debug)');
  assert.equal(command.category, 'Opurom');
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
  assert.deepEqual(vscode.messages, ['Opurom: counter.opu has 3 lines.']);

  const single = fakeVscode({
    document: {
      languageId: 'opurom',
      uri: { fsPath: '/tmp/one.opu' },
      lineCount: 1
    }
  });
  extension.showActiveDocumentInfo(single);
  assert.deepEqual(single.messages, ['Opurom: one.opu has 1 line.']);
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
  const initParams = [];
  const client = {
    restart: () => calls.push('restart'),
    request: (method, params) => {
      calls.push(`request:${method}`);
      initParams.push(params);
    },
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
  // The handshake declares exactly the features the providers consume.
  assert.deepEqual(
    Object.keys(initParams[0].capabilities.textDocument).sort(),
    ['codeAction', 'completion', 'definition', 'hover', 'signatureHelp']
  );
  assert.deepEqual(vscode.messages, ['Opurom language server restarted.']);
});

test('restartLanguageServer reports when the language server is not running', () => {
  const vscode = fakeVscode(null);
  extension.restartLanguageServer(vscode, { appendLine: () => {} }, null);
  assert.deepEqual(vscode.messages, ['The Opurom language server is not running.']);
});

test('hot commands map to DAP custom requests and never fake success', async () => {
  const lines = [];
  const messages = [];
  const calls = [];
  const session = {
    type: 'opurom',
    customRequest: method => {
      calls.push(method);
      if (method === 'hotReload') return Promise.resolve({ applied: true, action: 'reload', version: 7 });
      const failure = new Error('build-error');
      failure.data = { code: 'build-error', category: 'build-error', retryable: true };
      return Promise.reject(failure);
    }
  };
  const vscode = {
    debug: { activeDebugSession: session },
    window: {
      showInformationMessage: message => messages.push(['info', message]),
      showErrorMessage: message => messages.push(['error', message])
    }
  };
  const output = { appendLine: line => lines.push(line) };
  await extension.hotRequest(vscode, output, 'reload');
  assert.deepEqual(calls, ['hotReload']);
  assert.match(lines[0], /hot reload applied \(version 7\)/);
  assert.equal(messages[0][0], 'info');

  await extension.hotRequest(vscode, output, 'restart');
  assert.deepEqual(calls, ['hotReload', 'hotRestart']);
  assert.equal(messages[1][0], 'error');
  assert.match(messages[1][1], /build-error/);
  assert.doesNotMatch(lines[1], /applied/);
});

test('hot commands refuse to run without an Opurom debug session', async () => {
  const messages = [];
  const vscode = {
    debug: { activeDebugSession: { type: 'other' } },
    window: { showErrorMessage: message => messages.push(message) }
  };
  await extension.hotRequest(vscode, { appendLine() {} }, 'reload');
  assert.equal(messages.length, 1);
  assert.match(messages[0], /debug session/);
});

test('inspector opens the configured dev server page', () => {
  const opened = [];
  const lines = [];
  const vscode = {
    env: { openExternal: uri => opened.push(uri.toString()) },
    Uri: { parse: value => ({ toString: () => value }) },
    workspace: {
      getConfiguration: () => ({ get: key => key === 'inspectorUrl' ? 'http://127.0.0.1:9999/inspector' : '' })
    }
  };
  extension.openInspector(vscode, { appendLine: line => lines.push(line) });
  assert.deepEqual(opened, ['http://127.0.0.1:9999/inspector']);
  assert.match(lines[0], /inspector/);
});
