// 振佳空調管理系統 - 通知 / 異常摘要中心
// 只負責摘要 state、Popover/Bottom Sheet 與既有詳細 Dialog 的導流。
// 不重新查詢商品、不複製庫存判定、不建立通知 API 或資料表。

var NOTIFICATION_OPEN = false;

function getStocktakeReminderState() {
  const user = typeof currentUser !== 'undefined' ? currentUser : null;
  const permissions = user && user.permissions ? user.permissions : {};
  if (!permissions.stocktake) return { visible: false, count: 0 };
  const now = new Date();
  const month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const lastMonth = localStorage.getItem('lastStocktakeMonth');
  return {
    visible: now.getDate() >= 25 && lastMonth !== month,
    count: now.getDate() >= 25 && lastMonth !== month ? 1 : 0,
    month: month,
    todayLabel: (now.getMonth() + 1) + '月' + now.getDate() + '日',
  };
}

function getNotificationSingleCounts() {
  const stats = typeof INVENTORY_META !== 'undefined' ? INVENTORY_META.stats : null;
  const hasStatsItems = stats && Array.isArray(stats.zero_items) && Array.isArray(stats.low_items);
  if (currentTab === 'inventory') {
    if (typeof inventoryLoadedSite !== 'undefined' && inventoryLoadedSite !== currentSite && !hasStatsItems) {
      return { loading: true, out: 0, low: 0 };
    }
    const items = typeof getFilteredInventoryItems === 'function' ? getFilteredInventoryItems() : (ALL_ITEMS || []);
    if (typeof getInventoryDashboardStats === 'function' && stats) {
      const dashboard = getInventoryDashboardStats(items, stats);
      return { loading: false, out: Math.max(0, Number(dashboard.zeroCount) || 0), low: Math.max(0, Number(dashboard.lowCount) || 0) };
    }
    return {
      loading: false,
      out: hasStatsItems ? stats.zero_items.length : 0,
      low: hasStatsItems ? stats.low_items.length : 0,
    };
  }
  if (currentTab === 'stocktake') {
    if (typeof fullItemsLoadedSite !== 'undefined' && fullItemsLoadedSite !== currentSite && !(ALL_ITEMS || []).length) {
      return { loading: true, out: 0, low: 0 };
    }
    const items = Array.isArray(ALL_ITEMS) ? ALL_ITEMS : [];
    const statusOf = typeof getInventoryStatus === 'function'
      ? getInventoryStatus
      : function(item) {
        const qty = Number(item.qty || 0);
        return { isOutOfStock: !item.is_kit && qty <= 0, isLowStock: qty > 0 && Number(item.low_stock || 0) > 0 && qty <= Number(item.low_stock) };
      };
    return {
      loading: false,
      out: items.filter(function(item) { return statusOf(item).isOutOfStock; }).length,
      low: items.filter(function(item) { return statusOf(item).isLowStock; }).length,
    };
  }
  return { loading: false, out: 0, low: 0 };
}

function getNotificationSummary() {
  const categories = [];
  let loading = false;
  if (currentTab === 'inventory' || currentTab === 'stocktake') {
    const counts = getNotificationSingleCounts();
    loading = counts.loading;
    if (!loading) {
      if (counts.out > 0) categories.push({ kind: 'out', tone: 'out', icon: '⛔', label: '缺貨商品', count: counts.out, unit: '項', description: '目前有 ' + counts.out + ' 個品項庫存為 0' });
      if (counts.low > 0) categories.push({ kind: 'low', tone: 'low', icon: '⚠', label: '低庫存商品', count: counts.low, unit: '項', description: '有 ' + counts.low + ' 個品項低於安全庫存' });
    }
  } else if (currentTab === 'kit') {
    const kits = Array.isArray(currentKitItems) ? currentKitItems : [];
    if (typeof fullItemsLoadedSite !== 'undefined' && fullItemsLoadedSite !== currentSite && !kits.length) {
      loading = true;
    } else if (typeof getKitStatus === 'function') {
      const shortage = kits.filter(function(kit) { return getKitStatus(kit).status === 'shortage'; }).length;
      const insufficient = kits.filter(function(kit) { return getKitStatus(kit).status === 'insufficient'; }).length;
      if (shortage > 0) categories.push({ kind: 'shortage', tone: 'kit', icon: '🟣', label: '整組缺料', count: shortage, unit: '組', description: '有 ' + shortage + ' 組設備因材料不足無法完整組裝' });
      if (insufficient > 0) categories.push({ kind: 'insufficient', tone: 'kit-secondary', icon: '🟠', label: '整組庫存不足', count: insufficient, unit: '組', description: '有 ' + insufficient + ' 組設備的材料庫存不足' });
    }
  }
  const reminder = getStocktakeReminderState();
  if (reminder.visible) categories.push({ kind: 'reminder', tone: 'reminder', icon: '📋', label: '月底盤點提醒', count: reminder.count, unit: '則', description: '本月盤點尚未完成' });
  return {
    loading: loading,
    categories: categories,
    total: categories.reduce(function(total, category) { return total + category.count; }, 0),
    relevantScope: currentTab === 'inventory' || currentTab === 'stocktake' || currentTab === 'kit',
  };
}

