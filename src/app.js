'use strict';

const path = require('path');
const express = require('express');
const config = require('./config');
const { rateLimit } = require('./middleware/rateLimit');
const snippetsRouter = require('./routes/snippets');
const { ValidationError } = require('./validate');
const { stmt } = require('./db');
const { init: initHighlighter } = require('./highlighter');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  // 全局限流
  app.use(rateLimit(config.RATE_LIMITS.global));

  // 静态前端
  app.use(express.static(path.join(config.ROOT, 'public'), { index: 'index.html' }));

  app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  // 搜索使用独立、更严格的限流桶（注意要先于通用挂载匹配）
  app.use('/api/snippets/search', rateLimit(config.RATE_LIMITS.search));
  // POST 写入使用更严格的限流桶（GET 不受影响，中间件内部按方法区分）
  app.use('/api/snippets', (req, res, next) => {
    if (req.method === 'POST') return rateLimit(config.RATE_LIMITS.create)(req, res, next);
    next();
  });
  app.use('/api/snippets', snippetsRouter);

  // 前端页面路由（由静态文件处理 index.html，这里加两个直达页）
  app.get(['/new', '/snippet/:id'], (req, res) => {
    res.sendFile(path.join(config.ROOT, 'public', 'index.html'));
  });

  // 404
  app.use('/api', (req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });
  app.use((req, res) => {
    res.status(404).sendFile(path.join(config.ROOT, 'public', 'index.html'));
  });

  // 统一错误处理
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.statusCode || err.status || 500;
    if (status >= 500) console.error('[error]', err);
    res.status(status).json({
      error: err.message || '服务器内部错误',
      code: err.code || undefined,
      details: err.details
    });
  });

  return app;
}

// 定期清理过期片段
function startCleanup() {
  const timer = setInterval(() => {
    try {
      const info = stmt.deleteExpired.run(Date.now());
      if (info.changes > 0) console.log(`[cleanup] 清理过期片段 ${info.changes} 条`);
    } catch (err) {
      console.error('[cleanup] 失败:', err.message);
    }
  }, config.CLEANUP_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

async function start() {
  await initHighlighter();
  const app = createApp();
  startCleanup();
  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`代码分享平台已启动: http://${config.HOST}:${config.PORT}`);
  });
  return server;
}

module.exports = { createApp, start };
