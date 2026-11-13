import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { validateJetbrains } from '../jetbrains/validate.mjs';
import { validateRuntime } from '../jetbrains-runtime/validate.mjs';

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
    if (['.git', 'node_modules', '.gradle', '.gradle-home', 'build'].includes(entry.name)) continue;
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

function collect(node, scopes, regexes, includes, scoped) {
  if (Array.isArray(node)) {
    for (const value of node) collect(value, scopes, regexes, includes, scoped);
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
    if (typeof node[key] === 'string') {
      const pattern = compileRegex(node[key], `grammar ${key}`);
      regexes.push(pattern);
      if (typeof node.name === 'string') scoped.push({ scope: node.name, pattern });
    }
  }
  for (const value of Object.values(node)) collect(value, scopes, regexes, includes, scoped);
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
const scoped = [];
collect(grammar, scopes, regexes, includes, scoped);
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

// Language keywords and node kinds must be highlighted as something more
// specific than a plain identifier.
const languageKeywords = [
  'model', 'api', 'theme', 'if', 'for',
  'list', 'get', 'create', 'update', 'delete', 'primary',
  'spring', 'ease', 'glass', 'gradient', 'shadow', 'opacity', 'animate'
];
const extraNodeKinds = [
  'Card', 'Divider', 'Icon', 'Badge', 'Progress', 'Switch', 'Slider', 'Checkbox',
  'Radio', 'Dialog', 'Tabs', 'List', 'Grid', 'Scroll', 'Avatar', 'Spinner'
];
const specificPatterns = scoped
  .filter(entry => entry.scope !== 'variable.other.identifier.opurom')
  .map(entry => entry.pattern);
const nodePatterns = scoped
  .filter(entry => entry.scope.startsWith('support.class.node'))
  .map(entry => entry.pattern);
const unmatchedKeywords = languageKeywords.filter(word =>
  !specificPatterns.some(pattern => pattern.test(word))
);
check(unmatchedKeywords.length === 0, 'keyword coverage', `${languageKeywords.length} keywords`);
const unmatchedKinds = extraNodeKinds.filter(word =>
  !nodePatterns.some(pattern => pattern.test(word))
);
check(unmatchedKinds.length === 0, 'node kind coverage', `${extraNodeKinds.length} kinds`);
const allKinds = [
  'Column', 'Row', 'Container', 'Text', 'Button', 'Input', 'Image', 'Spacer', ...extraNodeKinds
];
const kindMisses = allKinds.filter(word => !nodePatterns.some(pattern => pattern.test(word)));
check(kindMisses.length === 0, 'all 24 node kinds highlighted', `${allKinds.length} kinds`);

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
const snippetOk = snippetEntries.length >= 5 &&
  snippetEntries.every(entry => entry.prefix && Array.isArray(entry.body) && entry.description) &&
  ['opurom-app', 'Column', 'Text', 'Button', '+= 1', 'Input', 'bind:',
    'opurom-fullstack', 'model', 'api', 'primary'].every(token => snippetText.includes(token));
check(snippetOk, 'snippets', `${snippetEntries.length} snippets`);
const fullstackSnippet = snippetEntries.find(entry => entry.prefix === 'opurom-fullstack');
const scaffoldOk = Boolean(
  fullstackSnippet &&
  fullstackSnippet.body.some(line => line.includes('model ${2:Todo}')) &&
  fullstackSnippet.body.some(line => line.includes('api "${6:/todos}"')) &&
  fullstackSnippet.body.some(line => line.includes('list ${2:Todo}'))
);
check(scaffoldOk, 'full-stack snippet scaffold', 'model + api + handlers');

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
  events.includes('onDebug') &&
  events.includes('onDebugResolve:opurom') &&
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
  properties['opurom.lspPath']?.type === 'string' &&
  !pkg.dependencies &&
  !pkg.devDependencies &&
  !pkg.scripts?.build
);
check(manifestOk, 'package.json contributes fields', 'languages, grammars, snippets, commands, settings, debug activation');
const expectedDebug = path.resolve(root, '..', 'opurom-debug', 'bin', 'server.mjs');
const debuggerEntry = (contributes.debuggers || []).find(entry => entry.type === 'opurom');
const launchSchema = debuggerEntry?.configurationAttributes?.launch;
const launchProperties = launchSchema?.properties || {};
const debuggerOk = Boolean(
  debuggerEntry?.label &&
  debuggerEntry.runtime === 'node' &&
  debuggerEntry.program?.includes('../opurom-debug/bin/server.mjs') &&
  path.resolve(ext, debuggerEntry.program) === expectedDebug &&
  debuggerEntry.languages?.includes('opurom') &&
  !contributes.breakpoints &&
  launchSchema?.required?.includes('program') &&
  launchProperties.program?.type === 'string' &&
  launchProperties.steps?.type === 'array' &&
  launchProperties.steps?.items?.type === 'string' &&
  launchProperties.coreBinary?.type === 'string' &&
  debuggerEntry.initialConfigurations?.some(config =>
    config.type === 'opurom' &&
    config.request === 'launch' &&
    typeof config.program === 'string' &&
    Array.isArray(config.steps)
  )
);
check(debuggerOk, 'opurom debuggers contribution', 'node adapter, program, steps, launch sample');
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

