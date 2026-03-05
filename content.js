/**
 * X 互关检测器 - Content Script v2
 *
 * 核心思路：
 * 遍历 /following 页面的用户卡片 DOM，
 * 查找 data-testid="userFollowIndicator" 元素（"关注了你" 标识）
 * 来判断是否互关，无需调用任何 API，避免风控。
 *
 * v2 改动：
 * 1. 工具栏改为悬浮面板（position: fixed 右下角）
 * 2. 新增扫描条数设置（数字输入 / 全部复选框）
 * 3. 扫描结果通过弹窗展示，支持勾选后一键取关
 */

(function () {
  'use strict';

  // ======================= 状态管理 =======================
  const state = {
    checking: false,       // 检测中
    unfollowing: false,    // 取关中
    stopUnfollow: false,   // 停止取关标志
    panelInjected: false,  // 悬浮面板是否已注入
  };

  // ======================= 工具函数 =======================

  /** 随机延迟 (min ~ max 毫秒) */
  function randomDelay(min, max) {
    return new Promise(resolve =>
      setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
    );
  }

  /** 模拟真实鼠标事件点击 */
  function simulateClick(element) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    ['mouseover', 'mousemove', 'mousedown', 'mouseup', 'click'].forEach((eventType, i) => {
      setTimeout(() => {
        element.dispatchEvent(new MouseEvent(eventType, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: centerX + (Math.random() * 4 - 2),
          clientY: centerY + (Math.random() * 4 - 2),
        }));
      }, i * 30 + Math.floor(Math.random() * 20));
    });
  }

  /** 当前页面是否为 following 页面 */
  function isFollowingPage() {
    return /^https?:\/\/(x|twitter)\.com\/[^/]+\/following\/?$/i.test(location.href);
  }

  /** 更新悬浮面板进度文字 */
  function updateProgress(text, show = true) {
    const el = document.getElementById('x-checker-progress');
    if (!el) return;
    el.style.display = show ? 'block' : 'none';
    el.textContent = text;
  }

  /** 更新统计文字 */
  function updateStats(html) {
    const el = document.getElementById('x-checker-stats');
    if (el) el.innerHTML = html;
  }

  /** 获取主列表中已渲染的用户卡片（限定在 primaryColumn 内，排除侧边推荐区） */
  function getUserCells() {
    const root = document.querySelector('[data-testid="primaryColumn"]') || document;
    return Array.from(root.querySelectorAll('[data-testid="UserCell"]'));
  }

  /** 判断用户卡片是否"关注了你" */
  function isFollowingYou(cellEl) {
    if (cellEl.querySelector('[data-testid="userFollowIndicator"]')) return true;
    const text = cellEl.textContent;
    return (
      text.includes('关注了你') ||
      text.includes('Follows you') ||
      text.includes('Vous suit') ||
      text.includes('Te sigue')
    );
  }

  /** 从用户卡片提取 @handle、显示名、头像、简介 */
  function getUserInfo(cellEl) {
    let handle = '';
    let displayName = '';
    let avatarUrl = '';
    let bio = '';

    // 1. 提取 handle（从链接），同时记录 handleLink 备用
    const links = cellEl.querySelectorAll('a[href^="/"]');
    let handleLink = null;
    for (const link of links) {
      const m = link.getAttribute('href')?.match(/^\/([^/?#]+)$/);
      if (m && !['home', 'explore', 'notifications', 'messages', 'settings'].includes(m[1])) {
        handle = '@' + m[1];
        handleLink = link;
        break;
      }
    }

    // 2. 提取显示名
    //    优先：data-testid="User-Name" 容器（旧版 DOM 结构）
    const nameEl = cellEl.querySelector('[data-testid="User-Name"]');
    if (nameEl) {
      const spans = nameEl.querySelectorAll('span');
      for (const s of spans) {
        const t = s.textContent.trim();
        if (t && !t.startsWith('@')) { displayName = t; break; }
      }
    }
    //    降级：从 handle 链接内的 div[dir="ltr"] 提取（新版 DOM 结构）
    if (!displayName && handleLink) {
      const ltrDiv = cellEl.querySelector('div[dir="ltr"]');
      if (ltrDiv) {
        const t = ltrDiv.textContent.trim();
        if (t && !t.startsWith('@')) displayName = t;
      }
    }

    // 3. 提取头像
    const img = cellEl.querySelector('img[src*="profile_images"]');
    if (img) avatarUrl = img.src;

    // 4. 提取简介（bio）：扫描叶子 span，取最长的非 handle/非 displayName 文本
    const rawHandle = handle.replace(/^@/, '');
    let maxLen = 0;
    cellEl.querySelectorAll('span').forEach(span => {
      if (span.children.length > 0) return; // 只取叶子节点
      const t = span.textContent.trim();
      if (
        t.length > maxLen &&
        t.length > 5 &&
        !t.startsWith('@') &&
        t !== displayName &&
        t.toLowerCase() !== rawHandle.toLowerCase()
      ) {
        maxLen = t.length;
        bio = t;
      }
    });

    return { handle, displayName: displayName || handle, avatarUrl, bio };
  }

  /** 获取用户卡片的列表项容器 */
  function getListItem(cellEl) {
    let el = cellEl;
    for (let i = 0; i < 5; i++) {
      if (!el.parentElement) break;
      el = el.parentElement;
      if (
        el.getAttribute('role') === 'listitem' ||
        el.tagName === 'ARTICLE' ||
        el.tagName === 'LI'
      ) return el;
    }
    return cellEl.parentElement;
  }

  // ======================= 悬浮面板注入 =======================

  function injectFloatingPanel() {
    if (document.getElementById('x-floating-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'x-floating-panel';
    panel.innerHTML = `
      <div class="panel-header">
        <span class="panel-title">🔍 互关检测</span>
        <button id="x-panel-toggle" title="折叠/展开">−</button>
      </div>
      <div id="x-panel-body" class="panel-body" style="">
        <div class="scan-limit-row">
          <span class="scan-limit-label">扫描条数</span>
          <input id="x-scan-limit-input" type="number" min="1" max="5000" value="200" placeholder="条数" />
          <label class="scan-all-label">
            <input type="checkbox" id="x-scan-all-check" />
            全部
          </label>
        </div>
        <div class="panel-btn-row">
          <button id="x-check-btn" class="x-checker-btn" title="检查关注列表中哪些人没有回关你">
            🔍 互关检查
          </button>
        </div>
        <div id="x-checker-stats" style="display:none;"></div>
        <div id="x-checker-progress"></div>
      </div>
    `;

    document.body.appendChild(panel);

    // 折叠面板
    let collapsed = false;
    document.getElementById('x-panel-toggle').addEventListener('click', () => {
      collapsed = !collapsed;
      const body = document.getElementById('x-panel-body');
      body.style.display = collapsed ? 'none' : '';
      document.getElementById('x-panel-toggle').textContent = collapsed ? '+' : '−';
    });

    // 全部复选框联动
    document.getElementById('x-scan-all-check').addEventListener('change', function () {
      document.getElementById('x-scan-limit-input').disabled = this.checked;
    });

    // 互关检查按钮
    document.getElementById('x-check-btn').addEventListener('click', startCheck);

    state.panelInjected = true;
    console.log('[X互关检测] 悬浮面板已注入');
  }

  // ======================= 核心检测逻辑 =======================

  async function startCheck() {
    if (state.checking) return;
    state.checking = true;

    const checkBtn = document.getElementById('x-check-btn');
    const statsEl = document.getElementById('x-checker-stats');
    checkBtn.disabled = true;
    checkBtn.innerHTML = '<span class="x-spinner"></span> 检测中...';
    statsEl.style.display = 'none';
    updateProgress('正在滚动加载用户列表...', true);

    // 读取扫描条数
    const scanAll = document.getElementById('x-scan-all-check').checked;
    const limitInput = parseInt(document.getElementById('x-scan-limit-input').value, 10);
    const limit = scanAll ? Infinity : (isNaN(limitInput) || limitInput < 1 ? 200 : limitInput);

    // 自动滚动加载，边滚边解析，返回去重后的完整用户列表
    const allUsers = await autoScrollAndLoad(limit);

    // 统计结果（已在滚动过程中完成解析，无需再遍历 DOM）
    updateProgress('正在汇总结果...', true);
    const total = allUsers.length;
    const notFollowingUsers = allUsers.filter(u => !u.followsYou); // { handle, displayName, avatarUrl }
    const mutualCount = total - notFollowingUsers.length;
    const notFollowingCount = notFollowingUsers.length;

    // 更新统计
    state.checking = false;
    updateProgress('', false);
    statsEl.style.display = 'block';
    updateStats(
      `共 <span class="stat-count">${total}</span> 人 · ` +
      `互关 <span class="stat-count" style="color:#1d9bf0">${mutualCount}</span> 人 · ` +
      `未回关 <span class="stat-count">${notFollowingCount}</span> 人`
    );

    checkBtn.disabled = false;
    checkBtn.innerHTML = '🔄 重新检查';

    console.log(`[X互关检测] 完成：总计 ${total}，互关 ${mutualCount}，未回关 ${notFollowingCount}`);

    // 展示弹窗
    if (notFollowingCount > 0) {
      showUnfollowModal(notFollowingUsers);
    } else {
      updateProgress('✅ 太好了！所有人都关注了你。', true);
    }
  }

  /**
   * 自动向下滚动并实时采集用户数据（边滚边解析，handle 去重）
   * X 平台使用虚拟滚动，DOM 卡片会动态注入/移除，必须在每次滚动后立即解析。
   * @param {number} limit - 最多采集的用户数（Infinity = 全部）
   * @returns {{ handle: string, displayName: string, avatarUrl: string, followsYou: boolean }[]}
   */
  async function autoScrollAndLoad(limit) {
    const maxScrollAttempts = limit === Infinity ? 200 : 100;
    let attempts = 0;
    let noChangeCount = 0;

    // 用 handle 作为 key 去重，value 存用户信息
    const collected = new Map(); // handle -> { displayName, avatarUrl, followsYou }

    function parseCurrentCells() {
      const cells = getUserCells();
      let newAdded = 0;
      for (const cell of cells) {
        const info = getUserInfo(cell);
        if (!info.handle) continue;
        if (!collected.has(info.handle)) {
          collected.set(info.handle, {
            displayName: info.displayName,
            avatarUrl: info.avatarUrl,
            followsYou: isFollowingYou(cell),
          });
          newAdded++;
        }
      }
      return newAdded;
    }

    while (attempts < maxScrollAttempts) {
      const newAdded = parseCurrentCells();
      const total = collected.size;

      // 达到条数限制则停止
      if (total >= limit) {
        updateProgress(`已达到设定条数 ${limit}，停止加载`, true);
        break;
      }

      if (newAdded === 0) {
        noChangeCount++;
        if (noChangeCount >= 3) break; // 连续3次无新增，认为加载完毕
      } else {
        noChangeCount = 0;
      }

      updateProgress(
        `正在加载用户列表... 已采集 ${total} 个${limit !== Infinity ? ' / ' + limit : ''}`,
        true
      );

      window.scrollBy({ top: 600 + Math.floor(Math.random() * 400), behavior: 'smooth' });
      await randomDelay(800, 1800);
      attempts++;
    }

    // 最后再解析一次当前可见的卡片，避免遗漏
    parseCurrentCells();

    window.scrollTo({ top: 0, behavior: 'smooth' });
    await randomDelay(500, 1000);

    return Array.from(collected.entries()).map(([handle, data]) => ({
      handle,
      displayName: data.displayName,
      avatarUrl: data.avatarUrl,
      followsYou: data.followsYou,
    }));
  }

  // ======================= 弹窗逻辑 =======================

  /**
   * 展示"未回关用户"弹窗
   * @param {{ handle: string, displayName: string, avatarUrl: string }[]} users
   */
  function showUnfollowModal(users) {
    // 移除旧弹窗
    document.getElementById('x-modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'x-modal-overlay';
    overlay.innerHTML = `
      <div id="x-unfollow-modal">
        <div class="modal-header">
          <div>
            <div class="modal-title">🚫 未回关用户列表</div>
            <div class="modal-subtitle">共 ${users.length} 人未回关，勾选后点击按钮取关</div>
          </div>
          <button class="modal-close-btn" id="x-modal-close-btn" title="关闭">✕</button>
        </div>

        <div class="modal-user-list" id="x-modal-user-list">
          ${users.map((u, idx) => buildUserRowHTML(u, idx)).join('')}
        </div>

        <div class="modal-footer">
          <div class="modal-footer-actions">
            <label class="modal-select-all-label">
              <input type="checkbox" id="x-modal-select-all" checked />
              全选
            </label>
            <span style="font-size:12px;color:#6e7680;" id="x-modal-selected-count">已选 ${users.length} 人</span>
            <button id="x-modal-stop-btn">⏹️ 停止取关</button>
            <button id="x-modal-unfollow-btn">🗑️ 一键取关已选</button>
          </div>
          <div id="x-modal-progress"></div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // 关闭弹窗
    document.getElementById('x-modal-close-btn').addEventListener('click', () => {
      if (state.unfollowing) {
        if (!confirm('取关正在进行中，确定要关闭弹窗吗？')) return;
        state.stopUnfollow = true;
      }
      overlay.remove();
    });

    // 点遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        if (state.unfollowing) return;
        overlay.remove();
      }
    });

    // 全选联动
    const selectAllChk = document.getElementById('x-modal-select-all');
    selectAllChk.addEventListener('change', function () {
      document.querySelectorAll('.modal-user-chk').forEach(chk => {
        chk.checked = this.checked;
      });
      updateSelectedCount(users.length);
    });

    // 单行复选框联动
    document.getElementById('x-modal-user-list').addEventListener('change', (e) => {
      if (e.target.classList.contains('modal-user-chk')) {
        updateSelectedCount(users.length);
        const allChecked = document.querySelectorAll('.modal-user-chk:not(:checked)').length === 0;
        selectAllChk.checked = allChecked;
      }
    });

    // 点击行也可以触发勾选
    document.querySelectorAll('.modal-user-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.type === 'checkbox') return;
        const chk = row.querySelector('.modal-user-chk');
        if (chk) {
          chk.checked = !chk.checked;
          chk.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });

    // 停止取关
    document.getElementById('x-modal-stop-btn').addEventListener('click', () => {
      state.stopUnfollow = true;
      document.getElementById('x-modal-stop-btn').textContent = '正在停止...';
    });

    // 一键取关
    document.getElementById('x-modal-unfollow-btn').addEventListener('click', () => {
      startModalUnfollow(users);
    });
  }

  /** 构建单条用户行 HTML */
  function buildUserRowHTML(info, idx) {
    const initial = (info.displayName || info.handle || '?')[0].toUpperCase();
    const avatarContent = info.avatarUrl
      ? `<img src="${info.avatarUrl}" alt="${initial}" />`
      : initial;

    const bioHtml = info.bio
      ? `<div class="modal-user-bio">${escapeHtml(info.bio)}</div>`
      : '';

    return `
      <div class="modal-user-row" data-idx="${idx}">
        <input type="checkbox" class="modal-user-chk" data-idx="${idx}" checked />
        <div class="modal-user-avatar">${avatarContent}</div>
        <div class="modal-user-info">
          <div class="modal-user-name">${escapeHtml(info.displayName)}</div>
          <div class="modal-user-handle">${escapeHtml(info.handle)}</div>
          ${bioHtml}
        </div>
        <div class="modal-user-status" id="x-user-status-${idx}"></div>
      </div>
    `;
  }

  /** HTML 转义 */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 更新已选人数显示 */
  function updateSelectedCount(total) {
    const checked = document.querySelectorAll('.modal-user-chk:checked').length;
    const el = document.getElementById('x-modal-selected-count');
    if (el) el.textContent = `已选 ${checked} / ${total} 人`;
  }

  /** 弹窗内进度更新 */
  function updateModalProgress(text) {
    const el = document.getElementById('x-modal-progress');
    if (el) el.textContent = text;
  }

  /**
   * 在弹窗内执行一键取关（只处理勾选的用户）
   */
  async function startModalUnfollow(users) {
    if (state.unfollowing) return;

    // 获取勾选的用户
    const checkedIdxs = Array.from(document.querySelectorAll('.modal-user-chk:checked'))
      .map(chk => parseInt(chk.dataset.idx, 10));

    if (checkedIdxs.length === 0) {
      alert('请先勾选要取关的用户！');
      return;
    }

    const targets = checkedIdxs.map(idx => users[idx]);

    state.unfollowing = true;
    state.stopUnfollow = false;

    const unfollowBtn = document.getElementById('x-modal-unfollow-btn');
    const stopBtn = document.getElementById('x-modal-stop-btn');
    const closeBtn = document.getElementById('x-modal-close-btn');
    unfollowBtn.disabled = true;
    unfollowBtn.innerHTML = '<span class="x-spinner"></span> 取关中...';
    stopBtn.style.display = 'inline-flex';
    closeBtn.disabled = true;

    let successCount = 0;

    for (let i = 0; i < targets.length; i++) {
      if (state.stopUnfollow) {
        updateModalProgress(`已停止，共取关 ${successCount} 人`);
        break;
      }

      const user = targets[i];
      const originalIdx = users.indexOf(user);
      const statusEl = document.getElementById(`x-user-status-${originalIdx}`);
      const row = document.querySelector(`.modal-user-row[data-idx="${originalIdx}"]`);

      updateModalProgress(`取关进度 ${i + 1} / ${targets.length}：正在处理 ${user.handle}...`);

      if (statusEl) { statusEl.className = 'modal-user-status active'; statusEl.textContent = '处理中...'; }
      if (row) row.classList.add('x-unfollowing-active');

      // 通过 handle 在当前 DOM 中查找卡片（虚拟滚动：需先滚动到目标位置）
      const cell = await findCellByHandle(user.handle);
      const success = await unfollowUser(cell);

      if (row) row.classList.remove('x-unfollowing-active');

      if (success) {
        successCount++;
        if (statusEl) { statusEl.className = 'modal-user-status done'; statusEl.textContent = '✓ 已取关'; }
        if (row) row.classList.add('unfollowed-done');
      } else {
        if (statusEl) { statusEl.className = 'modal-user-status'; statusEl.textContent = '✗ 失败'; }
      }

      await randomDelay(2000, 5000);
    }

    state.unfollowing = false;
    unfollowBtn.disabled = false;
    unfollowBtn.innerHTML = '🗑️ 一键取关已选';
    stopBtn.style.display = 'none';
    stopBtn.textContent = '⏹️ 停止取关';
    closeBtn.disabled = false;

    if (!state.stopUnfollow) {
      updateModalProgress(`✅ 取关完成，共取关 ${successCount} 人`);
    }
  }

  // ======================= 取关单个用户 =======================

  /**
   * 通过 handle 在当前 DOM 中查找对应用户卡片
   * 由于虚拟滚动，卡片可能还未渲染，需要滚动后等待
   */
  async function findCellByHandle(handle) {
    const rawHandle = handle.replace(/^@/, '').toLowerCase();
    for (let attempt = 0; attempt < 10; attempt++) {
      const cells = getUserCells();
      for (const cell of cells) {
        const links = cell.querySelectorAll('a[href^="/"]');
        for (const link of links) {
          const m = link.getAttribute('href')?.match(/^\/([^/?#]+)$/);
          if (m && m[1].toLowerCase() === rawHandle) return cell;
        }
      }
      // 卡片未出现，缓慢向下滚动等待虚拟列表渲染
      window.scrollBy({ top: 300, behavior: 'smooth' });
      await randomDelay(600, 1000);
    }
    console.warn(`[X互关检测] 未能在 DOM 中找到用户卡片: ${handle}`);
    return null;
  }

  async function unfollowUser(cellEl) {
    if (!cellEl) return false;
    try {
      const listItem = getListItem(cellEl);
      if (listItem) {
        listItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await randomDelay(400, 900);
      }

      const followBtn = findFollowingButton(cellEl);
      if (!followBtn) {
        console.warn('[X互关检测] 未找到取关按钮', cellEl);
        return false;
      }

      simulateClick(followBtn);
      await randomDelay(800, 1500);

      const confirmed = await waitAndClickConfirm();
      return confirmed;
    } catch (err) {
      console.error('[X互关检测] 取关出错', err);
      return false;
    }
  }

  function findFollowingButton(cellEl) {
    const btn = cellEl.querySelector('[data-testid$="-unfollow"]');
    if (btn) return btn;

    const allBtns = cellEl.querySelectorAll('button');
    for (const b of allBtns) {
      const txt = b.textContent.trim();
      if (txt === 'Following' || txt === '正在关注' || txt.includes('Following')) return b;
    }

    const divBtns = cellEl.querySelectorAll('[role="button"]');
    for (const b of divBtns) {
      const txt = b.textContent.trim();
      if (txt.includes('Following') || txt.includes('正在关注')) return b;
    }

    return null;
  }

  async function waitAndClickConfirm(maxWait = 3000) {
    const interval = 100;
    let waited = 0;
    while (waited < maxWait) {
      const confirmBtn =
        document.querySelector('[data-testid="confirmationSheetConfirm"]') ||
        document.querySelector('[data-testid="unfollow-primary-action"]');
      if (confirmBtn) {
        await randomDelay(200, 500);
        simulateClick(confirmBtn);
        return true;
      }
      await new Promise(r => setTimeout(r, interval));
      waited += interval;
    }
    console.warn('[X互关检测] 等待确认弹窗超时');
    return false;
  }

  // ======================= 页面监听与初始化 =======================

  let lastUrl = location.href;
  let initTimer = null;

  function tryInit() {
    clearTimeout(initTimer);
    initTimer = setTimeout(() => {
      if (!isFollowingPage()) {
        // 离开 following 页面，隐藏悬浮面板
        const panel = document.getElementById('x-floating-panel');
        if (panel) panel.style.display = 'none';
        return;
      }

      // 确保悬浮面板存在且可见
      const existingPanel = document.getElementById('x-floating-panel');
      if (existingPanel) {
        existingPanel.style.display = '';
        return;
      }

      // 等待用户列表渲染
      const cells = getUserCells();
      if (cells.length === 0) {
        setTimeout(tryInit, 800);
        return;
      }

      injectFloatingPanel();
    }, 500);
  }

  /** 监听 SPA 路由变化 */
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      state.panelInjected = false;
      tryInit();
    } else if (isFollowingPage() && !document.getElementById('x-floating-panel')) {
      tryInit();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  tryInit();

  console.log('[X互关检测器 v2] 插件已启动，等待进入 /following 页面...');
})();
