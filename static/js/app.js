// 振佳空調庫存管理系統 - 入口控制（v8 拆分）
// 載入順序：globals → utils → api → render/* → modals/* → 本檔（最後觸發啟動）

// ========== 分片切換（辦公室 / 倉庫） ==========
function switchSite(site) {
  if (site === currentSite) return;
  currentSite = site;
  document.querySelectorAll('.site-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('site-' + site).classList.add('active');
  loadData();
}

// ========== 頁籤切換 ==========
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const nav = document.getElementById('nav-' + tab);
  if (nav) nav.classList.add('active');
  if (tab === 'inventory') renderInventory();
  else if (tab === 'prepared') renderPrepared();
  else if (tab === 'stockout') renderStockOuts();
  else if (tab === 'stocktake') renderStocktake();
  else if (tab === 'kit') renderKits();
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

// 啟動
loadData();
