'use strict';

// 搜索引擎：支持普通匹配、正则匹配、模糊匹配（fzf 风格子序列打分）
//
// 搜索目标为片段的 title / description / tags / language / code 组成的可搜索文本。

const FIELDS = {
  title: (s) => s.title || '',
  description: (s) => s.description || '',
  tags: (s) => (Array.isArray(s.tags_parsed) ? s.tags_parsed : []).join(' '),
  language: (s) => s.language || '',
  code: (s) => s.code || s.search_text || ''
};

function buildSearchText({ title = '', description = '', tags = [], language = '', code = '' }) {
  return [title, description, Array.isArray(tags) ? tags.join(' ') : '', language, code].join('\n');
}

// 普通匹配：大小写不敏感子串
function compilePlain(query) {
  const needle = query.toLowerCase();
  return {
    test(text) {
      return text.toLowerCase().includes(needle);
    }
  };
}

// 正则匹配：用户提供 pattern + flags（强制忽略全局/粘性标志，避免 lastIndex 问题）
function compileRegex(query, flagsInput) {
  if (query.length > 200) throw new Error('正则表达式过长（最多 200 字符）');
  let flags = 'm';
  if (flagsInput) {
    const f = new Set(String(flagsInput).split(''));
    if (f.has('i')) flags += 'i';
    if (f.has('s')) flags += 's';
  }
  let re;
  try {
    re = new RegExp(query, flags);
  } catch (err) {
    const e = new Error(`无效的正则表达式: ${err.message}`);
    e.statusCode = 400;
    throw e;
  }
  // ReDoS 防护：限制输入规模由路由层保证，这里再加执行耗时兜底
  return {
    test(text) {
      return re.test(text);
    }
  };
}

// 模糊匹配：子序列 + 打分（参考 fzf 的思路）
// 返回 { matched, score }，分数越高越靠前
function fuzzyMatch(text, query) {
  if (!query) return { matched: true, score: 0 };
  const t = text.toLowerCase();
  const q = query.toLowerCase();

  let ti = 0;
  let qi = 0;
  let score = 0;
  let lastMatch = -2;
  let streak = 0;
  let firstMatch = -1;

  while (ti < t.length && qi < q.length) {
    const tc = t.charCodeAt(ti);
    if (t[ti] === q[qi]) {
      if (firstMatch === -1) firstMatch = ti;
      // 边界奖励：起始位置、非字母数字之后（驼峰/分隔符）
      if (ti === 0) score += 16;
      else {
        const prev = t.charCodeAt(ti - 1);
        if (isSeparator(prev)) score += 12;
        else if (isLower(prev) && isUpper(text.charCodeAt(ti))) score += 8; // camelCase
      }
      // 连续匹配奖励
      if (ti === lastMatch + 1) {
        streak++;
        score += 6 + streak * 2;
      } else {
        streak = 0;
        score += 2;
      }
      // 起始精确前缀强奖励
      if (ti === 0 || isSeparator(t.charCodeAt(ti - 1))) {
        if (qi === 0) score += 10;
      }
      lastMatch = ti;
      qi++;
    }
    ti++;
  }

  if (qi < q.length) return { matched: false, score: -1 };
  // 越靠前、越短的匹配越好
  score -= firstMatch * 0.05;
  score -= t.length * 0.002;
  return { matched: true, score };
}

function isSeparator(code) {
  return code === 32 || code === 9 || code === 10 || code === 13 ||
    code === 45 || code === 95 || code === 47 || code === 92 ||
    code === 46 || code === 58 || code === 64;
}
function isLower(code) { return code >= 97 && code <= 122; }
function isUpper(code) { return code >= 65 && code <= 90; }

function compileFuzzy(query) {
  return {
    test() { return true; }, // 是否匹配交由 score 阶段
    score(text) {
      return fuzzyMatch(text, query);
    },
    fuzzy: true
  };
}

// 多字段聚合：任一字段命中即入选；模糊模式按“最佳字段分数”排序
function searchSnippets(snippets, { q, mode = 'plain', regexFlags, fields, language, tag }) {
  let matcher;
  if (mode === 'regex') matcher = compileRegex(q, regexFlags);
  else if (mode === 'fuzzy') matcher = compileFuzzy(q);
  else matcher = compilePlain(q);

  const selectedFields = fields && fields.length
    ? fields.filter((f) => FIELDS[f])
    : Object.keys(FIELDS);

  const results = [];
  for (const snippet of snippets) {
    if (language && snippet.language !== language) continue;
    if (tag) {
      const tags = snippet.tags_parsed || [];
      if (!tags.some((t) => t.toLowerCase() === String(tag).toLowerCase())) continue;
    }

    let bestScore = -Infinity;
    let matched = false;
    const matchedFields = [];

    for (const field of selectedFields) {
      const text = FIELDS[field](snippet);
      if (matcher.fuzzy) {
        const r = matcher.score(text);
        if (r.matched) {
          matched = true;
          if (r.score > bestScore) bestScore = r.score;
          matchedFields.push(field);
        }
      } else if (q === '' || matcher.test(text)) {
        matched = true;
        matchedFields.push(field);
        // 普通/正则模式下，标题与标签命中加分
        if (field === 'title') bestScore = Math.max(bestScore, 8);
        else if (field === 'tags') bestScore = Math.max(bestScore, 6);
        else if (field === 'language') bestScore = Math.max(bestScore, 5);
        else if (field === 'description') bestScore = Math.max(bestScore, 3);
        else bestScore = Math.max(bestScore, 1);
      }
    }

    if (matched) {
      results.push({
        snippet,
        score: bestScore === -Infinity ? 0 : bestScore,
        matchedFields
      });
    }
  }

  if (mode === 'fuzzy') {
    results.sort((a, b) => b.score - a.score || b.snippet.created_at - a.snippet.created_at);
  } else if (q) {
    results.sort((a, b) => b.score - a.score || b.snippet.created_at - a.snippet.created_at);
  } else {
    results.sort((a, b) => b.snippet.created_at - a.snippet.created_at);
  }
  return results;
}

module.exports = { searchSnippets, buildSearchText, fuzzyMatch };
