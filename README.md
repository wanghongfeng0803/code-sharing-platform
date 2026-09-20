# 代码分享平台

基于 **Node.js + Express + SQLite** 的代码片段分享平台。服务端通过 tree-sitter（WASM）做 **AST 级别语法高亮**，内置 **精确 / 模糊 / 正则**三种搜索模式，并对 API 做了**分级接口限流**与 ReDoS 防护。

## 功能特性

- **代码分享**：标题、作者、语言、简介、标签、代码内容，服务端参数校验（长度、语言、标签数量）。
- **AST 语法高亮**：使用 `web-tree-sitter` 将源码解析为具体语法树，再按节点类型（函数、关键字、字符串、注释、类型等）着色；非正则词法猜测。内置 **15 种语言**语法（JavaScript、TypeScript、TSX、Python、Java、C、C++、Go、Rust、JSON、HTML、CSS、PHP、C#、Bash），纯文本自动降级。
- **三种搜索模式**：
  - `plain` 精确子串：大小写不敏感的子串匹配（标题/作者/描述/标签/正文）。
  - `fuzzy` 模糊匹配：基于 Fuse.js，容忍拼写误差与乱序，字段加权（标题权重最高），按相关度评分排序。
  - `regex` 正则表达式：完整 JS 正则语法，返回命中字段与上下文摘要；在独立 **Worker 线程**中执行，带超时熔断，防止灾难性回溯（ReDoS）阻塞事件循环。
- **接口限流**：基于 `express-rate-limit` 的分级策略（创建 10 次/分、搜索 30 次/分、通用 API 120 次/分、页面 240 次/分），超限返回 429。
- **安全**：Helmet 安全响应头（含 CSP）、所有用户输入经 HTML 转义、请求体大小限制、正则执行沙箱隔离 + 超时。
- **浏览量统计、原文查看、一键复制、分页、按语言过滤、区分大小写（正则）**。
- 同时提供 **服务端渲染页面**（无 JS 也可浏览/搜索）和 **RESTful JSON API**。

## 技术栈

| 关注点 | 选型 |
| --- | --- |
| 运行时 / 框架 | Node.js ≥ 18、Express 5 |
| 数据库 | SQLite（`better-sqlite3`，同步 API，WAL 模式） |
| AST 解析 | `web-tree-sitter` + `tree-sitter-wasms`（预编译语法 WASM，免本地编译） |
| 模糊搜索 | `fuse.js` |
| 限流 | `express-rate-limit` |
| 安全 | `helmet` |
| 视图 | EJS（服务端渲染）+ 原生 JS 前端 |

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2.（可选）写入示例数据
npm run seed

# 3. 启动服务
npm start          # 生产方式
npm run dev        # 开发方式（文件改动自动重启）
```

打开浏览器访问 <http://localhost:3000>。

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `NODE_ENV` | `development` | 运行环境 |
| `DB_FILE` | `data/snippets.db` | SQLite 数据库文件路径 |
| `TREE_SITTER_WASM_DIR` | `node_modules/tree-sitter-wasms/out` | tree-sitter 语法 WASM 目录 |

## 目录结构

```
code-sharing-platform-A/
├── server.js                  # 应用入口：中间件装配、启动
├── scripts/
│   └── seed.js                # 示例数据种子脚本
├── src/
│   ├── config.js              # 全局配置（端口、限流、长度上限等）
│   ├── db.js                  # SQLite 连接、表结构、数据访问
│   ├── languages.js           # 语言注册表（id/标签/wasm/扩展名）
│   ├── highlighter.js         # AST 解析 → 高亮 HTML
│   ├── search.js              # 精确 / 模糊 / 正则搜索服务
│   ├── middleware/
│   │   ├── rate-limiters.js   # 分级限流器
│   │   ├── validate.js        # 片段参数校验
│   │   └── errors.js          # 404 / 错误处理
│   ├── workers/
│   │   └── regex-worker.js    # 正则搜索 Worker（超时熔断）
│   └── routes/
│       ├── api.js             # RESTful JSON API
│       └── pages.js           # SSR 页面路由
├── views/                     # EJS 模板
│   ├── index.ejs              # 首页 / 列表 / 搜索结果
│   ├── new.ejs                # 发布表单
│   ├── snippet.ejs            # 详情（高亮展示）
│   └── partials/              # 页头页脚
├── public/
│   ├── css/style.css          # 界面与高亮配色
│   └── js/app.js              # 前端交互（fetch 提交、复制）
└── docs/
    └── API.md                 # API 接口文档
