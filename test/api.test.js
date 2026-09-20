'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// 在加载 app 之前指向临时数据库
const tmpDb = path.join(__dirname, 'tmp-test.db');
for (const ext of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(tmpDb + ext); } catch (_) { /* ignore */ }
}
process.env.DB_PATH = tmpDb;
process.env.PORT = '0';
process.env.RL_GLOBAL_MAX = '100000';
process.env.RL_CREATE_MAX = '100000';
process.env.RL_SEARCH_MAX = '100000';

const { createApp } = require('../src/app');
const { init: initHighlighter } = require('../src/highlighter');

const app = createApp();
let server;
let base;

test.before(async () => {
  await initHighlighter();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(tmpDb + ext); } catch (_) { /* ignore */ }
  }
});

async function postJson(urlPath, body) {
  const res = await fetch(base + urlPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function getJson(urlPath) {
  const res = await fetch(base + urlPath);
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

test('健康检查', async () => {
  const { status, body } = await getJson('/health');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.status, 'ok');
});

test('创建片段并返回 8 位 ID', async () => {
  const { status, body } = await postJson('/api/snippets', {
    title: '测试片段', language: 'python', code: 'print("hi")', tags: 'a, b, a'
  });
  assert.strictEqual(status, 201);
  assert.match(body.id, /^[0-9A-Za-z]{8}$/);
  assert.deepStrictEqual(body.tags, ['a', 'b']); // 去重 + 小写
  assert.strictEqual(body.language, 'python');
});

test('语言别名解析与不支持语言 400', async () => {
  const ok = await postJson('/api/snippets', { language: 'js', code: 'var x=1' });
  assert.strictEqual(ok.status, 201);
  assert.strictEqual(ok.body.language, 'javascript');

  const bad = await postJson('/api/snippets', { language: 'brainfuck', code: 'x' });
  assert.strictEqual(bad.status, 400);
});

test('空代码 / 超长输入校验', async () => {
  const empty = await postJson('/api/snippets', { language: 'js', code: '' });
  assert.strictEqual(empty.status, 400);
  const big = await postJson('/api/snippets', { language: 'js', code: 'x'.repeat(200 * 1024 + 1) });
  assert.strictEqual(big.status, 400);
});

test('详情返回 AST 高亮 HTML（至少 5 种语言）', async () => {
  const langs = {
    javascript: 'const f = (a) => a+1;',
    python: 'def f(): return 1',
    go: 'package main\nfunc f() {}',
    rust: 'fn f() -> i32 { 1 }',
    java: 'class A { int x = 1; }',
    c: 'int f(void) { return 0; }',
    bash: 'echo hi',
    typescript: 'const x: number = 1;'
  };
  let classified = 0;
  for (const [language, code] of Object.entries(langs)) {
    const created = await postJson('/api/snippets', { title: language, language, code });
    const detail = await getJson(`/api/snippets/${created.body.id}`);
    assert.strictEqual(detail.status, 200);
    assert.strictEqual(detail.body.parsed_language, language);
    if (/ts-(keyword|string|comment|function|literal|type)/.test(detail.body.code_html)) classified++;
  }
  assert.ok(classified >= 5, `仅 ${classified} 种语言产生高亮`);
});

test('普通 / 模糊 / 正则搜索', async () => {
  await postJson('/api/snippets', {
    title: 'helloWorld util', language: 'javascript',
    code: 'function helloWorld(){ return 42; }', tags: 'util'
  });

  const plain = await getJson('/api/snippets/search?q=helloworld&mode=plain');
  assert.ok(plain.body.items.some((i) => i.title === 'helloWorld util'));

  const fuzzy = await getJson('/api/snippets/search?q=hwo&mode=fuzzy');
  assert.ok(fuzzy.body.items.some((i) => i.title === 'helloWorld util'));

  const regex = await getJson('/api/snippets/search?mode=regex&q=' + encodeURIComponent('function\\s+\\w+'));
  assert.ok(regex.body.items.some((i) => i.title === 'helloWorld util'));

  const badRegex = await getJson('/api/snippets/search?mode=regex&q=' + encodeURIComponent('['));
  assert.strictEqual(badRegex.status, 400);
});

test('正则搜索限定字段', async () => {
  const r = await getJson('/api/snippets/search?mode=regex&q=' + encodeURIComponent('util') + '&fields=title');
  assert.ok(r.body.items.length >= 1);
  assert.ok(r.body.items.every((i) => i.matched_fields.includes('title')));
});

test('阅后即焚：查看一次后删除', async () => {
  const created = await postJson('/api/snippets', { language: 'go', code: 'package main', burn_after_read: true });
  assert.strictEqual(created.status, 201);
  const first = await getJson(`/api/snippets/${created.body.id}`);
  assert.strictEqual(first.status, 200);
  const second = await getJson(`/api/snippets/${created.body.id}`);
  assert.strictEqual(second.status, 404);
});

test('过期片段不可见', async () => {
  const created = await postJson('/api/snippets', {
    language: 'rust', code: 'fn main()', expires_in_seconds: 1
  });
  await new Promise((r) => setTimeout(r, 1100));
  const res = await getJson(`/api/snippets/${created.body.id}`);
  assert.strictEqual(res.status, 404);
});

test('更新与删除', async () => {
  const created = await postJson('/api/snippets', { title: 'old', language: 'js', code: 'var a=1' });
  const id = created.body.id;
  const upd = await fetch(base + '/api/snippets/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'new title' })
  });
  assert.strictEqual(upd.status, 200);
  assert.strictEqual((await upd.json()).title, 'new title');

  const del = await fetch(base + '/api/snippets/' + id, { method: 'DELETE' });
  assert.strictEqual(del.status, 204);
  const gone = await getJson(`/api/snippets/${id}`);
  assert.strictEqual(gone.status, 404);
});

test('限流中间件：滑动窗口超额返回 429', () => {
  const { rateLimit } = require('../src/middleware/rateLimit');
  const mw = rateLimit({ windowMs: 1000, max: 3, prefix: 'unit-rl' });
  const req = { ip: '10.0.0.99', headers: {}, socket: {} };
  const statuses = [];
  let lastRetryAfter = null;
  for (let i = 0; i < 5; i++) {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      json() {}
    };
    mw(req, res, (err) => {
      if (err) statuses.push(err.statusCode);
      else statuses.push(200);
      if (res.headers['Retry-After']) lastRetryAfter = res.headers['Retry-After'];
    });
  }
  assert.deepStrictEqual(statuses, [200, 200, 200, 429, 429]);
  assert.ok(lastRetryAfter, '429 响应应带 Retry-After 头');
});

test('限流中间件：窗口滑动后恢复放行', async () => {
  const { rateLimit } = require('../src/middleware/rateLimit');
  const mw = rateLimit({ windowMs: 60, max: 2, prefix: 'unit-rl2' });
  const req = { ip: '10.0.0.100', headers: {}, socket: {} };
  const run = () => new Promise((resolve) => {
    const res = { setHeader() {}, status() { return this; }, json() {} };
    mw(req, res, (err) => resolve(err ? err.statusCode : 200));
  });
  assert.strictEqual(await run(), 200);
  assert.strictEqual(await run(), 200);
  assert.strictEqual(await run(), 429);
  await new Promise((r) => setTimeout(r, 1100));
  assert.strictEqual(await run(), 200);
});
