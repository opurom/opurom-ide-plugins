'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { LspClient, defaultLspPath } = require('./lsp-client');
const { createHoverProvider, generateHoverCard, generatePropHoverCard } = require('./hover-cards');

const DIAGNOSTIC_RE = /^(.+?):(\d+):(\d+):\s*(error|warning):\s*(.+)$/;

function parseDiagnostics(text) {
  const diagnostics = [];
  for (const raw of String(text || '').split('\n')) {
    const match = DIAGNOSTIC_RE.exec(raw.trimEnd());
    if (!match) continue;
    diagnostics.push({
      file: match[1],
      line: Math.max(0, Number(match[2]) - 1),
      character: Math.max(0, Number(match[3]) - 1),
      severity: match[4],
      message: match[5]
    });
  }
  return diagnostics;
}

function defaultCompilerPath() {
  return path.resolve(__dirname, '..', '..', 'opurom-lang', 'target', 'debug', 'opuromc');
}

// The language server lives in its own repository; the sibling path is the
// default and the `opurom.lspPath` setting overrides it.
function defaultLspServerPath() {
  return defaultLspPath();
}

function defaultDebugServerPath() {
  return path.resolve(__dirname, '..', '..', 'opurom-debug', 'bin', 'server.mjs');
}

// The descriptor factory adds --stdio to the sibling adapter launch command.
function debugAdapterDescriptor(vscode) {
  return new vscode.DebugAdapterExecutable('node', [defaultDebugServerPath(), '--stdio']);
}

function isMissingExecutable(executable) {
  const looksLikePath = path.isAbsolute(executable) || executable.includes('/') || executable.includes('\\');
  return looksLikePath && !fs.existsSync(executable);
}

function toolFor(mode, file, compilerPath, cliPath) {
  const outputFile = path.join(path.dirname(file), path.basename(file, '.opu') + '.opuir.json');
  if (mode === 'check' && cliPath) {
    return {
      command: process.execPath,
      args: [cliPath, 'check', file],
      toolPath: cliPath,
      label: 'CLI',
      node: true,
      outputFile: null
    };
  }
  return {
    command: compilerPath,
    args: mode === 'compile' ? ['compile', file, '-o', outputFile] : ['check', file],
    toolPath: compilerPath,
    label: 'compiler',
    node: false,
    outputFile: mode === 'compile' ? outputFile : null
  };
}

async function run(vscode, output, diagnostics, mode) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.isUntitled) {
    vscode.window.showErrorMessage('Open a saved .opu file before running an OPUROM command.');
    return;
  }
  if (editor.document.isDirty && !(await editor.document.save())) {
    vscode.window.showErrorMessage('Save the .opu file before running an OPUROM command.');
    return;
  }

  const file = editor.document.uri.fsPath;
  const config = vscode.workspace.getConfiguration('opurom');
  const compilerPath = String(config.get('compilerPath') || '').trim() || defaultCompilerPath();
  const cliPath = String(config.get('cliPath') || '').trim();
  const tool = toolFor(mode, file, compilerPath, cliPath);

  output.clear();
  output.appendLine('$ ' + [tool.command, ...tool.args].join(' '));
  if (isMissingExecutable(tool.toolPath)) {
    const hint = tool.label === 'CLI'
      ? 'Set opurom.cliPath to opurom-cli/bin/opurom.mjs, or clear it to use opuromc check.'
      : 'Build opurom-lang with cargo build, or set opurom.compilerPath.';
    const message = `OPUROM ${tool.label} not found at ${tool.toolPath}. ${hint}`;
    output.appendLine(message);
    output.show(true);
    vscode.window.showErrorMessage(message);
    return;
  }

  const cwd = vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath || path.dirname(file);
  const options = { cwd, encoding: 'utf8' };
  if (tool.node) {
    // VS Code's execPath can be Electron; this makes the child behave as Node.
    options.env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  }
  const result = spawnSync(tool.command, tool.args, options);
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (stdout.trim()) output.appendLine(stdout.trimEnd());
  if (stderr.trim()) output.appendLine(stderr.trimEnd());
  output.appendLine('exit code: ' + result.status);

  if (result.error) {
    const setting = tool.label === 'CLI' ? 'opurom.cliPath' : 'opurom.compilerPath';
    const message = `Could not run the OPUROM ${tool.label}: ${result.error.message}. Check ${setting}.`;
    output.appendLine(message);
    output.show(true);
    vscode.window.showErrorMessage(message);
    return;
  }

  const parsed = parseDiagnostics(stdout + '\n' + stderr);
  diagnostics.clear();
  const grouped = new Map();
  for (const item of parsed) {
    const target = path.isAbsolute(item.file) ? item.file : path.resolve(cwd, item.file);
    const uri = vscode.Uri.file(target);
    const key = uri.toString();
    if (!grouped.has(key)) grouped.set(key, { uri, list: [] });
    const range = new vscode.Range(item.line, item.character, item.line, item.character + 1);
    const severity = item.severity === 'warning'
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Error;
    const diagnostic = new vscode.Diagnostic(range, item.message, severity);
    diagnostic.source = tool.label === 'CLI' ? 'opurom' : 'opuromc';
    grouped.get(key).list.push(diagnostic);
  }
  for (const entry of grouped.values()) diagnostics.set(entry.uri, entry.list);

  const errors = parsed.filter(item => item.severity === 'error').length;
  if (result.status === 0 && errors === 0) {
    const suffix = mode === 'compile' ? ' → ' + path.basename(tool.outputFile) : '';
    vscode.window.showInformationMessage(
      `OPUROM ${mode} succeeded for ${path.basename(file)}${suffix}`
    );
    return true;
  }
  const summary = errors
    ? `${errors} OPUROM ${errors === 1 ? 'error' : 'errors'}`
    : `exit code ${result.status}`;
  output.show(true);
  vscode.window.showErrorMessage(
    `OPUROM ${mode} failed: ${summary}. See the OPUROM output channel.`
  );
}

