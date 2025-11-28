// 内容脚本：
// 1) 根据开关设置切换 html.adblock-enabled 以控制样式
// 2) 站点定制逻辑（语雀提示移除、内部工具自动化等）
console.log("啊皮 Chrome 插件");

// 轻量 Toast 提示
const ensureToastStyles = () => {
  if (document.getElementById("xhs-toast-style")) return;
  const style = document.createElement("style");
  style.id = "xhs-toast-style";
  style.textContent = `
  @keyframes xhs-fadein { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes xhs-fadeout { from { opacity: 1; } to { opacity: 0; } }
  .xhs-toast-wrap { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647; display: flex; flex-direction: column; gap: 8px; align-items: center; }
  .xhs-toast { max-width: 360px; padding: 10px 12px; border-radius: 8px; color: #e5faff; background: rgba(0,0,0,0.78); backdrop-filter: saturate(150%) blur(4px); box-shadow: 0 8px 24px rgba(0,0,0,0.25); font-size: 13px; line-height: 1.4; animation: xhs-fadein 120ms ease both; }
  .xhs-toast.fadeout { animation: xhs-fadeout 160ms ease forwards; }
  `;
  document.documentElement.appendChild(style);
};

const showToast = (text) => {
  try {
    ensureToastStyles();
    let wrap = document.getElementById("xhs-toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "xhs-toast-wrap";
      wrap.className = "xhs-toast-wrap";
      document.documentElement.appendChild(wrap);
    }
    const node = document.createElement("div");
    node.className = "xhs-toast";
    node.textContent = text || "已保存到词汇表";
    wrap.appendChild(node);
    setTimeout(() => { node.classList.add("fadeout"); }, 1100);
    setTimeout(() => { node.remove(); }, 1300);
  } catch (_) {}
};

// 背景通知保存成功时展示提示
try {
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === "save-selection-success") {
      showToast(msg.tip || "已保存到词汇表");
    }
  });
} catch (e) {}

// 快捷键保存选中文本：Cmd/Ctrl + '+'（含 Shift + '='）或数字键盘加号
// 注：浏览器的页面缩放快捷键可能仍会生效，但同时会尝试保存所选文本
try {
  const handleHotkey = (e) => {
    const isModifier = e.metaKey || e.ctrlKey;
    const isPlus = e.key === "+" || (e.key === "=" && e.shiftKey) || e.code === "NumpadAdd";
    if (!isModifier || !isPlus) return;
    const text = (window.getSelection && window.getSelection().toString().trim()) || "";
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    chrome.runtime.sendMessage({
      type: "save-selection",
      text,
      url: location.href,
      title: document.title,
    });
  };
  // 捕获阶段尽早拦截
  window.addEventListener("keydown", handleHotkey, true);
} catch (e) {}

// 根据存储状态在页面切换开关类名
const applyAdblockClass = async () => {
  try {
    const { adblockEnabled } = await chrome.storage.local.get("adblockEnabled");
    const enabled = adblockEnabled !== false;
    document.documentElement.classList.toggle("adblock-enabled", enabled);
  } catch (e) {
    // 在某些页面（如内嵌 PDF）没有权限访问 storage
  }
};

applyAdblockClass();

// 监听来自 popup/background 的存储切换
try {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.adblockEnabled) return;
    const enabled = changes.adblockEnabled.newValue !== false;
    document.documentElement.classList.toggle("adblock-enabled", enabled);
  });
} catch (e) {}


