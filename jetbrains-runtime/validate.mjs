import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(modulePath), '..');
const CJK = /[\u3400-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;

function defaultCheck(condition, label, detail = '') {
  if (!condition) throw new Error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  console.log(`PASS ${label}${detail ? ` (${detail})` : ''}`);
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function walkFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'build' || entry.name === '.gradle' || entry.name === '.gradle-home') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full));
    else files.push(full);
  }
  return files;
}

export function validateRuntime(check = defaultCheck, rootDir = defaultRoot) {
  const runtime = path.join(rootDir, 'jetbrains-runtime');
  const gradle = readText(path.join(runtime, 'build.gradle'));
  const settings = readText(path.join(runtime, 'settings.gradle'));
  const gradleOk = gradle.includes("id 'org.jetbrains.intellij' version '1.17.4'") &&
    gradle.includes("version = '2023.3.6'") &&
    gradle.includes("type = 'IC'") &&
    gradle.includes('buildPlugin') &&
    settings.includes('pluginManagement') &&
    settings.includes('gradlePluginPortal()');
  check(gradleOk, 'runtime Gradle IntelliJ SDK project', 'org.jetbrains.intellij 1.17.4, ideaIC 2023.3.6');

  const pluginXml = readText(path.join(runtime, 'src', 'main', 'resources', 'META-INF', 'plugin.xml'));
  const pluginMarkers = [
    '<id>', '<name>', '<vendor', '<idea-version', '<depends',
    '<fileType', '<lang.syntaxHighlighterFactory', '<extensionPoint name="opuromGrammar"',
    '<extensionPoint name="opuromLspClient"', '<postStartupActivity',
    'textmate/opurom.tmLanguage.json'
  ];
  check(pluginMarkers.every(marker => pluginXml.includes(marker)),
    'runtime plugin.xml declarations', 'id, name, vendor, idea-version, depends, language, file type, grammar, LSP client');

  const lsp = readText(path.join(runtime, 'src', 'main', 'java', 'opurom', 'jetbrains', 'LspClient.java'));
  const grammar = readText(path.join(runtime, 'src', 'main', 'java', 'opurom', 'jetbrains', 'OpuromTextMateGrammar.java'));
  const startup = readText(path.join(runtime, 'src', 'main', 'java', 'opurom', 'jetbrains', 'OpuromLspStartupActivity.java'));
  const lspMarkers = [
    'ProcessBuilder', 'Content-Length', 'textDocument/didOpen', 'textDocument/didChange',
    'textDocument/publishDiagnostics', 'LspDiagnostics.parse', 'didOpen(', 'didChange('
  ];
  check(lspMarkers.every(marker => lsp.includes(marker)) &&
    grammar.includes('textmate/opurom.tmLanguage.json') &&
    startup.includes('didOpen(') && startup.includes('didChange('),
    'runtime Java LSP client contract', 'spawn, framing, didOpen/didChange, publishDiagnostics parsing');

  const ignore = readText(path.join(rootDir, '.gitignore'));
  const ignorePatterns = ['.gradle-home/', '.gradle/', 'jetbrains-runtime/build/', '*.jar', '*.zip', '*.class'];
  check(ignorePatterns.every(pattern => ignore.includes(pattern)),
    'runtime build outputs ignored', 'SDK cache, build/, JAR, ZIP, class files');

  const sourceFiles = [
    ...walkFiles(runtime),
    path.join(rootDir, 'test', 'runtime-plugin.test.mjs'),
    path.join(rootDir, 'scripts', 'validate.mjs')
  ];
  const englishOk = sourceFiles.every(file => !CJK.test(readText(file)));
  check(englishOk, 'runtime sources are English-only', `${sourceFiles.length} files, no CJK text`);

  const jsFiles = [
    ...walkFiles(runtime).filter(file => /\.(?:js|mjs)$/.test(file)),
    path.join(rootDir, 'test', 'runtime-plugin.test.mjs'),
    path.join(rootDir, 'scripts', 'validate.mjs'),
    path.join(rootDir, 'jetbrains', 'validate.mjs')
  ];
  const syntax = jsFiles.map(file => spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    cwd: rootDir
  }));
  const syntaxFailure = syntax.find(result => result.status !== 0);
  check(!syntaxFailure, 'runtime scripts syntax (node --check)',
    syntaxFailure?.stderr.trim() || `${jsFiles.length} JS/MJS files`);

  const verify = spawnSync(process.execPath, [path.join(runtime, 'verify.mjs')], {
    encoding: 'utf8',
    cwd: rootDir
  });
  const detail = verify.status === 0
    ? verify.stdout.trim().split(/\r?\n/).filter(line => line.startsWith('PASS ')).join('; ')
    : String(verify.stderr || verify.stdout || '').trim();
  check(verify.status === 0, 'runtime plugin ZIP verification', detail || 'unzip -l structure and JAR contents');
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  validateRuntime(defaultCheck);
}
