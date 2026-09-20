'use strict';

const { parentPort } = require('worker_threads');

const EXCERPT_RADIUS = 60;
const MAX_MATCHES_PER_ROW = 3;
const MAX_TOTAL_MATCHES = 200;
const ROW_TIME_BUDGET_MS = 800;

function buildExcerpt(text, index, matchLen) {
  const start = Math.max(0, index - EXCERPT_RADIUS);
  const end = Math.min(text.length, index + matchLen + EXCERPT_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return prefix + text.slice(start, end).replace(/\s+/g, ' ').trim() + suffix;
}

parentPort.on('message', (task) => {
  const { rows, pattern, flags, maxFieldLength } = task;

  let regex;
  try {
    regex = new RegExp(pattern, flags);
  } catch (err) {
    parentPort.postMessage({ ok: false, error: `无效的正则表达式：${err.message}` });
    return;
  }

  const startedAt = Date.now();
  const results = [];
  let totalMatches = 0;
  let timedOut = false;

  try {
    for (const row of rows) {
      if (Date.now() - startedAt > ROW_TIME_BUDGET_MS) {
        timedOut = true;
        break;
      }
      const fields = [
        { name: 'title', value: String(row.title || '') },
        { name: 'author', value: String(row.author || '') },
        { name: 'description', value: String(row.description || '') },
        { name: 'tags', value: Array.isArray(row.tags) ? row.tags.join(' ') : String(row.tags || '') },
        { name: 'content', value: String(row.content || '').slice(0, maxFieldLength) },
      ];

      const matches = [];
      for (const field of fields) {
        if (!field.value) continue;
        regex.lastIndex = 0;
        let guard = 0;
        let match;
        while ((match = regex.exec(field.value)) !== null) {
          guard += 1;
          if (guard > 50) break;
          const matchLen = match[0].length;
          matches.push({
            field: field.name,
            match: match[0].slice(0, 200),
            index: match.index,
            excerpt: buildExcerpt(field.value, match.index, Math.max(matchLen, 1)),
          });
          totalMatches += 1;
          if (matches.length >= MAX_MATCHES_PER_ROW || totalMatches >= MAX_TOTAL_MATCHES) break;
          if (matchLen === 0) regex.lastIndex += 1;
        }
        if (matches.length >= MAX_MATCHES_PER_ROW || totalMatches >= MAX_TOTAL_MATCHES) break;
      }

      if (matches.length > 0) {
        results.push({
          id: row.id,
          title: row.title,
          author: row.author,
          language: row.language,
          description: row.description,
          tags: row.tags,
          views: row.views,
          created_at: row.created_at,
          matches,
        });
      }
      if (totalMatches >= MAX_TOTAL_MATCHES) break;
    }
  } catch (err) {
    parentPort.postMessage({ ok: false, error: `正则执行出错：${err.message}` });
    return;
  }

  parentPort.postMessage({
    ok: true,
    results,
    truncated: totalMatches >= MAX_TOTAL_MATCHES || timedOut,
    scannedAt: startedAt,
  });
});
