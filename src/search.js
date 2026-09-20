'use strict';

const path = require('path');
const { Worker } = require('worker_threads');
const Fuse = require('fuse.js');
const { db } = require('./db');
const config = require('./config');

const SEARCH_FIELDS = ['title', 'author', 'description', 'tags', 'content'];

function fetchPool() {
  const ids = db
    .prepare(`SELECT id FROM snippets ORDER BY created_at DESC LIMIT ?`)
    .all(config.limits.maxSearchRowsScanned)
    .map((row) => row.id);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT id, title, author, language, description, tags, content, views, created_at
       FROM snippets WHERE id IN (${placeholders})`,
    )
    .all(...ids)
    .map((row) => ({
      ...row,
      tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    }))
    .sort((a, b) => b.created_at - a.created_at);
}

function applyLanguageFilter(rows, language) {
  if (!language) return rows;
  return rows.filter((row) => row.language === language);
}

function plainSearch(rows, query, language) {
  const needle = query.toLowerCase();
  const filtered = applyLanguageFilter(rows, language);
  const matches = [];
  for (const row of filtered) {
    const haystack = [
      row.title,
      row.author,
      row.description,
      ...(Array.isArray(row.tags) ? row.tags : []),
      String(row.content || '').slice(0, config.limits.maxFieldScanLength),
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    if (haystack.includes(needle)) {
      matches.push({ ...row, score: 0, mode: 'plain' });
    }
  }
  return matches;
}

function fuzzySearch(rows, query, language) {
  const filtered = applyLanguageFilter(rows, language);
  const fuse = new Fuse(filtered, {
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.4,
    minMatchCharLength: 2,
    keys: [
      { name: 'title', weight: 0.35 },
      { name: 'description', weight: 0.2 },
      { name: 'tags', weight: 0.15 },
      { name: 'author', weight: 0.1 },
      { name: 'content', weight: 0.2 },
    ],
  });
  return fuse.search(query).map((result) => ({
    ...result.item,
    score: result.score,
    mode: 'fuzzy',
  }));
}

function runRegexInWorker(rows, pattern, insensitive) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'workers', 'regex-worker.js'));
    let settled = false;

    let timer = null;

    function finish(fn, arg) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      worker.terminate().catch(() => {});
      fn(arg);
    }

    timer = setTimeout(() => {
      finish(reject, new Error('REGEX_TIMEOUT'));
    }, config.limits.regexTimeoutMs);

    worker.once('message', (message) => {
      if (message.ok) finish(resolve, message);
      else finish(reject, new Error(message.error));
    });

    worker.on('error', (err) => {
      finish(reject, err);
    });

    worker.postMessage({
      rows,
      pattern,
      flags: `gms${insensitive ? 'i' : ''}`,
      maxFieldLength: config.limits.maxFieldScanLength,
    });
  });
}

async function regexSearch(rows, pattern, language, insensitive) {
  const filtered = applyLanguageFilter(rows, language);
  const outcome = await runRegexInWorker(filtered, pattern, insensitive);
  return {
    items: outcome.results.map((row) => ({ ...row, score: 0, mode: 'regex' })),
    truncated: outcome.truncated,
  };
}

async function search({ query, mode = 'plain', language = '', sensitive = false }) {
  const pool = fetchPool();
  const scanned = pool.length;

  if (!query) {
    return { items: [], mode, scanned, truncated: false };
  }
  if (query.length > config.limits.maxRegexLength) {
    const err = new Error(`搜索内容过长（最多 ${config.limits.maxRegexLength} 字符）`);
    err.status = 400;
    throw err;
  }

  if (mode === 'fuzzy') {
    return { items: fuzzySearch(pool, query, language), mode, scanned, truncated: false };
  }
  if (mode === 'regex') {
    const result = await regexSearch(pool, query, language, !sensitive);
    return { ...result, mode, scanned };
  }
  return { items: plainSearch(pool, query, language), mode, scanned, truncated: false };
}

module.exports = { search, SEARCH_FIELDS };
