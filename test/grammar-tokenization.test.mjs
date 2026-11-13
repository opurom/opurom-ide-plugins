import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLiveTemplates, expandJetBrains, expandVsCode } from '../jetbrains/validate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const grammars = [
  ['VS Code', 'vscode-opurom/syntaxes/opurom.tmLanguage.json'],
  ['JetBrains metadata', 'jetbrains/opurom.tmLanguage.json'],
  ['JetBrains runtime', 'jetbrains-runtime/src/main/resources/textmate/opurom.tmLanguage.json']
];

// The action verbs mirror the IR action ops, so the snippet exercises them as
// words alongside the attribute names used by real .opu programs.
const snippet = [
  'app Demo {',
  '  state count = 0',
  '  Button("Add", fontScale: 2, animate: spring) {',
  '    set count = 0',
  '    add count += 1',
  '    sub count -= 1',
  '    toggle count.toggle()',
  '  }',
  '}'
].join('\n');

// Mirrors OpuromLexer's scope-to-token-type classification; that lexer has no
// operator type, so operator characters are PUNCTUATION.
const tokenTypes = new Map([
  ['keyword.control.opurom', 'KEYWORD'],
  ['keyword.control.verb.opurom', 'KEYWORD'],
  ['storage.modifier.opurom', 'KEYWORD'],
  ['constant.language.boolean.opurom', 'KEYWORD'],
  ['support.class.node.opurom', 'NODE_KIND'],
  ['support.constant.effect.opurom', 'NODE_KIND'],
  ['support.function.async-effect.opurom', 'NODE_KIND'],
  ['constant.numeric.opurom', 'NUMBER'],
  ['string.quoted.double.opurom', 'STRING'],
  ['comment.line.double-slash.opurom', 'COMMENT'],
  ['keyword.operator.opurom', 'PUNCTUATION'],
  ['punctuation.opurom', 'PUNCTUATION'],
  ['variable.parameter.prop.opurom', 'IDENTIFIER'],
  ['variable.parameter.attribute.opurom', 'IDENTIFIER'],
  ['variable.other.identifier.opurom', 'IDENTIFIER']
]);

// A minimal TextMate matcher: at each position the first rule in pattern
// order wins, and begin/end rules (strings) are consumed as one token.
function tokenize(grammar, source) {
  const rules = grammar.patterns.map(({ include }) => grammar.repository[include.slice(1)]);
  const tokens = [];
  for (const line of source.split('\n')) {
    let position = 0;
    while (position < line.length) {
      if (/\s/.test(line[position])) {
        position += 1;
        continue;
      }
      let match = null;
      for (const rule of rules) {
        if (typeof rule.match === 'string') {
          const regex = new RegExp(rule.match, 'y');
          regex.lastIndex = position;
          const found = regex.exec(line);
          if (found && found[0].length > 0) {
            match = { text: found[0], scope: rule.name, end: regex.lastIndex };
            break;
          }
        } else if (typeof rule.begin === 'string') {
          const begin = new RegExp(rule.begin, 'y');
          begin.lastIndex = position;
          if (begin.exec(line)) {
            const end = new RegExp(rule.end, 'g');
            end.lastIndex = begin.lastIndex;
            const closed = end.exec(line);
            const stop = closed ? end.lastIndex : line.length;
            match = { text: line.slice(position, stop), scope: rule.name, end: stop };
            break;
          }
        }
      }
      if (!match) {
        tokens.push({ text: line[position], scope: null });
        position += 1;
        continue;
      }
      tokens.push({ text: match.text, scope: match.scope });
      position = match.end;
    }
  }
  return tokens;
}

