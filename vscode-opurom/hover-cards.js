'use strict';

const catalog = require('./components.json');

// Vendored catalog keeps the zero-dependency extension standalone.
const entries = new Map(catalog.components.map(
  ([name, primitive, category, defaultProps]) => [
    name,
    { name, primitive, category, defaultProps }
  ]
));
const componentNames = Object.freeze(catalog.components.map(([name]) => name));

function propType(value) {
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) return 'list';
  return 'value';
}

function signature({ name, primitive, defaultProps }) {
  const params = Object.entries(defaultProps)
    .map(([prop, value]) => `${prop}: ${propType(value)}`)
    .join(', ');
  return `component ${name}(${params}) -> ${primitive}`;
}

function usage({ name, defaultProps }) {
  const [prop, value] = Object.entries(defaultProps)[0] || [];
  const argument = prop ? `${prop}: ${JSON.stringify(value)}` : '';
  return `app Preview {\n  ${name}(${argument})\n}`;
}

function generateHoverCard(name) {
  if (typeof name !== 'string') return null;
  const entry = entries.get(name);
  if (!entry) return null;
  const defaults = JSON.stringify(entry.defaultProps, null, 2);
  return [
    `## ${entry.name}`,
    '',
    `\`${signature(entry)}\``,
    '',
    `A ${entry.category} component that lowers to the ${entry.primitive} primitive. Defaults are merged unless a call site provides the same prop.`,
    '',
    '**Default props**',
    '',
    '```json',
    defaults,
    '```',
    '',
    '**Usage**',
    '',
    '```opu',
    usage(entry),
    '```'
  ].join('\n');
}

function createHoverProvider(vscode) {
  return {
    provideHover(document, position) {
      const range = document.getWordRangeAtPosition(position, /[A-Z][A-Za-z0-9_]*/);
      if (!range) return null;
      const card = generateHoverCard(document.getText(range));
      if (!card) return null;
      return new vscode.Hover(new vscode.MarkdownString(card), range);
    }
  };
}

module.exports = {
  catalog,
  componentNames,
  generateHoverCard,
  createHoverProvider
};
