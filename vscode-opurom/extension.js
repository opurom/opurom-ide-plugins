'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
    return;
  }
  const summary = errors
    ? `${errors} OPUROM ${errors === 1 ? 'error' : 'errors'}`
    : `exit code ${result.status}`;
  output.show(true);
  vscode.window.showErrorMessage(
    `OPUROM ${mode} failed: ${summary}. See the OPUROM output channel.`
  );
}

function activate(context) {
  const vscode = require('vscode');
  const output = vscode.window.createOutputChannel('OPUROM');
  const diagnostics = vscode.languages.createDiagnosticCollection('opurom');
  context.subscriptions.push(
    output,
    diagnostics,
    vscode.commands.registerCommand('opurom.compile', () => run(vscode, output, diagnostics, 'compile')),
    vscode.commands.registerCommand('opurom.check', () => run(vscode, output, diagnostics, 'check'))
  );
}

function deactivate() {}

module.exports = { activate, deactivate, parseDiagnostics, defaultCompilerPath, toolFor };