```

## API 概览

| 方法 | 路径 | 说明 | 限流 |
| --- | --- | --- | --- |
| GET | `/api/languages` | 支持的语言列表 | 120/分 |
| GET | `/api/snippets` | 分页列表（`page`、`pageSize`） | 120/分 |
| POST | `/api/snippets` | 创建代码片段 | **10/分** |
| GET | `/api/snippets/:id` | 片段详情（累计浏览量） | 120/分 |
| GET | `/api/snippets/:id/raw` | 原始代码文本 | 120/分 |
| GET | `/api/search` | 搜索（`q`、`mode=plain|fuzzy|regex`、`language`、`sensitive`） | **30/分** |

完整请求 / 响应示例见 [docs/API.md](docs/API.md)。

## 搜索使用示例

```bash
# 精确子串（正文也参与匹配）
curl "http://localhost:3000/api/search?q=quicksort&mode=plain"

# 模糊匹配（拼错也能搜到 quicksort）
curl "http://localhost:3000/api/search?q=quicsort&mode=fuzzy"

# 正则：匹配 fn 后跟空白再跟 main，只搜 Rust
curl "http://localhost:3000/api/search?mode=regex&q=fn%5Cs%2Bmain&language=rust"

# 正则区分大小写
curl "http://localhost:3000/api/search?mode=regex&q=Foo&sensitive=true"
```

## AST 高亮原理

1. `web-tree-sitter` 在启动时初始化，每种语言的 WASM 语法按需加载并缓存（单例 Parser）。
2. 对源码执行增量无关的完整解析，得到具体语法树（CST）。
3. 深度优先收集全部叶子节点（token），依据 **节点是否命名、节点类型、父节点/祖父节点类型及字段名** 映射到高亮类别：
   - `function_definition` / `function_item` 等的 `name` 字段 → 函数名；
   - `call_expression` 中的被调用方 → 函数调用；
   - `type_identifier` / `primitive_type` → 类型；`string`/`comment`/`number`/关键字等各归其类。
4. 叶子之间的间隙（空白、异常节点）原样补齐，所有文本统一 HTML 转义，输出 `<span class="tok-*">` 包裹的代码块。
5. 语法树中出现 `ERROR` / 缺失节点时以 `tok-invalid` 波浪下划线标出（容错而不崩溃）。

> 说明：高亮基于语法节点结构而非关键字表，因此相同单词在不同语法位置会得到不同着色（如 `foo` 作为定义 / 调用 / 变量时颜色不同）。

## ReDoS 防护说明

- 正则搜索在独立 Worker 线程执行，主事件循环不会被回溯阻塞。
- Worker 端对每行扫描设 800ms 预算；主线程对整个任务设 2500ms 硬超时，超时后 `terminate()` 线程并返回 400。
- 单字段最多扫描 5000 字符、单条最多返回 3 个命中、全局最多 200 个命中，结果截断时显式标记 `truncated`。
- 非法正则返回明确错误信息；正则长度上限 500 字符。

## 页面使用

- `/` 首页：最新代码列表、分页、搜索框（三种模式 + 语言过滤）。
- `/new` 发布代码：表单经前端 fetch 提交到 API，失败时展示服务端校验信息。
- `/snippets/:id` 详情：AST 高亮、标签、浏览量、复制代码、查看原文。
- `/snippets/:id/raw` 原始文本。
- `/search` 服务端渲染搜索结果（正则模式展示命中字段与上下文摘要）。

## 开发说明

- 无需编译工具链：tree-sitter 语言运行在 WASM 上。新增语言只需把对应 `tree-sitter-*.wasm` 放入 WASM 目录并在 `src/languages.js` 注册。
- 数据文件默认位于 `data/`（已在 `.gitignore` 中忽略），删除后重启会自动建表。
- 限流为进程内计数（默认内存存储），多实例部署时建议替换为 Redis store。

## License

MIT
