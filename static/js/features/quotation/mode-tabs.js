// 報價單頁上方的「報價單 / 報價單上傳」模式切換（報價單頁與報價單上傳頁共用；獨立成葉節點模組避免兩頁互相 import）

export function quoteModeTabs(active) {
  return `<div class="quote-mode-tabs" role="tablist"><button type="button" class="chip chip--seg quote-mode-tab ${active === 'quotation' ? 'is-active' : ''}" onclick="Quotation.quoteSwitchMode('quotation')">🧾 報價單</button><button type="button" class="chip chip--seg quote-mode-tab ${active === 'upload' ? 'is-active' : ''}" onclick="Quotation.quoteSwitchMode('upload')">📤 報價單上傳</button></div>`;
}
