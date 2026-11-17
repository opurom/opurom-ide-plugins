'use strict';

const path = require('node:path');

// Debug-side editor experience: turn the active source file into a launch
// config and report breakpoint verification/hits from the adapter messages.
// The adapter itself lives in the debugger repository.

function irPathForSource(file) {
  return path.join(path.dirname(file), path.basename(file, '.opu') + '.opuir.json');
}

function activeOpuFile(vscode) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !editor.document || editor.document.isUntitled) return null;
  const uri = editor.document.uri;
  const file = typeof uri?.fsPath === 'string' ? uri.fsPath : '';
  if (!file.endsWith('.opu')) return null;
  return file;
}

function createDebugConfigurationProvider(vscode) {
  return {
    provideDebugConfigurations() {
      const file = activeOpuFile(vscode);
      if (!file) return [];
      return [{
        type: 'opurom',
        request: 'launch',
        name: 'Opurom (current file)',
        program: irPathForSource(file),
        steps: []
      }];
    },
    resolveDebugConfiguration(folder, config) {
      if (!config || config.type !== 'opurom' || config.program) return config;
      const file = activeOpuFile(vscode);
      if (!file) {
        vscode.window.showErrorMessage('Open a saved .opu file to debug the current document.');
        return null;
      }
      return {
        ...config,
        request: config.request || 'launch',
        name: config.name || 'Opurom',
        program: irPathForSource(file),
        steps: config.steps || []
      };
    }
  };
}

function createBreakpointTrackerFactory(vscode, output) {
  return {
    createDebugAdapterTracker() {
      let verified = 0;
      let hits = 0;
      return {
        onWillReceiveMessage(message) {
          if (message?.command === 'setBreakpoints') {
            const count = (message.arguments?.breakpoints || []).length;
            output.appendLine(`Opurom breakpoints: requested ${count}`);
          }
        },
        onDidReceiveMessage(message) {
          if (message?.type === 'response' && message.command === 'setBreakpoints') {
            const list = message.body?.breakpoints || [];
            verified = list.filter(item => item.verified).length;
            output.appendLine(`Opurom breakpoints: ${verified} verified`);
          }
          if (message?.type === 'event' && message.event === 'stopped' && message.body?.reason === 'breakpoint') {
            hits += 1;
            const ids = message.body.hitBreakpointIds || [];
            output.appendLine(
              `Opurom breakpoint hit #${hits}${ids.length ? ` (id ${ids.join(',')})` : ''}`
            );
          }
        }
      };
    }
  };
}

module.exports = {
  irPathForSource,
  activeOpuFile,
  createDebugConfigurationProvider,
  createBreakpointTrackerFactory
};