function load(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

const expected = [
  ['app', 'keyword.control.opurom', 'KEYWORD'],
  ['Demo', 'variable.other.identifier.opurom', 'IDENTIFIER'],
  ['{', 'punctuation.opurom', 'PUNCTUATION'],
  ['state', 'keyword.control.opurom', 'KEYWORD'],
  ['count', 'variable.other.identifier.opurom', 'IDENTIFIER'],
  ['=', 'keyword.operator.opurom', 'PUNCTUATION'],
  ['0', 'constant.numeric.opurom', 'NUMBER'],
  ['Button', 'support.class.node.opurom', 'NODE_KIND'],
  ['(', 'punctuation.opurom', 'PUNCTUATION'],
  ['"Add"', 'string.quoted.double.opurom', 'STRING'],
  [',', 'punctuation.opurom', 'PUNCTUATION'],
  ['fontScale', 'variable.parameter.attribute.opurom', 'IDENTIFIER'],
  [':', 'punctuation.opurom', 'PUNCTUATION'],
  ['2', 'constant.numeric.opurom', 'NUMBER'],
  [',', 'punctuation.opurom', 'PUNCTUATION'],
  ['animate', 'variable.parameter.attribute.opurom', 'IDENTIFIER'],
  [':', 'punctuation.opurom', 'PUNCTUATION'],
  ['spring', 'support.constant.effect.opurom', 'NODE_KIND'],
  [')', 'punctuation.opurom', 'PUNCTUATION'],
  ['{', 'punctuation.opurom', 'PUNCTUATION'],
  ['set', 'keyword.control.verb.opurom', 'KEYWORD'],
  ['count', 'variable.other.identifier.opurom', 'IDENTIFIER'],
  ['=', 'keyword.operator.opurom', 'PUNCTUATION'],
  ['0', 'constant.numeric.opurom', 'NUMBER'],
  ['add', 'keyword.control.verb.opurom', 'KEYWORD'],
  ['count', 'variable.other.identifier.opurom', 'IDENTIFIER'],
  ['+=', 'keyword.operator.opurom', 'PUNCTUATION'],
  ['1', 'constant.numeric.opurom', 'NUMBER'],
  ['sub', 'keyword.control.verb.opurom', 'KEYWORD'],
  ['count', 'variable.other.identifier.opurom', 'IDENTIFIER'],
  ['-=', 'keyword.operator.opurom', 'PUNCTUATION'],
  ['1', 'constant.numeric.opurom', 'NUMBER'],
  ['toggle', 'keyword.control.verb.opurom', 'KEYWORD'],
  ['count', 'variable.other.identifier.opurom', 'IDENTIFIER'],
  ['.toggle()', 'keyword.operator.opurom', 'PUNCTUATION'],
  ['}', 'punctuation.opurom', 'PUNCTUATION'],
  ['}', 'punctuation.opurom', 'PUNCTUATION']
];

const vscodeSnippets = load('vscode-opurom/snippets/opurom.json');
const liveTemplates = readLiveTemplates(root);
const snippetPrefixes = ['if', 'ifelse', 'theme'];
const snippetBodies = snippetPrefixes.map(prefix =>
  Object.values(vscodeSnippets).find(entry => entry.prefix === prefix)?.body
);
const canonicalSnippets = snippetBodies.map(body => expandVsCode(body));
const conditionalSource = canonicalSnippets.join('\n\n');
const expectedSnippetSource = [
  'if (state) {',
  '\tText("Visible")',
  '}',
  '',
  'if (state) {',
  '\tText("Visible")',
  '} else {',
  '\tText("Hidden")',
  '}',
  '',
  'theme { accent: "#097FEB", radius: 12 }'
].join('\n');

const t = (text, scope) => [text, scope, tokenTypes.get(scope) ?? null];
const snippetExpected = [
  t('if', 'keyword.control.opurom'),
  t('(', 'punctuation.opurom'),
  t('state', 'keyword.control.opurom'),
  t(')', 'punctuation.opurom'),
  t('{', 'punctuation.opurom'),
  t('Text', 'support.class.node.opurom'),
  t('(', 'punctuation.opurom'),
  t('"Visible"', 'string.quoted.double.opurom'),
  t(')', 'punctuation.opurom'),
  t('}', 'punctuation.opurom'),
  t('if', 'keyword.control.opurom'),
  t('(', 'punctuation.opurom'),
  t('state', 'keyword.control.opurom'),
  t(')', 'punctuation.opurom'),
  t('{', 'punctuation.opurom'),
  t('Text', 'support.class.node.opurom'),
  t('(', 'punctuation.opurom'),
  t('"Visible"', 'string.quoted.double.opurom'),
  t(')', 'punctuation.opurom'),
  t('}', 'punctuation.opurom'),
  t('else', 'variable.other.identifier.opurom'),
  t('{', 'punctuation.opurom'),
  t('Text', 'support.class.node.opurom'),
  t('(', 'punctuation.opurom'),
  t('"Hidden"', 'string.quoted.double.opurom'),
  t(')', 'punctuation.opurom'),
  t('}', 'punctuation.opurom'),
  t('theme', 'keyword.control.opurom'),
  t('{', 'punctuation.opurom'),
  t('accent', 'variable.parameter.prop.opurom'),
  t(':', 'punctuation.opurom'),
  t('"#097FEB"', 'string.quoted.double.opurom'),
  t(',', 'punctuation.opurom'),
  t('radius', 'variable.parameter.prop.opurom'),
  t(':', 'punctuation.opurom'),
  t('12', 'constant.numeric.opurom'),
  t('}', 'punctuation.opurom')
];

for (const [label, relativePath] of grammars) {
  test(`${label} grammar tokenizes action verbs and attribute names`, () => {
    const tokens = tokenize(load(relativePath), snippet);
    assert.deepEqual(
      tokens.map(({ text, scope }) => [text, scope, tokenTypes.get(scope) ?? null]),
      expected,
      `${label} grammar`
    );
  });
}

test('all three grammars agree on the representative snippet', () => {
  const streams = grammars.map(([, relativePath]) => tokenize(load(relativePath), snippet));
  for (const stream of streams.slice(1)) assert.deepEqual(stream, streams[0]);
});

test('JetBrains lexer maps the action verb scope to the KEYWORD token type', () => {
  const lexer = fs.readFileSync(
    path.join(root, 'jetbrains-runtime/src/main/java/opurom/jetbrains/OpuromLexer.java'),
    'utf8'
  );
  assert.match(lexer, /grammar\.matches\("keyword\.control\.verb\.opurom", word\)/);
});

test('VS Code and JetBrains conditional snippets expand to the same source', () => {
  assert.ok(snippetBodies.every(Boolean));
  assert.equal(conditionalSource, expectedSnippetSource);
  for (const [index, prefix] of snippetPrefixes.entries()) {
    const template = liveTemplates.get(prefix);
    assert.ok(template, `${prefix} live template exists`);
    assert.equal(expandJetBrains(template), canonicalSnippets[index], `${prefix} body`);
  }
});

test('conditional snippets include tab stops, both branches and the default theme', () => {
  const [ifBody, ifElseBody] = snippetBodies.map(body => body?.join('\n') ?? '');
  assert.match(ifBody, /if \(\$\{1:state\}\) \{/);
  assert.match(ifBody, /\$\{2:/);
  assert.match(ifElseBody, /\} else \{/);
  assert.match(ifElseBody, /\$\{3:/);
  assert.equal(canonicalSnippets[2], 'theme { accent: "#097FEB", radius: 12 }');
});

test('every VS Code snippet has a JetBrains live template with the same body', () => {
  const prefixes = ['if', 'ifelse', 'theme', 'opurom-app', 'opurom-column-text',
    'opurom-button-inc', 'opurom-input-bind', 'opurom-fullstack', 'opurom-theme'];
  for (const prefix of prefixes) {
    const entry = Object.values(vscodeSnippets).find(snippet => snippet.prefix === prefix);
    assert.ok(entry, `${prefix} VS Code snippet exists`);
    const template = liveTemplates.get(prefix);
    assert.ok(template, `${prefix} live template exists`);
    assert.equal(expandJetBrains(template), expandVsCode(entry.body), `${prefix} body`);
  }
});

test('snippet expansion resolves choice placeholders to their first option', () => {
  assert.equal(expandVsCode(['theme { mode: ${1|dark,light|} }']), 'theme { mode: dark }');
  assert.equal(expandVsCode(['theme { accent: "${1|#FF4D6D,#097FEB|}", radius: 12 }']),
    'theme { accent: "#FF4D6D", radius: 12 }');
  assert.equal(expandVsCode(['app ${1:Counter} {', '\tstate ${2:count} = ${3:0}', '}']),
    ['app Counter {', '\tstate count = 0', '}'].join('\n'));
});

for (const [label, relativePath] of grammars) {
  test(`${label} grammar tokenizes conditional and theme snippets`, () => {
    const tokens = tokenize(load(relativePath), conditionalSource);
    assert.deepEqual(
      tokens.map(({ text, scope }) => [text, scope, tokenTypes.get(scope) ?? null]),
      snippetExpected,
      `${label} grammar`
    );
  });
}

test('all three grammars agree on the conditional snippet stream', () => {
  const streams = grammars.map(([, relativePath]) => tokenize(load(relativePath), conditionalSource));
  for (const stream of streams.slice(1)) assert.deepEqual(stream, streams[0]);
});
