'use strict';

const express = require('express');
const { db, stmt } = require('../db');
const { generateUniqueId } = require('../id');
const { validateSnippetInput } = require('../validate');
const { highlight, supportedLanguages } = require('../highlighter');
const { searchSnippets, buildSearchText } = require('../search');
const config = require('../config');

const router = express.Router();

const updateStmt = db.prepare(`
  UPDATE snippets SET title=@title, description=@description, code=@code,
    language=@language, tags=@tags, expires_at=@expires_at, burn_after=@burn_after,
    search_text=@search_text WHERE id=@id`);

function safeParseTags(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch (_) {
    return [];
  }
}

function rowToJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    language: row.language,
    tags: safeParseTags(row.tags),
    created_at: new Date(row.created_at).toISOString(),
    expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    burn_after: Boolean(row.burn_after),
    views_count: row.views_count
  };
}

// GET /api/languages —— 支持的语言
router.get('/languages', (req, res) => {
  res.json({ languages: supportedLanguages() });
});

// GET /api/snippets —— 列表（分页 / 语言过滤）
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  let pageSize = parseInt(req.query.page_size, 10) || 20;
  pageSize = Math.min(Math.max(1, pageSize), config.LIMITS.pageMaxSize);
  const language = req.query.language ? String(req.query.language).toLowerCase() : null;
  const now = Date.now();

  const rows = language
    ? stmt.listByLanguage.all({ now, language, limit: pageSize, offset: (page - 1) * pageSize })
    : stmt.list.all({ now, limit: pageSize, offset: (page - 1) * pageSize });
  const total = stmt.countVisible.get(now).n;

  res.json({
    items: rows.map(rowToJson),
    page,
    page_size: pageSize,
    total,
    total_pages: Math.ceil(total / pageSize)
  });
});

// GET /api/snippets/search?q=&mode=plain|regex|fuzzy&fields=&language=&tag=&page=
router.get('/search', (req, res, next) => {
  try {
    const q = String(req.query.q || '').slice(0, config.LIMITS.searchQueryMaxLength);
    const mode = String(req.query.mode || 'plain');
    if (!['plain', 'regex', 'fuzzy'].includes(mode)) {
      return res.status(400).json({ error: 'mode 仅支持 plain / regex / fuzzy' });
    }
    let fields;
    if (req.query.fields) {
      fields = String(req.query.fields).split(',').map((f) => f.trim()).filter(Boolean);
      const allowed = new Set(['title', 'description', 'tags', 'language', 'code']);
      if (fields.some((f) => !allowed.has(f))) {
        return res.status(400).json({ error: 'fields 仅支持 title,description,tags,language,code' });
      }
    }
    if (mode === 'regex' && !q) return res.status(400).json({ error: '正则搜索必须提供 q 参数' });

    const now = Date.now();
    // search_text 由 title\ndescription\ntags\nlanguage\ncode 组成；
    // code 字段单独匹配需要原文，这里从 search_text 还原（code 是最后一段，内部换行无影响）
    const rows = stmt.allVisibleForSearch.all({ now }).map((r) => {
      const tagsParsed = safeParseTags(r.tags);
      return {
        ...r,
        tags_parsed: tagsParsed,
        tags: r.tags,
        code: extractCode(r.search_text)
      };
    });

    const scored = searchSnippets(rows, {
      q,
      mode,
      regexFlags: req.query.regex_flags,
      fields,
      language: req.query.language ? String(req.query.language).toLowerCase() : null,
      tag: req.query.tag ? String(req.query.tag) : null
    });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = 20;
    const start = (page - 1) * pageSize;
    const items = scored.slice(start, start + pageSize).map(({ snippet, score, matchedFields }) => ({
      id: snippet.id,
      title: snippet.title,
      description: snippet.description,
      language: snippet.language,
      tags: snippet.tags_parsed,
      score: mode === 'fuzzy' ? Number(score.toFixed(2)) : score,
      matched_fields: matchedFields
    }));

    res.json({
      q, mode, items,
      total: scored.length,
      page,
      total_pages: Math.ceil(scored.length / pageSize)
    });
  } catch (err) {
    next(err);
  }
});

