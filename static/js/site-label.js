/**
 * 將內部庫存區識別值轉換為使用者介面顯示名稱。
 * @param {string} site 內部庫存區識別值或使用者提供的位置文字。
 * @returns {string} 顯示名稱；若無法識別，則原樣保留輸入文字。
 */
function inventorySiteLabel(site) {
  const labels = { office: '公司', warehouse: '倉庫', van: '廂型車', truck: '貨車' };
  return labels[site] || site || '';
}
