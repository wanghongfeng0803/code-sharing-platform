'use strict';

const express = require('express');
const { getSnippet, listSnippets } = require('../db');
const { highlight } = require('../highlighter');
const { LANGUAGES, LANGUAGE_MAP } = require('../languages');
const { search } = require('../search');
const { searchLimiter } = require('../middleware/rate-limiters');
const config = require('../config');

const router = express.Router();

function languageLabel(id) {
  return LANGUAGE_MAP.has(id) ? LANGUAGE_MAP.get(id).label : id;
}

router.get('/', (req, res, next) => {
  try {
    let page = parseInt(req.query.page, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    const result = listSnippets(page, config.pagination.pageSize);
    const totalPages = Math.max(1, Math.ceil(result.total / config.pagination.pageSize));
    res.render('index', {
      languages: LANGUAGES,
      snippets: result.items,
      page,
      totalPages,
      total: result.total,
      query: {},
      searchError: null,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/new', (req, res) => {
  res.render('new', { languages: LANGUAGES, form: {}, errors: [] });
});

router.get('/snippets/:id', async (req, res, next) => {
  try {
    const snippet = getSnippet(req.params.id, true);
    if (!snippet) {
      return res.status(404).render('error', {
        title: '代码片段不存在',
        status: 404,
        message: '该代码片段可能已被删除，或链接有误。',
      });
    }
    const highlighted = await highlight(snippet.content, snippet.language);
    res.render('snippet', {
      snippet,
      languageLabel: languageLabel(snippet.language),
      highlighted,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/snippets/:id/raw', (req, res, next) => {
  try {
    const snippet = getSnippet(req.params.id, false);
    if (!snippet) return res.status(404).type('text/plain').send('Not found');
    res.type('text/plain; charset=utf-8').send(snippet.content);
  } catch (err) {
    next(err);
  }
});

router.get('/search', searchLimiter, async (req, res, next) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const mode = ['plain', 'fuzzy', 'regex'].includes(req.query.mode)
    ? req.query.mode
    : 'plain';
  const language = typeof req.query.language === 'string' ? req.query.language : '';
  const sensitive = req.query.sensitive === 'true' || req.query.sensitive === '1';

  let items = [];
  let scanned = 0;
  let truncated = false;
  let searchError = null;

  if (query) {
    try {
      const result = await search({ query, mode, language, sensitive });
      items = result.items;
      scanned = result.scanned;
      truncated = result.truncated;
    } catch (err) {
      if (err.message === 'REGEX_TIMEOUT') {
        searchError = '正则表达式执行超时，可能存在灾难性回溯，请简化表达式。';
      } else {
        searchError = err.message;
      }
    }
  }

  const result = listSnippets(1, config.pagination.pageSize);
  res.render('index', {
    languages: LANGUAGES,
    snippets: result.items,
    page: 1,
    totalPages: Math.max(1, Math.ceil(result.total / config.pagination.pageSize)),
    total: result.total,
    query: { q: query, mode, language, sensitive },
    searchResults: items,
    searched: Boolean(query),
    scanned,
    truncated,
    searchError,
  });
});

module.exports = router;
