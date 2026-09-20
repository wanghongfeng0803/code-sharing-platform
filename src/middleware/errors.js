'use strict';

function notFound(req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: '资源不存在' });
  }
  return res.status(404).render('error', {
    title: '页面不存在',
    status: 404,
    message: '你访问的页面或代码片段不存在。',
  });
}

function errorHandler(err, req, res, _next) {
  const status = Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) {
    console.error('[error]', err);
  }
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({
      error: err.message || '服务器内部错误',
    });
  }
  return res.status(status).render('error', {
    title: '出错了',
    status,
    message: status >= 500 ? '服务器内部错误，请稍后再试。' : err.message,
  });
}

module.exports = { notFound, errorHandler };
