'use strict';

// Zero-dependency LSP client for the OPUROM language server.
// Node builtins only: it spawns `node <server> --stdio` and speaks the
// standard `Content-Length: N\r\n\r\n<JSON>` JSON-RPC framing.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HEADER_END = '\r\n\r\n';

function defaultLspPath() {
  return path.resolve(__dirname, '..', '..', 'opurom-lsp', 'bin', 'server.mjs');
}

function encodeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

class LspClient {
  constructor(serverPath, { onDiagnostics, onMessage } = {}) {
    this.serverPath = serverPath;
    this.onDiagnostics = onDiagnostics || (() => {});
    this.onMessage = onMessage || (() => {});
    this.child = null;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
  }

  start() {
    if (this.child) return;
    this.child = spawn(process.execPath, [this.serverPath, '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.stdout.on('data', chunk => this._onData(chunk));
    this.child.stderr.on('data', chunk => this.onMessage({ kind: 'stderr', text: String(chunk) }));
    this.child.on('exit', () => {
      this.child = null;
      this.closed = true;
    });
    this.child.on('error', error => this.onMessage({ kind: 'error', text: error.message }));
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_END);
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + HEADER_END.length);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + HEADER_END.length;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.subarray(start, start + length).toString('utf8');
      this.buffer = this.buffer.subarray(start + length);
      let message = null;
      try {
        message = JSON.parse(body);
      } catch (error) {
        this.onMessage({ kind: 'error', text: `invalid LSP frame: ${error.message}` });
        continue;
      }
      this._dispatch(message);
    }
  }

  _dispatch(message) {
    if (message.id !== undefined && message.id !== null && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      entry(message);
      return;
    }
    if (message.method === 'textDocument/publishDiagnostics') {
      this.onDiagnostics(message.params);
      return;
    }
    this.onMessage({ kind: 'notification', message });
  }

  send(message) {
    if (!this.child || this.closed) return;
    this.child.stdin.write(encodeMessage(message));
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params });
  }

  request(method, params) {
    if (!this.child || this.closed) return Promise.resolve(null);
    const id = this.nextId++;
    return new Promise(resolve => {
      this.pending.set(id, resolve);
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  stop() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    this.closed = true;
    try {
      child.stdin.write(encodeMessage({ jsonrpc: '2.0', id: this.nextId++, method: 'shutdown', params: null }));
      child.stdin.write(encodeMessage({ jsonrpc: '2.0', method: 'exit', params: null }));
    } catch (error) {
      // The server may already be gone; killing it below is enough.
    }
    child.kill();
  }
}

module.exports = { LspClient, defaultLspPath, encodeMessage };
