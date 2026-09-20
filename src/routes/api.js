'use strict';

const express = require('express');
const {
  createSnippet,
  getSnippet,
  listSnippets,
} = require('../db');
const { LANGUAGES } = require('../languages');
const { search } = require('../search');
const { validateSnippetBody } = require('../middleware/validate');
const { createLimiter, searchLimiter } = require('../middleware/rate-limiters');
const config = require('../config');

const router = express.Router();

router.get('/languages', (req, res) => {
  res.json({
    languages: LANGUAGES.map((lang) => ({ id: lang.id, label: lang.label })),
  });
});

router.get('/snippets', (req, res, next) => {
  try {
    let page = parseInt(req.query.page, 10);
    let pageSize = parseInt(req.query.pageSize, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = config.pagination.pageSize;
    pageSize = Math.min(pageSize, config.pagination.maxPageSize);

    const result = listSnippets(page, pageSize);
    res.json({
      ...result,
      totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/snippets', createLimiter, (req, res, next) => {
  try {
    const { errors, value } = validateSnippetBody(req.body || {});
    if (errors.length > 0) {
      return res.status(422).json({ error: '参数校验失败', details: errors });
    }
    const snippet = createSnippet(value);
    return res.status(201).json(snippet);
  } catch (err) {
    return next(err);
  }
});

router.get('/snippets/:id', (req, res, next) => {
  try {
    const snippet = getSnippet(req.params.id, true);
    if (!snippet) return res.status(404).json({ error: '代码片段不存在' });
    return res.json(snippet);
  } catch (err) {
    return next(err);
  }
});

router.get('/search', searchLimiter, async (req, res, next) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const mode = ['plain', 'fuzzy', 'regex'].includes(req.query.mode)
      ? req.query.mode
      : 'plain';
    const language =
      typeof req.query.language === 'string' ? req.query.language : '';
    const sensitive = req.query.sensitive === 'true' || req.query.sensitive === '1';

    if (!query) return res.status(400).json({ error: '搜索关键词 q 不能为空' });

    const result = await search({ query, mode, language, sensitive });
    return res.json(result);
  } catch (err) {
    if (err.message === 'REGEX_TIMEOUT') {
      return res.status(400).json({
        error: '正则表达式执行超时，可能存在灾难性回溯，请简化表达式',
      });
    }
    if (err.status === 400 || /^无效的正则表达式|^正则执行出错/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
});

module.exports = router;
