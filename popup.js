// popup.js - 弹窗逻辑

// 获取当前 X 登录用户的用户名，跳转到 following 页面
document.addEventListener('DOMContentLoaded', () => {
  const goBtn = document.getElementById('go-btn');

  // 查询当前 X 页面，获取用户名
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    const url = tab?.url || '';

    // 尝试从 URL 提取用户名
    const match = url.match(/(?:x|twitter)\.com\/([^/]+)/);
    if (match && match[1] && !['home', 'explore', 'notifications', 'messages', 'i'].includes(match[1])) {
      goBtn.href = `https://x.com/${match[1]}/following`;
    } else {
      // 无法确定用户名，跳转到首页
      goBtn.href = 'https://x.com/';
      goBtn.textContent = '🚀 前往 X.com';
    }
  });
});
