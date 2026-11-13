import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(modulePath), '..');
const CJK = /[\u3400-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;
const ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;
const ATTRS = /^(?:\s+[A-Za-z_][A-Za-z0-9_.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*\s*$/;
const START_NAME = /^([A-Za-z_][A-Za-z0-9_.:-]*)([\s\S]*)$/;
const CLOSE_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const DECLARATION = /^<\?xml\s+version="1\.0"\s+encoding="UTF-8"\s*\?>\s*/;

function defaultCheck(condition, label, detail = '') {
  if (!condition) throw new Error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  console.log(`PASS ${label}${detail ? ` (${detail})` : ''}`);
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  try {
    return JSON.parse(readText(filePath));
  } catch (error) {
    throw new Error(`FAIL ${path.basename(filePath)} JSON: ${error.message}`);
  }
}

function decodeXml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

function attributes(tag) {
  const result = {};
  for (const [, name, value] of tag.matchAll(/([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*"([^"]*)"/g)) {
    result[name] = decodeXml(value);
  }
  return result;
}

export function readLiveTemplates(rootDir = defaultRoot) {
  const xml = readText(path.join(rootDir, 'jetbrains', 'live-templates.xml'));
  const templates = new Map();
  for (const [, tag, body] of xml.matchAll(/<template\s+([^>]*?)>([\s\S]*?)<\/template>/g)) {
    const variables = {};
    for (const [, variableTag] of body.matchAll(/<variable\s+([^>]*?)\/>/g)) {
      const variable = attributes(variableTag);
      variables[variable.name] = variable.defaultValue ?? '';
    }
    const template = attributes(tag);
    templates.set(template.name, {
      ...template,
      variables,
      context: /<option\s+name="OPUROM"\s+value="true"\s*\/>/.test(body)
    });
  }
  return templates;
}

// Editor placeholder expansion is shared by validation and tokenization tests.
export function expandVsCode(body) {
  return (Array.isArray(body) ? body : [body])
    .join('\n')
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$0/g, '')
    .replace(/\n$/, '');
}

export function expandJetBrains(template) {
  return template.value
    .replace(/\$([A-Z_]+)\$/g, (_, name) => template.variables[name] ?? '')
    .replace(/\n$/, '');
}

function walkJson(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkJson(full));
    else if (entry.name.endsWith('.json')) files.push(full);
  }
  return files;
}

function tagEnd(xml, start) {
  let quote = '';
  for (let index = start + 1; index < xml.length; index += 1) {
    const ch = xml[index];
    if (quote) {
      if (ch === '<') throw new Error(`'<' inside quoted attribute near ${index}`);
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '<') throw new Error(`'<' inside tag near ${index}`);
    else if (ch === '>') return index;
  }
  throw new Error('unterminated tag');
}

// shortcut: DOCTYPE, custom entities and entity expansion are rejected, upgrade to a full XML parser when plugin.xml needs them.
function inspectXml(xml, expectedRoot = 'idea-plugin') {
  const declaration = DECLARATION.exec(xml);
  if (!declaration) throw new Error('missing XML declaration');
  let index = declaration[0].length;
  const stack = [];
  let root = '';
  let rootClosed = false;
  let elements = 0;

  while (index < xml.length) {
    if (xml.startsWith('<!--', index)) {
      const end = xml.indexOf('-->', index + 4);
      if (end < 0) throw new Error('unterminated comment');
      if (xml.slice(index + 4, end).includes('--')) throw new Error('invalid comment');
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', index)) {
      const end = xml.indexOf(']]>', index + 9);
      if (end < 0) throw new Error('unterminated CDATA');
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<?', index)) {
      const end = xml.indexOf('?>', index + 2);
      if (end < 0) throw new Error('unterminated processing instruction');
      index = end + 2;
      continue;
    }
    if (xml.startsWith('<!', index)) throw new Error('unsupported declaration');
    if (xml[index] !== '<') {
      const next = xml.indexOf('<', index);
      const text = xml.slice(index, next < 0 ? xml.length : next);
      if (stack.length === 0 && text.trim()) throw new Error('text outside root element');
      if (text.includes(']]>') || ENTITY.test(text)) throw new Error('invalid text entity or CDATA marker');
      index = next < 0 ? xml.length : next;
      continue;
    }
    const end = tagEnd(xml, index);
    let body = xml.slice(index + 1, end).trim();
    if (ENTITY.test(body)) throw new Error('unescaped ampersand in tag');
    index = end + 1;
    if (!body) throw new Error('empty tag');
    if (body.startsWith('/')) {
      const closing = body.slice(1).trim();
      if (!CLOSE_NAME.test(closing)) throw new Error('invalid closing tag');
      if (stack.length === 0) throw new Error(`unexpected </${closing}>`);
      const opening = stack.pop();
      if (opening !== closing) throw new Error(`mismatched <${opening}> and </${closing}>`);
      if (stack.length === 0) rootClosed = true;
      continue;
    }
    const selfClosing = body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1).trim();
    const start = START_NAME.exec(body);
    if (!start) throw new Error('invalid start tag');
    const name = start[1];
    if (!ATTRS.test(start[2])) throw new Error(`invalid attributes in <${name}>`);
    if (stack.length === 0) {
      if (root) throw new Error('multiple root elements');
      root = name;
      if (selfClosing) rootClosed = true;
    }
    if (!selfClosing) stack.push(name);
    elements += 1;
  }
  if (stack.length) throw new Error(`unclosed tags: ${stack.join(', ')}`);
  if (!root || root !== expectedRoot) throw new Error(`unexpected root element ${root || '(none)'}`);
  if (!rootClosed) throw new Error('root element not closed');
  return { root, elements };
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
      const pattern = compileRegex(node[key], `JetBrains grammar ${key}`);
      regexes.push(pattern);
      if (typeof node.name === 'string') scoped.push({ scope: node.name, pattern });
    }
  }
  for (const value of Object.values(node)) collect(value, scopes, regexes, includes, scoped);
}

