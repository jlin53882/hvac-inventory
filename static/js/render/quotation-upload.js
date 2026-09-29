// 庫存管理系統 - 報價單上傳頁（2026-09-07 v2 對齊 demo）
// 畫面與行為由 render/upload-list.js 的共用「檔案上傳清單」提供；本檔只放本頁設定。
// 權限：登入可查/預覽/下載/上傳；編輯/刪除直接消費 backend final capabilities

var QuotationUploads = createUploadListPage({
  global: 'QuotationUploads',
  api: '/api/quotation-uploads',
  // data-page 由 setPageScope 維護：切回報價單模式（或啟動流程重新掛載）後，進行中的上傳頁渲染必須停止
  isActive: () => currentTab === 'quotation' && document.body.dataset.page === 'quotation-upload',
  title: '報價單上傳',
  uploadLabel: '報價單',
  editTitle: '編輯報價單上傳',
  kpiIcons: { archived: '🧾', rate: '📊' },
  uploadPermission: null,
  headerHtml: () => quoteModeTabs('upload'),
});

// 渲染報價單上傳頁面（quotation.js quoteSwitchMode('upload') 呼叫）
function renderQuotationUploads() {
  return QuotationUploads.render();
}
