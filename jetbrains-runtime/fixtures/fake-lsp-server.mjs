import fs from 'node:fs';

const recordPath = process.argv[2];
fs.writeFileSync(recordPath, '');
let buffer = Buffer.alloc(0);

function framed(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

function handle(message) {
  fs.appendFileSync(recordPath, `${message.method || `response:${message.id}`}\n`);
  if (message.method === 'initialize') {
    process.stdout.write(framed({
      jsonrpc: '2.0',
      id: message.id,
      result: { capabilities: { textDocumentSync: 1, diagnosticProvider: {} } }
    }));
  }
  if (message.method === 'textDocument/didChange') {
    process.stdout.write(framed({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: message.params.textDocument.uri,
        diagnostics: [{
          range: {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 9 }
          },
          severity: 1,
          message: 'unknown state "nope"'
        }]
      }
    }));
  }
  if (message.method === 'shutdown') {
    process.stdout.write(framed({ jsonrpc: '2.0', id: message.id, result: null }));
  }
  if (message.method === 'exit') {
    process.exit(0);
  }
}

process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString('ascii');
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const body = buffer.subarray(start, start + length).toString('utf8');
    buffer = buffer.subarray(start + length);
    handle(JSON.parse(body));
  }
});