// The zero-dependency LSP client lives next to extension.js.
const clientPath = path.join(ext, 'lsp-client.js');
const clientSrc = fs.readFileSync(clientPath, 'utf8');
const clientSyntax = spawnSync(process.execPath, ['--check', clientPath], { encoding: 'utf8' });
check(clientSyntax.status === 0, 'lsp-client.js syntax (node --check)', clientSyntax.stderr.trim() || 'no syntax errors');
const clientCode = [
  "require('node:child_process')",
  'spawn(',
  'Content-Length',
  'textDocument/publishDiagnostics',
  "'shutdown'",
  "'exit'",
  'JSON.stringify',
  'JSON.parse'
];
const clientOk = clientCode.every(marker => clientSrc.includes(marker)) &&
  !/require\(['"]vscode-languageserver/.test(clientSrc) &&
  !clientSrc.includes('require(\'vscode\')');
check(clientOk, 'lsp-client.js runtime contract', 'spawn, framing, publishDiagnostics, lifecycle');

const lspMarkers = [
  "require('./lsp-client')",
  'LspClient',
  'defaultLspServerPath',
  "'initialize'",
  "'textDocument/didOpen'",
  "'textDocument/didChange'",
  "'textDocument/didClose'",
  'onDiagnostics',
  'onDidChangeTextDocument',
  'languageServer.stop()'
];
const lspOk = lspMarkers.every(marker => extensionSrc.includes(marker));
check(lspOk, 'extension.js LSP wiring', 'spawn, didOpen/didChange, diagnostics, shutdown');

const expectedLsp = path.resolve(root, '..', 'opurom-lsp', 'bin', 'server.mjs');
const extension = require(extensionPath);
const debugMarkers = [
  'registerDebugAdapterDescriptorFactory',
  'DebugAdapterExecutable',
  "'--stdio'",
  'defaultDebugServerPath'
];
check(
  debugMarkers.every(marker => extensionSrc.includes(marker)),
  'extension.js debug adapter wiring',
  'descriptor factory, node executable, --stdio'
);
class FakeDebugAdapterExecutable {
  constructor(command, args) {
    this.command = command;
    this.args = args;
  }
}
const descriptor = typeof extension.debugAdapterDescriptor === 'function'
  ? extension.debugAdapterDescriptor({ DebugAdapterExecutable: FakeDebugAdapterExecutable })
  : null;
check(
  extension.defaultDebugServerPath() === expectedDebug &&
  descriptor?.command === 'node' &&
  descriptor.args.length === 2 &&
  descriptor.args[0] === expectedDebug &&
  descriptor.args[1] === '--stdio',
  'debug adapter descriptor',
  'node <server> --stdio'
);
check(
  typeof extension.defaultLspServerPath === 'function' &&
  extension.defaultLspServerPath() === expectedLsp,
  'LSP server default path',
  expectedLsp
);
check(
  typeof extension.activate === 'function' &&
  typeof extension.deactivate === 'function' &&
  typeof extension.parseDiagnostics === 'function' &&
  typeof extension.defaultDebugServerPath === 'function' &&
  typeof extension.debugAdapterDescriptor === 'function',
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

const readmePaths = ['README.md', 'vscode-opurom/README.md'];
const readmeText = new Map(readmePaths.map(relativePath =>
  [relativePath, fs.readFileSync(path.join(root, relativePath), 'utf8')]
));
const docPhrases = [
  '~/.vscode/extensions',
  'code --install-extension',
  'syntax highlighting',
  'compile/check diagnostics work',
  'LSP',
  'autocomplete',
  'debugger',
  'opurom.lspPath',
  'hover',
  'completion',
  'definition',
  'contributes.debuggers',
  'DAP subset'
];
const docsOk = readmePaths.every(relativePath => {
  const text = readmeText.get(relativePath).toLowerCase();
  return docPhrases.every(phrase => text.includes(phrase.toLowerCase())) &&
    text.includes('"type": "opurom"') &&
    text.includes('"program"') &&
    text.includes('"steps"') &&
    text.includes('tap 4');
});
check(docsOk, 'READMEs', 'install, features and debugger launch sample in both files');
const CJK = /[\u3400-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;
const englishOk = readmePaths.every(relativePath => !CJK.test(readmeText.get(relativePath)));
check(englishOk, 'READMEs are English-only', '2 files, no CJK text');
const scopeOk = readmePaths.every(relativePath => {
  const text = readmeText.get(relativePath).toLowerCase();
  return ['dap subset'].every(phrase => text.includes(phrase)) &&
    !text.includes('there is **no debugger**') &&
    !text.includes('debugger is included') &&
    !text.includes('jetbrains plugin ships');
});
check(scopeOk, 'English-only README scope', 'DAP subset wording in both files');
// The READMEs must not claim a GUI debugger or a JetBrains plugin exists.
const overclaimOk = readmePaths.every(relativePath => {
  const text = readmeText.get(relativePath).toLowerCase();
  return !text.includes('jetbrains plugin ships') && !text.includes('debugger is included');
});
check(overclaimOk, 'READMEs do not overclaim', 'no JetBrains plugin, no bundled GUI debug client');
const ignorePatterns = ['node_modules/', '.DS_Store', '*.vsix'];
const ignoreOk = ['.gitignore', 'vscode-opurom/.vscodeignore'].every(relativePath => {
  const text = fs.readFileSync(path.join(root, relativePath), 'utf8');
  return ignorePatterns.every(pattern => text.includes(pattern));
});
check(ignoreOk, 'ignore files', '2 files, 3 patterns each');

validateJetbrains(check, root);
validateRuntime(check, root);

console.log('PASS opurom-ide-plugins validation');
