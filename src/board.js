// 看板：读取与管理右键保存的文本列表
const STORAGE_KEY_SELECTIONS = "savedSelections";

// 读取存储列表
const readList = async () => {
  const { [STORAGE_KEY_SELECTIONS]: list = [] } = await chrome.storage.local.get(
    STORAGE_KEY_SELECTIONS
  );
  return Array.isArray(list) ? list : [];
};

// 写入存储列表
const writeList = async (list) => {
  await chrome.storage.local.set({ [STORAGE_KEY_SELECTIONS]: list });
};

// 格式化时间
const formatTime = (ts) => {
  try {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch (e) {
    return String(ts || "");
  }
};

// 简单 HTML 转义，避免 XSS
const escapeHtml = (s) => {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// 规范化工具
const normalizeWord = (w) => (w || "").trim();
const normalizeSentences = (arr) => {
  const seen = new Set();
  const out = [];
  for (const s of arr || []) {
    const v = (s || "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  // 排序（不区分大小写，按字母）
  out.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  return out;
};

// 渲染表格
const render = async () => {
  const list = await readList();
  const q = (document.getElementById("search").value || "").trim().toLowerCase();
  const sort = (document.getElementById("sortSelect")?.value) || 'time_desc';
  const match = (s) => (s || "").toLowerCase().includes(q);
  let filtered = q
    ? list.filter((x) => match(x.word || x.text) || (x.sentences || []).some((t) => match(t)) || match(x.url) || match(x.title))
    : list;

  // 排序
  const getWord = (x) => (x.word || x.text || '').toLowerCase();
  if (sort === 'time_asc') filtered = filtered.sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
  else if (sort === 'time_desc') filtered = filtered.sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
  else if (sort === 'alpha_asc') filtered = filtered.sort((a,b) => getWord(a).localeCompare(getWord(b)));
  else if (sort === 'alpha_desc') filtered = filtered.sort((a,b) => getWord(b).localeCompare(getWord(a)));

  const tbody = document.getElementById("list");
  const empty = document.getElementById("empty");
  tbody.innerHTML = filtered
    .map((item) => {
      const url = item.url || "";
      let hostname = "";
      try { hostname = url ? new URL(url).hostname : ""; } catch (e) {}
      const word = item.word || item.text || "";
      const sentences = Array.isArray(item.sentences) ? item.sentences : [];
      const notes = item.notes || {}; // { sentenceIndex: markdown }
      return `
        <tr data-id="${item.id}">
          <td class="text word-cell">${escapeHtml(word)}</td>
          <td class="sentences">
            ${sentences
              .map((s, idx) => `
                <div class="sentence-row" data-idx="${idx}">
                  <div class="sentence${notes[idx] ? ' has-note' : ''}">${escapeHtml(s)}</div>
                  <button class="icon-btn sentence-delete" title="删除">✕</button>
                </div>
              `)
              .join("")}
            <div class="sentence-row add-row">
              <input class="input" placeholder="为该单词新增例句，回车保存" />
            </div>
          </td>
          <td>
            ${item.title ? `<div>${escapeHtml(item.title)}</div>` : ""}
            ${url ? `<div><a href="${escapeHtml(url)}" target="_blank">${escapeHtml(hostname || url)}</a></div>` : ""}
          </td>
          <td><span class="muted">${formatTime(item.createdAt)}</span></td>
          <td>
            <div class="row-actions">
              <button class="icon-btn copy" title="复制">⧉</button>
              <button class="icon-btn delete" title="删除">✕</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
  empty.style.display = filtered.length ? "none" : "block";
};

document.addEventListener("DOMContentLoaded", async () => {
  // 应用主题并监听切换
  const applyTheme = (value) => {
    const cls = `theme-${value}`;
    document.documentElement.classList.remove("theme-cyan", "theme-purple", "theme-pink", "theme-green", "theme-slate");
    document.documentElement.classList.add(cls);
  };
  {
    const { themePreset } = await chrome.storage.local.get("themePreset");
    applyTheme(themePreset || "cyan");
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.themePreset) {
      applyTheme(changes.themePreset.newValue || "cyan");
    }
  });

  await render();
  const searchEl = document.getElementById("search");
  if (searchEl) {
    searchEl.addEventListener("input", render);
    // 点击原生 clear 按钮（type=search 的 ×）会触发 search 事件
    searchEl.addEventListener("search", render);
    searchEl.addEventListener("change", render);
    searchEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") render();
    });
  }

  const sortEl = document.getElementById('sortSelect');
  if (sortEl) {
    // 读取上次选择
    const { vocabSort } = await chrome.storage.local.get('vocabSort');
    if (vocabSort) {
      sortEl.value = vocabSort;
      await render(); // 应用持久化排序到首次渲染
    }
    sortEl.addEventListener('change', async () => {
      await chrome.storage.local.set({ vocabSort: sortEl.value });
      render();
    });
  }

  document.getElementById("export").addEventListener("click", async () => {
    const list = await readList();
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vocabulary_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Modal helpers
  const show = (el) => (el.style.display = "flex");
  const hide = (el) => (el.style.display = "none");

  // 清空全部（Modal）
  const modalClear = document.getElementById("modalClear");
  const clearInput = document.getElementById("clearInput");
  document.getElementById("clearAll").addEventListener("click", () => {
    clearInput.value = "";
    show(modalClear);
    clearInput.focus();
  });
  document.getElementById("clearCancel").addEventListener("click", () => hide(modalClear));
  document.getElementById("clearConfirm").addEventListener("click", async () => {
    if (clearInput.value !== "清空") return;
    await writeList([]);
    await render();
    hide(modalClear);
  });

  // 移除添加弹窗逻辑（采用行内回车新增句子）
  // 新增单词（Modal）
  const modalAddWord = document.getElementById("modalAddWord");
  const addWordInput = document.getElementById("addWordInput");
  document.getElementById("addWordBtn").addEventListener("click", () => {
    addWordInput.value = "";
    show(modalAddWord);
    addWordInput.focus();
  });
  document.getElementById("addWordCancel").addEventListener("click", () => hide(modalAddWord));
  document.getElementById("addWordConfirm").addEventListener("click", async () => {
    const word = (addWordInput.value || "").trim();
    if (!word) return;
    const list = await readList();
    const exists = list.some(x => (x.word || x.text || "").toLowerCase() === word.toLowerCase());
    if (exists) { alert("单词已存在"); return; }
    const now = Date.now();
    const item = { id: `${now}-${Math.random().toString(36).slice(2, 8)}`, word, sentences: [], url: "", title: "", createdAt: now };
    await writeList([item, ...list]);
    await render();
    hide(modalAddWord);
  });

  document.getElementById("list").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const id = tr.getAttribute("data-id");
    let list = await readList();
    const item = list.find((x) => x.id === id);
    if (!item) return;

    // 删除单条造句
    if (btn.classList.contains("sentence-delete")) {
      const row = btn.closest(".sentence-row");
      const idx = Number(row?.getAttribute("data-idx"));
      if (!Number.isFinite(idx)) return;
      item.sentences = normalizeSentences((item.sentences || []).filter((_, i) => i !== idx));
      await writeList(list);
      await render();
      return;
    }

    // 在该条目下新增造句（使用同一行的 input）
    if (btn.classList.contains("sentence-add")) {
      const input = btn.closest(".sentence-row")?.querySelector("input");
      const val = (input?.value || "").trim();
      if (!val) return;
      item.sentences = normalizeSentences([val, ...(item.sentences || [])]).slice(0, 20);
      await writeList(list);
      await render();
      return;
    }

    if (btn.classList.contains("copy")) {
      try {
        const textToCopy = [item.word || item.text || "", ...(item.sentences || [])].filter(Boolean).join("\n");
        await navigator.clipboard.writeText(textToCopy);
        const prevText = btn.textContent;
        const prevTitle = btn.title;
        btn.textContent = "✓";
        btn.title = "已复制";
        btn.classList.add("copied");
        btn.disabled = true;
        setTimeout(() => {
          btn.disabled = false;
          btn.classList.remove("copied");
          btn.textContent = "⧉";
          btn.title = prevTitle || "复制";
        }, 1000);
      } catch (e) {
        alert("复制失败");
      }
      return;
    }

    if (btn.classList.contains("delete")) {
      if (!confirm("确认删除该条目？")) return;
      list = list.filter((x) => x.id !== id);
      await writeList(list);
      await render();
      return;
    }
  });

  // 句子输入框回车保存（事件委托）
  document.getElementById("list").addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const input = e.target.closest(".sentence-row input");
    if (!input) return;
    e.preventDefault();
    const tr = input.closest("tr[data-id]");
    if (!tr) return;
    const id = tr.getAttribute("data-id");
    let list = await readList();
    const item = list.find((x) => x.id === id);
    if (!item) return;
    const val = (input.value || "").trim();
    if (!val) return;
    item.sentences = normalizeSentences([val, ...(item.sentences || [])]).slice(0, 20);
    await writeList(list);
    await render();
  });

  // 右键句子：新增/编辑解析（Markdown）和点击查看
  const modalNote = document.getElementById("modalNote");
  const noteEditor = document.getElementById("noteEditor");
  const notePreview = document.getElementById("notePreview");
  const renderMarkdown = (md) => {
    // 极简 Markdown 渲染（支持粗体、斜体、行内/块代码、引用、链接、列表、标题）
    let html = (md || "").replace(/[&<>]/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
    html = html
      .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
      .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
      .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
      .replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/^\s*[-*]\s+(.+)$/gm, '<ul><li>$1</li></ul>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[(.+?)\]\((https?:[^\s)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      .replace(/\n\n+/g, '</p><p>');
    return `<p>${html}</p>`;
  };

  let currentNoteTarget = null; // { id, idx }

  const openNoteModal = (markdown) => {
    notePreview.style.display = 'none';
    noteEditor.style.display = '';
    noteEditor.value = markdown || '';
    show(modalNote);
    noteEditor.focus();
  };
  const closeNoteModal = () => { hide(modalNote); currentNoteTarget = null; };

  document.getElementById("noteCancel").addEventListener("click", closeNoteModal);
  document.getElementById("noteView").addEventListener("click", () => {
    if (notePreview.style.display === 'none') {
      notePreview.innerHTML = renderMarkdown(noteEditor.value || '');
      notePreview.style.display = '';
      noteEditor.style.display = 'none';
    } else {
      noteEditor.style.display = '';
      notePreview.style.display = 'none';
    }
  });
  document.getElementById("noteSave").addEventListener("click", async () => {
    if (!currentNoteTarget) { closeNoteModal(); return; }
    const { id, idx } = currentNoteTarget;
    let list = await readList();
    const item = list.find((x) => x.id === id);
    if (!item) { closeNoteModal(); return; }
    const md = (noteEditor.value || '').trim();
    item.notes = item.notes || {};
    if (md) item.notes[idx] = md; else delete item.notes[idx];
    await writeList(list);
    await render();
    closeNoteModal();
  });

  // 右键打开解析编辑；左键查看（若有解析）
  document.getElementById("list").addEventListener("contextmenu", async (e) => {
    const el = e.target.closest('.sentence');
    if (!el) return;
    e.preventDefault();
    const tr = el.closest('tr[data-id]');
    const row = el.closest('.sentence-row');
    if (!tr || !row) return;
    const id = tr.getAttribute('data-id');
    const idx = Number(row.getAttribute('data-idx'));
    let list = await readList();
    const item = list.find((x) => x.id === id);
    const md = (item?.notes && item.notes[idx]) || '';
    currentNoteTarget = { id, idx };
    openNoteModal(md);
  });

  document.getElementById("list").addEventListener("click", async (e) => {
    const el = e.target.closest('.sentence');
    if (!el || !el.classList.contains('has-note')) return;
    const tr = el.closest('tr[data-id]');
    const row = el.closest('.sentence-row');
    if (!tr || !row) return;
    const id = tr.getAttribute('data-id');
    const idx = Number(row.getAttribute('data-idx'));
    let list = await readList();
    const item = list.find((x) => x.id === id);
    const md = (item?.notes && item.notes[idx]) || '';
    currentNoteTarget = { id, idx };
    // 打开预览模式
    notePreview.innerHTML = renderMarkdown(md);
    notePreview.style.display = '';
    noteEditor.style.display = 'none';
    show(modalNote);
  });

  // 监听存储变化（其它页面新增/删除时刷新）
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY_SELECTIONS]) {
      render();
    }
  });
});


