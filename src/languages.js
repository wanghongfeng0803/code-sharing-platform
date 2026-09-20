'use strict';

const path = require('path');
const config = require('./config');

const LANGUAGES = [
  { id: 'javascript', label: 'JavaScript', wasm: 'tree-sitter-javascript.wasm', extensions: ['js', 'mjs', 'cjs', 'jsx'] },
  { id: 'typescript', label: 'TypeScript', wasm: 'tree-sitter-typescript.wasm', extensions: ['ts'] },
  { id: 'tsx', label: 'TSX', wasm: 'tree-sitter-tsx.wasm', extensions: ['tsx'] },
  { id: 'python', label: 'Python', wasm: 'tree-sitter-python.wasm', extensions: ['py', 'pyi'] },
  { id: 'java', label: 'Java', wasm: 'tree-sitter-java.wasm', extensions: ['java'] },
  { id: 'c', label: 'C', wasm: 'tree-sitter-c.wasm', extensions: ['c', 'h'] },
  { id: 'cpp', label: 'C++', wasm: 'tree-sitter-cpp.wasm', extensions: ['cpp', 'cc', 'cxx', 'hpp', 'hh'] },
  { id: 'go', label: 'Go', wasm: 'tree-sitter-go.wasm', extensions: ['go'] },
  { id: 'rust', label: 'Rust', wasm: 'tree-sitter-rust.wasm', extensions: ['rs'] },
  { id: 'json', label: 'JSON', wasm: 'tree-sitter-json.wasm', extensions: ['json', 'jsonc'] },
  { id: 'html', label: 'HTML', wasm: 'tree-sitter-html.wasm', extensions: ['html', 'htm'] },
  { id: 'css', label: 'CSS', wasm: 'tree-sitter-css.wasm', extensions: ['css'] },
  { id: 'php', label: 'PHP', wasm: 'tree-sitter-php.wasm', extensions: ['php'] },
  { id: 'csharp', label: 'C#', wasm: 'tree-sitter-c_sharp.wasm', extensions: ['cs'] },
  { id: 'bash', label: 'Bash', wasm: 'tree-sitter-bash.wasm', extensions: ['sh', 'bash'] },
  { id: 'plaintext', label: '纯文本', wasm: null, extensions: ['txt'] },
];

const LANGUAGE_MAP = new Map(LANGUAGES.map((lang) => [lang.id, lang]));

function isValidLanguage(id) {
  return LANGUAGE_MAP.has(id);
}

function detectLanguage(filename) {
  const ext = String(filename).split('.').pop().toLowerCase();
  const match = LANGUAGES.find(
    (lang) => lang.extensions && lang.extensions.includes(ext),
  );
  return match ? match.id : 'plaintext';
}

function wasmPath(languageId) {
  const lang = LANGUAGE_MAP.get(languageId);
  if (!lang || !lang.wasm) return null;
  return path.join(config.wasmDir, lang.wasm);
}

module.exports = { LANGUAGES, LANGUAGE_MAP, isValidLanguage, detectLanguage, wasmPath };
