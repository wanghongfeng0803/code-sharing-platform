'use strict';

const crypto = require('crypto');

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function generateId(length = 8) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % 62];
  return out;
}

function generateUniqueId(exists, length = 8) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = generateId(length);
    if (!exists(id)) return id;
  }
  // 极小概率冲突：加长一位重试
  return generateUniqueId(exists, length + 2);
}

module.exports = { generateId, generateUniqueId };