// One-click run: compile the active .opu to its IR, then launch the OPUROM
// debug adapter on that IR. Reuses the compile path so diagnostics and the
// compile step stay identical to `opurom.compile`.
async function runAndDebug(vscode, output, diagnostics) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.isUntitled) {
    vscode.window.showErrorMessage('Open a saved .opu file before running an OPUROM command.');
    return;
  }
  if (editor.document.isDirty && !(await editor.document.save())) {
    vscode.window.showErrorMessage('Save the .opu file before running an OPUROM command.');
    return;
  }
  const file = editor.document.uri.fsPath;
  const compiled = await run(vscode, output, diagnostics, 'compile');
  if (!compiled) return;
  const irPath = path.join(path.dirname(file), path.basename(file, '.opu') + '.opuir.json');
  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!folder) {
    vscode.window.showErrorMessage('No workspace folder to launch the OPUROM debugger in.');
    return;
  }
  const started = await vscode.debug.startDebugging(
    folder.uri,
    { type: 'opurom', request: 'launch', name: 'OPUROM', program: irPath, steps: [] }
  );
  if (!started) {
    vscode.window.showErrorMessage('The OPUROM debugger did not start. Check the OPUROM output channel.');
  }
}

// Holds the running language server for the lifetime of the extension.
let languageServer = null;

// A fresh server process needs the handshake and every open document replayed.
function initializeLspSession(vscode, client) {
  client.request('initialize', {
    processId: process.pid,
    rootUri: vscode.workspace.workspaceFolders?.[0]?.uri.toString() || null,
    capabilities: {}
  });
  client.notify('initialized', {});
  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId !== 'opurom') continue;
    client.notify('textDocument/didOpen', {
      textDocument: {
        uri: document.uri.toString(),
        languageId: document.languageId,
        version: document.version,
        text: document.getText()
      }
    });
  }
}

