// 庫存管理系統 - API 呼叫層（v8 拆分）
// loadData / updateSubInfo / loadDestinations / saveAll / exportExcel
async function loadData() {
  try {
    const res = await fetch(`/api/items?site=${currentSite}`);
    if (!res.ok) throw new Error('API 錯誤: ' + res.status);
    ALL_ITEMS = await res.json();
    buildDatalists();
    checkReminder();
    updateNotifications();
    updateSubInfo();
    switchTab(currentTab);  // 2026-08-13 Sarah：登入預設顯示行事曆（由 currentTab 分派；庫存頁行為不變）
    loadPreparedBadge();  // 剛進網頁就要顯示待領出數量小標
  } catch (e) {
    document.getElementById('content').innerHTML =
      `<div class="empty">⚠️ 無法連線伺服器<br><small>${e.message}</small></div>`;
  }
}

// 抓待領出數量 → 更新底部「📤 待領出」小標（網頁剛進就要顯示）
async function loadPreparedBadge() {
  try {
    const res = await fetch(`/api/prepared?site=${currentSite}`);
    if (!res.ok) return;
    const items = await res.json();
    updatePreparedBadge(items.length);
  } catch {}
}

// 更新頂部統計資訊（單一材料/整組/廠牌/缺貨數 + 分片按鈕數字）
async function updateSubInfo() {
  try {
    const res = await fetch(`/api/stats?site=${currentSite}`);
    if (!res.ok) { console.error('[updateSubInfo] /api/stats 失敗', res.status); return; }
    const s = await res.json();
    // 統計單一材料與整組分開算
    const singleCount = ALL_ITEMS.filter(i => !i.is_kit).length;
    const kitCount = ALL_ITEMS.filter(i => i.is_kit).length;
    document.getElementById('sub-info').textContent =
      `單一材料 ${singleCount} 項 · 整組 ${kitCount} 組 · ${s.brands} 種廠牌 · 缺貨 ${s.zero_stock} 項`;

    // 更新頂部分片按鈕的數字（辦公室 / 倉庫）
    try {
      const [officeStats, warehouseStats] = await Promise.all([
        fetch('/api/stats?site=office').then(r => r.ok ? r.json() : Promise.reject(new Error('stats office ' + r.status))),
        fetch('/api/stats?site=warehouse').then(r => r.ok ? r.json() : Promise.reject(new Error('stats warehouse ' + r.status))),
      ]);
      document.getElementById('site-office-sub').textContent =
        `${officeStats.total_items} 項 · ${officeStats.total_qty}`;
      document.getElementById('site-warehouse-sub').textContent =
        `${warehouseStats.total_items} 項 · ${warehouseStats.total_qty}`;
    } catch (e) { console.error('[updateSubInfo] 分片統計失敗', e); }
  } catch (e) { console.error('[updateSubInfo] 統計失敗', e); }
}

// 載入最近 100 筆出庫紀錄的去向 → 建立 destination 下拉建議清單（DESTINATIONS）
async function loadDestinations() {
  try {
    const res = await fetch(`/api/stockouts?limit=100&site=${currentSite}`);
    if (!res.ok) { console.error('[loadDestinations] /api/stockouts 失敗', res.status); return; }
    const outs = await res.json();
    DESTINATIONS = [...new Set(outs.map(o => o.destination).filter(Boolean))];
    document.getElementById('dest-list').innerHTML =
      DESTINATIONS.map(d => `<option value="${esc(d)}">`).join('');
  } catch (e) { console.error('[loadDestinations] 網路錯誤', e); }
}

// 將 pending 暫存的所有數量調整逐筆送出（POST /api/items/{id}/adjust），成功後重載資料
let savingAll = false;  // in-flight 旗標：防止連點「全部儲存」重複送出同一批調整
async function saveAll() {
  if (savingAll) return;
  const ids = Object.keys(pending);
  if (!ids.length) return;
  savingAll = true;
  const btn = document.getElementById('btn-save');
  if (btn) btn.disabled = true;
  let ok = 0, fail = 0;
  const failed = [];  // 2026-08-14 P4-2：失敗的調整 id 保留（不靜默丟失）
  try {
    for (const id of ids) {
      try {
        const res = await fetch(`/api/items/${id}/adjust`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ delta: pending[id], reason: '手動調整' })
        });
        if (res.ok) ok++;
        else { fail++; failed.push(id); }
      } catch (e) { fail++; failed.push(id); }
    }
    // 2026-08-14 P4-2：只保留失敗的 pending（併發被他人先扣 400 的調整可修正後再存）
    if (failed.length) {
      const kept = {};
      failed.forEach(id => { kept[id] = pending[id]; });
      pending = kept;
    } else {
      pending = {};
    }
    await loadData();
    if (fail === 0) toast(`✅ 已儲存 ${ok} 項變更`, 'success');
    else toast(`⚠️ ${ok} 成功，${fail} 失敗——失敗的調整已保留，可修正後再儲存`, 'error');
  } finally {
    savingAll = false;
    if (btn) btn.disabled = false;
  }
}

// 向 /api/export 索取 Excel 報表並觸發瀏覽器下載，成功/失敗各顯示 toast
function exportExcel() {
  toast('⏳ 產生報表中…');
  fetch('/api/export').then(r => {
    if (!r.ok) throw new Error();
    return r.blob();
  }).then(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date();
    const pad = n => String(n).padStart(2, '0');
    a.download = `庫存報表_${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast('✅ 報表已下載', 'success');
  }).catch(() => toast('匯出失敗', 'error'));
}
