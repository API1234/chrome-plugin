// Popup：Switch 控制去广告与 XHS 自动登录，并打开看板
document.addEventListener("DOMContentLoaded", async () => {
  const openBoardBtn = document.getElementById("openBoard");
  const switchAdblock = document.getElementById("switchAdblock");
  const switchXhs = document.getElementById("switchXhs");
  const themeSelect = document.getElementById("themeSelect");

  // 初始化 Switch 状态
  {
    const { adblockEnabled } = await chrome.storage.local.get("adblockEnabled");
    const enabled = adblockEnabled !== false;
    if (switchAdblock) switchAdblock.checked = enabled;
  }
  {
    const { xhsAutoLoginEnabled } = await chrome.storage.local.get("xhsAutoLoginEnabled");
    if (switchXhs) switchXhs.checked = xhsAutoLoginEnabled === true;
  }

  // 去广告开关：更新存储 + 即时更新当前标签页样式
  if (switchAdblock) {
    switchAdblock.addEventListener("change", async () => {
      const enabled = !!switchAdblock.checked;
      await chrome.storage.local.set({ adblockEnabled: enabled });
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (isEnabled) => {
              document.documentElement.classList.toggle("adblock-enabled", isEnabled);
            },
            args: [enabled],
          });
        }
      } catch (e) {}
    });
  }

  // XHS 自动登录开关：仅更新存储，内容脚本监听后触发
  if (switchXhs) {
    switchXhs.addEventListener("change", async () => {
      const enabled = !!switchXhs.checked;
      await chrome.storage.local.set({ xhsAutoLoginEnabled: enabled });
    });
  }

  // 打开看板页
  openBoardBtn.addEventListener("click", async () => {
    try {
      const url = chrome.runtime.getURL("pages/board.html");
      await chrome.tabs.create({ url });
    } catch (e) {}
  });

  // 初始化主题并监听切换
  const applyTheme = (value) => {
    const cls = `theme-${value}`;
    document.documentElement.classList.remove("theme-cyan", "theme-purple", "theme-pink", "theme-green", "theme-slate");
    document.documentElement.classList.add(cls);
  };
  {
    const { themePreset } = await chrome.storage.local.get("themePreset");
    const value = themePreset || "cyan"; // 默认电光青蓝
    if (themeSelect) themeSelect.value = value;
    applyTheme(value);
  }
  if (themeSelect) {
    themeSelect.addEventListener("change", async () => {
      const value = themeSelect.value;
      await chrome.storage.local.set({ themePreset: value });
      applyTheme(value);
    });
  }
});


