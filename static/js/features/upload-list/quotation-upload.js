// 庫存管理系統 - 報價單上傳頁（2026-09-07 v2 對齊 demo）
// 畫面與行為由 features/upload-list/upload-list.js 的共用「檔案上傳清單」提供；本檔只放本頁設定。
// 權限：登入可查/預覽/下載/上傳；編輯/刪除直接消費 backend final capabilities

import { appState } from '../../core/state.js';
import { quoteModeTabs } from '../quotation/mode-tabs.js';
import { createUploadListPage } from './upload-list.js';

export var QuotationUploads = createUploadListPage({
  global: 'QuotationUploads',
  api: '/api/quotation-uploads',
  // data-page 由 setPageScope 維護：切回報價單模式（或啟動流程重新掛載）後，進行中的上傳頁渲染必須停止
  isActive: () => appState.currentTab === 'quotation' && document.body.dataset.page === 'quotation-upload',
  title: '報價單上傳',
  uploadLabel: '報價單',
  editTitle: '編輯報價單上傳',
  kpiIcons: { archived: '🧾', rate: '📊' },
  uploadPermission: null,
  intro: '位置：「報價單」頁上方切換至「報價單上傳」。登入即可上傳與查詢，編輯/刪除見下方權限規則。',
  steps: [
    '將客戶確認（回簽）的報價單掃描成 PDF/圖片',
    '回到本頁拖曳上傳，或以手機相機直接拍攝',
    '選擇「報表日期」= 報價單所屬的業務日期（非上傳當天）',
    '歷史區以日期/關鍵字篩選，支援預覽與下載',
  ],
  missingHint: '缺檔日 = 行事曆有派工但未上傳報價單的日期',
  headerHtml: () => quoteModeTabs('upload'),
});

// 渲染報價單上傳頁面（quotation.js quoteSwitchMode('upload') 呼叫）
export function renderQuotationUploads() {
  return QuotationUploads.render();
}
