// 跨模組共用、會被其他模組改寫的狀態（issue #39：原本是全域變數）
export const calendarState = {
  calSelected: new Date(), // 選取的日期
  calEvents: [], // 當月/當日行程
  calTodayEvents: [], // 今日派工（KPI 用，沿用既有 date API）
  calLoadError: '', // 行事曆資料載入錯誤
  calLoadRequestToken: 0,
  calSvc: [], // 服務項目字典（全部，含停用）
  calAssignable: [], // 可指派人員
  // Search is a right-panel mode, not a new page-level section.
  calSearchMode: false,
  calSearchItems: [],
  calSearchMeta: { from: '', to: '', q: '' },
  calSearchRequestToken: 0,
  calSearchState: 'idle',
};
