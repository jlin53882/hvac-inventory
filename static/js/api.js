// 庫存管理系統 - API 呼叫層（v8 拆分）
// loadData / updateSubInfo / loadDestinations / saveAll / exportExcel
async function loadData() {
  try {
    const res = await fetch(`/api/items?site=${currentSite}`);
    if (!res.ok) throw new Error('API 錯誤: ' + res.status);
    ALL_ITEMS = await res.json();
    buildBrandTabs();
    buildDatalists();
    checkReminder();
    updateSubInfo();
    renderInventory();
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
    const s = await res.json();
    // 統計單一材料與整組分開算
    const singleCount = ALL_ITEMS.filter(i => !i.is_kit).length;
    const kitCount = ALL_ITEMS.filter(i => i.is_kit).length;
    document.getElementById('sub-info').textContent =
      `單一材料 ${singleCount} 項 · 整組 ${kitCount} 組 · ${s.brands} 種廠牌 · 缺貨 ${s.zero_stock} 項`;

    // 更新頂部分片按鈕的數字（辦公室 / 倉庫）
    try {
      const [officeStats, warehouseStats] = await Promise.all([
        fetch('/api/stats?site=office').then(r => r.json()),
        fetch('/api/stats?site=warehouse').then(r => r.json()),
      ]);
      document.getElementById('site-office-sub').textContent =
        `${officeStats.total_items} 項 · ${officeStats.total_qty}`;
      document.getElementById('site-warehouse-sub').textContent =
        `${warehouseStats.total_items} 項 · ${warehouseStats.total_qty}`;
    } catch {}
  } catch {}
}

// 載入最近 100 筆出庫紀錄的去向 → 建立 destination 下拉建議清單（DESTINATIONS）
async function loadDestinations() {
  try {
    const res = await fetch(`/api/stockouts?limit=100&site=${currentSite}`);
    const outs = await res.json();
    DESTINATIONS = [...new Set(outs.map(o => o.destination).filter(Boolean))];
    document.getElementById('dest-list').innerHTML =
      DESTINATIONS.map(d => `<option value="${esc(d)}">`).join('');
  } catch {}
}

// 將 pending 暫存的所有數量調整逐筆送出（POST /api/items/{id}/adjust），成功後重載資料
async function saveAll() {
  const ids = Object.keys(pending);
  if (!ids.length) return;
  let ok = 0, fail = 0;
  for (const id of ids) {
    try {
      const res = await fetch(`/api/items/${id}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta: pending[id], reason: '手動調整' })
      });
      if (res.ok) ok++; else fail++;
    } catch (e) { fail++; }
  }
  pending = {};
  await loadData();
  if (fail === 0) toast(`✅ 已儲存 ${ok} 項變更`, 'success');
  else toast(`⚠️ ${ok} 成功，${fail} 失敗`, 'error');
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
    a.download = '庫存報表.xlsx';
    a.click();
    URL.revokeObjectURL(url);
    toast('✅ 報表已下載', 'success');
  }).catch(() => toast('匯出失敗', 'error'));
}
