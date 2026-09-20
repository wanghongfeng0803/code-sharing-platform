'use strict';

const app = document.getElementById('app');
const LANG_LABELS = {
  javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', go: 'Go',
  rust: 'Rust', java: 'Java', c: 'C/C++', bash: 'Bash', json: 'JSON',
  html: 'HTML', css: 'CSS', ruby: 'Ruby'
};

const state = {
  mode: 'plain',
  q: '',
  page: 1
};

// ---------- 工具 ----------
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function toast(message, type = '') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `请求失败 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function formatDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function langLabel(lang) {
  return LANG_LABELS[lang] || lang;
}

// ---------- 路由 ----------
function router() {
  const hash = location.hash.replace(/^#/, '') || '/';
  if (hash === '/' || hash === '') return renderHome();
  if (hash === '/new') return renderNew();
  const m = hash.match(/^\/snippet\/([A-Za-z0-9]+)$/);
  if (m) return renderDetail(m[1]);
  return renderHome();
}
window.addEventListener('hashchange', router);

// ---------- 首页：搜索 + 列表 ----------
async function renderHome() {
  app.innerHTML = `
    <section class="search-bar">
      <input type="text" id="q" placeholder="搜索代码片段：标题 / 描述 / 标签 / 代码内容…" value="${escapeHtml(state.q)}" />
      <div class="mode-tabs" id="modeTabs">
        <button data-mode="plain" class="${state.mode === 'plain' ? 'active' : ''}">普通</button>
        <button data-mode="fuzzy" class="${state.mode === 'fuzzy' ? 'active' : ''}">模糊</button>
        <button data-mode="regex" class="${state.mode === 'regex' ? 'active' : ''}">正则</button>
      </div>
      <select id="langFilter">
        <option value="">全部语言</option>
        ${Object.entries(LANG_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
      <select id="fieldFilter">
        <option value="">全部字段</option>
        <option value="title">标题</option>
        <option value="description">描述</option>
        <option value="tags">标签</option>
        <option value="code">代码</option>
      </select>
    </section>
    <p class="search-hint" id="searchHint"></p>
    <div id="listWrap"><div class="empty">加载中…</div></div>
  `;

  const qInput = document.getElementById('q');
  const langFilter = document.getElementById('langFilter');
  const fieldFilter = document.getElementById('fieldFilter');
  const modeTabs = document.getElementById('modeTabs');
  const hint = document.getElementById('searchHint');

  const updateHint = () => {
    if (state.mode === 'regex') hint.textContent = '正则模式：输入 JavaScript 正则表达式，例如 \\bfunction\\s+\\w+ 或 console\\.(log|error)';
    else if (state.mode === 'fuzzy') hint.textContent = '模糊模式：按字符顺序匹配（类似 fzf），例如输入 hwo 可匹配 helloWorld';
    else hint.textContent = '普通模式：大小写不敏感的子串匹配';
  };
  updateHint();

  let debounce;
  const load = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => doSearch(), 200);
  };

  qInput.addEventListener('input', () => { state.q = qInput.value; state.page = 1; load(); });
  langFilter.addEventListener('change', load);
  fieldFilter.addEventListener('change', load);
  modeTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.mode = btn.dataset.mode;
    modeTabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    updateHint();
    load();
  });

  await doSearch();
  qInput.focus();
}

async function doSearch() {
  const wrap = document.getElementById('listWrap');
  const langFilter = document.getElementById('langFilter');
  const fieldFilter = document.getElementById('fieldFilter');
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  params.set('mode', state.mode);
  params.set('page', state.page);
  if (langFilter && langFilter.value) params.set('language', langFilter.value);
  if (fieldFilter && fieldFilter.value) params.set('fields', fieldFilter.value);

  try {
    const data = state.q
      ? await api(`/api/snippets/search?${params}`)
      : await api(`/api/snippets?page=${state.page}${langFilter && langFilter.value ? `&language=${langFilter.value}` : ''}`);
    renderList(data);
  } catch (err) {
    wrap.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

function renderList(data) {
  const wrap = document.getElementById('listWrap');
  const items = data.items || [];
  if (!items.length) {
    wrap.innerHTML = `<div class="empty">没有匹配的片段，<a href="#/new">去新建一个</a></div>`;
    return;
  }
  const cards = items.map((s) => `
    <a class="snippet-card" href="#/snippet/${s.id}">
      <h3>${escapeHtml(s.title || '未命名片段')}
        ${s.matched_fields ? `<span class="badge" style="margin-left:8px">${s.matched_fields.join(', ')}</span>` : ''}
      </h3>
      ${s.description ? `<p>${escapeHtml(s.description)}</p>` : ''}
      <div class="meta">
        <span class="badge lang">${langLabel(s.language)}</span>
        ${(s.tags || []).map((t) => `<span class="badge">#${escapeHtml(t)}</span>`).join('')}
        <span>👁 ${s.views_count || 0}</span>
        <span>${formatDate(s.created_at)}</span>
      </div>
    </a>`).join('');

  const totalPages = data.total_pages || 1;
  const pager = totalPages > 1 ? `
    <div class="pagination">
      <button class="btn btn-small" ${state.page <= 1 ? 'disabled' : ''} id="prevPage">上一页</button>
      <span>第 ${state.page} / ${totalPages} 页（共 ${data.total} 条）</span>
      <button class="btn btn-small" ${state.page >= totalPages ? 'disabled' : ''} id="nextPage">下一页</button>
    </div>` : '';

  wrap.innerHTML = `<div class="snippet-list">${cards}</div>${pager}`;
  const prev = document.getElementById('prevPage');
  const next = document.getElementById('nextPage');
  if (prev) prev.addEventListener('click', () => { state.page--; doSearch(); });
  if (next) next.addEventListener('click', () => { state.page++; doSearch(); });
}

// ---------- 新建 ----------
async function renderNew() {
  let languages = [];
  try {
    languages = (await api('/api/snippets/languages')).languages;
  } catch (_) { languages = Object.keys(LANG_LABELS); }

  app.innerHTML = `
    <h2 style="margin-top:0">新建代码片段</h2>
    <form id="snippetForm">
      <div class="field">
        <label for="title">标题</label>
        <input type="text" id="title" maxlength="200" placeholder="给片段起个名字（可选）" />
      </div>
      <div class="row">
        <div class="field">
          <label for="language">语言</label>
          <select id="language">
            ${languages.map((l) => `<option value="${l}">${langLabel(l)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="tags">标签（逗号分隔）</label>
          <input type="text" id="tags" placeholder="例如：算法, 工具脚本" />
        </div>
        <div class="field">
          <label for="expires">有效期（秒，留空永久）</label>
          <input type="number" id="expires" min="1" placeholder="如 3600" />
        </div>
        <div class="field" style="flex:0 0 auto">
          <label for="burn">阅后即焚</label>
          <label style="margin:10px 0 0; color: var(--text)"><input type="checkbox" id="burn" style="width:auto" /> 查看一次后删除</label>
        </div>
      </div>
      <div class="field">
        <label for="description">描述</label>
        <input type="text" id="description" maxlength="500" placeholder="简要说明（可选）" />
      </div>
      <div class="field">
        <label for="code">代码</label>
        <textarea id="code" rows="18" placeholder="粘贴代码…" required></textarea>
      </div>
      <div style="display:flex;gap:10px">
        <button type="submit" class="btn btn-primary">发布片段</button>
        <a href="#/" class="btn">取消</a>
      </div>
    </form>`;

  document.getElementById('snippetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      title: document.getElementById('title').value,
      description: document.getElementById('description').value,
      language: document.getElementById('language').value,
      tags: document.getElementById('tags').value,
      code: document.getElementById('code').value,
      burn_after_read: document.getElementById('burn').checked
    };
    const expires = document.getElementById('expires').value;
    if (expires) payload.expires_in_seconds = Number(expires);

    try {
      const created = await api('/api/snippets', { method: 'POST', body: JSON.stringify(payload) });
      toast('发布成功', 'ok');
      location.hash = `/snippet/${created.id}`;
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ---------- 详情 ----------
async function renderDetail(id) {
  app.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const s = await api(`/api/snippets/${encodeURIComponent(id)}`);
    app.innerHTML = `
      <div class="detail-head">
        <h1>${escapeHtml(s.title || '未命名片段')}</h1>
        <div class="meta">
          <span class="badge lang">${langLabel(s.language)}</span>
          <span>发布于 ${formatDate(s.created_at)}</span>
          <span>浏览 ${s.views_count} 次</span>
          ${s.expires_at ? `<span>⏱ ${formatDate(s.expires_at)} 过期</span>` : ''}
          ${s.burn_after ? '<span style="color:var(--danger)">🔥 阅后即焚（本次查看后已删除）</span>' : ''}
        </div>
        ${s.description ? `<p style="color:var(--text-dim); margin-top:12px">${escapeHtml(s.description)}</p>` : ''}
        <div class="tag-row" style="margin-top:10px">
          ${(s.tags || []).map((t) => `<span class="badge">#${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>
      <div class="code-block">
        <div class="code-toolbar">
          <span>${langLabel(s.language)}${s.parse_has_error ? ' · 语法存在错误（尽力高亮）' : ''}</span>
          <div style="display:flex;gap:8px">
            <button class="btn btn-small" id="copyBtn">复制代码</button>
            <a class="btn btn-small" href="/api/snippets/${s.id}?raw=1" target="_blank">Raw</a>
          </div>
        </div>
        <pre class="code"><code id="codeView"></code></pre>
      </div>
      <div style="display:flex;gap:10px;margin-top:14px">
        <a href="#/" class="btn">← 返回列表</a>
        <button class="btn btn-danger" id="deleteBtn">删除片段</button>
      </div>`;

    // 服务端渲染的高亮 HTML 是受信内容（经过 HTML 转义）
    document.getElementById('codeView').innerHTML = s.code_html;

    document.getElementById('copyBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(s.code);
        toast('已复制到剪贴板', 'ok');
      } catch (_) {
        toast('复制失败，请手动选择', 'error');
      }
    });
    document.getElementById('deleteBtn').addEventListener('click', async () => {
      if (!confirm('确定删除这个片段？')) return;
      try {
        await api(`/api/snippets/${s.id}`, { method: 'DELETE' });
        toast('已删除', 'ok');
        location.hash = '/';
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  } catch (err) {
    app.innerHTML = `<div class="empty">${escapeHtml(err.message)}<br/><br/><a href="#/" class="btn">返回首页</a></div>`;
  }
}

router();
