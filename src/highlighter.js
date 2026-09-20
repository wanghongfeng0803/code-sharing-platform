'use strict';

const path = require('path');
const { Parser, Language } = require('web-tree-sitter');
const config = require('./config');

// 支持的语言：规范名 -> WASM 语法文件及别名
const LANGUAGES = {
  javascript: { wasm: 'tree-sitter-javascript.wasm', aliases: ['js', 'node', 'ecmascript', 'mjs', 'cjs'] },
  typescript: { wasm: 'tree-sitter-typescript.wasm', aliases: ['ts', 'mts', 'cts'] },
  python: { wasm: 'tree-sitter-python.wasm', aliases: ['py', 'python3', 'py3'] },
  go: { wasm: 'tree-sitter-go.wasm', aliases: ['golang'] },
  rust: { wasm: 'tree-sitter-rust.wasm', aliases: ['rs'] },
  java: { wasm: 'tree-sitter-java.wasm' },
  c: { wasm: 'tree-sitter-cpp.wasm', aliases: ['h', 'cpp', 'c++', 'cc', 'hpp', 'cxx', 'hxx'] },
  bash: { wasm: 'tree-sitter-bash.wasm', aliases: ['sh', 'shell', 'zsh', 'ksh'] },
  json: { wasm: 'tree-sitter-json.wasm' },
  html: { wasm: 'tree-sitter-html.wasm', aliases: ['htm', 'xml'] },
  css: { wasm: 'tree-sitter-css.wasm' },
  ruby: { wasm: 'tree-sitter-ruby.wasm', aliases: ['rb'] }
};

const ALIAS_TO_LANG = new Map();
for (const [name, meta] of Object.entries(LANGUAGES)) {
  ALIAS_TO_LANG.set(name, name);
  for (const alias of meta.aliases || []) ALIAS_TO_LANG.set(alias.toLowerCase(), name);
}

const languages = new Map();
const parsers = new Map();
let initialized = false;

async function init() {
  if (initialized) return;
  await Parser.init();
  initialized = true;
}

async function getParser(language) {
  const langName = ALIAS_TO_LANG.get(String(language || '').toLowerCase());
  if (!langName) return null;
  if (parsers.has(langName)) return { name: langName, parser: parsers.get(langName) };
  let lang = languages.get(langName);
  if (!lang) {
    const wasmPath = path.join(config.WASM_DIR, LANGUAGES[langName].wasm);
    lang = await Language.load(wasmPath);
    languages.set(langName, lang);
  }
  const parser = new Parser();
  parser.setLanguage(lang);
  parsers.set(langName, parser);
  return { name: langName, parser };
}

// 各语言关键字（用于把 identifier/anonymous 形态的关键字节点准确归类）
const KEYWORDS = {
  javascript: new Set(['var','let','const','function','return','if','else','for','while','do','switch','case','default','break','continue','new','delete','typeof','instanceof','in','of','void','this','super','class','extends','static','get','set','try','catch','finally','throw','yield','async','await','import','export','from','as']),
  typescript: new Set(['var','let','const','function','return','if','else','for','while','do','switch','case','default','break','continue','new','delete','typeof','instanceof','in','of','void','this','super','class','extends','implements','interface','enum','type','namespace','declare','abstract','readonly','public','private','protected','static','get','set','try','catch','finally','throw','yield','async','await','import','export','from','as','keyof','infer','satisfies']),
  python: new Set(['def','class','return','if','elif','else','for','while','break','continue','pass','raise','try','except','finally','with','as','import','from','global','nonlocal','lambda','yield','assert','del','in','is','not','and','or','async','await','print','self','True','False','None']),
  go: new Set(['func','var','const','type','struct','interface','map','chan','package','import','return','if','else','for','range','switch','case','default','break','continue','go','defer','select','fallthrough','goto','nil','true','false']),
  rust: new Set(['fn','let','mut','const','static','struct','enum','trait','impl','type','use','mod','pub','crate','self','Self','super','where','ref','move','return','if','else','for','while','loop','match','break','continue','in','as','dyn','unsafe','async','await','true','false']),
  java: new Set(['public','private','protected','static','final','abstract','class','interface','enum','extends','implements','package','import','return','if','else','for','while','do','switch','case','default','break','continue','new','this','super','try','catch','finally','throw','throws','instanceof','synchronized','volatile','transient','native','strictfp','void','true','false','null']),
  c: new Set(['if','else','for','while','do','switch','case','default','break','continue','return','goto','typedef','struct','enum','union','const','static','extern','inline','volatile','register','signed','unsigned','sizeof','void','char','short','int','long','float','double','bool','true','false','NULL']),
  bash: new Set(['if','then','else','elif','fi','for','while','until','do','done','case','esac','function','in','select','time','coproc']),
  json: new Set(['true','false','null']),
  html: new Set(),
  css: new Set(['important']),
  ruby: new Set(['def','end','class','module','return','if','elsif','else','unless','while','until','for','do','begin','rescue','ensure','raise','yield','require','require_relative','include','extend','attr_accessor','attr_reader','attr_writer','nil','true','false','self','super','then','when','case','break','next','redo','retry','and','or','not','lambda','proc'])
};

