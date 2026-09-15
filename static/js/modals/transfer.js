// 庫存區調撥 modal（固定 DOM 建構，避免把品項資料插入 HTML）
var transferItemId = null;

function openTransferModal(itemId) {
  const item = (ALL_ITEMS || []).find(i => Number(i.id) === Number(itemId));
  if (!item) { toast('找不到要調撥的品項', 'error'); return; }
  transferItemId = item.id;
  const modal = document.getElementById('transfer-modal');
  document.getElementById('transfer-item-name').textContent = item.name || '';
  document.getElementById('transfer-item-meta').textContent = `${item.brand || ''} ${item.code || ''} · 目前 ${item.site || currentSite}`.trim();
  const target = document.getElementById('transfer-target-site');
  target.replaceChildren();
  INVENTORY_SITES.filter(site => site !== (item.site || currentSite)).forEach(site => {
    const option = document.createElement('option');
    option.value = site;
    option.textContent = ({ office: '🏢 辦公室', warehouse: '🏭 倉庫', van: '🚐 廂型車', truck: '🚚 貨車' })[site];
    target.appendChild(option);
  });
  const source = document.getElementById('transfer-source-location');
  source.replaceChildren();
  (item.stocks || []).forEach(stock => {
    const option = document.createElement('option');
    option.value = stock.location || '';
    option.textContent = `${stock.location || '未標示'}（可用 ${stock.qty || 0}）`;
    source.appendChild(option);
  });
  if (!source.options.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '全部位置';
    source.appendChild(option);
  }
  document.getElementById('transfer-qty').value = '';
  document.getElementById('transfer-target-location').value = '';
  document.getElementById('transfer-error').textContent = '';
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

function closeTransferModal() {
  const modal = document.getElementById('transfer-modal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  transferItemId = null;
}

async function submitTransfer() {
  if (!transferItemId) return;
  const error = document.getElementById('transfer-error');
  const qty = Number(document.getElementById('transfer-qty').value);
  if (!Number.isFinite(qty) || qty <= 0) { error.textContent = '請輸入大於 0 的數量'; return; }
  const payload = {
    item_id: transferItemId,
    target_site: document.getElementById('transfer-target-site').value,
    qty,
    source_location: document.getElementById('transfer-source-location').value || null,
    target_location: document.getElementById('transfer-target-location').value.trim(),
  };
  try {
    const res = await fetch('/api/inventory/transfers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `調撥失敗（${res.status}）`);
    }
    closeTransferModal();
    toast('庫存調撥完成', 'success');
    if (currentTab === 'inventory') loadInventoryPage(INVENTORY_META.page || 1);
    else loadData({ full: true });
  } catch (e) {
    error.textContent = e.message || '調撥失敗，請稍後再試';
  }
}
