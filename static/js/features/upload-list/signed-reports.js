// 庫存管理系統 - 每日簽名報表頁（2026-09-07 v2 對齊 demo）
// 畫面與行為由 features/upload-list/upload-list.js 的共用「檔案上傳清單」提供；本檔只放本頁設定。
// 權限：登入可查/預覽/下載；上傳需 signed-report-upload；編輯/刪除直接消費 backend final capabilities

import { appState } from '../../core/state.js';
import { createUploadListPage } from './upload-list.js';

export var SignedReports = createUploadListPage({
  global: 'SignedReports',
  api: '/api/signed-reports',
  isActive: () => appState.currentTab === 'signed-reports',
  title: '每日簽名報表',
  uploadLabel: '每日簽名日報表',
  editTitle: '編輯每日簽名日報表',
  kpiIcons: { archived: '🗂', rate: '📈' },
  uploadPermission: 'signed-report-upload',
});

// 渲染每日簽名報表頁面（features/shell/app.js switchTab 呼叫）
export function renderSignedReports() {
  return SignedReports.render();
}