// 字面量叶子节点类型
const LITERAL_TYPES = new Set([
  'number', 'integer', 'float', 'integer_literal', 'float_literal', 'int_literal',
  'decimal_integer_literal', 'decimal_floating_point_literal', 'number_literal',
  'true', 'false', 'null', 'nil', 'none', 'boolean', 'boolean_literal', 'null_literal',
  'character', 'char_literal'
]);

// 作为整体着色的字符串节点（其子节点引号/插值由专门逻辑处理）
const STRING_CONTAINER_TYPES = new Set([
  'string', 'string_literal', 'interpreted_string_literal',
  'template_string', 'raw_string_literal', 'heredoc_content'
]);
const STRING_PART_TYPES = new Set([
  'string_content', 'string_fragment', 'heredoc_body', 'heredoc_begin',
  'heredoc_end', 'system_lib_string', 'regex', 'regex_literal',
  'quoted_attribute_value'
]);
// 字符串内部仍然单独高亮的节点（如模板插值 ${...}）
const STRING_INJECTION_TYPES = new Set(['template_substitution', 'interpolation', 'escape_sequence']);
// 纯标点型叶子：引号 / HTML 标签括号 / 模板字符串反引号
const QUOTE_CHARS = new Set(['"', "'", '`']);

const COMMENT_TYPES = new Set(['comment', 'line_comment', 'block_comment']);

// 标识符/类型相关叶子节点
const IDENT_TYPES = new Set([
  'identifier', 'variable_name', 'word', 'command_name', 'package_identifier',
  'field_identifier', 'property_identifier', 'tag_name', 'attribute_name',
  'class_name', 'property_name', 'plain_value'
]);
const TYPE_LEAF_TYPES = new Set([
  'type_identifier', 'predefined_type', 'primitive_type', 'integral_type',
  'floating_point_type', 'void_type', 'boolean_type', 'generic_type',
  'scoped_identifier', 'scoped_type_identifier', 'type_qualifier',
  'storage_type_modifier', 'dotted_name'
]);

const CALL_PARENTS = new Set([
  'call_expression', 'call', 'method_invocation', 'macro_invocation',
  'command', 'pipeline'
]);
const DECL_PARENTS = new Set([
  'function_declaration', 'function_definition', 'function_item',
  'method_declaration', 'method_definition', 'method_spec', 'function'
]);
const PROPERTY_PARENTS = new Set([
  'field_access', 'attribute', 'field_initializer', 'shorthand_field_initializer'
]);

