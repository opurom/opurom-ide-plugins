import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
