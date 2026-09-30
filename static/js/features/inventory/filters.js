// 庫存管理系統 - 庫存篩選（品牌 / 分類 chips、篩選面板）

import { loadInventoryPage } from '../shell/data-refresh.js';
import { appState } from '../../core/state.js';
import { getCurrentBrands, getCurrentCategories, setCurrentBrands, setCurrentCategories } from '../../core/shared-read-model.js';
import { getAllItems, getInventoryFacets, getInventoryMeta } from '../../core/inventory-read-model.js';
import { esc } from '../../core/utils.js';

export function getInventoryFilterKeywords() {
  const searchInput = document.getElementById('search-input');
  const raw = searchInput ? searchInput.value.trim().toLowerCase() : '';
  return raw ? raw.split(/\s+/).filter(function(w) { return w.length > 0; }) : [];
}

export function inventoryItemMatchesCurrentFilters(item, keywords) {
  if (item.is_kit) return false;
  if (typeof appState.currentSite !== 'undefined' && item.site && item.site !== appState.currentSite) return false;
  if (getCurrentBrands().length > 0 && getCurrentBrands().indexOf(item.brand || '無廠牌') < 0) return false;
  if (getCurrentCategories().length > 0 && getCurrentCategories().indexOf(item.category || '') < 0) return false;
  if (keywords.length > 0) {
    const stockStr = (item.stocks || []).map(function(s) { return s.location + ' ' + s.note; }).join(' ').toLowerCase();
    let hay = (item.name || '') + ' ' + (item.code || '') + ' ' + (item.brand || '') + ' ' + stockStr;
    hay = hay.toLowerCase();
    if (!keywords.every(function(keyword) { return hay.indexOf(keyword) >= 0; })) return false;
  }
  return true;
}

// 回傳符合當前搜尋 + 品牌 + 分類篩選的非整組品項（供全選 / render 共用）
export function getFilteredInventoryItems() {
  const keywords = getInventoryFilterKeywords();
  return getAllItems().filter(function(item) {
    return inventoryItemMatchesCurrentFilters(item, keywords);
  });
}


function renderInventoryChips() {
  const brands = [...new Set(getAllItems().filter(i => !i.is_kit).map(i => i.brand || '無廠牌'))].sort();
  const cats = [...new Set(getAllItems().filter(i => !i.is_kit).map(i => i.category || '').filter(Boolean))].sort();
  let h = '<div class="chip-bar">';
  h += '<span class="chip' + (getCurrentBrands().length === 0 ? ' is-active' : '') + '" data-action="inventory-brand-toggle" data-value="">全部廠牌</span>';
  brands.forEach(b => { h += '<span class="chip' + (getCurrentBrands().includes(b) ? ' is-active' : '') + '" data-action="inventory-brand-toggle" data-value="' + esc(b) + '">' + esc(b) + '</span>'; });
  h += '</div>';
  h += '<div class="chip-bar">';
  h += '<span class="chip' + (getCurrentCategories().length === 0 ? ' is-active' : '') + '" data-action="inventory-category-toggle" data-value="">全部分類</span>';
  cats.forEach(c => { h += '<span class="chip' + (getCurrentCategories().includes(c) ? ' is-active' : '') + '" data-action="inventory-category-toggle" data-value="' + esc(c) + '">' + esc(c) + '</span>'; });
  h += '</div>';
  return h;
}



// ========== 篩選面板（品牌+分類 chips） ==========

var filterExpandedState = { brand: false, category: false };

/**
 * 根據容器寬度動態計算可顯示的 chips 個數（含「全部」）。
 * 每個 chip 估算寬度 ~90px（含間距），根據容器實際寬度決定截斷。
 * 如果容器寬度為 0（尚未渲染或隱藏），回傳一個合理的預設值。
 */
function calculateVisibleChipsCount(containerId) {
  var el = document.getElementById(containerId);
  if (!el) return 999;  // 容器不存在，視為無限制

  var containerWidth = el.offsetWidth;
  // 如果容器寬度為 0，使用視窗寬度作為備選值
  if (containerWidth <= 0) {
    containerWidth = window.innerWidth * 0.8;  // 假設容器佔視窗 80% 寬度
  }

  var estimatedChipWidth = 90;  // 每個 chip 約 90px（含 margin/padding）
  var visibleCount = Math.max(1, Math.floor(containerWidth / estimatedChipWidth));

  return visibleCount;
}

