import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'vscode-opurom');
const require = createRequire(import.meta.url);

function check(condition, label, detail = '') {
  if (!condition) throw new Error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  console.log(`PASS ${label}${detail ? ` (${detail})` : ''}`);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function compileRegex(pattern, label) {
  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new Error(`FAIL ${label}: ${JSON.stringify(pattern)} ${error.message}`);
  }
}

function collect(node, scopes, regexes, includes) {
  if (Array.isArray(node)) {
    for (const value of node) collect(value, scopes, regexes, includes);
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (typeof node.name === 'string') scopes.add(node.name);
  if (typeof node.include === 'string') includes.add(node.include);
  if (node.captures && typeof node.captures === 'object') {
    for (const capture of Object.values(node.captures)) {
      if (capture && typeof capture.name === 'string') scopes.add(capture.name);
    }
  }
  for (const key of ['match', 'begin', 'end']) {
    if (typeof node[key] === 'string') regexes.push(compileRegex(node[key], `grammar ${key}`));
  }
  for (const value of Object.values(node)) collect(value, scopes, regexes, includes);
}

const jsonFiles = walk(root).filter(file => file.endsWith('.json'));
for (const file of jsonFiles) JSON.parse(fs.readFileSync(file, 'utf8'));
check(jsonFiles.length >= 4, 'JSON files parsed', `${jsonFiles.length} files`);

const grammar = readJson('vscode-opurom/syntaxes/opurom.tmLanguage.json');
const language = readJson('vscode-opurom/language-configuration.json');
const snippets = readJson('vscode-opurom/snippets/opurom.json');
const pkg = readJson('vscode-opurom/package.json');

const scopes = new Set();
const regexes = [];
const includes = new Set();
collect(grammar, scopes, regexes, includes);
check(grammar.scopeName === 'source.opurom' && regexes.length > 0, 'grammar regexes compiled', `${regexes.length} patterns`);

const requiredScopes = [
  'comment.line.double-slash.opurom',
  'keyword.control.opurom',
  'support.class.node.opurom',
  'string.quoted.double.opurom',
  'constant.character.escape.opurom',
  'meta.interpolation.opurom',
  'variable.other.interpolation.opurom',
  'constant.numeric.opurom',
  'constant.language.boolean.opurom',
  'variable.parameter.prop.opurom',
  'keyword.operator.opurom',
  'punctuation.opurom'
];
const missingScopes = requiredScopes.filter(scope => !scopes.has(scope));
check(missingScopes.length === 0, 'grammar scopes', `${requiredScopes.length} required scopes`);
const unresolvedIncludes = [...includes].filter(
  include => !include.startsWith('#') || !(include.slice(1) in grammar.repository)
);
check(unresolvedIncludes.length === 0, 'grammar includes resolved', `${includes.size} references`);

const tokenChecks = [
  ['line comment', '// note'],
  ['app keyword', 'app'],
  ['state keyword', 'state'],
  ['Column kind', 'Column'],
  ['Container kind', 'Container'],
  ['prop name', 'padding:'],
  ['number', '-1'],
  ['string', '"Hello"'],
  ['boolean', 'false'],
  ['interpolation open', '{'],
  ['+= operator', '+='],
  ['-= operator', '-='],
  ['= operator', '='],
  ['toggle', '.toggle()'],
  ['punctuation', ':'],
  ['literal brace', '{{']
];
const uncovered = tokenChecks.filter(([, token]) => !regexes.some(pattern => pattern.test(token)));
check(uncovered.length === 0, 'grammar token coverage', `${tokenChecks.length} tokens`);

const stringPatterns = grammar.repository.strings.patterns;
const interpolation = stringPatterns.find(pattern => pattern.name === 'meta.interpolation.opurom');
const interpolationOk = Boolean(
  interpolation &&
  compileRegex(interpolation.begin, 'interpolation begin').test('{') &&
  compileRegex(interpolation.end, 'interpolation end').test('}') &&
  interpolation.patterns.some(pattern => pattern.name === 'variable.other.interpolation.opurom')
);
check(interpolationOk, 'string interpolation rule', '{name}');
const literalBraceOk = stringPatterns.some(
  pattern => pattern.name === 'constant.character.escape.opurom' &&
    typeof pattern.match === 'string' &&
    compileRegex(pattern.match, 'literal brace').test('{{')
);
check(literalBraceOk, 'literal {{ escape');

for (const [key, pattern] of Object.entries(language.indentationRules || {})) {
  compileRegex(pattern, `language ${key}`);
}
const languageOk = language.comments?.lineComment === '//' &&
  language.brackets?.length > 0 &&
  language.autoClosingPairs?.length > 0 &&
  language.surroundingPairs?.length > 0 &&
  Object.keys(language.indentationRules || {}).length === 2;
check(languageOk, 'language configuration', 'comments, pairs, brackets, indentation');

const snippetEntries = Object.values(snippets);
const snippetText = JSON.stringify(snippets);
const snippetOk = snippetEntries.length === 4 &&
  snippetEntries.every(entry => entry.prefix && Array.isArray(entry.body) && entry.description) &&
  ['opurom-app', 'Column', 'Text', 'Button', '+= 1', 'Input', 'bind:'].every(token => snippetText.includes(token));
check(snippetOk, 'snippets', `${snippetEntries.length} snippets`);

const versionParts = String(pkg.version || '').split('.');
const contributes = pkg.contributes || {};
const lang = contributes.languages?.[0];
const grammarContribution = contributes.grammars?.[0];
const snippetContribution = contributes.snippets?.[0];
const commandIds = (contributes.commands || []).map(command => command.command);
const properties = contributes.configuration?.properties || {};
const events = pkg.activationEvents || [];
const manifestOk = Boolean(
  pkg.publisher &&
  pkg.name &&
  versionParts.length === 3 &&
  versionParts.every(part => /^[0-9]+$/.test(part)) &&
  pkg.engines?.vscode &&
  pkg.main === './extension.js' &&
  events.includes('onLanguage:opurom') &&
  events.includes('onCommand:opurom.compile') &&
  events.includes('onCommand:opurom.check') &&
  lang?.id === 'opurom' &&
  lang.extensions?.includes('.opu') &&
  lang.aliases?.length > 0 &&
  typeof lang.configuration === 'string' &&
  grammarContribution?.language === 'opurom' &&
  grammarContribution.scopeName === 'source.opurom' &&
  typeof grammarContribution.path === 'string' &&
  snippetContribution?.language === 'opurom' &&
  typeof snippetContribution.path === 'string' &&
  commandIds.includes('opurom.compile') &&
  commandIds.includes('opurom.check') &&
  properties['opurom.compilerPath']?.type === 'string' &&
  properties['opurom.cliPath']?.type === 'string' &&
  !pkg.dependencies &&
  !pkg.devDependencies &&
  !pkg.scripts?.build
);
check(manifestOk, 'package.json contributes fields', 'languages, grammars, snippets, 2 commands, 2 settings');
const references = [
  pkg.main,
  contributes.languages[0].configuration,
  contributes.grammars[0].path,
  contributes.snippets[0].path
];
check(
  references.every(reference => fs.existsSync(path.join(ext, reference))),
  'manifest file references',
  `${references.length} files`
);

const extensionPath = path.join(ext, 'extension.js');
const extensionSrc = fs.readFileSync(extensionPath, 'utf8');
const activateStart = extensionSrc.indexOf('function activate(context)');
const deactivateStart = extensionSrc.indexOf('function deactivate()');
const vscodeRequireIndex = extensionSrc.indexOf("require('vscode')");
const importOk = extensionSrc.split("require('vscode')").length - 1 === 1 &&
  !extensionSrc.includes('require("vscode")') &&
  activateStart >= 0 &&
  deactivateStart > activateStart &&
  vscodeRequireIndex > activateStart &&
  vscodeRequireIndex < deactivateStart;
check(importOk, 'vscode import is activate-only');

const requiredCode = [
  "require('node:child_process')",
  'spawnSync(',
  'createOutputChannel',
  'createDiagnosticCollection',
  'new vscode.Diagnostic',
  'showInformationMessage',
  'showErrorMessage',
  "registerCommand('opurom.compile'",
  "registerCommand('opurom.check'",
  'not found at',
  'function deactivate()'
];
check(
  requiredCode.every(marker => extensionSrc.includes(marker)),
  'extension.js runtime contract',
  'spawnSync, diagnostics, output, commands, deactivate'
);
const syntax = spawnSync(process.execPath, ['--check', extensionPath], { encoding: 'utf8' });
check(syntax.status === 0, 'extension.js syntax (node --check)', syntax.stderr.trim() || 'no syntax errors');

const extension = require(extensionPath);
check(
  typeof extension.activate === 'function' &&
  typeof extension.deactivate === 'function' &&
  typeof extension.parseDiagnostics === 'function',
  'CommonJS exports'
);
const sample = [
  'counter.opu:3:7: error: unknown state "nope"',
  '  help: declare it with state',
  'counter.opu:4:2: warning: unused state'
].join('\n');
const parsed = extension.parseDiagnostics(sample);
const parserOk = parsed.length === 2 &&
  parsed[0].file === 'counter.opu' &&
  parsed[0].line === 2 &&
  parsed[0].character === 6 &&
  parsed[0].severity === 'error' &&
  parsed[0].message === 'unknown state "nope"' &&
  parsed[1].severity === 'warning';
check(parserOk, 'diagnostic parser', '2 sample diagnostics');

const expectedCompiler = path.resolve(root, '..', 'opurom-lang', 'target', 'debug', 'opuromc');
const compileTool = extension.toolFor('compile', '/tmp/counter.opu', '/opt/opuromc', '');
const expectedOutput = '/tmp/counter.opuir.json';
const cliPath = '/repo/opurom-cli/bin/opurom.mjs';
const cliTool = extension.toolFor('check', '/tmp/counter.opu', '/opt/opuromc', cliPath);
const compilerCheck = extension.toolFor('check', '/tmp/counter.opu', '/opt/opuromc', '');
const routingOk = extension.defaultCompilerPath() === expectedCompiler &&
  compileTool.command === '/opt/opuromc' &&
  compileTool.args.join('|') === `compile|/tmp/counter.opu|-o|${expectedOutput}` &&
  compileTool.outputFile === expectedOutput &&
  cliTool.command === process.execPath &&
  cliTool.node === true &&
  cliTool.args.join('|') === `${cliPath}|check|/tmp/counter.opu` &&
  compilerCheck.args.join('|') === 'check|/tmp/counter.opu';
check(routingOk, 'compiler default and CLI routing');

const docPhrases = [
  '~/.vscode/extensions',
  'code --install-extension',
  'syntax highlighting',
  'compile/check diagnostics work',
  'LSP',
  'autocomplete',
  'debugger',
  'hot reload',
  'later rounds'
];
const docsOk = ['README.md', 'vscode-opurom/README.md'].every(relativePath => {
  const text = fs.readFileSync(path.join(root, relativePath), 'utf8');
  return docPhrases.every(phrase => text.includes(phrase));
});
check(docsOk, 'READMEs', 'install, features, honest status in both files');
const ignorePatterns = ['node_modules/', '.DS_Store', '*.vsix'];
const ignoreOk = ['.gitignore', 'vscode-opurom/.vscodeignore'].every(relativePath => {
  const text = fs.readFileSync(path.join(root, relativePath), 'utf8');
  return ignorePatterns.every(pattern => text.includes(pattern));
});
check(ignoreOk, 'ignore files', '2 files, 3 patterns each');

console.log('PASS opurom-ide-plugins validation');
