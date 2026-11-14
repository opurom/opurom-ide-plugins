import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { jdkTool, hasJdk } from '../jetbrains-runtime/build.mjs';
import { ensureArtifact, verifyArtifact } from '../jetbrains-runtime/verify.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, 'jetbrains-runtime');
const artifact = ensureArtifact();
const verified = verifyArtifact(artifact);
const jdkAvailable = hasJdk();

test('compiled plugin archive contains lib classes, plugin.xml and grammar', () => {
  assert.ok(fs.statSync(artifact).size > 0);
  assert.ok(verified.entries.some(entry => entry.includes('/lib/')));
  assert.ok(verified.classEntries.some(entry => entry.endsWith('opurom/jetbrains/LspClient.class')));
  assert.ok(verified.entries.some(entry => /(^|\/)plugin\.xml$/.test(entry)));
  assert.ok(verified.entries.some(entry => entry.endsWith('textmate/opurom.tmLanguage.json')));
  assert.ok(verified.jarEntries.some(entry => entry.endsWith('META-INF/plugin.xml')));
});

test('verify.mjs accepts the real archive and rejects a malformed one', () => {
  const cli = spawnSync(process.execPath, [path.join(runtime, 'verify.mjs')], {
    encoding: 'utf8',
    cwd: root
  });
  assert.equal(cli.status, 0, String(cli.stderr || cli.stdout));

  const malformedDir = path.join(runtime, 'build', 'test', 'malformed');
  fs.mkdirSync(malformedDir, { recursive: true });
  fs.writeFileSync(path.join(malformedDir, 'plugin.xml'), '<idea-plugin><id>bad</id></idea-plugin>\n');
  const malformed = path.join(malformedDir, `malformed-${process.pid}.zip`);
  const zip = spawnSync('zip', ['-q', '-X', malformed, 'plugin.xml'], {
    encoding: 'utf8',
    cwd: malformedDir
  });
  assert.equal(zip.status, 0, String(zip.stderr));
  assert.throws(() => verifyArtifact(malformed), /lib\//);
});

test('Java LSP client frames didOpen/didChange and parses diagnostics', { skip: jdkAvailable ? false : 'no JDK 21 toolchain' }, () => {
  const testDir = path.join(runtime, 'build', 'test');
  fs.mkdirSync(testDir, { recursive: true });
  const jarPath = path.join(testDir, 'plugin.jar');
  const extracted = spawnSync('unzip', ['-p', artifact, verified.jarEntry], {
    encoding: 'buffer',
    maxBuffer: 20 * 1024 * 1024
  });
  assert.equal(extracted.status, 0, String(extracted.stderr));
  fs.writeFileSync(jarPath, extracted.stdout);

  const recordPath = path.join(testDir, 'lsp-record.txt');
  fs.writeFileSync(recordPath, '');
  const serverPath = path.join(runtime, 'fixtures', 'fake-lsp-server.mjs');
  const probe = spawnSync(jdkTool('java'), [
    '-cp', jarPath, 'opurom.jetbrains.LspProbe',
    process.execPath, serverPath, recordPath,
    'file:///workspace/counter.opu', 'app Counter {}', 'state count = 0'
  ], {
    encoding: 'utf8',
    cwd: runtime,
    timeout: 20000,
    maxBuffer: 10 * 1024 * 1024
  });
  assert.equal(probe.status, 0, String(probe.stderr || probe.stdout));
  assert.match(probe.stdout, /RESULT diagnostics=1/);
  assert.match(probe.stdout, /DIAG .*\|2\|4\|1\|unknown state/);
  const record = fs.readFileSync(recordPath, 'utf8');
  assert.match(record, /initialize/);
  assert.match(record, /textDocument\/didOpen/);
  assert.match(record, /textDocument\/didChange/);
});