// 小红书 B 端账号自动登录（内部系统）——受开关控制
if (location.hostname.includes("customer") || location.hostname.includes("creator")) {
  const getToken = async () => {
    const res = await fetch(
      "https://datafactory.devops.xiaohongshu.com/api/rdf/tool/getDataToken",
      {
        headers: {
          accept: "application/json,application/octet-stream",
          "accept-language": "zh-CN,zh;q=0.9",
          "cache-control": "no-cache",
          email: "pishiheng@xiaohongshu.com",
          pragma: "no-cache",
          priority: "u=1, i",
          "sec-ch-ua":
            '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"macOS"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
        },
        referrer: "https://datafactory.devops.xiaohongshu.com/rdf/advertmanage",
        referrerPolicy: "strict-origin-when-cross-origin",
        body: null,
        method: "GET",
        mode: "cors",
        credentials: "include",
      }
    );

    const data = await res.json();
    console.log("token: ", data);
    return data.data;
  };

  const getSmsCode = async (token) => {
    const res = await fetch(
      "https://datafactory.devops.xiaohongshu.com/api/rdf/advertManage/getCode",
      {
        headers: {
          accept: "application/json,application/octet-stream",
          "accept-language": "zh-CN,zh;q=0.9",
          "cache-control": "no-cache",
          "content-type": "application/json;charset=utf-8",
          "data-token": token,
          pragma: "no-cache",
          priority: "u=1, i",
          "sec-ch-ua":
            '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"macOS"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
        },
        referrer: "https://datafactory.devops.xiaohongshu.com/rdf/advertmanage",
        referrerPolicy: "strict-origin-when-cross-origin",
        body: '{"id":2089,"type":"df"}',
        method: "POST",
        mode: "cors",
        credentials: "include",
      }
    );

    const data = await res.json();
    console.log("smsCode: ", data);
    return data.data;
  };

  const autoLogin = async () => {
    const token = await getToken();
    const smsCode = await getSmsCode(token);

    // 选择手机号输入框 input 元素
    let phoneNumberElement = document.querySelector('input[placeholder="手机号"]');
    // 向该 input 元素填入手机号
    phoneNumberElement.value = "12012349040";
    phoneNumberElement.dispatchEvent(new Event("input")); // 触发输入事件

    // 选择验证码输入框 input 元素
    let smsCodeElement = document.querySelector('input[placeholder="验证码"]');
    // 向该 input 元素填入验证码
    smsCodeElement.value = smsCode;
    smsCodeElement.dispatchEvent(new Event("input")); // 触发输入事件
  };

  // 仅当开关开启时才执行自动登录
  const tryAutoLogin = async () => {
    try {
      const { xhsAutoLoginEnabled } = await chrome.storage.local.get("xhsAutoLoginEnabled");
      if (xhsAutoLoginEnabled === true) {
        autoLogin();
      }
    } catch (e) {}
  };

  setTimeout(() => {
    tryAutoLogin();
  }, 500);

  // 监听开关变化，若从关->开，触发一次
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.xhsAutoLoginEnabled) return;
      if (changes.xhsAutoLoginEnabled.newValue === true) {
        tryAutoLogin();
      }
    });
  } catch (e) {}
}

// 百度页面替换为 board.html
if (location.hostname === "www.baidu.com") {
  const replaceWithBoard = async () => {
    try {
      // 获取扩展的基础 URL
      const extensionBaseUrl = chrome.runtime.getURL("");
      
      // 获取 board.html 内容
      const boardHtmlUrl = chrome.runtime.getURL("pages/board.html");
      const response = await fetch(boardHtmlUrl);
      let htmlContent = await response.text();
      
      // 先替换相对路径为绝对路径（在解析前）
      htmlContent = htmlContent.replace(
        /href="\.\.\/styles\/([^"]+)"/g,
        `href="${extensionBaseUrl}styles/$1"`
      );
      htmlContent = htmlContent.replace(
        /src="\.\.\/src\/([^"]+)"/g,
        `src="${extensionBaseUrl}src/$1"`
      );
      
      // 使用 DOMParser 解析 HTML
      const parser = new DOMParser();
      const boardDoc = parser.parseFromString(htmlContent, "text/html");
      
      // 清空当前页面的 body 和 head
      document.body.innerHTML = "";
      document.head.innerHTML = "";
      
      // 复制 board.html 的 head 内容（除了 script）
      const boardHead = boardDoc.head;
      for (const node of boardHead.children) {
        if (node.tagName === "SCRIPT") continue; // 跳过 script，后面单独处理
        const cloned = node.cloneNode(true);
        document.head.appendChild(cloned);
      }
      
      // 复制 board.html 的 body 内容
      document.body.innerHTML = boardDoc.body.innerHTML;
      
      // board.js 已经通过 manifest.json 配置为独立的 content script
      // 但为了确保执行顺序，我们需要等待一下再触发 DOMContentLoaded
      // 使用一个标志来确保 board.js 知道页面已经准备好
      window.__boardPageReady = true;
      
      // 等待 DOM 准备好后触发 DOMContentLoaded 事件
      // 延迟一点确保 board.js 已经加载
      setTimeout(() => {
        const event = new Event("DOMContentLoaded", { bubbles: true });
        document.dispatchEvent(event);
      }, 200);
    } catch (error) {
      console.error("替换百度页面失败:", error);
    }
  };
  
  // 立即执行替换
  replaceWithBoard();
}


