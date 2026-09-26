/**
 * Convert an internal inventory-site key to its UI label.
 * @param {string} site Internal site identifier or user-provided location text.
 * @returns {string} Display label, preserving unrecognized text unchanged.
 */
function inventorySiteLabel(site) {
  const labels = { office: '公司', warehouse: '倉庫', van: '廂型車', truck: '貨車' };
  return labels[site] || site || '';
}
