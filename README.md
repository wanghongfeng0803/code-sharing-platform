# CodeShare · 代码分享平台

基于 **Node.js + Express + SQLite** 的轻量代码片段分享平台。服务端使用 **Tree-sitter（WASM）AST 语法解析**对代码做真正的语法分析后高亮，搜索同时支持**普通匹配 / 正则匹配 / 模糊匹配**，并内置滑动窗口**接口限流**防刷。

## 功能特性

- **片段管理**：创建、查看、更新、删除代码片段；支持标题、描述、标签、语言归类
- **AST 级语法高亮**：使用 web-tree-sitter 解析语法树（非正则猜测），覆盖 **12 种语言**
  - JavaScript、TypeScript、Python、Go、Rust、Java、C/C++、Bash、JSON、HTML、CSS、Ruby
  - 语言别名自动识别（如 `js`→JavaScript、`py`→Python、`sh`→Bash、`cpp`→C/C++）
  - 语法树解析失败（代码有语法错误）时安全降级为纯文本，不影响展示
  - 模板字符串插值（如 JS `` `${x}` ``）内部仍正常高亮
- **三种搜索模式**
  - `plain`：大小写不敏感子串匹配
  - `regex`：服务端执行用户正则（可指定 `i`/`s` flag），非法正则返回 400；带长度限制与 ReDoS 缓解
  - `fuzzy`：fzf 风格子序列模糊匹配，按边界/连续/前缀奖励打分排序，例如 `hwo` 可命中 `helloWorld`
  - 可限定搜索字段（`title`/`description`/`tags`/`language`/`code`）、语言与标签过滤
- **接口限流**：内存滑动窗口，按客户端 IP 分桶
  - 全局 240 次/分钟；创建片段 20 次/分钟；搜索 60 次/分钟
  - 超限返回 `429` 与 `Retry-After`、`X-RateLimit-*` 响应头
- **阅后即焚**：片段仅允许查看一次，查看后立即删除
- **定时过期**：可为片段设置 TTL，过期自动 404 并由后台定时清理
- **单页前端**：零依赖原生 HTML/CSS/JS，暗色主题，含列表、搜索、新建、详情、复制、Raw 视图
- **持久化**：SQLite（better-sqlite3，同步驱动、WAL 模式），单文件数据库，零外部服务依赖

## 目录结构

```
code-sharing-platform-B/
├── server.js                 # 启动入口
├── src/
│   ├── app.js                # Express 应用 / 中间件装配 / 错误处理 / 定时清理
│   ├── config.js             # 端口、数据库路径、限流等配置（支持环境变量）
│   ├── db.js                 # SQLite 初始化与预编译语句
│   ├── id.js                 # Base62 随机短 ID
│   ├── validate.js           # 入参校验
│   ├── highlighter.js        # Tree-sitter AST 解析 + 语法高亮（核心）
│   ├── search.js             # 普通 / 正则 / 模糊搜索引擎
│   ├── middleware/
│   │   └── rateLimit.js      # 滑动窗口限流器
│   └── routes/
│       └── snippets.js       # /api/snippets REST 路由
├── public/                   # 前端静态资源（SPA）
│   ├── index.html
│   ├── css/style.css         # 含高亮配色主题
│   └── js/app.js
├── test/api.test.js          # Node 内置 test runner 的接口/单元测试
└── data/snippets.db         # 运行后自动生成（已 gitignore）
```

## 快速开始

要求 Node.js ≥ 18（使用内置 `fetch` 与 `node:test`）。

```bash
npm install
npm start
# 代码分享平台已启动: http://0.0.0.0:3000
```

开发模式（文件变更自动重启）：

```bash
npm run dev
```

运行测试：

```bash
npm test
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DB_PATH` | `data/snippets.db` | SQLite 数据库文件路径 |
| `WASM_DIR` | `node_modules/tree-sitter-wasms/out` | Tree-sitter 语言 WASM 目录 |
| `RL_GLOBAL_MAX` | `240` | 全局每分钟请求上限（测试可调） |
| `RL_CREATE_MAX` | `20` | 创建片段每分钟上限 |
| `RL_SEARCH_MAX` | `60` | 搜索每分钟上限 |

## API 一览

Base URL：`/api`

### 语言

```
GET /api/snippets/languages
```

### 片段 CRUD

