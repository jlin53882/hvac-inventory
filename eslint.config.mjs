// 前端 lint 設定：只抓「真的會出錯」的問題（未定義識別字、未使用的 import / 變數），不管風格。
// - static/js 是瀏覽器端 ES modules；tests/*.js 是 Node 端（vm 載入模組）
// - static/dist 是建置產物、static/vendor 是第三方檔，不檢查
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['static/dist/**', 'static/vendor/**', 'node_modules/**', '.gitnexus/**'] },
  {
    files: ['static/js/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
];
