// 看板：读取与管理右键保存的文本列表
const STORAGE_KEY_SELECTIONS = "savedSelections";

// 等待页面准备好（如果是在百度页面被替换的情况下）
const waitForPageReady = () => {
  return new Promise((resolve) => {
    // 如果页面已经准备好（有标志或者关键元素已经存在），立即执行
    if (window.__boardPageReady || document.getElementById("search") || document.readyState === "complete") {
      resolve();
      return;
    }
    
    // 否则等待最多 2 秒
    const maxWait = 2000;
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (window.__boardPageReady || document.getElementById("search") || document.readyState === "complete") {
        clearInterval(checkInterval);
        resolve();
      } else if (Date.now() - startTime > maxWait) {
        clearInterval(checkInterval);
        resolve(); // 超时也继续执行
      }
    }, 50);
  });
};

// 防止重复渲染的标志
let isUpdatingFromUserAction = false;
let updateTimeout = null;

// 当前选中的 TAB
let currentTab = 'all'; // 'all' | 'vocab' | 'review' | 'history'

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
  // 去重（不区分大小写），保持原有顺序
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
  return out;
};

const normalizeSentenceKey = (s) => (s || "").trim().toLowerCase();

// 高亮搜索关键词
const highlightText = (text, query) => {
  if (!query) return escapeHtml(text);
  const regex = new RegExp(`(${escapeHtml(query)})`, 'gi');
  return escapeHtml(text).replace(regex, '<mark class="search-highlight">$1</mark>');
};

// 切换 TAB
const switchTab = async (tab) => {
  currentTab = tab;
  updateTabButtons();
  await chrome.storage.local.set({ selectedTab: tab });
  await updateDisplay();
};

