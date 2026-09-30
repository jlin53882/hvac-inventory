// 跨模組共用、會被其他模組改寫的狀態（issue #39：原本是全域變數）
export const workProgressState = {
  wprSelectedFiles: [], // 工作進度待上傳照片（含 file/previewUrl）
  wprAppointments: [],
  wprReportsByAppointment: {},
  wprCurrentReport: null,
  wprHistoryPage: 1,
  wprHistoryTotal: 0,
  wprDayRequestToken: 0,
  wprHistoryRequestToken: 0,
  wprKpiRequestToken: 0,
  wprDetailRequestTokens: {},
  wprSelectRequestToken: 0,
  wprPhotoManageStates: {},
  wprPhotoManageReports: {},
  wprSuppressHistoryToggle: {},
  wprInitialUploaderName: '',
  wprPendingSubmit: null,  // 儲存確認視窗中的快照（開啟期間不可再開未儲存確認）
  wprLastDetailReport: null,  // 最近開啟的歷史詳情（相簿用）
  wprCurrentDateValue: '',  // 目前載入的工作日期（切日期遇未儲存內容時還原用）
};

/**
 * Drop management state for detail surfaces that no longer exist.
 * @param {function(string): boolean} predicate - State-key matcher.
 * @returns {void} Function result.
 */
export function wprClearPhotoManageStates(predicate) {
  Object.keys(workProgressState.wprPhotoManageStates).forEach(function(key) {
    var targetId = key.slice(key.indexOf(':') + 1);
    if (predicate(targetId)) {
      delete workProgressState.wprPhotoManageStates[key];
      delete workProgressState.wprPhotoManageReports[key];
    }
  });
}
