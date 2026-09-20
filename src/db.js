'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS snippets (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT '匿名',
  language    TEXT NOT NULL DEFAULT 'plaintext',
  content     TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '',
  views       INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snippets_language   ON snippets(language);
CREATE INDEX IF NOT EXISTS idx_snippets_created_at ON snippets(created_at DESC);
`);

function now() {
  return Date.now();
}

function generateId() {
  return crypto.randomBytes(9).toString('base64url');
}

function rowToSnippet(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    language: row.language,
    content: row.content,
    description: row.description,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    views: row.views,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function normalizeTags(tags) {
  return Array.from(
    new Set(
      tags
        .map((tag) => String(tag).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, config.limits.maxTagCount),
    ),
  ).join(',');
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO snippets
      (id, title, author, language, content, description, tags, views, created_at, updated_at)
    VALUES
      (@id, @title, @author, @language, @content, @description, @tags, 0, @created_at, @updated_at)
  `),
  getById: db.prepare('SELECT * FROM snippets WHERE id = ?'),
  incrementViews: db.prepare('UPDATE snippets SET views = views + 1 WHERE id = ?'),
  listPage: db.prepare(`
    SELECT * FROM snippets
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `),
  count: db.prepare('SELECT COUNT(*) AS n FROM snippets'),
  listIdsNewest: db.prepare(
    'SELECT id FROM snippets ORDER BY created_at DESC LIMIT ?',
  ),
  allForIndex: db.prepare(`
    SELECT id, title, author, language, description, tags, created_at, views
    FROM snippets ORDER BY created_at DESC LIMIT ?
  `),
};

function createSnippet(data) {
  const id = generateId();
  const ts = now();
  stmts.insert.run({
    id,
    title: data.title,
    author: data.author,
    language: data.language,
    content: data.content,
    description: data.description,
    tags: normalizeTags(data.tags || []),
    created_at: ts,
    updated_at: ts,
  });
  return getSnippet(id, false);
}

function getSnippet(id, incViews = false) {
  if (incViews) stmts.incrementViews.run(id);
  return rowToSnippet(stmts.getById.get(id));
}

function listSnippets(page, pageSize) {
  const total = stmts.count.get().n;
  const offset = (page - 1) * pageSize;
  const items = stmts.listPage.all(pageSize, offset).map(rowToSnippet);
  return { items, total, page, pageSize };
}

function allSnippetSummaries(limit = config.limits.maxSearchRowsScanned) {
  return stmts.allForIndex.all(limit).map((row) => ({
    ...row,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
  }));
}

function getSearchPool(limit = config.limits.maxSearchRowsScanned) {
  const ids = stmts.listIdsNewest.all(limit).map((row) => row.id);
  return ids;
}

module.exports = {
  db,
  createSnippet,
  getSnippet,
  listSnippets,
  allSnippetSummaries,
  getSearchPool,
  rowToSnippet,
  normalizeTags,
};