function classify(node, language, ctx) {
  const type = node.type;
  const parentType = node.parent ? node.parent.type : null;
  const field = ctx.field;
  const kw = KEYWORDS[language];

  if (COMMENT_TYPES.has(type)) return 'comment';
  if (LITERAL_TYPES.has(type)) return 'literal';

  // C 预处理指令
  if (type === 'preproc_include' || type === 'preproc_def' ||
      type === 'preproc_function_def' || type === 'preproc_arg') return 'meta';
  if (language === 'c' && /^#(include|define|ifdef|ifndef|endif|pragma)/.test(node.text)) return 'meta';

  // HTML 特化
  if (language === 'html') {
    if (type === 'tag_name') return 'tag';
    if (type === 'attribute_name') return 'attr';
    if (type === 'attribute_value') return 'string';
    return null;
  }
  // CSS 特化
  if (language === 'css') {
    if (type === 'class_name' || type === 'id_name' || type === 'namespace_name' ||
        type === 'tag_name' || type === 'pseudo_class_selector' ||
        type === 'pseudo_element_selector' || type === 'attribute_name') return 'selector';
    if (type === 'property_name') return 'property';
    if (type === 'plain_value' || type === 'color_value' ||
        type === 'string_value') return 'literal';
    return null;
  }

  // 具名叶子关键字（if/for/return 等匿名关键字节点）
  if (node.childCount === 0 && /^[A-Za-z_]+$/.test(type)) {
    if (kw && kw.has(type)) return 'keyword';
  }

  if (IDENT_TYPES.has(type)) {
    if (kw && kw.has(node.text)) return 'keyword';
    if (type === 'command_name') return 'function';
    if (type === 'field_identifier' || type === 'property_identifier') return 'property';
    // 调用表达式中的函数名（如 foo() / obj.m()）
    if (CALL_PARENTS.has(parentType) && (field === 'function' || field === 'name')) return 'function';
    if (type === 'command_name') return 'function';
    // 函数/方法声明的名字
    if (field === 'name' && ctx.ancestors.some((a) => DECL_PARENTS.has(a))) return 'function';
    if (field === 'declarator') {
      const declIdx = ctx.ancestors.findLastIndex((a) => /(function|method)/.test(a));
      if (declIdx !== -1) {
        // 只在声明链的“名字”位置着色：identifier 且其父就是函数声明者
        if (/function_declarator|function_declaration|method_declaration/.test(parentType)) return 'function';
      }
    }
    if (DECL_PARENTS.has(parentType) && field === 'name') return 'function';
    if (PROPERTY_PARENTS.has(parentType)) return 'property';
    return null;
  }

  if (TYPE_LEAF_TYPES.has(type)) {
    if (kw && kw.has(node.text)) return 'keyword';
    return 'type';
  }

  return null;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 显式帧栈：{ node, idx, mode }
// mode: 'normal' 正常遍历；'string' 处于字符串容器内（插值除外）
function render(rootNode, code, language) {
  const out = [];
  let pos = 0;

  const emitRaw = (end) => {
    if (end > pos) {
      out.push(escapeHtml(code.slice(pos, end)));
      pos = end;
    }
  };

  const stack = [{ node: rootNode, idx: -1, mode: 'normal' }];
  const MAX_DEPTH = 400;

  while (stack.length) {
    const frame = stack[stack.length - 1];
    frame.idx++;
    const { node } = frame;

    if (frame.idx >= node.childCount) {
      if (node.endIndex > pos) emitRaw(Math.min(node.endIndex, code.length));
      stack.pop();
      continue;
    }

    const child = node.child(frame.idx);
    if (child.startIndex > pos) emitRaw(child.startIndex);

    const childField = node.fieldNameForChild ? node.fieldNameForChild(frame.idx) : null;

    if (child.childCount === 0) {
      let scope;
      if (frame.mode === 'string') {
        scope = STRING_INJECTION_TYPES.has(child.type)
          ? classify(child, language, { field: childField, ancestors: ancestorTypes(stack) })
          : 'string';
      } else {
        scope = classify(child, language, { field: childField, ancestors: ancestorTypes(stack) });
      }
      out.push(scope ? `<span class="ts-${scope}">${escapeHtml(child.text)}</span>` : escapeHtml(child.text));
      pos = child.endIndex;
      continue;
    }

    let nextMode = frame.mode;
    if (frame.mode === 'normal') {
      if (STRING_CONTAINER_TYPES.has(child.type)) {
        if (hasInjection(child)) {
          nextMode = 'string';
        } else {
          out.push(`<span class="ts-string">${escapeHtml(code.slice(child.startIndex, child.endIndex))}</span>`);
          pos = child.endIndex;
          continue;
        }
      } else if (STRING_PART_TYPES.has(child.type)) {
        out.push(`<span class="ts-string">${escapeHtml(code.slice(child.startIndex, child.endIndex))}</span>`);
        pos = child.endIndex;
        continue;
      }
    } else if (frame.mode === 'string' && STRING_INJECTION_TYPES.has(child.type)) {
      nextMode = 'normal';
    }

    if (stack.length >= MAX_DEPTH) {
      emitRaw(Math.min(child.endIndex, code.length));
      continue;
    }
    stack.push({ node: child, idx: -1, mode: nextMode });
  }

  if (pos < code.length) out.push(escapeHtml(code.slice(pos)));
  return out.join('');
}

function ancestorTypes(stack) {
  const types = [];
  for (let i = 1; i < stack.length; i++) types.push(stack[i].node.type);
  return types;
}

function hasInjection(node) {
  for (let i = 0; i < node.childCount; i++) {
    if (STRING_INJECTION_TYPES.has(node.child(i).type)) return true;
  }
  return false;
}

function renderPlain(code) {
  return escapeHtml(code);
}

async function highlight(code, language) {
  await init();
  const parsed = await getParser(language);
  if (!parsed) return { language: null, html: renderPlain(code) };
  let tree;
  try {
    tree = parsed.parser.parse(code);
  } catch (_) {
    return { language: parsed.name, html: renderPlain(code) };
  }
  const hasError = tree.rootNode.hasError;
  const html = render(tree.rootNode, code, parsed.name);
  tree.delete();
  return { language: parsed.name, html, hasError };
}

function supportedLanguages() {
  return Object.keys(LANGUAGES);
}

function resolveLanguage(name) {
  return ALIAS_TO_LANG.get(String(name || '').toLowerCase()) || null;
}

module.exports = { highlight, supportedLanguages, resolveLanguage, init };
