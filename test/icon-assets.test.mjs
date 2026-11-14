import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const icons = [
  'vscode-opurom/logo.png',
  'jetbrains-runtime/src/main/resources/META-INF/pluginIcon.png',
  'jetbrains-runtime/src/main/resources/META-INF/pluginIcon_dark.png'
];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND_CRC = 0xae426082;

test('official extension icons are valid, non-empty 256x256 PNGs', () => {
  const digests = new Set();
  for (const relativePath of icons) {
    const bytes = fs.readFileSync(path.join(root, relativePath));
    assert.ok(bytes.length > 1000, `${relativePath} is non-empty`);
    assert.deepEqual(bytes.subarray(0, 8), PNG_SIGNATURE, `${relativePath} has a PNG signature`);
    assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', `${relativePath} starts with IHDR`);
    assert.equal(bytes.readUInt32BE(16), 256, `${relativePath} is 256 pixels wide`);
    assert.equal(bytes.readUInt32BE(20), 256, `${relativePath} is 256 pixels tall`);

    let offset = 8;
    let chunks = 0;
    let foundIend = false;
    while (offset + 8 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      assert.ok(offset + 12 + length <= bytes.length, `${relativePath} has a complete ${type} chunk`);
      offset += 12 + length;
      chunks += 1;
      if (type === 'IEND') {
        foundIend = true;
        break;
      }
    }
    assert.ok(foundIend, `${relativePath} ends with IEND`);
    assert.equal(offset, bytes.length, `${relativePath} has no trailing bytes`);
    assert.ok(chunks >= 3, `${relativePath} has PNG chunks`);
    assert.equal(bytes.readUInt32BE(bytes.length - 4), IEND_CRC, `${relativePath} has a valid IEND CRC`);
    digests.add(createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(digests.size, 1, 'all extension icons are byte-identical official-derived PNGs');
});