function startLanguageServer(vscode, context, output, diagnostics) {
  const config = vscode.workspace.getConfiguration('opurom');
  const configured = String(config.get('lspPath') || '').trim();
  const serverPath = configured || defaultLspServerPath();
  if (!fs.existsSync(serverPath)) {
    output.appendLine(`OPUROM language server not found at ${serverPath}.`);
    output.appendLine('Set opurom.lspPath to the opurom-lsp/bin/server.mjs file to enable it.');
    return null;
  }

  const client = new LspClient(serverPath, {
    onDiagnostics: params => {
      const uri = vscode.Uri.parse(params.uri);
      const list = (params.diagnostics || []).map(item => {
        const start = item.range?.start || { line: 0, character: 0 };
        const end = item.range?.end || { line: start.line, character: start.character + 1 };
        const range = new vscode.Range(
          start.line, start.character, end.line, end.character
        );
        const severity = item.severity === 2
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Error;
        const diagnostic = new vscode.Diagnostic(range, item.message, severity);
        diagnostic.source = 'opurom-lsp';
        return diagnostic;
      });
      diagnostics.set(uri, list);
    },
    onMessage: event => {
      if (event.kind === 'stderr') {
        output.appendLine(String(event.text).trimEnd());
        return;
      }
      if (event.kind === 'error') {
        output.appendLine(`Language server error: ${event.text}`);
        return;
      }
      const message = event.message;
      if (message && message.method === 'window/showMessage') {
        const params = message.params || {};
        output.appendLine(`Language server: ${params.message}`);
        if (params.type === 2) vscode.window.showWarningMessage(params.message);
      }
    }
  });

  client.start();

  const isOpurom = document => document.languageId === 'opurom';
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(document => {
      if (!isOpurom(document)) return;
      client.notify('textDocument/didOpen', {
        textDocument: {
          uri: document.uri.toString(),
          languageId: document.languageId,
          version: document.version,
          text: document.getText()
        }
      });
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (!isOpurom(event.document)) return;
      client.notify('textDocument/didChange', {
        textDocument: { uri: event.document.uri.toString(), version: event.document.version },
        contentChanges: [{ text: event.document.getText() }]
      });
    }),
    vscode.workspace.onDidCloseTextDocument(document => {
      if (!isOpurom(document)) return;
      client.notify('textDocument/didClose', {
        textDocument: { uri: document.uri.toString() }
      });
    }),
    { dispose: () => client.stop() }
  );

  initializeLspSession(vscode, client);
  output.appendLine(`OPUROM language server started: ${serverPath}`);

  return client;
}

function showActiveDocumentInfo(vscode) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'opurom') {
    vscode.window.showInformationMessage('Open an active .opu file to show its document info.');
    return;
  }
  const document = editor.document;
  const lines = document.lineCount;
  vscode.window.showInformationMessage(
    `OPUROM: ${path.basename(document.uri.fsPath)} has ${lines} ${lines === 1 ? 'line' : 'lines'}.`
  );
}

function restartLanguageServer(vscode, output, client) {
  if (!client) {
    vscode.window.showInformationMessage('The OPUROM language server is not running.');
    return;
  }
  client.restart();
  initializeLspSession(vscode, client);
  output.appendLine('OPUROM language server restarted.');
  vscode.window.showInformationMessage('OPUROM language server restarted.');
}

// The optional API keeps activation testable outside the extension host.
function activate(context) {
  const vscode = arguments[1] || context.vscode || require('vscode');
  const output = vscode.window.createOutputChannel('OPUROM');
  const diagnostics = vscode.languages.createDiagnosticCollection('opurom');
  context.subscriptions.push(
    output,
    diagnostics,
    vscode.commands.registerCommand('opurom.compile', () => run(vscode, output, diagnostics, 'compile')),
    vscode.commands.registerCommand('opurom.check', () => run(vscode, output, diagnostics, 'check')),
    vscode.commands.registerCommand('opurom.run', () => runAndDebug(vscode, output, diagnostics)),
    vscode.commands.registerCommand('opurom.showActiveDocumentInfo', () => showActiveDocumentInfo(vscode)),
    vscode.commands.registerCommand('opurom.restartLanguageServer', () =>
      restartLanguageServer(vscode, output, languageServer)
    )
  );
  context.subscriptions.push(
    vscode.languages.registerHoverProvider('opurom', createHoverProvider(vscode))
  );
  const debugServer = defaultDebugServerPath();
  if (!fs.existsSync(debugServer)) {
    output.appendLine(`OPUROM debug adapter not found at ${debugServer}.`);
    output.appendLine('Check out the sibling opurom-debug repository to enable debugging.');
  }
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('opurom', {
      createDebugAdapterDescriptor: () => debugAdapterDescriptor(vscode)
    })
  );
  languageServer = startLanguageServer(vscode, context, output, diagnostics);
}

function deactivate() {
  if (languageServer) {
    languageServer.stop();
    languageServer = null;
  }
}

module.exports = {
  activate,
  deactivate,
  parseDiagnostics,
  defaultCompilerPath,
  defaultLspServerPath,
  defaultDebugServerPath,
  debugAdapterDescriptor,
  showActiveDocumentInfo,
  restartLanguageServer,
  runAndDebug,
  toolFor,
  createHoverProvider,
  generateHoverCard,
  generatePropHoverCard
};
