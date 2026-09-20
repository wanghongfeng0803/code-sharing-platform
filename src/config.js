'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const config = {
  root: ROOT,
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  dbFile: process.env.DB_FILE || path.join(ROOT, 'data', 'snippets.db'),
  wasmDir:
    process.env.TREE_SITTER_WASM_DIR ||
    path.join(ROOT, 'node_modules', 'tree-sitter-wasms', 'out'),
  limits: {
    maxSnippetLength: 100_000,
    maxTitleLength: 200,
    maxAuthorLength: 80,
    maxDescriptionLength: 500,
    maxTagCount: 10,
    maxTagLength: 30,
    maxSearchRowsScanned: 1000,
    maxFieldScanLength: 5000,
    maxRegexLength: 500,
    regexTimeoutMs: 2500,
  },
  pagination: {
    pageSize: 20,
    maxPageSize: 100,
  },
  rateLimit: {
    windowMs: 60_000,
    api: { windowMs: 60_000, limit: 120 },
    create: { windowMs: 60_000, limit: 10 },
    search: { windowMs: 60_000, limit: 30 },
    pages: { windowMs: 60_000, limit: 240 },
  },
};

module.exports = config;
