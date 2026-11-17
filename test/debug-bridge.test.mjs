// Editor-side debug bridge: launch configs are derived from the active .opu
// source, and breakpoint verification/hits are observed from adapter messages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridge = require(path.join(root, 'vscode-opurom', 'debug-bridge.js'));

function fakeVscode(file) {
  const messages = [];
  const editor = file
    ? { document: { isUntitled: false, uri: { fsPath: file } } }
    : null;
  return {
    messages,
    window: {
      activeTextEditor: editor,
      showErrorMessage: message => messages.push(message)
    }
  };
}

test('launch configuration is derived from the active .opu file', () => {
  const vscode = fakeVscode('/tmp/work/counter.opu');
  const provider = bridge.createDebugConfigurationProvider(vscode);
  const configs = provider.provideDebugConfigurations();
  assert.equal(configs.length, 1);
  assert.equal(configs[0].type, 'opurom');
  assert.equal(configs[0].request, 'launch');
  assert.equal(configs[0].program, '/tmp/work/counter.opuir.json');

  const resolved = provider.resolveDebugConfiguration(null, { type: 'opurom' });
  assert.equal(resolved.program, '/tmp/work/counter.opuir.json');
  assert.deepEqual(resolved.steps, []);
});

test('explicit launch programs are kept and missing sources fail clearly', () => {
  const explicit = { type: 'opurom', program: '/tmp/manual.opuir.json' };
  const keep = bridge.createDebugConfigurationProvider(fakeVscode('/tmp/work/a.opu'));
  assert.equal(keep.resolveDebugConfiguration(null, explicit), explicit);

  const vscode = fakeVscode(null);
  const provider = bridge.createDebugConfigurationProvider(vscode);
  assert.deepEqual(provider.provideDebugConfigurations(), []);
  assert.equal(provider.resolveDebugConfiguration(null, { type: 'opurom' }), null);
  assert.match(vscode.messages[0], /\.opu/);
});

test('the tracker reports verified breakpoints and stopped hits', () => {
  const lines = [];
  const factory = bridge.createBreakpointTrackerFactory(null, {
    appendLine: line => lines.push(line)
  });
  const tracker = factory.createDebugAdapterTracker({ type: 'opurom' });
  tracker.onWillReceiveMessage({
    command: 'setBreakpoints',
    arguments: { breakpoints: [{ line: 3 }, { line: 8 }] }
  });
  tracker.onDidReceiveMessage({
    type: 'response',
    command: 'setBreakpoints',
    body: { breakpoints: [{ verified: true }, { verified: false }] }
  });
  tracker.onDidReceiveMessage({
    type: 'event',
    event: 'stopped',
    body: { reason: 'breakpoint', hitBreakpointIds: [12] }
  });
  assert.deepEqual(lines, [
    'Opurom breakpoints: requested 2',
    'Opurom breakpoints: 1 verified',
    'Opurom breakpoint hit #1 (id 12)'
  ]);
});