export function buildFilterPanel() {
  // 確保篩選面板容器存在，否則跳過（會在 renderInventory 時再次呼叫）
  var brandChipsEl = document.getElementById('fp-brand-chips');
  var catChipsEl = document.getElementById('fp-cat-chips');

  if (!brandChipsEl || !catChipsEl) {
    return;  // 容器還未渲染，直接返回（不延遲重試）
  }

  try {
    var facets = getInventoryFacets();
    // facets 是 read-model 的 live reference：只讀。沒有 facets 時才用品項自己算，且必須算進新物件，不能寫進 facets.brands
    var brandCounts = facets && facets.brands && Object.keys(facets.brands).length ? facets.brands : null;
    if (!brandCounts) {
      brandCounts = {};
      getAllItems().filter(function(i) { return !i.is_kit; }).forEach(function(i) {
        var b = i.brand || '無廠牌';
        brandCounts[b] = (brandCounts[b] || 0) + 1;
      });
    }
    var brands = Object.entries(brandCounts).sort(function(a, b) { return b[1] - a[1]; });
    document.getElementById('fp-brand-count').textContent = '(' + brands.length + ' 個品牌)';
    renderFilterChips('fp-brand-chips', brands, getCurrentBrands(), 'brand', 'fp-brand-toggle');

    var catCounts = facets && facets.categories && Object.keys(facets.categories).length ? facets.categories : null;
    if (!catCounts) {
      catCounts = {};
      getAllItems().filter(function(i) { return !i.is_kit; }).forEach(function(i) {
        var c = i.category || '';
        if (c) catCounts[c] = (catCounts[c] || 0) + 1;
      });
    }
    var cats = Object.entries(catCounts).sort(function(a, b) { return b[1] - a[1]; });
    document.getElementById('fp-cat-count').textContent = '(' + cats.length + ' 類)';
    renderFilterChips('fp-cat-chips', cats, getCurrentCategories(), 'category', 'fp-cat-toggle');
    var list = getFilteredItems();
    document.getElementById('fp-summary').textContent = '共 ' + (getInventoryMeta().total || list.length) + ' 項';
  } catch (e) {
    console.warn('buildFilterPanel error:', e.message);
  }
}


/**
 * 渲染篩選 chips，根據容器寬度動態決定是否截斷。
 * @param {string} containerId - 容器元素 ID
 * @param {Array} counts - [名稱, 計數] 的陣列
 * @param {Array} selectedArr - 目前選中的值陣列（read-model 的 live reference：這裡只讀，不得修改；
 *   點擊 chip 由 data-action 委派到 toggleInventoryBrand / toggleInventoryCategory，經 setter 寫入）
 * @param {string} type - 篩選類型（'brand' 或 'category'）
 * @param {string} toggleBtnId - 展開/收合按鈕 ID
 */
function renderFilterChips(containerId, counts, selectedArr, type, toggleBtnId) {

  var el = document.getElementById(containerId);
  if (!el) return;

  var toggleAction = type === 'brand' ? 'inventory-brand-toggle' : 'inventory-category-toggle';
  el.innerHTML = '';
  el.classList.toggle('is-collapsed', !filterExpandedState[type]);

  var allChip = document.createElement('span');

  allChip.className = 'chip filter-chip' + (selectedArr.length === 0 ? ' is-active' : '');

  allChip.textContent = '全部';

  allChip.dataset.action = toggleAction;
  allChip.dataset.value = '';

  el.appendChild(allChip);

  // 判定容器寬度是否足夠顯示全部 chips
  var isCollapsed = el.classList.contains('is-collapsed');
  var visibleCount = calculateVisibleChipsCount(containerId);
  var totalChipsNeeded = counts.length + 1;  // 包含「全部」

  // 如果寬度足以顯示全部 chips，則無論 collapsed 狀態都全部顯示
  var canDisplayAll = visibleCount >= totalChipsNeeded;
  var shouldDisplayAll = canDisplayAll || !isCollapsed;

  var chipsAdded = 1;  // 已加入「全部」
  counts.forEach(function(pair) {

    if (!shouldDisplayAll && chipsAdded >= visibleCount) return;  // 達到顯示限制（只在非全部顯示時截斷）

    var name = pair[0], count = pair[1];

    var chip = document.createElement('span');

    var isSelected = selectedArr.includes(name);

    chip.className = 'chip filter-chip' + (isSelected ? ' is-active' : '');

    chip.innerHTML = esc(name) + ' <span class="badge">' + count + '</span>';

    chip.dataset.action = toggleAction;
    chip.dataset.value = name;

    el.appendChild(chip);
    chipsAdded++;

  });

  // 更新展開/收合按鈕的文字
  if (toggleBtnId) {

    var btn = document.getElementById(toggleBtnId);

    if (btn) {
      // 如果寬度足以顯示全部，按鈕隱藏或顯示為「無截斷」
      if (canDisplayAll) {
        btn.classList.add('hidden');  // 寬度足夠，隱藏按鈕
      } else {
        btn.classList.remove('hidden');  // 顯示按鈕
        var hidden = counts.length - (visibleCount - 1);
        if (hidden > 0 && isCollapsed) {
          btn.textContent = '還有 ' + hidden + ' 個' + (type === 'brand' ? '品牌' : '分類') + ' ▼';
        } else {
          btn.textContent = isCollapsed ? '展開 ▼' : '收合 ▲';
        }
      }
    }

  }

}



