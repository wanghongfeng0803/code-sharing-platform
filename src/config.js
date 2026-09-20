'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

module.exports = {
  ROOT,
  PORT: Number(process.env.PORT) || 3000,
  HOST: process.env.HOST || '0.0.0.0',
  DB_PATH: process.env.DB_PATH || path.join(ROOT, 'data', 'snippets.db'),
  WASM_DIR: process.env.WASM_DIR || path.join(ROOT, 'node_modules', 'tree-sitter-wasms', 'out'),
  LIMITS: {
    snippetMaxBytes: 200 * 1024,
    titleMaxLength: 200,
    descriptionMaxLength: 500,
    maxTags: 10,
    searchQueryMaxLength: 200,
    pageMaxSize: 50
  },
  RATE_LIMITS: {
    global: { windowMs: 60 * 1000, max: Number(process.env.RL_GLOBAL_MAX) || 240 },
    create: { windowMs: 60 * 1000, max: Number(process.env.RL_CREATE_MAX) || 20 },
    search: { windowMs: 60 * 1000, max: Number(process.env.RL_SEARCH_MAX) || 60 }
  },
  // 定期清理过期片段的间隔
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000
};
