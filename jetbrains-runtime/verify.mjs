import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { artifactCandidates, buildFallback } from './build.mjs';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const root = path.resolve(base, '..');
const modulePath = fileURLToPath(import.meta.url);
const CJK = /[\u3400-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;

function listing(zipPath) {
  const result = spawnSync('unzip', ['-l', zipPath], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.error) throw new Error(`unzip -l: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`unzip -l failed (${result.status}): ${String(result.stderr || '').trim()}`);
  const entries = [];
  for (const line of String(result.stdout).split(/\r?\n/)) {
    const match = /^\s*\d+\s+\S+\s+\S+\s+(.+)$/.exec(line);
    if (match) entries.push(match[1].trim());
  }
  if (entries.length === 0) throw new Error(`empty unzip listing: ${zipPath}`);
  return entries;
}

function readEntry(zipPath, entry, encoding) {
  const result = spawnSync('unzip', ['-p', zipPath, entry], {
    encoding,
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.error) throw new Error(`unzip -p ${entry}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`unzip -p ${entry} failed (${result.status})`);
  if (!result.stdout || result.stdout.length === 0) throw new Error(`empty ZIP entry: ${entry}`);
  return result.stdout;
}

export function verifyArtifact(zipPath) {
  if (!fs.existsSync(zipPath)) throw new Error(`missing plugin ZIP: ${zipPath}`);
  const entries = listing(zipPath);
  const classEntries = entries.filter(entry => /\/lib\/.+\.class$/.test(entry));
  const jarEntry = entries.find(entry => /\/lib\/[^/]+\.jar$/.test(entry));
  const pluginXmlEntry = entries.find(entry => /(^|\/)plugin\.xml$/.test(entry) && !entry.includes('META-INF/'));
  const grammarEntry = entries.find(entry => /\/textmate\/opurom\.tmLanguage\.json$/.test(entry));

  if (!entries.some(entry => entry.includes('/lib/'))) throw new Error('plugin ZIP has no lib/ directory');
  if (classEntries.length === 0) throw new Error('plugin ZIP has no compiled .class files');
  if (!classEntries.some(entry => entry.endsWith('opurom/jetbrains/LspClient.class'))) {
    throw new Error('plugin ZIP is missing LspClient.class');
  }
  if (!classEntries.some(entry => entry.endsWith('opurom/jetbrains/OpuromFileType.class'))) {
    throw new Error('plugin ZIP is missing OpuromFileType.class');
  }
  if (!jarEntry) throw new Error('plugin ZIP has no plugin JAR in lib/');
  if (!pluginXmlEntry) throw new Error('plugin ZIP has no root plugin.xml');
  if (!grammarEntry) throw new Error('plugin ZIP has no declared grammar resource');

  const pluginXml = readEntry(zipPath, pluginXmlEntry, 'utf8');
  const lower = pluginXml.toLowerCase();
  const markers = [
    '<id>', '<name>', '<vendor', '<idea-version', '<depends',
    'filetype', 'lang.syntaxhighlighterfactory', 'opuromgrammar',
    'opuromlspclient', 'poststartupactivity', 'textmate/opurom.tmlanguage.json'
  ];
  const missing = markers.filter(marker => !lower.includes(marker));
  if (missing.length) throw new Error(`plugin.xml missing declarations: ${missing.join(', ')}`);
  if (CJK.test(pluginXml)) throw new Error('plugin.xml is not English-only');

  const jarBytes = readEntry(zipPath, jarEntry, 'buffer');
  const verifyDir = path.join(base, 'build', 'verify');
  fs.mkdirSync(verifyDir, { recursive: true });
  const jarPath = path.join(verifyDir, 'plugin.jar');
  fs.writeFileSync(jarPath, jarBytes);
  const jarEntries = listing(jarPath);
  if (!jarEntries.some(entry => entry.endsWith('META-INF/plugin.xml'))) {
    throw new Error('plugin JAR has no META-INF/plugin.xml');
  }
  if (!jarEntries.some(entry => entry.endsWith('.class'))) throw new Error('plugin JAR has no compiled classes');
  if (!jarEntries.some(entry => entry.endsWith('textmate/opurom.tmLanguage.json'))) {
    throw new Error('plugin JAR has no grammar resource');
  }
  if (jarEntries.some(entry => entry.includes('com/intellij/'))) {
    throw new Error('plugin JAR must not package IntelliJ API stubs');
  }
  return { zipPath, entries, classEntries, jarEntry, pluginXmlEntry, grammarEntry, pluginXml, jarEntries };
}

export function ensureArtifact() {
  for (const candidate of artifactCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    try {
      verifyArtifact(candidate);
      return candidate;
    } catch {
      // A failed Gradle attempt may leave a partial archive; the fallback is the next candidate.
    }
  }
  const zipPath = buildFallback();
  verifyArtifact(zipPath);
  return zipPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  try {
    const zipPath = ensureArtifact();
    const result = verifyArtifact(zipPath);
    const relative = path.relative(root, zipPath);
    console.log(`PASS runtime plugin ZIP (${relative}, ${result.entries.length} entries)`);
    console.log(`PASS runtime plugin JAR (${result.jarEntries.length} entries, ${result.classEntries.length} lib classes)`);
  } catch (error) {
    console.error(`FAIL runtime plugin archive: ${error.message}`);
    process.exitCode = 1;
  }
}