// search_text 结构：title\ndescription\ntags\nlanguage\ncode（code 可能含换行，取第 5 段起）
function extractCode(searchText) {
  const parts = searchText.split('\n');
  return parts.slice(4).join('\n');
}

// GET /api/snippets/:id —— 详情（含高亮 HTML）；?raw=1 返回纯文本
router.get('/:id', async (req, res, next) => {
  try {
    const row = stmt.getById.get(req.params.id);
    if (!row) return res.status(404).json({ error: '片段不存在' });
    const now = Date.now();
    if (row.expires_at && row.expires_at <= now) {
      stmt.deleteOne.run(row.id);
      return res.status(404).json({ error: '片段不存在或已过期' });
    }

    if (req.query.raw === '1' || req.query.raw === 'true') {
      registerView(row);
      res.type('text/plain; charset=utf-8').send(row.code);
      return;
    }

    const highlighted = await highlight(row.code, row.language);
    registerView(row);
    res.json({
      ...rowToJson(row),
      code: row.code,
      code_html: highlighted.html,
      parsed_language: highlighted.language,
      parse_has_error: Boolean(highlighted.hasError)
    });
  } catch (err) {
    next(err);
  }
});

function registerView(row) {
  stmt.markViewed.run(row.id);
  if (row.burn_after) stmt.deleteOne.run(row.id);
}

// POST /api/snippets
router.post('/', (req, res, next) => {
  try {
    const data = validateSnippetInput(req.body || {});
    const id = generateUniqueId((candidate) => Boolean(stmt.getById.get(candidate)));
    const tags = data.tags || [];
    const searchText = buildSearchText({
      title: data.title,
      description: data.description,
      tags,
      language: data.language,
      code: data.code
    });
    stmt.insert.run({
      id,
      title: data.title || '未命名片段',
      description: data.description || '',
      code: data.code,
      language: data.language,
      tags: JSON.stringify(tags),
      created_at: Date.now(),
      expires_at: data.expires_at ?? null,
      burn_after: data.burn_after ? 1 : 0,
      search_text: searchText
    });
    res.status(201).json(rowToJson(stmt.getById.get(id)));
  } catch (err) {
    next(err);
  }
});

// PUT /api/snippets/:id
router.put('/:id', (req, res, next) => {
  try {
    const existing = stmt.getById.get(req.params.id);
    if (!existing) return res.status(404).json({ error: '片段不存在' });
    const patch = validateSnippetInput(req.body || {}, { partial: true });

    const merged = {
      title: patch.title ?? existing.title,
      description: patch.description ?? existing.description,
      code: patch.code ?? existing.code,
      language: patch.language ?? existing.language,
      tags: patch.tags ?? safeParseTags(existing.tags),
      expires_at: Object.prototype.hasOwnProperty.call(patch, 'expires_at')
        ? patch.expires_at
        : existing.expires_at,
      burn_after: Object.prototype.hasOwnProperty.call(patch, 'burn_after')
        ? (patch.burn_after ? 1 : 0)
        : existing.burn_after
    };
    const searchText = buildSearchText(merged);
    updateStmt.run({
      id: existing.id,
      title: merged.title,
      description: merged.description,
      code: merged.code,
      language: merged.language,
      tags: JSON.stringify(merged.tags),
      expires_at: merged.expires_at,
      burn_after: merged.burn_after,
      search_text: searchText
    });
    res.json(rowToJson(stmt.getById.get(existing.id)));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/snippets/:id
router.delete('/:id', (req, res) => {
  const info = stmt.deleteOne.run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: '片段不存在' });
  res.status(204).end();
});

module.exports = router;
