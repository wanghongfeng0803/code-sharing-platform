'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');

function jsonLimiter(options) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      if (req.originalUrl.startsWith('/api/')) {
        res.status(429).json({
          error: '请求过于频繁，请稍后再试（接口限流）',
          retryAfter: Math.ceil(options.windowMs / 1000),
        });
      } else {
        res.status(429).render('error', {
          title: '请求过于频繁',
          status: 429,
          message: '操作太频繁了，请稍后再试。',
        });
      }
    },
  });
}

module.exports = {
  apiLimiter: jsonLimiter(config.rateLimit.api),
  createLimiter: jsonLimiter(config.rateLimit.create),
  searchLimiter: jsonLimiter(config.rateLimit.search),
  pageLimiter: jsonLimiter(config.rateLimit.pages),
};