export function validateJetbrains(check = defaultCheck, rootDir = defaultRoot) {
  const jetbrains = path.join(rootDir, 'jetbrains');
  const jsonFiles = walkJson(jetbrains);
  const parsed = new Map(jsonFiles.map(file => [path.basename(file), readJson(file)]));
  const grammar = parsed.get('opurom.tmLanguage.json');
  const lsp = parsed.get('lsp-client.json');
  check(jsonFiles.length >= 2 && Boolean(grammar && lsp),
    'JetBrains JSON files parsed', `${jsonFiles.length} files`);

  const pluginXml = readText(path.join(jetbrains, 'plugin.xml'));
  let xmlInfo = null;
  let xmlError = '';
  try {
    xmlInfo = inspectXml(pluginXml);
  } catch (error) {
    xmlError = error.message;
  }
  check(Boolean(xmlInfo), 'JetBrains plugin.xml well-formed',
    xmlError || `${xmlInfo.elements} elements, declaration, balanced tags, one root`);

  const liveTemplatesXml = readText(path.join(jetbrains, 'live-templates.xml'));
  let liveTemplatesInfo = null;
  let liveTemplatesXmlError = '';
  try {
    liveTemplatesInfo = inspectXml(liveTemplatesXml, 'templateSet');
  } catch (error) {
    liveTemplatesXmlError = error.message;
  }
  check(Boolean(liveTemplatesInfo), 'JetBrains live-template XML well-formed',
    liveTemplatesXmlError || `${liveTemplatesInfo.elements} elements, one templateSet root`);

  const validXmlSample = `<?xml version="1.0" encoding="UTF-8"?>
<!-- metadata -->
<idea-plugin>
  <id><![CDATA[x]]></id>
  <empty value="a &amp; b" />
</idea-plugin>`;
  let sampleOk = false;
  try {
    sampleOk = inspectXml(validXmlSample).root === 'idea-plugin';
  } catch {
    sampleOk = false;
  }
  check(sampleOk, 'JetBrains XML checker accepts valid sample', 'declaration, comment, CDATA, self-closing tag');

  const invalidXmlSamples = [
    '<idea-plugin/>',
    '<?xml version="1.0" encoding="UTF-8"?><idea-plugin><id>x</idea-plugin>',
    '<?xml version="1.0" encoding="UTF-8"?><idea-plugin/><extra/>',
    '<?xml version="1.0" encoding="UTF-8"?><idea-plugin><id value=x /></idea-plugin>',
    '<?xml version="1.0" encoding="UTF-8"?><wrong/>',
    '<?xml version="1.0" encoding="UTF-8"?><idea-plugin>'
  ];
  const xmlRejectionsOk = invalidXmlSamples.every(sample => {
    try {
      inspectXml(sample);
      return false;
    } catch {
      return true;
    }
  });
  check(xmlRejectionsOk, 'JetBrains XML checker rejects malformed samples', `${invalidXmlSamples.length} cases`);

  const pluginMetadataOk = Boolean(
    /<id>[\w.-]+<\/id>/.test(pluginXml) &&
    /<name>[^<]+<\/name>/.test(pluginXml) &&
    /<vendor\b[^>]*>[^<]+<\/vendor>/.test(pluginXml) &&
    (pluginXml.match(/<depends>/g) || []).length >= 2 &&
    /<extensions\s+defaultExtensionNs="com\.intellij">/.test(pluginXml) &&
    /<fileType\b/.test(pluginXml) &&
    /<lang\.parserDefinition\b/.test(pluginXml)
  );
  check(pluginMetadataOk, 'JetBrains plugin metadata', 'id, name, vendor, depends, language/file type extensions');
  check(pluginXml.includes('<defaultLiveTemplates file="live-templates.xml" />'),
    'JetBrains live-template registration', 'defaultLiveTemplates points at live-templates.xml');

  const pluginScopePhrases = [
    'configuration metadata only',
    'metadata placeholders',
    'no compiled plugin',
    'no intellij runtime test',
    'no jetbrains marketplace publication',
    'no debugger integration'
  ];
  const pluginXmlLower = pluginXml.toLowerCase();
  check(pluginScopePhrases.every(phrase => pluginXmlLower.includes(phrase)),
    'JetBrains plugin.xml scope', 'metadata-only, no runtime, compile, marketplace or debugger');

  const scopes = new Set();
  const regexes = [];
  const includes = new Set();
  const scoped = [];
  collect(grammar, scopes, regexes, includes, scoped);
  check(grammar.scopeName === 'source.opurom' && regexes.length > 0,
    'JetBrains grammar regexes compiled', `${regexes.length} patterns`);
  const repository = grammar.repository || {};
  const unresolvedIncludes = [...includes].filter(
    include => !include.startsWith('#') || !(include.slice(1) in repository)
  );
  check(unresolvedIncludes.length === 0, 'JetBrains grammar includes resolved', `${includes.size} local references`);

  const requiredScopes = [
    'comment.line.double-slash.opurom',
    'keyword.control.opurom',
    'keyword.control.verb.opurom',
    'storage.modifier.opurom',
    'support.function.async-effect.opurom',
    'support.class.node.opurom',
    'string.quoted.double.opurom',
    'constant.character.escape.opurom',
    'meta.interpolation.opurom',
    'variable.other.interpolation.opurom',
    'constant.numeric.opurom',
    'constant.language.boolean.opurom',
    'variable.parameter.prop.opurom',
    'keyword.operator.opurom',
    'support.constant.effect.opurom',
    'variable.other.identifier.opurom',
    'punctuation.opurom'
  ];
  const missingScopes = requiredScopes.filter(scope => !scopes.has(scope));
  check(missingScopes.length === 0, 'JetBrains grammar scopes', `${requiredScopes.length} required scopes`);

  const tokenChecks = [
    ['line comment', '// note'],
    ['string', '"Hello"'],
    ['interpolation open', '{'],
    ['interpolation close', '}'],
    ['literal brace', '{{'],
    ['number', '-1'],
    ['boolean true', 'true'],
    ['boolean false', 'false'],
    ['prop name', 'padding:'],
    ['+= operator', '+='],
    ['-= operator', '-='],
    ['= operator', '='],
    ['toggle', '.toggle()'],
    ['punctuation', ':']
  ];
  const uncovered = tokenChecks.filter(([, token]) => !regexes.some(pattern => pattern.test(token)));
  check(uncovered.length === 0, 'JetBrains grammar token coverage', `${tokenChecks.length} tokens`);

  const specificPatterns = scoped
    .filter(entry => entry.scope !== 'variable.other.identifier.opurom')
    .map(entry => entry.pattern);
  const languageKeywords = [
    'app', 'state', 'model', 'api', 'theme', 'import', 'async', 'await', 'if', 'for',
    'list', 'get', 'create', 'update', 'delete', 'primary', 'delay', 'fetch',
    'spring', 'ease', 'glass', 'gradient', 'shadow', 'opacity', 'animate',
    'true', 'false'
  ];
  const missedKeywords = languageKeywords.filter(word =>
    !specificPatterns.some(pattern => pattern.test(word))
  );
  check(missedKeywords.length === 0, 'JetBrains keyword coverage', `${languageKeywords.length} keywords`);

  const legacyKinds = [
    'Column', 'Row', 'Container', 'Text', 'Button', 'Input', 'Image', 'Spacer',
    'Card', 'Divider', 'Icon', 'Badge', 'Progress', 'Switch', 'Slider', 'Checkbox',
    'Radio', 'Dialog', 'Tabs', 'List', 'Grid', 'Scroll', 'Avatar', 'Spinner'
  ];
  const extraKinds = ['Table', 'Chart', 'Calendar', 'RichText', 'Player', 'Map', 'Menu', 'Tooltip'];
  const allKinds = [...legacyKinds, ...extraKinds];
  const nodePatterns = scoped
    .filter(entry => entry.scope?.startsWith('support.class.node'))
    .map(entry => entry.pattern);
  const missedKinds = allKinds.filter(word => !nodePatterns.some(pattern => pattern.test(word)));
  check(allKinds.length === 32 && missedKinds.length === 0,
    'JetBrains 32 primitive kinds highlighted', `${allKinds.length} kinds`);

  const stringRule = grammar.repository?.strings;
  const stringPatterns = Array.isArray(stringRule?.patterns) ? stringRule.patterns : [];
  const interpolation = stringPatterns.find(pattern => pattern.name === 'meta.interpolation.opurom');
  const interpolationOk = Boolean(
    interpolation &&
    typeof interpolation.begin === 'string' &&
    typeof interpolation.end === 'string' &&
    compileRegex(interpolation.begin, 'JetBrains interpolation begin').test('{') &&
    compileRegex(interpolation.end, 'JetBrains interpolation end').test('}') &&
    Array.isArray(interpolation.patterns) &&
    interpolation.patterns.some(pattern => pattern.name === 'variable.other.interpolation.opurom')
  );
  const literalBraceOk = stringPatterns.some(pattern =>
    pattern.name === 'constant.character.escape.opurom' &&
    typeof pattern.match === 'string' &&
    compileRegex(pattern.match, 'JetBrains literal brace').test('{{')
  );
  check(interpolationOk && literalBraceOk && stringRule?.begin === '"' && stringRule?.end === '"',
    'JetBrains string interpolation rule', '{name} and {{ escape');

  const lspOk = Boolean(
    lsp.kind === 'opurom.jetbrains.lsp-client-configuration-metadata' &&
    lsp.metadataOnly === true &&
    lsp.runningIntelliJClient === false &&
    /configuration metadata only/i.test(lsp.description || '') &&
    /not a running intellij client/i.test(lsp.description || '') &&
    lsp.languageId === 'opurom' &&
    Array.isArray(lsp.fileExtensions) &&
    lsp.fileExtensions.includes('.opu') &&
    lsp.command === 'node' &&
    Array.isArray(lsp.args) &&
    lsp.args[0] === '../../opurom-lsp/bin/server.mjs' &&
    lsp.args.includes('--stdio') &&
    lsp.siblingRepository === '../opurom-lsp' &&
    lsp.transport === 'stdio'
  );
  check(lspOk, 'JetBrains LSP config metadata', 'command, args, language id, extensions, sibling server');

  const liveTemplates = readLiveTemplates(rootDir);
  const templateNames = ['if', 'ifelse', 'theme'];
  const templates = templateNames.map(name => liveTemplates.get(name));
  const liveTemplatesOk = liveTemplates.size === templateNames.length &&
    templates.every(template => template?.value && template.description && template.context) &&
    templates.every(template => !/\$[A-Z_]+\$/.test(expandJetBrains(template))) &&
    templates[0]?.variables.STATE === 'state' &&
    templates[0]?.variables.THEN === 'Text("Visible")' &&
    templates[1]?.variables.ELSE === 'Text("Hidden")' &&
    expandJetBrains(templates[2]) === 'theme { accent: "#097FEB", radius: 12 }';
  check(liveTemplatesOk, 'JetBrains live templates', `${liveTemplates.size} conditional and theme templates`);

  const fileExtensionOk = Boolean(
    Array.isArray(grammar.fileTypes) && grammar.fileTypes.includes('opu') &&
    Array.isArray(lsp.fileExtensions) && lsp.fileExtensions.includes('.opu') &&
    /<fileType\b[^>]*\bextensions="opu"/.test(pluginXml) &&
    /<fileType\b[^>]*\blanguage="OPUROM"/.test(pluginXml) &&
    /<lang\.parserDefinition\b[^>]*\blanguage="OPUROM"/.test(pluginXml)
  );
  check(fileExtensionOk, 'JetBrains file extension declarations', 'grammar, plugin.xml, LSP config');

  const rootReadme = readText(path.join(rootDir, 'README.md'));
  const readme = readText(path.join(jetbrains, 'README.md'));
  const scopePhrases = [
    'metadata only',
    'no debugger integration',
    'not a running intellij client',
    'jetbrains-runtime'
  ];
  const forbiddenPhrases = [
    'intellij runtime tested',
    'compiled plugin ships',
    'published to the jetbrains marketplace',
    'debugger integration ships'
  ];
  const scopeOk = [rootReadme, readme].every(text => {
    const lower = text.toLowerCase();
    return scopePhrases.every(phrase => lower.includes(phrase)) &&
      forbiddenPhrases.every(phrase => !lower.includes(phrase));
  });
  check(scopeOk, 'JetBrains README scope', '2 files, 6 disclosures, no overclaims');

  const sourceFiles = [
    path.join(jetbrains, 'opurom.tmLanguage.json'),
    path.join(jetbrains, 'lsp-client.json'),
    path.join(jetbrains, 'live-templates.xml'),
    path.join(jetbrains, 'plugin.xml'),
    path.join(jetbrains, 'validate.mjs'),
    path.join(jetbrains, 'README.md'),
    path.join(rootDir, 'README.md'),
    path.join(rootDir, 'scripts', 'validate.mjs')
  ];
  const englishOk = sourceFiles.every(file => !CJK.test(readText(file)));
  check(englishOk, 'JetBrains files are English-only', `${sourceFiles.length} files, no CJK text`);

  check(true, 'JetBrains metadata validation');
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  validateJetbrains(defaultCheck);
}
