(function () {
  'use strict';

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString('zh-CN');
  }

  const snippetForm = document.getElementById('snippet-form');
  if (snippetForm) {
    snippetForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      const message = document.getElementById('form-message');
      message.textContent = '发布中…';
      message.className = 'form-message';

      const payload = {
        title: document.getElementById('title').value.trim(),
        author: document.getElementById('author').value.trim(),
        language: document.getElementById('language').value,
        description: document.getElementById('description').value.trim(),
        tags: document.getElementById('tags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean),
        content: document.getElementById('content').value,
      };

      try {
        const response = await fetch('/api/snippets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (response.status === 201) {
          window.location.href = '/snippets/' + data.id;
          return;
        }
        const text = data.details ? data.details.join('；') : data.error || '发布失败';
        message.textContent = text;
        message.className = 'form-message err';
      } catch (err) {
        message.textContent = '网络错误，请稍后重试';
        message.className = 'form-message err';
      }
    });

    const contentInput = document.getElementById('content');
    contentInput.addEventListener('keydown', function (event) {
      if (event.key === 'Tab') {
        event.preventDefault();
        const start = this.selectionStart;
        const end = this.selectionEnd;
        this.value = this.value.slice(0, start) + '  ' + this.value.slice(end);
        this.selectionStart = this.selectionEnd = start + 2;
      }
    });
  }

  const copyBtn = document.getElementById('copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async function () {
      try {
        const response = await fetch('/snippets/' + this.dataset.id + '/raw');
        const text = await response.text();
        await navigator.clipboard.writeText(text);
        const original = this.textContent;
        this.textContent = '已复制 ✓';
        setTimeout(() => { this.textContent = original; }, 1500);
      } catch (err) {
        this.textContent = '复制失败';
      }
    });
  }

  const searchForm = document.getElementById('search-form');
  if (searchForm) {
    const modeSelect = document.getElementById('search-mode');
    const caseToggle = searchForm.querySelector('.case-toggle');

    function syncCaseToggle() {
      caseToggle.style.opacity = modeSelect.value === 'regex' ? '1' : '0.45';
    }
    modeSelect.addEventListener('change', syncCaseToggle);
    syncCaseToggle();

    searchForm.addEventListener('submit', function (event) {
      const input = document.getElementById('search-input');
      if (!input.value.trim()) {
        event.preventDefault();
        input.focus();
      }
    });
  }
})();