function getFilteredItems() {

  var raw = document.getElementById('search-input').value.trim().toLowerCase();

  var kws = raw ? raw.split(/\s+/).filter(function(w) { return w.length > 0; }) : [];

  var list = getAllItems().filter(function(i) { return !i.is_kit; });

  if (getCurrentBrands().length > 0) list = list.filter(function(i) { return getCurrentBrands().includes(i.brand || '無廠牌'); });

  if (getCurrentCategories().length > 0) list = list.filter(function(i) { return getCurrentCategories().includes(i.category || ''); });

  if (kws.length > 0) {

    list = list.filter(function(i) {

      var stockStr = (i.stocks || []).map(function(s) { return s.location + ' ' + s.note; }).join(' ').toLowerCase();

      var hay = ((i.name || '') + ' ' + (i.code || '') + ' ' + (i.brand || '') + ' ' + stockStr).toLowerCase();

      return kws.every(function(kw) { return hay.indexOf(kw) >= 0; });

    });

  }

  return list;

}



export function toggleFilterCollapse(containerId, toggleBtnId) {

  var el = document.getElementById(containerId);

  var btn = document.getElementById(toggleBtnId);

  var isCollapsed = el.classList.toggle('is-collapsed');
  var filterType = containerId === 'fp-brand-chips' ? 'brand' : 'category';
  filterExpandedState[filterType] = !isCollapsed;

  // 重新重繪篩選 chips（更新顯示個數與按鈕文字）
  buildFilterPanel();

}



export function clearFilterPanel() {
  setCurrentBrands([]);
  setCurrentCategories([]);
  document.getElementById('search-input').value = '';
  loadInventoryPage(1);
}


// ========== Chip 篩選 toggler ==========
export function toggleInventoryBrand(brand) {
  if (!brand) { setCurrentBrands([]); }
  else {
    var brands = getCurrentBrands();
    setCurrentBrands(brands.includes(brand) ? brands.filter(function(b) { return b !== brand; }) : brands.concat(brand));
  }
  loadInventoryPage(1);
}
export function toggleInventoryCategory(cat) {
  if (!cat) { setCurrentCategories([]); }
  else {
    var cats = getCurrentCategories();
    setCurrentCategories(cats.includes(cat) ? cats.filter(function(c) { return c !== cat; }) : cats.concat(cat));
  }
  loadInventoryPage(1);
}

// ========== 響應式篩選面板重新計算 ==========
// 視窗大小改變時，重新計算並渲染篩選 chips（品牌與分類）
var filterPanelResizeTimer = null;

// 模組載入時要執行的副作用：由頁面 entry 依原本的載入順序呼叫（issue #39）
export function initInventoryFilters() {
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', function() {
      // 防止頻繁重新渲染，延遲 300ms 後才執行
      clearTimeout(filterPanelResizeTimer);
      filterPanelResizeTimer = setTimeout(function() {
        var brandEl = document.getElementById('fp-brand-chips');
        var catEl = document.getElementById('fp-cat-chips');
        // 如果篩選面板存在，重新計算 chips 顯示個數
        if (brandEl || catEl) {
          buildFilterPanel();
        }
      }, 300);
    });
  }
}
