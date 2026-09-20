'use strict';

const config = require('./config');
const { resolveLanguage } = require('./highlighter');

class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.code = 'VALIDATION_ERROR';
    this.details = details;
  }
}

function normalizeTags(raw) {
  let tags = raw;
  if (tags == null) return [];
  if (typeof tags === 'string') tags = tags.split(',');
  if (!Array.isArray(tags)) throw new ValidationError('tags 必须是数组或逗号分隔字符串');
  const cleaned = [];
  for (const tag of tags) {
    const t = String(tag).trim().toLowerCase();
    if (!t) continue;
    if (t.length > 30) throw new ValidationError('单个标签长度不能超过 30');
    if (!cleaned.includes(t)) cleaned.push(t);
  }
  if (cleaned.length > config.LIMITS.maxTags) {
    throw new ValidationError(`标签最多 ${config.LIMITS.maxTags} 个`);
  }
  return cleaned;
}

function validateSnippetInput(body, { partial = false } = {}) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (!partial || has('code')) {
    if (typeof body.code !== 'string') throw new ValidationError('code 必须是字符串');
    if (body.code.length === 0) throw new ValidationError('code 不能为空');
    if (Buffer.byteLength(body.code, 'utf8') > config.LIMITS.snippetMaxBytes) {
      throw new ValidationError(`code 过大（上限 ${config.LIMITS.snippetMaxBytes} 字节）`);
    }
    out.code = body.code;
  }

  if (!partial || has('language')) {
    if (typeof body.language !== 'string' || !body.language.trim()) {
      throw new ValidationError('language 必填');
    }
    const resolved = resolveLanguage(body.language.trim());
    if (!resolved) throw new ValidationError(`不支持的语言: ${body.language}`);
    out.language = resolved;
  }

  if (!partial || has('title')) {
    const title = body.title == null ? '' : String(body.title);
    if (title.length > config.LIMITS.titleMaxLength) {
      throw new ValidationError(`title 长度不能超过 ${config.LIMITS.titleMaxLength}`);
    }
    out.title = title.trim();
  }

  if (!partial || has('description')) {
    const description = body.description == null ? '' : String(body.description);
    if (description.length > config.LIMITS.descriptionMaxLength) {
      throw new ValidationError(`description 长度不能超过 ${config.LIMITS.descriptionMaxLength}`);
    }
    out.description = description;
  }

  if (has('tags')) out.tags = normalizeTags(body.tags);

  if (has('expires_in_seconds')) {
    if (body.expires_in_seconds === null || body.expires_in_seconds === '') {
      out.expires_at = null;
    } else {
      const secs = Number(body.expires_in_seconds);
      if (!Number.isFinite(secs) || secs <= 0 || !Number.isInteger(secs)) {
        throw new ValidationError('expires_in_seconds 必须是正整数（秒）');
      }
      if (secs > 60 * 60 * 24 * 365) throw new ValidationError('过期时间最长一年');
      out.expires_at = Date.now() + secs * 1000;
    }
  }

  if (has('burn_after_read')) {
    out.burn_after = Boolean(body.burn_after_read);
  }

  return out;
}

module.exports = { ValidationError, validateSnippetInput, normalizeTags };