// 更新 TAB 按钮状态
const updateTabButtons = () => {
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    if (btn.getAttribute('data-tab') === currentTab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
};

// 今日待复习列表渲染
const renderReview = async () => {
  const panel = document.getElementById('reviewPanel');
  const ul = document.getElementById('reviewList');
  if (!panel || !ul) return;

  if (currentTab === 'all' || currentTab === 'review') {
    panel.style.display = '';
  }

  const { [STORAGE_KEY_SELECTIONS]: list = [] } = await chrome.storage.local.get(STORAGE_KEY_SELECTIONS);
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const startTs = todayStart.getTime();
  const endTs = startTs + dayMs;
  const schedule = [1, 3, 7, 15, 30].map((d) => d * dayMs);
  const isReviewedToday = (reviews = []) => reviews.some((t) => t >= startTs && t < endTs);
  const isDueToday = (created) => schedule.some((off) => created + off >= startTs && created + off < endTs);
  let due = list.filter((x) => x.createdAt && isDueToday(x.createdAt));

  // 去重（不区分大小写），保留最早创建
  const wordMap = new Map();
  due.forEach((x) => {
    const wordKey = (x.word || x.text || '').toLowerCase();
    if (!wordMap.has(wordKey)) {
      wordMap.set(wordKey, x);
    } else {
      const existing = wordMap.get(wordKey);
      if (x.createdAt < existing.createdAt) {
        wordMap.set(wordKey, x);
      }
    }
  });
  due = Array.from(wordMap.values());

  if (!due.length) {
    ul.innerHTML = `<li class="review-empty">🎉 太棒了！今日暂无待复习项目</li>`;
    return;
  }

  const isReviewed = (item) => isReviewedToday(item.reviewTimes);

  const header = panel.querySelector('.review-header');
  if (header) {
    const completedCount = due.filter(isReviewed).length;
    header.innerHTML = `📚 今日待复习 (${completedCount}/${due.length})`;
  }

  ul.innerHTML = due
    .map((x) => {
      const checked = isReviewed(x) ? 'checked' : '';
      const statusClass = checked ? 'completed' : 'pending';
      const statusText = checked ? '已完成' : '待复习';

      const reviews = Array.isArray(x.reviewTimes) ? x.reviewTimes.slice().sort((a, b) => a - b) : [];
      const day = 24 * 60 * 60 * 1000;
      const scheduleOffsets = [1, 3, 7, 15, 30].map((d) => d * day);
      let nextDue = null;
      for (const offset of scheduleOffsets) {
        const checkpoint = (x.createdAt || 0) + offset;
        const done = reviews.some((t) => t >= checkpoint);
        if (!done) {
          nextDue = checkpoint;
          break;
        }
      }

      return `<li class="review-item ${checked ? 'completed' : ''}" data-id="${x.id}">
        <div class="review-item-header">
          <span class="word">${escapeHtml(x.word || x.text || '')}</span>
          <div class="review-status ${statusClass}">${statusText}</div>
        </div>
        <div class="review-item-content">
          <div class="review-meta">
            <div class="review-count">${(x.reviewTimes || []).length} 次</div>
            ${nextDue ? `<div class="review-due">${formatTime(nextDue).split(' ')[0]}</div>` : ''}
          </div>
          <input type="checkbox" class="review-done" ${checked}/>
        </div>
      </li>`;
    })
    .join('');
};

// 历史待复习列表渲染
const renderHistoryReview = async () => {
  const panel = document.getElementById('historyReviewPanel');
  const ul = document.getElementById('historyReviewList');
  if (!panel || !ul) return;

  const { [STORAGE_KEY_SELECTIONS]: list = [] } = await chrome.storage.local.get(STORAGE_KEY_SELECTIONS);
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const startTs = todayStart.getTime();
  const schedule = [1, 3, 7, 15, 30].map((d) => d * dayMs);
  const isReviewedAtDay = (reviews = [], cp) => {
    const start = new Date(cp);
    start.setHours(0, 0, 0, 0);
    const s = start.getTime();
    const e = s + dayMs;
    return reviews.some((t) => t >= s && t < e);
  };

  const items = [];
  for (const x of list) {
    const created = x.createdAt || 0;
    if (!created) continue;
    const reviews = Array.isArray(x.reviewTimes) ? x.reviewTimes : [];
    for (const off of schedule) {
      const cp = created + off;
      if (cp < startTs && !isReviewedAtDay(reviews, cp)) {
        items.push({ id: x.id, word: x.word || x.text || '', cp, reviewCount: reviews.length });
      }
    }
  }

  const wordMap = new Map();
  items.forEach((item) => {
    const wordKey = item.word.toLowerCase();
    if (!wordMap.has(wordKey)) {
      wordMap.set(wordKey, item);
    } else {
      const existing = wordMap.get(wordKey);
      if (item.cp < existing.cp) {
        wordMap.set(wordKey, item);
      }
    }
  });
  const uniqueItems = Array.from(wordMap.values());

  if (currentTab === 'all' || currentTab === 'history') {
    panel.style.display = uniqueItems.length ? '' : 'none';
  }

  if (!uniqueItems.length) {
    ul.innerHTML = `<li class="review-empty">🎉 太棒了！暂无历史待复习项目</li>`;
    return;
  }

  const header = panel.querySelector('.review-header');
  if (header) {
    header.innerHTML = `📅 历史待复习 (${uniqueItems.length} 项)`;
  }

  ul.innerHTML = uniqueItems
    .sort((a, b) => a.cp - b.cp)
    .map(({ id, word, cp, reviewCount }) => {
      const dateStr = new Date(cp).toISOString().slice(0, 10);
      const daysOverdue = Math.floor((startTs - cp) / dayMs);
      return `<li class="review-item" data-id="${id}" data-cp="${cp}">
        <div class="review-item-header">
          <span class="word">${escapeHtml(word)}</span>
          <div class="review-status pending">逾期 ${daysOverdue} 天</div>
        </div>
        <div class="review-item-content">
          <div class="review-meta">
            <div class="review-count">${reviewCount} 次</div>
            <div class="review-due">应于 ${dateStr}</div>
          </div>
          <input type="checkbox" class="history-review-done"/>
        </div>
      </li>`;
    })
    .join('');
};

// 根据当前 TAB 更新显示
const updateDisplay = async () => {
  const vocabContainer = document.querySelector('.vocab-container');
  const reviewPanel = document.getElementById('reviewPanel');
  const historyReviewPanel = document.getElementById('historyReviewPanel');
  
  // 根据 TAB 显示/隐藏内容
  switch (currentTab) {
    case 'all':
      vocabContainer.style.display = '';
      reviewPanel.style.display = '';
      historyReviewPanel.style.display = '';
      await render();
      await renderReview();
      await renderHistoryReview();
      break;
    case 'vocab':
      vocabContainer.style.display = '';
      reviewPanel.style.display = 'none';
      historyReviewPanel.style.display = 'none';
      await render();
      break;
    case 'review':
      vocabContainer.style.display = 'none';
      reviewPanel.style.display = '';
      historyReviewPanel.style.display = 'none';
      await renderReview();
      break;
    case 'history':
      vocabContainer.style.display = 'none';
      reviewPanel.style.display = 'none';
      historyReviewPanel.style.display = '';
      await renderHistoryReview();
      break;
  }
};

// 渲染表格
const render = async () => {
  const list = await readList();
  const q = (document.getElementById("search").value || "").trim().toLowerCase();
  const sort = (document.getElementById("sortSelect")?.value) || 'time_desc';
  const match = (s) => (s || "").toLowerCase().includes(q);
  let filtered = q
    ? list.filter((x) => match(x.word || x.text))
    : list;

  // 排序
  const getWord = (x) => (x.word || x.text || '').toLowerCase();
  if (sort === 'time_asc') filtered = filtered.sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
  else if (sort === 'time_desc') filtered = filtered.sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
  else if (sort === 'alpha_asc') filtered = filtered.sort((a,b) => getWord(a).localeCompare(getWord(b)));
  else if (sort === 'alpha_desc') filtered = filtered.sort((a,b) => getWord(b).localeCompare(getWord(a)));

  const listContainer = document.getElementById("list");
  const empty = document.getElementById("empty");
  
  if (filtered.length === 0) {
    listContainer.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  
  empty.style.display = "none";
  listContainer.innerHTML = filtered
    .map((item, index) => {
      const url = item.url || "";
      let hostname = "";
      try { hostname = url ? new URL(url).hostname : ""; } catch (e) {}
      const word = item.word || item.text || "";
      const sentences = Array.isArray(item.sentences) ? item.sentences : [];
      const notes = item.notes || {}; // { [sentenceKey]: markdown }
      const reviews = Array.isArray(item.reviewTimes) ? item.reviewTimes.slice().sort((a,b)=>a-b) : [];
      const lastReview = reviews.length ? reviews[reviews.length-1] : 0;
      const day = 24*60*60*1000;
      const schedule = [1,3,7,15,30].map(d=>d*day);
      const created = item.createdAt || 0;
      let nextDue = null;
      for (const offset of schedule) {
        const checkpoint = created + offset;
        const done = reviews.some(t => t >= checkpoint);
        if (!done) { nextDue = checkpoint; break; }
      }
      
      return `
        <div class="vocab-card" data-id="${item.id}" style="animation-delay: ${index * 0.1}s">
          <div class="vocab-card-header">
            <div class="vocab-word">${highlightText(word, q)}</div>
            <div class="vocab-actions">
              <button class="icon-btn copy" title="复制">⧉</button>
              <button class="icon-btn delete" title="删除">✕</button>
            </div>
          </div>
          
          <div class="vocab-content">
            <!-- 例句区域 -->
            <div class="vocab-sentences">
              ${sentences
                .map((s, idx) => `
                  <div class="sentence-item" data-idx="${idx}" data-key="${escapeHtml(normalizeSentenceKey(s))}">
                    <div class="sentence-text${notes[normalizeSentenceKey(s)] ? ' has-note' : ''}">${escapeHtml(s)}</div>
                    <div class="sentence-actions">
                      <button class="icon-btn sentence-delete" title="删除">✕</button>
                    </div>
                  </div>
                `)
                .join("")}
              <div class="add-sentence">
                <input class="input" placeholder="为该单词新增例句，回车保存" />
              </div>
            </div>
            
            <!-- 来源信息 -->
            ${(item.title || url) ? `
              <div class="vocab-source">
                ${item.title ? `<div class="source-title">${escapeHtml(item.title)}</div>` : ""}
                ${url ? `<a href="${escapeHtml(url)}" target="_blank" class="source-url">${escapeHtml(hostname || url)}</a>` : ""}
              </div>
            ` : ""}
            
            <!-- 元数据 -->
            <div class="vocab-meta">
              <div class="meta-row">
                <span class="meta-label">添加时间</span>
                <span class="meta-value">${formatTime(item.createdAt)}</span>
              </div>
              
              <!-- 复习数据 -->
              <div class="review-stats">
                <div class="review-stat">
                  <span>${reviews.length} 次</span>
                </div>
                ${lastReview ? `
                  <div class="review-stat last-review">
                    <span>${formatTime(lastReview).split(' ')[0]}</span>
                  </div>
                ` : ""}
                ${nextDue ? `
                  <div class="review-stat next-due">
                    <span>${formatTime(nextDue).split(' ')[0]}</span>
                  </div>
                ` : ""}
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
};

// 等待页面准备好后再执行
waitForPageReady().then(() => {
  // 如果 DOMContentLoaded 已经触发，直接执行初始化
  if (document.readyState === "complete" || document.readyState === "interactive") {
    initializeBoard();
  } else {
    // 否则等待 DOMContentLoaded
    document.addEventListener("DOMContentLoaded", initializeBoard, { once: true });
    // 如果已经加载完成，立即触发
    if (document.readyState !== "loading") {
      const event = new Event("DOMContentLoaded", { bubbles: true });
      document.dispatchEvent(event);
    }
  }
});

const initializeBoard = async () => {
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

  // 初始化 TAB 切换
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      switchTab(tab);
    });
  });
  
  // 读取保存的 TAB 选择
  const { selectedTab } = await chrome.storage.local.get('selectedTab');
  if (selectedTab) {
    currentTab = selectedTab;
    updateTabButtons();
  }
  
  await updateDisplay();
  const searchEl = document.getElementById("search");
  if (searchEl) {
    searchEl.addEventListener("input", () => {
      if (currentTab === 'all' || currentTab === 'vocab') {
        render();
      }
    });
    // 点击原生 clear 按钮（type=search 的 ×）会触发 search 事件
    searchEl.addEventListener("search", () => {
      if (currentTab === 'all' || currentTab === 'vocab') {
        render();
      }
    });
    searchEl.addEventListener("change", () => {
      if (currentTab === 'all' || currentTab === 'vocab') {
        render();
      }
    });
    searchEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (currentTab === 'all' || currentTab === 'vocab')) {
        render();
      }
    });
  }

  const sortEl = document.getElementById('sortSelect');
  if (sortEl) {
    // 读取上次选择
    const { vocabSort } = await chrome.storage.local.get('vocabSort');
    if (vocabSort) {
      sortEl.value = vocabSort;
      // 应用持久化排序到首次渲染（已在 updateDisplay 中处理）
    }
    sortEl.addEventListener('change', async () => {
      await chrome.storage.local.set({ vocabSort: sortEl.value });
      await updateDisplay();
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
  // 关闭（X 与蒙层）
  document.getElementById("clearClose").addEventListener("click", () => hide(modalClear));
  document.getElementById("modalClear").addEventListener("click", (e) => { if (e.target.id === 'modalClear') hide(modalClear); });
  document.getElementById("clearConfirm").addEventListener("click", async () => {
    if (clearInput.value !== "清空") return;
    await writeList([]);
    await updateDisplay();
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

  // 空状态添加单词按钮
  document.getElementById("addFirstWord").addEventListener("click", () => {
    addWordInput.value = "";
    show(modalAddWord);
    addWordInput.focus();
  });
  document.getElementById("addWordClose").addEventListener("click", () => hide(modalAddWord));
  document.getElementById("modalAddWord").addEventListener("click", (e) => { if (e.target.id === 'modalAddWord') hide(modalAddWord); });
  document.getElementById("addWordConfirm").addEventListener("click", async () => {
    const word = (addWordInput.value || "").trim();
    if (!word) return;
    const list = await readList();
    const exists = list.some(x => (x.word || x.text || "").toLowerCase() === word.toLowerCase());
    if (exists) { alert("单词已存在"); return; }
    const now = Date.now();
    const item = { id: `${now}-${Math.random().toString(36).slice(2, 8)}`, word, sentences: [], reviewTimes: [], url: "", title: "", createdAt: now };
    await writeList([item, ...list]);
    await updateDisplay();
    hide(modalAddWord);
  });

  document.getElementById("list").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const card = e.target.closest(".vocab-card[data-id]");
    if (!card) return;
    const id = card.getAttribute("data-id");
    let list = await readList();
    const item = list.find((x) => x.id === id);
    if (!item) return;

    // 删除单条造句
    if (btn.classList.contains("sentence-delete")) {
      const sentenceItem = btn.closest(".sentence-item");
      const idx = Number(sentenceItem?.getAttribute("data-idx"));
      if (!Number.isFinite(idx)) return;
      item.sentences = normalizeSentences((item.sentences || []).filter((_, i) => i !== idx));
      
      // 设置标志，防止存储监听器触发重新渲染
      isUpdatingFromUserAction = true;
      await writeList(list);
      
      // 只更新当前卡片，避免重新渲染整个列表
      await updateVocabCard(item);
      
      // 延迟重置标志
      setTimeout(() => {
        isUpdatingFromUserAction = false;
      }, 100);
      return;
    }

    // 在该条目下新增造句（使用同一行的 input）
    if (btn.classList.contains("sentence-add")) {
      const input = btn.closest(".sentence-item")?.querySelector("input");
      const val = (input?.value || "").trim();
      if (!val) return;
      item.sentences = normalizeSentences([val, ...(item.sentences || [])]).slice(0, 20);
      await writeList(list);
      // 只更新当前卡片，避免重新渲染整个列表
      await updateVocabCard(item);
      if (currentTab === 'all' || currentTab === 'review') {
        await renderReview();
      }
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
      
      // 添加删除动画
      card.style.transition = 'all 0.3s ease';
      card.style.transform = 'translateX(-100%)';
      card.style.opacity = '0';
      
      // 延迟执行删除
      setTimeout(async () => {
        list = list.filter((x) => x.id !== id);
        
        // 设置标志，防止存储监听器触发重新渲染
        isUpdatingFromUserAction = true;
        await writeList(list);
        
        // 移除DOM元素
        card.remove();
        
        // 延迟重置标志
        setTimeout(() => {
          isUpdatingFromUserAction = false;
        }, 100);
      }, 300);
      return;
    }
  });

  // 更新单个词汇卡片
  const updateVocabCard = async (item) => {
    const card = document.querySelector(`.vocab-card[data-id="${item.id}"]`);
    if (!card) return;
    
    const sentences = Array.isArray(item.sentences) ? item.sentences : [];
    const notes = item.notes || {};
    const reviews = Array.isArray(item.reviewTimes) ? item.reviewTimes.slice().sort((a,b)=>a-b) : [];
    const lastReview = reviews.length ? reviews[reviews.length-1] : 0;
    const day = 24*60*60*1000;
    const schedule = [1,3,7,15,30].map(d=>d*day);
    const created = item.createdAt || 0;
    let nextDue = null;
    for (const offset of schedule) {
      const checkpoint = created + offset;
      const done = reviews.some(t => t >= checkpoint);
      if (!done) { nextDue = checkpoint; break; }
    }
    
    const url = item.url || "";
    let hostname = "";
    try { hostname = url ? new URL(url).hostname : ""; } catch (e) {}
    const word = item.word || item.text || "";
    const q = (document.getElementById("search").value || "").trim().toLowerCase();
    
    // 只更新例句区域
    const sentencesContainer = card.querySelector('.vocab-sentences');
    if (sentencesContainer) {
      const newContent = `
        ${sentences
          .map((s, idx) => `
            <div class="sentence-item" data-idx="${idx}" data-key="${escapeHtml(normalizeSentenceKey(s))}" style="animation: slideIn 0.3s ease-out; animation-delay: ${idx * 0.1}s">
              <div class="sentence-text${notes[normalizeSentenceKey(s)] ? ' has-note' : ''}">${escapeHtml(s)}</div>
              <div class="sentence-actions">
                <button class="icon-btn sentence-delete" title="删除">✕</button>
              </div>
            </div>
          `)
          .join("")}
        <div class="add-sentence">
          <input class="input" placeholder="为该单词新增例句，回车保存" />
        </div>
      `;
      
      sentencesContainer.innerHTML = newContent;
    }
    
    // 更新复习数据
    const reviewStats = card.querySelector('.review-stats');
    if (reviewStats) {
      reviewStats.innerHTML = `
        <div class="review-stat">
          <span>${reviews.length} 次</span>
        </div>
        ${lastReview ? `
          <div class="review-stat last-review">
            <span>${formatTime(lastReview).split(' ')[0]}</span>
          </div>
        ` : ""}
        ${nextDue ? `
          <div class="review-stat next-due">
            <span>${formatTime(nextDue).split(' ')[0]}</span>
          </div>
        ` : ""}
      `;
    }
  };

  // 句子输入框回车保存（事件委托）
  document.getElementById("list").addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const input = e.target.closest(".add-sentence input");
    if (!input) return;
    e.preventDefault();
    const card = input.closest(".vocab-card[data-id]");
    if (!card) return;
    const id = card.getAttribute("data-id");
    let list = await readList();
    const item = list.find((x) => x.id === id);
    if (!item) return;
    const val = (input.value || "").trim();
    if (!val) return;
    const prev = item.sentences || [];
    const nextSentences = normalizeSentences([val, ...prev]).slice(0, 20);
    // 若句子集变动，需迁移 notes 的 key
    if (item.notes) {
      const newNotes = {};
      for (const s of nextSentences) {
        const k = normalizeSentenceKey(s);
        if (item.notes[k]) newNotes[k] = item.notes[k];
      }
      item.notes = newNotes;
    }
    item.sentences = nextSentences;
    input.value = ""; // 清空输入框
    
    // 设置标志，防止存储监听器触发重新渲染
    isUpdatingFromUserAction = true;
    await writeList(list);
    
    // 只更新当前卡片，避免重新渲染整个列表
    await updateVocabCard(item);
    
    // 延迟重置标志
    setTimeout(() => {
      isUpdatingFromUserAction = false;
    }, 100);
  });

  // 右键句子：新增/编辑解析（Markdown）和点击查看
  const modalNote = document.getElementById("modalNote");
  const noteEditor = document.getElementById("noteEditor");
  const notePreview = document.getElementById("notePreview");
  const btnView = document.getElementById("noteView");
  const btnEdit = document.getElementById("noteEdit");
  const btnSave = document.getElementById("noteSave");
  const btnDelete = document.getElementById("noteDelete");
  const renderMarkdown = (md) => {
    // 极简 Markdown 渲染（标题/粗斜体/代码/引用/链接/列表/分割线/表格）
    let src = (md || "");
    // 先转义 HTML
    src = src.replace(/[&<>]/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));

    // 表格解析（简单实现）：以 \n| 开头的块视为表格，按 | 切分
    src = src.replace(/(?:^|\n)(\|[^\n]+\|)(?:\n\|[\-\s:]+\|)?((?:\n\|[^\n]+\|)+)/g, (m, header, rows) => {
      const toCells = (line) => line.trim().slice(1, -1).split('|').map(s => s.trim());
      const ths = toCells(header).map((h) => `<th>${h}</th>`).join('');
      const trs = rows.trim().split('\n').map(r => `<tr>${toCells(r).map((c)=>`<td>${c}</td>`).join('')}</tr>`).join('');
      return `\n<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    });

    // 代码块（```）
    src = src.replace(/```([\s\S]*?)```/g, (m, code) => `<pre><code>${code.replace(/</g,'&lt;')}</code></pre>`);

    // 标题
    src = src
      .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
      .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
      .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // 分割线 --- 或 ***
    src = src.replace(/^\s*(?:---|\*\*\*)\s*$/gm, '<hr/>');

    // 引用、列表（简化）
    src = src
      .replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/^\s*[-*]\s+(.+)$/gm, '<ul><li>$1</li></ul>');

    // 行内样式与链接
    src = src
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[(.+?)\]\((https?:[^\s)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // 段落
    src = src.replace(/\n\n+/g, '</p><p>');
    return `<p>${src}</p>`;
  };

  let currentNoteTarget = null; // { id, idx }

  const setMode = (mode) => { // 'edit' | 'view'
    if (mode === 'view') {
      notePreview.style.display = '';
      noteEditor.style.display = 'none';
      btnView.style.display = 'none';
      btnEdit.style.display = '';
      btnSave.style.display = 'none';
      btnDelete.style.display = '';
    } else {
      notePreview.style.display = 'none';
      noteEditor.style.display = '';
      btnView.style.display = '';
      btnEdit.style.display = 'none';
      btnSave.style.display = '';
      btnDelete.style.display = 'none';
    }
  };

  const openNoteModal = (markdown, prefer = 'edit') => {
    noteEditor.value = markdown || '';
    if (prefer === 'view' && markdown) {
      notePreview.innerHTML = renderMarkdown(markdown);
      setMode('view');
    } else {
      setMode('edit');
    }
    show(modalNote);
    if (prefer !== 'view') noteEditor.focus();
  };
  const closeNoteModal = () => { hide(modalNote); currentNoteTarget = null; };

  document.getElementById("noteClose").addEventListener("click", closeNoteModal);
  document.getElementById("modalNote").addEventListener("click", (e) => { if (e.target.id === 'modalNote') closeNoteModal(); });
  btnView.addEventListener("click", () => {
    notePreview.innerHTML = renderMarkdown(noteEditor.value || '');
    setMode('view');
  });
  btnEdit.addEventListener("click", () => {
    setMode('edit');
    noteEditor.focus();
  });
  document.getElementById("noteSave").addEventListener("click", async () => {
    if (!currentNoteTarget) { closeNoteModal(); return; }
    const { id, idx, key } = currentNoteTarget;
    let list = await readList();
    const item = list.find((x) => x.id === id);
    if (!item) { closeNoteModal(); return; }
    const md = (noteEditor.value || '').trim();
    item.notes = item.notes || {};
    const sentenceKey = key || normalizeSentenceKey((item.sentences||[])[idx]||'');
    if (md) item.notes[sentenceKey] = md; else delete item.notes[sentenceKey];
    await writeList(list);
    if (currentTab === 'all' || currentTab === 'vocab') {
      await render();
    }
    closeNoteModal();
  });

  // 右键打开解析编辑；左键查看（若有解析）
  document.getElementById("list").addEventListener("contextmenu", async (e) => {
    const el = e.target.closest('.sentence-text');
    if (!el) return;
    e.preventDefault();
    const card = el.closest('.vocab-card[data-id]');
    const sentenceItem = el.closest('.sentence-item');
    if (!card || !sentenceItem) return;
    const id = card.getAttribute('data-id');
    const idx = Number(sentenceItem.getAttribute('data-idx'));
    const key = sentenceItem.getAttribute('data-key');
    let list = await readList();
    const item = list.find((x) => x.id === id);
    const md = (item?.notes && item.notes[key || normalizeSentenceKey((item.sentences||[])[idx]||'')]) || '';
    currentNoteTarget = { id, idx, key };
    // 如果已有解析，右键进入预览态；否则进入编辑态
    openNoteModal(md, md ? 'view' : 'edit');
  });

  document.getElementById("list").addEventListener("click", async (e) => {
    const el = e.target.closest('.sentence-text');
    if (!el || !el.classList.contains('has-note')) return;
    const card = el.closest('.vocab-card[data-id]');
    const sentenceItem = el.closest('.sentence-item');
    if (!card || !sentenceItem) return;
    const id = card.getAttribute('data-id');
    const idx = Number(sentenceItem.getAttribute('data-idx'));
    const key = sentenceItem.getAttribute('data-key');
    let list = await readList();
    const item = list.find((x) => x.id === id);
    const md = (item?.notes && item.notes[key || normalizeSentenceKey((item.sentences||[])[idx]||'')]) || '';
    currentNoteTarget = { id, idx, key };
    // 左键点击：已有解析则预览，否则进入编辑
    openNoteModal(md, md ? 'view' : 'edit');
  });

  // 删除解析
  btnDelete.addEventListener('click', async () => {
    if (!currentNoteTarget) { closeNoteModal(); return; }
    const { id, idx, key } = currentNoteTarget;
    let list = await readList();
    const item = list.find((x) => x.id === id);
    if (!item) { closeNoteModal(); return; }
    const k = key || normalizeSentenceKey((item.sentences||[])[idx]||'');
    if (item.notes && item.notes[k]) {
      delete item.notes[k];
      await writeList(list);
      if (currentTab === 'all' || currentTab === 'vocab') {
        await render();
      }
    }
    closeNoteModal();
  });

  // 监听存储变化（其它页面新增/删除时刷新）
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY_SELECTIONS]) {
      // 如果是从用户操作触发的更新，跳过重新渲染
      if (isUpdatingFromUserAction) {
        isUpdatingFromUserAction = false;
        return;
      }
      
      // 清除之前的延迟更新
      if (updateTimeout) {
        clearTimeout(updateTimeout);
      }
      
      // 根据当前 TAB 更新显示
      if (currentTab === 'all' || currentTab === 'vocab') {
        render();
      }
      // 完全禁用待复习列表的自动重新渲染，避免抖动
      // 待复习列表只在页面加载时和手动操作时更新
    }
  });

  // 更新单个复习卡片的UI
  const updateReviewCardUI = (li, item, checked) => {
    // 使用 requestAnimationFrame 确保在下一帧更新，避免布局抖动
    requestAnimationFrame(() => {
      const statusEl = li.querySelector('.review-status');
      const reviewCountEl = li.querySelector('.review-count');
      
      if (statusEl) {
        statusEl.className = `review-status ${checked ? 'completed' : 'pending'}`;
        statusEl.textContent = checked ? '已完成' : '待复习';
      }
      
      if (reviewCountEl) {
        const reviewCount = Array.isArray(item.reviewTimes) ? item.reviewTimes.length : 0;
        reviewCountEl.textContent = `${reviewCount} 次`;
      }
    });
  };

  // 更新复习面板标题
  const updateReviewPanelHeader = async () => {
    const panel = document.getElementById('reviewPanel');
    const header = panel?.querySelector('.review-header');
    if (!header) return;
    
    const { [STORAGE_KEY_SELECTIONS]: list = [] } = await chrome.storage.local.get(STORAGE_KEY_SELECTIONS);
    const dayMs = 24*60*60*1000;
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const startTs = todayStart.getTime();
    const endTs = startTs + dayMs;
    const schedule = [1,3,7,15,30].map(d=>d*dayMs);
    const isReviewedToday = (reviews=[]) => reviews.some(t => t >= startTs && t < endTs);
    const isDueToday = (created) => schedule.some(off => (created + off) >= startTs && (created + off) < endTs);
    const due = list.filter(x => x.createdAt && isDueToday(x.createdAt));
    const completedCount = due.filter(x => isReviewedToday(x.reviewTimes)).length;
    const totalCount = due.length;
    
    // 使用 requestAnimationFrame 确保在下一帧更新，避免布局抖动
    requestAnimationFrame(() => {
      header.innerHTML = `📚 今日待复习 (${completedCount}/${totalCount})`;
    });
  };

  const reviewListEl = document.getElementById('reviewList');
  const handleTodayToggle = async (li, checked) => {
    const id = li.getAttribute('data-id');
    const { [STORAGE_KEY_SELECTIONS]: list = [] } = await chrome.storage.local.get(STORAGE_KEY_SELECTIONS);
    const item = list.find(x => x.id === id);
    if (!item) return;
    item.reviewTimes = Array.isArray(item.reviewTimes) ? item.reviewTimes : [];
    const dayMs = 24*60*60*1000;
    const todayStart = new Date(); todayStart.setHours(12,0,0,0); // 中午时间，避免夏令时边界
    const startTs = todayStart.getTime() - 12*60*60*1000; // 当天0点
    const endTs = startTs + dayMs;
    
    // 添加视觉反馈
    if (checked) {
      li.classList.add('completed');
      if (!item.reviewTimes.some(t => t >= startTs && t < endTs)) item.reviewTimes.push(todayStart.getTime());
    } else {
      li.classList.remove('completed');
      item.reviewTimes = item.reviewTimes.filter(t => !(t >= startTs && t < endTs));
    }
    
    // 设置标志，防止存储监听器触发重新渲染
    isUpdatingFromUserAction = true;
    
    // 先更新UI，再写入存储，确保用户体验流畅
    updateReviewCardUI(li, item, checked);
    updateReviewPanelHeader();
    
    // 延迟写入存储，避免与UI更新冲突
    setTimeout(async () => {
      await writeList(list);
      isUpdatingFromUserAction = false;
    }, 50);
  };
  if (reviewListEl) {
    reviewListEl.addEventListener('click', async (e) => {
      const cb = e.target.closest('.review-done');
      if (!cb) return;
      const li = cb.closest('.review-item');
      await handleTodayToggle(li, cb.checked);
    });
    reviewListEl.addEventListener('change', async (e) => {
      const cb = e.target.closest('.review-done');
      if (!cb) return;
      const li = cb.closest('.review-item');
      await handleTodayToggle(li, cb.checked);
    });
  }

  // 更新历史待复习面板标题
  const updateHistoryReviewPanelHeader = async () => {
    const panel = document.getElementById('historyReviewPanel');
    const header = panel?.querySelector('.review-header');
    if (!header) return;
    
    const { [STORAGE_KEY_SELECTIONS]: list = [] } = await chrome.storage.local.get(STORAGE_KEY_SELECTIONS);
    const dayMs = 24*60*60*1000;
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const startTs = todayStart.getTime();
    const schedule = [1,3,7,15,30].map(d=>d*dayMs);
    const isReviewedAtDay = (reviews=[], cp) => {
      const start = new Date(cp); start.setHours(0,0,0,0);
      const s = start.getTime();
      const e = s + dayMs;
      return reviews.some(t => t >= s && t < e);
    };
    const items = [];
    for (const x of list) {
      const created = x.createdAt || 0;
      if (!created) continue;
      const reviews = Array.isArray(x.reviewTimes) ? x.reviewTimes : [];
      for (const off of schedule) {
        const cp = created + off;
        if (cp < startTs && !isReviewedAtDay(reviews, cp)) {
          items.push({ id: x.id, word: x.word || x.text || '', cp, reviewCount: reviews.length });
        }
      }
    }
    
    header.innerHTML = `📅 历史待复习 (${items.length} 项)`;
  };

  const historyListEl = document.getElementById('historyReviewList');
  historyListEl && historyListEl.addEventListener('change', async (e) => {
    const target = e.target;
    if (!(target && target.classList && target.classList.contains('history-review-done'))) return;
    const li = target.closest('.review-item');
    if (!li) return;
    const id = li.getAttribute('data-id');
    const cp = Number(li.getAttribute('data-cp'));
    const { [STORAGE_KEY_SELECTIONS]: list = [] } = await chrome.storage.local.get(STORAGE_KEY_SELECTIONS);
    const item = list.find(x => x.id === id);
    if (!item) return;
    item.reviewTimes = Array.isArray(item.reviewTimes) ? item.reviewTimes : [];
    // 将打卡时间设为节点当天（避免跨天误差）
    const dayStart = new Date(cp); dayStart.setHours(12,0,0,0);
    item.reviewTimes.push(dayStart.getTime());
    
    // 设置标志，防止存储监听器触发重新渲染
    isUpdatingFromUserAction = true;
    
    // 先更新UI，再写入存储，确保用户体验流畅
    li.classList.add('completed');
    const statusEl = li.querySelector('.review-status');
    const reviewCountEl = li.querySelector('.review-count');
    
    if (statusEl) {
      statusEl.className = 'review-status completed';
      statusEl.textContent = '已完成';
    }
    
    if (reviewCountEl) {
      const reviewCount = Array.isArray(item.reviewTimes) ? item.reviewTimes.length : 0;
      reviewCountEl.textContent = `${reviewCount} 次`;
    }
    
    // 延迟写入存储，避免与UI更新冲突
    setTimeout(async () => {
      await writeList(list);
      isUpdatingFromUserAction = false;
    }, 50);
    
    // 延迟移除卡片，给用户视觉反馈
    setTimeout(() => {
      li.style.transition = 'all 0.3s ease';
      li.style.transform = 'translateX(-100%)';
      li.style.opacity = '0';
      setTimeout(() => {
        li.remove();
        updateHistoryReviewPanelHeader();
      }, 300);
    }, 500);
  });

};


