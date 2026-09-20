'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });

const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS snippets (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  code          TEXT NOT NULL,
  language      TEXT NOT NULL,
  tags          TEXT NOT NULL DEFAULT '[]',
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER,
  burn_after    INTEGER NOT NULL DEFAULT 0,
  viewed        INTEGER NOT NULL DEFAULT 0,
  views_count   INTEGER NOT NULL DEFAULT 0,
  search_text   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_snippets_created ON snippets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snippets_language ON snippets(language);
CREATE INDEX IF NOT EXISTS idx_snippets_expires ON snippets(expires_at);
`);

const stmt = {
  insert: db.prepare(`
    INSERT INTO snippets
      (id, title, description, code, language, tags, created_at, expires_at, burn_after, search_text)
    VALUES
      (@id, @title, @description, @code, @language, @tags, @created_at, @expires_at, @burn_after, @search_text)`),
  getById: db.prepare('SELECT * FROM snippets WHERE id = ?'),
  list: db.prepare(`
    SELECT id, title, description, language, tags, created_at, expires_at, burn_after, views_count
    FROM snippets
    WHERE burn_after = 0 AND (expires_at IS NULL OR expires_at > :now)
    ORDER BY created_at DESC
    LIMIT :limit OFFSET :offset`),
  listByLanguage: db.prepare(`
    SELECT id, title, description, language, tags, created_at, expires_at, burn_after, views_count
    FROM snippets
    WHERE burn_after = 0 AND (expires_at IS NULL OR expires_at > :now) AND language = :language
    ORDER BY created_at DESC
    LIMIT :limit OFFSET :offset`),
  countVisible: db.prepare(`
    SELECT COUNT(*) AS n FROM snippets
    WHERE burn_after = 0 AND (expires_at IS NULL OR expires_at > ?)`),
  markViewed: db.prepare('UPDATE snippets SET views_count = views_count + 1 WHERE id = ?'),
  deleteOne: db.prepare('DELETE FROM snippets WHERE id = ?'),
  deleteExpired: db.prepare('DELETE FROM snippets WHERE expires_at IS NOT NULL AND expires_at <= ?'),
  allVisibleForSearch: db.prepare(`
    SELECT id, title, description, language, tags, search_text
    FROM snippets
    WHERE burn_after = 0 AND (expires_at IS NULL OR expires_at > :now)`),
  languages: db.prepare(`
    SELECT language, COUNT(*) AS count FROM snippets
    WHERE burn_after = 0 AND (expires_at IS NULL OR expires_at > ?)
    GROUP BY language ORDER BY count DESC`)
};

module.exports = { db, stmt };