function updateNotifCount(total) {
  const count = Math.max(0, Number(total) || 0);
  const badge = document.getElementById('notif-badge') || document.querySelector('.notif .cnt');
  const bell = document.getElementById('notif-bell');
  if (badge) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = count > 0 ? 'flex' : 'none';
  }
  if (bell) bell.setAttribute('aria-label', count > 0 ? '通知，目前有 ' + count + ' 項需要注意' : '通知');
}

function renderNotificationCategory(category) {
  const countLabel = String(category.count) + ' ' + category.unit;
  return `<button type="button" class="notif-category is-${esc(category.tone)}" data-notification-kind="${esc(category.kind)}" aria-label="${esc(category.label + ' ' + countLabel)}">
    <span class="notif-category-icon" aria-hidden="true">${esc(category.icon)}</span>
    <span class="notif-category-copy"><strong>${esc(category.label)}</strong><small>${esc(category.description)}</small></span>
    <span class="notif-category-count">${esc(countLabel)}</span><span class="notif-category-arrow" aria-hidden="true">›</span>
  </button>`;
}

function renderNotificationSummary() {
  const list = document.getElementById('notif-list');
  const summaryText = document.getElementById('notif-summary');
  const summary = getNotificationSummary();
  updateNotifCount(summary.total);
  if (summary.loading) {
    if (summaryText) summaryText.textContent = '正在載入異常摘要…';
    if (list) list.innerHTML = '<div class="notif-skeleton" aria-label="載入通知摘要"><span></span><span></span><span></span></div>';
    return summary;
  }
  if (summaryText) summaryText.textContent = summary.total > 0
    ? '目前有 ' + summary.total + ' 項需要注意的事項'
    : '目前沒有需要注意的事項';
  if (!list) return summary;
  list.innerHTML = summary.categories.length
    ? summary.categories.map(renderNotificationCategory).join('')
    : '<div class="notif-normal"><span aria-hidden="true">✓</span><strong>目前沒有庫存異常</strong><small>所有庫存狀態正常</small></div>';
  return summary;
}

function updateNotifications() {
  return renderNotificationSummary();
}

function openNotificationDetail(kind) {
  closeNotif();
  if (kind === 'out') {
    if (currentTab === 'stocktake' && typeof showStocktakeList === 'function') showStocktakeList('zero');
    else if (typeof showInventoryStatusList === 'function') showInventoryStatusList('out');
  } else if (kind === 'low') {
    if (currentTab === 'stocktake' && typeof showStocktakeList === 'function') showStocktakeList('low');
    else if (typeof showInventoryStatusList === 'function') showInventoryStatusList('low');
  } else if (kind === 'shortage' && typeof showKitStatusList === 'function') {
    showKitStatusList('shortage');
  } else if (kind === 'insufficient' && typeof showKitStatusList === 'function') {
    showKitStatusList('insufficient');
  } else if (kind === 'reminder' && typeof switchTab === 'function') {
    switchTab('stocktake');
  }
}

function closeNotif() {
  NOTIFICATION_OPEN = false;
  const panel = document.getElementById('notifPanel');
  const backdrop = document.getElementById('notifBackdrop');
  const bell = document.getElementById('notif-bell');
  if (panel) { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); }
  if (backdrop) { backdrop.classList.remove('open'); backdrop.setAttribute('aria-hidden', 'true'); }
  if (bell) bell.setAttribute('aria-expanded', 'false');
  if (document.body && document.body.classList) document.body.classList.remove('notification-sheet-open');
}

function openNotif() {
  renderNotificationSummary();
  NOTIFICATION_OPEN = true;
  const panel = document.getElementById('notifPanel');
  const backdrop = document.getElementById('notifBackdrop');
  const bell = document.getElementById('notif-bell');
  const mobile = typeof window !== 'undefined' && window.innerWidth < 768;
  if (panel) { panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false'); }
  if (backdrop && mobile) { backdrop.classList.add('open'); backdrop.setAttribute('aria-hidden', 'false'); }
  if (bell) bell.setAttribute('aria-expanded', 'true');
  if (mobile && document.body && document.body.classList) document.body.classList.add('notification-sheet-open');
}

function toggleNotif() {
  if (NOTIFICATION_OPEN) closeNotif();
  else openNotif();
}

function handleNotificationKeydown(event) {
  if (event.key === 'Escape' && NOTIFICATION_OPEN) closeNotif();
}

(function initializeNotificationCenter() {
  const list = document.getElementById('notif-list');
  const backdrop = document.getElementById('notifBackdrop');
  if (list) list.addEventListener('click', function(event) {
    const row = event.target.closest('[data-notification-kind]');
    if (row) openNotificationDetail(row.getAttribute('data-notification-kind'));
  });
  if (backdrop) backdrop.addEventListener('click', closeNotif);
  document.addEventListener('keydown', handleNotificationKeydown);
  document.addEventListener('click', function(event) {
    if (!NOTIFICATION_OPEN) return;
    if (!event.target.closest('.notif') && !event.target.closest('.notif-panel')) closeNotif();
  });
  if (typeof window !== 'undefined') window.addEventListener('resize', function() {
    if (NOTIFICATION_OPEN && window.innerWidth >= 768) {
      const backdropEl = document.getElementById('notifBackdrop');
      if (backdropEl) backdropEl.classList.remove('open');
      if (document.body && document.body.classList) document.body.classList.remove('notification-sheet-open');
    }
  });
})();
