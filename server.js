'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');

const config = require('./src/config');
const { init: initHighlighter } = require('./src/highlighter');
const apiRouter = require('./src/routes/api');
const pageRouter = require('./src/routes/pages');
const { apiLimiter, pageLimiter } = require('./src/middleware/rate-limiters');
const { notFound, errorHandler } = require('./src/middleware/errors');

const app = express();

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(config.root, 'views'));

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
      },
    },
  }),
);
app.use(express.json({ limit: '300kb' }));
app.use(express.urlencoded({ extended: true, limit: '300kb' }));
app.use(express.static(path.join(config.root, 'public')));

app.use('/api', apiLimiter, apiRouter);
app.use('/', pageLimiter, pageRouter);

app.use(notFound);
app.use(errorHandler);

async function start() {
  await initHighlighter();
  app.listen(config.port, () => {
    console.log(`代码分享平台已启动：http://localhost:${config.port}`);
    console.log(`环境：${config.nodeEnv}，数据库：${config.dbFile}`);
  });
}

start().catch((err) => {
  console.error('启动失败：', err);
  process.exit(1);
});

module.exports = app;