```
POST   /api/snippets             # 创建，201 返回片段
GET    /api/snippets?page=1&page_size=20&language=python
GET    /api/snippets/:id         # 详情，含 code_html（服务端高亮结果）
GET    /api/snippets/:id?raw=1   # 纯文本源码（text/plain）
PUT    /api/snippets/:id         # 局部更新（只传需要改的字段）
DELETE /api/snippets/:id         # 删除，204
```

`POST` / `PUT` 请求体：

```json
{
  "title": "快速排序",
  "description": "可选描述，最长 500 字",
  "code": "def qs(a):\n    ...",
  "language": "python",
  "tags": ["算法", "排序"],
  "expires_in_seconds": 3600,
  "burn_after_read": false
}
```

约束：`code` 必填且 ≤ 200 KB；`title` ≤ 200；`tags` ≤ 10 个、单个 ≤ 30 字符；`language` 必须是受支持语言或其别名；非法请求返回 400 与错误详情。

### 搜索

```
GET /api/snippets/search?q=关键字&mode=plain&fields=title,code&language=python&tag=算法&page=1
```

| 参数 | 说明 |
| --- | --- |
| `q` | 查询串（≤ 200 字符）；普通模式可空（等同列表） |
| `mode` | `plain`（默认）/ `regex` / `fuzzy` |
| `fields` | 逗号分隔，限定 `title,description,tags,language,code` |
| `regex_flags` | 正则附加 flag，目前支持 `i`（忽略大小写）、`s`（dotAll） |
| `language` | 仅搜索指定语言 |
| `tag` | 仅搜索含指定标签的片段 |
| `page` | 页码，每页 20 条 |

示例：

```bash
# 正则：找出代码里所有函数定义
curl 'http://localhost:3000/api/snippets/search?mode=regex&q=function%20%5Cs%2B%5Cw%2B&fields=code'

# 模糊：输入 hwo 命中 helloWorld
curl 'http://localhost:3000/api/snippets/search?mode=fuzzy&q=hwo'
```

响应中的 `score` 为相关度分数（模糊模式），`matched_fields` 表示命中的字段。

### 其他

```
GET /health        # 健康检查
```

## 语法高亮实现原理

`src/highlighter.js` 启动时通过 `web-tree-sitter` 加载 `tree-sitter-wasms` 中各语言预编译的 WASM 语法，按需懒加载、解析后缓存 Parser。

1. 对源码调用 `parser.parse(code)` 得到完整**具体语法树（CST/AST）**；
2. 以显式帧栈深度优先遍历每个叶子 token，结合 **节点类型 + 父节点类型 + 字段名（`fieldNameForChild`）** 判定其作用域：
   `keyword / string / comment / literal / function / type / property / tag / attr / selector / meta`；
3. 对 token 文本做 HTML 转义并包上 `<span class="ts-*">`，前端 `public/css/style.css` 中的 `.ts-*` 规则负责配色；
4. 字符串节点整体着色，模板字符串内的插值节点（如 `template_substitution`）恢复正常解析；
5. 任何解析异常或过深子树均回退为转义纯文本，保证永不因高亮失败而影响接口。

## 限流策略

`src/middleware/rateLimit.js` 为每个 IP 维护一个滑动时间戳数组（O(n) 淘汰过期项），周期性清理空桶。超出阈值立即短路返回：

```
HTTP/1.1 429 Too Many Requests
Retry-After: 24
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 0
```

- 全局桶覆盖所有路由；`POST /api/snippets` 与 `GET /api/snippets/search` 另有更严格的独立桶；
- 反向代理后取 `X-Forwarded-For` 首段作为客户端 IP（`trust proxy` 已开启）；
- 纯内存实现，适合单实例部署；多实例需替换为 Redis 版（接口签名保持一致即可）。

## 设计说明与边界

- 搜索引擎直接扫描可见片段的冗余字段（`search_text`），适合中小规模自托管场景；如需海量数据可扩展为 SQLite FTS5 表 + 触发器，正则/模糊仍在应用层执行。
- 阅后即焚与过期片段不会出现在列表/搜索结果中。
- 正则在服务端执行，已做长度限制；不可信正则理论上仍可能消耗 CPU，生产环境建议前置 WAF 或进一步加执行超时。
- 更新/删除当前不鉴权（贴片段设计为持链接即可访问），需要时可在 `PUT/DELETE` 上叠加 token 中间件。

## License

MIT
