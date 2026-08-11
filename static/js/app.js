// 庫存管理系統 - 入口控制（v8 拆分）
// 載入順序：globals → utils → api → render/* → modals/* → 本檔（最後觸發啟動）

// ========== 分片切換（辦公室 / 倉庫） ==========
// M15：有未儲存的數量調整 → 切分片/重整前先確認，避免 pending 錯位或靜默丟失
function hasPending() {
  return typeof pending !== 'undefined' && Object.keys(pending).length > 0;
}

function switchSite(site) {
  if (site === currentSite) return;
  if (hasPending() && !confirm('⚠️ 有未儲存的數量調整，切換分片將遺失。確定要切換嗎？')) return;
  currentSite = site;
  document.querySelectorAll('.site-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('site-' + site).classList.add('active');
  loadData();
}

window.addEventListener('beforeunload', (e) => {
  if (!hasPending()) return;
  e.preventDefault();
  e.returnValue = '';
});

// ========== 頁籤切換 ==========
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const nav = document.getElementById('nav-' + tab);
  if (nav) nav.classList.add('active');
  // 行事曆頁不需要庫存搜尋、辦公室/倉庫分片與廠牌 tab（家豪 2026-08-12 指定）
  const isCal = tab === 'calendar';
  const sb = document.querySelector('.search-box');
  const st = document.querySelector('.site-tabs');
  const bt = document.getElementById('brand-tabs');
  if (sb) sb.style.display = isCal ? 'none' : '';
  if (st) st.style.display = isCal ? 'none' : '';
  if (bt) bt.style.display = isCal ? 'none' : '';
  if (tab === 'inventory') renderInventory();
  else if (tab === 'prepared') renderPrepared();
  else if (tab === 'stockout') renderStockOuts();
  else if (tab === 'stocktake') renderStocktake();
  else if (tab === 'kit') renderKits();
  else if (tab === 'calendar') renderCalendar();
}

// 檢查今天日期，每月 25 號（含）後顯示「月底記得盤點」提醒橫幅
function checkReminder() {
  const now = new Date();
  const day = now.getDate();
  const el = document.getElementById('reminder');
  if (day >= 25) {
    el.style.display = 'flex';
    document.getElementById('today-str').textContent =
      `${now.getMonth()+1}月${day}日`;
  } else {
    el.style.display = 'none';
  }
}


document.getElementById('search-input').addEventListener('input', () => {
  if (currentTab === 'inventory') renderInventory();
});

// 啟動：先檢查登入，過關才載資料
(async () => {
  const user = await checkAuth();
  if (user) {
    renderUserMenu(user);
    applyRoleView(user);  // viewer 唯讀模式：隱藏新增/盤點/儲存列等
    if (user.password_expired) openExpiryModal();  // v11.2：6 個月未改密碼 → 提示（非強制）
    loadData();
  } else {
    // checkAuth 回 null = 網路錯誤/伺服器掛（401 已在 checkAuth 內跳登入）→ 顯示錯誤不卡轉圈
    const content = document.getElementById('content');
    if (content) content.innerHTML = '<div class="empty">⚠️ 無法連線伺服器，請重新整理頁面<br><small>若持續發生請聯絡管理員</small></div>';
  }
})();
