'use strict';

const Parser = require('web-tree-sitter');
const fs = require('fs');
const { wasmPath, LANGUAGE_MAP } = require('./languages');

let parserPromise = null;
const languageCache = new Map();
let parserInstance = null;

function init() {
  if (!parserPromise) {
    parserPromise = Parser.init()
      .then(async () => {
        parserInstance = new Parser();
        return parserInstance;
      })
      .catch((err) => {
        parserPromise = null;
        throw err;
      });
  }
  return parserPromise;
}

let loadChain = Promise.resolve();

function loadLanguage(languageId) {
  if (languageCache.has(languageId)) return Promise.resolve(languageCache.get(languageId));
  const file = wasmPath(languageId);
  if (!file || !fs.existsSync(file)) return Promise.resolve(null);

  const task = loadChain.then(async () => {
    if (languageCache.has(languageId)) return languageCache.get(languageId);
    const lang = await Parser.Language.load(file);
    languageCache.set(languageId, lang);
    return lang;
  });
  loadChain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TYPE_RULES = [
  [/comment/, 'comment'],
  [/string|char_literal/, 'string'],
  [/regex/, 'regex'],
  [/(number|integer|float)/, 'number'],
  [/boolean|^true$|^false$|^none$|^null$|^nil$/i, 'constant'],
  [/preproc/, 'meta'],
  [/escape/, 'escape'],
  [/type_identifier|builtin_type|primitive_type|type_parameter|type_arguments/, 'type'],
  [/tag_name/, 'tag'],
  [/attribute_name/, 'attr'],
  [/property_identifier|field_identifier|shorthand_property_identifier/, 'property'],
];

const FUNCTION_NAME_PARENT_RE =
  /function_definition|function_declaration|function_item|function_signature_item|method_definition|method_declaration/;
const FUNCTION_LIKE_RE = /function|method|func_definition/;
const CALL_RE = /call|new_expression|invocation/;
const KEYWORDS = new Set([
  'let', 'const', 'var', 'function', 'class', 'def', 'func', 'fn', 'fun',
  'public', 'private', 'protected', 'static', 'return', 'if', 'else', 'elif',
  'for', 'while', 'switch', 'case', 'break', 'continue', 'new', 'import',
  'export', 'from', 'try', 'catch', 'finally', 'throw', 'throws', 'yield',
  'await', 'async', 'struct', 'enum', 'interface', 'impl', 'trait', 'mod',
  'package', 'namespace', 'using', 'include', 'require', 'do', 'end', 'then',
  'in', 'of', 'as', 'is', 'with', 'match', 'lambda', 'pass', 'raise', 'begin',
  'rescue', 'ensure', 'unless', 'until', 'loop', 'move', 'pub', 'ref',
  'unsafe', 'extern', 'crate', 'use', 'where', 'default', 'extends',
  'implements', 'abstract', 'final', 'sealed', 'synchronized', 'volatile',
  'transient', 'native', 'strictfp', 'assert', 'instanceof', 'void', 'this',
  'super', 'goto', 'typedef', 'sizeof', 'register', 'inline', 'constexpr',
  'template', 'typename', 'delete', 'typeof', 'echo', 'global', 'del', 'and',
  'or', 'not', 'xor', 'nil', 'true', 'false', 'null', 'None', 'True', 'False',
]);
const OPERATORS = new Set([
  '=', '==', '===', '!=', '!==', '<', '>', '<=', '>=', '+', '-', '*', '/', '%',
  '**', '++', '--', '+=', '-=', '*=', '/=', '%=', '&&', '||', '!', '&', '|',
  '^', '~', '<<', '>>', '=>', '->', '::', '..', '?', ':', ':=', '??', '?.',
]);
const PUNCTUATION = new Set([
  '(', ')', '{', '}', '[', ']', ';', ',', '.', '#', '@', '\\',
]);

function classifyLeaf(node, parent, grandparent) {
  const type = node.type;

  if (node.isMissing() || type === 'ERROR') return 'invalid';

  if (!node.isNamed()) {
    if (type.startsWith('"') || type.startsWith("'") || type.startsWith('`')) {
      return 'string';
    }
    if (OPERATORS.has(type)) return 'operator';
    if (PUNCTUATION.has(type)) return 'punct';
    if (/^\s+$/.test(type)) return null;
    if (KEYWORDS.has(type)) return 'keyword';
    return null;
  }

  for (const [regex, scope] of TYPE_RULES) {
    if (regex.test(type)) return scope;
  }

  if (type === 'identifier') {
    if (parent) {
      if (
        FUNCTION_NAME_PARENT_RE.test(parent.type) &&
        (parent.childForFieldName('name') === node ||
          parent.childForFieldName('function') === node ||
          parent.namedChild(0) === node)
      ) {
        return 'function';
      }
      if (FUNCTION_LIKE_RE.test(parent.type) && parent.namedChild(0) === node) {
        return 'function';
      }
      if (CALL_RE.test(parent.type)) return 'function';
      if (
        grandparent &&
        CALL_RE.test(grandparent.type) &&
        /member|method|function/.test(parent.type)
      ) {
        return 'function';
      }
    }
    return 'variable';
  }

  return null;
}

function collectLeaves(root) {
  const leaves = [];
  const walk = (node, parent, grandparent) => {
    if (node.childCount === 0) {
      leaves.push({ node, parent, grandparent });
      return;
    }
    for (let i = 0; i < node.childCount; i += 1) {
      walk(node.child(i), node, parent);
    }
  };
  walk(root, null, null);
  return leaves;
}

function renderPlain(code) {
  return `<pre class="code-highlight"><code>${escapeHtml(code)}</code></pre>`;
}

let parseChain = Promise.resolve();

function parseWith(grammar, code) {
  const task = parseChain.then(() => {
    parserInstance.setLanguage(grammar);
    return parserInstance.parse(code);
  });
  parseChain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function highlight(code, languageId) {
  const lang = LANGUAGE_MAP.get(languageId);
  if (!lang || !lang.wasm) return renderPlain(code);

  await init();
  const grammar = await loadLanguage(languageId);
  if (!grammar) return renderPlain(code);

  const tree = await parseWith(grammar, code);

  let html = '';
  let cursor = 0;
  for (const { node, parent, grandparent } of collectLeaves(tree.rootNode)) {
    const start = node.startIndex;
    const end = node.endIndex;
    if (start < cursor) continue;
    if (start > cursor) html += escapeHtml(code.slice(cursor, start));
    const scope = classifyLeaf(node, parent, grandparent);
    const text = escapeHtml(code.slice(start, end));
    html += scope ? `<span class="tok-${scope}">${text}</span>` : text;
    cursor = end;
  }
  if (cursor < code.length) html += escapeHtml(code.slice(cursor));

  return `<pre class="code-highlight"><code>${html}</code></pre>`;
}

module.exports = { init, highlight, escapeHtml };
