// 庫存管理系統 - 頂部搜尋框關鍵字比對（庫存、整組、待領出等頁共用）

export function filterBySearch(items, matchFn) {

  var raw = document.getElementById('search-input').value.trim().toLowerCase();

  var kws = raw ? raw.split(/\s+/).filter(function(w) { return w.length > 0; }) : [];

  if (kws.length === 0) return items;

  return items.filter(function(item) {

    var hay = matchFn(item).toLowerCase();

    return kws.every(function(kw) { return hay.indexOf(kw) >= 0; });

  });

}
