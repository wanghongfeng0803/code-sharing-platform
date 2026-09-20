'use strict';

// 基于内存的滑动窗口限流器
// 每个 key（默认按客户端 IP）维护一个时间戳数组，定期淘汰过期记录。

const buckets = new Map();

let sweepTimer = null;

function sweep() {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    const cutoff = now - bucket.windowMs;
    while (bucket.hits.length && bucket.hits[0] <= cutoff) bucket.hits.shift();
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

function startSweeper(intervalMs = 60 * 1000) {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    try { sweep(); } catch (_) { /* 忽略清理异常 */ }
  }, intervalMs);
  if (sweepTimer.unref) sweepTimer.unref();
}

function clientIp(req) {
  // 信任反向代理时（如 nginx），取 X-Forwarded-For 的首个地址
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function rateLimit(options = {}) {
  const {
    windowMs = 60 * 1000,
    max = 100,
    keyGenerator = clientIp,
    prefix = 'rl',
    message = '请求过于频繁，请稍后再试'
  } = options;

  startSweeper();

  return function rateLimitMiddleware(req, res, next) {
    const key = `${prefix}:${keyGenerator(req)}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { hits: [], windowMs };
      buckets.set(key, bucket);
    }
    const cutoff = now - windowMs;
    while (bucket.hits.length && bucket.hits[0] <= cutoff) bucket.hits.shift();

    if (bucket.hits.length >= max) {
      const retryAfter = Math.ceil((bucket.hits[0] + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(Math.max(retryAfter, 1)));
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(Math.ceil((bucket.hits[0] + windowMs) / 1000)));
      const err = new Error(message);
      err.statusCode = 429;
      err.code = 'RATE_LIMITED';
      return next(err);
    }

    bucket.hits.push(now);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(max - bucket.hits.length));
    next();
  };
}

module.exports = { rateLimit, clientIp, _buckets: buckets };
