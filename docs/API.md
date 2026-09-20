# API 接口文档

基础地址：`http://localhost:3000`

所有请求 / 响应均使用 UTF-8 编码；`POST` 请求体为 `application/json`。
错误响应统一为：`{ "error": "错误信息" }`，参数校验失败额外包含 `details` 数组。
限流响应 HTTP 状态码为 `429`，并携带标准限流响应头 `RateLimit-*`。

## 数据模型

Snippet（代码片段）：

```json
{
  "id": "vmpAObE2NY-M",
  "title": "快速排序（Python 实现）",
  "author": "alice",
  "language": "python",
  "content": "def quicksort(arr): ...",
  "description": "经典分治算法",
  "tags": ["算法", "排序", "python"],
  "views": 12,
  "createdAt": "2026-09-20T16:41:03.304Z",
  "updatedAt": "2026-09-20T16:41:03.304Z"
}
```

字段约束：

| 字段 | 规则 |
| --- | --- |
| `title` | 必填，1–200 字符 |
| `author` | 可选（默认「匿名」），≤80 字符 |
| `language` | 必须是平台支持的语言 id（默认 `plaintext`） |
| `content` | 必填，1–100,000 字符 |
| `description` | 可选，≤500 字符 |
| `tags` | 字符串数组，≤10 个标签，单个 ≤30 字符（自动去重、转小写） |

## GET /api/languages

返回平台支持的全部语言。

```bash
curl http://localhost:3000/api/languages
```

```json
{
  "languages": [
    { "id": "javascript", "label": "JavaScript" },
    { "id": "typescript", "label": "TypeScript" },
    { "id": "python", "label": "Python" }
  ]
}
```

## GET /api/snippets

分页获取最新代码片段。

查询参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `page` | 1 | 页码，从 1 开始 |
| `pageSize` | 20 | 每页条数，最大 100 |

```bash
curl "http://localhost:3000/api/snippets?page=1&pageSize=20"
```

响应：

```json
{
  "items": [ { "id": "...", "title": "..." } ],
  "total": 8,
  "page": 1,
  "pageSize": 20,
  "totalPages": 1
}
```

## POST /api/snippets

创建代码片段。限流：**10 次 / 分钟 / IP**。请求体上限 300KB。

```bash
curl -X POST http://localhost:3000/api/snippets \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "二分查找",
    "author": "carol",
    "language": "c",
    "description": "迭代版二分查找",
    "tags": ["算法", "查找"],
    "content": "int binary_search(...) { ... }"
  }'
```

成功返回 `201` 与创建后的 Snippet 对象。

校验失败返回 `422`：

```json
{
  "error": "参数校验失败",
  "details": ["标题不能为空", "代码内容不能为空", "不支持的语言：brainfuck"]
}
```

## GET /api/snippets/:id

获取单个片段完整内容，**每次访问浏览量 +1**。不存在返回 `404`。

```bash
curl http://localhost:3000/api/snippets/vmpAObE2NY-M
```

## GET /api/snippets/:id/raw

以 `text/plain` 返回未经渲染的原始代码（供复制 / 下载）。

```bash
curl http://localhost:3000/api/snippets/vmpAObE2NY-M/raw
```

## GET /api/search

搜索代码片段。限流：**30 次 / 分钟 / IP**。按 `created_at` 倒序扫描最新 1000 条。

查询参数：

| 参数 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `q` | 是 | – | 关键词 / 正则源码，≤500 字符 |
| `mode` | 否 | `plain` | `plain`（精确子串）、`fuzzy`（模糊）、`regex`（正则） |
| `language` | 否 | 全部 | 仅搜索指定语言 id |
| `sensitive` | 否 | `false` | 正则模式是否区分大小写 |

### 精确子串 plain

大小写不敏感，匹配标题、作者、描述、标签及正文（正文最多扫描前 5000 字符）。

```bash
curl "http://localhost:3000/api/search?q=quicksort&mode=plain"
```

### 模糊匹配 fuzzy

基于 Fuse.js 的加权模糊匹配（标题 0.35、描述 0.2、正文 0.2、标签 0.15、作者 0.1），
容忍拼写误差。`score` 越小越相关。

```bash
curl "http://localhost:3000/api/search?q=quicsort&mode=fuzzy"
```

响应片段中带 `score` 字段。

### 正则 regex

完整 JavaScript 正则语法，在独立 Worker 线程执行。命中结果包含每个命中的
字段名、命中文本、字符偏移和上下文摘要。

```bash
curl "http://localhost:3000/api/search?mode=regex&q=fn%5Cs%2Bmain&language=rust"
```

```json
{
  "items": [
    {
      "id": "...",
      "title": "Rust 读取文件并统计行数",
      "language": "rust",
      "matches": [
        {
          "field": "content",
          "match": "fn main",
          "index": 180,
          "excerpt": "…read_to_string(path)?; … fn main() { match…"
        }
      ]
    }
  ],
  "mode": "regex",
  "scanned": 8,
  "truncated": false
}
```

异常情况：

- 非法正则 → `400 { "error": "无效的正则表达式：…" }`
- 执行超过 2500ms（疑似灾难性回溯）→ `400 { "error": "正则表达式执行超时，可能存在灾难性回溯，请简化表达式" }`
- 命中过多被截断时 `truncated: true`

## 限流策略汇总

| 范围 | 窗口 | 上限 | 超限响应 |
| --- | --- | --- | --- |
| 全部 `/api/*`（兜底） | 60s | 120 | 429 JSON |
| `POST /api/snippets` | 60s | 10 | 429 JSON |
| `GET /api/search` | 60s | 30 | 429 JSON |
| 页面路由 | 60s | 240 | 429 HTML |

## 状态码

| 状态码 | 含义 |
| --- | --- |
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 请求参数错误（含正则非法 / 超时） |
| 404 | 资源不存在 |
| 422 | 参数校验失败 |
| 429 | 触发限流 |
| 500 | 服务器内部错误 |
