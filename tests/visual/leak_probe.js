// 跨頁樣式外洩偵測（由 Playwright page.evaluate 執行）
// 參數：{ ownerMap: {css 相對路徑: [允許頁面]|null}, page: 目前頁面名稱 }
// 回傳：[{file, selector}]——目前「可見」元素被「別頁 CSS 檔」的規則命中者。
// ownerMap 值為 null 代表全域檔（layout / components / base），不列入外洩判斷。
({ ownerMap, page }) => {
  const DYNAMIC = /::?(before|after|placeholder|marker|selection|-webkit-[\w-]+|-moz-[\w-]+)|:(hover|focus|focus-visible|focus-within|active|visited|checked|disabled|empty|invalid|valid)\b/g;
  const leaks = new Map();

  function visible(el) {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden';
  }

  // 以頂層逗號切 selector（略過括號內逗號）
  function splitSelectors(text) {
    const out = []; let depth = 0; let buf = '';
    for (const ch of text) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
      buf += ch;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }

  function walk(rules, file) {
    for (const rule of rules) {
      if (rule.cssRules && rule.media) {             // @media
        if (window.matchMedia(rule.media.mediaText).matches) walk(rule.cssRules, file);
        continue;
      }
      if (rule.cssRules && !rule.selectorText) {     // @layer / @supports 等群組
        walk(rule.cssRules, file);
        continue;
      }
      if (!rule.selectorText) continue;
      for (const raw of splitSelectors(rule.selectorText)) {
        const sel = raw.replace(DYNAMIC, '').trim();
        if (!sel) continue;
        let nodes;
        try { nodes = document.querySelectorAll(sel); } catch (e) { continue; }
        for (const el of nodes) {
          if (el.closest('head')) continue;
          if (visible(el)) { leaks.set(file + '|' + raw, { file, selector: raw }); break; }
        }
      }
    }
  }

  for (const sheet of document.styleSheets) {
    if (!sheet.href) continue;
    const file = sheet.href.split('?')[0].split('/static/css/')[1];
    if (!file || !(file in ownerMap)) continue;
    const owner = ownerMap[file];
    if (owner === null || owner.includes(page)) continue;
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    walk(rules, file);
  }
  return [...leaks.values()].sort((a, b) => (a.file + a.selector).localeCompare(b.file + b.selector));
}
