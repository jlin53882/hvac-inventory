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
};
