// Integration test for the zero-dependency LSP client in the extension.
//
// It spawns the real language server from the sibling opurom-lsp repository
// and checks that the client speaks the JSON-RPC framing and receives the
// published diagnostics. The test is skipped when the server is absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { LspClient, defaultLspPath, encodeMessage } = require(path.join(root, 'vscode-opurom', 'lsp-client.js'));

const serverPath = defaultLspPath();
const available = fs.existsSync(serverPath);

test('the client frames messages with Content-Length', () => {
  const encoded = encodeMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const text = encoded.toString('latin1');
  assert.match(text, /^Content-Length: \d+\r\n\r\n/);
  const body = text.split('\r\n\r\n').slice(1).join('\r\n\r\n');
  assert.deepEqual(JSON.parse(body), { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
});

test('the client receives diagnostics from the language server', { skip: !available }, async () => {
  const published = [];
  const client = new LspClient(serverPath, {
    onDiagnostics: params => published.push(params)
  });
  client.start();

  const initialize = await client.request('initialize', {
    processId: process.pid,
    capabilities: {}
  });
  assert.equal(initialize.result.capabilities.textDocumentSync, 1);
  assert.equal(initialize.result.capabilities.hoverProvider, true);
  assert.equal(initialize.result.capabilities.definitionProvider, true);
  assert.ok(initialize.result.capabilities.completionProvider);
  assert.ok(initialize.result.capabilities.diagnosticProvider);

  client.notify('initialized', {});

  const uri = 'file:///tmp/opurom-ide-plugins-test/bad.opu';
  client.notify('textDocument/didOpen', {
    textDocument: {
      uri,
      languageId: 'opurom',
      version: 1,
      text: 'app Counter {\n  state count = 0\n  Column(gap: 8) { Text("x {nope}") }\n}\n'
    }
  });

  const deadline = Date.now() + 10000;
  while (published.length === 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  client.stop();

  assert.equal(published.length, 1);
  assert.equal(published[0].uri, uri);
  assert.equal(published[0].diagnostics.length, 1);
  assert.equal(published[0].diagnostics[0].severity, 1);
  assert.match(published[0].diagnostics[0].message, /unknown state/);
});

test('the client restarts the language server process', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opurom-lsp-restart-'));
  const server = path.join(dir, 'server.mjs');
  const log = path.join(dir, 'pids.log');
  fs.writeFileSync(server, [
    "import fs from 'node:fs';",
    "fs.appendFileSync(process.env.OPUROM_RESTART_LOG, String(process.pid) + '\\n');",
    "process.stdin.on('data', chunk => {",
    "  if (String(chunk).includes('shutdown')) process.exit(0);",
    '});'
  ].join('\n') + '\n');
  const previous = process.env.OPUROM_RESTART_LOG;
  process.env.OPUROM_RESTART_LOG = log;
  const client = new LspClient(server);
  try {
    client.start();
    await waitForPids(log, 1);
    client.restart();
    const pids = await waitForPids(log, 2);
    assert.equal(pids.length, 2);
    assert.notEqual(pids[0], pids[1]);
    assert.equal(String(client.child.pid), pids[1]);
    assert.equal(client.closed, false);
  } finally {
    client.stop();
    if (previous === undefined) delete process.env.OPUROM_RESTART_LOG;
    else process.env.OPUROM_RESTART_LOG = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function waitForPids(file, count) {
  const deadline = Date.now() + 5000;
  for (;;) {
    if (fs.existsSync(file)) {
      const pids = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
      if (pids.length >= count) return pids;
    }
    if (Date.now() > deadline) throw new Error('language server process did not start');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
