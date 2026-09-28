// 庫存區調撥 modal（固定 DOM 建構，避免把品項資料插入 HTML）
var transferItemId = null;
var transferItemSnapshot = null;
var transferSubmitting = false;

/**
 * 開啟指定品項的調撥對話框，並顯示使用者可讀的庫存區名稱。
 * @param {number|string} itemId 庫存品項識別碼。
 * @returns {void}
 */
function openTransferModal(itemId) {
  if (transferSubmitting) return;
  const item = (ALL_ITEMS || []).find(i => Number(i.id) === Number(itemId));
  if (!item) { toast('找不到要調撥的品項', 'error'); return; }
  transferItemId = item.id;
  transferItemSnapshot = item;
  const submitBtn = document.getElementById('transfer-submit');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = '✅ 確認調撥';
  }
  const modal = document.getElementById('transfer-modal');
  document.getElementById('transfer-item-name').textContent = item.name || '';
  document.getElementById('transfer-item-meta').textContent = `${item.brand || ''} ${item.code || ''} · 目前 ${inventorySiteLabel(item.site || currentSite)}`.trim();
  const target = document.getElementById('transfer-target-site');
  target.replaceChildren();
  INVENTORY_SITES.filter(site => site !== (item.site || currentSite)).forEach(site => {
    const option = document.createElement('option');
    option.value = site;
    option.textContent = ({ office: '🏢 ', warehouse: '🏭 ', van: '🚐 ', truck: '🚚 ' })[site] + inventorySiteLabel(site);
    target.appendChild(option);
  });
  const source = document.getElementById('transfer-source-location');
  source.replaceChildren();
  const allOption = document.createElement('option');
  allOption.value = '__ALL__';
  allOption.textContent = '全部位置';
  source.appendChild(allOption);
  (item.stocks || []).forEach(stock => {
    const option = document.createElement('option');
    option.value = stock.location || '';
    option.textContent = `${stock.location || '未標示'}（可用 ${stock.qty || 0}）`;
    source.appendChild(option);
  });
  source.value = item.stocks && item.stocks.length ? (item.stocks[0].location || '') : '__ALL__';
  document.getElementById('transfer-qty').value = '';
  document.getElementById('transfer-target-location').value = '';
  document.getElementById('transfer-error').textContent = '';
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

function closeTransferModal(force) {
  if (transferSubmitting && !force) return;
  const modal = document.getElementById('transfer-modal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  transferItemId = null;
  transferItemSnapshot = null;
}

function parseTransferQty(raw, unit) {
  if (typeof Qty !== 'undefined') {
    const validation = Qty.validFor(raw, Qty.inputTypeOf(unit));
    if (!validation.ok) return { ok: false, error: validation.error || '請輸入有效的調撥數量' };
    if (validation.value <= 0) return { ok: false, error: '請輸入大於 0 的數量' };
    return { ok: true, value: validation.value };
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, error: '請輸入有效的調撥數量' };
  return { ok: true, value: value };
}

async function submitTransfer() {
  if (!transferItemId || transferSubmitting) return;
  const error = document.getElementById('transfer-error');
  const submitBtn = document.getElementById('transfer-submit');
  const rawQty = document.getElementById('transfer-qty').value.trim();
  const parsedQty = parseTransferQty(rawQty, transferItemSnapshot ? transferItemSnapshot.unit : '');
  if (!parsedQty.ok) { error.textContent = parsedQty.error; return; }
  const qty = parsedQty.value;
  const payload = {
    item_id: transferItemId,
    target_site: document.getElementById('transfer-target-site').value,
    qty,
    source_location: (function() {
      const sourceLocationValue = document.getElementById('transfer-source-location').value;
      return sourceLocationValue === '__ALL__' ? null : sourceLocationValue;
    })(),
    target_location: document.getElementById('transfer-target-location').value.trim(),
  };
  transferSubmitting = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '調撥中…';
  }
  try {
    const res = await fetch('/api/inventory/transfers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `調撥失敗（${res.status}）`);
    }
    closeTransferModal(true);
    toast('庫存調撥完成', 'success');
    if (currentTab === 'inventory') await loadInventoryPage(INVENTORY_META.page || 1);
    else await loadData({ full: true });
  } catch (e) {
    error.textContent = e.message || '調撥失敗，請稍後再試';
  } finally {
    transferSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '✅ 確認調撥';
    }
  }
}
