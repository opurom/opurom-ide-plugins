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

const designProps = Object.freeze({
  state: Object.freeze({
    values: Object.freeze(['default', 'hover', 'active', 'focus', 'disabled']),
    defaultValue: 'default'
  }),
  variant: Object.freeze({
    values: Object.freeze(['primary', 'secondary', 'text', 'danger', 'ghost', 'fab']),
    defaultValue: 'primary'
  }),
  tone: Object.freeze({
    values: Object.freeze(['success', 'warning', 'error', 'info', 'neutral']),
    defaultValue: 'neutral'
  })
});
const designPropOwners = new Map(
  Object.entries(designProps).flatMap(([name, { values }]) => [
    [name, name],
    ...values.map(value => [value, name])
  ])
);
const designPropUsage = [
  'app Preview {',
  '  Button("Save", state: hover, variant: primary, tone: info)',
  '}'
].join('\n');

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

function generatePropHoverCard(name) {
  if (typeof name !== 'string') return null;
  const owner = designPropOwners.get(name);
  if (!owner) return null;
  return [
    `## ${owner}`,
    '',
    '**Design-system props**',
    '',
    ...Object.entries(designProps).map(
      ([prop, { values, defaultValue }]) =>
        `\`${prop}: ${values.join('|')}\` - default \`${defaultValue}\`.`
    ),
    '',
    '**Errors**',
    '',
    'Unknown values are compile-time errors (for example, `state: pressed`).',
    '',
    '**Usage**',
    '',
    '```opu',
    designPropUsage,
    '```'
  ].join('\n');
}

function createHoverProvider(vscode) {
  return {
    provideHover(document, position) {
      const range = document.getWordRangeAtPosition(position, /[A-Za-z][A-Za-z0-9_]*/);
      if (!range) return null;
      const word = document.getText(range);
      const card = generateHoverCard(word) || generatePropHoverCard(word);
      if (!card) return null;
      return new vscode.Hover(new vscode.MarkdownString(card), range);
    }
  };
}

module.exports = {
  catalog,
  componentNames,
  designProps,
  generateHoverCard,
  generatePropHoverCard,
  createHoverProvider
};
