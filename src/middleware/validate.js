'use strict';

const { isValidLanguage } = require('../languages');
const config = require('../config');

function validateSnippetBody(body) {
  const errors = [];
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const author = typeof body.author === 'string' ? body.author.trim() : '';
  const language = typeof body.language === 'string' ? body.language.trim() : 'plaintext';
  const content = typeof body.content === 'string' ? body.content : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const rawTags = Array.isArray(body.tags)
    ? body.tags
    : typeof body.tags === 'string'
      ? body.tags.split(',')
      : [];
  const tags = rawTags
    .map((tag) => String(tag).trim().toLowerCase())
    .filter(Boolean);

  if (!title) errors.push('标题不能为空');
  if (title.length > config.limits.maxTitleLength) {
    errors.push(`标题不能超过 ${config.limits.maxTitleLength} 个字符`);
  }
  if (author.length > config.limits.maxAuthorLength) {
    errors.push(`作者名不能超过 ${config.limits.maxAuthorLength} 个字符`);
  }
  if (!content) errors.push('代码内容不能为空');
  if (content.length > config.limits.maxSnippetLength) {
    errors.push(`代码内容不能超过 ${config.limits.maxSnippetLength} 个字符`);
  }
  if (description.length > config.limits.maxDescriptionLength) {
    errors.push(`描述不能超过 ${config.limits.maxDescriptionLength} 个字符`);
  }
  if (!isValidLanguage(language)) errors.push(`不支持的语言：${language}`);
  if (tags.length > config.limits.maxTagCount) {
    errors.push(`标签最多 ${config.limits.maxTagCount} 个`);
  }
  if (tags.some((tag) => tag.length > config.limits.maxTagLength)) {
    errors.push(`单个标签不能超过 ${config.limits.maxTagLength} 个字符`);
  }

  return {
    errors,
    value: {
      title,
      author: author || '匿名',
      language,
      content,
      description,
      tags,
    },
  };
}

module.exports = { validateSnippetBody };
