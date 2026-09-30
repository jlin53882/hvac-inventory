// 切頁 port（issue #39）：feature 需要切到其他頁籤時呼叫 navigateToTab，不直接 import shell/app.js。
// 實作是 shell/app.js 的 switchTab，由 configureShell()（pages/main.js 啟動時最先呼叫）注入；沒有注入就直接丟錯。

var tabNavigator = null;

export function provideTabNavigator(navigate) {
  if (typeof navigate !== 'function') throw new TypeError('provideTabNavigator 需要切頁函式');
  tabNavigator = navigate;
}

export function navigateToTab(tab) {
  if (!tabNavigator) throw new Error('navigateToTab：尚未設定切頁實作（pages/main.js 需先呼叫 configureShell）');
  return tabNavigator(tab);
}
