'use strict';

const { start } = require('./src/app');

start().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
